// Mainnet slice (build line 3.6, D25): one mandate wallet on Stellar mainnet, about 4 USDC, one purchase by the agent
// with `decision` = hash of a decision log row. Run through run.sh. Steps, in order:
//
//   status                         read only: balances, Wasm presence, slice state, fee stats
//   dry-run                        read only rehearsal: simulations and fees, nothing signed or sent
//   upload mandate_wallet          Wasm upload, paid by cs-mainnet-uploader                     (asks OK)
//   deploy fund_unit_sac           Stellar Asset Contract of the team-issued test asset CSAGRI:GCKZ...,
//                                  paid by cs-mainnet-uploader (anyone can deploy a SAC)          (asks OK)
//   build wallet_deploy            unsigned XDR for the owner (GCMB) to sign in Freighter
//   build deposit                  unsigned XDR: USDC transfer owner -> wallet (SAC), owner signs
//   build allow_fund               unsigned XDR: allow_fund(fund wallet, fund token, cap), owner signs
//   sign-page                      local page (127.0.0.1) to sign pending XDRs in Freighter without re-simulation
//   submit <name> <signed.xdr>     checks hash and signature, shows the decoded call, asks OK, submits, verifies
//   propose                        our policy rules (apps/api/src/policy/rules.ts) on mainnet facts -> decision row
//   subscribe                      subscribe(decision, fund wallet, amount) signed by cs-mainnet-agent (asks OK)
//   verify                         recomputes the slice log chain and compares `decision` read from the ledger
//
// Every confirmed hash gets a row in the slice's own hash-chained decision log (scripts/mainnet/out/decision-log.jsonl),
// built with the same canonical serialization and chain hash as the API log (policy/canonical.ts, decisionLog.ts).
// Hard limits: mainnet passphrase only; total USDC moved never above 5; nothing is sent without the typed OK.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { canonical } from '../../apps/api/src/policy/canonical.js';
import { chainHash, ZERO_HASH, type LogPayload } from '../../apps/api/src/policy/decisionLog.js';
import { mandateHash, mandateSchema, setLimitsArgs } from '../../apps/api/src/policy/mandate.js';
import { evaluate, type PolicyContext } from '../../apps/api/src/policy/rules.js';
import { checkSubscribeXdr } from '../../apps/api/src/agentSigner/verifyXdr.js';
import http from 'http';
import { compareSigned, formatChecks } from './txcompare.js';
import { checkFeeLimits, checkSimulatedFee, feeParts, inclusionBid, withResourceFeeMargin } from './fees.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const requireFromApi = createRequire(path.join(ROOT, 'apps/api/package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Sdk: any = requireFromApi('@stellar/stellar-sdk');

