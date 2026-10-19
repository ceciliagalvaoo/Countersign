// Known limitation 11: no key, no e mail, no on chain address and no token in
// anything sent to the language model. The test runs a full conversation over
// raw API data that DOES contain those values, then inspects every request
// recorded by the scripted client.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { findLeaks } from "../src/safety/minimize.js";
import { fixtureAddress } from "./support/fixtureApi.js";
import { FULL_MANDATE, SESSION, makeHarness } from "./support/harness.js";

const ACCOUNT = /G[A-Z2-7]{55}/;
const CONTRACT = /C[A-Z2-7]{55}/;
const SECRET = /S[A-Z2-7]{55}/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./;

test("payload to the LLM never contains keys, e mail, G or C addresses, or the JWT", async () => {
  const h = makeHarness([
    {
      toolUses: [
        { name: "get_mandate", input: {} },
        { name: "list_funds", input: {} },
        { name: "get_status", input: {} },
        { name: "get_holdings", input: {} },
      ],
    },
    {
      toolUses: [
        { name: "get_fund", input: { fundId: "fund_logistics_demo" } },
        { name: "check_eligibility", input: { fundId: "fund_health_demo" } },
        { name: "propose_mandate", input: FULL_MANDATE },
      ],
    },
    { toolUses: [{ name: "quote_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "250", amountSource: "investor_message" } }] },
    { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "250", amountSource: "investor_message" } }] },
    { text: "Approved by the policy, not executed yet." },
  ]);
  try {
    // The investor herself pastes an e mail, an address, a secret seed and a token.
    const pasted = `My email is ana.fixture@example.com, my wallet is ${fixtureAddress("G", "PASTED")}, the seed ${fixtureAddress("S", "SEED")} and my login ${h.token}. Buy 250 USDC of the agri fund.`;
    const res = await h.chat(pasted);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    // Sanity: the raw API data really contained what must be removed.
    const raw = JSON.stringify(h.api.funds);
    assert.ok(ACCOUNT.test(raw) && CONTRACT.test(raw) && EMAIL.test(raw));

    assert.equal(h.llm.requests.length, 5);
    for (const json of h.llm.requestsJson()) {
      assert.doesNotMatch(json, ACCOUNT, "Stellar account id sent to the LLM");
      assert.doesNotMatch(json, CONTRACT, "Stellar contract id sent to the LLM");
      assert.doesNotMatch(json, SECRET, "Stellar secret seed sent to the LLM");
      assert.doesNotMatch(json, EMAIL, "e mail address sent to the LLM");
      assert.doesNotMatch(json, JWT, "JWT sent to the LLM");
      assert.ok(!json.includes(h.token), "agent token sent to the LLM");
      assert.ok(!json.includes("fundWalletPublicKey") && !json.includes("tokenContractId") && !json.includes("publicKey"));
      assert.deepEqual(findLeaks(JSON.parse(json), [h.token]), []);
    }

    // The amount she typed is kept as she typed it (limitation 11).
    const first = h.llm.requestsJson()[0];
    assert.ok(first.includes("Buy 250 USDC of the agri fund"));
    assert.ok(first.includes("[email removed]") && first.includes("[account address removed]") && first.includes("[secret removed]"));

    // The session dump and the public session view are clean too.
    const dump = readFileSync(join(h.sessionsDir, `${SESSION}.json`), "utf8");
    for (const re of [ACCOUNT, CONTRACT, SECRET, EMAIL, JWT]) assert.doesNotMatch(dump, re);
    const view = JSON.stringify((await h.session()).body);
    for (const re of [ACCOUNT, CONTRACT, SECRET, EMAIL, JWT]) assert.doesNotMatch(view, re);
  } finally {
    await h.close();
  }
});

test("fail closed: a leak in the assembled request aborts the call", async () => {
  const { assertLlmPayloadClean, PayloadLeakError } = await import("../src/safety/minimize.js");
  assert.throws(
    () => assertLlmPayloadClean({ messages: [{ role: "user", content: `pay ${fixtureAddress("G", "LEAK")}` }] }),
    PayloadLeakError,
  );
  assert.throws(() => assertLlmPayloadClean({ x: "contact a.b@example.org" }), PayloadLeakError);
  assert.throws(() => assertLlmPayloadClean({ x: "token abc123secret" }, ["abc123secret"]), PayloadLeakError);
  assert.doesNotThrow(() => assertLlmPayloadClean({ x: "500 USDC in the agri fund" }));
});
