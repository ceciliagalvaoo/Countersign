// Build line 1.6: the chat calls get_mandate, list_funds, quote_subscription
// and propose_subscription with the agent scope token; every tool call is
// logged with arguments, result and duration; GET /session/:id returns the
// plan, the mandate and the turn counter.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FULL_MANDATE, SESSION, lastToolResults, makeHarness } from "./support/harness.js";

const OPENING =
  "Hi, I live in Hong Kong. I want to put 1000 USDC into receivables over 2 years, at most 500 per purchase and 1000 per 30 days, agri and services only, max 60% in one sector, medium loss tolerance, I may need 20% back within 6 months. Buy 500 USDC of the agri fund.";

function happySteps() {
  return [
    // Two independent reads in parallel.
    { toolUses: [{ name: "get_mandate", input: {} }, { name: "list_funds", input: {} }] },
    { toolUses: [{ name: "propose_mandate", input: FULL_MANDATE }] },
    { toolUses: [{ name: "quote_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "500", amountSource: "investor_message" } }] },
    { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "500", amountSource: "investor_message" } }] },
    {
      text: "The policy approved the proposal (`all_rules_passed`). It is not a purchase yet: execution, the issuer's countersignature and on chain confirmation still follow.",
    },
  ];
}

test("1.6 flow: tools called with the agent token, results logged, plan updated", async () => {
  const h = makeHarness(happySteps());
  try {
    const res = await h.chat(OPENING);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.turn, 1);
    assert.match(res.body.reply, /not a purchase yet/);
    assert.deepEqual(res.body.flags, []);

    // Every API call carried the agent scope token and nothing else.
    assert.ok(h.api.requests.length >= 6);
    for (const r of h.api.requests) assert.equal(r.authorization, `Bearer ${h.token}`);
    const paths = h.api.requests.map((r) => `${r.method} ${r.path}`);
    for (const p of ["GET /mandates", "GET /funds", "PUT /mandates/draft", "POST /agent/proposals"]) {
      assert.ok(paths.includes(p), `missing ${p} in ${paths.join(", ")}`);
    }

    // The proposal body has exactly the five agreed keys; no destination.
    const proposal = h.api.requests.find((r) => r.path === "/agent/proposals")!.body as Record<string, unknown>;
    assert.deepEqual(Object.keys(proposal).sort(), ["amountSource", "amountUsdc", "fundId", "origin", "toolCallId"]);
    assert.equal(proposal.origin, "chat");
    assert.equal(proposal.amountUsdc, "500");
    assert.equal(proposal.amountSource, "investor_message");

    // toolCallId is the id of the tool_use block that proposed it.
    const proposeLog = res.body.toolCalls.find((c: any) => c.tool === "propose_subscription");
    assert.equal(proposal.toolCallId, proposeLog.id);

    // Parallel tool calls: both results in ONE user message.
    const second = h.llm.requests[1];
    const results = lastToolResults(second);
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => !r.is_error));

    // Tool log: arguments, result and duration for each call.
    const tools = res.body.toolCalls.map((c: any) => c.tool);
    assert.deepEqual(tools, ["get_mandate", "list_funds", "propose_mandate", "quote_subscription", "propose_subscription"]);
    for (const c of res.body.toolCalls) {
      assert.ok("input" in c && "output" in c);
      assert.equal(typeof c.durationMs, "number");
      assert.equal(c.isError, false);
    }
    const quote = res.body.toolCalls.find((c: any) => c.tool === "quote_subscription").output;
    assert.equal(quote.fundUnits, "500");
    assert.equal(quote.totalUsdc, "500");
    assert.equal(quote.perPurchaseCapRemainingUsdc, "0");
    assert.equal(quote.capsSource, "mandate draft (not approved yet)");

    // GET /session/:id
    const s = await h.session();
    assert.equal(s.status, 200);
    assert.equal(s.body.turns, 1);
    assert.deepEqual(s.body.missingFields, []);
    assert.equal(s.body.mandateDraft.totalAmountUsdc, "1000");
    const state = Object.fromEntries(s.body.plan.nodes.map((n: any) => [n.id, n.state]));
    assert.deepEqual(state, {
      profile: "done",
      perimeter: "done",
      eligibility: "done",
      screening: "done",
      proposal: "done",
      investor_signature: "skipped",
      agent_purchase: "pending",
      issuer_countersign: "pending",
      confirmed: "pending",
    });
    assert.equal(s.body.plan.nodes.length, 9);
    for (const n of s.body.plan.nodes) assert.ok(n.id && n.label && n.state);
    assert.equal(s.body.lastToolCalls.length, 5);
    assert.deepEqual(s.body.pendingAction, { kind: "awaiting_execution", decisionSeq: 1, fundId: "fund_agri_demo" });

    // Session dumped to disk, without the token.
    const dump = readFileSync(join(h.sessionsDir, `${SESSION}.json`), "utf8");
    assert.ok(dump.includes("propose_subscription"));
    assert.ok(!dump.includes(h.token));
  } finally {
    await h.close();
  }
});

