// Spike S2 (build line 0.3): can a call the contract refuses be put in the ledger, giving a FAILED tx hash?
// Target: our own spike FundToken (from S1), `mint` to a non-whitelisted address => Error(Contract, #4).
// Variants:
//  0. plain simulation of the refused call: what the API sees today (prepareTransaction throws)
//  A. state changes between simulation and submission: simulate mint(Y) while Y is whitelisted, then
//     whitelist_remove(Y), then submit the already prepared mint (the "simulation passed, execution failed" case)
//  B. never valid call: take the footprint and resources of a successful equivalent simulation (mint to a
//     whitelisted W), add the ledger key the refused call reads (Whitelist(Z)), build the auth by hand, submit
//  B0. same as B but WITHOUT adding Z's key (naive reuse of the equivalent footprint)
//  C. no simulation at all (no Soroban data, no resources)
// Usage: run.sh s2-failed-hash.ts <FundToken contract id from S1>
import {
  Sdk, env, server, records, invoke, loadAccount, submit, printRecords, toAddr, toI128, PASSPHRASE, expert,
} from './lib.js';

const xdr = Sdk.xdr;

function failureDetail(res: any): string {
  const parts: string[] = [];
  try {
    const r = res.resultXdr.result();
    parts.push(`tx=${r.switch().name}`);
    const op = r.results?.()[0];
    if (op) parts.push(`op=${op.tr().invokeHostFunctionResult().switch().name}`);
  } catch { /* not an op-level result */ }
  try {
    const diag = res.diagnosticEventsXdr ?? [];
    for (const d of diag) {
      const ev = d.event();
      const topics = ev.body().v0().topics().map((t: any) => {
        try { return Sdk.scValToNative(t); } catch { return t.switch().name === 'scvError' ? errStr(t) : t.switch().name; }
      });
      const dataV = ev.body().v0().data();
      let data: unknown;
      try { data = dataV.switch().name === 'scvError' ? errStr(dataV) : Sdk.scValToNative(dataV); } catch { data = dataV.switch().name; }
      const t = topics.map((x: unknown) => (typeof x === 'bigint' ? x.toString() : x));
      if (JSON.stringify(t).includes('error') || String(data).includes('Error')) {
        parts.push(`diag topics=${JSON.stringify(t)} data=${JSON.stringify(data, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))}`);
      }
    }
    if (!diag.length) parts.push('no diagnostic events returned by RPC');
  } catch (e) { parts.push(`diag decode error ${(e as Error).message}`); }
  return parts.join(' | ');
}

function errStr(v: any): string {
  const e = v.error();
  const kind = e.switch().name;
  if (kind === 'sceContract') return `Error(Contract, #${e.contractCode()})`;
  return `Error(${kind}, ${e.code?.().name ?? ''})`;
}

async function simulate(source: string, contractId: string, method: string, args: any[], seq?: string) {
  const account = seq ? new Sdk.Account(source, seq) : await loadAccount(source);
  const tx = new Sdk.TransactionBuilder(account, { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Sdk.Contract(contractId).call(method, ...args))
    .setTimeout(300)
    .build();
  return { tx, sim: await server.simulateTransaction(tx) };
}

function whitelistKey(contractId: string, addr: string) {
  return xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
    contract: Sdk.Address.fromString(contractId).toScAddress(),
    key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Whitelist'), Sdk.Address.fromString(addr).toScVal()]),
    durability: xdr.ContractDataDurability.persistent(),
  }));
}

function sourceAuth(contractId: string, method: string, args: any[]) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({
        contractAddress: Sdk.Address.fromString(contractId).toScAddress(),
        functionName: method,
        args,
      })),
      subInvocations: [],
    }),
  });
}

async function report(step: string, fn: () => Promise<any>) {
  try {
    const out = await fn();
    if (out?.res) console.log(`  ${step}: ${out.res.status} ${expert(out.hash)}\n    ${out.res.status === 'FAILED' ? failureDetail(out.res) : ''}`);
  } catch (e) {
    const err = e as any;
    const extra = err.send?.errorResult ? ` result=${err.send.errorResult.result().switch().name}` : '';
    console.log(`  ${step}: ${err.message}${extra}`);
  }
}

