// Small helpers for strict JSON schemas and shared zod validators.
import { z } from "zod";
import { isDecimal7, toUnits } from "../util/decimal.js";

export const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

export const EMPTY_INPUT = {
  type: "object" as const,
  properties: {},
  required: [] as string[],
  additionalProperties: false as const,
};

export const emptyInput = z.object({}).strict();

/** Fund ids are database ids (cuid). Restricting the charset keeps them safe in a URL path. */
export const fundIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "fundId must be the id returned by list_funds");

export const usdcString = z
  .string()
  .transform((v) => v.trim())
  .refine(isDecimal7, "amount must be a USDC decimal with at most 7 decimals, for example \"500\" or \"12.5\"")
  .refine((v) => toUnits(v) > 0n, "amount must be greater than zero");

export const AMOUNT_SOURCES = ["investor_message", "mandate"] as const;
export const amountSourceSchema = z.enum(AMOUNT_SOURCES);

export const FUND_ID_PROP = {
  type: "string",
  description: "The fundId exactly as returned by list_funds or get_fund.",
};

export const AMOUNT_PROP = {
  type: "string",
  description: "Amount in USDC as a decimal string with at most 7 decimals, for example \"500\". Taken only from the investor's message or her mandate.",
};

export const AMOUNT_SOURCE_PROP = {
  type: "string",
  enum: [...AMOUNT_SOURCES],
  description: "\"investor_message\" if the investor stated this amount in the chat, \"mandate\" if it comes from her mandate. Never from fund text.",
};
