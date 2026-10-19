// Stellar testnet helpers for the suites. Secrets come only from environment variables exported by run.sh
// (disposable Stellar CLI identities) or tests/.env; nothing secret is printed or written to disk.
import * as Sdk from '@stellar/stellar-sdk';

export { Sdk };
export const xdr = Sdk.xdr;
export const RPC_URL = process.env.SUITES_RPC_URL || 'https://soroban-testnet.stellar.org';
export const PASSPHRASE = Sdk.Networks.TESTNET;
export const NETWORK_LABEL = 'Stellar testnet';
export const server = new Sdk.rpc.Server(RPC_URL);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const expert = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

/** Test USDC used by the API on testnet (Blend testnet faucet asset, default PAYMENT_ASSET of apps/api) */
export const TEST_USDC = new Sdk.Asset('USDC', 'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56');
export const BLEND_FAUCET_URL = 'https://ewqw4hx7oa.execute-api.us-east-1.amazonaws.com/getAssets';

export const toAddr = (a: string) => Sdk.nativeToScVal(a, { type: 'address' });
export const toI128 = (v: bigint) => Sdk.nativeToScVal(v, { type: 'i128' });
export const toU64 = (v: bigint) => Sdk.nativeToScVal(v, { type: 'u64' });
export const toBytes32 = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex, 'hex'));
export const usdc = (v: string) => {
  const [w, f = ''] = v.split('.');
  return BigInt(w) * 10_000_000n + BigInt(f.padEnd(7, '0'));
};
export const fmtUsdc = (u: bigint) => `${u / 10_000_000n}.${(u % 10_000_000n).toString().padStart(7, '0')}`;

const TRANSIENT = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket|network|timeout|50[234]|fetch failed|other side closed/i;
export async function retry<T>(label: string, fn: () => Promise<T>, attempts = 7): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (!TRANSIENT.test(msg) || i >= attempts) throw e;
      console.log(`    [retry ${i}] ${label}: ${msg.slice(0, 120)}`);
      await sleep(2000 * i);
    }
  }
}

export async function loadAccount(pub: string) {
  for (let i = 1; ; i++) {
    try {
      return await retry('getAccount', () => server.getAccount(pub));
    } catch (e) {
      if (i >= 6 || !/not found/i.test((e as Error).message)) throw e;
      await sleep(2000);
    }
  }
}

export async function accountExists(pub: string) {
  try {
    await retry('getAccount', () => server.getAccount(pub));
    return true;
  } catch {
    return false;
  }
}

