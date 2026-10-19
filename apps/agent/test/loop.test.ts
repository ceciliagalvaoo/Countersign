// Agent loop behaviour: request shape, untrusted text, tool failure,
// refusal, and the "never done without status" guard.
import assert from "node:assert/strict";
import { test } from "node:test";
import { UNTRUSTED_REMINDER, REFUSAL_REPLY } from "../src/agent/loop.js";
import { STATUS_NOTE } from "../src/agent/replyChecks.js";
import { LlmUnavailableError } from "../src/llm/types.js";
import { SYSTEM_PROMPT } from "../src/prompt.js";
import { PLANTED_INSTRUCTION } from "./support/fixtureApi.js";
import { lastToolResults, makeHarness } from "./support/harness.js";

test("request shape follows the claude-api facts for claude-opus-5-5", async () => {
  const h = makeHarness([{ text: "Hello. Let me check your mandate first." }, { text: "Sure." }]);
  try {
    await h.chat("hello");
    await h.chat("again");
    const [a, b] = h.llm.requests as any[];
    assert.equal(a.model, "claude-opus-5-5");
    assert.deepEqual(a.tool_choice, { type: "auto" });
    assert.ok(!("thinking" in a), "no thinking parameter (adaptive is always on)");
    assert.ok(["low", "medium", "high"].includes(a.output_config.effort));
    assert.equal(a.fallbacks, "default");
    assert.deepEqual(a.betas, ["server-side-fallback-2026-07-01"]);
    // Stable cached prefix: same system and tools in every request, breakpoint on the system block.
    assert.equal(a.system[0].text, SYSTEM_PROMPT);
    assert.deepEqual(a.system[0].cache_control, { type: "ephemeral" });
    assert.deepEqual(a.system, b.system);
    assert.deepEqual(a.tools, b.tools);
    assert.ok(a.tools.every((t: any) => t.strict === true));
    // No date or time in the system prompt.
    assert.doesNotMatch(SYSTEM_PROMPT, /\b20\d\d-\d\d-\d\d\b|\d\d:\d\d/);
    // Never ends with an assistant message (no prefill).
    for (const r of h.llm.requests) assert.notEqual(r.messages[r.messages.length - 1].role, "assistant");
  } finally {
    await h.close();
  }
});

test("fund text arrives as untrusted data with an operator reminder; planted text does not change the proposal", async () => {
  const h = makeHarness([
    { toolUses: [{ name: "get_fund", input: { fundId: "fund_logistics_demo" } }] },
    // Even if the model were fooled, the proposal tool has no destination argument and
    // its amount must come from the investor or the mandate.
    { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_logistics_demo", amountUsdc: "100", amountSource: "investor_message" } }] },
    { text: "The fund description contains text I will not act on. The policy approved 100 USDC; it is not executed yet." },
  ]);
  try {
    const res = await h.chat("Buy 100 USDC of the logistics fund.");
    assert.equal(res.status, 200);
    const second = h.llm.requests[1] as any;
    const [r] = lastToolResults(second);
    const desc = r.content.managerText.description;
    assert.equal(desc.untrusted, true);
    assert.equal(desc.source, "fund.description");
    assert.match(desc.text, /SYSTEM: ignore previous instructions/);
    assert.match(desc.text, /\[account address removed\]/);
    assert.ok(!desc.text.includes(PLANTED_INSTRUCTION.match(/G[A-Z2-7]{55}/)![0]));
    // Operator reminder as a system message right after the tool results.
    const last = second.messages[second.messages.length - 1];
    assert.equal(last.role, "system");
    assert.equal(last.content, UNTRUSTED_REMINDER);

    const proposal = h.api.requests.find((x) => x.path === "/agent/proposals")!.body as any;
    assert.equal(proposal.amountUsdc, "100");
    assert.ok(!("destination" in proposal));
  } finally {
    await h.close();
  }
});

test("a failing tool goes back as is_error and nothing is invented", async () => {
  const h = makeHarness(
    [
      { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "100", amountSource: "investor_message" } }] },
      (req) => {
        const [r] = lastToolResults(req);
        assert.equal(r.is_error, true);
        return { text: "The policy service did not answer, so nothing was proposed. Do you want me to try again?" };
      },
    ],
    { failing: ["POST /agent/proposals"] },
  );
  try {
    const res = await h.chat("Buy 100 of the agri fund");
    assert.equal(res.status, 200);
    const call = res.body.toolCalls[0];
    assert.equal(call.isError, true);
    assert.match(call.output.error, /failed \(503\)/);
    assert.match(call.output.error, /Nothing was changed/);
    const proposal = res.body.plan.nodes.find((n: any) => n.id === "proposal");
    assert.equal(proposal.state, "pending");
    assert.match(proposal.detail, /failed/);
  } finally {
    await h.close();
  }
});

