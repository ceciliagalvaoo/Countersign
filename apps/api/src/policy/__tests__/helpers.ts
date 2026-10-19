import crypto from 'crypto';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import * as Sdk from '@stellar/stellar-sdk';
import { PrismaClient } from '@prisma/client';
import { authHook } from '../../config/auth.js';
import { agentRoutes } from '../../routes/agent.js';
import { mandateRoutes } from '../../routes/mandate.js';
import { fundRoutes } from '../../routes/fund.js';
import { userRoutes } from '../../routes/users.js';
import { orderRoutes } from '../../routes/order.js';
import type { ChainReader } from '../chain.js';
import type { Mandate } from '../schema.js';

export const prisma = new PrismaClient();

export const randomG = () => Sdk.Keypair.random().publicKey();
export const randomC = () => Sdk.StrKey.encodeContract(crypto.randomBytes(32));

/** Wipes the tables these tests use (the append-only trigger is disabled only for the wipe) */
export async function resetDb() {
  await prisma.$executeRawUnsafe('ALTER TABLE decision_logs DISABLE TRIGGER USER');
  await prisma.$executeRawUnsafe(
    'TRUNCATE decision_logs, decision_executions, agent_keys, mandates, fund_interactions, orders, funds, users RESTART IDENTITY CASCADE'
  );
  await prisma.$executeRawUnsafe('ALTER TABLE decision_logs ENABLE TRIGGER USER');
}

export class FakeChain implements ChainReader {
  wallets = new Map<string, string>();
  hashes = new Map<string, string>();
  owners = new Map<string, string>();
  spent = new Map<string, bigint>();
  allow = new Map<string, Set<string>>();
  badges = new Map<string, number>();
  revoked = new Set<string>();
  async isRevoked(wallet: string) {
    return this.revoked.has(wallet);
  }
  async walletFor(userId: string) {
    return this.wallets.get(userId) ?? null;
  }
  async mandateHash(wallet: string) {
    return this.hashes.get(wallet) ?? '0'.repeat(64);
  }
  async owner(wallet: string) {
    return this.owners.get(wallet) ?? randomG();
  }
  async spentInPeriod(wallet: string) {
    return this.spent.get(wallet) ?? 0n;
  }
  async fundAllowed(wallet: string, fundWallet: string) {
    return this.allow.get(wallet)?.has(fundWallet) ?? false;
  }
  async badgeThresholdCents(owner: string) {
    return this.badges.get(owner) ?? null;
  }
}

export async function buildApp(chain: ChainReader, executeSubscription?: (seq: number) => Promise<{ txHash: string }>) {
  const app = Fastify({ logger: false });
  app.decorate('prisma', prisma);
  app.addHook('onRequest', authHook);
  await app.register(fundRoutes, { prefix: '/api/funds' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(orderRoutes, { prefix: '/api/orders' });
  await app.register(agentRoutes, { prefix: '/api', chain, executeSubscription });
  await app.register(mandateRoutes, { prefix: '/api/mandates', chain });
  await app.ready();
  return app;
}

export async function createUser(role: 'INVESTIDOR' | 'GESTOR' = 'INVESTIDOR') {
  const user = await prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${crypto.randomBytes(4).toString('hex')}@test.local`,
      password: 'not-used',
      role,
      status: 'APPROVED',
      publicKey: randomG(),
    },
  });
  // Same claims and secret as POST /api/auth/login (full scope)
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '24h' });
  return { user, token };
}

export async function createFund(over: Partial<Parameters<typeof prisma.fund.create>[0]['data']> = {}) {
  return prisma.fund.create({
    data: {
      name: 'Agri Receivables I',
      symbol: 'AGR' + crypto.randomBytes(3).toString('hex').toUpperCase(),
      maxSupply: 1_000_000,
      status: 'APPROVED',
      tokenContractId: randomC(),
      fundWalletPublicKey: randomG(),
      sector: 'AGRO',
      riskLevel: 'MEDIO',
      investorProfile: 'GERAL',
      liquidityType: 'ABERTO',
      lockupDays: 0,
      ...over,
    },
  });
}

export const baseMandate = (over: Partial<Mandate> = {}): Mandate => ({
  residences: ['DE'],
  horizonMonths: 24,
  liquidityNeedPct: 20,
  liquidityWithinMonths: 6,
  maxLossTolerance: 'MEDIUM',
  totalAmountUsdc: '1000',
  perPurchaseCapUsdc: '300',
  periodCapUsdc: '500',
  periodDays: 30,
  allowedSectors: ['AGRO', 'VAREJO'],
  maxPerSectorPct: 60,
  ...over,
});

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });
