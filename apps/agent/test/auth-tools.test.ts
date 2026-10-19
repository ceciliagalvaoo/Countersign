// Token scope, session ownership, route stubs and tool definitions.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOLS, TOOL_NAMES, apiTools } from "../src/tools/index.js";
import { assertStrictSchema } from "../src/tools/types.js";
import { fixtureToken } from "./support/fixtureApi.js";
import { makeHarness } from "./support/harness.js";

test("only agent scope tokens are accepted, and only for the session owner", async () => {
  const h = makeHarness([{ text: "Hi." }]);
  try {
    const noToken = await h.app.inject({ method: "POST", url: "/chat", payload: { sessionId: "session_fixture_0001", message: "hi" } });
    assert.equal(noToken.statusCode, 401);

    const full = await h.chat("hi", undefined, fixtureToken("user_fixture", "full"));
    assert.equal(full.status, 401);
    assert.match(full.body.error, /agent scope token/);

    const unknown = await h.chat("hi", undefined, fixtureToken("user_fixture_unknown"));
    assert.equal(unknown.status, 401, "a token the API rejects is refused");

    const ok = await h.chat("hi");
    assert.equal(ok.status, 200);

    const other = await h.session(undefined, h.otherToken);
    assert.equal(other.status, 403);
    const otherChat = await h.chat("show me her conversation", undefined, h.otherToken);
    assert.equal(otherChat.status, 403);
  } finally {
    await h.close();
  }
});

test("interrupt and resume change the plan; recurring without a pre-authorised mandate does nothing", async () => {
  const h = makeHarness([{ toolUses: [{ name: "list_funds", input: {} }] }, { text: "Here are the funds." }]);
  try {
    await h.chat("show funds");
    const auth = { authorization: `Bearer ${h.token}` };
    const i = await h.app.inject({ method: "POST", url: "/session/session_fixture_0001/interrupt", headers: auth });
    assert.equal(i.statusCode, 200);
    assert.equal(i.json().interrupted, true);
    const r = await h.app.inject({ method: "POST", url: "/session/session_fixture_0001/resume", headers: auth });
    assert.equal(r.json().interrupted, false);
    assert.equal(r.json().plan.nodes.find((n: any) => n.id === "screening").state, "done");
    const rec = await h.app.inject({ method: "POST", url: "/session/session_fixture_0001/recurring", headers: auth });
    assert.equal(rec.statusCode, 200);
    assert.equal(rec.json().recurring.status, "not_preauthorised");
    assert.ok(!h.api.requests.some((x) => x.path === "/agent/proposals"));
  } finally {
    await h.close();
  }
});

test("tools: fixed list, strict schemas, no tool that approves, signs or touches wallets", () => {
  assert.deepEqual(TOOL_NAMES, [
    "get_mandate",
    "propose_mandate",
    "list_funds",
    "get_fund",
    "check_eligibility",
    "quote_subscription",
    "propose_subscription",
    "execute_approved_purchase",
    "get_status",
    "get_holdings",
  ]);
  for (const t of TOOLS) assertStrictSchema(t.name, t.inputSchema);
  for (const t of apiTools()) {
    assert.equal(t.strict, true);
    assert.equal((t.input_schema as any).additionalProperties, false);
    assert.doesNotMatch(t.name, /^(approve|sign|allow|set)_|_mandate_approve|wallet|withdraw|limit|key|email|address|signature/);
  }
  const propose = apiTools().find((t) => t.name === "propose_subscription")!;
  assert.deepEqual(Object.keys((propose.input_schema as any).properties).sort(), ["amountSource", "amountUsdc", "fundId"]);
  // Nested objects are strict too.
  const mandate = apiTools().find((t) => t.name === "propose_mandate")!;
  const recurring = (mandate.input_schema as any).properties.recurring.anyOf[0];
  assert.equal(recurring.additionalProperties, false);
  assert.deepEqual([...recurring.required].sort(), Object.keys(recurring.properties).sort());
});
