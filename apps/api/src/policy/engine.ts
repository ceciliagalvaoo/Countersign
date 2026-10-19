import type { PrismaClient } from '@prisma/client';
import { toUnits, unitsFromDbFloat } from './canonical.js';
import { getChainReader, type ChainReader } from './chain.js';
import { appendEntry } from './decisionLog.js';
import { getDraft, getLatestApproved } from './mandate.js';
import { evaluate, evaluateEligibility, type FundFacts, type PolicyContext, type Position } from './rules.js';
import { PROPOSAL_KEYS, type Proposal } from './schema.js';

/**
 * Gathers the facts for the pure rules (database + on-chain reads), evaluates, and writes one log row.
 * A failing read throws: the proposal is not decided (fail closed) and the route answers 503.
 */

const FUND_SELECT = {
  id: true,
  status: true,
  tokenContractId: true,
  fundWalletPublicKey: true,
  investorProfile: true,
  riskLevel: true,
  sector: true,
  liquidityType: true,
  lockupDays: true,
} as const;

export async function loadFund(prisma: PrismaClient, fundId: string): Promise<(FundFacts & { name?: string }) | null> {
  return prisma.fund.findUnique({ where: { id: fundId }, select: FUND_SELECT });
}

/** Paid orders of the investor (not rejected) with the fund attributes the concentration rules need */
export async function loadPositions(prisma: PrismaClient, userId: string): Promise<Position[]> {
  const orders = await prisma.order.findMany({
    where: { investorId: userId, status: 'COMPLETED', approvalStatus: { not: 'REJECTED' } },
    select: { total: true, fund: { select: { sector: true, liquidityType: true, lockupDays: true } } },
  });
  return orders.map((o) => ({ ...o.fund, units: unitsFromDbFloat(o.total) }));
}

/** Owner address whose badge counts: the wallet contract's owner, else the investor's connected wallet */
async function ownerAddress(prisma: PrismaClient, chain: ChainReader, userId: string, wallet: string | null) {
  if (wallet) return chain.owner(wallet);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { publicKey: true } });
  return user?.publicKey ?? null;
}

/** Wallet lookup that treats a not yet implemented resolver as "no wallet" (fail closed: mandate_not_active) */
async function walletFor(chain: ChainReader, userId: string): Promise<string | null> {
  try {
    return await chain.walletFor(userId);
  } catch (e) {
    if ((e as Error).name === 'NotImplementedError') return null;
    throw e;
  }
}

export async function buildContext(prisma: PrismaClient, userId: string, proposal: Proposal, chain = getChainReader()) {
  const [draft, approved, fund, positions] = await Promise.all([
    getDraft(prisma, userId),
    getLatestApproved(prisma, userId),
    loadFund(prisma, proposal.fundId),
    loadPositions(prisma, userId),
  ]);
  const wallet = await walletFor(chain, userId);
  const onChainMandateHash = wallet ? await chain.mandateHash(wallet) : null;
  const badgeThresholdCents =
    fund?.investorProfile === 'QUALIFICADO'
      ? await ownerAddress(prisma, chain, userId, wallet).then((o) => (o ? chain.badgeThresholdCents(o) : null))
      : null;
  const spentInPeriodUnits = wallet ? await chain.spentInPeriod(wallet) : 0n;
  const fundAllowedOnChain = wallet && fund?.fundWalletPublicKey ? await chain.fundAllowed(wallet, fund.fundWalletPublicKey) : false;

  const extraKeys = Object.keys(proposal).filter((k) => !(PROPOSAL_KEYS as readonly string[]).includes(k)).sort();
  const ctx: PolicyContext = {
    proposal: {
      fundId: proposal.fundId,
      amountUnits: toUnits(proposal.amountUsdc),
      amountSource: proposal.amountSource,
      origin: proposal.origin,
      toolCallId: proposal.toolCallId,
      extraKeys,
    },
    declaredResidences: [...(draft?.residences ?? []), ...(approved?.mandate.residences ?? [])],
    mandate: approved?.mandate ?? null,
    approvedHash: approved?.hash ?? null,
    onChainMandateHash,
    fund,
    badgeThresholdCents,
    spentInPeriodUnits,
    positions,
    fundAllowedOnChain: !!fundAllowedOnChain,
  };
  return { ctx, wallet };
}

/** POST /api/agent/proposals: evaluate and log. Returns the decision and its 32 byte chain hash */
export async function proposeSubscription(prisma: PrismaClient, userId: string, proposal: Proposal, chain = getChainReader()) {
  const { ctx } = await buildContext(prisma, userId, proposal, chain);
  const decision = evaluate(ctx);
  const row = await appendEntry(
    {
      kind: 'decision',
      userId,
      origin: proposal.origin,
      fundId: proposal.fundId,
      amountUnits: ctx.proposal.amountUnits.toString(),
      rule: decision.rule,
      outcome: decision.outcome,
      mandateHash: ctx.approvedHash,
      toolCallId: proposal.toolCallId,
    },
    prisma
  );
  return { decision, seq: row.seq, hash: row.hash };
}

/** GET /api/agent/eligibility/:fundId: only the eligibility rule, nothing written */
export async function checkFundEligibility(prisma: PrismaClient, userId: string, fundId: string, chain = getChainReader()) {
  const fund = await loadFund(prisma, fundId);
  if (!fund) return null;
  let threshold: number | null = null;
  if (fund.investorProfile === 'QUALIFICADO') {
    const wallet = await walletFor(chain, userId);
    const owner = await ownerAddress(prisma, chain, userId, wallet);
    threshold = owner ? await chain.badgeThresholdCents(owner) : null;
  }
  return evaluateEligibility(fund, threshold);
}