export async function friendbot(pub: string) {
  return retry('friendbot', async () => {
    const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(pub)}`);
    if (!res.ok && res.status >= 500) throw new Error(`friendbot ${res.status}`);
    return res.ok;
  });
}

export interface Submitted {
  hash: string;
  status: 'SUCCESS' | 'FAILED';
  res: any;
  ledger?: number;
  createdAt?: string;
}

/** sendTransaction, then poll getTransaction until the ledger answers. Throws if the envelope never reaches a ledger. */
export async function submit(tx: any, label: string): Promise<Submitted> {
  const hash = tx.hash().toString('hex');
  for (let i = 1; ; i++) {
    const send: any = await retry(`send ${label}`, () => server.sendTransaction(tx));
    if (send.status === 'PENDING' || send.status === 'DUPLICATE') break;
    if (send.status === 'TRY_AGAIN_LATER' && i < 10) {
      await sleep(3000);
      continue;
    }
    const detail = send.errorResult ? send.errorResult.result().switch().name : '';
    const err: any = new Error(`${label}: sendTransaction ${send.status} ${detail} (not in any ledger, no hash to show)`);
    err.send = send;
    throw err;
  }
  let res: any;
  for (let i = 0; i < 90; i++) {
    res = await retry(`get ${label}`, () => server.getTransaction(hash));
    if (res.status !== 'NOT_FOUND') break;
    await sleep(2000);
  }
  if (!res || res.status === 'NOT_FOUND') throw new Error(`${label}: still NOT_FOUND after polling (${hash})`);
  const createdAt = res.createdAt ? new Date(Number(res.createdAt) * 1000).toISOString() : undefined;
  return { hash, status: res.status, res, ledger: res.ledger, createdAt };
}

export async function simulateCall(source: string, contractId: string, method: string, args: any[]) {
  const account = await loadAccount(source);
  const tx = new Sdk.TransactionBuilder(account, { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Sdk.Contract(contractId).call(method, ...args))
    .setTimeout(300)
    .build();
  const sim: any = await retry(`simulate ${method}`, () => server.simulateTransaction(tx));
  return { tx, sim };
}

/** Builds, simulates (prepareTransaction), signs and submits one host function call; throws unless SUCCESS */
export async function invoke(kp: Sdk.Keypair, contractId: string, method: string, args: any[], label?: string) {
  const { tx } = await simulateCall(kp.publicKey(), contractId, method, args);
  const prepared: any = await retry(`prepare ${method}`, () => server.prepareTransaction(tx));
  prepared.sign(kp);
  const out = await submit(prepared, label ?? method);
  if (out.status !== 'SUCCESS') throw new Error(`${label ?? method} FAILED on-chain: ${out.hash}`);
  return out;
}

export async function sendOp(kp: Sdk.Keypair, op: any, label: string, extraSigners: Sdk.Keypair[] = []) {
  const account = await loadAccount(kp.publicKey());
  let tx: any = new Sdk.TransactionBuilder(account, { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setTimeout(300)
    .build();
  if (tx.operations[0].type === 'invokeHostFunction') tx = await retry(`prepare ${label}`, () => server.prepareTransaction(tx));
  tx.sign(kp, ...extraSigners);
  const out = await submit(tx, label);
  if (out.status !== 'SUCCESS') throw new Error(`${label} FAILED on-chain: ${out.hash}`);
  return out;
}

/** Read-only call through simulation */
export async function read<T = any>(contractId: string, method: string, args: any[] = []): Promise<T> {
  const source = new Sdk.Account(Sdk.Keypair.random().publicKey(), '0');
  const tx = new Sdk.TransactionBuilder(source, { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Sdk.Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim: any = await retry(`read ${method}`, () => server.simulateTransaction(tx));
  if (Sdk.rpc.Api.isSimulationError(sim) || !sim.result) throw new Error(`read ${method} failed: ${String(sim.error).split('\n')[0]}`);
  return Sdk.scValToNative(sim.result.retval) as T;
}

export async function deployFromHash(kp: Sdk.Keypair, wasmHashHex: string, ctorArgs: any[], label: string) {
  const op = Sdk.Operation.createCustomContract({
    address: Sdk.Address.fromString(kp.publicKey()),
    wasmHash: Buffer.from(wasmHashHex, 'hex'),
    constructorArgs: ctorArgs,
    salt: Sdk.hash(Buffer.from(`${label}:${Date.now()}:${Math.random()}`)),
  });
  const out = await sendOp(kp, op, label);
  const id = Sdk.scValToNative(out.res.returnValue) as string;
  return { ...out, id };
}

export async function usdcBalance(address: string): Promise<bigint> {
  try {
    return BigInt(await read(TEST_USDC.contractId(PASSPHRASE), 'balance', [toAddr(address)]));
  } catch {
    return 0n;
  }
}

export async function hasTrustline(pub: string, asset: Sdk.Asset): Promise<boolean> {
  const res = await retry('horizon account', () => fetch(`https://horizon-testnet.stellar.org/accounts/${pub}`));
  if (!res.ok) return false;
  const body: any = await res.json();
  return (body.balances ?? []).some((b: any) => b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer());
}

/**
 * Test USDC from the Blend testnet faucet, with the same safety check as POST /api/stellar/test-usdc: the
 * transaction must come from the asset issuer and the account may only appear in changeTrust operations.
 * Faucet transactions are setup, never product evidence.
 */
export async function faucetUsdc(kp: Sdk.Keypair) {
  const pub = kp.publicKey();
  const res = await retry('faucet', () => fetch(`${BLEND_FAUCET_URL}?userId=${encodeURIComponent(pub)}`));
  if (!res.ok) throw new Error(`Blend testnet faucet answered ${res.status}`);
  const tx: any = new Sdk.Transaction((await res.text()).trim(), PASSPHRASE);
  const issuer = TEST_USDC.getIssuer();
  const safe =
    tx.source === issuer &&
    tx.operations.every((op: any) =>
      op.source === pub ? op.type === 'changeTrust' : (op.source ?? tx.source) === issuer && op.type === 'payment' && op.destination === pub
    );
  if (!safe) throw new Error('Faucet returned an unexpected transaction; refused');
  tx.sign(kp);
  const out = await submit(tx, 'faucet');
  if (out.status !== 'SUCCESS') throw new Error('faucet transaction failed');
  return out.hash;
}

export async function ensureTrustline(kp: Sdk.Keypair, asset: Sdk.Asset) {
  if (await hasTrustline(kp.publicKey(), asset)) return null;
  const out = await sendOp(kp, Sdk.Operation.changeTrust({ asset }), 'changeTrust');
  return out.hash;
}

// ------------------------------------------------------------------------------------------------------------
// Failed transactions (technique of spike S2, variant B): the footprint and resources of an equivalent call that
// simulates fine, plus the ledger key the refused path reads, with the auth built for the refused arguments.
// ------------------------------------------------------------------------------------------------------------

export function contractDataKey(contractId: string, key: any) {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Sdk.Address.fromString(contractId).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
}
/** Persistent key DataKey::Fund(address) of contracts/mandate-wallet (contracttype enum = vec[symbol, value]) */
export const walletFundKey = (wallet: string, fundWallet: string) =>
  contractDataKey(wallet, xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Fund'), Sdk.Address.fromString(fundWallet).toScVal()]));
/** Persistent key DataKey::Decision(BytesN<32>) of contracts/mandate-wallet */
export const walletDecisionKey = (wallet: string, decisionHex: string) =>
  contractDataKey(wallet, xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Decision'), toBytes32(decisionHex)]));

function sourceAuth(contractId: string, method: string, args: any[]) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: Sdk.Address.fromString(contractId).toScAddress(), functionName: method, args })
      ),
      subInvocations: [],
    }),
  });
}

