import { InvestorBadge, TIER_THRESHOLDS_CENTS } from '../services/zkBadge.js';
import { toUnits } from './canonical.js';
import { AMOUNT_SOURCES, TOLERANCE_TO_RISK, type Mandate } from './schema.js';

/**
 * L1 policy: pure, deterministic functions. No I/O, no clock, no randomness: the same context always gives the
 * same decision. Everything they need (mandate, fund row, on-chain reads) is gathered beforehand by context.ts.
 *
 * Honest boundary: this runs on OUR SERVER. A bug here can approve a proposal it should not; the second line is
 * the mandate wallet contract on Stellar (approved destinations, caps, decision reuse), not audited. "First
 * purchase needs the investor" is enforced by the wallet contract (it does not pay a fund wallet outside its
 * allowlist and only the owner calls allow_fund); the rule below only recognises that situation.
 *
 * Evaluation order is the order of RULE_ORDER; the first refusal wins and is the rule written to the log.
 * Rule names are stable: they appear in the log, the test suites and the video.
 */

export const RULES = {
  perimeter: 'perimeter_mainland_china',
  mandateNotActive: 'mandate_not_active',
  fundNotInvestable: 'fund_not_investable',
  eligibility: 'eligibility_zk_tier',
  purchaseCap: 'amount_over_purchase_cap',
  periodCap: 'amount_over_period_cap',
  sectorNotAllowed: 'sector_not_allowed',
  sectorConcentration: 'sector_concentration',
  risk: 'risk_above_tolerance',
  liquidity: 'liquidity_mismatch',
  untrusted: 'untrusted_text_cannot_set_destination_or_amount',
  recurring: 'recurring_outside_mandate',
  firstPurchase: 'first_purchase_needs_investor',
  approved: 'all_rules_passed',
  /** Checked right before executing an APPROVED decision (POST /api/agent/proposals/:seq/execute), not at proposal */
  agentRevoked: 'agent_revoked',
  /** An APPROVED decision older than DECISION_TTL_MS is not executed; a new proposal is required */
  decisionExpired: 'decision_expired',
} as const;

/** How long an APPROVED decision may be executed after it was written to the log */
export const DECISION_TTL_MS = 15 * 60 * 1000;

export const RULE_ORDER = [
  RULES.perimeter,
  RULES.mandateNotActive,
  RULES.fundNotInvestable,
  RULES.eligibility,
  RULES.purchaseCap,
  RULES.periodCap,
  RULES.sectorNotAllowed,
  RULES.sectorConcentration,
  RULES.risk,
  RULES.liquidity,
  RULES.untrusted,
  RULES.recurring,
  RULES.firstPurchase,
] as const;

export type Outcome = 'APPROVED' | 'REJECTED' | 'NEEDS_INVESTOR_SIGNATURE';

export interface Decision {
  rule: string;
  outcome: Outcome;
  explanation: string;
  howToProve?: string;
}

export interface FundFacts {
  id: string;
  status: string;
  tokenContractId: string | null;
  fundWalletPublicKey: string | null;
  investorProfile: string | null;
  riskLevel: string | null;
  sector: string | null;
  liquidityType: string | null;
  lockupDays: number | null;
}

export interface Position {
  sector: string | null;
  liquidityType: string | null;
  lockupDays: number | null;
  units: bigint;
}

export interface ProposalFacts {
  fundId: string;
  amountUnits: bigint;
  amountSource: string;
  origin: 'chat' | 'recurring';
  toolCallId: string;
  /** Keys of the request body beyond the five allowed ones (e.g. "destination") */
  extraKeys: string[];
}

export interface PolicyContext {
  proposal: ProposalFacts;
  /** Residences declared in the draft and in the latest approved mandate */
  declaredResidences: string[];
  /** Latest approved mandate and its hash */
  mandate: Mandate | null;
  approvedHash: string | null;
  /** mandate_hash() read from the investor's wallet contract; null when there is no wallet */
  onChainMandateHash: string | null;
  fund: FundFacts | null;
  /** badge(owner).threshold in cents, null when there is no badge (only read for QUALIFICADO funds) */
  badgeThresholdCents: number | null;
  /** spent_in_period() read from the wallet contract, in units */
  spentInPeriodUnits: bigint;
  /** Current positions of the investor (paid orders) */
  positions: Position[];
  /** fund(fund_wallet) is Some in the wallet contract */
  fundAllowedOnChain: boolean;
}

export const HOW_TO_PROVE_TIER =
  'Prove your investment tier in zero knowledge: open your badge page, generate the proof in the browser ' +
  '(GET /api/badges/:userId/zk-witness), then submit the claim to the BadgeVerifier contract ' +
  '(POST /api/badges/:userId/zk-claim/build, sign, POST /api/badges/:userId/zk-claim/confirm). ' +
  'This fund requires the SILVER tier or above. The tier is not a regulatory investor status.';

