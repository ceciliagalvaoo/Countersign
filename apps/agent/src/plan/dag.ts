// Plan of a purchase as a small state machine, in code (not in the LLM).
// Node states change only from tool results (and from interrupt and resume),
// never from what the model writes. "confirmed" is reached only when
// get_status reports the order as completed.

export const NODE_IDS = [
  "profile",
  "perimeter",
  "eligibility",
  "screening",
  "proposal",
  "investor_signature",
  "agent_purchase",
  "issuer_countersign",
  "confirmed",
] as const;
export type NodeId = (typeof NODE_IDS)[number];

export type NodeState = "pending" | "active" | "done" | "refused" | "interrupted" | "skipped";

export const NODE_LABELS: Record<NodeId, string> = {
  profile: "Profile",
  perimeter: "Perimeter",
  eligibility: "Eligibility",
  screening: "Screening",
  proposal: "Proposal",
  investor_signature: "Investor signature",
  agent_purchase: "Agent purchase",
  issuer_countersign: "Issuer countersign",
  confirmed: "Confirmed",
};

export interface PlanNode {
  id: NodeId;
  label: string;
  state: NodeState;
  /** Policy or contract rule that refused or decided this node. */
  rule: string | null;
  detail: string | null;
  /** State before an interruption, restored by resume. */
  stateBeforeInterrupt?: NodeState;
  updatedAt: string;
}

export interface Plan {
  nodes: PlanNode[];
  /** Fund and proposal in focus, set by propose_subscription. */
  focus: {
    fundId: string;
    decisionSeq: number | null;
    proposedAt: string;
    /** Set by execute_approved_purchase: only the order with this payment hash (or order id) moves the plan. */
    txHash?: string | null;
    orderId?: string | null;
    /** Hash of the decision executed in this session; matches the order's decisionHash. */
    decisionHash?: string | null;
  } | null;
  interrupted: boolean;
}

const now = () => new Date().toISOString();

export function newPlan(): Plan {
  return {
    nodes: NODE_IDS.map((id) => ({ id, label: NODE_LABELS[id], state: "pending", rule: null, detail: null, updatedAt: now() })),
    focus: null,
    interrupted: false,
  };
}

function node(plan: Plan, id: NodeId): PlanNode {
  const n = plan.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`unknown plan node ${id}`);
  return n;
}

export function setNode(plan: Plan, id: NodeId, state: NodeState, rule: string | null = null, detail: string | null = null) {
  const n = node(plan, id);
  n.state = state;
  n.rule = rule;
  n.detail = detail;
  n.updatedAt = now();
}

/**
 * Sends the given nodes back to pending (a correction such as "make it 500,
 * only the agri fund"). Other nodes and the session turn counter are kept.
 * Nodes of a purchase already in flight (agent_purchase onwards, not pending)
 * are never rewound here.
 */
export function resetNodes(plan: Plan, ids: NodeId[]) {
  const inFlight = ["agent_purchase", "issuer_countersign", "confirmed"].some((id) => node(plan, id as NodeId).state !== "pending");
  for (const id of ids) {
    if (inFlight && (id === "agent_purchase" || id === "issuer_countersign" || id === "confirmed")) continue;
    setNode(plan, id, "pending");
  }
  if (!inFlight) plan.focus = null;
}

/** Mandate fields whose change invalidates the downstream purchase steps. */
const PURCHASE_FIELDS = new Set([
  "totalAmountUsdc",
  "perPurchaseCapUsdc",
  "periodCapUsdc",
  "periodDays",
  "allowedSectors",
  "maxPerSectorPct",
  "maxLossTolerance",
  "liquidityNeedPct",
  "liquidityWithinMonths",
  "residences",
]);

const ACTIVE_ON_START: Partial<Record<string, NodeId>> = {
  get_mandate: "profile",
  propose_mandate: "profile",
  list_funds: "screening",
  get_fund: "screening",
  check_eligibility: "eligibility",
  quote_subscription: "proposal",
  propose_subscription: "proposal",
  execute_approved_purchase: "agent_purchase",
};

/** Marks the node a tool works on as active while it runs (only from pending). */
export function onToolStart(plan: Plan, tool: string) {
  const id = ACTIVE_ON_START[tool];
  if (!id) return;
  const n = node(plan, id);
  if (n.state === "pending") setNode(plan, id, "active", null, runningMarker(tool));
}

const runningMarker = (tool: string) => `${tool} running`;

interface MandateLike {
  missingFields?: string[];
  draft?: { residences?: string[] };
  status?: string;
  changedFields?: string[];
}

