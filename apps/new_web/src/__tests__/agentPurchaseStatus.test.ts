import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentSessionView, Purchase, PurchasesResponse } from '../types/countersign';
import { currentPlanNodes, isInFlight, planPurchase, purchaseState, purchaseViews } from '../components/agent/purchaseStatus';
import PlanDag from '../components/agent/PlanDag';
import TxStatus from '../components/TxStatus';
// Exercise the agent's public view without importing its project into the web build.
const { newPlan, planView } = require('../../../agent/src/plan/dag.ts');

const payment = 'a'.repeat(64), mint = 'b'.repeat(64), decision = 'c'.repeat(64);
const purchase = (patch: Partial<Purchase> = {}): Purchase => ({
  orderId: 'order5', status: 'CONFIRMED_AWAITING_ISSUER', decision, decisionSeq: 5,
  fund: { id: 'fund', name: 'CSAGRI', symbol: 'CSAGRI' }, amountUsdc: '5', units: '5',
  payer: 'mandate-wallet', subscribeTxHash: payment, mintTxHash: null, refundTxHash: null,
  createdAt: '2026-10-18T14:52:00Z', updatedAt: '2026-10-18T14:52:00Z', ...patch,
});
const response = (...purchases: Purchase[]): PurchasesResponse => ({ network: 'Stellar testnet', inFlight: [], purchases });
function historicalPlan(): AgentSessionView['plan'] {
  const stored = newPlan();
  // Exact shape of legacy sessions: no execution order/hash, but the policy decision is known.
  stored.focus = { fundId: 'fund', decisionSeq: 5, proposedAt: '2026-10-18T14:51:00Z' };
  for (const n of stored.nodes) n.state = n.id === 'issuer_countersign' ? 'active' : n.id === 'confirmed' ? 'pending' : 'done';
  return planView(stored);
}
const states = (plan: AgentSessionView['plan'], data: PurchasesResponse | null) =>
  Object.fromEntries(currentPlanNodes(plan, data).map(n => [n.id, n.state]));
function panels(plan: AgentSessionView['plan'], data: PurchasesResponse) {
  const matched = planPurchase(plan, data)!;
  return renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(PlanDag, { nodes: currentPlanNodes(plan, data), interrupted: false, available: true, busy: false,
      onInterrupt: () => {}, onResume: () => {} }),
    React.createElement('section', { 'aria-label': 'Latest purchase' }, purchaseViews(matched, []).map((v, i) =>
      React.createElement(TxStatus, { key: i, view: v, title: i === 0 ? 'Agent payment' : 'Issuer' })))));
}

test('verified payment preserves awaiting issuer and waiting final confirmation in both panels', () => {
  const plan = historicalPlan(), data = response(purchase());
  assert.deepEqual(purchaseViews(data.purchases[0], []).map(v => v.state), ['confirmed', 'awaiting_issuer']);
  assert.equal(states(plan, data).agent_purchase, 'done');
  assert.equal(states(plan, data).issuer_countersign, 'active');
  assert.equal(states(plan, data).confirmed, 'pending');
  assert.ok(isInFlight(data));
  const html = panels(plan, data);
  assert.ok(html.includes('data-node="issuer_countersign" data-state="active"'));
  assert.ok(html.includes('awaiting issuer countersignature'));
});

test('later verified mint updates card and live Plan without rewriting the conversation snapshot', () => {
  const plan = historicalPlan(), before = JSON.stringify(plan);
  const completed = response(purchase({ status: 'COUNTERSIGNED', mintTxHash: mint }));
  assert.deepEqual(purchaseViews(completed.purchases[0], []).map(v => v.state), ['confirmed', 'completed']);
  assert.equal(states(plan, completed).issuer_countersign, 'done');
  assert.equal(states(plan, completed).confirmed, 'done');
  assert.equal(JSON.stringify(plan), before, 'do not mutate historical conversation/plan');
  assert.equal(isInFlight(completed), false);
  const html = panels(plan, completed);
  assert.ok(html.includes('data-node="issuer_countersign" data-state="done"'));
  assert.ok(html.includes('data-node="confirmed" data-state="done"'));
  assert.ok(html.includes('countersigned') && html.includes('completed'));
  assert.ok(!html.includes('awaiting issuer countersignature'));
});

test('reload of a legacy saved plan reconciles the exact decision with persisted final purchase', () => {
  const plan = JSON.parse(JSON.stringify(historicalPlan()));
  const data = JSON.parse(JSON.stringify(response(purchase({ status: 'COUNTERSIGNED', mintTxHash: mint }))));
  assert.equal(plan.purchaseRef.decisionSeq, 5);
  assert.equal(planPurchase(plan, data)?.orderId, 'order5');
  assert.equal(states(plan, data).confirmed, 'done');
});

