// src/services/recommendationService.ts
import type { PrismaClient, Fund } from "@prisma/client";

// Types for the recommendation system (stored as plain strings; validated by the fund routes)
type RiskLevel = "BAIXO" | "MEDIO" | "ALTO";
type FundType = "FIDC" | "FIDC_NP";
type FundInteractionType = "VIEW" | "CLICK" | "FAVORITE" | "START_ORDER";

/**
 * Builds a simple investor profile based on invested or viewed funds.
 */
export async function buildInvestorProfile(prisma: PrismaClient, investorId: string) {
  // Run queries in parallel for better performance
  const [orders, interactions] = await Promise.all([
    // 1) Completed orders - select only the needed fields
    prisma.order.findMany({
      where: {
        investorId,
        status: "COMPLETED",
        approvalStatus: { not: "REJECTED" }, // refunded orders are not investments
      },
      select: {
        fund: {
          select: {
            fundType: true,
            sector: true,
            riskLevel: true,
            durationMonths: true,
            minTicket: true,
          },
        },
      },
    }),
    // 2) Interactions - select only the needed fields
    prisma.fundInteraction.findMany({
      where: { investorId },
      select: {
        type: true,
        fund: {
          select: {
            fundType: true,
            sector: true,
            riskLevel: true,
            durationMonths: true,
            minTicket: true,
          },
        },
      },
    }),
  ]);

  // fund objects returned by the minimal select are partial compared to the full Prisma Fund type
  const touchedFunds: { fund: Partial<Fund>; weight: number }[] = [
    // investments weigh more
    ...orders.map((o) => ({ fund: o.fund, weight: 3 })),
    // implicit interactions
    ...interactions.map((i) => {
      let base = 1;
      if (i.type === "FAVORITE") base = 2;
      if (i.type === "START_ORDER") base = 2;
      return { fund: i.fund, weight: base };
    }),
  ];

  if (touchedFunds.length === 0) {
    return null; // cold start
  }

  const fundTypeCount: Record<string, number> = {};
  const sectorCount: Record<string, number> = {};
  const riskLevelCount: Record<string, number> = {};
  const durationValues: number[] = [];
  const minTicketValues: number[] = [];

  for (const { fund, weight } of touchedFunds) {
    if (fund.fundType) {
      fundTypeCount[fund.fundType] =
        (fundTypeCount[fund.fundType] || 0) + weight;
    }
    if (fund.sector) {
      sectorCount[fund.sector] = (sectorCount[fund.sector] || 0) + weight;
    }
    if (fund.riskLevel) {
      riskLevelCount[fund.riskLevel] =
        (riskLevelCount[fund.riskLevel] || 0) + weight;
    }
    if (fund.durationMonths != null) {
      // repeat the value by weight to pull the average
      for (let i = 0; i < weight; i++) durationValues.push(fund.durationMonths);
    }
    if (fund.minTicket != null) {
      for (let i = 0; i < weight; i++) minTicketValues.push(fund.minTicket);
    }
  }

  const topKey = (obj: Record<string, number>) => {
    const entries = Object.entries(obj);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
  };

  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((sum, v) => sum + v, 0) / arr.length : null;

  const avgDuration = avg(durationValues);
  const avgMinTicket = avg(minTicketValues);

  // Tolerance ranges (e.g., ±50%)
  const durationRange =
    avgDuration != null
      ? { min: avgDuration * 0.5, max: avgDuration * 1.5 }
      : null;

  const minTicketRange =
    avgMinTicket != null
      ? { min: avgMinTicket * 0.5, max: avgMinTicket * 1.5 }
      : null;

  return {
    preferredFundType: topKey(fundTypeCount),
    preferredSector: topKey(sectorCount),
    preferredRiskLevel: topKey(riskLevelCount),
    durationRange,
    minTicketRange,
  };
}

/**
 * Busca fundos candidatos:
 * - active
 * - not yet invested by the user
 */
