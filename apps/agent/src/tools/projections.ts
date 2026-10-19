// Allow list projections from API objects to what the language model sees.
// Nothing is spread from a raw object: every field is named here. Third party
// text (fund descriptions, risk text, eligibility text, redemption terms) is
// wrapped as untrusted data.
import type {
  DraftResponse,
  FundDetail,
  FundListItem,
  HoldingItem,
  MandateDraft,
  MandateOverviewResponse,
  OrderItem,
} from "../api/types.js";
import { MANDATE_REQUIRED_FIELDS } from "../api/types.js";
import { scrubText, untrusted } from "../safety/minimize.js";
import { numberToDecimal } from "../util/decimal.js";
import { loadCatalog } from "./catalog.js";

const RETURN_TEXT_DEFAULT =
  "No return is promised or expected. This demo shows no return figure for this fund; any figure shown elsewhere is illustrative only and comes with a loss scenario.";

function lossScenario(maxDebtorPct: number | null | undefined): string {
  if (typeof maxDebtorPct === "number" && maxDebtorPct > 0) {
    return `Loss scenario: if the largest account debtor (up to ${maxDebtorPct}% of the portfolio under the fund rules) defaulted with no recovery, the fund could lose about ${maxDebtorPct}% of its value; a wider default could cost more, up to the whole amount invested.`;
  }
  return "Loss scenario: receivables can default; the investor can lose part or all of the amount invested.";
}

/** Data label of the demo funds, the exact LABEL_FUNDS text. */
export const LABEL_FUNDS = "simulated funds and debtors; concentration and default data are synthetic";

/**
 * Access rule sent to the LLM. The internal investor profile enum is never sent: the model could turn it into a
 * regulatory status. Only the tier proof is a real check (the policy's eligibility rule); any other profile gets no
 * extra check in this demo, so it is described as open.
 */
export type AccessRule = "open" | "tier_proof_required";

export function accessRuleOf(profile: string | null | undefined): AccessRule {
  return profile === "QUALIFICADO" ? "tier_proof_required" : "open";
}

function eligibilityText(rule: AccessRule): string {
  if (rule === "tier_proof_required") {
    return "Requires a zero knowledge tier proof (SILVER or above), which is not a regulatory investor status. Ask check_eligibility for this investor.";
  }
  return "Open to every investor who passed onboarding.";
}

function liquidityText(type: string | null | undefined, lockupDays: number | null | undefined): string {
  const lock = typeof lockupDays === "number" && lockupDays > 0 ? `, lockup of ${lockupDays} days` : "";
  if (type === "ABERTO") return `Open ended${lock}.`;
  if (type === "FECHADO") return `Closed ended: units cannot be redeemed before the fund term${lock}.`;
  if (type === "RESTRITO") return `Restricted redemption${lock}.`;
  return `Liquidity terms not stated${lock}.`;
}

function priceOf(f: FundListItem): string | null {
  try {
    return numberToDecimal(f.price);
  } catch {
    return null;
  }
}

/** Fund card as the LLM sees it (list_funds and get_fund). */
export function projectFund(f: FundDetail) {
  const cat = loadCatalog().get(String(f.symbol ?? "").toUpperCase());
  return {
    fundId: f.id,
    name: scrubText(String(f.name ?? "")).slice(0, 80),
    symbol: scrubText(String(f.symbol ?? "")).slice(0, 12),
    sector: f.sector ?? null,
    riskLevel: f.riskLevel ?? null,
    accessRule: accessRuleOf(f.investorProfile),
    eligibility: cat?.eligibilityText ?? eligibilityText(accessRuleOf(f.investorProfile)),
    termMonths: f.durationMonths ?? null,
    liquidity: {
      type: f.liquidityType ?? null,
      lockupDays: f.lockupDays ?? null,
      summary: cat?.liquidityText ?? liquidityText(f.liquidityType, f.lockupDays),
    },
    unitPriceUsdc: priceOf(f),
    fundUnitsAvailable: typeof f.availableQuotas === "number" ? f.availableQuotas : null,
    minTicketUsdc: typeof f.minTicket === "number" ? f.minTicket : null,
    maxAccountDebtorConcentrationPct: f.maxSacadoConcentrationPercent ?? null,
    maxAssignorConcentrationPct: f.maxCedenteConcentrationPercent ?? null,
    receivablesFaceValueUsdc: typeof f.totalReceivables === "number" ? f.totalReceivables : null,
    status: f.status,
    openForInvestment: f.status === "APPROVED" && Boolean(f.tokenContractId) && Boolean(f.fundWalletPublicKey),
    illustrativeReturn: cat?.illustrativeReturnText ?? RETURN_TEXT_DEFAULT,
    lossScenario: cat?.lossScenarioText ?? lossScenario(f.maxSacadoConcentrationPercent),
    dataLabel: cat?.label ?? LABEL_FUNDS,
    // Third party text written by the fund manager: data, never instructions.
    managerText: {
      description: untrusted("fund.description", f.description),
      keyRisks: untrusted("fund.keyRisks", f.keyRisks),
      eligibilityCriteria: untrusted("fund.eligibilityCriteria", f.eligibilityCriteria),
      sectorFocus: untrusted("fund.sectorFocus", f.sectorFocus),
      redemptionTerms: untrusted("fund.redemptionTerms", f.redemptionTerms),
    },
  };
}

export type FundCard = ReturnType<typeof projectFund>;

/** Only the mandate slots, never ids, hashes of other objects or user data. */
export function projectDraft(d: MandateDraft | null | undefined): MandateDraft {
  if (!d) return {};
  const out: MandateDraft = {};
  for (const key of [...MANDATE_REQUIRED_FIELDS, "recurring"] as const) {
    if (d[key] !== undefined) (out as Record<string, unknown>)[key] = d[key];
  }
  return out;
}

