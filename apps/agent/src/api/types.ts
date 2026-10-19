// Shapes of the Countersign API responses the agent reads. Mirrors
// apps/api/src/routes/{fund,order,mandate,agent}.ts and
// apps/api/src/policy/schema.ts as of 2026-10-18. Only the fields the agent
// uses are typed; anything else is ignored by the projections.

/** Mirror of mandateShape in apps/api/src/policy/schema.ts (do not redefine, keep in sync). */
export const SECTORS = ["AGRO", "VAREJO", "INDUSTRIA", "SERVICOS", "TECH", "SAUDE", "OUTROS"] as const;
export const LOSS_TOLERANCES = ["LOW", "MEDIUM", "HIGH"] as const;
export type Sector = (typeof SECTORS)[number];
export type LossTolerance = (typeof LOSS_TOLERANCES)[number];

export interface RecurringDraft {
  amountUsdc: string;
  everyDays: number;
  fundIds: string[];
}

export interface MandateDraft {
  residences?: string[];
  horizonMonths?: number;
  liquidityNeedPct?: number;
  liquidityWithinMonths?: number;
  maxLossTolerance?: LossTolerance;
  totalAmountUsdc?: string;
  perPurchaseCapUsdc?: string;
  periodCapUsdc?: string;
  periodDays?: number;
  allowedSectors?: Sector[];
  maxPerSectorPct?: number;
  recurring?: RecurringDraft;
}

/** Required fields of a complete mandate, in the order the agent asks for them. */
export const MANDATE_REQUIRED_FIELDS = [
  "residences",
  "horizonMonths",
  "liquidityNeedPct",
  "liquidityWithinMonths",
  "maxLossTolerance",
  "totalAmountUsdc",
  "perPurchaseCapUsdc",
  "periodCapUsdc",
  "periodDays",
  "allowedSectors",
  "maxPerSectorPct",
] as const;

export interface MandateIssue {
  path: string;
  message: string;
}

/** GET and PUT /api/mandates/draft */
export interface DraftResponse {
  draft: MandateDraft | null;
  complete: boolean;
  mandateHash: string | null;
  missing: MandateIssue[] | null;
}

/** GET /api/mandates */
export interface MandateOverviewResponse extends DraftResponse {
  approved: {
    version: number;
    mandateHash: string;
    approvedAt: string | null;
    onChainTxHash: string | null;
    mandate: MandateDraft;
  } | null;
  onChainMandateHash: string | null;
  active: boolean;
}

/** One item of GET /api/funds (funds[]) */
export interface FundListItem {
  id: string;
  name: string;
  symbol: string;
  status: string;
  maxSupply: number;
  totalIssued: number;
  price: number;
  fundType?: string | null;
  description?: string | null;
  riskLevel?: string | null;
  sector?: string | null;
  durationMonths?: number | null;
  minTicket?: number | null;
  availableQuotas?: number;
}

/** GET /api/funds/:id (fund) */
export interface FundDetail extends FundListItem {
  investorProfile?: string | null;
  sectorFocus?: string | null;
  eligibilityCriteria?: string | null;
  maxCedenteConcentrationPercent?: number | null;
  maxSacadoConcentrationPercent?: number | null;
  sectorConcentrationPercent?: number | null;
  keyRisks?: string | null;
  liquidityType?: string | null;
  lockupDays?: number | null;
  redemptionTerms?: string | null;
  tokenContractId?: string | null;
  fundWalletPublicKey?: string | null;
  totalReceivables?: number;
  receivables?: Array<{ id: string; faceValue: number; status: string; dueDate: string | null }>;
}

/** GET /api/agent/eligibility/:fundId */
export interface EligibilityResponse {
  eligible: boolean;
  rule: string;
  howToProve: string | null;
}

/** Body of POST /api/agent/proposals: exactly these five keys, no destination. */
export interface ProposalBody {
  fundId: string;
  amountUsdc: string;
  /** "investor_message" | "mandate"; "unverified_by_agent" when the agent could not verify the claim (the policy refuses it). */
  amountSource: string;
  origin: "chat" | "recurring";
  toolCallId: string;
}

export type ProposalOutcome = "APPROVED" | "REJECTED" | "NEEDS_INVESTOR_SIGNATURE";

/** Response of POST /api/agent/proposals */
export interface ProposalResponse {
  outcome: ProposalOutcome;
  rule: string;
  seq: number;
  hash: string;
  explanation: string;
  howToProve?: string;
}

/** One item of GET /api/orders (orders[]) */
export interface OrderItem {
  id: string;
  quantity: number;
  price: number;
  total: number;
  status: string;
  approvalStatus: string;
  txHash: string | null;
  /** Hash of the APPROVED decision log row the order executes (agent purchases only). */
  decisionHash?: string | null;
  createdAt: string;
  updatedAt?: string;
  fund: { id: string; name: string; symbol: string; price: number };
}

/** One item of GET /api/orders/holdings (holdings[]) */
export interface HoldingItem {
  id: string;
  name: string;
  symbol: string;
  shares: number | null;
}
