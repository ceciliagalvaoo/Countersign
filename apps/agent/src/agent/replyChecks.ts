// Deterministic checks on the agent's reply before it reaches the investor.
// They do not rewrite what the model said; they flag it, and for an
// unverified completion claim they append a fixed status note, because the
// state of a purchase comes from the API, never from the model.

export const STATUS_NOTE =
  "Status note from Countersign: no purchase is confirmed in this conversation yet. A purchase counts as completed only when the order status read from the platform shows it, with its transaction on Stellar.";

const COMPLETION = /\b(done|completed?|confirmed|successful(?:ly)?|all set|went through|finali[sz]ed)\b/gi;
const PURCHASE_CONTEXT = /\b(purchas\w*|bought|buy\w*|order\w*|subscri\w*|fund units?|invest\w*|payment|paid)\b/i;
const NEGATION = /\b(not|never|until|unless|before|once|when|after|if|yet to)\b|n't\b/i;
const FORBIDDEN = /\b(yield|apy|guaranteed|risk[ -]free|trustless|microcredit|microloans?|accredited|qualified investors?|kyc verified|tokeni[sz]ed)\b/gi;
const ADVISOR_CLAIM = /\b(i am|i'm|as) (your |an |a )?(financial |investment )?advis[oe]r\b/i;

export const RETURN_NOTE =
  "Note from Countersign: no return is promised or expected. Any return wording is illustrative only, and a receivables fund can lose part or all of the amount invested.";

// A percentage or a "per year" figure in the same sentence as return words.
const RETURN_WORDS = /\b(earn\w*|return\w*|profit\w*|interest|gain\w*|income)\b/i;
const FIGURE = /\d+(?:\.\d+)?\s*(?:%|percent\b)|\b(?:per|a)\s+(?:year|annum|month)\b|\bannual(?:ly|ised|ized)?\b/i;
const LOSS_CONTEXT = /\b(los[es]|loss|default\w*|concentration|account debtor)\b/i;

export interface ReplyCheck {
  text: string;
  flags: string[];
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?\n])\s+/);
}

export interface ReplyState {
  /** get_status showed the order completed (units minted). */
  confirmed: boolean;
  /** The API reported the payment confirmed on chain (issuer countersignature may still be pending). */
  paymentConfirmed: boolean;
}

export function checkReply(text: string, state: ReplyState | boolean): ReplyCheck {
  const flags: string[] = [];
  const st: ReplyState = typeof state === "boolean" ? { confirmed: state, paymentConfirmed: state } : state;

  if (!st.confirmed) {
    const claim = sentences(text).some((s) => {
      if (!PURCHASE_CONTEXT.test(s)) return false;
      for (const m of s.matchAll(COMPLETION)) {
        // "confirmed on chain" is true once the API reported the payment; "done" or "completed" still is not.
        if (st.paymentConfirmed && /^confirmed$/i.test(m[1])) continue;
        const before = s.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
        if (!NEGATION.test(before)) return true;
      }
      return false;
    });
    if (claim) flags.push("unverified_completion_claim");
  }

  const returnFigure = sentences(text).some((s) => RETURN_WORDS.test(s) && FIGURE.test(s) && !LOSS_CONTEXT.test(s));
  if (returnFigure) flags.push("return_figure");

  for (const m of text.matchAll(FORBIDDEN)) flags.push(`forbidden_vocabulary:${m[1].toLowerCase()}`);
  const advisor = text.match(ADVISOR_CLAIM);
  if (advisor) {
    const before = text.slice(Math.max(0, (advisor.index ?? 0) - 12), (advisor.index ?? 0) + advisor[0].length);
    if (!/\bnot\b/i.test(before)) flags.push("forbidden_vocabulary:advisor");
  }

  let out = text;
  if (flags.includes("unverified_completion_claim")) out = `${out}\n\n${STATUS_NOTE}`;
  if (flags.includes("return_figure")) out = `${out}\n\n${RETURN_NOTE}`;
  return { text: out, flags: [...new Set(flags)] };
}