export async function getCandidateFunds(prisma: PrismaClient, investorId: string) {
  // funds already invested - optimized query
  const investedOrders = await prisma.order.findMany({
    where: {
      investorId,
      status: "COMPLETED",
      approvalStatus: { not: "REJECTED" }, // refunded orders are not investments
    },
    select: { fundId: true },
    distinct: ["fundId"], // Remove duplicatas no banco
  });

  const investedFundIds = investedOrders.map((o) => o.fundId);

  // Select only fields needed for scoring
  const candidates = await prisma.fund.findMany({
    where: {
      status: "APPROVED",
      id: { notIn: investedFundIds },
    },
    select: {
      id: true,
      name: true,
      symbol: true,
      fundType: true,
      riskLevel: true,
      sector: true,
      durationMonths: true,
      minTicket: true,
      price: true,
      description: true,
      status: true,
      // include additional metadata used by the recommendation route
      targetAmount: true,
      totalIssued: true,
      maxSupply: true,
    },
  });

  return candidates;
}

/**
 * Função de score simples baseada no perfil + metadados do fundo
 * Simple scoring function based on profile + fund metadata
 */
function scoreFund(fund: Partial<Fund>, profile: any) {
  let score = 0;

  if (
    profile?.preferredFundType &&
    fund.fundType === profile.preferredFundType
  ) {
    score += 3;
  }

  if (profile?.preferredSector && fund.sector === profile.preferredSector) {
    score += 3;
  }

  if (
    profile?.preferredRiskLevel &&
    fund.riskLevel === profile.preferredRiskLevel
  ) {
    score += 2;
  }

  // duration (prazo médio)
  if (profile?.durationRange && fund.durationMonths != null) {
    const { min, max } = profile.durationRange;
    if (fund.durationMonths >= min && fund.durationMonths <= max) {
      score += 1;
    }
  }

  // minimum ticket
  if (profile?.minTicketRange && fund.minTicket != null) {
    const { min, max } = profile.minTicketRange;
    if (fund.minTicket >= min && fund.minTicket <= max) {
      score += 1;
    }
  }

  // bonus if it has some positive performance (future field)
  if (
    typeof (fund as any).return12m === "number" &&
    (fund as any).return12m > 0
  ) {
    score += 1;
  }

  return score;
}

/**
 * Main function: returns recommended funds
 */
export async function getRecommendedFunds(prisma: PrismaClient, investorId: string, limit = 10) {
  const profile = await buildInvestorProfile(prisma, investorId);
  const candidates = await getCandidateFunds(prisma, investorId);

  // Cold start → no profile yet
  if (!profile) {
    return candidates
      .sort((a, b) => ((b as any).return12m || 0) - ((a as any).return12m || 0))
      .slice(0, limit)
      .map((fund) => ({
        fund,
        score: 0,
        reason: "Funds with recent performance and active on the platform.",
      }));
  }

  const scored = candidates
    .map((fund) => {
      const score = scoreFund(fund, profile);
      return {
        fund,
        score,
        reason: buildReason(fund, profile, score),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

/**
 * Gera um "motivo" legível pro usuário ver na UI
 * Builds a readable reason for the UI
 */
function buildReason(fund: Partial<Fund>, profile: any, score: number): string {
  const reasons: string[] = [];

  if (
    profile?.preferredFundType &&
    fund.fundType === profile.preferredFundType
  ) {
    reasons.push(
      `same fund type you usually analyze or invest in (${fund.fundType})`
    );
  }

  if (profile?.preferredSector && fund.sector === profile.preferredSector) {
    reasons.push(
      `focus on the same sector (${fund.sector}) as the funds you prefer`
    );
  }

  if (
    profile?.preferredRiskLevel &&
    fund.riskLevel === profile.preferredRiskLevel
  ) {
    reasons.push(`risk level aligned with your history (${fund.riskLevel})`);
  }

  if (reasons.length === 0) {
    return "Selected based on similarity to funds you have already analyzed or invested in.";
  }

  return "Recommended because: " + reasons.join(", ") + ".";
}
