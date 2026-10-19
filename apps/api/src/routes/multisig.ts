import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../config/auth.js';
import { loadSignerSet, mergeSignatures, signedWeight, submitSigned } from '../services/multisig.js';

export async function multisigRoutes(fastify: FastifyInstance, overrides: Partial<{
  loadSignerSet: typeof loadSignerSet; mergeSignatures: typeof mergeSignatures; submitSigned: typeof submitSigned;
}> = {}) {
  const service = { loadSignerSet, mergeSignatures, submitSigned, ...overrides };
  // Pending multisig transactions (what still needs signatures)
  fastify.get('/pending', async (request, reply) => {
    try {
      const user = requireAuth(request, reply, ['GESTOR']);
      if (!user) return reply;
      const pending = await fastify.prisma.multisigTransaction.findMany({
        where: { status: 'PENDING', expiresAt: { gt: new Date() } },
        select: { id: true, purpose: true, account: true, signedBy: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      return { pending };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to list pending transactions' });
    }
  });

  // A signer adds their signature (the transaction signed in their wallet, not submitted). Submits at the threshold.
  fastify.post('/:id/sign', async (request, reply) => {
    try {
      const user = requireAuth(request, reply, ['GESTOR']);
      if (!user) return reply;
      const { id } = request.params as { id: string };
      const { signedXdr } = z.object({ signedXdr: z.string().min(1) }).parse(request.body);

      const pending = await fastify.prisma.multisigTransaction.findUnique({ where: { id } });
      if (!pending || !['PENDING', 'SUBMITTED'].includes(pending.status)) {
        return reply.status(404).send({ error: 'No pending transaction with this id' });
      }
      const set = await service.loadSignerSet(pending.account);
      if (pending.status === 'SUBMITTED') return { submitted: true, txHash: pending.txHash,
        signedBy: pending.signedBy, weight: signedWeight(set, pending.signedBy), threshold: set.threshold };
      if (pending.expiresAt <= new Date()) {
        await fastify.prisma.multisigTransaction.update({ where: { id }, data: { status: 'EXPIRED' } });
        return reply.status(409).send({ error: 'The transaction expired; start the step again to get a new one' });
      }

      let merged;
      try {
        merged = service.mergeSignatures(pending.xdr, signedXdr, set);
      } catch (e) {
        return reply.status(400).send({ error: (e as Error).message });
      }
      if (!merged.signedBy.length) {
        return reply.status(400).send({ error: "No valid signature from one of the account's signers" });
      }

      if (merged.weight < set.threshold) {
        await fastify.prisma.multisigTransaction.update({
          where: { id },
          data: { xdr: merged.xdr, signedBy: merged.signedBy },
        });
        return { submitted: false, signedBy: merged.signedBy, weight: merged.weight, threshold: set.threshold };
      }

      // Keep all validated signatures even if the submission response is lost.
      await fastify.prisma.multisigTransaction.update({ where: { id }, data: { xdr: merged.xdr, signedBy: merged.signedBy } });
      const result = await service.submitSigned(merged.xdr);
      if (!result.ok) {
        await fastify.prisma.multisigTransaction.update({
          where: { id },
          data: { xdr: merged.xdr, signedBy: merged.signedBy, ...(result.expired && { status: 'EXPIRED' }) },
        });
        return reply.status(result.expired ? 409 : 502).send({
          error: result.expired ? 'The transaction can no longer be submitted; start the step again' : 'Submission failed',
          reason: result.reason,
        });
      }

      await fastify.prisma.multisigTransaction.update({
        where: { id },
        data: { xdr: merged.xdr, signedBy: merged.signedBy, status: 'SUBMITTED' },
      });
      return {
        submitted: true,
        txHash: result.hash,
        signedBy: merged.signedBy,
        weight: signedWeight(set, merged.signedBy),
        threshold: set.threshold,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Failed to add signature' });
    }
  });
}