const RISK_RANK: Record<string, number> = { BAIXO: 0, MEDIO: 1, ALTO: 2 };
/** Unknown or missing risk level is treated as the highest (fail closed) */
export const riskRank = (risk: string | null) => (risk && risk in RISK_RANK ? RISK_RANK[risk] : 2);

export const DAYS_PER_MONTH = 30;

/** A fund is illiquid for this mandate if it is closed or its lockup exceeds the liquidity window */
export function isIlliquid(f: { liquidityType: string | null; lockupDays: number | null }, withinMonths: number): boolean {
  return f.liquidityType === 'FECHADO' || (f.lockupDays ?? 0) > withinMonths * DAYS_PER_MONTH;
}

const reject = (rule: string, explanation: string, howToProve?: string): Decision => ({
  rule,
  outcome: 'REJECTED',
  explanation,
  ...(howToProve ? { howToProve } : {}),
});

// Each check returns a refusal or null. They are evaluated strictly in RULE_ORDER.

export function checkPerimeter(ctx: PolicyContext): Decision | null {
  if (!ctx.declaredResidences.map((r) => r.toUpperCase()).includes('CN')) return null;
  return reject(
    RULES.perimeter,
    'Declined: a residence in Mainland China is outside this service perimeter. The service is not offered to persons ' +
      'or entities in Mainland China, in view of the February 2026 notice Yinfa [2026] No. 42 on RWA tokenization.'
  );
}

export function checkMandateActive(ctx: PolicyContext): Decision | null {
  if (!ctx.mandate || !ctx.approvedHash) {
    return reject(RULES.mandateNotActive, 'There is no approved mandate. The investor must approve the mandate first.');
  }
  if (!ctx.onChainMandateHash) {
    return reject(RULES.mandateNotActive, 'The investor has no mandate wallet yet, so the mandate is not anchored on-chain.');
  }
  if (ctx.onChainMandateHash.toLowerCase() !== ctx.approvedHash.toLowerCase()) {
    return reject(
      RULES.mandateNotActive,
      'The mandate hash in the wallet contract differs from the approved mandate. The investor must sign set_limits.'
    );
  }
  return null;
}

export function checkFundInvestable(ctx: PolicyContext): Decision | null {
  const f = ctx.fund;
  if (f && f.status === 'APPROVED' && f.tokenContractId && f.fundWalletPublicKey) return null;
  return reject(RULES.fundNotInvestable, 'This fund is not open for investment (not approved, or without token or fund wallet).');
}

export function checkEligibility(ctx: PolicyContext): Decision | null {
  if (ctx.fund?.investorProfile !== 'QUALIFICADO') return null;
  const t = ctx.badgeThresholdCents;
  if (t !== null && t >= TIER_THRESHOLDS_CENTS[InvestorBadge.SILVER]) return null;
  return reject(RULES.eligibility, 'Not eligible for this fund yet: it requires a tier proven on-chain.', HOW_TO_PROVE_TIER);
}

export function checkPurchaseCap(ctx: PolicyContext): Decision | null {
  const cap = toUnits(ctx.mandate!.perPurchaseCapUsdc);
  if (ctx.proposal.amountUnits <= cap) return null;
  return reject(RULES.purchaseCap, `The amount is above the per purchase cap of the mandate (${ctx.mandate!.perPurchaseCapUsdc} USDC).`);
}

export function checkPeriodCap(ctx: PolicyContext): Decision | null {
  const cap = toUnits(ctx.mandate!.periodCapUsdc);
  if (ctx.spentInPeriodUnits + ctx.proposal.amountUnits <= cap) return null;
  return reject(
    RULES.periodCap,
    `The amount plus what the wallet already spent in this period is above the period cap (${ctx.mandate!.periodCapUsdc} USDC every ${ctx.mandate!.periodDays} days).`
  );
}

export function checkSectorAllowed(ctx: PolicyContext): Decision | null {
  const sector = ctx.fund!.sector;
  if (sector && (ctx.mandate!.allowedSectors as string[]).includes(sector)) return null;
  return reject(RULES.sectorNotAllowed, `The fund sector (${sector ?? 'unknown'}) is not in the sectors allowed by the mandate.`);
}

/** Exposure to the fund's sector after this purchase, against maxPerSectorPct of the mandate total */
export function checkSectorConcentration(ctx: PolicyContext): Decision | null {
  const m = ctx.mandate!;
  const sector = ctx.fund!.sector;
  const held = ctx.positions.filter((p) => p.sector === sector).reduce((s, p) => s + p.units, 0n);
  const after = held + ctx.proposal.amountUnits;
  if (after * 100n <= toUnits(m.totalAmountUsdc) * BigInt(m.maxPerSectorPct)) return null;
  return reject(RULES.sectorConcentration, `This purchase would put more than ${m.maxPerSectorPct}% of the mandate in the ${sector} sector.`);
}

