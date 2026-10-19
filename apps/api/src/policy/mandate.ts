import type { PrismaClient } from '@prisma/client';
import { canonical, sha256Hex, toUnits } from './canonical.js';
import { mandateDraftSchema, mandateSchema, type Mandate, type MandateDraft } from './schema.js';

export { mandateSchema, mandateDraftSchema };
export type { Mandate, MandateDraft };

/**
 * Canonical form of a mandate, the exact object that is hashed:
 *   residences, allowedSectors and recurring.fundIds: uppercase where applicable, deduplicated, sorted;
 *   every monetary field (totalAmountUsdc, perPurchaseCapUsdc, periodCapUsdc, recurring.amountUsdc):
 *   string of integer units with 7 decimals (1000 USDC = "10000000000");
 *   integers stay integers; absent recurring is omitted.
 * mandateHash = sha256(UTF-8 of canonical(canonicalMandate(m))) as 64 hex characters (= BytesN<32> on-chain).
 */
export function canonicalMandate(m: Mandate): Record<string, unknown> {
  const uniqSorted = (xs: string[]) => [...new Set(xs)].sort();
  return {
    residences: uniqSorted(m.residences.map((r) => r.toUpperCase())),
    horizonMonths: m.horizonMonths,
    liquidityNeedPct: m.liquidityNeedPct,
    liquidityWithinMonths: m.liquidityWithinMonths,
    maxLossTolerance: m.maxLossTolerance,
    totalAmountUsdc: toUnits(m.totalAmountUsdc).toString(),
    perPurchaseCapUsdc: toUnits(m.perPurchaseCapUsdc).toString(),
    periodCapUsdc: toUnits(m.periodCapUsdc).toString(),
    periodDays: m.periodDays,
    allowedSectors: uniqSorted(m.allowedSectors),
    maxPerSectorPct: m.maxPerSectorPct,
    recurring: m.recurring
      ? {
          amountUsdc: toUnits(m.recurring.amountUsdc).toString(),
          everyDays: m.recurring.everyDays,
          fundIds: uniqSorted(m.recurring.fundIds),
        }
      : undefined,
  };
}

export function canonicalMandateJson(m: Mandate): string {
  return canonical(canonicalMandate(m));
}

export function mandateHash(m: Mandate): string {
  return sha256Hex(Buffer.from(canonicalMandateJson(m), 'utf8'));
}

/** Rebuilds the typed mandate from its stored canonical JSON (units back to USDC decimals) */
export function mandateFromCanonicalJson(json: string): Mandate {
  const raw = JSON.parse(json) as Record<string, any>;
  const fromUnits = (u: string) => {
    const units = BigInt(u);
    const whole = units / 10_000_000n;
    const frac = (units % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '');
    return whole.toString() + (frac ? '.' + frac : '');
  };
  return mandateSchema.parse({
    ...raw,
    totalAmountUsdc: fromUnits(raw.totalAmountUsdc),
    perPurchaseCapUsdc: fromUnits(raw.perPurchaseCapUsdc),
    periodCapUsdc: fromUnits(raw.periodCapUsdc),
    recurring: raw.recurring ? { ...raw.recurring, amountUsdc: fromUnits(raw.recurring.amountUsdc) } : undefined,
  });
}

/** Arguments of the wallet contract's set_limits(per_tx_cap, period_cap, period_secs, mandate_hash) */
export function setLimitsArgs(m: Mandate, hashHex: string) {
  return {
    perTxCapUnits: toUnits(m.perPurchaseCapUsdc).toString(),
    periodCapUnits: toUnits(m.periodCapUsdc).toString(),
    periodSecs: m.periodDays * 86_400,
    mandateHashHex: hashHex,
  };
}

export const DRAFT_VERSION = 0;

export async function getDraft(prisma: PrismaClient, userId: string): Promise<MandateDraft | null> {
  const row = await prisma.mandate.findUnique({ where: { userId_version: { userId, version: DRAFT_VERSION } } });
  return row ? mandateDraftSchema.parse(JSON.parse(row.json)) : null;
}

export async function putDraft(prisma: PrismaClient, userId: string, draft: MandateDraft) {
  const json = JSON.stringify(draft);
  await prisma.mandate.upsert({
    where: { userId_version: { userId, version: DRAFT_VERSION } },
    create: { userId, version: DRAFT_VERSION, json, status: 'DRAFT' },
    update: { json },
  });
}

/** Latest approved mandate (the one the wallet contract must hold), or null */
export async function getLatestApproved(prisma: PrismaClient, userId: string) {
  const row = await prisma.mandate.findFirst({
    where: { userId, status: 'APPROVED' },
    orderBy: { version: 'desc' },
  });
  if (!row || !row.hash) return null;
  return { row, mandate: mandateFromCanonicalJson(row.json), hash: row.hash };
}

/** Inserts a new APPROVED version from a complete mandate and supersedes the previous approved one */
export async function approveMandate(prisma: PrismaClient, userId: string, m: Mandate) {
  const hash = mandateHash(m);
  const json = canonicalMandateJson(m);
  return prisma.$transaction(async (tx) => {
    const last = await tx.mandate.findFirst({ where: { userId }, orderBy: { version: 'desc' }, select: { version: true } });
    const version = Math.max(DRAFT_VERSION, last?.version ?? 0) + 1;
    await tx.mandate.updateMany({ where: { userId, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } });
    const row = await tx.mandate.create({
      data: { userId, version, json, hash, status: 'APPROVED', approvedAt: new Date() },
    });
    return { row, hash };
  });
}
