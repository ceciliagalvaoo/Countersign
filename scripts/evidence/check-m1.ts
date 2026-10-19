// M1 check (build line M1, test-engineer): READ ONLY. Given the transaction hash of the agent's subscribe and
// the hash of the issuer's mint, it checks on Stellar testnet and in the decision log that:
//   on-chain  subscribe is a successful call of subscribe(decision, fund_wallet, amount) on a mandate wallet (C...),
//             sent by a G account (the agent); the wallet reports decision_used(decision) = true and lists the
//             fund wallet with a FundToken; mint is a successful mint(to = that same C..., units) on that FundToken,
//             sent by the token admin, which is the fund wallet that subscribe paid; mint comes after subscribe.
//   log       the decision argument equals the hash of a log row (kind decision, APPROVED, all_rules_passed, same
//             amount); the subscribe and mint hashes each have their onchain_event row; those rows recompute as
//             sha256(prevHash || canonical(payload)) with the policy-guard functions (imported, not reimplemented);
//             the whole chain verifies.
// Nothing is signed, sent or written. No secret is printed.
//
// Usage (from the repository root):
//   apps/api/node_modules/.bin/tsx scripts/evidence/check-m1.ts --subscribe <hash> --mint <hash> [log source]
//   or: npm --prefix tests run check:m1 -- --subscribe <hash> --mint <hash> [log source]
// Log source (pick one; without it only the on-chain part is checked and the verdict says so):
//   --tests-db              disposable Postgres of tests/.env (DATABASE_URL, must be 127.0.0.1 or localhost:55432)
//   --api <base url>        a running API, e.g. http://localhost:3001/api, as the investor. Credentials come only
//                           from the environment: CS_INVESTOR_JWT, or CS_INVESTOR_EMAIL and CS_INVESTOR_PASSWORD
// Optional: --json <file> also writes the result as JSON (no secret in it).
import dns from 'node:dns';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfirmedCall, readContract, rpcServer, toAddressVal, EXPLORER_TX_BASE, NETWORK_LABEL } from '../../apps/api/src/services/soroban.js';
import { chainHash, verifyChain, type LogPayload } from '../../apps/api/src/policy/decisionLog.js';
import { canonical } from '../../apps/api/src/policy/canonical.js';

dns.setDefaultResultOrder('ipv4first');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const apiRequire = createRequire(resolve(root, 'apps', 'api', 'package.json'));

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name: string) => argv.includes(`--${name}`);

const HASH_RE = /^[0-9a-f]{64}$/;
const subscribeHash = (opt('subscribe') ?? '').toLowerCase();
const mintHash = (opt('mint') ?? '').toLowerCase();
if (!HASH_RE.test(subscribeHash) || !HASH_RE.test(mintHash)) {
  console.error('usage: check-m1.ts --subscribe <64 hex> --mint <64 hex> [--tests-db | --api <base url>] [--json <file>]');
  process.exit(2);
}

type Status = 'ok' | 'fail' | 'info' | 'skip';
interface Check {
  id: string;
  status: Status;
  what: string;
  detail?: string;
}
const checks: Check[] = [];
const add = (id: string, ok: boolean, what: string, detail?: string) => checks.push({ id, status: ok ? 'ok' : 'fail', what, detail });
const info = (id: string, what: string, detail?: string) => checks.push({ id, status: 'info', what, detail });
const skip = (id: string, what: string, detail?: string) => checks.push({ id, status: 'skip', what, detail });

const hex = (v: unknown): string | null => {
  if (v instanceof Uint8Array) return Buffer.from(v).toString('hex');
  return null;
};
const big = (v: unknown): bigint | null => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
  return null;
};
const isG = (v: unknown): v is string => typeof v === 'string' && /^G[A-Z2-7]{55}$/.test(v);
const isC = (v: unknown): v is string => typeof v === 'string' && /^C[A-Z2-7]{55}$/.test(v);

async function txMeta(hash: string) {
  const r = await rpcServer.getTransaction(hash);
  return { status: r.status as string, ledger: 'ledger' in r ? (r.ledger as number) : null, closedAt: 'createdAt' in r ? new Date(Number(r.createdAt) * 1000).toISOString() : null };
}