/** Applies the result of one tool call to the plan. */
export function onToolResult(plan: Plan, tool: string, input: unknown, output: unknown, isError: boolean) {
  if (isError) {
    const id = ACTIVE_ON_START[tool];
    // Only undo what onToolStart did for this call; a node active for another reason stays as it is.
    if (id && node(plan, id).state === "active" && node(plan, id).detail === runningMarker(tool)) {
      setNode(plan, id, "pending", null, `${tool} failed; nothing was assumed`);
    }
    return;
  }
  switch (tool) {
    case "get_mandate":
    case "propose_mandate":
      return applyMandate(plan, output as MandateLike);
    case "list_funds":
      setNode(plan, "screening", "done");
      return;
    case "get_fund":
      if (node(plan, "screening").state === "active") setNode(plan, "screening", "done");
      return;
    case "check_eligibility": {
      const r = output as { eligible: boolean; rule: string; fundId: string };
      if (r.eligible) setNode(plan, "eligibility", "done", null, `eligible for ${r.fundId}`);
      else setNode(plan, "eligibility", "refused", r.rule, `not eligible for ${r.fundId}`);
      return;
    }
    case "quote_subscription":
      return;
    case "propose_subscription":
      return applyProposal(plan, output as ProposalLike);
    case "execute_approved_purchase":
      return applyExecution(plan, output as ExecutionLike);
    case "get_status":
      return applyStatus(plan, output as { orders: Array<{ fundId: string | null; state: string; createdAt: string; paymentTxHash: string | null }> });
    default:
      return;
  }
}

function applyMandate(plan: Plan, m: MandateLike) {
  const missing = m.missingFields ?? [];
  setNode(plan, "profile", missing.length === 0 ? "done" : "active", null, missing.length ? `missing: ${missing.join(", ")}` : null);
  const residences = (m.draft?.residences ?? []).map((r) => r.toUpperCase());
  const alreadyRefused = node(plan, "perimeter").rule === "perimeter_mainland_china";
  if (residences.includes("CN")) {
    setNode(plan, "perimeter", "refused", "perimeter_mainland_china", "declared residence in Mainland China");
  } else if (residences.length > 0 && !alreadyRefused) {
    setNode(plan, "perimeter", "done");
  }
  const changed = m.changedFields ?? [];
  if (changed.some((f) => PURCHASE_FIELDS.has(f))) {
    resetNodes(plan, ["eligibility", "screening", "proposal", "investor_signature"]);
  }
}

interface ProposalLike {
  fundId: string;
  outcome: "APPROVED" | "REJECTED" | "NEEDS_INVESTOR_SIGNATURE";
  rule: string;
  decisionSeq: number;
}

function applyProposal(plan: Plan, p: ProposalLike) {
  plan.focus = { fundId: p.fundId, decisionSeq: p.decisionSeq ?? null, proposedAt: now() };
  if (p.outcome === "REJECTED") {
    setNode(plan, "proposal", "refused", p.rule, "refused by the policy");
    if (p.rule === "perimeter_mainland_china") setNode(plan, "perimeter", "refused", p.rule);
    if (p.rule === "eligibility_zk_tier") setNode(plan, "eligibility", "refused", p.rule);
    return;
  }
  // The policy evaluated eligibility before approving.
  if (node(plan, "eligibility").state !== "refused") setNode(plan, "eligibility", "done");
  if (p.outcome === "NEEDS_INVESTOR_SIGNATURE") {
    setNode(plan, "proposal", "done", p.rule);
    setNode(plan, "investor_signature", "active", p.rule, "waiting for the investor to sign allow_fund");
    return;
  }
  setNode(plan, "proposal", "done", p.rule);
  setNode(plan, "investor_signature", "skipped", null, "fund already approved in the mandate wallet");
  setNode(plan, "agent_purchase", "pending", null, "approved by the policy, not executed");
}

interface ExecutionLike {
  decisionSeq?: number;
  decisionHash?: string | null;
  fundId?: string;
  orderId?: string | null;
  result: "confirmed_on_chain_awaiting_issuer_countersignature" | "pending_network" | "refused";
  rule?: string | null;
  txHash?: string | null;
  explanation?: string;
}

