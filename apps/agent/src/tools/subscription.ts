// Quote, proposal and status tools. The quote is deterministic code (S5). The
// proposal goes to the L1 policy, which decides and writes one hash chained
// log row (S7). The status tools read the real state; the agent never infers
// "done" on its own.
import { z } from "zod";
import type { HoldingItem, MandateOverviewResponse, OrderItem, ProposalBody, ProposalResponse } from "../api/types.js";
import { divideUnits, fromUnits, numberToDecimal, toUnits } from "../util/decimal.js";
import { fetchFund } from "./funds.js";
import { apiFailure } from "./mandate.js";
import { projectDraft, projectHolding, projectOrder } from "./projections.js";
import {
  AMOUNT_PROP,
  AMOUNT_SOURCE_PROP,
  EMPTY_INPUT,
  FUND_ID_PROP,
  amountSourceSchema,
  emptyInput,
  fundIdSchema,
  usdcString,
} from "./schema.js";
import { ToolError, type AgentTool } from "./types.js";
import { ruleGuidance } from "../agent/rules.js";
import { verifiedSource } from "../agent/provenance.js";

const AmountInput = z.object({ fundId: fundIdSchema, amountUsdc: usdcString, amountSource: amountSourceSchema }).strict();
type AmountInput = z.infer<typeof AmountInput>;

const AMOUNT_SCHEMA = {
  type: "object" as const,
  properties: { fundId: FUND_ID_PROP, amountUsdc: AMOUNT_PROP, amountSource: AMOUNT_SOURCE_PROP },
  required: ["fundId", "amountUsdc", "amountSource"],
  additionalProperties: false as const,
};

function remaining(capUsdc: string | undefined, amountUnits: bigint) {
  if (!capUsdc) return null;
  return fromUnits(toUnits(capUsdc) - amountUnits);
}

export const quoteSubscription: AgentTool<AmountInput, Record<string, unknown>> = {
  name: "quote_subscription",
  description:
    "Quote a subscription: fund units = amount / unit price (USDC, rounded down to 7 decimals), total in USDC, fund units available, and how much room is left under the mandate's per purchase cap. No currency conversion. This does not buy anything.",
  inputSchema: AMOUNT_SCHEMA,
  input: AmountInput,
  async run(input, ctx) {
    let overview: MandateOverviewResponse | null = null;
    const [fund] = await Promise.all([
      fetchFund(ctx.api, input.fundId),
      ctx.api
        .get<MandateOverviewResponse>("/mandates")
        .then((m) => {
          overview = m;
        })
        .catch(() => undefined),
    ]);
    let priceUnits: bigint;
    try {
      priceUnits = toUnits(numberToDecimal(fund.price));
    } catch {
      throw new ToolError("This fund has no valid unit price; it cannot be quoted.");
    }
    if (priceUnits <= 0n) throw new ToolError("This fund has no valid unit price; it cannot be quoted.");

    const amountUnits = toUnits(input.amountUsdc);
    const units = divideUnits(amountUnits, priceUnits);
    const mo = overview as MandateOverviewResponse | null;
    const caps = mo?.approved ? projectDraft(mo.approved.mandate) : projectDraft(mo?.draft ?? ctx.mandate?.draft);
    const capsSource = mo?.approved ? "approved mandate" : caps.perPurchaseCapUsdc ? "mandate draft (not approved yet)" : "none";
    const available = typeof fund.availableQuotas === "number" ? fund.availableQuotas : null;

    return {
      fundId: fund.id,
      fundName: String(fund.name ?? "").slice(0, 80),
      amountUsdc: fromUnits(amountUnits),
      amountSource: input.amountSource,
      unitPriceUsdc: fromUnits(priceUnits),
      fundUnits: fromUnits(units),
      totalUsdc: fromUnits(amountUnits),
      fundUnitsAvailable: available,
      exceedsUnitsAvailable: available !== null ? units > toUnits(numberToDecimal(Math.max(available, 0))) : null,
      capsSource,
      perPurchaseCapUsdc: caps.perPurchaseCapUsdc ?? null,
      perPurchaseCapRemainingUsdc: remaining(caps.perPurchaseCapUsdc, amountUnits),
      periodCapUsdc: caps.periodCapUsdc ?? null,
      periodDays: caps.periodDays ?? null,
      periodCapRemainingUsdc: null,
      periodNote:
        "What is already spent in the current period is read by the policy from the mandate wallet contract when the proposal is made.",
      currency: "USDC on Stellar testnet, no conversion",
      note: "A quote is not a purchase. Nothing was proposed or bought.",
    };
  },
};