interface LogRow {
  seq: number;
  prevHash: string;
  hash: string;
  payload: LogPayload;
  /** stored payload text when read from the database (to check canonical form); undefined from the API */
  stored?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Log sources
// ---------------------------------------------------------------------------------------------------------------

async function logFromTestsDb(): Promise<{ rows: LogRow[]; verify: { ok: boolean; detail: string }; source: string; close: () => Promise<void> }> {
  const envFile = resolve(root, 'tests', '.env');
  if (!existsSync(envFile)) throw new Error('tests/.env not found');
  const dotenv = apiRequire('dotenv') as typeof import('dotenv');
  const parsed: Record<string, string> = {};
  dotenv.config({ path: envFile, processEnv: parsed, quiet: true } as never);
  const url = parsed.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is empty in tests/.env');
  const u = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || u.port !== '55432') {
    throw new Error('--tests-db only reads the disposable Postgres on localhost:55432');
  }
  const { PrismaClient } = apiRequire('@prisma/client') as typeof import('@prisma/client');
  const prisma = new PrismaClient({ datasourceUrl: url });
  const raw = await prisma.decisionLog.findMany({ orderBy: { seq: 'asc' } });
  const rows: LogRow[] = raw.map((r) => ({ seq: r.seq, prevHash: r.prevHash, hash: r.hash, payload: JSON.parse(r.payload) as LogPayload, stored: r.payload }));
  const v = await verifyChain(prisma);
  return {
    rows,
    verify: v.ok ? { ok: true, detail: `${v.count} rows, head ${v.headHash.slice(0, 12)}...` } : { ok: false, detail: `first bad row ${v.firstBadSeq}: ${v.reason}` },
    source: `disposable database ${u.pathname.slice(1)} on port 55432`,
    close: () => prisma.$disconnect(),
  };
}

