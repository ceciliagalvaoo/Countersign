// Mandate tools. The agent reads the mandate and proposes edits to the DRAFT.
// It has no tool that approves or activates a mandate: approval is the
// investor's own action (full scope token) and activation is her signature of
// set_limits on chain.
import { z } from "zod";
import type { DraftResponse, MandateDraft, MandateOverviewResponse } from "../api/types.js";
import { LOSS_TOLERANCES, SECTORS } from "../api/types.js";
import { ApiError } from "../api/client.js";
import { projectDraftResponse, projectMandateOverview, type MandateView } from "./projections.js";
import { EMPTY_INPUT, emptyInput, nullable, usdcString } from "./schema.js";
import { ToolError, type AgentTool } from "./types.js";

export function apiFailure(what: string, err: unknown): never {
  if (err instanceof ApiError) {
    throw new ToolError(`${what} failed (${err.status || "no response"}): ${err.safeMessage}. Nothing was changed by this call.`);
  }
  throw new ToolError(`${what} failed: unexpected error. Nothing was changed by this call.`);
}

export const getMandate: AgentTool<z.infer<typeof emptyInput>, MandateView> = {
  name: "get_mandate",
  description:
    "Read the investor's mandate: the current draft, which fields are still missing, and whether an approved mandate is active (anchored on chain). Call this at the start of a conversation and before proposing a purchase.",
  inputSchema: EMPTY_INPUT,
  input: emptyInput,
  async run(_input, ctx) {
    try {
      return projectMandateOverview(await ctx.api.get<MandateOverviewResponse>("/mandates"));
    } catch (err) {
      apiFailure("Reading the mandate", err);
    }
  },
};

const residence = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .refine((v) => /^[A-Z]{2}$/.test(v), "residences are ISO 3166 alpha 2 country codes, for example HK or SG");
const int = (min: number, max: number) => z.number().int().min(min).max(max);

const recurringInput = z
  .object({
    amountUsdc: usdcString,
    everyDays: int(1, 366),
    fundIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).min(1).max(20),
  })
  .strict();

const ProposeMandateInput = z
  .object({
    residences: z.array(residence).min(1).max(10).nullable(),
    horizonMonths: int(1, 600).nullable(),
    liquidityNeedPct: int(0, 100).nullable(),
    liquidityWithinMonths: int(0, 600).nullable(),
    maxLossTolerance: z.enum(LOSS_TOLERANCES).nullable(),
    totalAmountUsdc: usdcString.nullable(),
    perPurchaseCapUsdc: usdcString.nullable(),
    periodCapUsdc: usdcString.nullable(),
    periodDays: int(1, 366).nullable(),
    allowedSectors: z.array(z.enum(SECTORS)).min(1).nullable(),
    maxPerSectorPct: int(1, 100).nullable(),
    recurring: recurringInput.nullable(),
    removeRecurring: z.boolean(),
  })
  .strict();

type ProposeMandateInput = z.infer<typeof ProposeMandateInput>;

const usdcProp = (what: string) => nullable({ type: "string", description: `${what}, USDC decimal string, for example "1000".` });
const intProp = (what: string) => nullable({ type: "integer", description: what });

export const proposeMandate: AgentTool<ProposeMandateInput, MandateView & { addedFields: string[]; changedFields: string[] }> = {
  name: "propose_mandate",
  description:
    "Propose changes to the investor's mandate DRAFT from what she said. Pass null for every field she did not mention (null keeps the current value). This never approves or activates the mandate: only she approves it and signs it on chain. Returns the draft and what is still missing.",
  inputSchema: {
    type: "object",
    properties: {
      residences: nullable({
        type: "array",
        items: { type: "string", description: "ISO 3166 alpha 2 country code, for example HK" },
        description: "Countries of residence she declared (all of them).",
      }),
      horizonMonths: intProp("Investment horizon in months."),
      liquidityNeedPct: intProp("Percent of the total amount she may need back (0 to 100)."),
      liquidityWithinMonths: intProp("Within how many months she may need that liquidity."),
      maxLossTolerance: nullable({ type: "string", enum: [...LOSS_TOLERANCES], description: "Maximum loss tolerance she stated." }),
      totalAmountUsdc: usdcProp("Total amount she wants to invest through the agent"),
      perPurchaseCapUsdc: usdcProp("Maximum amount of a single purchase"),
      periodCapUsdc: usdcProp("Maximum amount spent per period"),
      periodDays: intProp("Length of the spending period in days, for example 30."),
      allowedSectors: nullable({
        type: "array",
        items: { type: "string", enum: [...SECTORS] },
        description: "Sectors she allows (AGRO, VAREJO retail, INDUSTRIA, SERVICOS, TECH, SAUDE health, OUTROS).",
      }),
      maxPerSectorPct: intProp("Maximum percent of the total amount in one sector (1 to 100)."),
      recurring: nullable({
        type: "object",
        properties: {
          amountUsdc: { type: "string", description: "Amount of each recurring purchase, USDC decimal string." },
          everyDays: { type: "integer", description: "Days between recurring purchases." },
          fundIds: { type: "array", items: { type: "string" }, description: "fundIds the recurring purchase may buy." },
        },
        required: ["amountUsdc", "everyDays", "fundIds"],
        additionalProperties: false,
      }),
      removeRecurring: { type: "boolean", description: "true only if she asked to stop recurring purchases." },
    },
    required: [
      "residences",
      "horizonMonths",
      "liquidityNeedPct",
      "liquidityWithinMonths",
      "maxLossTolerance",
      "totalAmountUsdc",
      "perPurchaseCapUsdc",
      "periodCapUsdc",
      "periodDays",
      "allowedSectors",
      "maxPerSectorPct",
      "recurring",
      "removeRecurring",
    ],
    additionalProperties: false,
  },
  input: ProposeMandateInput,
  async run(input, ctx) {
    let current: MandateDraft;
    try {
      current = (await ctx.api.get<DraftResponse>("/mandates/draft")).draft ?? {};
    } catch (err) {
      apiFailure("Reading the mandate draft", err);
    }
    const next: Record<string, unknown> = { ...current };
    // addedFields: first value for a field. changedFields: a value she corrected
    // (only corrections send downstream plan steps back to pending).
    const addedFields: string[] = [];
    const changedFields: string[] = [];
    const { removeRecurring, ...fields } = input;
    for (const [key, value] of Object.entries(fields)) {
      if (value === null) continue;
      if (next[key] === undefined) addedFields.push(key);
      else if (JSON.stringify(next[key]) !== JSON.stringify(value)) changedFields.push(key);
      next[key] = value;
    }
    if (removeRecurring && next.recurring !== undefined) {
      delete next.recurring;
      changedFields.push("recurring");
    }
    try {
      const saved = await ctx.api.put<DraftResponse>("/mandates/draft", next);
      return { ...projectDraftResponse(saved, ctx.mandate), addedFields, changedFields };
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        throw new ToolError(`The draft was not saved: ${err.safeMessage}. Ask the investor to restate the value.`, {
          details: err.body?.details ?? null,
        });
      }
      apiFailure("Saving the mandate draft", err);
    }
  },
};
