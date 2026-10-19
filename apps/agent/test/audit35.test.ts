// Fixes from the compliance audit 3.5 (findings 4, 5, 9, 10, 12): what the
// agent reads and repeats never names a regulatory investor status.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkReply } from "../src/agent/replyChecks.js";
import { setCatalogForTests } from "../src/tools/catalog.js";
import { LABEL_FUNDS, projectFund } from "../src/tools/projections.js";
import { SYSTEM_PROMPT } from "../src/prompt.js";
import { makeHarness } from "./support/harness.js";

const base = { id: "f", name: "F", symbol: "NOCAT", status: "APPROVED", maxSupply: 1, totalIssued: 1, price: 1 };

test("#4 #5 #10: no internal profile enum, neutral access rule, LABEL_FUNDS fallback", () => {
  setCatalogForTests([]);
  try {
    const q = projectFund({ ...base, investorProfile: "QUALIFICADO" });
    const p = projectFund({ ...base, investorProfile: "PROFISSIONAL" });
    const g = projectFund({ ...base, investorProfile: "GERAL" });
    for (const card of [q, p, g]) {
      const json = JSON.stringify(card);
      assert.ok(!("investorProfile" in card));
      assert.doesNotMatch(json, /QUALIFICADO|PROFISSIONAL|qualified|professional|accredited/i);
      assert.equal(card.dataLabel, LABEL_FUNDS);
    }
    assert.equal(q.accessRule, "tier_proof_required");
    assert.match(q.eligibility, /zero knowledge tier proof.*not a regulatory investor status/);
    assert.equal(p.accessRule, "open");
    assert.equal(p.eligibility, "Open to every investor who passed onboarding.");
    assert.equal(g.accessRule, "open");
  } finally {
    setCatalogForTests(undefined);
  }
});

test("#4 the payload sent to the LLM never carries the profile enum", async () => {
  const h = makeHarness([{ toolUses: [{ name: "list_funds", input: {} }] }, { text: "Here are the funds." }]);
  try {
    await h.chat("show me the funds");
    const json = h.llm.requestsJson()[1];
    assert.doesNotMatch(json, /QUALIFICADO|PROFISSIONAL|investorProfile/);
    assert.match(json, /tier_proof_required/);
  } finally {
    await h.close();
  }
});

test("#9 the prompt does not say 'this prototype'", () => {
  assert.doesNotMatch(SYSTEM_PROMPT, /this prototype/i);
});

test("#12 the vetoed terms of the agent's speech are flagged", () => {
  for (const word of ["trustless", "microcredit", "microloan", "accredited", "qualified investor", "KYC verified", "tokenized", "tokenised"]) {
    const flags = checkReply(`This is a ${word} product.`, false).flags;
    assert.ok(flags.some((f) => f.startsWith("forbidden_vocabulary:")), word);
  }
});
