// Completely offline. No keystore, secrets, signatures, or transaction submission.
// node apps/api/node_modules/tsx/dist/cli.mjs scripts/mainnet/fees.test.ts
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { checkFeeLimits, checkSimulatedFee, feeParts, inclusionBid, withResourceFeeMargin } from './fees.js';
import { compareSigned } from './txcompare.js';

const Sdk: any = createRequire(fileURLToPath(new URL('../../apps/api/package.json', import.meta.url)))('@stellar/stellar-sdk');
globalThis.fetch = async () => { throw new Error('network forbidden in offline regression'); };
const source = 'GAEZO27HHGDAXXCXQPIZ5SKWLSRCXV7OLSMUWZFFEC7YV2QLRWKPIEBO';
const contract = 'CDZCBEGYZKYP3MH6SHF3FOE4HUTQFX52KPVAYH5YBCOWB2ECS5PHJSMK';
const op = new Sdk.Contract(contract).call('allow_fund', Sdk.nativeToScVal(4n, { type: 'i128' }));
const raw = (bid: bigint) => new Sdk.TransactionBuilder(new Sdk.Account(source, '10'), {
  fee: bid.toString(), networkPassphrase: Sdk.Networks.PUBLIC,
  timebounds: { minTime: '1', maxTime: '2000000000' },
}).addOperation(op).build();
const simulation = (resource = 519764n) => ({
  _parsed: true, latestLedger: 1, events: [], minResourceFee: resource.toString(),
  transactionData: new Sdk.SorobanDataBuilder().setResourceFee(resource.toString()),
  result: { auth: [], retval: Sdk.xdr.ScVal.scvVoid() },
});