export function checkRisk(ctx: PolicyContext): Decision | null {
  const limit = TOLERANCE_TO_RISK[ctx.mandate!.maxLossTolerance];
  if (riskRank(ctx.fund!.riskLevel) <= riskRank(limit)) return null;
  return reject(RULES.risk, `The fund risk level (${ctx.fund!.riskLevel ?? 'unknown'}) is above the loss tolerance of the mandate (${ctx.mandate!.maxLossTolerance}).`);
}

/** An illiquid purchase may only use the share of the mandate that is not reserved as liquidity */
export function checkLiquidity(ctx: PolicyContext): Decision | null {
  const m = ctx.mandate!;
  if (!isIlliquid(ctx.fund!, m.liquidityWithinMonths)) return null;
  const illiquidHeld = ctx.positions
    .filter((p) => isIlliquid(p, m.liquidityWithinMonths))
    .reduce((s, p) => s + p.units, 0n);
  const after = illiquidHeld + ctx.proposal.amountUnits;
  if (after * 100n <= toUnits(m.totalAmountUsdc) * BigInt(100 - m.liquidityNeedPct)) return null;
  return reject(
    RULES.liquidity,
    `The fund is closed or locked for longer than ${m.liquidityWithinMonths} months, and ${m.liquidityNeedPct}% of the mandate must stay available within that window.`
  );
}

export function checkUntrusted(ctx: PolicyContext): Decision | null {
  const p = ctx.proposal;
  if (p.extraKeys.length > 0) {
    return reject(
      RULES.untrusted,
      `The proposal carried fields that are not accepted (${p.extraKeys.join(', ')}). The destination is always the fund wallet registered in our database, never text.`
    );
  }
  if (!(AMOUNT_SOURCES as readonly string[]).includes(p.amountSource)) {
    return reject(RULES.untrusted, 'The amount must come from the mandate or from the investor in the chat.');
  }
  if (p.origin === 'recurring' && p.amountSource !== 'mandate') {
    return reject(RULES.untrusted, 'A recurring purchase takes its amount from the mandate only.');
  }
  return null;
}

export function checkRecurring(ctx: PolicyContext): Decision | null {
  if (ctx.proposal.origin !== 'recurring') return null;
  const r = ctx.mandate!.recurring;
  if (r && r.fundIds.includes(ctx.proposal.fundId) && toUnits(r.amountUsdc) === ctx.proposal.amountUnits) return null;
  return reject(RULES.recurring, 'This recurring purchase is not the one pre-authorised in the mandate (fund or amount differ).');
}

export function checkFirstPurchase(ctx: PolicyContext): Decision | null {
  if (ctx.fundAllowedOnChain) return null;
  return {
    rule: RULES.firstPurchase,
    outcome: 'NEEDS_INVESTOR_SIGNATURE',
    explanation:
      'First purchase in this fund: the investor must approve the fund wallet in her mandate wallet (allow_fund), signing it herself. The agent cannot do this.',
  };
}

const CHECKS: Array<[string, (ctx: PolicyContext) => Decision | null]> = [
  [RULES.perimeter, checkPerimeter],
  [RULES.mandateNotActive, checkMandateActive],
  [RULES.fundNotInvestable, checkFundInvestable],
  [RULES.eligibility, checkEligibility],
  [RULES.purchaseCap, checkPurchaseCap],
  [RULES.periodCap, checkPeriodCap],
  [RULES.sectorNotAllowed, checkSectorAllowed],
  [RULES.sectorConcentration, checkSectorConcentration],
  [RULES.risk, checkRisk],
  [RULES.liquidity, checkLiquidity],
  [RULES.untrusted, checkUntrusted],
  [RULES.recurring, checkRecurring],
  [RULES.firstPurchase, checkFirstPurchase],
];

/** Runs the rules in order; the first refusal wins */
export function evaluate(ctx: PolicyContext): Decision {
  for (const [, check] of CHECKS) {
    const d = check(ctx);
    if (d) return d;
  }
  return { rule: RULES.approved, outcome: 'APPROVED', explanation: 'All policy rules passed. The wallet contract still enforces its own limits.' };
}

/** Only the eligibility rule, for GET /api/agent/eligibility/:fundId (does not write a decision) */
export function evaluateEligibility(fund: FundFacts, badgeThresholdCents: number | null) {
  const d = checkEligibility({ fund, badgeThresholdCents } as PolicyContext);
  return { eligible: d === null, rule: RULES.eligibility, howToProve: d ? HOW_TO_PROVE_TIER : null };
}

/** Exposed for the tests: the rule names of the checks in evaluation order */
export const CHECK_ORDER = CHECKS.map(([name]) => name);
