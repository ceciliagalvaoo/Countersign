import { z } from 'zod';
import { isDecimalAmount, toUnits, unitsToDecimal } from './canonical.js';

/**
 * Typed investment mandate (shared contract with apps/agent: import or mirror this schema, do not redefine it).
 *
 * Monetary fields are USDC decimals (string or number in the request, at most 7 decimals). They are normalized
 * to a minimal decimal string ("1000", "12.5"); the canonical form used for the hash turns them into integer
 * units with 7 decimals (see canonicalMandate in mandate.ts).
 */

export const SECTORS = ['AGRO', 'VAREJO', 'INDUSTRIA', 'SERVICOS', 'TECH', 'SAUDE', 'OUTROS'] as const;
export const LOSS_TOLERANCES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type LossTolerance = (typeof LOSS_TOLERANCES)[number];

/** maxLossTolerance mapped to Fund.riskLevel */
export const TOLERANCE_TO_RISK: Record<LossTolerance, 'BAIXO' | 'MEDIO' | 'ALTO'> = {
  LOW: 'BAIXO',
  MEDIUM: 'MEDIO',
  HIGH: 'ALTO',
};

export const usdcAmount = z
  .union([z.string(), z.number()])
  .refine((v) => isDecimalAmount(v), 'Expected a USDC amount with at most 7 decimals')
  .transform((v) => unitsToDecimal(toUnits(v)));

const positiveUsdc = usdcAmount.refine((v) => toUnits(v) > 0n, 'Must be greater than zero');

const countryCode = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .refine((v) => /^[A-Z]{2}$/.test(v), 'Expected an ISO 3166 alpha 2 country code');

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const recurringSchema = z
  .object({
    amountUsdc: positiveUsdc,
    everyDays: int(1, 366),
    fundIds: z.array(z.string().min(1)).min(1).max(20),
  })
  .strict();

const mandateShape = {
  residences: z.array(countryCode).min(1).max(10),
  horizonMonths: int(1, 600),
  liquidityNeedPct: int(0, 100),
  liquidityWithinMonths: int(0, 600),
  maxLossTolerance: z.enum(LOSS_TOLERANCES),
  totalAmountUsdc: positiveUsdc,
  perPurchaseCapUsdc: positiveUsdc,
  periodCapUsdc: positiveUsdc,
  periodDays: int(1, 366),
  allowedSectors: z.array(z.enum(SECTORS)).min(1),
  maxPerSectorPct: int(1, 100),
  recurring: recurringSchema.optional(),
};

/** A complete mandate, as approved by the investor */
export const mandateSchema = z
  .object(mandateShape)
  .strict()
  .superRefine((m, ctx) => {
    const per = toUnits(m.perPurchaseCapUsdc);
    const period = toUnits(m.periodCapUsdc);
    const total = toUnits(m.totalAmountUsdc);
    if (per > period) ctx.addIssue({ code: 'custom', path: ['perPurchaseCapUsdc'], message: 'Per purchase cap above the period cap' });
    if (period > total) ctx.addIssue({ code: 'custom', path: ['periodCapUsdc'], message: 'Period cap above the total amount' });
    if (m.recurring && toUnits(m.recurring.amountUsdc) > per) {
      ctx.addIssue({ code: 'custom', path: ['recurring', 'amountUsdc'], message: 'Recurring amount above the per purchase cap' });
    }
  });

export type Mandate = z.infer<typeof mandateSchema>;

/** A draft may be incomplete while the agent asks what is missing */
export const mandateDraftSchema = z.object(mandateShape).partial().strict();
export type MandateDraft = z.infer<typeof mandateDraftSchema>;

/**
 * A purchase proposal from the agent. There is deliberately NO destination field: the destination is always
 * Fund.fundWalletPublicKey from the database. Unknown keys are kept (passthrough) so the policy can see them and
 * refuse with the rule `untrusted_text_cannot_set_destination_or_amount` instead of silently dropping them.
 */
export const proposalSchema = z
  .object({
    fundId: z.string().min(1),
    amountUsdc: usdcAmount.refine((v) => toUnits(v) > 0n, 'Must be greater than zero'),
    amountSource: z.string(),
    origin: z.enum(['chat', 'recurring']),
    toolCallId: z.string().min(1).max(200),
  })
  .passthrough();

export type Proposal = z.infer<typeof proposalSchema>;
export const PROPOSAL_KEYS = ['fundId', 'amountUsdc', 'amountSource', 'origin', 'toolCallId'] as const;
export const AMOUNT_SOURCES = ['mandate', 'investor_message'] as const;
