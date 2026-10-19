// execute_approved_purchase: only an APPROVED decision of this session, never
// NEEDS_INVESTOR_SIGNATURE; real API answers (200, 202, 409, 503) mapped to the
// plan and to pendingAction; never "done".
import assert from "node:assert/strict";
import { test } from "node:test";
import { STATUS_NOTE } from "../src/agent/replyChecks.js";
import { runtimeTxHash } from "./support/fixtureApi.js";
import { lastToolResults, makeHarness } from "./support/harness.js";

const PROPOSE = { name: "propose_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "100", amountSource: "investor_message" } };
const execute = (seq: number) => ({ name: "execute_approved_purchase", input: { decisionSeq: seq } });
const states = (body: any) => Object.fromEntries(body.plan.nodes.map((n: any) => [n.id, n.state]));
const execCalls = (h: ReturnType<typeof makeHarness>) => h.api.requests.filter((r) => /\/execute$/.test(r.path));

test("APPROVED then executed: confirmed on chain, awaiting issuer countersignature, never done", async () => {
  const tx = runtimeTxHash();
  const h = makeHarness(
    [
      { toolUses: [PROPOSE] },
      (req) => {
        const [r] = lastToolResults(req);
        assert.equal(r.content.outcome, "APPROVED");
        return { toolUses: [execute(r.content.decisionSeq)] };
      },
      (req) => {
        const [r] = lastToolResults(req);
        assert.equal(r.is_error, undefined);
        assert.equal(r.content.txHash, tx, "a 64 hex transaction hash reaches the LLM");
        return { text: "Payment confirmed on chain; the issuer still has to countersign the mint of your fund units." };
      },
      { text: "Great, your purchase is done." },
    ],
    { executeResponses: [{ status: 200, body: { status: "CONFIRMED", seq: 1, decision: "fixture-decision-1", txHash: tx } }] },
  );
  try {
    const res = await h.chat("Buy 100 USDC of the agri fund.");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.flags, [], "\"confirmed on chain\" is allowed once the API reported it");
    const st = states(res.body);
    assert.equal(st.agent_purchase, "done");
    assert.equal(st.issuer_countersign, "active");
    assert.equal(st.confirmed, "pending");
    assert.equal(res.body.pendingAction, null);
    const out = res.body.toolCalls[1].output;
    assert.equal(out.result, "confirmed_on_chain_awaiting_issuer_countersignature");
    assert.match(out.statusText, /Not done/);
    assert.equal(execCalls(h)[0].authorization, `Bearer ${h.token}`);
    assert.equal(execCalls(h)[0].path, "/agent/proposals/1/execute");

    // "done" before the issuer countersigned is still flagged.
    const later = await h.chat("is it done?");
    assert.ok(later.body.flags.includes("unverified_completion_claim"));
    assert.ok(later.body.reply.endsWith(STATUS_NOTE));
  } finally {
    await h.close();
  }
});

test("pendingAction: awaiting_execution after APPROVED", async () => {
  const h = makeHarness([{ toolUses: [PROPOSE] }, { text: "Approved by the policy." }]);
  try {
    await h.chat("propose 100 of agri");
    const s = await h.session();
    assert.deepEqual(s.body.pendingAction, { kind: "awaiting_execution", decisionSeq: 1, fundId: "fund_agri_demo" });
  } finally {
    await h.close();
  }
});

test("NEEDS_INVESTOR_SIGNATURE is never executed; pendingAction asks for her signature", async () => {
  const h = makeHarness(
    [
      { toolUses: [PROPOSE] },
      { toolUses: [execute(1)] },
      (req) => {
        const [r] = lastToolResults(req);
        assert.equal(r.is_error, true);
        assert.match(r.content.error, /allow_fund/);
        return { text: "Please approve the fund in your mandate wallet by signing allow_fund." };
      },
    ],
    {
      proposalOutcome: () => ({
        outcome: "NEEDS_INVESTOR_SIGNATURE",
        rule: "first_purchase_needs_investor",
        explanation: "First purchase in this fund.",
      }),
    },
  );
  try {
    const res = await h.chat("Buy 100 USDC of the agri fund.");
    assert.equal(execCalls(h).length, 0);
    assert.deepEqual(res.body.pendingAction, { kind: "needs_investor_signature", decisionSeq: 1, fundId: "fund_agri_demo" });
    assert.equal(states(res.body).investor_signature, "active");
  } finally {
    await h.close();
  }
});

