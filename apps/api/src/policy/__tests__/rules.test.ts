import './setupEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toUnits } from '../canonical.js';
import { CHECK_ORDER, evaluate, RULES, RULE_ORDER, type PolicyContext } from '../rules.js';
import { mandateSchema } from '../schema.js';
import { baseMandate } from './helpers.js';

const HASH = 'ab'.repeat(32);
function ctx(over: Partial<PolicyContext> = {}, proposal: Partial<PolicyContext['proposal']> = {}): PolicyContext {
  return {
    proposal: { fundId: 'f1', amountUnits: toUnits('100'), amountSource: 'investor_message', origin: 'chat', toolCallId: 't1', extraKeys: [], ...proposal },
    declaredResidences: ['DE'],
    mandate: mandateSchema.parse(baseMandate({ recurring: { amountUsdc: '50', everyDays: 30, fundIds: ['f1'] } })),
    approvedHash: HASH,
    onChainMandateHash: HASH,
    fund: {
      id: 'f1', status: 'APPROVED', tokenContractId: 'C', fundWalletPublicKey: 'G', investorProfile: 'GERAL',
      riskLevel: 'MEDIO', sector: 'AGRO', liquidityType: 'ABERTO', lockupDays: 0,
    },
    badgeThresholdCents: null,
    spentInPeriodUnits: 0n,
    positions: [],
    fundAllowedOnChain: true,
    ...over,
  };
}
const fund = (o: Partial<NonNullable<PolicyContext['fund']>>) => ({ ...ctx().fund!, ...o });

test('evaluation order is the order of the rule table', () => {
  assert.deepEqual(CHECK_ORDER, [...RULE_ORDER]);
});

test('all rules pass: APPROVED', () => {
  assert.equal(evaluate(ctx()).outcome, 'APPROVED');
  assert.equal(evaluate(ctx()).rule, RULES.approved);
});

test('perimeter: CN refused with Yinfa [2026] No. 42; HK, MO, TW are not CN', () => {
  const d = evaluate(ctx({ declaredResidences: ['DE', 'cn'] }));
  assert.equal(d.rule, 'perimeter_mainland_china');
  assert.equal(d.outcome, 'REJECTED');
  assert.ok(d.explanation.includes('Yinfa [2026] No. 42'));
  for (const r of ['HK', 'MO', 'TW']) assert.equal(evaluate(ctx({ declaredResidences: [r] })).outcome, 'APPROVED');
  // First refusal wins: perimeter comes before everything else
  assert.equal(evaluate(ctx({ declaredResidences: ['CN'], mandate: null, fund: null })).rule, RULES.perimeter);
});

test('mandate_not_active: no mandate, no wallet, or on-chain hash differs', () => {
  assert.equal(evaluate(ctx({ mandate: null, approvedHash: null })).rule, RULES.mandateNotActive);
  assert.equal(evaluate(ctx({ onChainMandateHash: null })).rule, RULES.mandateNotActive);
  assert.equal(evaluate(ctx({ onChainMandateHash: 'cd'.repeat(32) })).rule, RULES.mandateNotActive);
});

test('fund_not_investable', () => {
  assert.equal(evaluate(ctx({ fund: null })).rule, RULES.fundNotInvestable);
  assert.equal(evaluate(ctx({ fund: fund({ status: 'PENDING' }) })).rule, RULES.fundNotInvestable);
  assert.equal(evaluate(ctx({ fund: fund({ tokenContractId: null }) })).rule, RULES.fundNotInvestable);
  assert.equal(evaluate(ctx({ fund: fund({ fundWalletPublicKey: null }) })).rule, RULES.fundNotInvestable);
});

test('eligibility_zk_tier: QUALIFICADO needs a badge >= SILVER, with the way to prove', () => {
  const q = fund({ investorProfile: 'QUALIFICADO' });
  const none = evaluate(ctx({ fund: q, badgeThresholdCents: null }));
  assert.equal(none.rule, RULES.eligibility);
  assert.ok(none.howToProve && none.howToProve.includes('zk-claim'));
  assert.equal(evaluate(ctx({ fund: q, badgeThresholdCents: 0 })).rule, RULES.eligibility); // BRONZE
  assert.equal(evaluate(ctx({ fund: q, badgeThresholdCents: 100_000 })).outcome, 'APPROVED'); // SILVER
  assert.equal(evaluate(ctx({ fund: q, badgeThresholdCents: 1_000_000 })).outcome, 'APPROVED'); // GOLD
});