function applyExecution(plan: Plan, e: ExecutionLike) {
  if (e.fundId && e.result !== "refused") {
    plan.focus = {
      fundId: e.fundId,
      decisionSeq: e.decisionSeq ?? null,
      proposedAt: plan.focus?.proposedAt ?? now(),
      txHash: e.txHash ?? null,
      orderId: e.orderId ?? null,
      decisionHash: e.decisionHash ?? null,
    };
  }
  if (e.result === "confirmed_on_chain_awaiting_issuer_countersignature") {
    setNode(plan, "agent_purchase", "done", null, e.txHash ? `confirmed on chain, tx ${e.txHash}` : "confirmed on chain");
    setNode(plan, "issuer_countersign", "active", null, "awaiting issuer countersignature");
    return;
  }
  if (e.result === "pending_network") {
    setNode(plan, "agent_purchase", "active", null, "pending, not done: the network did not answer");
    return;
  }
  setNode(plan, "agent_purchase", "refused", e.rule ?? null, e.explanation ?? "execution refused");
}

/** The API reported the agent's payment as confirmed on chain. */
export function paymentConfirmed(plan: Plan): boolean {
  return node(plan, "agent_purchase").state === "done";
}

function applyStatus(
  plan: Plan,
  out: {
    orders: Array<{ orderId?: string; fundId: string | null; state: string; createdAt: string; paymentTxHash: string | null; decisionHash?: string | null }>;
  },
) {
  // Only the order of THIS session's execution moves the plan: matched by its payment transaction hash, by the
  // order id the API returned, or by the hash of the decision executed here (when the answer was lost). Other orders of the same fund (other sessions,
  // older purchases) never do.
  const focus = plan.focus;
  if (!focus || (!focus.txHash && !focus.orderId && !focus.decisionHash)) return;
  const order = (out.orders ?? []).find(
    (o) =>
      (focus.txHash && o.paymentTxHash === focus.txHash) ||
      (focus.orderId && o.orderId === focus.orderId) ||
      (focus.decisionHash && o.decisionHash === focus.decisionHash),
  );
  if (!order) return;
  switch (order.state) {
    case "pending":
      setNode(plan, "agent_purchase", "active", null, "payment pending on chain");
      return;
    case "awaiting_issuer_countersignature":
      setNode(plan, "agent_purchase", "done", null, order.paymentTxHash ? `tx ${order.paymentTxHash}` : null);
      setNode(plan, "issuer_countersign", "active", null, "awaiting issuer countersignature");
      return;
    case "completed":
      setNode(plan, "agent_purchase", "done", null, order.paymentTxHash ? `tx ${order.paymentTxHash}` : null);
      setNode(plan, "issuer_countersign", "done");
      setNode(plan, "confirmed", "done", null, "read from get_status");
      return;
    case "failed":
      setNode(plan, "agent_purchase", "refused", null, "payment failed");
      return;
    case "rejected_by_issuer":
      setNode(plan, "issuer_countersign", "refused", null, "rejected by the issuer");
      return;
  }
}

/** Freezes the plan: active nodes become interrupted (execution is not started while interrupted). */
export function interruptPlan(plan: Plan) {
  if (plan.interrupted) return;
  plan.interrupted = true;
  for (const n of plan.nodes) {
    if (n.state === "active" || (n.state === "pending" && n.id === "agent_purchase" && plan.focus)) {
      n.stateBeforeInterrupt = n.state;
      n.state = "interrupted";
      n.updatedAt = now();
    }
  }
}

/** Continues from where the plan stopped. */
export function resumePlan(plan: Plan) {
  if (!plan.interrupted) return;
  plan.interrupted = false;
  for (const n of plan.nodes) {
    if (n.state === "interrupted") {
      n.state = n.stateBeforeInterrupt ?? "pending";
      delete n.stateBeforeInterrupt;
      n.updatedAt = now();
    }
  }
}

/** True when a confirmed state came from get_status in this plan. */
export function isConfirmed(plan: Plan): boolean {
  return node(plan, "confirmed").state === "done";
}

/** Public view for GET /session/:id. */
export function planView(plan: Plan) {
  return {
    nodes: plan.nodes.map(({ id, label, state, rule, detail, updatedAt }) => ({ id, label, state, rule, detail, updatedAt })),
    focusFundId: plan.focus?.fundId ?? null,
    // Read-only identity for clients reconciling this plan with current verified
    // purchases. Legacy sessions may have only decisionSeq; never match by fund alone.
    purchaseRef: plan.focus ? {
      orderId: plan.focus.orderId ?? null,
      subscribeTxHash: plan.focus.txHash ?? null,
      decision: plan.focus.decisionHash ?? null,
      decisionSeq: plan.focus.decisionSeq,
    } : null,
    interrupted: plan.interrupted,
  };
}