async function main() {
  const fundToken = process.argv[2];
  if (!fundToken || !Sdk.StrKey.isValidContract(fundToken)) throw new Error('Pass the S1 FundToken contract id');
  const admin = Sdk.Keypair.fromSecret(env('SPIKE_ADMIN_SECRET'));
  const gHolder = Sdk.Keypair.fromSecret(env('SPIKE_HOLDER_SECRET'));
  const A = admin.publicKey();
  const W = gHolder.publicKey(); // whitelisted in S1

  // 0. Refused call through plain simulation
  const Z = Sdk.Keypair.random().publicKey();
  const { sim: sim0 } = await simulate(A, fundToken, 'mint', [toAddr(Z), toI128(1n)]);
  console.log(`0. simulate mint(Z non whitelisted): ${Sdk.rpc.Api.isSimulationError(sim0) ? 'SIMULATION ERROR' : 'ok?'}\n   ${String(sim0.error ?? '').split('\n')[0]}`);

  // A. Simulation passes, state changes, execution fails
  const Y = Sdk.Keypair.random().publicKey();
  await invoke(admin, fundToken, 'whitelist_add', [toAddr(Y)], 'S2A whitelist_add(Y)');
  const acc = await loadAccount(A);
  const seqPlusOne = (BigInt(acc.sequenceNumber()) + 1n).toString(); // the mint goes after whitelist_remove
  const { tx: txA } = await simulate(A, fundToken, 'mint', [toAddr(Y), toI128(1n)], seqPlusOne);
  const preparedA = await server.prepareTransaction(txA); // simulation succeeds now
  preparedA.sign(admin);
  await invoke(admin, fundToken, 'whitelist_remove', [toAddr(Y)], 'S2A whitelist_remove(Y)');
  await report('A. submit mint(Y) prepared before whitelist_remove', () => submit(preparedA, 'S2A mint(Y) after removal', 'expected Error(Contract, #4)'));

  // B and B0. Equivalent successful simulation (mint to whitelisted W), then the refused call (mint to never whitelisted Z)
  for (const variant of ['B0', 'B'] as const) {
    const Zv = Sdk.Keypair.random().publicKey();
    const { tx: txW } = await simulate(A, fundToken, 'mint', [toAddr(W), toI128(1n)]);
    const preparedW = await server.prepareTransaction(txW);
    const data = preparedW.toEnvelope().v1().tx().ext().sorobanData();
    const fp = data.resources().footprint();
    const ro = [...fp.readOnly()];
    const rw = [...fp.readWrite()];
    if (variant === 'B') ro.push(whitelistKey(fundToken, Zv));
    const res = data.resources();
    const builder = new Sdk.SorobanDataBuilder(data)
      .setFootprint(ro, rw)
      .setResources(Math.ceil(res.instructions() * 1.5), res.diskReadBytes() + 2000, res.writeBytes())
      .setResourceFee(BigInt(data.resourceFee().toString()) * 2n);
    const args = [toAddr(Zv), toI128(1n)];
    const op = Sdk.Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({
        contractAddress: Sdk.Address.fromString(fundToken).toScAddress(), functionName: 'mint', args,
      })),
      auth: [sourceAuth(fundToken, 'mint', args)],
    });
    const account = await loadAccount(A);
    const fee = (BigInt(Sdk.BASE_FEE) + BigInt(data.resourceFee().toString()) * 2n).toString();
    const tx = new Sdk.TransactionBuilder(account, { fee, networkPassphrase: PASSPHRASE })
      .addOperation(op).setSorobanData(builder.build()).setTimeout(300).build();
    tx.sign(admin);
    await report(`${variant}. submit mint(Z never whitelisted) with equivalent resources${variant === 'B' ? ' + Whitelist(Z) key' : ' (footprint unchanged)'}`,
      () => submit(tx, `S2${variant} mint(Z) unsimulated`, variant === 'B' ? 'expected Error(Contract, #4)' : 'naive footprint'));
  }

  // C. No simulation at all
  {
    const Zc = Sdk.Keypair.random().publicKey();
    const account = await loadAccount(A);
    const tx = new Sdk.TransactionBuilder(account, { fee: '1000000', networkPassphrase: PASSPHRASE })
      .addOperation(new Sdk.Contract(fundToken).call('mint', toAddr(Zc), toI128(1n)))
      .setTimeout(300).build();
    tx.sign(admin);
    await report('C. submit with no simulation (no Soroban data)', () => submit(tx, 'S2C mint(Z) no sorobanData'));
  }

  printRecords('S2');
}

main().catch((e) => {
  console.error('S2 ERROR', e?.message ?? e);
  printRecords('S2 (partial)');
  process.exitCode = 1;
});
