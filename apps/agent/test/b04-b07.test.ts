// B04: Mainland China residence is refused in the dialogue itself, by name, and
// nothing about funds or purchases runs afterwards. B07: the plan is confirmed
// only by the order of THIS session's execution.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PERIMETER_REFUSAL } from "../src/tools/projections.js";
import { runtimeTxHash } from "./support/fixtureApi.js";
import { EMPTY_MANDATE_PATCH, lastToolResults, makeHarness } from "./support/harness.js";

const states = (body: any) => Object.fromEntries(body.plan.nodes.map((n: any) => [n.id, n.state]));
const FUND_PATHS = /^\/(funds|agent\/proposals|agent\/eligibility|orders)/;

test("B04: CN residence stops the session at perimeter with the named notice, even if the model forgets", async () => {
  const h = makeHarness([
    { toolUses: [{ name: "propose_mandate", input: { ...EMPTY_MANDATE_PATCH, residences: ["CN"], totalAmountUsdc: "1000" } }] },
    (req) => {
      const [r] = lastToolResults(req);
      assert.equal(r.content.perimeter.status, "refused");
      assert.equal(r.content.perimeter.rule, "perimeter_mainland_china");
      // A model that ignores it and tries to continue to funds and a proposal.
      return {
        toolUses: [
          { name: "list_funds", input: {} },
          { name: "propose_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "1000", amountSource: "investor_message" } },
        ],
      };
    },
    (req) => {
      for (const r of lastToolResults(req)) {
        assert.equal(r.is_error, true);
        assert.match(r.content.error, /Yinfa \[2026\] No\. 42/);
      }
      return { text: "Saved your residence. Let me look at funds for you." };
    },
    { toolUses: [{ name: "get_fund", input: { fundId: "fund_agri_demo" } }] },
    { text: "Here is the agri fund." },
  ]);
  try {
    const res = await h.chat("I live in Shanghai, mainland China. I want to invest 1000 USDC.");
    assert.equal(res.status, 200);
    assert.ok(res.body.reply.includes(PERIMETER_REFUSAL), "the refusal is stated in code");
    assert.ok(res.body.flags.includes("perimeter_refusal_added"));
    const st = states(res.body);
    assert.equal(st.perimeter, "refused");
    assert.equal(res.body.plan.nodes.find((n: any) => n.id === "perimeter").rule, "perimeter_mainland_china");
    for (const id of ["eligibility", "screening", "proposal", "agent_purchase", "confirmed"]) assert.equal(st[id], "pending", id);
    assert.ok(!h.api.requests.some((r) => FUND_PATHS.test(r.path)), "no fund or proposal route was called");

    // Sticky for the session: a later turn still cannot reach funds.
    const later = await h.chat("Fine, show me the agri fund.");
    assert.ok(later.body.reply.includes("Yinfa [2026] No. 42"));
    assert.ok(!h.api.requests.some((r) => FUND_PATHS.test(r.path)));
  } finally {
    await h.close();
  }
});

test("B04: a model that states the refusal itself is not duplicated", async () => {
  const h = makeHarness([
    { toolUses: [{ name: "propose_mandate", input: { ...EMPTY_MANDATE_PATCH, residences: ["HK", "CN"] } }] },
    { text: "Declined (`perimeter_mainland_china`): this service is not offered in Mainland China, in view of the notice Yinfa [2026] No. 42." },
  ]);
  try {
    const res = await h.chat("I am resident in Hong Kong and mainland China.");
    assert.ok(!res.body.flags.includes("perimeter_refusal_added"));
    assert.equal((res.body.reply.match(/Yinfa/g) ?? []).length, 1);
  } finally {
    await h.close();
  }
});

test("B07: only the order of this session's execution confirms the plan", async () => {
  const mine = runtimeTxHash();
  const other = runtimeTxHash();
  const later = new Date(Date.now() + 60_000).toISOString();
  const order = (id: string, txHash: string, approvalStatus: string) => ({
    id, quantity: 100, price: 1, total: 100, status: "COMPLETED", approvalStatus, txHash, createdAt: later,
    fund: { id: "fund_agri_demo", name: "Agri", symbol: "AGRI1", price: 1 },
  });
  const h = makeHarness(
    [
      { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "100", amountSource: "investor_message" } }] },
      { toolUses: [{ name: "execute_approved_purchase", input: { decisionSeq: 1 } }] },
      { toolUses: [{ name: "get_status", input: {} }] },
      { text: "Payment confirmed on chain; awaiting issuer countersignature." },
    ],
    {
      executeResponses: [{ status: 200, body: { status: "CONFIRMED", seq: 1, txHash: mine } }],
      // Newest first, as GET /api/orders: an order of ANOTHER session, same fund, completed, created later.
      orders: [order("o_other", other, "APPROVED"), order("o_mine", mine, "PENDING_APPROVAL")],
    },
  );
  try {
    const res = await h.chat("buy 100 of agri and tell me the status");
    const st = states(res.body);
    assert.equal(st.confirmed, "pending", "the other session's completed order does not confirm this plan");
    assert.equal(st.issuer_countersign, "active");
    assert.equal(st.agent_purchase, "done");
  } finally {
    await h.close();
  }
});

