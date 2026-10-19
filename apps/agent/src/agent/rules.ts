// What the investor can do after each policy rule. Rule names mirror
// apps/api/src/policy/rules.ts (RULES); the policy decides, this text only
// helps the agent explain the decision in plain words.

export const RULE_GUIDANCE: Record<string, string> = {
  perimeter_mainland_china:
    "This service is not offered to persons or entities in Mainland China (notice Yinfa [2026] No. 42). The agent cannot continue for this residence.",
  mandate_not_active:
    "Review and approve the mandate yourself. It is anchored on chain when you create your mandate wallet, or, if the wallet already exists, when you sign set_limits. The agent cannot approve it for you.",
  fund_not_investable: "This fund is not open for investment right now. Choose another fund from the list.",
  eligibility_zk_tier:
    "Prove your investment tier on chain (SILVER or above) from your badge page, or choose a fund open to every investor. The tier is not a regulatory investor status.",
  amount_over_purchase_cap:
    "Lower the amount to fit the per purchase cap, or change the cap in your mandate and approve it yourself.",
  amount_over_period_cap:
    "Lower the amount, wait for the next period, or change the period cap in your mandate and approve it yourself.",
  sector_not_allowed: "Choose a fund in a sector your mandate allows, or add the sector to your mandate and approve it yourself.",
  sector_concentration: "Lower the amount, choose another sector, or change the sector limit in your mandate and approve it yourself.",
  risk_above_tolerance: "Choose a fund with a lower risk level, or change your loss tolerance in the mandate and approve it yourself.",
  liquidity_mismatch:
    "Choose a fund you can redeem within your liquidity window, lower the amount, or change your liquidity need in the mandate.",
  untrusted_text_cannot_set_destination_or_amount:
    "The amount must come from you or your mandate, and the destination is always the fund wallet registered by the platform. Restate the amount you want.",
  recurring_outside_mandate: "Recurring purchases must match the fund and amount pre authorised in your mandate.",
  first_purchase_needs_investor:
    "First purchase in this fund: you approve the fund in your mandate wallet by signing allow_fund yourself. The agent cannot do this step.",
  decision_expired: "The approval expired before execution. Make a new proposal for the same purchase if you still want it.",
  execution_failed:
    "The purchase was not completed: our wallet contract on Stellar (not audited) or the network refused it. Nothing is assumed paid; check the status, then make a new proposal if you still want it.",
  all_rules_passed:
    "The policy approved this proposal. The purchase is not made yet: execution by the agent, confirmation on chain and the issuer's countersignature still follow.",
};

export function ruleGuidance(rule: string, outcome: string): string {
  return (
    RULE_GUIDANCE[rule] ??
    (outcome === "APPROVED" ? RULE_GUIDANCE.all_rules_passed : "Ask the investor how she wants to adjust the request.")
  );
}
