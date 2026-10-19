import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as StellarSdk from '@stellar/stellar-sdk';
import {
  attestCommitment,
  attesterPublicKeyHex,
  getBadgeInfo,
  getBadgeProgress,
  InvestorBadge,
  readOnChainBadge,
  refreshInvestorBadge,
  tierForThreshold,
  TIER_THRESHOLDS_CENTS,
} from '../services/zkBadge.js';
import { requireAuth } from '../config/auth.js';
import { STELLAR_CONFIG } from '../config/stellar.js';
import { getConfirmedCall, prepareInvocation, toAddressVal } from '../services/soroban.js';
import { isPublicKey } from '../services/stellarVerify.js';
import { appendOnchainEvent } from '../policy/decisionLog.js';

const hex = (len: number) => z.string().regex(new RegExp(`^[0-9a-f]{${len}}$`), `Expected ${len} hex characters`);

export async function badgeRoutes(fastify: FastifyInstance) {
  
  // Get user badge and progress
  fastify.get('/:userId', async (request, reply) => {
    try {
      const authUser = requireAuth(request, reply);
      if (!authUser) return reply;

      const { userId } = request.params as { userId: string };
      if (authUser.id !== userId && authUser.role !== 'GESTOR') {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          totalInvested: true,
          investorBadge: true,
          badgeCommitment: true,
          badgeOnChainThreshold: true,
          badgeClaimTxHash: true,
          lastBadgeUpdate: true,
        }
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const currentBadge = user.investorBadge as InvestorBadge;
      const badgeInfo = getBadgeInfo(currentBadge);
      const progress = getBadgeProgress(user.totalInvested);

      return {
        user: {
          id: user.id,
          email: user.email,
          totalInvested: user.totalInvested,
          lastBadgeUpdate: user.lastBadgeUpdate,
        },
        badge: {
          ...badgeInfo,
          hasProof: !!user.badgeCommitment,
          onChain: user.badgeClaimTxHash
            ? { tier: tierForThreshold(user.badgeOnChainThreshold), txHash: user.badgeClaimTxHash }
            : null,
        },
        progress,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Public: tier proven on-chain by a wallet (BadgeVerifier contract). Reveals the tier, never the amount.
  fastify.get('/verify/:publicKey', async (request, reply) => {
    try {
      const { publicKey } = request.params as { publicKey: string };
      if (!isPublicKey(publicKey)) {
        return reply.status(400).send({ error: 'Invalid Stellar public key' });
      }
      const badge = await readOnChainBadge(publicKey);
      return {
        publicKey,
        verified: !!badge,
        tier: tierForThreshold(badge?.threshold),
        provenMinimumUsdc: badge ? badge.threshold / 100 : null,
        ledger: badge?.ledger ?? null,
        contractId: STELLAR_CONFIG.BADGE_VERIFIER || null,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to read on-chain badge' });
    }
  });

  // Investor only: the opening of their commitment + the platform attestation, to build the proof in the browser
  fastify.get('/:userId/zk-witness', async (request, reply) => {
    try {
      const authUser = requireAuth(request, reply, ['INVESTIDOR']);
      if (!authUser) return reply;
      const { userId } = request.params as { userId: string };
      if (authUser.id !== userId) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { publicKey: true, totalInvested: true, investorBadge: true, badgeCommitment: true, badgeSalt: true },
      });
      if (!user?.publicKey) {
        return reply.status(400).send({ error: 'Connect a wallet first' });
      }
      if (!user.badgeCommitment || !user.badgeSalt) {
        return reply.status(400).send({ error: 'No verified investments yet' });
      }

      const tier = user.investorBadge as InvestorBadge;
      return {
        investor: user.publicKey,
        totalCents: Math.round(user.totalInvested * 100),
        salt: user.badgeSalt,
        commitment: user.badgeCommitment,
        attestation: attestCommitment(user.badgeCommitment, user.publicKey),
        attesterPublicKey: attesterPublicKeyHex(),
        tier,
        threshold: TIER_THRESHOLDS_CENTS[tier],
        circuit: { wasm: '/zk/investor_tier.wasm', zkey: '/zk/investor_tier.zkey' },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to prepare ZK witness' });
    }
  });

  // Investor only: builds claim(investor, threshold, commitment, attestation, proof) for the investor's wallet.
  // The RPC simulation already runs the on-chain Groth16 verification, so invalid proofs are rejected here.
  fastify.post('/:userId/zk-claim/build', async (request, reply) => {
    try {
      const authUser = requireAuth(request, reply, ['INVESTIDOR']);
      if (!authUser) return reply;
      const { userId } = request.params as { userId: string };
      if (authUser.id !== userId) {
        return reply.status(403).send({ error: 'Access denied' });
      }
      const { threshold, proof } = z
        .object({ threshold: z.number().int().nonnegative(), proof: z.object({ a: hex(128), b: hex(256), c: hex(128) }) })
        .parse(request.body);
      if (!STELLAR_CONFIG.BADGE_VERIFIER) {
        return reply.status(500).send({ error: 'BADGE_VERIFIER_CONTRACT_ID is not configured' });
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { publicKey: true, badgeCommitment: true },
      });
      if (!user?.publicKey || !user.badgeCommitment) {
        return reply.status(400).send({ error: 'No commitment for this investor' });
      }

      let transactionXdr: string;
      try {
        transactionXdr = await prepareInvocation(user.publicKey, STELLAR_CONFIG.BADGE_VERIFIER, 'claim', [
          toAddressVal(user.publicKey),
          StellarSdk.nativeToScVal(BigInt(threshold), { type: 'u64' }),
          StellarSdk.nativeToScVal(Buffer.from(user.badgeCommitment, 'hex')),
          StellarSdk.nativeToScVal(Buffer.from(attestCommitment(user.badgeCommitment, user.publicKey), 'hex')),
          // contracttype struct = ScMap with Symbol keys in sorted order
          StellarSdk.xdr.ScVal.scvMap(
            (['a', 'b', 'c'] as const).map(
              (k) =>
                new StellarSdk.xdr.ScMapEntry({
                  key: StellarSdk.xdr.ScVal.scvSymbol(k),
                  val: StellarSdk.xdr.ScVal.scvBytes(Buffer.from(proof[k], 'hex')),
                })
            )
          ),
        ]);
      } catch (e) {
        return reply.status(400).send({ error: 'Proof rejected by the BadgeVerifier contract', reason: (e as Error).message });
      }
      return { transactionXdr };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to build badge claim' });
    }
  });

  // Investor only: confirms the claim was executed on-chain and stores the proven tier
  fastify.post('/:userId/zk-claim/confirm', async (request, reply) => {
    try {
      const authUser = requireAuth(request, reply, ['INVESTIDOR']);
      if (!authUser) return reply;
      const { userId } = request.params as { userId: string };
      if (authUser.id !== userId) {
        return reply.status(403).send({ error: 'Access denied' });
      }
      const { txHash } = z.object({ txHash: z.string() }).parse(request.body);

      const user = await fastify.prisma.user.findUnique({ where: { id: userId }, select: { publicKey: true } });
      if (!user?.publicKey) {
        return reply.status(400).send({ error: 'Connect a wallet first' });
      }

      let call;
      try {
        call = await getConfirmedCall(txHash);
      } catch (e) {
        return reply.status(400).send({ error: 'Badge claim verification failed', reason: (e as Error).message });
      }
      if (
        call.kind !== 'invoke' ||
        call.contractId !== STELLAR_CONFIG.BADGE_VERIFIER ||
        call.method !== 'claim' ||
        call.args?.[0] !== user.publicKey
      ) {
        return reply.status(400).send({ error: 'Transaction is not a badge claim for this investor' });
      }

      const badge = await readOnChainBadge(user.publicKey);
      if (!badge) {
        return reply.status(400).send({ error: 'No badge recorded on-chain' });
      }
      await fastify.prisma.user.update({
        where: { id: userId },
        data: { badgeOnChainThreshold: badge.threshold, badgeClaimTxHash: txHash },
      });
      // Evidence: every verified claim hash has one decision log row (once per hash, even if confirmed again)
      try {
        await appendOnchainEvent({ userId, action: 'claim', txHash }, fastify.prisma, { once: true });
      } catch (e) {
        fastify.log.error(e);
      }
      return { verified: true, tier: tierForThreshold(badge.threshold), txHash };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to confirm badge claim' });
    }
  });

  // Force badge recalculation (admin only)
  fastify.post('/:userId/recalculate', async (request, reply) => {
    try {
      const authUser = requireAuth(request, reply, ['GESTOR']);
      if (!authUser) return reply;

      const { userId } = request.params as { userId: string };

      const user = await refreshInvestorBadge(fastify.prisma, userId);
      const totalInvested = user.totalInvested;
      const newBadge = user.investorBadge as InvestorBadge;

      const badgeInfo = getBadgeInfo(newBadge);
      const progress = getBadgeProgress(totalInvested);

      return {
        message: 'Badge recalculado com sucesso',
        user: {
          id: user.id,
          totalInvested: user.totalInvested,
          badge: user.investorBadge,
          lastUpdate: user.lastBadgeUpdate,
        },
        badgeInfo,
        progress,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Get all badge tiers info
  fastify.get('/info/tiers', async (request, reply) => {
    try {
      const badges = [
        InvestorBadge.BRONZE,
        InvestorBadge.SILVER,
        InvestorBadge.GOLD,
      ];

      const tiers = badges.map(badge => getBadgeInfo(badge));

      return { tiers };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Get leaderboard (top investors by badge)
  fastify.get('/leaderboard', async (request, reply) => {
    try {
      const authUser = requireAuth(request, reply);
      if (!authUser) return reply;

      const topInvestors = await fastify.prisma.user.findMany({
        where: {
          role: 'INVESTIDOR',
          investorBadge: { not: 'NONE' }
        },
        select: {
          id: true,
          email: true,
          investorBadge: true,
          totalInvested: true,
          lastBadgeUpdate: true,
        },
        orderBy: {
          totalInvested: 'desc'
        },
        take: 100
      });

      const leaderboard = topInvestors.map(investor => {
        const badgeInfo = getBadgeInfo(investor.investorBadge as InvestorBadge);
        return {
          userId: investor.id,
          email: investor.email.replace(/(.{3}).*(@.*)/, '$1***$2'), // Ocultar parte do email
          badge: {
            level: investor.investorBadge,
            name: badgeInfo.name,
            icon: badgeInfo.icon,
            color: badgeInfo.color,
          },
          // Do not reveal the exact amount, only the range
          investmentRange: {
            min: badgeInfo.minAmount,
            max: badgeInfo.badge === InvestorBadge.GOLD ? null : undefined,
          },
          lastUpdate: investor.lastBadgeUpdate,
        };
      });

      return { leaderboard };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