test("B07: completed status of this session's order confirms; PENDING_NETWORK binds by order id", async () => {
  const mine = runtimeTxHash();
  const later = new Date(Date.now() + 60_000).toISOString();
  const h = makeHarness(
    [
      { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "100", amountSource: "investor_message" } }] },
      { toolUses: [{ name: "execute_approved_purchase", input: { decisionSeq: 1 } }] },
      { toolUses: [{ name: "get_status", input: {} }] },
      { text: "Completed: payment confirmed on chain and fund units minted." },
    ],
    {
      executeResponses: [{ status: 202, body: { status: "PENDING_NETWORK", message: "pending, not done", txHash: null, orderId: "o_mine", seq: 2, hash: "fixture-decision-2" } }],
      orders: [
        { id: "o_other", quantity: 1, price: 1, total: 1, status: "PENDING", approvalStatus: "PENDING_APPROVAL", txHash: null, createdAt: later, fund: { id: "fund_agri_demo", name: "Agri", symbol: "AGRI1", price: 1 } },
        { id: "o_mine", quantity: 100, price: 1, total: 100, status: "COMPLETED", approvalStatus: "APPROVED", txHash: mine, createdAt: later, fund: { id: "fund_agri_demo", name: "Agri", symbol: "AGRI1", price: 1 } },
      ],
    },
  );
  try {
    const res = await h.chat("buy 100 of agri and tell me the status");
    const st = states(res.body);
    assert.equal(st.confirmed, "done");
    assert.deepEqual(res.body.flags, []);
  } finally {
    await h.close();
  }
});

test("B11: the execute answer is lost (timeout): pending, not done; the order is later bound by the decision hash", async () => {
  const later = new Date(Date.now() + 60_000).toISOString();
  const otherDecision = runtimeTxHash();
  const h = makeHarness(
    [
      { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "100", amountSource: "investor_message" } }] },
      { toolUses: [{ name: "execute_approved_purchase", input: { decisionSeq: 1 } }] },
      (req) => {
        const [r] = lastToolResults(req);
        assert.equal(r.is_error, undefined, "a lost answer is not a final error");
        assert.equal(r.content.result, "pending_network");
        assert.match(r.content.statusText, /Pending, not done/);
        return { text: "Pending, not done: the platform did not answer in time; I will check the status later." };
      },
      // Later turn: the API now has the order, CONFIRMED and minted, recorded minutes after the agent gave up.
      { toolUses: [{ name: "get_status", input: {} }, { name: "execute_approved_purchase", input: { decisionSeq: 1 } }] },
      (req) => {
        const results = lastToolResults(req);
        assert.equal(results[1].is_error, true, "the decision is never executed twice");
        return { text: "Completed: payment confirmed on chain and fund units minted." };
      },
    ],
    {
      hexDecisionHashes: true,
      executeResponses: [{ hang: true }],
      orders: (api) => [
        // Another session's completed order of the same fund, newer: must be ignored.
        { id: "o_other", quantity: 5, price: 1, total: 5, status: "COMPLETED", approvalStatus: "APPROVED", txHash: runtimeTxHash(), decisionHash: otherDecision, createdAt: later, fund: { id: "fund_agri_demo", name: "Agri", symbol: "AGRI1", price: 1 } },
        { id: "o_mine", quantity: 100, price: 1, total: 100, status: "COMPLETED", approvalStatus: "APPROVED", txHash: runtimeTxHash(), decisionHash: api.decisionHashes.get(1), createdAt: later, fund: { id: "fund_agri_demo", name: "Agri", symbol: "AGRI1", price: 1 } },
      ],
    },
    undefined,
    { apiTimeoutMs: 100 },
  );
  try {
    const first = await h.chat("Buy 100 USDC of the agri fund.");
    assert.equal(first.status, 200);
    let st = states(first.body);
    assert.equal(st.agent_purchase, "active");
    assert.equal(st.confirmed, "pending");
    assert.equal(first.body.pendingAction, null);
    assert.ok(!first.body.flags.includes("unverified_completion_claim"));

    const second = await h.chat("Is it done now?");
    st = states(second.body);
    assert.equal(st.confirmed, "done", "bound by the decision hash of this session");
    assert.equal(st.issuer_countersign, "done");
    assert.deepEqual(second.body.flags, []);
    assert.equal(h.api.requests.filter((r) => /\/execute$/.test(r.path)).length, 1);
  } finally {
    await h.close();
  }
});

test("B11: a decision hash of another session never confirms this plan", async () => {
  const later = new Date(Date.now() + 60_000).toISOString();
  const h = makeHarness(
    [
      { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "100", amountSource: "investor_message" } }] },
      { toolUses: [{ name: "execute_approved_purchase", input: { decisionSeq: 1 } }] },
      { toolUses: [{ name: "get_status", input: {} }] },
      { text: "Still pending, not done." },
    ],
    {
      hexDecisionHashes: true,
      executeResponses: [{ hang: true }],
      orders: [
        { id: "o_other", quantity: 5, price: 1, total: 5, status: "COMPLETED", approvalStatus: "APPROVED", txHash: runtimeTxHash(), decisionHash: runtimeTxHash(), createdAt: later, fund: { id: "fund_agri_demo", name: "Agri", symbol: "AGRI1", price: 1 } },
      ],
    },
    undefined,
    { apiTimeoutMs: 100 },
  );
  try {
    const res = await h.chat("Buy 100 USDC of the agri fund and check the status.");
    assert.equal(states(res.body).confirmed, "pending");
  } finally {
    await h.close();
  }
});