// ---- network (mainnet only) ----
const PASSPHRASE = Sdk.Networks.PUBLIC;
const RPC_URL = process.env.MAINNET_RPC_URL || 'https://mainnet.sorobanrpc.com'; // public RPC listed in the Stellar docs (fee stats section)
const HORIZON_URL = 'https://horizon.stellar.org';
const NETWORK_LABEL = 'Stellar mainnet';
const USDC = { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' }; // Circle, per the Stellar docs
const USDC_SAC_DOCS = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
const MAX_USDC_UNITS = 5n * 10_000_000n;
const server = new Sdk.rpc.Server(RPC_URL);
const expert = (h: string) => `https://stellar.expert/explorer/public/tx/${h}`;

const OUT = path.join(here, 'out');
const STATE_FILE = path.join(OUT, 'state.json');
const LOG_FILE = path.join(OUT, 'decision-log.jsonl');
const config = JSON.parse(fs.readFileSync(path.join(here, 'slice-config.json'), 'utf8'));
const WASM = {
  mandate_wallet: path.join(ROOT, 'contracts/mandate-wallet/target/wasm32v1-none/release/mandate_wallet.wasm'),
} as const;
const SLICE_USER = 'mainnet-slice-investor';
export const SLICE_LABEL =
  'mainnet slice: the fund unit token is a team-issued test asset (Stellar Asset Contract); the purchase proposal was ' +
  'entered by the operator and decided by our policy code; the issuer countersignature is demonstrated on testnet';
/** Fund unit token of the slice: SAC of a classic asset issued by the test fund wallet (no unit is ever issued) */
const fundUnitAsset = () => new Sdk.Asset(config.fund.symbol, config.fundWallet);
const fundUnitSac = () => fundUnitAsset().contractId(PASSPHRASE);

const agent = Sdk.Keypair.fromSecret(process.env.MAINNET_AGENT_SECRET!);
const uploader = Sdk.Keypair.fromSecret(process.env.MAINNET_UPLOADER_SECRET!);

interface State {
  wasm: Partial<Record<keyof typeof WASM, { hash: string; txHash?: string }>>;
  fundToken?: string;
  wallet?: string;
  pending: Record<string, { xdr: string; hash: string; signer: string; kind: string }>;
  txs: { step: string; hash: string; status: string; link: string; logSeq?: number }[];
  decision?: { seq: number; hash: string; amountUnits: string };
}
fs.mkdirSync(OUT, { recursive: true });
const state: State = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : { wasm: {}, pending: {}, txs: [] };
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// ---- helpers ----
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function retry<T = any>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (!/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|timeout|50[234]|fetch failed/i.test(msg) || i >= attempts) throw e;
      console.log(`  [retry ${i}] ${label}: ${msg}`);
      await sleep(2000 * i);
    }
  }
}
const toUnits = (usdc: string) => {
  if (!/^(0|[1-9]\d*)(\.\d{1,7})?$/.test(usdc)) throw new Error(`bad amount ${usdc}`);
  const [w, f = ''] = usdc.split('.');
  return BigInt(w) * 10_000_000n + BigInt(f.padEnd(7, '0'));
};
const fmt = (u: bigint) => `${u / 10_000_000n}.${(u % 10_000_000n).toString().padStart(7, '0')}`;
const addr = (a: string) => Sdk.nativeToScVal(a, { type: 'address' });
const i128 = (v: bigint) => Sdk.nativeToScVal(v, { type: 'i128' });
const usdcSac = () => new Sdk.Asset(USDC.code, USDC.issuer).contractId(PASSPHRASE);

async function confirm(what: string) {
  if (!process.stdin.isTTY) throw new Error('refusing to send without an interactive terminal (human OK required)');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer: string = await new Promise((r) => rl.question(`\nMAINNET: ${what}\nType SEND MAINNET to send, anything else to stop: `, r));
  rl.close();
  if (answer.trim() !== 'SEND MAINNET') throw new Error('stopped by the operator: nothing was sent');
}