test('submitted hashes, missing mint and failed payment cannot show a completed purchase', () => {
  for (const p of [
    purchase({ status: 'PENDING_NETWORK', mintTxHash: mint }),
    purchase({ mintTxHash: mint }), // hash exists, but issuer confirmation has not been verified
    purchase({ status: 'COUNTERSIGNED' }),
    purchase({ status: 'COUNTERSIGNED', mintTxHash: 'not-a-confirmed-hash' }),
    purchase({ status: 'COUNTERSIGNED', mintTxHash: mint, subscribeTxHash: null }),
    purchase({ status: 'FAILED', mintTxHash: mint }),
  ]) {
    assert.ok(!purchaseViews(p, []).some(v => v.state === 'completed'));
    assert.notEqual(states(historicalPlan(), response(p)).confirmed, 'done');
  }
  const failed = purchase({ status: 'FAILED' });
  assert.equal(purchaseViews(failed, [])[0].state, 'failed');
  assert.equal(states(historicalPlan(), response(failed)).agent_purchase, 'refused');
});

test('another purchase of the same fund, mismatched identities, or empty API cannot complete this plan', () => {
  const plan = historicalPlan();
  const other = purchase({ orderId: 'other', decisionSeq: 6, decision: 'd'.repeat(64), status: 'COUNTERSIGNED', mintTxHash: mint });
  assert.equal(planPurchase(plan, response(other)), null);
  assert.equal(states(plan, response(other)).confirmed, 'pending');
  assert.equal(planPurchase({ ...plan, purchaseRef: { orderId: 'order5', decisionSeq: 6 } }, response(purchase())), null);
  assert.equal(planPurchase({ ...plan, purchaseRef: null }, response(other)), null);
  assert.equal(planPurchase(plan, null), null);
  assert.equal(states(plan, null).confirmed, 'pending');
});

test('pending older purchase still polls even if the most recent purchase is already completed', () => {
  const pending = purchase();
  const recent = purchase({ orderId: 'recent', decisionSeq: 6, createdAt: '2026-10-19T12:00:00Z', status: 'COUNTERSIGNED', mintTxHash: mint });
  assert.equal(isInFlight(response(recent, pending)), true);
  assert.equal(planPurchase(historicalPlan(), response(recent, pending))?.orderId, 'order5');
});

test('refund and unknown statuses remain incomplete; balance changes are not purchase confirmation', () => {
  const refund = purchase({ status: 'REFUNDED', refundTxHash: 'd'.repeat(64) });
  assert.equal(purchaseState(refund), 'refunded');
  assert.equal(states(historicalPlan(), response(refund)).issuer_countersign, 'refused');
  assert.equal(states(historicalPlan(), response(refund)).confirmed, 'pending');
  const unknown = purchase({ status: 'UNKNOWN' as Purchase['status'], mintTxHash: mint });
  assert.equal(purchaseState(unknown), 'payment_pending');
  assert.ok(!purchaseViews(unknown, []).some(v => v.state === 'completed'));
});

test('API read-only projection distinguishes failed payment from verified issuer completion', async () => {
  // Dynamic require keeps API sources out of the web TypeScript application root.
  const { listPurchases } = require('../../../api/src/services/mandateWallet.ts');
  const order = { id: 'order5', status: 'FAILED', approvalStatus: 'APPROVED', total: 5, quantity: 5,
    decisionHash: decision, txHash: payment, tokenMintTxHash: mint, refundTxHash: null, payerAddress: 'wallet',
    fund: { id: 'fund', name: 'CSAGRI', symbol: 'CSAGRI' }, createdAt: new Date(), updatedAt: new Date() };
  const db = { order: { findMany: async () => [order] }, decisionLog: { findMany: async () => [{ seq: 5, hash: decision }] },
    decisionExecution: { findMany: async () => [] } };
  assert.equal((await listPurchases('user', db)).purchases[0].status, 'FAILED');
  order.status = 'COMPLETED'; order.approvalStatus = 'PENDING_APPROVAL';
  assert.equal((await listPurchases('user', db)).purchases[0].status, 'CONFIRMED_AWAITING_ISSUER');
  order.approvalStatus = 'APPROVED';
  assert.equal((await listPurchases('user', db)).purchases[0].status, 'COUNTERSIGNED');
});