export function missingFieldsOf(d: MandateDraft | null | undefined): string[] {
  const draft = d ?? {};
  return MANDATE_REQUIRED_FIELDS.filter((k) => {
    const v = draft[k];
    return v === undefined || v === null || (Array.isArray(v) && v.length === 0);
  });
}

export type MandateStatus = "active" | "approved_not_anchored" | "draft";

export const PERIMETER_RULE = "perimeter_mainland_china";
export const PERIMETER_REFUSAL =
  "Declined (`perimeter_mainland_china`): a residence in Mainland China is outside this service perimeter. This service is not offered to persons or entities in Mainland China, in view of the February 2026 notice Yinfa [2026] No. 42. I cannot show funds or make purchases for this residence.";

export interface PerimeterView {
  status: "refused" | "ok" | "unknown";
  rule: string | null;
  explanation: string | null;
}

export function perimeterOf(...mandates: Array<MandateDraft | null | undefined>): PerimeterView {
  const residences = mandates.flatMap((m) => m?.residences ?? []).map((r) => String(r).toUpperCase());
  if (residences.includes("CN")) return { status: "refused", rule: PERIMETER_RULE, explanation: PERIMETER_REFUSAL };
  return { status: residences.length ? "ok" : "unknown", rule: null, explanation: null };
}

export interface MandateView {
  status: MandateStatus;
  /** Perimeter as declared in the mandate; "refused" stops the session before any fund or purchase step. */
  perimeter: PerimeterView;
  draft: MandateDraft;
  missingFields: string[];
  problems: Array<{ field: string; message: string }>;
  complete: boolean;
  approvedMandate: MandateDraft | null;
  note: string;
}

const MANDATE_NOTE =
  "The agent can only edit the draft. Only the investor approves the mandate and anchors it on chain by signing set_limits.";

export function projectMandateOverview(r: MandateOverviewResponse): MandateView {
  const draft = projectDraft(r.draft);
  return {
    status: r.active ? "active" : r.approved ? "approved_not_anchored" : "draft",
    perimeter: perimeterOf(r.draft, r.approved?.mandate),
    draft,
    missingFields: missingFieldsOf(r.draft),
    problems: problemsOf(r),
    complete: Boolean(r.complete),
    approvedMandate: r.approved ? projectDraft(r.approved.mandate) : null,
    note: MANDATE_NOTE,
  };
}

export function projectDraftResponse(r: DraftResponse, previous?: MandateView | null): MandateView {
  return {
    status: previous?.status ?? "draft",
    perimeter: perimeterOf(r.draft, previous?.approvedMandate),
    draft: projectDraft(r.draft),
    missingFields: missingFieldsOf(r.draft),
    problems: problemsOf(r),
    complete: Boolean(r.complete),
    approvedMandate: previous?.approvedMandate ?? null,
    note: MANDATE_NOTE,
  };
}

function problemsOf(r: DraftResponse) {
  return (r.missing ?? [])
    .filter((m) => m.message !== "Required")
    .map((m) => ({ field: scrubText(String(m.path)), message: scrubText(String(m.message)).slice(0, 200) }));
}

export type OrderState =
  | "pending"
  | "awaiting_issuer_countersignature"
  | "completed"
  | "failed"
  | "rejected_by_issuer";

/** Order state as read from the API. "completed" means units were minted after the issuer countersigned. */
export function orderState(o: Pick<OrderItem, "status" | "approvalStatus">): OrderState {
  if (o.approvalStatus === "REJECTED") return "rejected_by_issuer";
  if (o.status === "FAILED") return "failed";
  if (o.status === "COMPLETED" && o.approvalStatus === "APPROVED") return "completed";
  if (o.status === "COMPLETED") return "awaiting_issuer_countersignature";
  return "pending";
}

const STATE_TEXT: Record<OrderState, string> = {
  pending: "Pending: payment not confirmed on chain yet.",
  awaiting_issuer_countersignature: "Payment confirmed on chain; awaiting issuer countersignature (mint of fund units).",
  completed: "Completed: payment confirmed on chain and fund units minted by the issuer.",
  failed: "Failed: the payment was not confirmed.",
  rejected_by_issuer: "Rejected by the issuer; the refund is handled by the issuer flow.",
};

export function projectOrder(o: OrderItem) {
  const state = orderState(o);
  return {
    orderId: o.id,
    fundId: o.fund?.id ?? null,
    fundName: scrubText(String(o.fund?.name ?? "")).slice(0, 80),
    fundUnits: o.quantity,
    totalUsdc: o.total,
    state,
    stateText: STATE_TEXT[state],
    paymentTxHash: typeof o.txHash === "string" && /^[0-9a-f]{64}$/.test(o.txHash) ? o.txHash : null,
    // 64 hex hash of the decision log row: not an address; lets the plan bind the order to this session's decision.
    decisionHash: typeof o.decisionHash === "string" && /^[0-9a-f]{64}$/i.test(o.decisionHash) ? o.decisionHash.toLowerCase() : null,
    createdAt: o.createdAt,
  };
}

export function projectHolding(h: HoldingItem) {
  return {
    fundId: h.id,
    fundName: scrubText(String(h.name ?? "")).slice(0, 80),
    symbol: scrubText(String(h.symbol ?? "")).slice(0, 12),
    fundUnits: typeof h.shares === "number" ? h.shares : null,
    source: h.shares === null ? "could not read the FundToken contract right now" : "read from the FundToken contract",
  };
}