async function read(contractId: string, method: string, args: any[] = []) {
  const source = new Sdk.Account(Sdk.Keypair.random().publicKey(), '0');
  const tx = new Sdk.TransactionBuilder(source, { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Sdk.Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await retry('simulate', () => server.simulateTransaction(tx));
  if (Sdk.rpc.Api.isSimulationError(sim)) throw new Error(`read ${method}: ${sim.error}`);
  return Sdk.scValToNative(sim.result.retval);
}

/** Human readable decode of the single host function (the network is added out of band) */
function describe(tx: any): string {
  const op = tx.operations[0];
  const lines = [`network: ${NETWORK_LABEL} (out of band: the XDR does not contain the network)`, `source: ${tx.source}`, `fee: ${fmt(BigInt(tx.fee))} XLM max`, `tx hash: ${tx.hash().toString('hex')}`];
  const fees = feeParts(tx);
  lines.push(`inclusion bid: ${fees.inclusion} stroops; resource fee: ${fees.resource} stroops; total: ${fees.total} stroops`);
  if (op.type !== 'invokeHostFunction') return [...lines, `operation: ${op.type}`].join('\n  ');
  const f = op.func;
  const show = (v: any) => {
    try {
      const n = Sdk.scValToNative(v);
      if (typeof n === 'bigint') return `${n} (${fmt(n)} with 7 decimals)`;
      if (n instanceof Uint8Array) return Buffer.from(n).toString('hex');
      return JSON.stringify(n, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
    } catch {
      return v.switch().name;
    }
  };
  switch (f.switch().name) {
    case 'hostFunctionTypeInvokeContract': {
      const c = f.invokeContract();
      lines.push(`contract: ${Sdk.Address.fromScAddress(c.contractAddress()).toString()}`, `function: ${c.functionName().toString()}`);
      c.args().forEach((a: any, i: number) => lines.push(`arg${i}: ${show(a)}`));
      break;
    }
    case 'hostFunctionTypeCreateContractV2': {
      const c = f.createContractV2();
      lines.push(`create contract from Wasm ${c.executable().wasmHash().toString('hex')}`);
      c.constructorArgs().forEach((a: any, i: number) => lines.push(`constructor arg${i}: ${show(a)}`));
      break;
    }
    case 'hostFunctionTypeUploadContractWasm':
      lines.push(`upload Wasm (${f.wasm().length} bytes, sha256 ${crypto.createHash('sha256').update(f.wasm()).digest('hex')})`);
      break;
    default:
      lines.push(`host function ${f.switch().name}`);
  }
  lines.push(`auth entries: ${(op.auth ?? []).length}`);
  return lines.join('\n  ');
}

async function prepare(source: string, op: any, timeoutSeconds = 1800) {
  const stats = await retry('fees', () => server.getFeeStats());
  const bid = inclusionBid(stats.sorobanInclusionFee.p90, process.env.MAINNET_INCLUSION_FEE_STROOPS);
  const account = await retry('getAccount', () => server.getAccount(source));
  const tx = new Sdk.TransactionBuilder(account, { fee: bid.toString(), networkPassphrase: PASSPHRASE }).addOperation(op).setTimeout(timeoutSeconds).build();
  const prepared = await retry('prepareTransaction', () => server.prepareTransaction(tx));
  return withResourceFeeMargin(Sdk, prepared, bid);
}

function checkSendWindow(tx: any) {
  const now = Math.floor(Date.now() / 1000);
  const min = Number(tx.timeBounds?.minTime ?? 0);
  const max = Number(tx.timeBounds?.maxTime ?? 0);
  if (!max || now < min || now > max - 20)
    throw new Error('transaction outside its valid send window: rebuild and sign again');
}

async function send(tx: any, step: string) {
  checkFeeLimits(tx);
  const sim = await retry('fee preflight (read only)', () => server.simulateTransaction(tx));
  checkSimulatedFee(tx, sim);
  const stats = await retry('fees', () => server.getFeeStats());
  if (feeParts(tx).inclusion < BigInt(stats.sorobanInclusionFee.p90))
    console.log('  inclusion bid below recent p90 (historical statistic, not a network minimum); acceptance is not guaranteed');
  const hash = tx.hash().toString('hex');
  for (let i = 1; ; i++) {
    checkSendWindow(tx);
    const r = await retry('sendTransaction', () => server.sendTransaction(tx));
    if (r.status === 'PENDING' || r.status === 'DUPLICATE') break;
    if (r.status === 'TRY_AGAIN_LATER' && i < 10) { await sleep(3000); continue; }
    throw new Error(`${step}: sendTransaction ${r.status} ${r.errorResult ? r.errorResult.result().switch().name : ''}`);
  }
  for (let i = 0; i < 120; i++) {
    const res = await retry('getTransaction', () => server.getTransaction(hash));
    if (res.status === 'SUCCESS' || res.status === 'FAILED') {
      console.log(`  ${step}: ${res.status} ${hash}\n  ${expert(hash)}`);
      state.txs.push({ step, hash, status: res.status, link: expert(hash) });
      save();
      if (res.status !== 'SUCCESS') throw new Error(`${step} FAILED on-chain (${hash}); nothing more is done`);
      return { hash, res };
    }
    await sleep(3000);
  }
  throw new Error(`${step}: not in a ledger yet (${hash}); not done. Check it with: scripts/mainnet/run.sh status`);
}

// ---- slice decision log (same canonical form and chain hash as the API log) ----
function logRows(): { seq: number; prevHash: string; hash: string; payload: string }[] {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => typeof r.seq === 'number');
}
function append(entry: Omit<LogPayload, 'seq' | 'at' | 'userId'>) {
  const rows = logRows();
  const prev = rows.length ? rows[rows.length - 1].hash : ZERO_HASH;
  const payload: LogPayload = { ...entry, seq: rows.length + 1, userId: SLICE_USER, at: new Date().toISOString() } as LogPayload;
  const hash = chainHash(prev, payload);
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, JSON.stringify({ label: SLICE_LABEL, network: NETWORK_LABEL }) + '\n');
  fs.appendFileSync(LOG_FILE, JSON.stringify({ seq: payload.seq, prevHash: prev, hash, payload: canonical(payload) }) + '\n');
  return { seq: payload.seq, hash };
}
function logEvent(rule: string, txHash: string, amountUnits = '0', mandate: string | null = null) {
  const row = append({ kind: 'onchain_event', origin: 'onchain', fundId: config.fund.id, amountUnits, rule, outcome: 'CONFIRMED', mandateHash: mandate, toolCallId: null, txHash });
  const t = state.txs.find((x) => x.hash === txHash);
  if (t) t.logSeq = row.seq;
  save();
  console.log(`  decision log row ${row.seq} (${rule})`);
}

const mandate = () => mandateSchema.parse(config.mandate);

// ---- steps ----
async function status() {
  for (const [label, a] of [['owner', config.owner], ['fund wallet', config.fundWallet], ['agent (cs-mainnet-agent)', agent.publicKey()], ['uploader (cs-mainnet-uploader)', uploader.publicKey()]]) {
    const r = await fetch(`${HORIZON_URL}/accounts/${a}`);
    if (!r.ok) { console.log(`${label} ${a}: not created on mainnet (send XLM to create it)`); continue; }
    const j: any = await r.json();
    console.log(`${label} ${a}: ${j.balances.map((b: any) => `${b.balance} ${b.asset_code ?? 'XLM'}${b.asset_issuer ? '(' + b.asset_issuer.slice(0, 5) + ')' : ''}`).join(', ')}`);
  }
  console.log(`USDC SAC: ${usdcSac()} ${usdcSac() === USDC_SAC_DOCS ? '(matches the Stellar docs)' : 'DIFFERS FROM THE DOCS: stop'}`);
  for (const k of Object.keys(WASM) as (keyof typeof WASM)[]) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(WASM[k])).digest('hex');
    let on = false;
    try { await server.getContractWasmByHash(Buffer.from(hash, 'hex')); on = true; } catch { on = false; }
    console.log(`Wasm ${k} ${hash}: ${on ? 'on mainnet' : 'not on mainnet'}`);
  }
  const fees = await retry('fees', () => server.getFeeStats());
  console.log(`inclusion fee p90: soroban ${fees.sorobanInclusionFee.p90}, classic ${fees.inclusionFee.p90} stroops (historical statistics, not required minima)`);
  console.log(`state: fundToken ${state.fundToken ?? '-'}, wallet ${state.wallet ?? '-'}, decision ${state.decision ? `#${state.decision.seq} ${state.decision.hash}` : '-'}`);
  for (const t of state.txs) console.log(`  ${t.step} | ${t.status} | ${t.hash} | log ${t.logSeq ?? '-'}`);
}