test("1.6 flow: REJECTED is explained with the rule and the plan shows it", async () => {
  const h = makeHarness(
    [
      { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "800", amountSource: "investor_message" } }] },
      (req) => {
        const [r] = lastToolResults(req);
        return { text: `The policy refused it: \`${r.content.rule}\`. ${r.content.whatTheInvestorCanDo}` };
      },
    ],
    {
      proposalOutcome: () => ({
        outcome: "REJECTED",
        rule: "amount_over_purchase_cap",
        explanation: "The amount is above the per purchase cap of the mandate (500 USDC).",
      }),
    },
  );
  try {
    const res = await h.chat("Buy 800 USDC of the agri fund.");
    assert.equal(res.status, 200);
    assert.match(res.body.reply, /amount_over_purchase_cap/);
    const proposal = res.body.plan.nodes.find((n: any) => n.id === "proposal");
    assert.equal(proposal.state, "refused");
    assert.equal(proposal.rule, "amount_over_purchase_cap");
    const out = res.body.toolCalls[0].output;
    assert.equal(out.outcome, "REJECTED");
    assert.equal(out.moneyMoved, false);
    assert.match(out.whatTheInvestorCanDo, /Lower the amount/);
  } finally {
    await h.close();
  }
});

test("turn counter is per session and survives a correction", async () => {
  const h = makeHarness([
    { toolUses: [{ name: "propose_mandate", input: FULL_MANDATE }] },
    { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "400", amountSource: "investor_message" } }] },
    { text: "Approved by the policy, not executed yet." },
    {
      toolUses: [
        { name: "propose_mandate", input: { ...Object.fromEntries(Object.keys(FULL_MANDATE).map((k) => [k, null])), removeRecurring: false, allowedSectors: ["AGRO"], perPurchaseCapUsdc: "500" } },
      ],
    },
    { text: "Updated: only the agri sector. I will propose again with 500." },
  ]);
  try {
    await h.chat("Set my mandate and buy 400 of the agri fund.");
    let s = await h.session();
    assert.equal(s.body.turns, 1);
    assert.equal(s.body.plan.nodes.find((n: any) => n.id === "proposal").state, "done");

    await h.chat("Make it 500, only the agri fund.");
    s = await h.session();
    assert.equal(s.body.turns, 2);
    const state = Object.fromEntries(s.body.plan.nodes.map((n: any) => [n.id, n.state]));
    // Affected nodes went back to pending; profile and perimeter were kept.
    assert.equal(state.profile, "done");
    assert.equal(state.perimeter, "done");
    assert.equal(state.proposal, "pending");
    assert.equal(state.screening, "pending");
    assert.deepEqual(s.body.mandateDraft.allowedSectors, ["AGRO"]);
    assert.equal(s.body.transcript.length, 4);
  } finally {
    await h.close();
  }
});