test("a decision not made in this session is refused without calling the API", async () => {
  const h = makeHarness([{ toolUses: [execute(42)] }, { text: "I can only execute a decision approved here." }]);
  try {
    const res = await h.chat("execute decision 42");
    assert.equal(res.body.toolCalls[0].isError, true);
    assert.equal(execCalls(h).length, 0);
  } finally {
    await h.close();
  }
});

test("202 PENDING_NETWORK: pending, not done, and never executed twice", async () => {
  const h = makeHarness(
    [
      { toolUses: [PROPOSE] },
      { toolUses: [execute(1)] },
      { toolUses: [execute(1)] },
      (req) => {
        const [r] = lastToolResults(req);
        assert.equal(r.is_error, true);
        return { text: "Pending, not done; it will be verified later." };
      },
    ],
    { executeResponses: [{ status: 202, body: { status: "PENDING_NETWORK", message: "pending, not done", txHash: null, orderId: "o1", seq: 2, hash: "fixture-decision-2" } }] },
  );
  try {
    const res = await h.chat("buy 100 of agri");
    assert.equal(res.body.toolCalls[1].output.result, "pending_network");
    assert.match(res.body.toolCalls[1].output.statusText, /Pending, not done/);
    assert.equal(execCalls(h).length, 1);
    assert.equal(states(res.body).agent_purchase, "active");
    assert.equal(res.body.pendingAction, null);
  } finally {
    await h.close();
  }
});

test("409 decision_expired: refused with the rule, a new proposal is needed", async () => {
  const h = makeHarness(
    [
      { toolUses: [PROPOSE] },
      { toolUses: [execute(1)] },
      (req) => {
        const [r] = lastToolResults(req);
        return { text: `Refused: \`${r.content.rule}\`. ${r.content.whatTheInvestorCanDo}` };
      },
    ],
    {
      executeResponses: [
        {
          status: 409,
          body: { outcome: "REJECTED", rule: "decision_expired", seq: 2, hash: "fixture-decision-2", explanation: "An approved decision is valid for 15 minutes; make a new proposal." },
        },
      ],
    },
  );
  try {
    const res = await h.chat("buy 100 of agri");
    const out = res.body.toolCalls[1].output;
    assert.equal(out.result, "refused");
    assert.equal(out.rule, "decision_expired");
    assert.equal(out.needsNewProposal, true);
    assert.match(res.body.reply, /decision_expired/);
    const node = res.body.plan.nodes.find((n: any) => n.id === "agent_purchase");
    assert.equal(node.state, "refused");
    assert.equal(node.rule, "decision_expired");
  } finally {
    await h.close();
  }
});

test("503 retryable: nothing executed, a retry is allowed", async () => {
  const h = makeHarness(
    [
      { toolUses: [PROPOSE] },
      { toolUses: [execute(1)] },
      (req) => {
        const [r] = lastToolResults(req);
        assert.equal(r.is_error, true);
        assert.equal(r.content.details.retryable, true);
        return { toolUses: [execute(1)] };
      },
      { text: "Payment confirmed on chain, awaiting issuer countersignature." },
    ],
    {
      executeResponses: [
        { status: 503, body: { outcome: "FAILED", rule: "execution_failed", retryable: true, stage: "submission", txHash: null } },
        { status: 200, body: { status: "CONFIRMED", seq: 1, txHash: runtimeTxHash() } },
      ],
    },
  );
  try {
    const res = await h.chat("buy 100 of agri");
    assert.equal(execCalls(h).length, 2);
    assert.equal(states(res.body).agent_purchase, "done");
  } finally {
    await h.close();
  }
});

test("interrupted session: execution is frozen", async () => {
  const h = makeHarness([
    { toolUses: [PROPOSE] },
    { text: "Approved by the policy." },
    { toolUses: [execute(1)] },
    (req) => {
      const [r] = lastToolResults(req);
      assert.equal(r.is_error, true);
      assert.match(r.content.error, /interrupted/);
      return { text: "Paused; nothing executed." };
    },
  ]);
  try {
    await h.chat("propose 100 of agri");
    const i = await h.app.inject({ method: "POST", url: "/session/session_fixture_0001/interrupt", headers: { authorization: `Bearer ${h.token}` } });
    assert.equal(i.json().plan.nodes.find((n: any) => n.id === "agent_purchase").state, "interrupted");
    await h.chat("execute it");
    assert.equal(execCalls(h).length, 0);
  } finally {
    await h.close();
  }
});
