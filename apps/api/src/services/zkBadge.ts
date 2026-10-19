import crypto from 'crypto';
import { poseidon2 } from 'poseidon-lite';
import { Keypair } from '@stellar/stellar-sdk';
import type { PrismaClient } from '@prisma/client';
import { STELLAR_CONFIG } from '../config/stellar.js';
import { readContract, toAddressVal } from './soroban.js';

/**
 * Sistema de Badges de Investidor com Zero-Knowledge Proof (Groth16/BN254, verificado on-chain)
 * 
 * Níveis:
 * - NONE: < 1,000 USDC
 * - BRONZE: >= 1,000 USDC
 * - SILVER: >= 10,000 USDC
 * - GOLD: >= 50,000 USDC
 * - DIAMOND: >= 100,000 USDC
 */

export enum InvestorBadge {
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD'
}

export interface BadgeThresholds {
  [InvestorBadge.BRONZE]: number;
  [InvestorBadge.SILVER]: number;
  [InvestorBadge.GOLD]: number;
}

// Limites para cada badge (em USDC)
export const BADGE_THRESHOLDS: BadgeThresholds = {
  [InvestorBadge.BRONZE]: 0,
  [InvestorBadge.SILVER]: 1000,
  [InvestorBadge.GOLD]: 10000,
};

/**
 * Determina o badge do investidor baseado no valor total investido
 * Bronze: R$0 - R$999
 * Silver: R$1,000 - R$9,999
 * Gold: R$10,000+
 */
export function calculateBadge(totalInvested: number): InvestorBadge {
  if (totalInvested >= BADGE_THRESHOLDS[InvestorBadge.GOLD]) {
    return InvestorBadge.GOLD;
  } else if (totalInvested >= BADGE_THRESHOLDS[InvestorBadge.SILVER]) {
    return InvestorBadge.SILVER;
  } else {
    return InvestorBadge.BRONZE;
  }
}

/**
 * Real zero-knowledge badge (Groth16 over BN254, circuit zk/badge/circuits/investor_tier.circom).
 *
 * The platform commits to the investor's verified total with commitment = Poseidon(totalCents, salt) and attests
 * (commitment, investor) with an ed25519 key. The investor proves in the browser that the committed total reaches a
 * tier threshold; the BadgeVerifier contract checks the attestation and the proof on-chain. The total stays private.
 */
export const ATTESTATION_DOMAIN = 'TSF-BADGE-v1';

/** Minimum total per tier, in USDC cents (public input `threshold` of the circuit) */
export const TIER_THRESHOLDS_CENTS: Record<InvestorBadge, number> = {
  [InvestorBadge.BRONZE]: Math.round(BADGE_THRESHOLDS[InvestorBadge.BRONZE] * 100),
  [InvestorBadge.SILVER]: Math.round(BADGE_THRESHOLDS[InvestorBadge.SILVER] * 100),
  [InvestorBadge.GOLD]: Math.round(BADGE_THRESHOLDS[InvestorBadge.GOLD] * 100),
};

/** Highest tier whose threshold (in cents) is covered by a proven threshold */
export function tierForThreshold(thresholdCents: number | null | undefined): InvestorBadge | null {
  if (thresholdCents === null || thresholdCents === undefined) return null;
  const tiers = [InvestorBadge.GOLD, InvestorBadge.SILVER, InvestorBadge.BRONZE];
  return tiers.find((t) => thresholdCents >= TIER_THRESHOLDS_CENTS[t]) ?? null;
}

/** Badge recorded by the BadgeVerifier contract for a wallet (null when none) */
export async function readOnChainBadge(
  publicKey: string
): Promise<{ threshold: number; commitment: string; ledger: number } | null> {
  const contractId = STELLAR_CONFIG.BADGE_VERIFIER;
  if (!contractId) return null;
  const badge = await readContract<{ threshold: bigint; commitment: Buffer; ledger: number } | null>(contractId, 'badge', [
    toAddressVal(publicKey),
  ]);
  if (!badge) return null;
  return { threshold: Number(badge.threshold), commitment: Buffer.from(badge.commitment).toString('hex'), ledger: badge.ledger };
}

/** New Poseidon commitment (fresh salt) to a total invested amount */
export function createBadgeCommitment(totalInvested: number): { commitment: string; salt: string; totalCents: number } {
  const totalCents = Math.round(totalInvested * 100);
  // 31 random bytes always fit in the BN254 scalar field
  const salt = BigInt('0x' + crypto.randomBytes(31).toString('hex'));
  const commitment = poseidon2([BigInt(totalCents), salt]).toString(16).padStart(64, '0');
  return { commitment, salt: salt.toString(), totalCents };
}