async function main() {
  const server = new Sdk.rpc.Server('https://offline.invalid');
  // Use the installed SDK's real prepare/assemble/build logic, replacing only RPC simulation.
  server.simulateTransaction = async () => simulation();
  const old = await server.prepareTransaction(raw(100n));
  assert.deepEqual(feeParts(old), { inclusion: 100n, resource: 519764n, total: 519864n });
  assert.throws(() => checkFeeLimits(old), /inclusion fee/);
  assert.equal(inclusionBid('200'), 1000n);
  assert.equal(inclusionBid('2000'), 2000n);
  assert.equal(inclusionBid('200', '5000'), 5000n);
  for (const bad of ['-1', '1.2', 'NaN', '100001']) assert.throws(() => inclusionBid(bad));
  assert.throws(() => inclusionBid('200', '100001'));
  const fixed = await server.prepareTransaction(raw(inclusionBid('200')));
  assert.deepEqual(checkFeeLimits(fixed, 1000n), { inclusion: 1000n, resource: 519764n, total: 520764n });
  assert.throws(() => checkFeeLimits(fixed, 2000n), /unexpected inclusion/);
  const padded = withResourceFeeMargin(Sdk, fixed, 1000n);
  assert.deepEqual(feeParts(padded), { inclusion: 1000n, resource: 520764n, total: 521764n });
  assert.throws(() => checkSimulatedFee(fixed, simulation(519766n)), /below current simulated minimum/);
  const paddedXdr = padded.toXDR();
  checkSimulatedFee(padded, simulation(519766n)); // reported +2 stroops fluctuation
  checkSimulatedFee(padded, simulation(520764n)); // entire margin consumed
  assert.equal(padded.toXDR(), paddedXdr, 'preflight must not alter the padded XDR');
  assert.equal(fixed.toXDR(), (await server.prepareTransaction(raw(1000n))).toXDR(), 'margin must not mutate prepared input');
  assert.throws(() => checkSimulatedFee(padded, simulation(520765n)), /below current simulated minimum/);
  // Verify every envelope byte except the two intended fee fields is preserved.
  const expected = fixed.toEnvelope();
  expected.v1().tx().fee(expected.v1().tx().fee() + 1000);
  expected.v1().tx().ext().sorobanData().resourceFee(Sdk.xdr.Int64.fromString('520764'));
  assert.equal(paddedXdr, expected.toXDR('base64'));
  assert.equal(compareSigned(fixed, padded).equal, false, 'new higher fees require a new build and signature');
  const signed = Sdk.TransactionBuilder.fromXDR(paddedXdr, Sdk.Networks.PUBLIC);
  signed.signatures.push(new Sdk.xdr.DecoratedSignature({ hint: Buffer.alloc(4), signature: Buffer.alloc(64) }));
  assert.throws(() => withResourceFeeMargin(Sdk, signed, 1000n), /before signing/);
  const xdr = fixed.toXDR();
  checkSimulatedFee(fixed, simulation());
  checkSimulatedFee(fixed, simulation(519763n));
  assert.equal(fixed.toXDR(), xdr, 'preflight must preserve XDR');
  assert.throws(() => checkSimulatedFee(fixed, simulation(519765n)), /below current simulated minimum/);
  assert.throws(() => checkSimulatedFee(fixed, { error: 'no' }), /simulation failed/);
  assert.throws(() => checkSimulatedFee(fixed, { ...simulation(), restorePreamble: {} }), /restoration/);
  assert.throws(() => checkSimulatedFee(fixed, { ...simulation(), minResourceFee: '-1' }), /unsigned integer/);
  for (const [bid, resource] of [[100001n, 519764n], [1000n, 10000001n]]) {
    const tx = Sdk.rpc.assembleTransaction(raw(bid), simulation(resource)).build();
    assert.throws(() => checkFeeLimits(tx), /policy/);
  }
  checkFeeLimits(Sdk.rpc.assembleTransaction(raw(100000n), simulation(10000000n)).build());
  const atCap = Sdk.rpc.assembleTransaction(raw(100000n), simulation(9999000n)).build();
  assert.deepEqual(feeParts(withResourceFeeMargin(Sdk, atCap, 100000n)), {
    inclusion: 100000n, resource: 10000000n, total: 10100000n,
  });
  const overCap = Sdk.rpc.assembleTransaction(raw(100000n), simulation(9999001n)).build();
  assert.throws(() => withResourceFeeMargin(Sdk, overCap, 100000n), /policy/);
  assert.throws(() => checkSimulatedFee(withResourceFeeMargin(Sdk, atCap, 100000n), simulation(10000001n)), /below current simulated minimum/);

  // Alter raw XDR fields to keep all other fields identical. No keys needed.
  function variant(change: (tx: any) => void) {
    const env = fixed.toEnvelope();
    change(env.v1().tx());
    return Sdk.TransactionBuilder.fromXDR(env.toXDR('base64'), Sdk.Networks.PUBLIC);
  }
  assert.equal(compareSigned(fixed, fixed).equal, true);
  const rejected = (change: (tx: any) => void) => assert.equal(compareSigned(fixed, variant(change)).equal, false);
  rejected(tx => tx.seqNum(Sdk.xdr.SequenceNumber.fromString('12')));
  rejected(tx => tx.sourceAccount(Sdk.xdr.MuxedAccount.keyTypeEd25519(Buffer.alloc(32, 1))));
  rejected(tx => tx.operations()[0].sourceAccount(Sdk.xdr.MuxedAccount.keyTypeEd25519(Buffer.alloc(32, 1))));
  rejected(tx => tx.operations()[0].body().invokeHostFunctionOp().hostFunction().invokeContract().functionName('subscribe'));
  rejected(tx => tx.operations()[0].body().invokeHostFunctionOp().hostFunction().invokeContract().args([Sdk.nativeToScVal(5n, { type: 'i128' })]));
  rejected(tx => tx.operations([...tx.operations(), tx.operations()[0]]));
  rejected(tx => tx.operations()[0].body().invokeHostFunctionOp().auth([new Sdk.xdr.SorobanAuthorizationEntry({
    credentials: Sdk.xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new Sdk.xdr.SorobanAuthorizedInvocation({
      function: Sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        tx.operations()[0].body().invokeHostFunctionOp().hostFunction().invokeContract()),
      subInvocations: [],
    }),
  })]));
  rejected(tx => tx.memo(Sdk.xdr.Memo.memoText('changed')));
  rejected(tx => tx.cond().timeBounds().maxTime(Sdk.xdr.TimePoint.fromString('2000000001')));
  rejected(tx => tx.fee(tx.fee() + 1));
  // Same total fee but resource allocation shifted to inclusion must also be refused.
  rejected(tx => tx.ext().sorobanData().resourceFee(Sdk.xdr.Int64.fromString('519763')));
  assert.equal(compareSigned(fixed, variant(tx => {
    tx.ext().sorobanData().resourceFee(Sdk.xdr.Int64.fromString('519763'));
    tx.fee(tx.fee() - 1);
  })).equal, true, 'lower resource and total fees remain supported');
  const wrongNetwork = Sdk.TransactionBuilder.fromXDR(xdr, Sdk.Networks.TESTNET);
  assert.notEqual(Buffer.from(wrongNetwork.hash()).toString('hex'), Buffer.from(fixed.hash()).toString('hex'));
  console.log('PASS: SDK 16.3.0 fee regression, +2 stroops covered, bounded resource margin, caps, read-only preflight, and XDR comparison safeguards. No network or keys used.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