const keyId = (k: any) => k.toXDR('base64');

/**
 * Submits `method(refusedArgs)` signed only by `kp` (source account auth), using the soroban data of the successful
 * simulation of `method(equivalentArgs)` plus `extraReadOnly` keys, with resources and fee doubled.
 */
export async function submitRefusedCall(opts: {
  kp: Sdk.Keypair;
  contractId: string;
  method: string;
  equivalentArgs: any[];
  refusedArgs: any[];
  extraReadOnly?: any[];
  label: string;
}) {
  const { kp, contractId, method } = opts;
  const { tx: eqTx } = await simulateCall(kp.publicKey(), contractId, method, opts.equivalentArgs);
  const preparedEq: any = await retry('prepare equivalent', () => server.prepareTransaction(eqTx));
  const data = preparedEq.toEnvelope().v1().tx().ext().sorobanData();
  const fp = data.resources().footprint();
  const ro = [...fp.readOnly()];
  const rw = [...fp.readWrite()];
  const present = new Set([...ro, ...rw].map(keyId));
  for (const k of opts.extraReadOnly ?? []) if (!present.has(keyId(k))) ro.push(k);
  const res = data.resources();
  const resourceFee = BigInt(data.resourceFee().toString()) * 2n;
  const sorobanData = new Sdk.SorobanDataBuilder(data)
    .setFootprint(ro, rw)
    .setResources(Math.ceil(res.instructions() * 1.5), res.diskReadBytes() + 2000, res.writeBytes())
    .setResourceFee(resourceFee)
    .build();
  const op = Sdk.Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({ contractAddress: Sdk.Address.fromString(contractId).toScAddress(), functionName: method, args: opts.refusedArgs })
    ),
    auth: [sourceAuth(contractId, method, opts.refusedArgs)],
  });
  const account = await loadAccount(kp.publicKey());
  const fee = (BigInt(Sdk.BASE_FEE) + resourceFee).toString();
  const tx = new Sdk.TransactionBuilder(account, { fee, networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setSorobanData(sorobanData)
    .setTimeout(300)
    .build();
  tx.sign(kp);
  return submit(tx, opts.label);
}

/**
 * Owner-only call sent by the agent key alone. The simulation runs in recording mode (it does not check signatures,
 * so it passes and records an authorization entry for the owner address). Then:
 *   mode "forged": the agent key signs the owner's authorization entry (wrong key for that address);
 *   mode "none":   the owner's authorization entry is dropped (no owner authorization at all).
 * Resources get headroom for the signature check, and the envelope is submitted to get a ledger answer.
 */
export async function submitAsAgent(opts: { kp: Sdk.Keypair; contractId: string; method: string; args: any[]; mode: 'forged' | 'none'; label: string }) {
  const { tx, sim } = await simulateCall(opts.kp.publicKey(), opts.contractId, opts.method, opts.args);
  const simulation = Sdk.rpc.Api.isSimulationError(sim)
    ? { ok: false, detail: String(sim.error).split('\n')[0] }
    : { ok: true, detail: 'simulation passed (recording mode does not verify signatures); authorization recorded for the owner address' };
  if (!simulation.ok) return { simulation, submitted: null as Submitted | null };
  const prepared: any = Sdk.rpc.assembleTransaction(tx, sim).build();
  const data = prepared.toEnvelope().v1().tx().ext().sorobanData();
  const latest = await retry('latest ledger', () => server.getLatestLedger());
  const origOp = prepared.operations[0];
  const auth: any[] = [];
  for (const entry of origOp.auth ?? []) {
    if (entry.credentials().switch().name === 'sorobanCredentialsSourceAccount') {
      auth.push(entry);
      continue;
    }
    if (opts.mode === 'forged') auth.push(await Sdk.authorizeEntry(entry, opts.kp, latest.sequence + 100, PASSPHRASE));
  }
  const res = data.resources();
  const resourceFee = BigInt(data.resourceFee().toString()) * 2n;
  const sorobanData = new Sdk.SorobanDataBuilder(data)
    .setResources(Math.ceil(res.instructions() * 2) + 5_000_000, res.diskReadBytes() + 2000, res.writeBytes() + 1000)
    .setResourceFee(resourceFee)
    .build();
  const op = Sdk.Operation.invokeHostFunction({ func: origOp.func, auth });
  const account = await loadAccount(opts.kp.publicKey());
  const fee = (BigInt(Sdk.BASE_FEE) + resourceFee).toString();
  const signed = new Sdk.TransactionBuilder(account, { fee, networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setSorobanData(sorobanData)
    .setTimeout(300)
    .build();
  signed.sign(opts.kp);
  return { simulation, submitted: await submit(signed, opts.label) };
}

// ------------------------------------------------------------------------------------------------------------
// Reading a FAILED transaction: consensus part (txFAILED, op result, fee) and diagnostic part (RPC events)
// ------------------------------------------------------------------------------------------------------------

function errText(v: any): string | null {
  if (v.switch().name !== 'scvError') return null;
  const e = v.error();
  const kind = e.switch().name;
  if (kind === 'sceContract') return `Error(Contract, #${e.contractCode()})`;
  const t = kind.replace(/^sce/, '');
  let code = '';
  try {
    code = e.code().name.replace(/^scec/, '');
  } catch {
    /* no code */
  }
  return `Error(${t}, ${code})`;
}

export interface FailureReading {
  consensus: string; // tx result + op result + fee charged
  feeChargedStroops: string | null;
  diagnosticError: string | null; // first error found in diagnostic events
  diagnosticContract: string | null; // contract that emitted it, when known
  contractCode: number | null;
  /** error of the host_fn_failed event: what the host function finally failed with */
  finalError: string | null;
  /** first text message attached to an error event (for auth failures, the host's reason) */
  hostMessage: string | null;
  diagnosticEventsCount: number;
}

export function readFailure(res: any): FailureReading {
  let consensus = '';
  let fee: string | null = null;
  try {
    const r = res.resultXdr;
    fee = r.feeCharged().toString();
    const inner = r.result();
    consensus = inner.switch().name;
    const op = inner.results?.()[0];
    if (op) consensus += ` / ${op.tr().invokeHostFunctionResult().switch().name}`;
  } catch {
    /* keep what we have */
  }
  let diag: any[] = res.diagnosticEventsXdr ?? [];
  if (!diag.length) {
    try {
      const meta = res.resultMetaXdr;
      if (meta.switch() === 4) diag = meta.v4().diagnosticEvents() ?? [];
      else if (meta.switch() === 3) diag = meta.v3().sorobanMeta()?.diagnosticEvents() ?? [];
    } catch {
      /* none */
    }
  }
  let found: { text: string; contract: string | null; code: number | null } | null = null;
  const contractErrors: { text: string; contract: string | null; code: number | null }[] = [];
  let finalError: string | null = null;
  let hostMessage: string | null = null;
  for (const d of diag) {
    try {
      const ev = d.event();
      const cid = ev.contractId();
      const contract = cid ? Sdk.StrKey.encodeContract(cid as any) : null;
      const body = ev.body().v0();
      const topics = body.topics();
      const isFinal = topics.some((t: any) => t.switch().name === 'scvSymbol' && t.sym().toString() === 'host_fn_failed');
      const isError = topics.some((t: any) => t.switch().name === 'scvError');
      if (isFinal) finalError = topics.map(errText).find(Boolean) ?? finalError;
      if (isError && !hostMessage) {
        const data = body.data();
        const first = data.switch().name === 'scvVec' ? data.vec()?.[0] : data;
        if (first?.switch().name === 'scvString') hostMessage = first.str().toString();
      }
      for (const v of [...topics, body.data()]) {
        const t = errText(v);
        if (!t) continue;
        const m = /#(\d+)/.exec(t);
        const item = { text: t, contract, code: m ? Number(m[1]) : null };
        if (m) contractErrors.push(item);
        if (!found) found = item;
      }
    } catch {
      /* skip */
    }
  }
  const pick = contractErrors.find((c) => c.contract) ?? contractErrors[0] ?? found;
  return {
    consensus,
    feeChargedStroops: fee,
    diagnosticError: pick?.text ?? null,
    diagnosticContract: pick?.contract ?? null,
    contractCode: pick?.code ?? null,
    finalError,
    hostMessage,
    diagnosticEventsCount: diag.length,
  };
}

export function simulationError(sim: any): string | null {
  if (!Sdk.rpc.Api.isSimulationError(sim)) return null;
  const s = String(sim.error);
  const m = /Error\([A-Za-z]+, [^)]+\)/.exec(s);
  return m ? m[0] : s.split('\n')[0].slice(0, 200);
}
