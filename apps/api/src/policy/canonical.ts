import crypto from 'crypto';

/**
 * Canonical serialization used for every hash of the policy layer (mandate hash and decision log chain).
 *
 *   canonical(value):
 *     object  -> "{" + keys sorted ascending by UTF-16 code unit (Array.prototype.sort default) +
 *                each as JSON.stringify(key) + ":" + canonical(value), joined by "," + "}"
 *                (keys whose value is undefined are omitted; null is kept as null)
 *     array   -> "[" + items in their given order, canonical(item), joined by "," + "]"
 *     string  -> JSON.stringify(string)
 *     number  -> only safe integers, written in base 10 (no floats, no exponent, no -0)
 *     boolean -> true | false
 *     null    -> null
 *   No whitespace anywhere. bigint, float, NaN, Infinity, undefined (top level), functions and symbols throw.
 *
 * Monetary values never enter as numbers: they are strings of integer units with 7 decimals
 * (1 USDC = "10000000"), produced by toUnits() below. The output is UTF-8 encoded before hashing.
 */
export function canonical(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        throw new Error(`canonical(): only safe integers are allowed, got ${String(value)}`);
      }
      return String(value);
    case 'object': {
      if (Array.isArray(value)) return '[' + value.map((v) => canonical(v)).join(',') + ']';
      if (value instanceof Date) throw new Error('canonical(): Date is not allowed, use an ISO string');
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
    }
    default:
      throw new Error(`canonical(): unsupported type ${typeof value}`);
  }
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export const UNIT_DECIMALS = 7;
const UNIT_SCALE = 10n ** BigInt(UNIT_DECIMALS);
const DECIMAL_RE = /^(0|[1-9]\d*)(\.\d{1,7})?$/;

/** True when the value is a non negative decimal with at most 7 decimals (as string or plain number) */
export function isDecimalAmount(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && DECIMAL_RE.test(String(value));
  return typeof value === 'string' && DECIMAL_RE.test(value);
}

/**
 * Exact conversion from a USDC decimal ("12.5" or 12.5) to integer units with 7 decimals (125000000n).
 * String based: no floating point arithmetic ever touches a cap comparison.
 */
export function toUnits(value: string | number): bigint {
  const text = typeof value === 'number' ? String(value) : value;
  if (!isDecimalAmount(text)) throw new Error(`Invalid amount: expected a decimal with at most 7 decimals`);
  const [whole, frac = ''] = text.split('.');
  return BigInt(whole) * UNIT_SCALE + BigInt(frac.padEnd(UNIT_DECIMALS, '0'));
}

/** Integer units back to a minimal decimal string ("125000000" -> "12.5") */
export function unitsToDecimal(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / UNIT_SCALE;
  const frac = (abs % UNIT_SCALE).toString().padStart(UNIT_DECIMALS, '0').replace(/0+$/, '');
  return (negative ? '-' : '') + whole.toString() + (frac ? '.' + frac : '');
}

/** Units from a database Float amount in USDC (legacy Order.total), rounded to 7 decimals */
export function unitsFromDbFloat(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** UNIT_DECIMALS));
}