export const proposeSubscription: AgentTool<AmountInput, Record<string, unknown>> = {
  name: "propose_subscription",
  description:
    "Send ONE purchase proposal (fund and amount) to the policy. The amount must be written in digits in the investor's own message (amountSource investor_message) or be an amount of her mandate (amountSource mandate); the platform verifies this, and an amount it cannot trace to her is refused by the policy. The policy checks perimeter, eligibility, the fund, the mandate caps and the amount source, writes one hash chained decision log row and answers APPROVED, REJECTED or NEEDS_INVESTOR_SIGNATURE with the rule name. The destination is always the fund wallet registered by the platform; there is no destination argument. This does not move money.",
  inputSchema: AMOUNT_SCHEMA,
  input: AmountInput,
  async run(input, ctx) {
    // The declared amountSource is verified against the session; if it cannot be, the policy decides and logs it.
    const provenance = verifiedSource({
      amountUsdc: input.amountUsdc,
      amountSource: input.amountSource,
      investorMessages: ctx.investorMessages,
      mandates: [ctx.mandate?.approvedMandate, ctx.mandate?.draft],
    });
    const body: ProposalBody = {
      fundId: input.fundId,
      amountUsdc: input.amountUsdc,
      amountSource: provenance.source,
      origin: ctx.origin,
      toolCallId: ctx.toolUseId,
    };
    let r: ProposalResponse;
    try {
      r = await ctx.api.post<ProposalResponse>("/agent/proposals", body);
    } catch (err) {
      apiFailure("Sending the proposal to the policy", err);
    }
    return {
      fundId: input.fundId,
      amountUsdc: input.amountUsdc,
      amountSourceVerified: provenance.verified,
      outcome: r.outcome,
      rule: r.rule,
      decisionSeq: r.seq,
      decisionHash: r.hash,
      explanation: r.explanation,
      ...(r.howToProve ? { howToProve: r.howToProve } : {}),
      whatTheInvestorCanDo: ruleGuidance(r.rule, r.outcome),
      moneyMoved: false,
    };
  },
};

export const getStatus: AgentTool<z.infer<typeof emptyInput>, Record<string, unknown>> = {
  name: "get_status",
  description:
    "Read the real state of the investor's latest orders from the platform: pending, awaiting issuer countersignature (payment confirmed on chain, units not minted yet), completed (units minted), failed, or rejected by the issuer. Call this before saying anything about whether a purchase happened.",
  inputSchema: EMPTY_INPUT,
  input: emptyInput,
  async run(_input, ctx) {
    try {
      const r = await ctx.api.get<{ orders: OrderItem[] }>("/orders");
      const orders = (r.orders ?? []).slice(0, 10).map(projectOrder);
      return { orders, count: orders.length, readAt: new Date().toISOString() };
    } catch (err) {
      apiFailure("Reading order status", err);
    }
  },
};

export const getHoldings: AgentTool<z.infer<typeof emptyInput>, Record<string, unknown>> = {
  name: "get_holdings",
  description: "Read the investor's fund units, as balances read from each fund's FundToken contract.",
  inputSchema: EMPTY_INPUT,
  input: emptyInput,
  async run(_input, ctx) {
    try {
      const r = await ctx.api.get<{ holdings: HoldingItem[] }>("/orders/holdings");
      return { holdings: (r.holdings ?? []).map(projectHolding) };
    } catch (err) {
      apiFailure("Reading holdings", err);
    }
  },
};
