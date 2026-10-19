import type { FastifyInstance } from 'fastify';
import { AGENT_TOKEN_TTL_SECONDS, requireAuth, requireScope, signAgentToken } from '../config/auth.js';
import { executeSubscription as defaultExecute } from '../services/mandateWallet.js';
import { bindAgentSigner } from '../agentSigner/index.js';
import { getChainReader, type ChainReader } from '../policy/chain.js';
import { unitsToDecimal } from '../policy/canonical.js';
import { appendEntry, bindDecisionLog, getEntry, listForUser, verifyChain, type LogPayload } from '../policy/decisionLog.js';
import { buildContext, checkFundEligibility, proposeSubscription } from '../policy/engine.js';
import { DECISION_TTL_MS, evaluate, RULES } from '../policy/rules.js';
import { proposalSchema } from '../policy/schema.js';

/**
 * Agent facing routes of the L1 policy (our server, separate process from the language model):
 *   POST /api/agent/session-token          investor (full scope) mints a 1 h token with scope "agent"
 *   POST /api/agent/proposals              evaluate a purchase proposal, write one chained log row
 *   POST /api/agent/proposals/:seq/execute execute an APPROVED decision once (executeSubscription)
 *   GET  /api/agent/eligibility/:fundId    eligibility rule only, returns eligible true or false
 *   GET  /api/decision-log                 the investor's own rows
 *   GET  /api/decision-log/verify          recompute the whole chain, first divergent row
 */

/** Shape of ContractRefusedError.refusal from services/mandateWallet.ts (read by name, not by class) */
interface Refusal {
  stage: 'simulation' | 'submission' | 'ledger' | 'expired';
  code: number | null;
  errorName: string | null;
  txHash: string | null;
}

type Execute = (decisionSeq: number) => Promise<{ txHash: string }>;

// Executions are serialized per investor wallet (single API process), so two approved proposals cannot race
// past the period cap; the contract still refuses an overspend, and that refusal is recorded.
const walletQueues = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = walletQueues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(job);
  walletQueues.set(key, next);
  next.finally(() => {
    if (walletQueues.get(key) === next) walletQueues.delete(key);
  }).catch(() => undefined);
  return next;
}

