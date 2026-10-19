import './setupEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, sha256Hex, toUnits, unitsToDecimal } from '../canonical.js';
import { chainHash, ZERO_HASH, type LogPayload } from '../decisionLog.js';
import { mandateHash, canonicalMandateJson } from '../mandate.js';
import { mandateSchema } from '../schema.js';
import { baseMandate } from './helpers.js';

test('canonical: sorted keys, no spaces, undefined omitted, null kept', () => {
  assert.equal(canonical({ b: 1, a: 'x', c: undefined, d: null, e: [2, { z: true, y: false }] }), '{"a":"x","b":1,"d":null,"e":[2,{"y":false,"z":true}]}');
});

test('canonical: floats, bigint and NaN are refused (money must be unit strings)', () => {
  assert.throws(() => canonical({ amount: 0.1 }));
  assert.throws(() => canonical({ amount: 10n as unknown as number }));
  assert.throws(() => canonical(NaN));
  assert.throws(() => canonical(-0));
});

test('units: exact integer arithmetic, 0.1 + 0.2 equals 0.3 in units', () => {
  assert.equal(toUnits('0.1') + toUnits('0.2'), toUnits('0.3'));
  assert.equal(toUnits(0.1) + toUnits(0.2), toUnits(0.3));
  assert.equal(toUnits('12.5'), 125_000_000n);
  assert.equal(unitsToDecimal(125_000_000n), '12.5');
  assert.throws(() => toUnits('1.12345678'));
  assert.throws(() => toUnits('-1'));
  assert.throws(() => toUnits('1e3'));
});

test('mandate hash: independent of key and list order, money as units', () => {
  const a = mandateSchema.parse(baseMandate({ residences: ['de', 'PT'], allowedSectors: ['VAREJO', 'AGRO'] }));
  const b = mandateSchema.parse({ ...baseMandate({ residences: ['PT', 'DE'], allowedSectors: ['AGRO', 'VAREJO'] }), totalAmountUsdc: 1000 });
  assert.equal(mandateHash(a), mandateHash(b));
  assert.match(mandateHash(a), /^[0-9a-f]{64}$/);
  assert.ok(canonicalMandateJson(a).includes('"totalAmountUsdc":"10000000000"'));
  const c = mandateSchema.parse(baseMandate({ perPurchaseCapUsdc: '300.0000001' }));
  assert.notEqual(mandateHash(a), mandateHash(c));
});

test('chain hash: sha256(prevHash bytes || canonical(payload))', () => {
  const payload: LogPayload = {
    kind: 'decision', seq: 1, userId: 'u', at: '2026-10-18T12:00:00.000Z', origin: 'chat', fundId: 'f',
    amountUnits: '10000000', rule: 'all_rules_passed', outcome: 'APPROVED', mandateHash: null, toolCallId: 't',
  };
  const expected = sha256Hex(Buffer.concat([Buffer.alloc(32), Buffer.from(canonical(payload), 'utf8')]));
  assert.equal(chainHash(ZERO_HASH, payload), expected);
  assert.equal(Buffer.from(expected, 'hex').length, 32);
});