async function logFromApi(base: string): Promise<{ rows: LogRow[]; verify: { ok: boolean; detail: string }; source: string; close: () => Promise<void> }> {
  const api = base.replace(/\/+$/, '');
  let token = process.env.CS_INVESTOR_JWT?.trim();
  if (!token) {
    const email = process.env.CS_INVESTOR_EMAIL?.trim();
    const password = process.env.CS_INVESTOR_PASSWORD ?? '';
    if (!email || !password) throw new Error('set CS_INVESTOR_JWT, or CS_INVESTOR_EMAIL and CS_INVESTOR_PASSWORD, in the environment');
    const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!res.ok) throw new Error(`login failed with HTTP ${res.status}`);
    token = ((await res.json()) as { token?: string }).token;
    if (!token) throw new Error('login returned no token');
  }
  const get = async (path: string) => {
    const res = await fetch(`${api}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`GET ${path} returned HTTP ${res.status}`);
    return res.json() as Promise<unknown>;
  };
  const list = (await get('/decision-log?limit=1000')) as { entries: Array<{ seq: number; prevHash: string; hash: string; payload: LogPayload }> };
  const v = (await get('/decision-log/verify')) as { ok: boolean; count: number; headHash?: string; firstBadSeq?: number; reason?: string };
  return {
    rows: list.entries.map((e) => ({ seq: e.seq, prevHash: e.prevHash, hash: e.hash, payload: e.payload })),
    verify: { ok: v.ok === true, detail: v.ok ? `${v.count} rows, head ${String(v.headHash).slice(0, 12)}...` : `first bad row ${v.firstBadSeq}: ${v.reason}` },
    source: `${api} (GET /decision-log and /decision-log/verify, as the investor)`,
    close: async () => undefined,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------------

async function main() {
  // ---- on-chain: subscribe ----
  const sub = await getConfirmedCall(subscribeHash).catch((e: Error) => e);
  const subMeta = await txMeta(subscribeHash).catch(() => null);
  let wallet: string | null = null;
  let decision: string | null = null;
  let fundWallet: string | null = null;
  let amount: bigint | null = null;
  let agent: string | null = null;

  if (sub instanceof Error) {
    add('S1', false, 'subscribe transaction is SUCCESS and decodes as one contract call', sub.message);
  } else {
    add('S1', true, 'subscribe transaction is SUCCESS and decodes as one contract call', `ledger ${subMeta?.ledger ?? '?'}, ${subMeta?.closedAt ?? '?'}`);
    const isSubscribe = sub.kind === 'invoke' && sub.method === 'subscribe' && isC(sub.contractId) && (sub.args?.length ?? 0) === 3;
    add('S2', isSubscribe, 'call is subscribe(decision, fund_wallet, amount) on a contract address (C...)', `${sub.method ?? sub.kind} on ${sub.contractId ?? '?'}`);
    if (isSubscribe) {
      wallet = sub.contractId!;
      agent = sub.source;
      decision = hex(sub.args![0]);
      fundWallet = isG(sub.args![1]) ? (sub.args![1] as string) : null;
      amount = big(sub.args![2]);
      add('S3', isG(agent), 'sent by a G account (the agent key, source of the transaction)', agent);
      add('S4', !!decision && decision.length === 64, 'decision argument has 32 bytes', decision ?? 'not bytes');
      add('S5', !!fundWallet, 'destination is a G account (the fund wallet)', fundWallet ?? String(sub.args![1]));
      add('S6', amount !== null && amount > 0n, 'amount is positive (USDC units, 7 decimals)', amount !== null ? amount.toString() : 'not an integer');
      try {
        const used = decision ? await readContract<boolean>(wallet, 'decision_used', [bytes32(decision)]) : false;
        add('S7', used === true, 'the wallet contract reports decision_used(decision) = true (cannot be paid twice)', String(used));
      } catch (e) {
        add('S7', false, 'the wallet contract reports decision_used(decision) = true', (e as Error).message);
      }
      try {
        const currentAgent = await readContract<string>(wallet, 'agent');
        if (currentAgent === agent) info('S8', 'current agent of the wallet contract is the subscribe sender', currentAgent);
        else info('S8', 'current agent of the wallet contract differs from the sender (set_agent after the purchase?)', currentAgent);
      } catch (e) {
        info('S8', 'could not read the current agent', (e as Error).message);
      }
    }
  }

  // ---- on-chain: mint ----
  const mint = await getConfirmedCall(mintHash).catch((e: Error) => e);
  const mintMeta = await txMeta(mintHash).catch(() => null);
  let token: string | null = null;
  let mintUnits: bigint | null = null;
  let issuer: string | null = null;
  if (mint instanceof Error) {
    add('M1', false, 'mint transaction is SUCCESS and decodes as one contract call', mint.message);
  } else {
    add('M1', true, 'mint transaction is SUCCESS and decodes as one contract call', `ledger ${mintMeta?.ledger ?? '?'}, ${mintMeta?.closedAt ?? '?'}`);
    const isMint = mint.kind === 'invoke' && mint.method === 'mint' && isC(mint.contractId) && (mint.args?.length ?? 0) === 2;
    add('M2', isMint, 'call is mint(to, amount) on a FundToken contract (C...)', `${mint.method ?? mint.kind} on ${mint.contractId ?? '?'}`);
    if (isMint) {
      token = mint.contractId!;
      issuer = mint.source;
      mintUnits = big(mint.args![1]);
      add('M3', !!wallet && mint.args![0] === wallet, 'units minted to the same mandate wallet contract that paid (C...)', String(mint.args![0]));
      add('M4', mintUnits !== null && mintUnits > 0n, 'minted units are positive', mintUnits?.toString());
      add('M5', !!fundWallet && issuer === fundWallet, 'mint sent by the fund wallet that subscribe paid (the issuer countersigns)', issuer);
      try {
        const admin = await readContract<string>(token, 'admin');
        add('M6', admin === issuer, 'the FundToken admin is the mint sender', admin);
      } catch (e) {
        add('M6', false, 'the FundToken admin is the mint sender', (e as Error).message);
      }
      if (wallet && fundWallet) {
        try {
          const entry = await readContract<{ token?: string; cap?: bigint; spent?: bigint } | undefined>(wallet, 'fund', [toAddressVal(fundWallet)]);
          add('M7', !!entry && entry.token === token, 'the wallet contract allows this fund wallet with this FundToken (allow_fund)', entry ? `token ${entry.token}, cap ${entry.cap}, spent ${entry.spent}` : 'not allowed');
        } catch (e) {
          add('M7', false, 'the wallet contract allows this fund wallet with this FundToken', (e as Error).message);
        }
      }
      if (subMeta?.ledger && mintMeta?.ledger) add('M8', mintMeta.ledger > subMeta.ledger, 'mint is in a later ledger than subscribe', `${subMeta.ledger} then ${mintMeta.ledger}`);
    }
  }

  // ---- log ----
  let logSource = 'none (on-chain only)';
  const apiBase = opt('api');
  const src = flag('tests-db') ? await logFromTestsDb() : apiBase ? await logFromApi(apiBase) : null;
  if (!src) {
    skip('L*', 'decision log not checked: pass --tests-db or --api <base url>');
  } else {
    logSource = src.source;
    try {
      const byHash = new Map(src.rows.map((r) => [r.hash, r]));
      const decisionRow = decision ? byHash.get(decision) : undefined;
      add('L1', !!decisionRow, 'decision argument equals the hash of a log row', decisionRow ? `row ${decisionRow.seq}` : `no row with hash ${decision}`);
      if (decisionRow) {
        const p = decisionRow.payload;
        add('L2', p.kind === 'decision' && p.outcome === 'APPROVED' && p.rule === 'all_rules_passed', 'that row is an APPROVED policy decision (all_rules_passed)', `${p.kind} ${p.outcome} ${p.rule}`);
        add('L3', amount !== null && p.amountUnits === amount.toString(), 'the amount paid equals the amount the policy approved', `log ${p.amountUnits}, chain ${amount}`);
      }
      const subRow = src.rows.find((r) => r.payload.kind === 'onchain_event' && r.payload.rule === 'subscribe' && r.payload.txHash === subscribeHash);
      const mintRow = src.rows.find((r) => r.payload.kind === 'onchain_event' && r.payload.rule === 'mint' && r.payload.txHash === mintHash);
      add('L4', !!subRow, 'the subscribe hash has its onchain_event row (subscribe, CONFIRMED)', subRow ? `row ${subRow.seq}` : 'missing');
      add('L5', !!mintRow, 'the mint hash has its onchain_event row (mint, CONFIRMED)', mintRow ? `row ${mintRow.seq}` : 'missing');
      if (decisionRow && subRow && mintRow) {
        const sameFund = decisionRow.payload.fundId === subRow.payload.fundId && subRow.payload.fundId === mintRow.payload.fundId;
        add('L6', sameFund && decisionRow.seq < subRow.seq && subRow.seq < mintRow.seq, 'same fund in the three rows, in order decision, subscribe, mint', `${decisionRow.seq} < ${subRow.seq} < ${mintRow.seq}`);
      }
      for (const [id, row] of [['L7a', decisionRow], ['L7b', subRow], ['L7c', mintRow]] as const) {
        if (!row) continue;
        const recomputed = chainHash(row.prevHash, row.payload);
        const canonicalOk = row.stored === undefined || canonical(row.payload) === row.stored;
        add(id, recomputed === row.hash && canonicalOk, `row ${row.seq} recomputes as sha256(prevHash || canonical(payload))`, recomputed === row.hash ? (row.stored === undefined ? 'hash ok (payload from the API)' : 'hash and canonical form ok') : `recomputed ${recomputed}`);
      }
      add('L8', src.verify.ok, 'the whole decision log chain verifies', src.verify.detail);
    } finally {
      await src.close();
    }
  }

  // ---- verdict ----
  const failed = checks.filter((c) => c.status === 'fail');
  const logChecked = !!src;
  const verdict = failed.length > 0 ? 'NOT CONFIRMED' : logChecked ? 'M1 CONFIRMED' : 'PARTIAL: on-chain confirmed, decision log not checked';

  console.log(`M1 check, ${NETWORK_LABEL}, read only`);
  console.log(`subscribe ${EXPLORER_TX_BASE}${subscribeHash}`);
  console.log(`mint      ${EXPLORER_TX_BASE}${mintHash}`);
  console.log(`log       ${logSource}`);
  console.log('');
  for (const c of checks) console.log(`[${c.status.toUpperCase().padEnd(4)}] ${c.id.padEnd(4)} ${c.what}${c.detail ? `: ${c.detail}` : ''}`);
  console.log('');
  console.log(`VERDICT: ${verdict}${failed.length ? ` (${failed.length} failed: ${failed.map((c) => c.id).join(', ')})` : ''}`);

  const jsonOut = opt('json');
  if (jsonOut) {
    writeFileSync(
      jsonOut,
      JSON.stringify(
        { network: NETWORK_LABEL, checkedAt: new Date().toISOString(), subscribe: { hash: subscribeHash, ...subMeta, link: `${EXPLORER_TX_BASE}${subscribeHash}` }, mint: { hash: mintHash, ...mintMeta, link: `${EXPLORER_TX_BASE}${mintHash}` }, wallet, fundWallet, token, decision, logSource, checks, verdict },
        null,
        2
      )
    );
  }
  process.exit(failed.length > 0 ? 1 : logChecked ? 0 : 3);
}

function bytes32(h: string) {
  // ScVal bytes for a BytesN<32> argument
  const { xdr } = apiRequire('@stellar/stellar-sdk') as typeof import('@stellar/stellar-sdk');
  return xdr.ScVal.scvBytes(Buffer.from(h, 'hex'));
}

main().catch((e) => {
  console.error(`check-m1: ${(e as Error).message}`);
  process.exit(2);
});

