import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireScope } from '../config/auth.js';
import { bindAgentSigner } from '../agentSigner/index.js';
import { bindDecisionLog } from '../policy/decisionLog.js';
import { isTxHash } from '../services/stellarVerify.js';
import {
  bindMandateWallet,
  buildDeploy,
  buildDeposit,
  buildOwnerCall,
  confirmDeploy,
  confirmDeposit,
  confirmOwnerCall,
  decodeInvocation,
  listPurchases,
  MandateWalletError,
  OWNER_METHODS,
  readWalletState,
} from '../services/mandateWallet.js';

/**
 * Mandate wallet routes (stellar-integrator). Registered with prefix /api:
 *   POST /mandate-wallet/build-deploy     deploy of her wallet, signed by her (owner)
 *   POST /mandate-wallet/confirm          verified deploy, read back from the contract, then stored
 *   GET  /mandate-wallet                  state read from the chain
 *   POST /mandate-wallet/build-call       owner call (transactionXdr and decoded, for the WYSIWYS card)
 *   POST /mandate-wallet/confirm-call     verified owner call
 *   POST /mandate-wallet/build-deposit    USDC from her account to the wallet (SAC transfer)
 *   POST /mandate-wallet/confirm-deposit  verified deposit
 *   GET  /mandate-wallet/purchases        status of purchases made by the agent (confirmation screen)
 *   POST /tx/decode                       decoder of any single contract call envelope
 * Every route is the investor herself (scope "full"): an agent token gets 403 in the authHook and here.
 */

const txHash = z.string().refine(isTxHash, 'Invalid transaction hash');
const usdc = z.string().regex(/^(0|[1-9]\d*)(\.\d{1,7})?$/, 'USDC amount with at most 7 decimals');
const ownerParams = z
  .object({
    fundId: z.string().min(1).optional(),
    fundCapUsdc: usdc.optional(),
    amountUsdc: usdc.optional(),
    units: usdc.optional(),
  })
  .strict()
  .default({});

function fail(reply: FastifyReply, error: unknown, log: (e: unknown) => void) {
  if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Invalid input', details: error.errors });
  if (error instanceof MandateWalletError) {
    return reply.status(error.status).send({ error: error.message, ...(error.details ? { details: error.details } : {}) });
  }
  const msg = (error as Error)?.message ?? '';
  // Simulation errors from prepareTransaction: the contract (or the network) would refuse this call
  if (/HostError|Error\(Contract|simulat/i.test(msg)) {
    const code = /Error\(Contract, #(\d+)\)/.exec(msg)?.[1];
    return reply.status(400).send({ error: 'The network simulation refused this transaction', ...(code ? { contractError: Number(code) } : {}) });
  }
  log(error);
  return reply.status(500).send({ error: 'Internal server error' });
}

export async function mandateWalletRoutes(fastify: FastifyInstance) {
  bindMandateWallet(fastify.prisma);
  bindAgentSigner(fastify.prisma);
  bindDecisionLog(fastify.prisma);
  const log = (e: unknown) => fastify.log.error(e);

  fastify.post('/mandate-wallet/build-deploy', async (request, reply) => {
    const user = requireScope(request, reply, 'full', ['INVESTIDOR']);
    if (!user) return reply;
    try {
      const body = z
        .object({
          ownerPublicKey: z.string(),
          limits: z.object({ perTxCapUsdc: usdc, periodCapUsdc: usdc, periodDays: z.number().int() }).optional(),
        })
        .parse(request.body);
      return await buildDeploy(user.id, body.ownerPublicKey, body.limits);
    } catch (e) {
      return fail(reply, e, log);
    }
  });

  fastify.post('/mandate-wallet/confirm', async (request, reply) => {
    const user = requireScope(request, reply, 'full', ['INVESTIDOR']);
    if (!user) return reply;
    try {
      const body = z.object({ txHash }).parse(request.body);
      return await confirmDeploy(user.id, body.txHash);
    } catch (e) {
      return fail(reply, e, log);
    }
  });

  fastify.get('/mandate-wallet', async (request, reply) => {
    const user = requireScope(request, reply, 'full', ['INVESTIDOR']);
    if (!user) return reply;
    try {
      return await readWalletState(user.id);
    } catch (e) {
      return fail(reply, e, log);
    }
  });

  fastify.get('/mandate-wallet/purchases', async (request, reply) => {
    const user = requireScope(request, reply, 'full', ['INVESTIDOR']);
    if (!user) return reply;
    try {
      return await listPurchases(user.id);
    } catch (e) {
      return fail(reply, e, log);
    }
  });

  fastify.post('/mandate-wallet/build-call', async (request, reply) => {
    const user = requireScope(request, reply, 'full', ['INVESTIDOR']);
    if (!user) return reply;
    try {
      const body = z.object({ method: z.enum(OWNER_METHODS), params: ownerParams }).parse(request.body);
      return await buildOwnerCall(user.id, body.method, body.params);
    } catch (e) {
      return fail(reply, e, log);
    }
  });

  fastify.post('/mandate-wallet/confirm-call', async (request, reply) => {
    const user = requireScope(request, reply, 'full', ['INVESTIDOR']);
    if (!user) return reply;
    try {
      const body = z.object({ txHash, method: z.enum(OWNER_METHODS), params: ownerParams }).parse(request.body);
      return await confirmOwnerCall(user.id, body.txHash, body.method, body.params);
    } catch (e) {
      return fail(reply, e, log);
    }
  });

  fastify.post('/mandate-wallet/build-deposit', async (request, reply) => {
    const user = requireScope(request, reply, 'full', ['INVESTIDOR']);
    if (!user) return reply;
    try {
      const body = z.object({ amountUsdc: usdc }).parse(request.body);
      return await buildDeposit(user.id, body.amountUsdc);
    } catch (e) {
      return fail(reply, e, log);
    }
  });

  fastify.post('/mandate-wallet/confirm-deposit', async (request, reply) => {
    const user = requireScope(request, reply, 'full', ['INVESTIDOR']);
    if (!user) return reply;
    try {
      const body = z.object({ txHash, amountUsdc: usdc }).parse(request.body);
      return await confirmDeposit(user.id, body.txHash, body.amountUsdc);
    } catch (e) {
      return fail(reply, e, log);
    }
  });

  // Decoder for the WYSIWYS card: what the card shows comes from the XDR, plus the network added out of band
  fastify.post('/tx/decode', async (request, reply) => {
    const user = requireScope(request, reply, 'full', ['INVESTIDOR', 'GESTOR']);
    if (!user) return reply;
    try {
      const body = z.object({ transactionXdr: z.string().min(1).max(100_000) }).parse(request.body);
      return { decoded: await decodeInvocation(body.transactionXdr, { userId: user.role === 'INVESTIDOR' ? user.id : null }) };
    } catch (e) {
      return fail(reply, e, log);
    }
  });
}
