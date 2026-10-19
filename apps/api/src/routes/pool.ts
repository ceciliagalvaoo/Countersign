import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AVAILABLE_POOLS } from '../config/blend.js';
import { 
  buildDepositTransaction, 
  getOnChainPosition,
  buildWithdrawTransaction,
  toSmallestUnit
} from '../config/blendUtils.js';
import { requireAuth } from '../config/auth.js';
import { isPublicKey } from '../services/stellarVerify.js';
import { getConfirmedCall } from '../services/soroban.js';
import { RequestType } from '@blend-capital/blend-sdk';

// Validation schemas
const createPoolSchema = z.object({
  name: z.string().min(1),
  fundId: z.string().cuid(),
  blendPoolAddress: z.string(),
  assetAddress: z.string(),
});

// The amount is read from the verified transaction itself; a client-sent amount is accepted but ignored
const depositSchema = z.object({
  poolId: z.string().cuid(),
  amount: z.number().positive().optional(),
  txHash: z.string(), // Transaction hash after user signs
});


const buildDepositTxSchema = z.object({
  poolId: z.string().cuid(),
  amount: z.number().positive(),
  userAddress: z.string().refine(isPublicKey, 'Invalid Stellar public key'),
});

const buildWithdrawTxSchema = z.object({
  poolId: z.string().cuid(),
  amount: z.number().positive(),
  userAddress: z.string().refine(isPublicKey, 'Invalid Stellar public key'),
});

