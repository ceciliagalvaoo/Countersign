// Execution of an APPROVED decision by the agent (06 S9, tier Yellow). The API
// re-checks everything against the current state, the agent signer signs only
// the subscribe call identical to the approved decision, and the mandate wallet
// contract enforces allowlist, caps and decision reuse. This tool only asks for
// that execution and reports the real outcome: never "done" (the issuer still
// has to countersign the mint).
import { z } from "zod";
import { ApiError } from "../api/client.js";
import { ruleGuidance } from "../agent/rules.js";
import { ToolError, type AgentTool, type SessionDecision } from "./types.js";

const Input = z.object({ decisionSeq: z.number().int().positive() }).strict();

const TX_HASH = /^[0-9a-f]{64}$/i;
/** Only a 64 hex transaction hash is passed on (it is not an address and identifies nothing personal). */
const txHashOf = (v: unknown) => (typeof v === "string" && TX_HASH.test(v) ? v.toLowerCase() : null);

export type ExecutionResult =
  | "confirmed_on_chain_awaiting_issuer_countersignature"
  | "pending_network"
  | "refused";

export const executeApprovedPurchase: AgentTool<z.infer<typeof Input>, Record<string, unknown>> = {
  name: "execute_approved_purchase",
  description:
    "Execute ONE purchase the policy APPROVED in this conversation, by its decisionSeq. The platform re-checks the decision, the agent signer signs only that exact purchase and the mandate wallet contract enforces its limits. Never use it for NEEDS_INVESTOR_SIGNATURE or REJECTED decisions. The result is never final: at best the payment is confirmed on chain and the issuer still has to countersign the mint of fund units.",
  inputSchema: {
    type: "object",
    properties: {
      decisionSeq: { type: "integer", description: "decisionSeq returned by propose_subscription with outcome APPROVED in this conversation." },
    },
    required: ["decisionSeq"],
    additionalProperties: false,
  },
  input: Input,
  async run({ decisionSeq }, ctx) {
    const decision = ctx.decisions.find((d) => d.seq === decisionSeq);
    if (!decision) {
      throw new ToolError(`Decision ${decisionSeq} was not made in this conversation; only a decision approved here can be executed.`);
    }
    if (decision.outcome === "NEEDS_INVESTOR_SIGNATURE") {
      throw new ToolError(
        "This decision is not executable: it is the investor's first purchase in this fund. She must approve the fund in her mandate wallet by signing allow_fund herself; once she confirms, make a NEW proposal with propose_subscription.",
      );
    }
    if (decision.outcome !== "APPROVED") {
      throw new ToolError(`Decision ${decisionSeq} was ${decision.outcome} (rule ${decision.rule}); it cannot be executed.`);
    }
    if (decision.execution) {
      throw new ToolError(`Decision ${decisionSeq} was already sent for execution (${decision.execution}). Use get_status for its state.`);
    }
    if (ctx.executionPaused) {
      throw new ToolError("The investor interrupted this session: nothing is executed until she resumes it.");
    }

    const base = { decisionSeq, decisionHash: decision.hash ?? null, fundId: decision.fundId, amountUsdc: decision.amountUsdc };
    let r: Record<string, unknown>;
    try {
      r = await ctx.api.post<Record<string, unknown>>(`/agent/proposals/${decisionSeq}/execute`, {});
    } catch (err) {
      if (!(err instanceof ApiError)) throw new ToolError("Execution request failed unexpectedly; nothing is assumed. Check get_status.");
      const body = err.body ?? {};
      // No answer (timeout or lost connection): the outcome is unknown, never a final failure. The request may
      // have reached the platform; the decision is not sent again and the order is verified later by its decision.
      if (err.status === 0) {
        decision.execution = "pending_network";
        return {
          ...base,
          result: "pending_network" satisfies ExecutionResult,
          statusText: "Pending, not done: no answer from the platform in time. The purchase may still go through and will be verified; it must not be executed again. Check get_status later.",
          txHash: null,
          orderId: null,
        };
      }
      if (err.status === 409) {
        const rule = typeof body.rule === "string" ? body.rule : null;
        const expired = rule === "decision_expired" || /expired/i.test(String(body.error ?? ""));
        const already = /already executed|being executed/i.test(String(body.error ?? ""));
        const explanation = String(body.explanation ?? body.error ?? err.safeMessage);
        decision.execution = expired ? "expired" : already ? "already_executed" : "refused";
        return {
          ...base,
          result: "refused" satisfies ExecutionResult,
          rule,
          explanation,
          errorName: typeof body.errorName === "string" ? body.errorName : null,
          txHash: txHashOf(body.txHash),
          needsNewProposal: !already,
          whatTheInvestorCanDo: expired
            ? "This approval expired. Make a new proposal for the same purchase if she still wants it."
            : already
              ? "This decision was already sent. Check get_status for the order."
              : ruleGuidance(rule ?? "", "REJECTED"),
          moneyMoved: false,
        };
      }
      if (err.status === 503) {
        throw new ToolError("The platform could not complete the execution right now (retryable). Nothing was executed; you may try again.", {
          retryable: true,
          rule: typeof body.rule === "string" ? body.rule : null,
        });
      }
      if (err.status === 501) throw new ToolError("Execution by the agent is not available yet on this platform. Nothing was executed.");
      throw new ToolError(`Execution failed (${err.status || "no response"}): ${err.safeMessage}. Check get_status before saying anything about this purchase.`);
    }

    if (r.status === "CONFIRMED") {
      decision.execution = "confirmed_on_chain";
      return {
        ...base,
        result: "confirmed_on_chain_awaiting_issuer_countersignature" satisfies ExecutionResult,
        statusText: "Payment confirmed on chain, awaiting issuer countersignature. Not done: the issuer still has to mint the fund units.",
        txHash: txHashOf(r.txHash),
        network: "Stellar testnet",
      };
    }
    if (r.status === "PENDING_NETWORK") {
      decision.execution = "pending_network";
      return {
        ...base,
        result: "pending_network" satisfies ExecutionResult,
        orderId: typeof r.orderId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(r.orderId) ? r.orderId : null,
        statusText: "Pending, not done: the network did not answer; the purchase will be verified later. It must not be executed again.",
        txHash: txHashOf(r.txHash),
      };
    }
    throw new ToolError("Unexpected execution response; nothing is assumed. Check get_status.");
  },
};

export type { SessionDecision };