function attesterKeypair(): Keypair {
  const secret = process.env.BADGE_ATTESTER_SECRET;
  if (!secret) throw new Error('BADGE_ATTESTER_SECRET is not configured');
  return Keypair.fromSecret(secret);
}

export function attesterPublicKeyHex(): string {
  return attesterKeypair().rawPublicKey().toString('hex');
}

/** ed25519 signature over domain || commitment || investor strkey, checked by the BadgeVerifier contract */
export function attestCommitment(commitmentHex: string, investorPublicKey: string): string {
  const message = Buffer.concat([
    Buffer.from(ATTESTATION_DOMAIN),
    Buffer.from(commitmentHex, 'hex'),
    Buffer.from(investorPublicKey),
  ]);
  return attesterKeypair().sign(message).toString('hex');
}

/**
 * Recomputes the investor's total, tier and commitment from their APPROVED orders only (paid, verified and
 * minted). Paid orders still awaiting approval may be rejected and refunded, so they never count: the platform
 * must not attest a total that could later shrink.
 */
export async function refreshInvestorBadge(prisma: PrismaClient, investorId: string) {
  const orders = await prisma.order.findMany({
    where: { investorId, status: 'COMPLETED', approvalStatus: 'APPROVED' },
    select: { total: true },
  });
  const totalInvested = orders.reduce((sum, o) => sum + o.total, 0);
  const investorBadge = calculateBadge(totalInvested);
  const { commitment, salt } = createBadgeCommitment(totalInvested);
  return prisma.user.update({
    where: { id: investorId },
    data: { totalInvested, investorBadge, badgeCommitment: commitment, badgeSalt: salt, lastBadgeUpdate: new Date() },
  });
}

/**
 * Retorna informações públicas sobre o badge sem revelar o valor exato
 */
export function getBadgeInfo(badge: InvestorBadge): {
  badge: InvestorBadge;
  name: string;
  minAmount: number;
  color: string;
  icon: string;
  benefits: string[];
} {
  const badgeInfo = {
    [InvestorBadge.BRONZE]: {
      badge: InvestorBadge.BRONZE,
      name: 'Bronze',
      minAmount: BADGE_THRESHOLDS[InvestorBadge.BRONZE],
      color: '#CD7F32',
      icon: '',
      benefits: [
        'Basic support',
        'Access to marketplace'
      ],
    },
    [InvestorBadge.SILVER]: {
      badge: InvestorBadge.SILVER,
      name: 'Silver',
      minAmount: BADGE_THRESHOLDS[InvestorBadge.SILVER],
      color: '#C0C0C0',
      icon: '',
      benefits: [
        'Priority support',
        'Monthly reports',
        'Fee reduction (-5%)'
      ],
    },
    [InvestorBadge.GOLD]: {
      badge: InvestorBadge.GOLD,
      name: 'Gold',
      minAmount: BADGE_THRESHOLDS[InvestorBadge.GOLD],
      color: '#FFD700',
      icon: '',
      benefits: [
        'Personal advisory',
        'Premium analysis',
        'Fee reduction (-15%)',
        'Early access to new funds'
      ],
    },
  };

  return badgeInfo[badge];
}

/**
 * Calcula o progresso até o próximo badge
 */
export function getBadgeProgress(totalInvested: number): {
  currentBadge: InvestorBadge;
  nextBadge: InvestorBadge | null;
  progressPercentage: number;
  amountToNext: number;
} {
  const currentBadge = calculateBadge(totalInvested);
  
  const badgeOrder = [
    InvestorBadge.BRONZE,
    InvestorBadge.SILVER,
    InvestorBadge.GOLD,
  ];

  const currentIndex = badgeOrder.indexOf(currentBadge);
  const nextBadge = currentIndex < badgeOrder.length - 1 ? badgeOrder[currentIndex + 1] : null;

  if (!nextBadge) {
    return {
      currentBadge,
      nextBadge: null,
      progressPercentage: 100,
      amountToNext: 0,
    };
  }

  // Progresso entre badges
  const currentThreshold = BADGE_THRESHOLDS[currentBadge];
  const nextThreshold = BADGE_THRESHOLDS[nextBadge];
  const range = nextThreshold - currentThreshold;
  const progress = totalInvested - currentThreshold;
  const progressPercentage = Math.min(100, Math.max(0, (progress / range) * 100));
  const amountToNext = Math.max(0, nextThreshold - totalInvested);

  return {
    currentBadge,
    nextBadge,
    progressPercentage,
    amountToNext,
  };
}
