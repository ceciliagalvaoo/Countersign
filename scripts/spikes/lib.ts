// Shared helpers for the testnet spikes (S1, S2). Uses the @stellar/stellar-sdk installed in apps/api.
// Secrets come only from environment variables (exported by run.sh from disposable Stellar CLI identities);
// nothing secret is written to disk or printed.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');
const requireFromApi = createRequire(path.join(ROOT, 'apps/api/package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Sdk: any = requireFromApi('@stellar/stellar-sdk');

export const RPC_URL = process.env.SPIKE_RPC_URL ?? 'https://soroban-testnet.stellar.org';
export const HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const PASSPHRASE = Sdk.Networks.TESTNET;
export const server = new Sdk.rpc.Server(RPC_URL);
export const horizon = new Sdk.Horizon.Server(HORIZON_URL);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const expert = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
export const expertContract = (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`;

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export const toAddr = (a: string) => Sdk.nativeToScVal(a, { type: 'address' });
export const toI128 = (v: bigint) => Sdk.nativeToScVal(v, { type: 'i128' });
export const toStr = (v: string) => Sdk.nativeToScVal(v, { type: 'string' });
export const toSym = (v: string) => Sdk.nativeToScVal(v, { type: 'symbol' });
export const toU64 = (v: bigint) => Sdk.nativeToScVal(v, { type: 'u64' });

export interface TxRecord {
  step: string;
  hash: string;
  status: string;
  link: string;
  note?: string;
}
export const records: TxRecord[] = [];

async function retry<T>(label: string, fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      const transient = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|timeout|503|502|504|fetch failed/i.test(msg);
      if (!transient || i >= attempts) throw e;
      console.log(`  [retry ${i}] ${label}: ${msg}`);
      await sleep(2000 * i);
    }
  }
}

export async function loadAccount(pub: string) {
  return retry('getAccount', () => server.getAccount(pub));
}

/**
 * Sends a signed transaction and polls until SUCCESS or FAILED.
 * Retries TRY_AGAIN_LATER and network errors; a DUPLICATE answer means it is already in flight, so it polls.
 */
export async function submit(tx: any, step: string, note?: string) {
  const hash = tx.hash().toString('hex');
  for (let i = 1; ; i++) {
    const send = await retry('sendTransaction', () => server.sendTransaction(tx));
    if (send.status === 'PENDING' || send.status === 'DUPLICATE') break;
    if (send.status === 'TRY_AGAIN_LATER' && i < 8) {
      await sleep(3000);
      continue;
    }
    const detail = send.errorResult ? send.errorResult.result().switch().name : '';
    records.push({ step, hash, status: `REJECTED_${send.status} ${detail}`, link: '(not in ledger)', note });
    const err: any = new Error(`${step}: sendTransaction ${send.status} ${detail}`);
    err.send = send;
    throw err;
  }
  let res: any;
  for (let i = 0; i < 60; i++) {
    res = await retry('getTransaction', () => server.getTransaction(hash));
    if (res.status !== 'NOT_FOUND') break;
    await sleep(2000);
  }
  if (!res || res.status === 'NOT_FOUND') throw new Error(`${step}: still NOT_FOUND after polling (${hash})`);
  records.push({ step, hash, status: res.status, link: expert(hash), note });
  console.log(`  ${step}: ${res.status} ${hash}`);
  return { hash, res };
}

/** Builds, simulates (prepareTransaction), signs with `kp` and submits one host function call */
export async function invoke(kp: any, contractId: string, method: string, args: any[], step?: string) {
  const account = await loadAccount(kp.publicKey());
  const tx = new Sdk.TransactionBuilder(account, { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Sdk.Contract(contractId).call(method, ...args))
    .setTimeout(300)
    .build();
  const prepared = await retry('prepareTransaction', () => server.prepareTransaction(tx));
  prepared.sign(kp);
  const out = await submit(prepared, step ?? method);
  if (out.res.status !== 'SUCCESS') throw new Error(`${step ?? method} FAILED on-chain: ${out.hash}`);
  return out;
}

export async function sendOp(kp: any, op: any, step: string, signers: any[] = []) {
  const account = await loadAccount(kp.publicKey());
  let tx = new Sdk.TransactionBuilder(account, { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setTimeout(300)
    .build();
  if (tx.operations[0].type === 'invokeHostFunction') tx = await retry('prepareTransaction', () => server.prepareTransaction(tx));
  tx.sign(kp, ...signers);
  const out = await submit(tx, step);
  if (out.res.status !== 'SUCCESS') throw new Error(`${step} FAILED on-chain: ${out.hash}`);
  return out;
}

/** Read-only call through simulation */
export async function read(contractId: string, method: string, args: any[] = []) {
  const source = new Sdk.Account(Sdk.Keypair.random().publicKey(), '0');
  const tx = new Sdk.TransactionBuilder(source, { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Sdk.Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await retry('simulateTransaction', () => server.simulateTransaction(tx));
  if (Sdk.rpc.Api.isSimulationError(sim) || !sim.result) throw new Error(`read ${method} failed: ${sim.error}`);
  return Sdk.scValToNative(sim.result.retval);
}

/** Contract events emitted by a confirmed transaction, decoded to native values */
export function decodeEvents(res: any): { contract: string; topics: unknown[]; data: unknown }[] {
  const meta = res.resultMetaXdr;
  const v = meta.switch();
  let events: any[] = [];
  if (v === 4) {
    const m = meta.v4();
    events = m.operations().flatMap((o: any) => o.events());
  } else if (v === 3) {
    events = meta.v3().sorobanMeta()?.events() ?? [];
  }
  return events.map((e: any) => ({
    contract: e.contractId() ? Sdk.StrKey.encodeContract(e.contractId()) : '',
    topics: e.body().v0().topics().map((t: any) => Sdk.scValToNative(t)),
    data: Sdk.scValToNative(e.body().v0().data()),
  }));
}

export async function deployFromHash(kp: any, wasmHashHex: string, ctorArgs: any[], step: string) {
  const op = Sdk.Operation.createCustomContract({
    address: Sdk.Address.fromString(kp.publicKey()),
    wasmHash: Buffer.from(wasmHashHex, 'hex'),
    constructorArgs: ctorArgs,
    salt: Sdk.hash(Buffer.from(`${step}:${Date.now()}:${Math.random()}`)),
  });
  const out = await sendOp(kp, op, step);
  const id = Sdk.scValToNative(out.res.returnValue) as string;
  return { ...out, id };
}

export function printRecords(title: string) {
  console.log(`\n=== ${title}: transactions ===`);
  for (const r of records) console.log(`${r.step} | ${r.status} | ${r.hash} | ${r.link}${r.note ? ' | ' + r.note : ''}`);
}

export const jsonSafe = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : Buffer.isBuffer(x) ? x.toString('hex') : x));
