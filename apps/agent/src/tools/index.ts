// Registry of agent tools, in a fixed order (the tool list is part of the
// cached prompt prefix, so the order never changes between requests).
//
// Line 1.6: get_mandate, propose_mandate, list_funds, get_fund,
// check_eligibility, quote_subscription, propose_subscription, get_status,
// get_holdings; execute_approved_purchase (M1 unblock, 06 S9: the agent
// executes a purchase the policy approved in this session).
//
// The agent never gets a tool that approves a mandate, changes caps on chain,
// calls wallet routes, signs, or reads keys, e mail or addresses.
import { executeApprovedPurchase } from "./execute.js";
import { checkEligibility, getFund, listFunds } from "./funds.js";
import { getMandate, proposeMandate } from "./mandate.js";
import { getHoldings, getStatus, proposeSubscription, quoteSubscription } from "./subscription.js";
import type { AgentTool } from "./types.js";
import { toApiTool } from "./types.js";

export const TOOLS: AgentTool<any, any>[] = [
  getMandate,
  proposeMandate,
  listFunds,
  getFund,
  checkEligibility,
  quoteSubscription,
  proposeSubscription,
  executeApprovedPurchase,
  getStatus,
  getHoldings,
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

const byName = new Map(TOOLS.map((t) => [t.name, t]));
export function findTool(name: string): AgentTool<any, any> | undefined {
  return byName.get(name);
}

export function apiTools() {
  return TOOLS.map(toApiTool);
}
