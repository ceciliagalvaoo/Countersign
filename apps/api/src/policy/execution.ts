import type { PrismaClient } from '@prisma/client';

/**
 * Closes an execution whose result was unknown (PENDING_NETWORK: the RPC did not answer) once the purchase was
 * verified on-chain (PATCH /api/orders/:id/complete). Moves DecisionExecution from PENDING_NETWORK to CONFIRMED
 * only when `txHash` equals the hash recorded for that execution. Idempotent: an execution already CONFIRMED with
 * the same hash returns ok again. Writes no log row: appendOnchainEvent('subscribe') already records the purchase.
 */
export type MarkResult =
  | { ok: true; status: 'CONFIRMED'; changed: boolean }
  | { ok: false; reason: 'not_found' | 'hash_mismatch' | 'invalid_status'; status?: string };

export async function markExecutionConfirmed(decisionSeq: number, txHash: string, prisma: PrismaClient): Promise<MarkResult> {
  if (!Number.isSafeInteger(decisionSeq) || !/^[0-9a-f]{64}$/i.test(txHash)) return { ok: false, reason: 'not_found' };
  const hash = txHash.toLowerCase();
  const exec = await prisma.decisionExecution.findUnique({ where: { seq: decisionSeq } });
  if (!exec) return { ok: false, reason: 'not_found' };
  if (exec.txHash !== hash) return { ok: false, reason: 'hash_mismatch', status: exec.status };
  if (exec.status === 'CONFIRMED') return { ok: true, status: 'CONFIRMED', changed: false };
  if (exec.status !== 'PENDING_NETWORK') return { ok: false, reason: 'invalid_status', status: exec.status };
  const res = await prisma.decisionExecution.updateMany({
    where: { seq: decisionSeq, status: 'PENDING_NETWORK', txHash: hash },
    data: { status: 'CONFIRMED' },
  });
  if (res.count === 1) return { ok: true, status: 'CONFIRMED', changed: true };
  // Concurrent call confirmed it first
  const now = await prisma.decisionExecution.findUnique({ where: { seq: decisionSeq } });
  return now?.status === 'CONFIRMED' && now.txHash === hash
    ? { ok: true, status: 'CONFIRMED', changed: false }
    : { ok: false, reason: 'invalid_status', status: now?.status };
}
