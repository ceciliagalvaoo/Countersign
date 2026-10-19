// Evidence export (build line 3.4, test-engineer). READ ONLY. One command:
//   npm --prefix tests run evidence
// writes evidence/EVIDENCE.md and evidence/evidence.json.
//
// Hash sources: the confirmed on-chain rows of each decision log (disposable e2e database, disposable suites
// database, and the team database through the API as the demo investor), plus every hash listed in
// scripts/e2e/last-run.json and evidence/suites-*.json. For every hash it reads the transaction from Horizon
// testnet (status, ledger, time, envelope), decodes the contract call, and requires one decision-log row whose
// rule matches the action. For every subscribe it compares the decision argument with the hash of an APPROVED
// policy row of the same log. Each log chain is recomputed with the policy-guard functions (imported).
//
// The command FAILS (exit 1) on: a hash without task, a hash without log row (outside the categories below), an
// action that does not match its row, a decision that differs, a broken chain, a transaction not found.
// Categories that are listed but are not evidence rows of the main table:
//   by design   FAILED transactions of the bypass cases (A03, A04, A06, A07) and the mint refused under pause:
//               they never pass through our server, so they have no decision-log line.
//   setup       friendbot, faucet, trustlines, the dedicated test wallet of the bypass cases, FundToken deploys
//               of fund onboarding: not investor tasks.
//   gap         product transactions that should have a log line and do not (listed for their owner; not counted).
// Credentials only from the environment (never printed): CS_INVESTOR_EMAIL and CS_INVESTOR_PASSWORD (or
// CS_INVESTOR_JWT) for the demo investor, CS_API_URL (default http://localhost:3001/api). Without them, the
// team-database rows are marked "pending: the human runs this with her credentials".
import dns from 'node:dns';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainHash, verifyChain, type LogPayload } from '../../apps/api/src/policy/decisionLog.js';

dns.setDefaultResultOrder('ipv4first');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const apiRequire = createRequire(resolve(root, 'apps', 'api', 'package.json'));
const Sdk = apiRequire('@stellar/stellar-sdk') as typeof import('@stellar/stellar-sdk');
const dotenv = apiRequire('dotenv') as typeof import('dotenv');
const PASSPHRASE = Sdk.Networks.TESTNET;
const NETWORK = 'Stellar testnet';
const HORIZON = 'https://horizon-testnet.stellar.org';
const EXPLORER = 'https://stellar.expert/explorer/testnet/tx/';
const MANDATE_WASM = readEnv(resolve(root, 'apps/api/.env')).MANDATE_WALLET_WASM_HASH ?? '';
const FUND_TOKEN_WASM = readEnv(resolve(root, 'apps/api/.env')).FUND_TOKEN_WASM_HASH ?? '';

const BYPASS = 'no decision-log line by design: the request bypassed our server; refused by our wallet contract on Stellar (not audited)';
const PAUSED_MINT = 'no decision-log line by design: the mint was sent while the fund wallet had paused the FundToken; refused by the FundToken contract on Stellar (not audited)';

function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (existsSync(file)) dotenv.config({ path: file, processEnv: out, quiet: true } as never);
  return out;
}

type Category = 'evidence' | 'by_design' | 'setup' | 'gap';
interface Entry {
  hash: string;
  tasks: string[];
  source: string; // which log the hash belongs to
  declared?: 'SUCCESS' | 'FAILED';
  category: Category;
  reason?: string;
  setupHint?: boolean;
  // filled
  status?: string;
  ledger?: number;
  at?: string;
  action?: string;
  contract?: string;
  logRow?: { seq: number; hash: string; rule: string; outcome: string };
  decision?: { arg: string; row: number | null; ok: boolean };
  problems: string[];
}