async function upload(which: keyof typeof WASM) {
  if (!WASM[which]) throw new Error('upload mandate_wallet');
  const wasm = fs.readFileSync(WASM[which]);
  const hash = crypto.createHash('sha256').update(wasm).digest('hex');
  try { await server.getContractWasmByHash(Buffer.from(hash, 'hex')); console.log(`${which} ${hash} already on mainnet: nothing to do`); state.wasm[which] = { hash }; save(); return; } catch { /* upload */ }
  const tx = await prepare(uploader.publicKey(), Sdk.Operation.uploadContractWasm({ wasm }));
  console.log(`  ${describe(tx)}`);
  await confirm(`upload ${which} Wasm (${wasm.length} bytes), fee up to ${fmt(BigInt(tx.fee))} XLM paid by cs-mainnet-uploader`);
  tx.sign(uploader);
  const out = await send(tx, `upload ${which} Wasm`);
  state.wasm[which] = { hash, txHash: out.hash };
  save();
  logEvent('upload_wasm', out.hash);
}

async function deploySac(which: string) {
  if (which !== 'fund_unit_sac') throw new Error('deploy fund_unit_sac');
  const id = fundUnitSac();
  let exists = false;
  try { await read(id, 'symbol'); exists = true; } catch { exists = false; }
  if (exists) { console.log(`SAC ${id} for ${config.fund.symbol}:${config.fundWallet} already deployed`); state.fundToken = id; save(); return; }
  const tx = await prepare(uploader.publicKey(), Sdk.Operation.createStellarAssetContract({ asset: fundUnitAsset() }), 300);
  console.log(`  ${describe(tx)}\n  asset: ${config.fund.symbol}:${config.fundWallet} (team-issued test asset; no unit is issued)\n  expected contract: ${id}`);
  await confirm(`deploy the Stellar Asset Contract of ${config.fund.symbol}:${config.fundWallet}, fee up to ${fmt(BigInt(tx.fee))} XLM paid by cs-mainnet-uploader`);
  tx.sign(uploader);
  const out = await send(tx, 'deploy fund unit SAC');
  if (String(Sdk.scValToNative(out.res.returnValue)) !== id) throw new Error('deployed SAC address differs from the expected one');
  state.fundToken = id;
  save();
  logEvent('deploy_fund_unit_sac', out.hash);
}

