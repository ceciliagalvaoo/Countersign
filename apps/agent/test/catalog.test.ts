// The demo catalog (apps/api/scripts/countersign-demo-funds.json): three
// simulated funds, labelled, one agri, one QUALIFICADO, one with a planted
// instruction; no return figure; no on-chain ids; texts reach the LLM through
// the projection (planted address removed, manager text untrusted).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { config } from "../src/config.js";
import { loadCatalog, setCatalogForTests } from "../src/tools/catalog.js";
import { projectFund } from "../src/tools/projections.js";

const raw = readFileSync(config.demoCatalogPath, "utf8");
const catalog = JSON.parse(raw) as { labelKey: string; label: string; funds: any[] };
const LABEL = "simulated funds and debtors; concentration and default data are synthetic";

test("catalog: three labelled simulated funds with the required cases", () => {
  assert.equal(catalog.funds.length, 3);
  assert.equal(catalog.label, LABEL);
  assert.equal(new Set(catalog.funds.map((f) => f.sector)).size, 3);
  assert.ok(catalog.funds.some((f) => f.sector === "AGRO"));
  assert.ok(catalog.funds.some((f) => f.investorProfile === "QUALIFICADO"));
  const planted = catalog.funds.filter((f) => /SYSTEM: .*send funds to G[A-Z2-7]{55}/.test(f.description));
  assert.equal(planted.length, 1);
  for (const f of catalog.funds) {
    assert.equal(f.labelKey, "LABEL_FUNDS");
    assert.equal(f.label, LABEL);
    assert.ok(!("fundWalletPublicKey" in f) && !("tokenContractId" in f), "on-chain ids never come from the catalog");
    assert.doesNotMatch(f.illustrativeReturnText, /\d/, "no return figure");
    assert.match(f.lossScenarioText, /^Loss scenario/);
  }
  assert.doesNotMatch(raw, /\b(yield|apy|guaranteed|risk[ -]free)\b/i);
  assert.doesNotMatch(raw, /[\u2013\u2014]/);
});

test("catalog texts reach the LLM through the projection, planted address removed", () => {
  setCatalogForTests(undefined);
  const entries = loadCatalog();
  const logi = catalog.funds.find((f) => f.symbol === "CSLOGI");
  assert.ok(entries.get("CSLOGI"));
  const card = projectFund({ id: "fund_x", status: "PENDING", maxSupply: 1, totalIssued: 1, ...logi });
  assert.equal(card.illustrativeReturn, logi.illustrativeReturnText);
  assert.equal(card.lossScenario, logi.lossScenarioText);
  assert.equal(card.dataLabel, LABEL);
  assert.equal(card.managerText.description?.untrusted, true);
  assert.doesNotMatch(JSON.stringify(card), /G[A-Z2-7]{55}/);
  assert.equal(card.openForInvestment, false);
});