test('caps: per purchase and period (period spent read from the contract)', () => {
  assert.equal(evaluate(ctx({}, { amountUnits: toUnits('300') })).outcome, 'APPROVED');
  assert.equal(evaluate(ctx({}, { amountUnits: toUnits('300.0000001') })).rule, RULES.purchaseCap);
  assert.equal(evaluate(ctx({ spentInPeriodUnits: toUnits('400') }, { amountUnits: toUnits('100') })).outcome, 'APPROVED');
  assert.equal(evaluate(ctx({ spentInPeriodUnits: toUnits('400.0000001') }, { amountUnits: toUnits('100') })).rule, RULES.periodCap);
});

test('sector_not_allowed and sector_concentration', () => {
  assert.equal(evaluate(ctx({ fund: fund({ sector: 'TECH' }) })).rule, RULES.sectorNotAllowed);
  assert.equal(evaluate(ctx({ fund: fund({ sector: null }) })).rule, RULES.sectorNotAllowed);
  const held = [{ sector: 'AGRO', liquidityType: 'ABERTO', lockupDays: 0, units: toUnits('550') }];
  // 60% of 1000 = 600: 550 + 50 ok, 550 + 51 refused
  assert.equal(evaluate(ctx({ positions: held }, { amountUnits: toUnits('50') })).outcome, 'APPROVED');
  assert.equal(evaluate(ctx({ positions: held }, { amountUnits: toUnits('51') })).rule, RULES.sectorConcentration);
});

test('risk_above_tolerance (missing risk level counts as the highest)', () => {
  assert.equal(evaluate(ctx({ fund: fund({ riskLevel: 'ALTO' }) })).rule, RULES.risk);
  assert.equal(evaluate(ctx({ fund: fund({ riskLevel: null }) })).rule, RULES.risk);
  assert.equal(evaluate(ctx({ fund: fund({ riskLevel: 'BAIXO' }) })).outcome, 'APPROVED');
});

test('liquidity_mismatch: closed or long lockup only within the non liquid share', () => {
  // need 20% liquid within 6 months: illiquid budget = 800 of 1000
  const illiquid = [{ sector: 'VAREJO', liquidityType: 'FECHADO', lockupDays: 0, units: toUnits('750') }];
  assert.equal(evaluate(ctx({ fund: fund({ liquidityType: 'FECHADO' }), positions: illiquid }, { amountUnits: toUnits('50') })).outcome, 'APPROVED');
  assert.equal(evaluate(ctx({ fund: fund({ liquidityType: 'FECHADO' }), positions: illiquid }, { amountUnits: toUnits('51') })).rule, RULES.liquidity);
  assert.equal(evaluate(ctx({ fund: fund({ lockupDays: 181 }), positions: illiquid }, { amountUnits: toUnits('51') })).rule, RULES.liquidity);
  assert.equal(evaluate(ctx({ fund: fund({ lockupDays: 180 }), positions: illiquid }, { amountUnits: toUnits('51') })).outcome, 'APPROVED');
});

test('untrusted text cannot set destination or amount', () => {
  assert.equal(evaluate(ctx({}, { extraKeys: ['destination'] })).rule, RULES.untrusted);
  assert.equal(evaluate(ctx({}, { amountSource: 'fund_description' })).rule, RULES.untrusted);
  assert.equal(evaluate(ctx({}, { origin: 'recurring', amountSource: 'investor_message', amountUnits: toUnits('50') })).rule, RULES.untrusted);
});

test('recurring_outside_mandate', () => {
  const rec = { origin: 'recurring' as const, amountSource: 'mandate' };
  assert.equal(evaluate(ctx({}, { ...rec, amountUnits: toUnits('50') })).outcome, 'APPROVED');
  assert.equal(evaluate(ctx({}, { ...rec, amountUnits: toUnits('51') })).rule, RULES.recurring);
  assert.equal(evaluate(ctx({}, { ...rec, fundId: 'f2', amountUnits: toUnits('50') })).rule, RULES.recurring);
});

test('first_purchase_needs_investor: NEEDS_INVESTOR_SIGNATURE (tier Red)', () => {
  const d = evaluate(ctx({ fundAllowedOnChain: false }));
  assert.equal(d.rule, RULES.firstPurchase);
  assert.equal(d.outcome, 'NEEDS_INVESTOR_SIGNATURE');
});

test('deterministic: same context, same decision', () => {
  const c = ctx({ fund: fund({ sector: 'TECH' }) });
  assert.deepEqual(evaluate(c), evaluate(c));
});