/** Read only rehearsal: builds and simulates what can be simulated now, prints decoded calls and fees, sends nothing */
async function dryRun() {
  const m = mandate();
  const a = setLimitsArgs(m, mandateHash(m));
  console.log(`label: ${SLICE_LABEL}\nmandate hash ${a.mandateHashHex}: per tx ${fmt(BigInt(a.perTxCapUnits))}, period ${fmt(BigInt(a.periodCapUnits))} USDC every ${m.periodDays} days`);
  console.log(`fund unit asset ${config.fund.symbol}:${config.fundWallet} -> SAC ${fundUnitSac()}`);
  // A simulation needs an existing source account; the owner exists, so her calls are simulated with her as source
  const src = await retry('getAccount', () => server.getAccount(config.owner));
  const sim = async (label: string, op: any) => {
    const tx = new Sdk.TransactionBuilder(src, { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE }).addOperation(op).setTimeout(60).build();
    const r = await retry('simulate', () => server.simulateTransaction(tx));
    console.log(`  ${label}: ${Sdk.rpc.Api.isSimulationError(r) ? 'simulation error ' + String(r.error).slice(0, 160) : 'resource fee ' + fmt(BigInt(r.minResourceFee)) + ' XLM'}`);
  };
  await sim('upload mandate_wallet Wasm', Sdk.Operation.uploadContractWasm({ wasm: fs.readFileSync(WASM.mandate_wallet) }));
  await sim('deploy fund unit SAC', Sdk.Operation.createStellarAssetContract({ asset: fundUnitAsset() }));
  console.log('  wallet deploy, deposit, allow_fund and subscribe need the uploaded Wasm and the wallet: simulated at their step');
  const amount = toUnits(config.purchaseUsdc);
  const total = toUnits(config.depositUsdc);
  console.log(`USDC: deposit ${fmt(total)}, purchase ${fmt(amount)}, fund cap ${config.fundCapUsdc} (limit 5): ${total <= MAX_USDC_UNITS && amount <= total ? 'OK' : 'ABOVE LIMIT'}`);
  console.log('Nothing was signed or sent.');
}

async function build(name: string) {
  let source: string;
  let op: any;
  const m = mandate();
  switch (name) {
    case 'wallet_deploy': {
      const h = state.wasm.mandate_wallet?.hash;
      if (!h) throw new Error('upload mandate_wallet first');
      const a = setLimitsArgs(m, mandateHash(m));
      source = config.owner;
      op = Sdk.Operation.createCustomContract({
        address: Sdk.Address.fromString(source),
        wasmHash: Buffer.from(h, 'hex'),
        constructorArgs: [
          addr(source), addr(agent.publicKey()), addr(usdcSac()),
          i128(BigInt(a.perTxCapUnits)), i128(BigInt(a.periodCapUnits)),
          Sdk.nativeToScVal(BigInt(a.periodSecs), { type: 'u64' }), Sdk.xdr.ScVal.scvBytes(Buffer.from(a.mandateHashHex, 'hex')),
        ],
        salt: crypto.randomBytes(32),
      });
      break;
    }
    case 'deposit': {
      if (!state.wallet) throw new Error('deploy the wallet first');
      const units = toUnits(config.depositUsdc);
      if (units <= 0n || units > MAX_USDC_UNITS) throw new Error('deposit must be > 0 and at most 5 USDC');
      source = config.owner;
      op = new Sdk.Contract(usdcSac()).call('transfer', addr(source), addr(state.wallet), i128(units));
      break;
    }
    case 'allow_fund': {
      if (!state.wallet || !state.fundToken) throw new Error('deploy the wallet and the fund token first');
      const cap = toUnits(config.fundCapUsdc);
      if (cap <= 0n || cap > MAX_USDC_UNITS) throw new Error('fund cap must be > 0 and at most 5 USDC');
      source = config.owner;
      op = new Sdk.Contract(state.wallet).call('allow_fund', addr(config.fundWallet), addr(state.fundToken), i128(cap));
      break;
    }
    default:
      throw new Error('build wallet_deploy | deposit | allow_fund');
  }
  const tx = await prepare(source, op);
  const xdr = tx.toXDR();
  const file = path.join(OUT, `${name}.unsigned.xdr`);
  fs.writeFileSync(file, xdr + '\n');
  state.pending[name] = { xdr, hash: tx.hash().toString('hex'), signer: source, kind: name };
  save();
  const expires = new Date(Number(tx.timeBounds.maxTime) * 1000);
  console.log(`  ${describe(tx)}\n\nUnsigned XDR: ${path.relative(ROOT, file)}\nEXPIRES at ${expires.toISOString()} (UTC) = ${expires.toLocaleString('pt-BR', { timeZone: 'Europe/Berlin' })} CEST; after that run build again.\nSign it with ${source} in Freighter on the local page (scripts/mainnet/run.sh sign-page, default) or in Stellar Lab (Mainnet, Sign transaction),\nthen run: scripts/mainnet/run.sh submit ${name} scripts/mainnet/out/${name}.signed.xdr`);
}