interface LogRow {
  seq: number;
  prevHash: string;
  hash: string;
  payload: LogPayload;
}
interface Source {
  name: string;
  label: string;
  rows: LogRow[];
  verify: { ok: boolean; detail: string } | null;
  pending?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Log sources
// ---------------------------------------------------------------------------------------------------------------

async function dbSource(name: string, label: string, url: string | undefined): Promise<Source> {
  if (!url) return { name, label, rows: [], verify: null, pending: 'database URL not configured' };
  const u = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || u.port !== '55432') throw new Error(`${name}: only the disposable Postgres on localhost:55432 is read directly`);
  const { PrismaClient } = apiRequire('@prisma/client') as typeof import('@prisma/client');
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const raw = await prisma.decisionLog.findMany({ orderBy: { seq: 'asc' } });
    const v = await verifyChain(prisma);
    return {
      name,
      label,
      rows: raw.map((r) => ({ seq: r.seq, prevHash: r.prevHash, hash: r.hash, payload: JSON.parse(r.payload) as LogPayload })),
      verify: v.ok ? { ok: true, detail: `${v.count} rows recomputed, head ${v.headHash.slice(0, 12)}...` } : { ok: false, detail: `first bad row ${v.firstBadSeq}: ${v.reason}` },
    };
  } catch (e) {
    return { name, label, rows: [], verify: null, pending: `could not read: ${(e as Error).message.split('\n')[0]}` };
  } finally {
    await prisma.$disconnect();
  }
}

