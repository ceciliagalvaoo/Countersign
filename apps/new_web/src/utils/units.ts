/** USDC and fund units on Stellar use 7 decimals (integer "units" on-chain) */
export const DECIMALS = 7;

const INT = /^-?\d+$/;

/** "50000000000" -> "5,000"; "12345" -> "0.0012345". Exact, no rounding. */
export function formatUnits(units: string | bigint | null | undefined): string {
  if (units === null || units === undefined || units === '') return '';
  const text = typeof units === 'bigint' ? units.toString() : String(units);
  if (!INT.test(text)) return text;
  const neg = text.startsWith('-');
  const digits = (neg ? text.slice(1) : text).padStart(DECIMALS + 1, '0');
  const whole = digits.slice(0, -DECIMALS).replace(/^0+(?=\d)/, '');
  const frac = digits.slice(-DECIMALS).replace(/0+$/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac ? '.' + frac : ''}`;
}

/** Decimal USDC amount ("1000", "12.5") to integer units, or null when invalid */
export function toUnits(amount: string): bigint | null {
  const t = amount.trim();
  if (!/^\d+(\.\d{1,7})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  return BigInt(w) * 10_000_000n + BigInt(f.padEnd(DECIMALS, '0'));
}

export function shortAddress(a: string | null | undefined): string {
  if (!a) return '';
  return a.length > 12 ? `${a.slice(0, 4)}...${a.slice(-4)}` : a;
}

export function shortHash(h: string | null | undefined): string {
  if (!h) return '';
  return h.length > 16 ? `${h.slice(0, 8)}...${h.slice(-6)}` : h;
}

export function secondsToDays(secs: number | string): string {
  const n = Number(secs);
  if (!Number.isFinite(n) || n <= 0) return String(secs);
  const days = n / 86_400;
  return Number.isInteger(days) ? `${days} day${days === 1 ? '' : 's'}` : `${n} seconds`;
}
