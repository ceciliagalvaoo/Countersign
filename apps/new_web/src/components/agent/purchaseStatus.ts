import type { AgentSessionView, DecisionLogEntry, PlanNode, Purchase, PurchasesResponse } from '../../types/countersign';
import type { TxView } from '../TxStatus';

/**
 * State of an agent purchase (build line 1.8), derived only from GET /api/mandate-wallet/purchases:
 * the payment verified on-chain by the API (subscribe decoded and checked) and the issuer's verified mint.
 * Never from the agent's words.
 */

export function latestPurchase(r: PurchasesResponse | null): Purchase | null {
  if (!r) return null;
  return [...r.purchases].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
}

export function isInFlight(r: PurchasesResponse | null): boolean {
  if (!r) return false;
  if (r.inFlight.length > 0) return true;
  return r.purchases.some(p => !['completed', 'failed', 'refunded'].includes(purchaseState(p)));
}

const isHash = (value: string | null | undefined): value is string => !!value && /^[0-9a-f]{64}$/i.test(value);

/** Status is the API's persisted verification result, not an inferred hash state:
 * COMPLETED is written only after payment verification, APPROVED after exact mint
 * verification in /orders/:id/approve. A submitted hash alone is never sufficient.
 */
export function purchaseState(p: Purchase) {
  if (p.status === 'FAILED') return 'failed';
  if (!['CONFIRMED_AWAITING_ISSUER', 'COUNTERSIGNED', 'REFUNDED'].includes(p.status) || !isHash(p.subscribeTxHash)) return 'payment_pending';
  if (p.status === 'COUNTERSIGNED') return isHash(p.mintTxHash) ? 'completed' : 'mint_pending';
  if (p.status === 'REFUNDED') return isHash(p.refundTxHash) ? 'refunded' : 'refund_pending';
  return 'awaiting_issuer';
}

/** Bind to this session's exact purchase. A different purchase of the same fund
 * must never complete a new proposal. Multiple available identifiers must agree.
 */
export function planPurchase(plan: AgentSessionView['plan'] | undefined, data: PurchasesResponse | null): Purchase | null {
  const ref = plan?.purchaseRef;
  if (!ref || !data || !(ref.orderId || ref.subscribeTxHash || ref.decision || ref.decisionSeq != null)) return null;
  return data.purchases.find(p =>
    (!plan?.focusFundId || p.fund.id === plan.focusFundId) &&
    (!ref.orderId || p.orderId === ref.orderId) &&
    (!ref.subscribeTxHash || p.subscribeTxHash?.toLowerCase() === ref.subscribeTxHash.toLowerCase()) &&
    (!ref.decision || p.decision?.toLowerCase() === ref.decision.toLowerCase()) &&
    (ref.decisionSeq == null || p.decisionSeq === ref.decisionSeq)) ?? null;
}

/** Live progress is a read-only projection of the same verified purchase used by
 * the purchase card. Conversation/tool snapshots and transcript remain untouched.
 */
export function currentPlanNodes(plan: AgentSessionView['plan'] | undefined, data: PurchasesResponse | null): PlanNode[] {
  const nodes = plan?.nodes ?? [];
  const p = planPurchase(plan, data);
  if (!p) return nodes;
  const state = purchaseState(p);
  const paid = !['payment_pending', 'failed'].includes(state);
  const complete = state === 'completed';
  const rejected = state === 'refunded' || state === 'refund_pending';
  const progress: Record<string, { state: PlanNode['state']; detail: string }> = {
    agent_purchase: { state: state === 'failed' ? 'refused' : paid ? 'done' : 'active',
      detail: state === 'failed' ? 'Payment failed; purchase not completed.' : paid ? `Verified payment: ${p.subscribeTxHash}` : 'Payment verification pending; not confirmed.' },
    issuer_countersign: { state: complete ? 'done' : rejected ? 'refused' : paid ? 'active' : 'pending',
      detail: complete ? `Verified issuer mint: ${p.mintTxHash}` : rejected ? (state === 'refunded' ? 'Issuer rejected the purchase; refund verified.' : 'Issuer rejected the purchase; refund verification pending.') :
        paid ? state === 'mint_pending' ? 'Issuer mint verification pending.' : 'Awaiting issuer countersignature.' : 'Waiting for verified payment.' },
    confirmed: { state: complete ? 'done' : 'pending', detail: complete ? 'Payment and issuer mint verified by the API.' : 'Purchase is not complete until the issuer mint is verified.' },
  };
  return nodes.map(n => {
    const next = progress[n.id];
    if (!next) return n;
    // An interruption blocks new execution, not confirmation of an already executed transaction.
    if (next.state === 'active' && n.state === 'interrupted') return n;
    return { ...n, ...next, rule: null, updatedAt: p.updatedAt };
  });
}

export function purchaseViews(p: Purchase, log: DecisionLogEntry[]): TxView[] {
  const state = purchaseState(p);
  const line =
    (p.decisionSeq != null ? log.find((e) => e.seq === p.decisionSeq) : undefined) ??
    (p.decision ? log.find((e) => e.hash.toLowerCase() === p.decision!.toLowerCase()) : undefined);
  if (state === 'failed') return [{ state: 'failed', message: 'The payment failed; the purchase was not completed.', hash: p.subscribeTxHash ?? undefined }];
  if (state === 'payment_pending') {
    return [{ state: 'pending', hash: p.subscribeTxHash ?? undefined, note: 'Waiting for the ledger to close and the API to verify the payment.' }];
  }
  const confirmed: TxView = {
    state: 'confirmed',
    hash: p.subscribeTxHash!,
    decision: p.decision,
    logSeq: line?.seq ?? p.decisionSeq ?? null,
    logRule: line?.payload.rule ?? null,
  };
  if (state === 'refunded' || state === 'refund_pending') {
    if (state === 'refund_pending') return [confirmed, { state: 'failed', message: 'The issuer rejected the purchase; the refund is not verified yet.' }];
    return [confirmed, { state: 'failed', message: 'The issuer did not mint; the payment was refunded to your mandate wallet.', hash: p.refundTxHash ?? undefined }];
  }
  if (state === 'completed') {
    return [confirmed, { state: 'completed', hash: p.subscribeTxHash!, mintHash: p.mintTxHash }];
  }
  return [confirmed, { state: 'awaiting_issuer' }];
}

/** In flight executions that have no order yet: pending, not done */
export function inFlightViews(r: PurchasesResponse | null): TxView[] {
  if (!r) return [];
  return r.inFlight.map((f) => ({ state: 'pending', note: `Decision #${f.decisionSeq}: submitted by the agent (${f.executionStatus.toLowerCase()}), not confirmed.` }));
}
