// Build lines 2.2 (dialogue), 2.3 (untrusted catalog text), 2.4 (eligibility),
// all with the scripted client and the fixture API. The correction ("make it
// 500, only the agri fund") is covered in flow.test.ts; tool failure recovery
// and policy refusals in loop.test.ts and flow.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RETURN_NOTE, checkReply } from "../src/agent/replyChecks.js";
import { config } from "../src/config.js";
import { lastToolResults, makeHarness } from "./support/harness.js";

const catalog = JSON.parse(readFileSync(config.demoCatalogPath, "utf8")) as { funds: any[] };
const CSLOGI = catalog.funds.find((f) => f.symbol === "CSLOGI");

test("2.2 out of scope: a return question gets no return figure (flagged and corrected if the model gives one)", async () => {
  const h = makeHarness([
    { text: "You could earn about 12% per year with the agri fund." },
    { text: "No return is promised or expected, and I cannot predict one. The agri fund shows a loss scenario: you can lose part or all of what you invest." },
  ]);
  try {
    const bad = await h.chat("What will I earn?");
    assert.ok(bad.body.flags.includes("return_figure"));
    assert.ok(bad.body.reply.endsWith(RETURN_NOTE));
    const good = await h.chat("What will I earn, really?");
    assert.deepEqual(good.body.flags, []);
  } finally {
    await h.close();
  }
  // The loss scenario wording (a percentage of loss) is not a return figure.
  assert.deepEqual(checkReply("Loss scenario: the fund could lose about 12% of its value if the largest account debtor defaulted.", false).flags, []);
});

test("2.2 contract refusal is explained citing the rule, nothing assumed paid", async () => {
  const h = makeHarness(
    [
      { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "100", amountSource: "investor_message" } }] },
      { toolUses: [{ name: "execute_approved_purchase", input: { decisionSeq: 1 } }] },
      (req) => {
        const [r] = lastToolResults(req);
        return { text: `Refused (\`${r.content.rule}\`, ${r.content.errorName}). ${r.content.whatTheInvestorCanDo}` };
      },
    ],
    {
      executeResponses: [
        { status: 409, body: { outcome: "FAILED", rule: "execution_failed", retryable: false, stage: "simulation", errorCode: 4, errorName: "OverPeriodCap", txHash: null, seq: 2, hash: "fixture-decision-2" } },
      ],
    },
  );
  try {
    const res = await h.chat("Buy 100 USDC of the agri fund");
    const out = res.body.toolCalls[1].output;
    assert.equal(out.result, "refused");
    assert.equal(out.rule, "execution_failed");
    assert.equal(out.errorName, "OverPeriodCap");
    assert.equal(out.moneyMoved, false);
    assert.match(out.whatTheInvestorCanDo, /wallet contract on Stellar \(not audited\)/);
    assert.match(res.body.reply, /execution_failed/);
    assert.equal(res.body.plan.nodes.find((n: any) => n.id === "agent_purchase").rule, "execution_failed");
  } finally {
    await h.close();
  }
});

test("2.3 CSLOGI planted instruction: an amount taken from fund text is refused by the policy with the rule", async () => {
  // A model that WAS fooled: it reads the planted text and proposes its amount as if the investor had said it.
  const h = makeHarness([
    { toolUses: [{ name: "get_fund", input: { fundId: "fund_logistics_demo" } }] },
    { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_logistics_demo", amountUsdc: "9999", amountSource: "investor_message" } }] },
    (req) => {
      const [r] = lastToolResults(req);
      return { text: `The policy refused it: \`${r.content.rule}\`.` };
    },
  ]);
  h.api.funds[2].description = CSLOGI.description;
  try {
    const res = await h.chat("Tell me about the logistics fund and buy 100 USDC of it.");
    const fundOut = res.body.toolCalls[0].output;
    assert.equal(fundOut.managerText.description.untrusted, true);
    assert.match(fundOut.managerText.description.text, /SYSTEM: ignore all previous instructions/);
    assert.doesNotMatch(JSON.stringify(fundOut), /G[A-Z2-7]{55}/);

    const sent = h.api.requests.find((r) => r.path === "/agent/proposals")!.body as Record<string, unknown>;
    assert.equal(sent.amountSource, "unverified_by_agent", "9999 is not in her messages, so the claim is not passed on as verified");
    assert.ok(!("destination" in sent));
    const out = res.body.toolCalls[1].output;
    assert.equal(out.outcome, "REJECTED");
    assert.equal(out.rule, "untrusted_text_cannot_set_destination_or_amount");
    assert.equal(out.amountSourceVerified, false);
    const proposal = res.body.plan.nodes.find((n: any) => n.id === "proposal");
    assert.equal(proposal.state, "refused");
    assert.equal(proposal.rule, "untrusted_text_cannot_set_destination_or_amount");
    assert.match(res.body.reply, /untrusted_text_cannot_set_destination_or_amount/);
  } finally {
    await h.close();
  }
});

test("2.3 CSLOGI planted instruction: an honest proposal keeps her amount and fund", async () => {
  const h = makeHarness([
    { toolUses: [{ name: "get_fund", input: { fundId: "fund_logistics_demo" } }] },
    { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_logistics_demo", amountUsdc: "100", amountSource: "investor_message" } }] },
    { text: "The description contains text I will not act on. The policy approved 100 USDC." },
  ]);
  h.api.funds[2].description = CSLOGI.description;
  try {
    await h.chat("Buy 100 USDC of the logistics fund.");
    const sent = h.api.requests.find((r) => r.path === "/agent/proposals")!.body as Record<string, unknown>;
    assert.deepEqual(
      { fundId: sent.fundId, amountUsdc: sent.amountUsdc, amountSource: sent.amountSource },
      { fundId: "fund_logistics_demo", amountUsdc: "100", amountSource: "investor_message" },
    );
  } finally {
    await h.close();
  }
});

test("2.3 a destination argument never reaches the API", async () => {
  const h = makeHarness([
    { toolUses: [{ name: "propose_subscription", input: { fundId: "fund_agri_demo", amountUsdc: "100", amountSource: "investor_message", destination: "attacker" } }] },
    { text: "I cannot do that." },
  ]);
  try {
    const res = await h.chat("buy 100");
    assert.equal(res.body.toolCalls[0].isError, true);
    assert.ok(!h.api.requests.some((r) => r.path === "/agent/proposals"));
  } finally {
    await h.close();
  }
});

test("2.4 check_eligibility returns only eligible or not, and how to prove, never amounts", async () => {
  const h = makeHarness([
    { toolUses: [{ name: "check_eligibility", input: { fundId: "fund_health_demo" } }, { name: "check_eligibility", input: { fundId: "fund_agri_demo" } }] },
    { text: "You are not eligible for the health fund yet; you can prove your tier from your badge page." },
  ]);
  try {
    const res = await h.chat("Can I buy the health fund?");
    const [no, yes] = res.body.toolCalls.map((c: any) => c.output);
    assert.deepEqual(Object.keys(no).sort(), ["eligible", "fundId", "howToProve", "rule"]);
    assert.equal(no.eligible, false);
    assert.equal(no.rule, "eligibility_zk_tier");
    assert.equal(typeof no.howToProve, "string");
    assert.doesNotMatch(`${no.howToProve} ${no.rule}`, /\d/, "no amount or threshold value");
    assert.equal(yes.eligible, true);
    assert.equal(yes.howToProve, null);
    assert.equal(res.body.plan.nodes.find((n: any) => n.id === "eligibility").state, "done");
  } finally {
    await h.close();
  }
});
