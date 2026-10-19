/**
 * Decision log: append-only, hash-chained (our server; the wallet contract anchors each purchase's hash on-chain).
 *
 * SERIALIZATION (the only one used for hashing, implemented by canonical() in ./canonical.ts):
 *   JSON with object keys in ascending order (UTF-16 code unit order), no whitespace, keys with undefined values
 *   omitted, only safe integers as numbers, every monetary value a string of integer units with 7 decimals
 *   (1 USDC = "10000000"). Encoded as UTF-8.
 *
 * PAYLOAD of each row (all keys always present except txHash, which is omitted when absent):
 *   { kind, seq, userId, at, origin, fundId, amountUnits, rule, outcome, mandateHash, toolCallId, txHash? }
 *   kind        "decision" (agent proposal, signer refusal, execution result) | "onchain_event" (confirmed action)
 *   seq         integer, equal to DecisionLog.seq, consecutive from 1
 *   at          ISO 8601 UTC timestamp, millisecond precision (Date.toISOString)
 *   origin      "chat" | "recurring" for decisions, "onchain" for events
 *   fundId      Fund.id or null
 *   amountUnits string of integer units (7 decimals), "0" when not applicable
 *   rule        stable rule name (rules.ts), "signer_refused", "execution_failed", "execution_pending_network",
 *               or the on-chain action name for events (deploy_wallet, set_limits, allow_fund, ...)
 *   outcome     APPROVED | REJECTED | NEEDS_INVESTOR_SIGNATURE | FAILED | PENDING (execution_pending_network) | CONFIRMED
 *   mandateHash 64 hex characters or null
 *   toolCallId  the agent tool call id, or null
 *   txHash      64 hex characters: confirmed on-chain rows, and execution_failed rows whose FAILED
 *               transaction is in the ledger
 *   failureStage, errorCode, errorName  (optional, only on execution_failed rows refused by the network or the
 *               contract: stage simulation | submission | ledger | expired, the contract error code and name)
 *
 * CHAIN:
 *   hash_n = sha256( prevHash_n (32 raw bytes) || UTF-8(canonical(payload_n)) ), stored as 64 hex characters
 *   prevHash_1 = 32 zero bytes; prevHash_n = hash_(n-1)
 *   The 32 bytes of a decision row's hash are the `decision` argument of subscribe on the wallet contract.
 *
 * Rows are only INSERTed. A database trigger rejects UPDATE, DELETE and TRUNCATE on decision_logs; a database
 * owner can still bypass it, which is why verifyChain() recomputes the whole chain and reports the first bad row.
 * Appends are serialized with a Postgres transaction advisory lock so seq and prevHash never fork.
 */
import type { PrismaClient } from '@prisma/client';
import { canonical, sha256Hex } from './canonical.js';

export const ZERO_HASH = '0'.repeat(64);
const APPEND_LOCK_KEY = 7_212_026; // arbitrary constant for pg_advisory_xact_lock

export type LogKind = 'decision' | 'onchain_event';

export interface LogPayload {
  kind: LogKind;
  seq: number;
  userId: string;
  at: string;
  origin: string;
  fundId: string | null;
  amountUnits: string;
  rule: string;
  outcome: string;
  mandateHash: string | null;
  toolCallId: string | null;
  txHash?: string;
  /** Only on `execution_failed` rows after a refusal by the network or the wallet contract */
  failureStage?: string;
  errorCode?: number;
  errorName?: string;
}

export type NewEntry = Omit<LogPayload, 'seq' | 'at'> & { at?: string };

export function chainHash(prevHashHex: string, payload: LogPayload): string {
  return sha256Hex(Buffer.concat([Buffer.from(prevHashHex, 'hex'), Buffer.from(canonical(payload), 'utf8')]));
}

let prismaRef: PrismaClient | null = null;

/** Binds the Prisma client used by appendOnchainEvent (done once at route registration) */
export function bindDecisionLog(prisma: PrismaClient) {
  prismaRef = prisma;
}

function db(prisma?: PrismaClient): PrismaClient {
  const p = prisma ?? prismaRef;
  if (!p) throw new Error('decision log is not bound to a database (call bindDecisionLog)');
  return p;
}

