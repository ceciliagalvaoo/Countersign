// Plan state machine: transitions come from tool results only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { interruptPlan, isConfirmed, newPlan, onToolResult, planView, resumePlan } from "../src/plan/dag.js";
import { checkReply } from "../src/agent/replyChecks.js";
import { divideUnits, fromUnits, toUnits } from "../src/util/decimal.js";

const states = (p: ReturnType<typeof newPlan>) => Object.fromEntries(planView(p).nodes.map((n) => [n.id, n.state]));

test("NEEDS_INVESTOR_SIGNATURE activates the investor signature node", () => {
  const p = newPlan();
  onToolResult(p, "propose_subscription", {}, { fundId: "f1", outcome: "NEEDS_INVESTOR_SIGNATURE", rule: "first_purchase_needs_investor", decisionSeq: 3 }, false);
  assert.equal(states(p).proposal, "done");
  assert.equal(states(p).investor_signature, "active");
});

test("perimeter refusal from the mandate and from the policy", () => {
  const p = newPlan();
  onToolResult(p, "get_mandate", {}, { missingFields: ["horizonMonths"], draft: { residences: ["CN"] } }, false);
  assert.equal(states(p).profile, "active");
  assert.equal(states(p).perimeter, "refused");
  const q = newPlan();
  onToolResult(q, "propose_subscription", {}, { fundId: "f1", outcome: "REJECTED", rule: "perimeter_mainland_china", decisionSeq: 1 }, false);
  assert.equal(states(q).perimeter, "refused");
  assert.equal(planView(q).nodes.find((n) => n.id === "proposal")!.rule, "perimeter_mainland_china");
});

test("eligibility refused from check_eligibility", () => {
  const p = newPlan();
  onToolResult(p, "check_eligibility", {}, { fundId: "f2", eligible: false, rule: "eligibility_zk_tier" }, false);
  assert.equal(states(p).eligibility, "refused");
});

test("get_status without a proposal in focus never confirms", () => {
  const p = newPlan();
  onToolResult(p, "get_status", {}, { orders: [{ fundId: "f1", state: "completed", createdAt: new Date().toISOString(), paymentTxHash: null }] }, false);
  assert.equal(isConfirmed(p), false);
});

test("interrupt freezes active nodes and resume restores them", () => {
  const p = newPlan();
  onToolResult(p, "propose_subscription", {}, { fundId: "f1", outcome: "NEEDS_INVESTOR_SIGNATURE", rule: "first_purchase_needs_investor", decisionSeq: 3 }, false);
  interruptPlan(p);
  assert.equal(states(p).investor_signature, "interrupted");
  resumePlan(p);
  assert.equal(states(p).investor_signature, "active");
});

test("quote arithmetic: 7 decimals, rounded down", () => {
  assert.equal(fromUnits(divideUnits(toUnits("500"), toUnits("1.25"))), "400");
  assert.equal(fromUnits(divideUnits(toUnits("100"), toUnits("3"))), "33.3333333");
  assert.throws(() => toUnits("1.12345678"));
});

test("reply checks: negated statements and the advisor disclaimer are not flagged", () => {
  assert.deepEqual(checkReply("The purchase is not confirmed yet.", false).flags, []);
  assert.deepEqual(checkReply("Your mandate draft is complete.", false).flags, []);
  assert.deepEqual(checkReply("I am not an advisor; I execute within your mandate.", false).flags, []);
  assert.ok(checkReply("This fund has a guaranteed yield.", false).flags.includes("forbidden_vocabulary:guaranteed"));
  assert.deepEqual(checkReply("Your purchase is completed.", true).flags, []);
});