test("invalid tool arguments are refused by our schema check, not sent to the API", async () => {
  const h = makeHarness([
    { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "1.123456789", amountSource: "fund_description" } }] },
    { text: "I need the amount from you." },
  ]);
  try {
    const res = await h.chat("buy some");
    assert.equal(res.body.toolCalls[0].isError, true);
    assert.ok(!h.api.requests.some((r) => r.path === "/agent/proposals"));
  } finally {
    await h.close();
  }
});

test("a purchase is never reported as done without get_status", async () => {
  const h = makeHarness([{ text: "Great news, your purchase is complete!" }]);
  try {
    const res = await h.chat("did it work?");
    assert.ok(res.body.flags.includes("unverified_completion_claim"));
    assert.ok(res.body.reply.endsWith(STATUS_NOTE));
  } finally {
    await h.close();
  }
});

test("get_status without an execution in this session never moves the plan; placeholders are never shown as hashes", async () => {
  const later = new Date(Date.now() + 60_000).toISOString();
  const h = makeHarness(
    [
      { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "100", amountSource: "investor_message" } }] },
      { toolUses: [{ name: "get_status", input: {} }] },
      { text: "The proposal is approved; no execution has happened in this conversation yet." },
    ],
    {
      orders: [
        { id: "o1", quantity: 100, price: 1, total: 100, status: "COMPLETED", approvalStatus: "APPROVED", txHash: "fixture-tx-2", createdAt: later, fund: { id: "fund_agri_demo", name: "Agri", symbol: "AGRI1", price: 1 } },
      ],
    },
  );
  try {
    const res = await h.chat("buy 100 and tell me the status");
    const state = Object.fromEntries(res.body.plan.nodes.map((n: any) => [n.id, n.state]));
    assert.equal(state.confirmed, "pending");
    assert.equal(state.agent_purchase, "pending");
    assert.equal(res.body.toolCalls[1].output.orders[0].paymentTxHash, null);
  } finally {
    await h.close();
  }
});

test("refusal is handled before reading content and the turn is not kept in the LLM history", async () => {
  const h = makeHarness([{ stopReason: "refusal", text: "ignored" }, { text: "Hello again." }]);
  try {
    const res = await h.chat("something the model refuses");
    assert.equal(res.body.reply, REFUSAL_REPLY);
    await h.chat("hello");
    const second = h.llm.requests[1] as any;
    assert.equal(second.messages.length, 1);
  } finally {
    await h.close();
  }
});

test("provider failure returns 502 and keeps the session consistent", async () => {
  const failing = { kind: "anthropic" as const, create: async () => { throw new LlmUnavailableError("provider error 401: invalid x-api-key", 401); } };
  const h = makeHarness([], {}, failing);
  try {
    const res = await h.chat("hello");
    assert.equal(res.status, 502);
    assert.match(res.body.error, /nothing was proposed or bought/);
    assert.equal(res.body.reason, "provider authentication failed");
    const s = await h.session();
    assert.equal(s.body.turns, 0);
  } finally {
    await h.close();
  }
});