/**
 * Checks a signed envelope against the pending one: not expired, same hash (or, if a tool re-simulated it, the
 * same transaction field by field with fees not higher), and a valid signature of the expected account for the
 * mainnet hash. Throws with the reason; returns the parsed transaction.
 */
function checkSigned(name: string, signedXdr: string) {
  const p = state.pending[name];
  if (!p) throw new Error(`nothing pending named ${name}`);
  const built = Sdk.TransactionBuilder.fromXDR(p.xdr, PASSPHRASE);
  const maxTime = Number(built.timeBounds?.maxTime ?? 0);
  if (maxTime && Date.now() / 1000 > maxTime - 20) {
    throw new Error(`the ${name} transaction expired at ${new Date(maxTime * 1000).toISOString()}: rebuild it (run.sh build ${name}) and sign again`);
  }
  let tx: any;
  try {
    tx = Sdk.TransactionBuilder.fromXDR(signedXdr, PASSPHRASE);
  } catch {
    throw new Error('not a transaction envelope');
  }
  if (tx instanceof Sdk.FeeBumpTransaction) throw new Error('fee bump envelopes are not accepted');
  checkSendWindow(tx);
  checkFeeLimits(tx);
  const hash = tx.hash().toString('hex');
  if (hash !== p.hash) {
    const cmp = compareSigned(built, tx);
    console.log(`\nThe signed hash (${hash}) differs from the built one (${p.hash}). Field by field:\n${formatChecks(cmp.checks)}`);
    if (!cmp.equal) {
      const bad = cmp.checks.filter((c) => !c.ok).map((c) => c.field).join(', ');
      throw new Error(`the signed transaction is not the one that was built (differs in: ${bad}): not sent`);
    }
    console.log('Same transaction (only resources and lower fees differ): accepted for the confirmation below.');
  }
  const signer = Sdk.Keypair.fromPublicKey(p.signer);
  if (!tx.signatures.some((sg: any) => signer.verify(tx.hash(), sg.signature()))) {
    throw new Error(`no valid ${p.signer} signature for the mainnet hash (wrong network or wrong account): not sent`);
  }
  return tx;
}

/**
 * Local signing page (no re-simulation): serves sign.html on 127.0.0.1, the decoded call of each pending
 * transaction, and receives the signed XDR, which is checked (checkSigned) and saved to out/<name>.signed.xdr.
 * It never submits: the submit step (with SEND MAINNET) stays in the terminal.
 */