export async function agentRoutes(fastify: FastifyInstance, opts: { chain?: ChainReader; executeSubscription?: Execute }) {
  bindDecisionLog(fastify.prisma);
  bindAgentSigner(fastify.prisma);
  const chain = () => opts.chain ?? getChainReader();
  const execute: Execute = opts.executeSubscription ?? defaultExecute;

  fastify.post('/agent/session-token', async (request, reply) => {
    const user = requireScope(request, reply, 'full', ['INVESTIDOR']);
    if (!user) return reply;
    return { token: signAgentToken(user), scope: 'agent', expiresIn: AGENT_TOKEN_TTL_SECONDS, userId: user.id };
  });

  fastify.post('/agent/proposals', async (request, reply) => {
    const user = requireAuth(request, reply, ['INVESTIDOR']);
    if (!user) return reply;
    // One proposal per call: no batch, no array
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
      return reply.status(400).send({ error: 'Send exactly one proposal object' });
    }
    const parsed = proposalSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid proposal', details: parsed.error.errors });
    try {
      const { decision, seq, hash } = await proposeSubscription(fastify.prisma, user.id, parsed.data, chain());
      return {
        outcome: decision.outcome,
        rule: decision.rule,
        seq,
        hash,
        explanation: decision.explanation,
        ...(decision.howToProve ? { howToProve: decision.howToProve } : {}),
      };
    } catch (e) {
      fastify.log.error(e);
      return reply.status(503).send({ error: 'The policy could not read the data it needs; nothing was decided' });
    }
  });

  fastify.post('/agent/proposals/:seq/execute', async (request, reply) => {
    const user = requireAuth(request, reply, ['INVESTIDOR']);
    if (!user) return reply;
    const seq = Number((request.params as { seq: string }).seq);
    if (!Number.isSafeInteger(seq) || seq < 1) return reply.status(400).send({ error: 'Invalid decision' });

    const entry = await getEntry(seq, fastify.prisma);
    if (!entry || entry.userId !== user.id) return reply.status(404).send({ error: 'Decision not found' });
    const p = entry.payload;
    if (p.kind !== 'decision' || p.outcome !== 'APPROVED' || p.rule !== RULES.approved) {
      return reply.status(409).send({ error: 'Only an APPROVED decision can be executed', outcome: p.outcome, rule: p.rule });
    }

    return serialize(user.id, async () => {
      // Claim the decision: the primary key on seq makes a second execution impossible
      const existing = await fastify.prisma.decisionExecution.findUnique({ where: { seq } });
      if (existing?.status === 'EXPIRED') {
        return reply.status(409).send({ error: 'This decision expired; make a new proposal', rule: RULES.decisionExpired });
      }
      if (existing?.status === 'REFUSED') {
        // The wallet contract or the network already said no: a new attempt needs a new proposal
        return reply.status(409).send({ error: 'The contract refused this decision; make a new proposal', status: existing.status, txHash: existing.txHash });
      }
      if (existing && existing.status !== 'FAILED') {
        return reply.status(409).send({ error: 'This decision was already executed', status: existing.status, txHash: existing.txHash });
      }
      if (existing) {
        const reclaimed = await fastify.prisma.decisionExecution.updateMany({ where: { seq, status: 'FAILED' }, data: { status: 'PENDING', error: null } });
        if (reclaimed.count !== 1) return reply.status(409).send({ error: 'This decision is being executed' });
      } else {
        try {
          await fastify.prisma.decisionExecution.create({ data: { seq, userId: user.id, status: 'PENDING' } });
        } catch {
          return reply.status(409).send({ error: 'This decision is being executed' });
        }
      }

      const logRow = (rule: string, outcome: string, extra: Partial<LogPayload> = {}) =>
        appendEntry(
          {
            ...extra,
            kind: 'decision',
            userId: user.id,
            origin: p.origin,
            fundId: p.fundId,
            amountUnits: p.amountUnits,
            rule,
            outcome,
            mandateHash: p.mandateHash,
            toolCallId: p.toolCallId,
          },
          fastify.prisma
        );
      const fail = async (error: string) =>
        fastify.prisma.decisionExecution.update({ where: { seq }, data: { status: 'FAILED', error: error.slice(0, 500) } });

      // An APPROVED decision is valid for DECISION_TTL_MS: after that it is final and needs a new proposal
      if (Date.now() - Date.parse(p.at) > DECISION_TTL_MS) {
        await fastify.prisma.decisionExecution.update({ where: { seq }, data: { status: 'EXPIRED', error: 'decision expired' } });
        const row = await logRow(RULES.decisionExpired, 'REJECTED');
        return reply.status(409).send({
          outcome: 'REJECTED',
          rule: RULES.decisionExpired,
          seq: row.seq,
          hash: row.hash,
          explanation: `An approved decision is valid for ${DECISION_TTL_MS / 60000} minutes; make a new proposal.`,
        });
      }

      // Re-evaluate everything against the current state right before executing
      try {
        const recheck = await recheckBeforeExecute(user.id, p);
        if (recheck) {
          const row = await logRow(recheck.rule, 'REJECTED');
          await fail(recheck.explanation);
          return reply.status(409).send({ outcome: 'REJECTED', rule: recheck.rule, seq: row.seq, hash: row.hash, explanation: recheck.explanation });
        }
      } catch (e) {
        await fail('chain read failed before execution');
        fastify.log.error(e);
        return reply.status(503).send({ error: 'Could not read the wallet contract; nothing was executed' });
      }

      try {
        const { txHash } = await execute(seq);
        await fastify.prisma.decisionExecution.update({ where: { seq }, data: { status: 'CONFIRMED', txHash } });
        return { status: 'CONFIRMED', seq, decision: entry.hash, txHash };
      } catch (e) {
        const err = e as Error & { refusal?: Refusal; status?: number; txHash?: string | null; orderId?: string | null };
        if (err.name === 'RpcUnavailableError') {
          // The RPC did not answer: the result is UNKNOWN, not a failure. The reserved order stays PENDING and is
          // verified later (PATCH /api/orders/:id/complete); this decision cannot be executed again.
          const txHash = err.txHash && /^[0-9a-f]{64}$/i.test(err.txHash) ? err.txHash.toLowerCase() : undefined;
          await fastify.prisma.decisionExecution.update({
            where: { seq },
            data: { status: 'PENDING_NETWORK', txHash: txHash ?? null, error: (err.orderId ? `orderId=${err.orderId}; ` : '') + err.message.slice(0, 400) },
          });
          const row = await logRow('execution_pending_network', 'PENDING', { txHash });
          return reply.status(202).send({
            status: 'PENDING_NETWORK',
            message: 'pending, not done: the network did not answer; the purchase will be verified later',
            txHash: txHash ?? null,
            orderId: err.orderId ?? null,
            seq: row.seq,
            hash: row.hash,
          });
        }
        if (err.name === 'ContractRefusedError' && err.refusal) {
          const r = err.refusal;
          // Retry only when nothing reached the ledger and the contract did not answer: expired, or a submission
          // rejected without a transaction hash. A contract error (simulation or FAILED in the ledger) is final.
          const retryable = r.code === null && !r.txHash && (r.stage === 'expired' || r.stage === 'submission');
          const txHash = r.txHash && /^[0-9a-f]{64}$/i.test(r.txHash) ? r.txHash.toLowerCase() : undefined;
          await fastify.prisma.decisionExecution.update({
            where: { seq },
            data: { status: retryable ? 'FAILED' : 'REFUSED', txHash: txHash ?? null, error: err.message.slice(0, 500) },
          });
          const row = await logRow('execution_failed', 'FAILED', {
            txHash,
            failureStage: r.stage,
            ...(r.code !== null ? { errorCode: r.code } : {}),
            ...(r.errorName ? { errorName: r.errorName } : {}),
          });
          return reply.status(retryable ? 503 : 409).send({
            outcome: 'FAILED',
            rule: 'execution_failed',
            retryable,
            stage: r.stage,
            errorCode: r.code,
            errorName: r.errorName,
            txHash: txHash ?? null,
            seq: row.seq,
            hash: row.hash,
          });
        }
        await fail(err.message);
        if (err.name === 'NotImplementedError') return reply.status(501).send({ error: err.message });
        if (err.name === 'MandateWalletError') return reply.status(err.status ?? 400).send({ error: err.message });
        // A refusal by the signer or the contract is recorded, never hidden
        const row = err.name === 'SignerRefusedError' ? null : await logRow('execution_failed', 'FAILED');
        return reply.status(502).send({ error: 'Execution failed', reason: err.message, ...(row ? { seq: row.seq, hash: row.hash } : {}) });
      }
    });
  });

  /**
   * Re-evaluates the whole proposal against the current state (perimeter, mandate, fund, eligibility, caps with
   * the period spent read again, sector, risk, liquidity, recurring, on-chain allowlist) and then is_revoked.
   * The untrusted text rule is a property of the original request, which passed; it is rebuilt with no extra field.
   */
  async function recheckBeforeExecute(userId: string, p: LogPayload): Promise<{ rule: string; explanation: string } | null> {
    const { ctx, wallet } = await buildContext(
      fastify.prisma,
      userId,
      {
        fundId: p.fundId!,
        amountUsdc: unitsToDecimal(BigInt(p.amountUnits)),
        amountSource: p.origin === 'recurring' ? 'mandate' : 'investor_message',
        origin: p.origin as 'chat' | 'recurring',
        toolCallId: p.toolCallId ?? 'recheck',
      },
      chain()
    );
    const now = evaluate(ctx);
    if (now.outcome !== 'APPROVED') return { rule: now.rule, explanation: now.explanation };
    if (ctx.approvedHash !== p.mandateHash) {
      return { rule: RULES.mandateNotActive, explanation: 'The mandate changed since this decision; a new proposal is required.' };
    }
    if (await chain().isRevoked(wallet!)) {
      return { rule: RULES.agentRevoked, explanation: 'The investor revoked the agent in her wallet contract; nothing was built or signed.' };
    }
    return null;
  }

  fastify.get('/agent/eligibility/:fundId', async (request, reply) => {
    const user = requireAuth(request, reply, ['INVESTIDOR']);
    if (!user) return reply;
    const { fundId } = request.params as { fundId: string };
    try {
      const result = await checkFundEligibility(fastify.prisma, user.id, fundId, chain());
      if (!result) return reply.status(404).send({ error: 'Fund not found' });
      return result;
    } catch (e) {
      fastify.log.error(e);
      return reply.status(503).send({ error: 'Could not read the on-chain badge' });
    }
  });

  fastify.get('/decision-log', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return reply;
    const limit = Math.min(Math.max(Number((request.query as { limit?: string }).limit) || 200, 1), 1000);
    return { entries: await listForUser(user.id, limit, fastify.prisma) };
  });

  fastify.get('/decision-log/verify', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return reply;
    return verifyChain(fastify.prisma);
  });
}