/** Appends one row (serialized) and returns it */
export async function appendEntry(entry: NewEntry, prisma?: PrismaClient, opts: { dedupeOnchain?: boolean } = {}) {
  return db(prisma).$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${APPEND_LOCK_KEY})`;
    // Under the same lock: an on-chain event already logged for this action and tx hash is returned as is
    if (opts.dedupeOnchain && entry.txHash) {
      const marker = `"rule":${JSON.stringify(entry.rule)}`;
      const candidates = await tx.decisionLog.findMany({
        where: { userId: entry.userId, payload: { contains: `"txHash":"${entry.txHash}"` } },
        orderBy: { seq: 'asc' },
      });
      const found = candidates.find((r) => r.payload.includes('"kind":"onchain_event"') && r.payload.includes(marker));
      if (found) return { seq: found.seq, hash: found.hash, prevHash: found.prevHash, payload: JSON.parse(found.payload) as LogPayload, duplicate: true };
    }
    const last = await tx.decisionLog.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true, hash: true } });
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? ZERO_HASH;
    const payload: LogPayload = {
      kind: entry.kind,
      seq,
      userId: entry.userId,
      at: entry.at ?? new Date().toISOString(),
      origin: entry.origin,
      fundId: entry.fundId,
      amountUnits: entry.amountUnits,
      rule: entry.rule,
      outcome: entry.outcome,
      mandateHash: entry.mandateHash,
      toolCallId: entry.toolCallId,
      ...(entry.txHash ? { txHash: entry.txHash } : {}),
      ...(entry.failureStage ? { failureStage: entry.failureStage } : {}),
      ...(Number.isSafeInteger(entry.errorCode) ? { errorCode: entry.errorCode } : {}),
      ...(entry.errorName ? { errorName: entry.errorName } : {}),
    };
    const hash = chainHash(prevHash, payload);
    await tx.decisionLog.create({ data: { seq, userId: entry.userId, prevHash, hash, payload: canonical(payload) } });
    return { seq, hash, prevHash, payload, duplicate: false };
  });
}

export const ONCHAIN_ACTIONS = [
  'deploy_wallet',
  'set_limits',
  'allow_fund',
  'disallow_fund',
  'revoke_agent',
  'set_agent',
  'withdraw',
  'withdraw_units',
  'deposit',
  'subscribe',
  'whitelist_add',
  'mint',
  'refund',
  'set_pause',
  'vault_register', // admin_register_fund, admin_register_entity, register_receivable verified in the vault
  'pay',
  'distribute',
  'claim',
] as const;
export type OnchainAction = (typeof ONCHAIN_ACTIONS)[number];

/**
 * Records a CONFIRMED on-chain action (called by stellar-integrator after every verified confirmation), so no
 * transaction hash in the evidence lacks a log row. `amountUnits` is a string of integer units when relevant.
 */
export async function appendOnchainEvent(
  params: { userId: string; action: OnchainAction; txHash: string; fundId?: string | null; amountUnits?: string; mandateHash?: string | null },
  prisma?: PrismaClient,
  opts: { once?: boolean } = {}
) {
  if (!(ONCHAIN_ACTIONS as readonly string[]).includes(params.action)) throw new Error(`Unknown on-chain action ${params.action}`);
  if (!/^[0-9a-f]{64}$/i.test(params.txHash)) throw new Error('appendOnchainEvent: txHash must be 64 hex characters');
  if (params.amountUnits !== undefined && !/^(0|[1-9]\d*)$/.test(params.amountUnits)) {
    throw new Error('appendOnchainEvent: amountUnits must be a string of integer units');
  }
  const p = db(prisma);
  const row = await appendEntry(
    {
      kind: 'onchain_event',
      userId: params.userId,
      origin: 'onchain',
      fundId: params.fundId ?? null,
      amountUnits: params.amountUnits ?? '0',
      rule: params.action,
      outcome: 'CONFIRMED',
      mandateHash: params.mandateHash ?? null,
      toolCallId: null,
      txHash: params.txHash.toLowerCase(),
    },
    p,
    { dedupeOnchain: !!opts.once }
  );
  // Bookkeeping only (activation is always decided by reading mandate_hash from the contract)
  if (params.action === 'set_limits' || params.action === 'deploy_wallet') {
    const approved = await p.mandate.findFirst({ where: { userId: params.userId, status: 'APPROVED' }, orderBy: { version: 'desc' } });
    if (approved && (!params.mandateHash || params.mandateHash === approved.hash)) {
      await p.mandate.update({ where: { id: approved.id }, data: { onChainTxHash: params.txHash.toLowerCase() } });
    }
  }
  return row;
}

export async function getEntry(seq: number, prisma?: PrismaClient) {
  const row = await db(prisma).decisionLog.findUnique({ where: { seq } });
  if (!row) return null;
  return { ...row, payload: JSON.parse(row.payload) as LogPayload };
}

export async function listForUser(userId: string, limit = 200, prisma?: PrismaClient) {
  const rows = await db(prisma).decisionLog.findMany({ where: { userId }, orderBy: { seq: 'asc' }, take: limit });
  return rows.map((r) => ({ seq: r.seq, prevHash: r.prevHash, hash: r.hash, payload: JSON.parse(r.payload) as LogPayload, createdAt: r.createdAt }));
}

export type VerifyResult =
  | { ok: true; count: number; headHash: string }
  | { ok: false; count: number; firstBadSeq: number; reason: string };

/** Recomputes the whole chain in seq order and reports the first row that does not match */
export async function verifyChain(prisma?: PrismaClient): Promise<VerifyResult> {
  const rows = await db(prisma).decisionLog.findMany({ orderBy: { seq: 'asc' } });
  let prev = ZERO_HASH;
  let expectedSeq = 1;
  for (const row of rows) {
    const bad = (reason: string): VerifyResult => ({ ok: false, count: rows.length, firstBadSeq: row.seq, reason });
    if (row.seq !== expectedSeq) return bad(`seq gap: expected ${expectedSeq}`);
    if (row.prevHash !== prev) return bad('prevHash does not match the previous row hash');
    let payload: LogPayload;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      return bad('payload is not valid JSON');
    }
    if (canonical(payload) !== row.payload) return bad('payload is not in canonical form');
    if (payload.seq !== row.seq || payload.userId !== row.userId) return bad('payload seq or userId differ from the row');
    if (chainHash(prev, payload) !== row.hash) return bad('hash does not match sha256(prevHash || canonical(payload))');
    prev = row.hash;
    expectedSeq++;
  }
  return { ok: true, count: rows.length, headHash: prev };
}