// The API returns only the logged-in user's rows: investor rows (purchases) and manager rows (vault steps) are read separately
async function apiSource(role: 'INVESTOR' | 'MANAGER' = 'INVESTOR'): Promise<Source> {
  const name = role === 'INVESTOR' ? 'team' : 'team-manager';
  const label = role === 'INVESTOR' ? 'team database (read through the API as the demo investor)' : 'team database (read through the API as the fund manager)';
  const api = (process.env.CS_API_URL ?? 'http://localhost:3001/api').replace(/\/+$/, '');
  let token = process.env[`CS_${role}_JWT`]?.trim();
  try {
    if (!token) {
      const email = process.env[`CS_${role}_EMAIL`]?.trim();
      const password = process.env[`CS_${role}_PASSWORD`] ?? '';
      if (!email || !password) return { name, label, rows: [], verify: null, pending: `pending: the human runs this with CS_${role}_EMAIL and CS_${role}_PASSWORD` };
      const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      if (!res.ok) return { name, label, rows: [], verify: null, pending: `pending: login failed with HTTP ${res.status}` };
      token = ((await res.json()) as { token?: string }).token;
    }
    const get = async (p: string) => {
      const res = await fetch(`${api}${p}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`GET ${p} returned HTTP ${res.status}`);
      return res.json() as Promise<any>;
    };
    const list = await get('/decision-log?limit=1000');
    const v = await get('/decision-log/verify');
    const rows: LogRow[] = list.entries.map((e: any) => ({ seq: e.seq, prevHash: e.prevHash, hash: e.hash, payload: e.payload }));
    const bad = rows.find((r) => chainHash(r.prevHash, r.payload) !== r.hash);
    return {
      name,
      label,
      rows,
      verify: v.ok && !bad ? { ok: true, detail: `API verify: ${v.count} rows; her ${rows.length} rows recomputed locally` } : { ok: false, detail: bad ? `row ${bad.seq} does not recompute` : `first bad row ${v.firstBadSeq}: ${v.reason}` },
    };
  } catch (e) {
    return { name, label, rows: [], verify: null, pending: `pending: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Declared hashes (files)
// ---------------------------------------------------------------------------------------------------------------

const entries = new Map<string, Entry>();
function declare(hash: string, task: string, source: string, opts: Partial<Entry> = {}) {
  const h = hash.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) return;
  const e = entries.get(h) ?? { hash: h, tasks: [], source, category: 'evidence' as Category, problems: [] };
  if (!e.tasks.includes(task)) e.tasks.push(task);
  if (opts.category && opts.category !== 'evidence') {
    e.category = opts.category;
    e.reason = opts.reason;
  }
  if (opts.declared) e.declared = opts.declared;
  if (opts.setupHint) e.setupHint = true;
  entries.set(h, e);
}

function declareFiles() {
  const e2e = resolve(root, 'scripts/e2e/last-run.json');
  if (existsSync(e2e)) {
    const j = JSON.parse(readFileSync(e2e, 'utf8'));
    for (const r of j.records ?? []) {
      const task = `e2e run ${j.run} (scripts/e2e, CLI identities): ${r.step}`;
      if (/while paused/i.test(r.step)) declare(r.hash, task, 'e2e', { category: 'by_design', reason: PAUSED_MINT, declared: 'FAILED' });
      else declare(r.hash, task, 'e2e', { declared: r.status, setupHint: r.logSeq == null });
    }
  }
  const files = [
    ...readdirSync(resolve(root, 'evidence')).filter((f) => /^suites-.*\.json$/.test(f)).map((f) => resolve(root, 'evidence', f)),
    ...(existsSync(resolve(root, 'evidence/private')) ? readdirSync(resolve(root, 'evidence/private')).filter((f) => /^suites-dryrun-.*\.json$/.test(f)).map((f) => resolve(root, 'evidence/private', f)) : []),
  ];
  for (const f of files) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    const run = f.replace(/^.*suites-/, '').replace(/\.json$/, '');
    const dry = /dryrun/.test(run);
    const tag = dry ? `benign suite dry run ${run} (scripted model)` : `suite run ${run}`;
    if (!j.adversarial?.otherRowsFrom) {
      for (const s of j.adversarial?.setupTransactions ?? []) declare(s.hash, `${tag}: ${s.label}`, 'suites', { setupHint: true });
      for (const r of j.adversarial?.rows ?? []) {
        for (const h of r.hashes ?? []) {
          if (r.layer === 'contract' && h.status === 'FAILED') declare(h.hash, `${tag}, ${r.id} ${r.family}: ${h.label}`, 'suites', { category: 'by_design', reason: BYPASS, declared: 'FAILED' });
          // A successful call on the dedicated test wallet of the contract cases is setup of the bypass test
          else if (r.layer === 'contract') declare(h.hash, `${tag}, ${r.id}: ${h.label}`, 'suites', { declared: h.status, setupHint: true });
          else declare(h.hash, `${tag}, ${r.id}: ${h.label}`, 'suites', { declared: h.status });
        }
      }
    } else {
      for (const r of (j.adversarial?.rows ?? []).filter((x: any) => x.id === 'A08' || x.id === 'A09')) for (const h of r.hashes ?? []) declare(h.hash, `${tag}, ${r.id}: ${h.label}`, 'suites');
    }
    for (const s of j.benign?.setupTransactions ?? []) declare(s.hash, `${tag}: ${s.label}`, 'suites', { setupHint: true });
    for (const r of j.benign?.rows ?? []) for (const h of r.hashes ?? []) declare(h.hash, `${tag}, ${r.id}: ${h.label}`, 'suites', { declared: h.status });
  }
  // M1 through the UI (team database, demo investor with her Freighter wallet), 18/10
  declare('ca28550282a909fc3d625dc3ef09825bd53a1be100d87f057b4b1d54a6b47bd1', 'M1 through the UI, 18/10: agent subscribe 5 USDC (CSAGRI) from her mandate wallet', 'team');
  declare('b9d1ad650a9cdafb6f8ae1c488baac57baca1489c57fcb3913fffeb8a016674d', 'M1 through the UI, 18/10: issuer mint of 5 CSAGRI units to her mandate wallet (countersignature)', 'team');
  declare('2af6d0cd9f1cee79308205da7dc7a9097c7d3145ce4642c02b0969368e7e7be6', 'M1 through the UI, 18/10: issuer whitelist_add of her mandate wallet', 'team');
  declare('a2a522f21168be62e22ef4601ede18cc9c8f9539b4c60908ab38f834bbaa0909', 'M1 through the UI, 18/10: fund wallet deploys the CSAGRI FundToken (fund onboarding)', 'team', { setupHint: true });
}

// ---------------------------------------------------------------------------------------------------------------
// Chain reads (Horizon keeps every transaction; RPC history is short)
// ---------------------------------------------------------------------------------------------------------------

async function horizonTx(hash: string, attempt = 0): Promise<any | null> {
  const res = await fetch(`${HORIZON}/transactions/${hash}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    if (attempt < 5) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      return horizonTx(hash, attempt + 1);
    }
    throw new Error(`Horizon ${res.status} for ${hash}`);
  }
  return res.json();
}

interface Decoded {
  kind: 'invoke' | 'deploy' | 'classic';
  method?: string;
  contract?: string;
  args?: unknown[];
  wasm?: string;
  ops?: string[];
}
function decode(envelopeXdr: string): Decoded {
  const tx: any = Sdk.TransactionBuilder.fromXDR(envelopeXdr, PASSPHRASE);
  const inner = tx.innerTransaction ?? tx;
  const ops = inner.operations as any[];
  if (ops.length !== 1 || ops[0].type !== 'invokeHostFunction') return { kind: 'classic', ops: ops.map((o) => o.type) };
  const fn = ops[0].func;
  const name = fn.switch().name;
  if (name === 'hostFunctionTypeInvokeContract') {
    const c = fn.invokeContract();
    return { kind: 'invoke', contract: Sdk.Address.fromScAddress(c.contractAddress()).toString(), method: c.functionName().toString(), args: c.args().map((a: any) => Sdk.scValToNative(a)) };
  }
  if (name === 'hostFunctionTypeCreateContractV2' || name === 'hostFunctionTypeCreateContract') {
    const create = name === 'hostFunctionTypeCreateContractV2' ? fn.createContractV2() : fn.createContract();
    const ex = create.executable();
    return { kind: 'deploy', method: 'deploy', wasm: ex.switch().name === 'contractExecutableWasm' ? ex.wasmHash().toString('hex') : undefined };
  }
  return { kind: 'classic', ops: [name] };
}

const RULE_FOR: Record<string, string[]> = {
  subscribe: ['subscribe', 'execution_failed', 'execution_pending_network'],
  set_limits: ['set_limits'],
  allow_fund: ['allow_fund'],
  disallow_fund: ['disallow_fund'],
  revoke_agent: ['revoke_agent'],
  set_agent: ['set_agent'],
  withdraw: ['withdraw'],
  withdraw_units: ['withdraw_units'],
  whitelist_add: ['whitelist_add'],
  mint: ['mint'],
  set_pause: ['set_pause'],
  admin_register_fund: ['vault_register'],
  admin_register_entity: ['vault_register'],
  register_receivable: ['vault_register'],
  pay: ['pay'],
  distribute: ['distribute'],
  claim: ['claim'],
  transfer: ['deposit', 'refund', 'withdraw'],
  deploy: ['deploy_wallet'],
};

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const testsEnv = readEnv(resolve(root, 'tests/.env'));
  const sources: Source[] = [
    await dbSource('e2e', 'disposable e2e database (countersign_test, port 55432)', process.env.EVIDENCE_E2E_DATABASE_URL || testsEnv.DATABASE_URL),
    await dbSource('suites', 'disposable suites database (countersign_suites, port 55432)', process.env.EVIDENCE_SUITES_DATABASE_URL || testsEnv.SUITES_DATABASE_URL),
    await apiSource('INVESTOR'),
    await apiSource('MANAGER'),
  ];
  declareFiles();

  // Every confirmed row of every log is a hash to account for
  const rowByTx = new Map<string, { src: Source; row: LogRow }[]>();
  for (const src of sources) {
    for (const row of src.rows) {
      const tx = row.payload.txHash;
      if (!tx) continue;
      const list = rowByTx.get(tx) ?? [];
      list.push({ src, row });
      rowByTx.set(tx, list);
      if (!entries.has(tx)) declare(tx, `${src.name === 'e2e' ? 'e2e run (scripts/e2e)' : src.name === 'suites' ? 'suite run' : 'demo investor, team database'}: ${row.payload.rule} (log row ${row.seq})`, src.name);
    }
  }

  const failures: string[] = [];
  let n = 0;
  for (const e of entries.values()) {
    n++;
    if (n % 20 === 0) console.log(`  ${n}/${entries.size} transactions read`);
    if (!e.tasks.length) e.problems.push('hash without task');
    const t = await horizonTx(e.hash);
    if (!t) {
      e.problems.push('transaction not found on Horizon testnet');
    } else {
      e.status = t.successful ? 'SUCCESS' : 'FAILED';
      e.ledger = t.ledger;
      e.at = t.created_at;
      try {
        const d = decode(t.envelope_xdr);
        e.action = d.kind === 'classic' ? `classic: ${(d.ops ?? []).join(', ')}` : d.kind === 'deploy' ? `deploy (${d.wasm === MANDATE_WASM ? 'mandate wallet' : d.wasm === FUND_TOKEN_WASM ? 'FundToken' : 'other Wasm'})` : `${d.method}`;
        e.contract = d.contract;
        const rows = rowByTx.get(e.hash) ?? [];
        const r = rows[0];
        if (r) {
          e.logRow = { seq: r.row.seq, hash: r.row.hash, rule: r.row.payload.rule, outcome: r.row.payload.outcome };
          e.source = r.src.name;
          const method = d.kind === 'deploy' ? 'deploy' : d.method ?? '';
          const allowed = RULE_FOR[method] ?? [];
          if (!allowed.includes(r.row.payload.rule)) e.problems.push(`action ${e.action} does not match its log row rule ${r.row.payload.rule}`);
          if (d.kind === 'deploy' && d.wasm !== MANDATE_WASM) e.problems.push('deploy logged as deploy_wallet is not the mandate wallet Wasm');
          if (e.status === 'FAILED' && r.row.payload.rule !== 'execution_failed') e.problems.push('FAILED transaction logged as confirmed');
          if (method === 'subscribe') {
            const arg = d.args?.[0] instanceof Uint8Array ? Buffer.from(d.args[0] as Uint8Array).toString('hex') : '';
            const dec = r.src.rows.find((x) => x.hash === arg);
            const ok = !!dec && dec.payload.kind === 'decision' && dec.payload.outcome === 'APPROVED' && dec.payload.rule === 'all_rules_passed' && dec.payload.amountUnits === String(d.args?.[2]);
            e.decision = { arg, row: dec?.seq ?? null, ok };
            if (!ok) e.problems.push(`decision argument ${arg.slice(0, 12)}... is not the hash of an APPROVED row of the same log with the same amount`);
          }
        } else if (e.category === 'evidence') {
          const src = sources.find((s) => s.name === e.source);
          if (src?.pending) {
            e.category = 'evidence';
            e.reason = src.pending;
          } else if (e.setupHint || (d.kind === 'deploy' && d.wasm === FUND_TOKEN_WASM) || d.kind === 'classic') {
            e.category = 'setup';
            e.reason = d.kind === 'deploy' && d.wasm === FUND_TOKEN_WASM ? 'fund onboarding: FundToken deploy by the fund wallet (manager flow); the decision log covers investor tasks' : 'test or account setup (friendbot, faucet, trustline, dedicated test wallet of the bypass cases); not an investor task';
          } else if (d.method === 'claim') {
            e.category = 'gap';
            e.reason = 'ZK badge claim confirmed by the API without a decision-log line (owner: stellar-integrator with policy-guard, action "claim" exists in ONCHAIN_ACTIONS)';
          } else {
            e.problems.push('hash without decision-log line');
          }
        }
        if (e.declared && e.status && e.declared !== e.status) e.problems.push(`declared ${e.declared}, ledger says ${e.status}`);
        if (e.category === 'by_design' && e.status !== 'FAILED') e.problems.push('listed as refused but the transaction succeeded');
      } catch (err) {
        e.problems.push(`decode failed: ${(err as Error).message}`);
      }
    }
    for (const p of e.problems) failures.push(`${e.hash}: ${p}`);
  }
  for (const s of sources) if (s.verify && !s.verify.ok) failures.push(`chain of ${s.label} broken: ${s.verify.detail}`);

  // ------------------------------------------------------------------ output
  const list = [...entries.values()].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  const main = list.filter((e) => e.category === 'evidence');
  const pending = main.filter((e) => !e.logRow && e.reason);
  const byDesign = list.filter((e) => e.category === 'by_design');
  const setup = list.filter((e) => e.category === 'setup');
  const gaps = list.filter((e) => e.category === 'gap');
  const subs = main.filter((e) => e.decision);
  const json = {
    generatedAt: new Date().toISOString(),
    network: NETWORK,
    note: 'Transaction hashes prove the mechanism, not a market.',
    sources: sources.map((s) => ({ name: s.name, label: s.label, rows: s.rows.length, chain: s.verify, pending: s.pending ?? null })),
    summary: {
      evidenceRows: main.length,
      withLogRow: main.filter((e) => e.logRow).length,
      pendingHuman: pending.length,
      purchasesChecked: subs.length,
      purchasesDecisionOk: subs.filter((e) => e.decision?.ok).length,
      byDesign: byDesign.length,
      setup: setup.length,
      gaps: gaps.length,
      failures: failures.length,
    },
    transactions: list.map((e) => ({
      hash: e.hash,
      category: e.category,
      tasks: e.tasks,
      network: NETWORK,
      link: EXPLORER + e.hash,
      timestamp: e.at ?? null,
      ledger: e.ledger ?? null,
      action: e.action ?? null,
      contract: e.contract ?? null,
      result: e.status ?? null,
      logSource: e.logRow ? sources.find((s) => s.name === e.source)?.label : null,
      logRow: e.logRow ?? null,
      decision: e.decision ?? null,
      reason: e.reason ?? null,
      problems: e.problems,
    })),
    failures,
  };
  const short = (h: string) => `${h.slice(0, 10)}...${h.slice(-6)}`;
  const cell = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const md: string[] = [];
  md.push('# Countersign: execution evidence');
  md.push('');
  md.push('> Transaction hashes prove the mechanism, not a market.');
  md.push('');
  md.push(`Network: ${NETWORK} only (test assets; no mainnet transaction in this file). Generated ${json.generatedAt} by \`npm --prefix tests run evidence\`. The wallet contract is ours and not audited.`);
  md.push('');
  md.push('## 01 Evidence Summary');
  md.push('');
  md.push(`- Transactions in the evidence table: ${main.length}; each has a task and a decision-log line${pending.length ? `, except ${pending.length} pending (team database not read: ${sources.find((s) => s.name === 'team')?.pending})` : ''}.`);
  md.push(`- Agent purchases (subscribe) checked: ${subs.length}; decision argument equal to the hash of an APPROVED decision-log line with the same amount: ${subs.filter((e) => e.decision?.ok).length}.`);
  for (const s of sources) md.push(`- Decision log, ${s.label}: ${s.pending ? s.pending : s.verify?.ok ? `chain verified (${s.verify.detail})` : `CHAIN BROKEN (${s.verify?.detail})`}.`);
  md.push(`- Refused on-chain by design, no decision-log line (listed below): ${byDesign.length}. Setup transactions (not evidence, listed): ${setup.length}. Known gaps (listed, not counted): ${gaps.length}.`);
  md.push(`- Divergences: ${failures.length}${failures.length ? ' (the command failed)' : ''}.`);
  md.push('');
  md.push('## 02 Logs or Transactions');
  md.push('');
  md.push('| Hash | Timestamp (UTC) | Action | Result | Task | Decision-log line | Decision check | Link |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const e of main) {
    md.push(
      `| \`${short(e.hash)}\` | ${e.at ?? ''} | ${cell(e.action)} | ${e.status ?? ''} | ${cell(e.tasks.join('; '))} | ${e.logRow ? `${cell(sources.find((s) => s.name === e.source)?.name)} #${e.logRow.seq} ${e.logRow.rule}` : cell(e.reason ?? 'none')} | ${e.decision ? (e.decision.ok ? `decision = line #${e.decision.row}` : 'DIVERGENT') : 'n/a'} | [stellar.expert](${EXPLORER}${e.hash}) |`
    );
  }
  md.push('');
  md.push('### Refused on-chain, no decision-log line by design');
  md.push('');
  md.push('| Hash | Timestamp (UTC) | Action | Result | Task | Why there is no line | Link |');
  md.push('|---|---|---|---|---|---|---|');
  for (const e of byDesign) md.push(`| \`${short(e.hash)}\` | ${e.at ?? ''} | ${cell(e.action)} | ${e.status ?? ''} | ${cell(e.tasks.join('; '))} | ${cell(e.reason)} | [stellar.expert](${EXPLORER}${e.hash}) |`);
  md.push('');
  md.push('For these, "transaction failed on-chain" is consensus; the contract error number comes from the RPC diagnostic events of the suite run.');
  md.push('');
  if (gaps.length) {
    md.push('### Known gaps (not counted as evidence)');
    md.push('');
    for (const e of gaps) md.push(`- \`${e.hash}\` ${cell(e.tasks.join('; '))}: ${cell(e.reason)}`);
    md.push('');
  }
  md.push('### Setup transactions (not evidence)');
  md.push('');
  md.push(`${setup.length} transactions: ${[...new Set(setup.map((e) => e.reason))].map(cell).join('; ')}. Full list in \`evidence/evidence.json\`.`);
  md.push('');
  md.push('## 03 Reproduction Guide');
  md.push('');
  md.push('**Verify without running anything:** open any link above on stellar.expert (testnet). For an agent purchase, the first argument of `subscribe` is the decision; it equals the hash of the decision-log line shown in the table.');
  md.push('');
  md.push('**Reproduce:** follow `tests/RUNBOOK.md`: deploy the contracts, seed the demo funds, run the API and the agent, then `npm --prefix tests run suites` (suites) and `npm --prefix tests run evidence` (this file). The command recomputes each decision-log chain, reads every transaction from Horizon testnet, decodes it, and fails on any hash without task or log line, any action that differs from its line, any decision that differs, or a broken chain.');
  md.push('');

  // EVIDENCE_OUT_DIR: write elsewhere (the tamper test writes to a scratch folder, never over the real evidence)
  const outDir = process.env.EVIDENCE_OUT_DIR ? resolve(process.env.EVIDENCE_OUT_DIR) : resolve(root, 'evidence');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'evidence.json'), JSON.stringify(json, null, 2));
  writeFileSync(resolve(outDir, 'EVIDENCE.md'), md.join('\n'));
  console.log(`evidence: ${main.length} evidence rows (${pending.length} pending the team database), ${subs.length} purchases checked (${subs.filter((e) => e.decision?.ok).length} decision ok), ${byDesign.length} by design, ${setup.length} setup, ${gaps.length} gaps`);
  for (const s of sources) console.log(`  log ${s.name}: ${s.pending ?? (s.verify?.ok ? 'chain ok' : 'CHAIN BROKEN')} ${s.verify?.detail ?? ''}`);
  console.log('written evidence/EVIDENCE.md and evidence/evidence.json');
  if (failures.length) {
    console.log(`FAILED: ${failures.length} divergences`);
    for (const f of failures.slice(0, 30)) console.log(`  ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`evidence export: ${(e as Error).message}`);
  process.exit(2);
});