async function signPage() {
  const port = Number(process.env.SIGN_PAGE_PORT || 8787);
  const okName = (n: string) => /^[a-z_]{1,40}$/.test(n) && !!state.pending[n];
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const send = (code: number, body: string, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    try {
      if (req.method === 'GET' && url.pathname === '/') return send(200, fs.readFileSync(path.join(here, 'sign.html'), 'utf8'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/pending') {
        return send(200, JSON.stringify(Object.entries(state.pending).map(([n, p]) => {
          const tx = Sdk.TransactionBuilder.fromXDR(p.xdr, PASSPHRASE);
          return { name: n, signer: p.signer, hash: p.hash, xdr: p.xdr, expires: new Date(Number(tx.timeBounds.maxTime) * 1000).toISOString(), decoded: describe(tx), network: NETWORK_LABEL, networkPassphrase: PASSPHRASE };
        })));
      }
      const m = /^\/signed\/([a-z_]+)$/.exec(url.pathname);
      if (req.method === 'POST' && m) {
        if (!okName(m[1])) return send(404, JSON.stringify({ error: 'nothing pending with this name' }));
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 200_000) req.destroy(); });
        req.on('end', () => {
          try {
            const xdr = String(JSON.parse(body).signedXdr ?? '').trim();
            const tx = checkSigned(m[1], xdr);
            const file = path.join(OUT, `${m[1]}.signed.xdr`);
            fs.writeFileSync(file, xdr + '\n');
            send(200, JSON.stringify({ saved: path.relative(ROOT, file), hash: tx.hash().toString('hex'), next: `scripts/mainnet/run.sh submit ${m[1]} ${path.relative(ROOT, file)}` }));
          } catch (e) {
            send(400, JSON.stringify({ error: (e as Error).message }));
          }
        });
        return;
      }
      send(404, JSON.stringify({ error: 'not found' }));
    } catch (e) {
      send(500, JSON.stringify({ error: (e as Error).message }));
    }
  });
  await new Promise<void>((r) => srv.listen(port, '127.0.0.1', () => r()));
  console.log(`Signing page: http://127.0.0.1:${port}/  (Ctrl+C to stop). It signs with Freighter and saves the signed XDR; it never submits.`);
}

async function submit(name: string, file: string) {
  const p = state.pending[name];
  if (!p) throw new Error(`nothing pending named ${name}`);
  const tx = checkSigned(name, fs.readFileSync(file, 'utf8').trim());
  console.log(`  ${describe(tx)}`);
  await confirm(`${name} signed by ${p.signer}${tx.hash().toString('hex') !== p.hash ? ' (re-simulated by the signing tool; differences listed above)' : ''}`);
  const out = await send(tx, name);
  delete state.pending[name];
  const m = mandate();
  if (name === 'wallet_deploy') {
    const id = String(Sdk.scValToNative(out.res.returnValue));
    const [owner, ag, mh] = [await read(id, 'owner'), await read(id, 'agent'), Buffer.from(await read(id, 'mandate_hash')).toString('hex')];
    if (owner !== config.owner || ag !== agent.publicKey() || mh !== mandateHash(m)) throw new Error('deployed wallet does not match');
    state.wallet = id;
    logEvent('deploy_wallet', out.hash, '0', mh);
  } else if (name === 'deposit') {
    logEvent('deposit', out.hash, toUnits(config.depositUsdc).toString());
  } else if (name === 'allow_fund') {
    const entry = await read(state.wallet!, 'fund', [addr(config.fundWallet)]);
    if (!entry) throw new Error('fund not in the allowlist after allow_fund');
    logEvent('allow_fund', out.hash, toUnits(config.fundCapUsdc).toString());
  }
  save();
}

