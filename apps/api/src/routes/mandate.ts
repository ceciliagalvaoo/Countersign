import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireScope } from '../config/auth.js';
import { getChainReader, type ChainReader } from '../policy/chain.js';
import {
  approveMandate,
  getDraft,
  getLatestApproved,
  mandateDraftSchema,
  mandateHash,
  mandateSchema,
  putDraft,
  setLimitsArgs,
  type MandateDraft,
} from '../policy/mandate.js';
import { checkPerimeter, RULES } from '../policy/rules.js';
import { toUnits, unitsToDecimal } from '../policy/canonical.js';

/**
 * Mandate store. The agent (scope "agent") may read and edit the DRAFT only; approving is the investor herself
 * (scope "full"). The mandate becomes active only when the wallet contract's mandate_hash() equals the approved
 * hash, i.e. after she signs set_limits (built by stellar-integrator from `setLimits` below).
 */
export async function mandateRoutes(fastify: FastifyInstance, opts: { chain?: ChainReader }) {
  const chain = () => opts.chain ?? getChainReader();

  const describeDraft = (draft: MandateDraft | null) => {
    const parsed = draft ? mandateSchema.safeParse(draft) : null;
    return {
      draft,
      complete: !!parsed?.success,
      // The hash the investor is shown and must send back to approve (what she sees is what she approves)
      mandateHash: parsed?.success ? mandateHash(parsed.data) : null,
      missing: parsed && !parsed.success ? parsed.error.errors.map((e) => ({ path: e.path.join('.'), message: e.message })) : null,
    };
  };

  async function onChainHash(userId: string): Promise<string | null> {
    try {
      const wallet = await chain().walletFor(userId);
      return wallet ? await chain().mandateHash(wallet) : null;
    } catch {
      return null;
    }
  }

  /** spent_in_period() of her wallet in units; null when there is no wallet or the read fails (never 503) */
  async function onChainSpent(userId: string): Promise<bigint | null> {
    try {
      const wallet = await chain().walletFor(userId);
      return wallet ? await chain().spentInPeriod(wallet) : null;
    } catch {
      return null;
    }
  }

  fastify.get('/', async (request, reply) => {
    const user = requireAuth(request, reply, ['INVESTIDOR']);
    if (!user) return reply;
    const [draft, approved, chainHash, spent] = await Promise.all([
      getDraft(fastify.prisma, user.id),
      getLatestApproved(fastify.prisma, user.id),
      onChainHash(user.id),
      onChainSpent(user.id),
    ]);
    let remaining: bigint | null = null;
    if (approved && spent !== null) {
      const left = toUnits(approved.mandate.periodCapUsdc) - spent;
      remaining = left > 0n ? left : 0n;
    }
    return {
      ...describeDraft(draft),
      approved: approved
        ? {
            version: approved.row.version,
            mandateHash: approved.hash,
            approvedAt: approved.row.approvedAt,
            onChainTxHash: approved.row.onChainTxHash,
            mandate: approved.mandate,
          }
        : null,
      onChainMandateHash: chainHash,
      active: !!approved && chainHash === approved.hash,
      // Read from the wallet contract (no address in the response); null when unavailable
      spentInPeriodUsdc: spent === null ? null : unitsToDecimal(spent),
      periodCapRemainingUsdc: remaining === null ? null : unitsToDecimal(remaining),
    };
  });

  fastify.get('/draft', async (request, reply) => {
    const user = requireAuth(request, reply, ['INVESTIDOR']);
    if (!user) return reply;
    return describeDraft(await getDraft(fastify.prisma, user.id));
  });

  fastify.put('/draft', async (request, reply) => {
    const user = requireAuth(request, reply, ['INVESTIDOR']);
    if (!user) return reply;
    const parsed = mandateDraftSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid mandate draft', details: parsed.error.errors });
    await putDraft(fastify.prisma, user.id, parsed.data);
    return describeDraft(parsed.data);
  });

  // The investor herself only (an agent token gets 403 here and in the authHook)
  fastify.post('/approve', async (request, reply) => {
    const user = requireScope(request, reply, 'full', ['INVESTIDOR']);
    if (!user) return reply;
    const body = z.object({ mandateHash: z.string().regex(/^[0-9a-f]{64}$/) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Send the mandateHash you were shown' });

    const draft = await getDraft(fastify.prisma, user.id);
    const parsed = draft ? mandateSchema.safeParse(draft) : null;
    if (!parsed?.success) {
      return reply.status(400).send({ error: 'The mandate draft is incomplete', details: parsed?.error.errors ?? [] });
    }
    const perimeter = checkPerimeter({ declaredResidences: parsed.data.residences } as Parameters<typeof checkPerimeter>[0]);
    if (perimeter) return reply.status(400).send({ error: perimeter.explanation, rule: RULES.perimeter });

    const hash = mandateHash(parsed.data);
    if (hash !== body.data.mandateHash) {
      return reply.status(409).send({ error: 'The draft changed since you reviewed it; review it again', mandateHash: hash });
    }
    const { row } = await approveMandate(fastify.prisma, user.id, parsed.data);
    return {
      status: 'APPROVED',
      active: false,
      version: row.version,
      mandateHash: hash,
      // Integer units (7 decimals) for set_limits(per_tx_cap, period_cap, period_secs, mandate_hash)
      setLimits: setLimitsArgs(parsed.data, hash),
    };
  });
}
