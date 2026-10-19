// Creates (once) the on-chain side of the Countersign demo catalog on testnet: for each fund of
// apps/api/scripts/countersign-demo-funds.json, a fund wallet (disposable Stellar CLI identity cs-demo-<symbol>,
// secret only in the CLI keystore) with a test USDC trustline, and a FundToken deployed from FUND_TOKEN_WASM_HASH
// whose admin is that fund wallet. Writes apps/api/scripts/countersign-demo-onchain.json.local (gitignored, public
// identifiers only). Idempotent: an existing token whose admin is the fund wallet is reused. Run through run.sh.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const requireFromApi = createRequire(path.join(ROOT, 'apps/api/package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Sdk: any = requireFromApi('@stellar/stellar-sdk');
const PASSPHRASE = Sdk.Networks.TESTNET;
const server = new Sdk.rpc.Server('https://soroban-testnet.stellar.org');
const horizon = new Sdk.Horizon.Server('https://horizon-testnet.stellar.org');
const USDC = { code: 'USDC', issuer: 'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56' };
const FAUCET = 'https://ewqw4hx7oa.execute-api.us-east-1.amazonaws.com/getAssets';
const OUT = path.join(ROOT, 'apps/api/scripts/countersign-demo-onchain.json.local');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retry<T>(label: string, fn: () => Promise<T>, attempts = 6): Promise<T> {
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

async function submit(tx: any, step: string) {
  const hash = tx.hash().toString('hex');
  for (let i = 1; ; i++) {
    const send = await retry('sendTransaction', () => server.sendTransaction(tx));
    if (send.status === 'PENDING' || send.status === 'DUPLICATE') break;
    if (send.status === 'TRY_AGAIN_LATER' && i < 10) { await sleep(2500); continue; }
    throw new Error(`${step}: sendTransaction ${send.status}`);
  }
  for (let i = 0; i < 90; i++) {
    const res = await retry('getTransaction', () => server.getTransaction(hash));
    if (res.status === 'SUCCESS') { console.log(`  ${step}: SUCCESS ${hash}`); return { hash, res }; }
    if (res.status === 'FAILED') throw new Error(`${step}: FAILED ${hash}`);
    await sleep(2000);
  }
  throw new Error(`${step}: not found after polling ${hash}`);
}

async function hasUsdc(pub: string) {
  const acc = await retry('loadAccount', () => horizon.loadAccount(pub));
  return acc.balances.some((b: any) => b.asset_code === USDC.code && b.asset_issuer === USDC.issuer);
}

/** Blend testnet faucet: trustline + test USDC. The returned transaction is inspected before signing */
async function faucet(kp: any, step: string) {
  const res = await retry('faucet', () => fetch(`${FAUCET}?userId=${encodeURIComponent(kp.publicKey())}`));
  if (!res.ok) throw new Error(`faucet HTTP ${res.status}`);
  const tx = new Sdk.Transaction((await res.text()).trim(), PASSPHRASE);
  const safe = tx.source === USDC.issuer && tx.operations.every((op: any) =>
    op.source === kp.publicKey() ? op.type === 'changeTrust' : (op.source ?? tx.source) === USDC.issuer && op.type === 'payment' && op.destination === kp.publicKey());
  if (!safe) throw new Error('faucet returned an unexpected transaction');
  tx.sign(kp);
  return submit(tx, step);
}

async function read(contractId: string, method: string) {
  const source = new Sdk.Account(Sdk.Keypair.random().publicKey(), '0');
  const tx = new Sdk.TransactionBuilder(source, { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Sdk.Contract(contractId).call(method)).setTimeout(30).build();
  const sim = await retry('simulate', () => server.simulateTransaction(tx));
  if (Sdk.rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return Sdk.scValToNative(sim.result.retval);
}

async function main() {
  const wasm = process.env.FUND_TOKEN_WASM_HASH;
  if (!wasm || !/^[0-9a-f]{64}$/i.test(wasm)) throw new Error('FUND_TOKEN_WASM_HASH missing');
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/api/scripts/countersign-demo-funds.json'), 'utf8'));
  const out: Record<string, any> = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  for (const f of catalog.funds) {
    const secret = process.env[`DEMO_${f.symbol}_SECRET`];
    if (!secret) throw new Error(`no identity for ${f.symbol}`);
    const kp = Sdk.Keypair.fromSecret(secret);
    console.log(`${f.symbol}: fund wallet ${kp.publicKey()}`);
    if (!(await hasUsdc(kp.publicKey()))) await faucet(kp, `${f.symbol} faucet (trustline + test USDC)`);
    const known = out[f.symbol];
    if (known?.fundWalletPublicKey === kp.publicKey() && known.tokenContractId) {
      try {
        if ((await read(known.tokenContractId, 'admin')) === kp.publicKey()) { console.log(`  token ${known.tokenContractId} (reused)`); continue; }
      } catch { /* redeploy below */ }
    }
    const account = await retry('getAccount', () => server.getAccount(kp.publicKey()));
    const op = Sdk.Operation.createCustomContract({
      address: Sdk.Address.fromString(kp.publicKey()),
      wasmHash: Buffer.from(wasm, 'hex'),
      constructorArgs: [
        Sdk.nativeToScVal(kp.publicKey(), { type: 'address' }),
        Sdk.nativeToScVal(f.name, { type: 'string' }),
        Sdk.nativeToScVal(f.symbol, { type: 'string' }),
        Sdk.nativeToScVal(BigInt(f.maxSupply) * 10_000_000n, { type: 'i128' }),
      ],
      salt: crypto.randomBytes(32),
    });
    let tx = new Sdk.TransactionBuilder(account, { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE }).addOperation(op).setTimeout(300).build();
    tx = await retry('prepare', () => server.prepareTransaction(tx));
    tx.sign(kp);
    const { res } = await submit(tx, `${f.symbol} FundToken deploy`);
    const tokenContractId = Sdk.scValToNative(res.returnValue);
    console.log(`  token ${tokenContractId}`);
    out[f.symbol] = { fundWalletPublicKey: kp.publicKey(), tokenContractId };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => { console.error(`setup-demo-funds FAILED: ${(e as Error).message}`); process.exit(1); });