export async function poolRoutes(fastify: FastifyInstance) {
  // Pools are yield positions of the fund wallet in a Blend pool. Balances and APY are read from the chain;
  // totalDeposited is the net principal (verified deposits minus verified withdrawals).
  const loadPool = (id: string) =>
    fastify.prisma.pool.findUnique({
      where: { id },
      include: { fund: { select: { id: true, name: true, symbol: true, fundWalletPublicKey: true } } },
    });
  type LoadedPool = NonNullable<Awaited<ReturnType<typeof loadPool>>>;

  /**
   * Verifies that `txHash` is a Blend `submit` on this pool, sent by the fund wallet on its own position, and
   * returns the amount it supplied or withdrew (as collateral) of the pool's asset, in standard units.
   */
  async function verifyPoolTx(pool: LoadedPool, txHash: string, kind: 'deposit' | 'withdraw'): Promise<number> {
    const wallet = pool.fund.fundWalletPublicKey!;
    const call = await getConfirmedCall(txHash);
    if (call.kind !== 'invoke' || call.contractId !== pool.blendPoolAddress || call.method !== 'submit' || call.source !== wallet) {
      throw new Error('Transaction is not a Blend submit on this pool by the fund wallet');
    }
    const [from, spender, to, requests] = (call.args ?? []) as [string, string, string, { address: string; amount: bigint; request_type: number }[]];
    if (from !== wallet || spender !== wallet || to !== wallet || !Array.isArray(requests)) {
      throw new Error("Transaction does not move the fund wallet's own position");
    }
    const type = kind === 'deposit' ? RequestType.SupplyCollateral : RequestType.WithdrawCollateral;
    const units = requests
      .filter((r) => Number(r.request_type) === type && r.address === pool.assetAddress)
      .reduce((sum, r) => sum + BigInt(r.amount), 0n);
    if (units <= 0n) {
      throw new Error(`Transaction contains no ${kind} of the pool asset`);
    }
    return Number(units) / 1e7;
  }

  async function confirmPoolTx(request: any, reply: any, kind: 'deposit' | 'withdraw') {
    const user = requireAuth(request, reply, ['GESTOR']);
    if (!user) return reply;
    const body = depositSchema.parse(request.body);

    const pool = await loadPool(body.poolId);
    if (!pool) {
      return reply.status(404).send({ error: 'Pool not found' });
    }
    if (!pool.fund.fundWalletPublicKey) {
      return reply.status(400).send({ error: 'Fund wallet not configured' });
    }
    if (pool.processedTxHashes.includes(body.txHash) || pool.depositTxHash === body.txHash || pool.withdrawTxHash === body.txHash) {
      return reply.status(409).send({ error: 'Transaction already registered' });
    }

    let amount: number;
    try {
      amount = await verifyPoolTx(pool, body.txHash, kind);
    } catch (e) {
      const label = kind === 'deposit' ? 'Deposit' : 'Withdraw';
      return reply.status(400).send({ error: `${label} verification failed`, reason: (e as Error).message });
    }

    const updatedPool = await syncPool(pool, {
      principalDelta: kind === 'deposit' ? amount : -amount,
      data: {
        [kind === 'deposit' ? 'depositTxHash' : 'withdrawTxHash']: body.txHash,
        processedTxHashes: { push: body.txHash },
      },
    });
    return {
      pool: updatedPool,
      amount,
      message: kind === 'deposit' ? 'Deposit confirmed on-chain' : 'Withdraw confirmed on-chain',
    };
  }

  async function syncPool(pool: LoadedPool, extra: { principalDelta?: number; data?: Record<string, unknown> } = {}) {
    const totalDeposited = Math.max(0, pool.totalDeposited + (extra.principalDelta ?? 0));
    const data: Record<string, unknown> = { ...extra.data, totalDeposited, lastYieldUpdate: new Date() };
    const wallet = pool.fund.fundWalletPublicKey;
    if (wallet) {
      try {
        const { balance, apy } = await getOnChainPosition(pool.blendPoolAddress, pool.assetAddress, wallet);
        data.currentBalance = balance;
        data.apy = apy;
        data.yieldEarned = Math.max(0, balance - totalDeposited);
      } catch (error) {
        fastify.log.warn({ err: error }, `Could not read Blend position for pool ${pool.id}`);
      }
    }
    return fastify.prisma.pool.update({ where: { id: pool.id }, data });
  }
  
  // List available Blend pools (for pool creation)
  fastify.get('/pools/available', async (request, reply) => {
    try {
      return { pools: AVAILABLE_POOLS };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // List all pools
  fastify.get('/pools', async (request, reply) => {
    try {
      const pools = await fastify.prisma.pool.findMany({
        include: {
          fund: {
            select: {
              id: true,
              name: true,
              symbol: true,
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      return { pools };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Get pool by ID (refreshes balance and APY from the chain)
  fastify.get('/pools/:id', async (request, reply) => {
    try {
      // Refreshing a pool reads the chain and writes to the database: managers only
      const user = requireAuth(request, reply, ['GESTOR']);
      if (!user) return reply;
      const { id } = request.params as { id: string };
      const existing = await loadPool(id);
      if (!existing) {
        return reply.status(404).send({ error: 'Pool not found' });
      }

      const pool = await syncPool(existing);
      const currentYield = pool.currentBalance - pool.totalDeposited;

      return {
        pool: {
          ...pool,
          fund: existing.fund,
          currentYield,
          yieldPercentage: pool.totalDeposited > 0 ? (currentYield / pool.totalDeposited) * 100 : 0,
        },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Create a new pool
  fastify.post('/pools', async (request, reply) => {
    try {
      const user = requireAuth(request, reply, ['GESTOR']);
      if (!user) return reply;
      const body = createPoolSchema.parse(request.body);

      // Verify fund exists
      const fund = await fastify.prisma.fund.findUnique({
        where: { id: body.fundId }
      });

      if (!fund) {
        return reply.status(404).send({ error: 'Fund not found' });
      }

      // Create pool
      const pool = await fastify.prisma.pool.create({
        data: {
          name: body.name,
          fundId: body.fundId,
          blendPoolAddress: body.blendPoolAddress,
          assetAddress: body.assetAddress,
          totalDeposited: 0,
          currentBalance: 0,
          yieldEarned: 0,
          status: 'ACTIVE',
        },
        include: {
          fund: {
            select: {
              id: true,
              name: true,
              symbol: true,
            }
          }
        }
      });

      return { pool };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Build deposit transaction (returns XDR for the fund wallet to sign)
  fastify.post('/pools/build-deposit', async (request, reply) => {
    try {
      const user = requireAuth(request, reply, ['GESTOR']);
      if (!user) return reply;
      const body = buildDepositTxSchema.parse(request.body);

      const pool = await loadPool(body.poolId);
      if (!pool) {
        return reply.status(404).send({ error: 'Pool not found' });
      }
      if (pool.status !== 'ACTIVE') {
        return reply.status(400).send({ error: 'Pool is not active' });
      }
      // The pool position belongs to the fund wallet, which holds the investors' USDC
      if (!pool.fund.fundWalletPublicKey || body.userAddress !== pool.fund.fundWalletPublicKey) {
        return reply.status(400).send({ error: 'Connect the fund wallet to move funds in or out of its pool' });
      }

      const transactionXdr = await buildDepositTransaction(
        pool.blendPoolAddress,
        body.userAddress,
        pool.assetAddress,
        toSmallestUnit(body.amount, 7)
      );

      return {
        transactionXdr,
        poolId: pool.id,
        amount: body.amount,
        message: 'Sign this transaction with the fund wallet',
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to build deposit transaction' });
    }
  });

  // Confirm deposit after the fund wallet signed and submitted it (verified on-chain, balance re-read from Blend)
  fastify.post('/pools/deposit', async (request, reply) => {
    try {
      return await confirmPoolTx(request, reply, 'deposit');
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to confirm deposit' });
    }
  });

  // Build withdraw transaction (returns XDR for the fund wallet to sign)
  fastify.post('/pools/build-withdraw', async (request, reply) => {
    try {
      const user = requireAuth(request, reply, ['GESTOR']);
      if (!user) return reply;
      const body = buildWithdrawTxSchema.parse(request.body);

      const pool = await loadPool(body.poolId);
      if (!pool) {
        return reply.status(404).send({ error: 'Pool not found' });
      }
      if (pool.status !== 'ACTIVE') {
        return reply.status(400).send({ error: 'Pool is not active' });
      }
      // The pool position belongs to the fund wallet, which holds the investors' USDC
      if (!pool.fund.fundWalletPublicKey || body.userAddress !== pool.fund.fundWalletPublicKey) {
        return reply.status(400).send({ error: 'Connect the fund wallet to move funds in or out of its pool' });
      }

      const transactionXdr = await buildWithdrawTransaction(
        pool.blendPoolAddress,
        body.userAddress,
        pool.assetAddress,
        toSmallestUnit(body.amount, 7)
      );

      return {
        transactionXdr,
        poolId: pool.id,
        amount: body.amount,
        message: 'Sign this transaction with the fund wallet',
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to build withdraw transaction' });
    }
  });

  // Confirm withdraw after the fund wallet signed and submitted it (verified on-chain, balance re-read from Blend)
  fastify.post('/pools/withdraw', async (request, reply) => {
    try {
      return await confirmPoolTx(request, reply, 'withdraw');
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to confirm withdraw' });
    }
  });

  // Refresh balance, yield and APY from the chain (the request body is ignored: values come from Blend)
  fastify.post('/pools/:id/update-yield', async (request, reply) => {
    try {
      const user = requireAuth(request, reply, ['GESTOR']);
      if (!user) return reply;
      const { id } = request.params as { id: string };

      const pool = await loadPool(id);
      if (!pool) {
        return reply.status(404).send({ error: 'Pool not found' });
      }

      const updatedPool = await syncPool(pool);
      return {
        pool: updatedPool,
        yieldEarned: updatedPool.yieldEarned,
        message: 'Yield synced from Blend',
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to update yield' });
    }
  });

  // Get pools by fund
  fastify.get('/funds/:fundId/pools', async (request, reply) => {
    try {
      const { fundId } = request.params as { fundId: string };

      const pools = await fastify.prisma.pool.findMany({
        where: { fundId },
        include: {
          fund: {
            select: {
              id: true,
              name: true,
              symbol: true,
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      // Calculate metrics
      const poolsWithMetrics = pools.map(pool => {
        const currentYield = pool.currentBalance - pool.totalDeposited;
        return {
          ...pool,
          currentYield,
          yieldPercentage: pool.totalDeposited > 0 
            ? (currentYield / pool.totalDeposited) * 100 
            : 0
        };
      });

      return { pools: poolsWithMetrics };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
