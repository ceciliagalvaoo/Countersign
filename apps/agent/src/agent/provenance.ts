// Amount provenance, checked in code. The model declares where an amount came
// from (amountSource). We verify that claim against the session itself:
//   "investor_message": the number must appear in one of her own messages;
//   "mandate": it must equal an amount of her mandate (approved or draft).
// If the claim cannot be verified, the proposal is still sent to the policy,
// with amountSource "unverified_by_agent": the policy refuses it with
// untrusted_text_cannot_set_destination_or_amount and writes the decision log
// row, so the refusal is on the record instead of being hidden here.
import type { MandateDraft } from "../api/types.js";
import { isDecimal7, toUnits } from "../util/decimal.js";

export const UNVERIFIED_SOURCE = "unverified_by_agent";

const NUMBER = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k\b)?/gi;

/** Every amount written in the texts, as 7 decimal units ("1,000" and "1k" both give 1000). */
export function amountsIn(texts: string[]): Set<bigint> {
  const out = new Set<bigint>();
  for (const t of texts) {
    for (const m of t.matchAll(NUMBER)) {
      const whole = m[1].replace(/,/g, "");
      const frac = m[2] ?? "";
      const value = frac ? `${whole}.${frac}` : whole;
      if (!isDecimal7(value)) continue;
      let units = toUnits(value);
      if (m[3]) units *= 1000n;
      out.add(units);
    }
  }
  return out;
}

export function mandateAmounts(...mandates: Array<MandateDraft | null | undefined>): Set<bigint> {
  const out = new Set<bigint>();
  for (const m of mandates) {
    if (!m) continue;
    for (const v of [m.totalAmountUsdc, m.perPurchaseCapUsdc, m.periodCapUsdc, m.recurring?.amountUsdc]) {
      if (typeof v === "string" && isDecimal7(v)) out.add(toUnits(v));
    }
  }
  return out;
}

export interface ProvenanceInput {
  amountUsdc: string;
  amountSource: "investor_message" | "mandate";
  investorMessages: string[];
  mandates: Array<MandateDraft | null | undefined>;
}

/** The amountSource to send to the policy: the declared one if verified, otherwise UNVERIFIED_SOURCE. */
export function verifiedSource(p: ProvenanceInput): { source: string; verified: boolean } {
  const units = toUnits(p.amountUsdc);
  const pool = p.amountSource === "investor_message" ? amountsIn(p.investorMessages) : mandateAmounts(...p.mandates);
  const verified = pool.has(units);
  return { source: verified ? p.amountSource : UNVERIFIED_SOURCE, verified };
}
