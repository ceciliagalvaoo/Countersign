// Recurring purchase (06 S13, build line 3.1). A manual "run recurring now"
// trigger runs the SAME path as a chat purchase, with no language model in the
// loop and no new signature from the investor:
//   get_mandate -> propose_subscription (origin "recurring", amountSource
//   "mandate", the amount and fund pre authorised in her approved mandate)
//   -> hold window -> execute_approved_purchase.
// The policy checks that the fund and amount match the mandate's recurring
// entry; first purchases in a fund need her allow_fund signature, so the
// trigger stops there (only funds already on the wallet allowlist run).
// During the hold window she can interrupt: the decision is then not executed
// (state "interrupted"); resume executes it if it is still valid.
import type { ApiClient } from "../api/client.js";
import { setNode } from "../plan/dag.js";
import type { Session, SessionStore } from "../session/store.js";
import type { MandateView } from "../tools/projections.js";
import { applyToolLog, runTool } from "./loop.js";

/** Known limitation 9, word for word. */
export const RECURRING_LABEL =
  "Recurring purchases are pre-authorised within the investor's mandate and started by a manual \"run recurring now\" trigger for the demo. The time trigger is simulated; the on-chain transactions are real.";

export type RecurringStatus =
  | "scheduled"
  | "not_preauthorised"
  | "fund_not_preauthorised"
  | "fund_not_in_allowlist"
  | "refused"
  | "failed";

export interface RecurringResult {
  status: RecurringStatus;
  message: string;
  decision: { seq: number; outcome: string; rule: string; explanation: string } | null;
  holdMs: number | null;
}

function say(session: Session, text: string) {
  session.transcript.push({ role: "agent", text, turn: session.turns, at: new Date().toISOString(), flags: ["recurring"] });
  session.pendingNotes.push(text);
}

async function call(session: Session, api: ApiClient, name: string, input: Record<string, unknown>) {
  const id = `recurring_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { log } = await runTool(session, session.turns, { id, name, input }, api, [], "recurring");
  applyToolLog(session, log, "recurring");
  return log;
}

/** Proposes the pre authorised purchase. Execution is scheduled by the caller. */
export async function proposeRecurring(session: Session, api: ApiClient, fundId: string | undefined): Promise<RecurringResult> {
  const m = await call(session, api, "get_mandate", {});
  const view = m.isError ? null : (m.output as MandateView);
  const recurring = view?.status === "active" ? view.approvedMandate?.recurring : undefined;
  if (!recurring) {
    const message = "No recurring purchase runs: the investor's active mandate has no pre-authorised recurring purchase.";
    say(session, message);
    return { status: "not_preauthorised", message, decision: null, holdMs: null };
  }
  const target = fundId ?? recurring.fundIds[0];
  if (!recurring.fundIds.includes(target)) {
    const message = "No recurring purchase runs: this fund is not one the mandate pre-authorises for recurring purchases.";
    say(session, message);
    return { status: "fund_not_preauthorised", message, decision: null, holdMs: null };
  }

  const p = await call(session, api, "propose_subscription", { fundId: target, amountUsdc: recurring.amountUsdc, amountSource: "mandate" });
  if (p.isError) {
    const message = "The recurring purchase was not proposed: the policy service did not answer. Nothing was executed.";
    say(session, message);
    return { status: "failed", message, decision: null, holdMs: null };
  }
  const o = p.output as { decisionSeq: number; outcome: string; rule: string; explanation: string };
  const decision = { seq: o.decisionSeq, outcome: o.outcome, rule: o.rule, explanation: o.explanation };
  if (o.outcome === "NEEDS_INVESTOR_SIGNATURE") {
    // Recurring purchases never ask for a signature: this decision is not executable.
    setNode(session.plan, "investor_signature", "skipped", o.rule, "recurring runs only for funds already approved in the mandate wallet");
    session.decisions[session.decisions.length - 1].execution = "refused";
    const message = `Recurring purchase stopped (\`${o.rule}\`): the fund is not yet approved in the mandate wallet. Recurring purchases run only for funds already approved there; the first purchase is made in the chat with her allow_fund signature.`;
    say(session, message);
    return { status: "fund_not_in_allowlist", message, decision, holdMs: null };
  }
  if (o.outcome !== "APPROVED") {
    const message = `Recurring purchase refused by the policy (\`${o.rule}\`): ${o.explanation}`;
    say(session, message);
    return { status: "refused", message, decision, holdMs: null };
  }
  return { status: "scheduled", message: "", decision, holdMs: 0 };
}

/** Executes the pending recurring decision unless the session is interrupted. */
export async function executeRecurring(session: Session, api: ApiClient, store: SessionStore, seq: number) {
  const d = session.decisions.find((x) => x.seq === seq);
  if (!d || d.execution || d.outcome !== "APPROVED") return;
  if (session.plan.interrupted) {
    say(session, `Recurring purchase (decision ${seq}) interrupted before execution: nothing was paid. Resume to execute it while the approval is still valid.`);
    store.save(session);
    return;
  }
  const log = await call(session, api, "execute_approved_purchase", { decisionSeq: seq });
  const out = log.output as { result?: string; statusText?: string; rule?: string | null; explanation?: string; error?: string };
  const text = log.isError
    ? `Recurring purchase (decision ${seq}) was not executed: ${out.error ?? "unknown error"}`
    : out.result === "refused"
      ? `Recurring purchase (decision ${seq}) refused${out.rule ? ` (\`${out.rule}\`)` : ""}: ${out.explanation ?? ""}`
      : `Recurring purchase (decision ${seq}): ${out.statusText ?? out.result}`;
  say(session, text);
  store.save(session);
}
