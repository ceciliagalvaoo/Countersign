// Fixed point arithmetic with 7 decimals (USDC and fund units on Stellar).
// Deterministic: no floating point in quotes.

export const SCALE = 10_000_000n;
const DECIMAL = /^\d+(\.\d{1,7})?$/;

export function isDecimal7(value: string): boolean {
  return DECIMAL.test(value.trim());
}

/** "12.5" -> 125000000n. Throws on more than 7 decimals or a malformed value. */
export function toUnits(value: string | number): bigint {
  const s = typeof value === "number" ? numberToDecimal(value) : value.trim();
  if (!DECIMAL.test(s)) throw new Error(`not a decimal amount with at most 7 decimals: ${s}`);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(7, "0"));
}

/** 125000000n -> "12.5" */
export function fromUnits(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(7, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Float from the database (for example Fund.price) to a 7 decimal string. */
export function numberToDecimal(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`not a non negative finite number: ${n}`);
  return fromUnits(BigInt(Math.round(n * 1e7)));
}

/** floor(amount / price) with 7 decimals, all in units. */
export function divideUnits(amountUnits: bigint, priceUnits: bigint): bigint {
  if (priceUnits <= 0n) throw new Error("price must be positive");
  return (amountUnits * SCALE) / priceUnits;
}

export function multiplyUnits(aUnits: bigint, bUnits: bigint): bigint {
  return (aUnits * bUnits) / SCALE;
}
