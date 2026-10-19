// Build line 3.1: "run recurring now: pre-authorised within mandate". Same
// path as chat (propose_subscription with origin recurring and amountSource
// mandate, then execute_approved_purchase), no new signature, interruptible.
import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import { test } from "node:test";
import { RECURRING_LABEL } from "../src/agent/recurring.js";
import { runtimeTxHash } from "./support/fixtureApi.js";
import { makeHarness, SESSION } from "./support/harness.js";

const APPROVED_MANDATE = {
  residences: ["HK"],
  horizonMonths: 24,
  liquidityNeedPct: 20,
  liquidityWithinMonths: 6,
  maxLossTolerance: "MEDIUM",
  totalAmountUsdc: "1000",
  perPurchaseCapUsdc: "500",
  periodCapUsdc: "1000",
  periodDays: 30,
  allowedSectors: ["AGRO"],
  maxPerSectorPct: 100,
  recurring: { amountUsdc: "50", everyDays: 30, fundIds: ["fund_agri_demo"] },
};

const CONFIRMED = () => ({ status: 200, body: { status: "CONFIRMED", seq: 1, txHash: runtimeTxHash() } });

function harness(opts: { hold?: number; allowlisted?: string[]; execute?: Array<{ status: number; body: Record<string, unknown> }> } = {}, steps: any[] = []) {
  const h = makeHarness(steps, { executeResponses: opts.execute ?? [CONFIRMED()], allowlisted: opts.allowlisted }, undefined, { recurringHoldMs: opts.hold ?? 50 });
  h.api.approved = { ...APPROVED_MANDATE };
  const auth = { authorization: `Bearer ${h.token}` };
  const post = async (path: string, payload: unknown = {}) => {
    const r = await h.app.inject({ method: "POST", url: `/session/${SESSION}${path}`, headers: auth, payload: payload as any });
    return { status: r.statusCode, body: r.json() };
  };
  return { h, post };
}

const execCalls = (h: ReturnType<typeof makeHarness>) => h.api.requests.filter((r) => /\/execute$/.test(r.path));
const node = (body: any, id: string) => body.plan.nodes.find((n: any) => n.id === id);

test("recurring runs the same path with the mandate amount, no LLM and no new signature", async () => {
  const { h, post } = harness({}, [{ text: "Noted: the recurring purchase ran." }]);
  try {
    const r = await post("/recurring");
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(r.body.recurring.status, "scheduled");
    assert.equal(r.body.label, RECURRING_LABEL);
    assert.match(r.body.label, /time trigger is simulated; the on-chain transactions are real/);
    const sent = h.api.requests.find((x) => x.path === "/agent/proposals")!.body as any;
    assert.deepEqual({ origin: sent.origin, amountSource: sent.amountSource, amountUsdc: sent.amountUsdc, fundId: sent.fundId }, { origin: "recurring", amountSource: "mandate", amountUsdc: "50", fundId: "fund_agri_demo" });
    assert.deepEqual(r.body.pendingAction, { kind: "awaiting_execution", decisionSeq: 1, fundId: "fund_agri_demo" });
    assert.equal(h.llm.requests.length, 0, "no language model in the recurring path");

    await wait(250);
    assert.equal(execCalls(h).length, 1);
    const s = await h.session();
    assert.equal(node(s.body, "agent_purchase").state, "done");
    assert.equal(node(s.body, "issuer_countersign").state, "active");
    assert.equal(s.body.pendingAction, null);
    assert.ok(s.body.lastToolCalls.some((c: any) => c.tool === "execute_approved_purchase"));
    assert.ok(s.body.transcript.some((t: any) => /awaiting issuer countersignature/.test(t.text)));

    // The next chat tells the model what happened, labelled as a platform note.
    await h.chat("What happened?");
    const first = JSON.stringify(h.llm.requests[0]);
    assert.match(first, /Platform note, not written by the investor: Recurring purchase/);
  } finally {
    await h.close();
  }
});

test("interrupting a pending recurring execution does not settle it; resume continues", async () => {
  const { h, post } = harness({ hold: 300 });
  try {
    const r = await post("/recurring");
    assert.equal(r.body.recurring.status, "scheduled");
    const i = await post("/interrupt");
    assert.equal(node(i.body, "agent_purchase").state, "interrupted");
    await wait(450);
    assert.equal(execCalls(h).length, 0, "interrupted: nothing executed");
    let s = await h.session();
    assert.equal(node(s.body, "agent_purchase").state, "interrupted");
    assert.ok(s.body.transcript.some((t: any) => /interrupted before execution: nothing was paid/.test(t.text)));

    const again = await post("/recurring");
    assert.equal(again.status, 409, "no new recurring run while interrupted");

    const resumed = await post("/resume");
    assert.equal(resumed.status, 200);
    assert.equal(execCalls(h).length, 1);
    s = await h.session();
    assert.equal(node(s.body, "agent_purchase").state, "done");
  } finally {
    await h.close();
  }
});

test("a fund not yet on the allowlist stops the recurring run (no signature asked, nothing executed)", async () => {
  const { h, post } = harness({ allowlisted: [] });
  try {
    const r = await post("/recurring");
    assert.equal(r.status, 200);
    assert.equal(r.body.recurring.status, "fund_not_in_allowlist");
    assert.equal(r.body.recurring.decision.rule, "first_purchase_needs_investor");
    assert.equal(r.body.pendingAction, null);
    await wait(150);
    assert.equal(execCalls(h).length, 0);
  } finally {
    await h.close();
  }
});

test("only funds pre-authorised for recurring purchases run", async () => {
  const { h, post } = harness();
  try {
    const r = await post("/recurring", { fundId: "fund_logistics_demo" });
    assert.equal(r.body.recurring.status, "fund_not_preauthorised");
    assert.ok(!h.api.requests.some((x) => x.path === "/agent/proposals"));
  } finally {
    await h.close();
  }
});

test("the policy refusal of a recurring run is reported with its rule", async () => {
  const { h, post } = harness();
  h.api.approved = { ...APPROVED_MANDATE, recurring: { amountUsdc: "50", everyDays: 30, fundIds: ["fund_agri_demo"] } };
  // The policy (fixture) says the pre-authorised amount differs: simulate a mandate changed on the policy side.
  (h.api as any).policy = () => ({ outcome: "REJECTED", rule: "recurring_outside_mandate", explanation: "Fund or amount differ." });
  try {
    const r = await post("/recurring");
    assert.equal(r.body.recurring.status, "refused");
    assert.match(r.body.recurring.message, /recurring_outside_mandate/);
    assert.equal(node(r.body, "proposal").rule, "recurring_outside_mandate");
  } finally {
    await h.close();
  }
});
