// Must be the first import: loads .env before any other module reads process.env
import { PORT, CORS_ORIGIN } from './config/env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { authHook } from './config/auth.js';
import { PrismaClient } from '@prisma/client';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { cedenteRoutes } from './routes/cedente.js';
import { sacadoRoutes } from './routes/sacado.js';
import { fundRoutes } from './routes/fund.js';
import { receivableRoutes } from './routes/receivable.js';
import { orderRoutes } from './routes/order.js';
import { stellarRoutes } from './routes/stellar.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { poolRoutes } from './routes/pool.js';
import { badgeRoutes } from './routes/badge.js';
import { multisigRoutes } from './routes/multisig.js';
import recommendationRoutes from './routes/recommendation.js';
import fundInteractionRoutes from './routes/fundInteraction.js';
import { agentRoutes } from './routes/agent.js';
import { mandateRoutes } from './routes/mandate.js';
import { mandateWalletRoutes } from './routes/mandateWallet.js';
import { checkConfiguredContracts } from './services/stellarHealth.js';

const prisma = new PrismaClient();

const fastify = Fastify({
  logger: true,
  // Behind a hosting proxy (Render, Railway...) use the client IP from X-Forwarded-For, so rate limits are per user
  trustProxy: process.env.TRUST_PROXY !== 'false',
});

// Register CORS
await fastify.register(cors, {
  origin: CORS_ORIGIN.includes('*') ? true : CORS_ORIGIN,
  credentials: true,
  // The plugin default is GET, HEAD and POST only; approvals and order steps use PATCH, PUT and DELETE
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
});

// Basic abuse protection; auth routes get a stricter limit below
await fastify.register(rateLimit, { max: 300, timeWindow: '1 minute' });

// Decode the JWT (when present) for every request; invalid tokens get 401
fastify.addHook('onRequest', authHook);

// Make prisma available throughout the app
fastify.decorate('prisma', prisma);

// Register routes
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(userRoutes, { prefix: '/api/users' });
await fastify.register(cedenteRoutes, { prefix: '/api/cedentes' });
await fastify.register(sacadoRoutes, { prefix: '/api/sacados' });
await fastify.register(fundRoutes, { prefix: '/api/funds' });
await fastify.register(receivableRoutes, { prefix: '/api/receivables' });
await fastify.register(orderRoutes, { prefix: '/api/orders' });
await fastify.register(stellarRoutes, { prefix: '/api/stellar' });
await fastify.register(dashboardRoutes, { prefix: '/api/dashboard' });
await fastify.register(poolRoutes, { prefix: '/api' });
await fastify.register(badgeRoutes, { prefix: '/api/badges' });
await fastify.register(multisigRoutes, { prefix: '/api/multisig' });
await fastify.register(recommendationRoutes, { prefix: '/api' });
await fastify.register(fundInteractionRoutes, { prefix: '/api' });
// Countersign policy (policy-guard): agent token, proposals, decision log, mandate store
await fastify.register(agentRoutes, { prefix: '/api' });
await fastify.register(mandateRoutes, { prefix: '/api/mandates' });
// Countersign mandate wallet (stellar-integrator): deploy, owner calls, deposit, decoder, purchase status
await fastify.register(mandateWalletRoutes, { prefix: '/api' });

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Graceful shutdown
const gracefulShutdown = async () => {
  await prisma.$disconnect();
  await fastify.close();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    // Non-blocking: only logs warnings
    checkConfiguredContracts(fastify.log).catch((err) => fastify.log.warn(err));
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();