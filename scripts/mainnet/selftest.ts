// Offline-ish self test of the signed-vs-built comparison on TESTNET envelopes (nothing is sent anywhere).
// Usage: apps/api/node_modules/.bin/tsx scripts/mainnet/selftest.ts
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { compareSigned, formatChecks } from './txcompare.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const Sdk: any = createRequire(path.join(here, '../../apps/api/package.json'))('@stellar/stellar-sdk');
const PASS = Sdk.Networks.TESTNET;
const server = new Sdk.rpc.Server('https://soroban-testnet.stellar.org');
const owner = 'GAEZO27HHGDAXXCXQPIZ5SKWLSRCXV7OLSMUWZFFEC7YV2QLRWKPIEBO'; // cs-e2e-owner (public key only)
const usdc = new Sdk.Asset('USDC', 'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56').contractId(PASS);
const dest = 'CDZCBEGYZKYP3MH6SHF3FOE4HUTQFX52KPVAYH5YBCOWB2ECS5PHJSMK'; // an e2e mandate wallet
let failures = 0;
const expect = (name: string, got: boolean, want: boolean, detail = '') => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`[${ok ? 'OK' : 'FAIL'}] ${name}: equal=${got}${detail ? '\n' + detail : ''}`);
};
const call = (amount: bigint) => new Sdk.Contract(usdc).call('transfer', Sdk.nativeToScVal(owner, { type: 'address' }), Sdk.nativeToScVal(dest, { type: 'address' }), Sdk.nativeToScVal(amount, { type: 'i128' }));

(async () => {
const account = await server.getAccount(owner);
const seq = account.sequenceNumber();
const raw = new Sdk.TransactionBuilder(new Sdk.Account(owner, seq), { fee: Sdk.BASE_FEE, networkPassphrase: PASS }).addOperation(call(10_000_000n)).setTimeout(1800).build();
const built = await server.prepareTransaction(raw);

/** Rebuild with the same call and auth but other soroban data / fee / bounds (what a re-simulating tool produces) */
function variant(opts: { resourceDelta?: bigint; feeDelta?: bigint; seqOverride?: string; amount?: bigint; maxTimeDelta?: number }) {
  const sd = Sdk.xdr.SorobanTransactionData.fromXDR(built.toEnvelope().v1().tx().ext().sorobanData().toXDR());
  const fee = BigInt(sd.resourceFee().toString()) + (opts.resourceDelta ?? 0n);
  sd.resourceFee(Sdk.xdr.Int64.fromString(fee.toString()));
  sd.resources().instructions(sd.resources().instructions() + 1);
  const op = built.operations[0];
  const func = opts.amount ? call(opts.amount).body().invokeHostFunctionOp().hostFunction() : op.func;
  const acc = new Sdk.Account(owner, opts.seqOverride ?? seq);
  const inclusion = BigInt(built.fee) - BigInt(built.toEnvelope().v1().tx().ext().sorobanData().resourceFee().toString());
  const tx = new Sdk.TransactionBuilder(acc, { fee: (inclusion + (opts.feeDelta ?? 0n)).toString(), networkPassphrase: PASS, sorobanData: sd, timebounds: { minTime: built.timeBounds.minTime, maxTime: String(Number(built.timeBounds.maxTime) + (opts.maxTimeDelta ?? 0)) } })
    .addOperation(Sdk.Operation.invokeHostFunction({ func, auth: op.auth ?? [] }))
    .build();
  return tx;
}

const same = Sdk.TransactionBuilder.fromXDR(built.toXDR(), PASS);
expect('identical envelope', compareSigned(built, same).equal, true);
const resim = variant({ resourceDelta: -2n });
let r = compareSigned(built, resim);
expect('re-simulated (resource fee 2 stroops lower, other resources)', r.equal, true, formatChecks(r.checks));
r = compareSigned(built, variant({ amount: 20_000_000n }));
expect('amount changed', r.equal, false, formatChecks(r.checks.filter((c) => !c.ok)));
r = compareSigned(built, variant({ resourceDelta: 5n }));
expect('resource fee higher', r.equal, false, formatChecks(r.checks.filter((c) => !c.ok)));
r = compareSigned(built, variant({ feeDelta: 50n }));
expect('inclusion fee higher', r.equal, false, formatChecks(r.checks.filter((c) => !c.ok)));
r = compareSigned(built, variant({ seqOverride: (BigInt(seq) + 1n).toString() }));
expect('sequence changed', r.equal, false, formatChecks(r.checks.filter((c) => !c.ok)));
r = compareSigned(built, variant({ maxTimeDelta: 600 }));
expect('validity extended', r.equal, false, formatChecks(r.checks.filter((c) => !c.ok)));
console.log(failures ? `\n${failures} FAILED` : '\nAll comparison cases behave as expected. Nothing was signed or sent.');
process.exitCode = failures ? 1 : 0;
})();