async function propose() {
  if (!state.wallet || !state.fundToken) throw new Error('wallet and fund token first');
  const m = mandate();
  const amountUnits = toUnits(config.purchaseUsdc);
  const deposited = toUnits(config.depositUsdc);
  if (amountUnits > deposited || amountUnits > MAX_USDC_UNITS) throw new Error('purchase above the deposit or 5 USDC');
  const onChainMandateHash = Buffer.from(await read(state.wallet, 'mandate_hash')).toString('hex');
  const spent = BigInt(await read(state.wallet, 'spent_in_period'));
  const fundEntry = await read(state.wallet, 'fund', [addr(config.fundWallet)]);
  const ctx: PolicyContext = {
    proposal: { fundId: config.fund.id, amountUnits, amountSource: 'investor_message', origin: 'chat', toolCallId: 'mainnet-slice-1', extraKeys: [] },
    declaredResidences: m.residences,
    mandate: m,
    approvedHash: mandateHash(m),
    onChainMandateHash,
    fund: {
      id: config.fund.id, status: 'APPROVED', tokenContractId: state.fundToken, fundWalletPublicKey: config.fundWallet,
      investorProfile: config.fund.investorProfile, riskLevel: config.fund.riskLevel, sector: config.fund.sector,
      liquidityType: config.fund.liquidityType, lockupDays: config.fund.lockupDays,
    },
    badgeThresholdCents: null,
    spentInPeriodUnits: spent,
    positions: [],
    fundAllowedOnChain: !!fundEntry,
  };
  const d = evaluate(ctx);
  const row = append({ kind: 'decision', origin: 'chat', fundId: config.fund.id, amountUnits: amountUnits.toString(), rule: d.rule, outcome: d.outcome, mandateHash: mandateHash(m), toolCallId: 'mainnet-slice-1' });
  console.log(`decision row ${row.seq}: ${d.outcome} (${d.rule}) hash ${row.hash}\n  ${d.explanation}`);
  if (d.outcome === 'APPROVED') { state.decision = { seq: row.seq, hash: row.hash, amountUnits: amountUnits.toString() }; save(); }
}

async function subscribe() {
  const dcs = state.decision;
  if (!dcs || !state.wallet) throw new Error('no APPROVED decision: run propose');
  if (state.txs.some((t) => t.step === 'subscribe' && t.status === 'SUCCESS')) throw new Error('the slice purchase was already made');
  const tx = await prepare(agent.publicKey(), new Sdk.Contract(state.wallet).call('subscribe', Sdk.xdr.ScVal.scvBytes(Buffer.from(dcs.hash, 'hex')), addr(config.fundWallet), i128(BigInt(dcs.amountUnits))), 300);
  // Same check the API's agent signer runs before signing (apps/api/src/agentSigner/verifyXdr.ts)
  const check = checkSubscribeXdr(tx.toXDR(), { source: agent.publicKey(), walletContractId: state.wallet, decisionHashHex: dcs.hash, fundWallet: config.fundWallet, amountUnits: BigInt(dcs.amountUnits) }, PASSPHRASE);
  if (check.ok === false) throw new Error(`signer check refused (${check.field}): ${check.reason}`);
  console.log(`  ${describe(tx)}`);
  await confirm(`subscribe ${fmt(BigInt(dcs.amountUnits))} USDC to ${config.fundWallet}, decision row ${dcs.seq}, signed by cs-mainnet-agent`);
  tx.sign(agent);
  const out = await send(tx, 'subscribe');
  logEvent('subscribe', out.hash, dcs.amountUnits, mandateHash(mandate()));
}

async function verify() {
  let prev = ZERO_HASH;
  for (const r of logRows()) {
    const payload = JSON.parse(r.payload);
    if (r.prevHash !== prev || chainHash(prev, payload) !== r.hash || canonical(payload) !== r.payload) throw new Error(`log row ${r.seq} does not verify`);
    prev = r.hash;
  }
  console.log(`slice log verifies (${logRows().length} rows, head ${prev})\nlabel: ${SLICE_LABEL}`);
  const sub = state.txs.find((t) => t.step === 'subscribe' && t.status === 'SUCCESS');
  if (sub && state.decision) {
    const res = await server.getTransaction(sub.hash);
    const call = new Sdk.Transaction(res.envelopeXdr, PASSPHRASE).operations[0].func.invokeContract();
    const onchain = call.args()[0].bytes().toString('hex');
    console.log(`decision on-chain ${onchain} ${onchain === state.decision.hash ? '= log row ' + state.decision.seq : 'DIFFERS'}`);
  }
  for (const t of state.txs) console.log(`  ${t.step} | ${t.status} | ${t.hash} | log ${t.logSeq ?? 'missing'} | ${t.link}`);
}

const [step, a1, a2] = process.argv.slice(2);
const steps: Record<string, () => Promise<void>> = {
  status, propose, subscribe, verify,
  'dry-run': dryRun,
  'sign-page': signPage,
  deploy: () => deploySac(a1),
  upload: () => upload(a1 as keyof typeof WASM),
  build: () => build(a1),
  submit: () => submit(a1, a2),
};
if (!steps[step]) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 19).join('\n'));
} else {
  steps[step]().catch((e) => { console.error(`\nSTOPPED: ${(e as Error).message}`); process.exitCode = 1; });
}
