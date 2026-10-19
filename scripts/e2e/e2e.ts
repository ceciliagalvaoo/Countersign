// End to end proof (lines 1.4, 1.5, 1.7) against the local API and Stellar testnet. Run through run.sh.
// The investor (owner) and the fund wallet (issuer) are disposable Stellar CLI identities: every XDR the API
// returns is signed here exactly as Freighter would sign it, then reported back to the API for verification.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const requireFromApi = createRequire(path.join(ROOT, 'apps/api/package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Sdk: any = requireFromApi('@stellar/stellar-sdk');
const bcrypt = requireFromApi('bcryptjs');
const { PrismaClient } = requireFromApi('@prisma/client');

const API = process.env.E2E_API!;
const PASSPHRASE = Sdk.Networks.TESTNET;
const server = new Sdk.rpc.Server('https://soroban-testnet.stellar.org');
const owner = Sdk.Keypair.fromSecret(process.env.E2E_OWNER_SECRET!);
const fundKp = Sdk.Keypair.fromSecret(process.env.E2E_FUND_SECRET!);
const prisma = new PrismaClient();
const expert = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Rec { step: string; hash: string; status: string; link: string; logSeq?: number | null; note?: string }
const records: Rec[] = [];
const checks: { check: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push({ check: name, ok, detail });
  console.log(`  [${ok ? 'OK' : 'FAIL'}] ${name}${detail ? ': ' + detail : ''}`);
  if (!ok) throw new Error(`check failed: ${name}`);
};

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

async function api(method: string, url: string, token: string | null, body?: unknown, expectOk = true) {
  return retry(`${method} ${url}`, async () => {
    const res = await fetch(`${API}${url}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (expectOk && !res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 600)}`);
    return { status: res.status, json };
  });
}

/** Signs an API-built XDR with the given key (what the browser wallet does) and submits it through RPC */
async function signAndSubmit(xdrB64: string, kp: any, step: string, note?: string) {
  const tx = Sdk.TransactionBuilder.fromXDR(xdrB64, PASSPHRASE);
  tx.sign(kp);
  const hash = tx.hash().toString('hex');
  for (let i = 1; ; i++) {
    const send = await retry('sendTransaction', () => server.sendTransaction(tx));
    if (send.status === 'PENDING' || send.status === 'DUPLICATE') break;
    if (send.status === 'TRY_AGAIN_LATER' && i < 10) { await sleep(2500); continue; }
    throw new Error(`${step}: sendTransaction ${send.status} ${send.errorResult ? send.errorResult.result().switch().name : ''}`);
  }
  let res: any;
  for (let i = 0; i < 90; i++) {
    res = await retry('getTransaction', () => server.getTransaction(hash));
    if (res.status !== 'NOT_FOUND') break;
    await sleep(2000);
  }
  if (res.status !== 'SUCCESS') throw new Error(`${step}: ${res.status} ${hash}`);
  console.log(`  ${step}: SUCCESS ${hash}`);
  const rec: Rec = { step, hash, status: 'SUCCESS', link: expert(hash), note };
  records.push(rec);
  return { hash, rec };
}

/** Submits a signed envelope that is expected to FAIL in the ledger; returns its hash and the contract error code */
async function signAndSubmitExpectFail(xdrB64: string, kp: any, step: string) {
  // The envelope was prepared (simulated) before a state change; the source has sent other transactions since, so it
  // is rebuilt with the current sequence keeping the same call, auth, footprint and resources (no new simulation)
  const prepared = Sdk.TransactionBuilder.fromXDR(xdrB64, PASSPHRASE);
  const op = prepared.operations[0];
  const account = await retry('getAccount', () => server.getAccount(kp.publicKey()));
  const tx = new Sdk.TransactionBuilder(account, {
    fee: Sdk.BASE_FEE,
    networkPassphrase: PASSPHRASE,
    sorobanData: prepared.toEnvelope().v1().tx().ext().sorobanData(),
  })
    .addOperation(Sdk.Operation.invokeHostFunction({ func: op.func, auth: op.auth ?? [] }))
    .setTimeout(120)
    .build();
  tx.sign(kp);
  const hash = tx.hash().toString('hex');
  for (let i = 1; ; i++) {
    const send = await retry('sendTransaction', () => server.sendTransaction(tx));
    if (send.status === 'PENDING' || send.status === 'DUPLICATE') break;
    if (send.status === 'TRY_AGAIN_LATER' && i < 10) { await sleep(2500); continue; }
    throw new Error(`${step}: sendTransaction ${send.status}`);
  }
  let res: any;
  for (let i = 0; i < 90; i++) {
    res = await retry('getTransaction', () => server.getTransaction(hash));
    if (res.status !== 'NOT_FOUND') break;
    await sleep(2000);
  }
  let code: number | null = null;
  for (const d of res.diagnosticEventsXdr ?? []) {
    const body = d.event().body().v0();
    for (const v of [...body.topics(), body.data()]) {
      if (v.switch().name === 'scvError' && v.error().switch().name === 'sceContract') { code = Number(v.error().contractCode()); break; }
    }
    if (code !== null) break;
  }
  console.log(`  ${step}: ${res.status} ${hash}`);
  records.push({ step, hash, status: res.status, link: expert(hash), note: code !== null ? `RPC diagnostic events: Error(Contract, #${code})` : undefined });
  return { hash, status: res.status, code };
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

async function testUsdc(token: string, kp: any, step: string) {
  const { json } = await api('POST', '/api/stellar/test-usdc', token, { publicKey: kp.publicKey() });
  await signAndSubmit(json.transactionXdr, kp, step, 'Blend testnet faucet (trustline + test USDC), relayed by the API');
}

async function main() {
  const tag = crypto.randomBytes(3).toString('hex');
  console.log(`E2E run ${tag}: owner ${owner.publicKey()}, fund wallet ${fundKp.publicKey()}`);

  // Users in the disposable database (an approved investor and a manager), then real logins through the API
  const password = crypto.randomBytes(12).toString('hex');
  const hash = await bcrypt.hash(password, 10);
  const inv = await prisma.user.create({ data: { email: `e2e-investor-${tag}@example.test`, password: hash, role: 'INVESTIDOR', status: 'APPROVED', publicKey: owner.publicKey() } });
  const ges = await prisma.user.create({ data: { email: `e2e-manager-${tag}@example.test`, password: hash, role: 'GESTOR', status: 'APPROVED' } });
  const invToken = (await api('POST', '/api/auth/login', null, { email: inv.email, password })).json.token;
  const gesToken = (await api('POST', '/api/auth/login', null, { email: ges.email, password })).json.token;

  console.log('\n1. Test USDC for both accounts (Blend faucet through the API relay)');
  const usdcSac = new Sdk.Asset('USDC', 'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56').contractId(PASSPHRASE);
  const bal = async (a: string) => BigInt(await read(usdcSac, 'balance', [Sdk.nativeToScVal(a, { type: 'address' })]));
  if ((await bal(owner.publicKey()).catch(() => 0n)) < 300_000_000n) await testUsdc(invToken, owner, 'faucet_owner');
  if ((await bal(fundKp.publicKey()).catch(() => 0n)) < 10_000_000n) await testUsdc(gesToken, fundKp, 'faucet_fund_wallet');

  console.log('\n2. Demo catalog seeded (CSAGRI: fund wallet and FundToken created on testnet by setup-demo-funds.ts)');
  execFileSync(path.join(ROOT, 'apps/api/node_modules/.bin/tsx'), ['scripts/seed-countersign-demo.ts', '--consultor-email', ges.email], {
    cwd: path.join(ROOT, 'apps/api'),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const fund = await prisma.fund.findUnique({ where: { symbol: 'CSAGRI' } });
  check('CSAGRI seeded with the fund wallet of this run', fund?.status === 'APPROVED' && fund.fundWalletPublicKey === fundKp.publicKey() && !!fund.tokenContractId, fund?.tokenContractId);
  const tokenId: string = fund.tokenContractId;

  console.log('\n3. Mandate drafted and approved by the investor (policy-guard store)');
  const mandate = {
    residences: ['PT'], horizonMonths: 24, liquidityNeedPct: 10, liquidityWithinMonths: 6, maxLossTolerance: 'MEDIUM',
    totalAmountUsdc: '100', perPurchaseCapUsdc: '20', periodCapUsdc: '50', periodDays: 30, allowedSectors: ['AGRO'], maxPerSectorPct: 100,
  };
  const draft = (await api('PUT', '/api/mandates/draft', invToken, mandate)).json;
  const approved = (await api('POST', '/api/mandates/approve', invToken, { mandateHash: draft.mandateHash })).json;
  check('mandate approved with hash', /^[0-9a-f]{64}$/.test(approved.mandateHash), approved.mandateHash);

  console.log('\n4. S0: mandate wallet deploy, signed by the owner');
  const dep = (await api('POST', '/api/mandate-wallet/build-deploy', invToken, { ownerPublicKey: owner.publicKey() })).json;
  check('build-deploy decoded: create_contract with 7 constructor args', dep.decoded.operation === 'create_contract' && dep.decoded.args.length === 7);
  check('decoded network is out of band', dep.decoded.network === 'Stellar testnet' && dep.decoded.networkSource === 'out_of_band');
  const depTx = await signAndSubmit(dep.transactionXdr, owner, 'deploy_wallet');
  const conf = (await api('POST', '/api/mandate-wallet/confirm', invToken, { txHash: depTx.hash })).json;
  depTx.rec.logSeq = conf.logSeq;
  const walletC = conf.wallet.contractId;
  check('wallet is a contract address', /^C[A-Z2-7]{55}$/.test(walletC), walletC);
  check('deploy anchored the approved mandate hash', conf.mandateHash === approved.mandateHash);

  console.log('\n5. Deposit 30 test USDC (SAC transfer G to C, no memo)');
  const dpb = (await api('POST', '/api/mandate-wallet/build-deposit', invToken, { amountUsdc: '30' })).json;
  check('deposit decoded: transfer to "your mandate wallet"', dpb.decoded.function === 'transfer' && dpb.decoded.args[1].label === 'your mandate wallet', dpb.decoded.args[2].display);
  const dpTx = await signAndSubmit(dpb.transactionXdr, owner, 'deposit');
  dpTx.rec.logSeq = (await api('POST', '/api/mandate-wallet/confirm-deposit', invToken, { txHash: dpTx.hash, amountUsdc: '30' })).json.logSeq;

  console.log('\n6. S2: set_limits from the approved mandate (owner)');
  const slb = (await api('POST', '/api/mandate-wallet/build-call', invToken, { method: 'set_limits', params: {} })).json;
  check('set_limits decoded caps', slb.decoded.args[0].display === '20.0000000 USDC' && slb.decoded.args[2].display.startsWith('30 days'), slb.decoded.args.map((a: any) => a.display).join(' | '));
  const slTx = await signAndSubmit(slb.transactionXdr, owner, 'set_limits');
  slTx.rec.logSeq = (await api('POST', '/api/mandate-wallet/confirm-call', invToken, { txHash: slTx.hash, method: 'set_limits', params: {} })).json.logSeq;

  console.log('\n7. Policy before allow_fund: first purchase needs the investor');
  const agentToken = (await api('POST', '/api/agent/session-token', invToken, {})).json.token;
  const p0 = (await api('POST', '/api/agent/proposals', agentToken, { fundId: fund.id, amountUsdc: '10', amountSource: 'investor_message', origin: 'chat', toolCallId: `e2e-${tag}-0` })).json;
  check('proposal before allow_fund is NEEDS_INVESTOR_SIGNATURE', p0.outcome === 'NEEDS_INVESTOR_SIGNATURE', `${p0.rule} seq ${p0.seq}`);

  console.log('\n8. S8: allow_fund (fund wallet and token from the database, cap typed by the owner)');
  const afb = (await api('POST', '/api/mandate-wallet/build-call', invToken, { method: 'allow_fund', params: { fundId: fund.id, fundCapUsdc: '50' } })).json;
  check('allow_fund decoded: fund wallet label from DB', afb.decoded.args[0].value === fundKp.publicKey() && /fund wallet of/.test(afb.decoded.args[0].label ?? ''), afb.decoded.args[0].display);
  // 1.7: changing one byte of the XDR changes the decoded output
  const raw = Buffer.from(afb.transactionXdr, 'base64');
  const capPos = raw.indexOf(Buffer.from([0x1d, 0xcd, 0x65, 0x00])); // 500000000 (50 USDC) inside the i128
  let byteFlipOk = false;
  if (capPos > 0) {
    const mutated = Buffer.from(raw);
    mutated[capPos] = 0x2d;
    const dm = (await api('POST', '/api/tx/decode', invToken, { transactionXdr: mutated.toString('base64') })).json.decoded;
    byteFlipOk = JSON.stringify(dm.args) !== JSON.stringify(afb.decoded.args) && dm.txHash !== afb.decoded.txHash;
    check('one byte changed in the XDR changes the decoded card', byteFlipOk, `${afb.decoded.args[2].display} -> ${dm.args[2].display}`);
  }
  const afTx = await signAndSubmit(afb.transactionXdr, owner, 'allow_fund');
  afTx.rec.logSeq = (await api('POST', '/api/mandate-wallet/confirm-call', invToken, { txHash: afTx.hash, method: 'allow_fund', params: { fundId: fund.id, fundCapUsdc: '50' } })).json.logSeq;

  console.log('\n9. S7 and S9: proposal approved by the policy, subscribe executed by the agent');
  const p1 = (await api('POST', '/api/agent/proposals', agentToken, { fundId: fund.id, amountUsdc: '10', amountSource: 'investor_message', origin: 'chat', toolCallId: `e2e-${tag}-1` })).json;
  check('proposal APPROVED', p1.outcome === 'APPROVED', `${p1.rule} seq ${p1.seq} hash ${p1.hash}`);
  const ex = (await api('POST', `/api/agent/proposals/${p1.seq}/execute`, agentToken, {})).json;
  check('execute CONFIRMED with a hash', ex.status === 'CONFIRMED' && /^[0-9a-f]{64}$/.test(ex.txHash), ex.txHash);
  records.push({ step: 'subscribe (agent)', hash: ex.txHash, status: 'SUCCESS', link: expert(ex.txHash), note: `decision = log row ${p1.seq} hash ${p1.hash}` });
  const conf9 = await server.getTransaction(ex.txHash);
  const call = new Sdk.Transaction(conf9.envelopeXdr, PASSPHRASE).operations[0].func.invokeContract();
  const onchainDecision = call.args()[0].bytes().toString('hex');
  check('decision argument on-chain equals the log row hash', onchainDecision === p1.hash, onchainDecision);

  console.log('\n10. S10 and S12: order verified by the API, status for the confirmation screen');
  const purchases = (await api('GET', '/api/mandate-wallet/purchases', invToken)).json;
  const pur = purchases.purchases.find((x: any) => x.subscribeTxHash === ex.txHash);
  check('order COMPLETED, awaiting issuer countersignature', pur?.status === 'CONFIRMED_AWAITING_ISSUER', JSON.stringify({ orderId: pur?.orderId, decisionSeq: pur?.decisionSeq }));
  const order = await prisma.order.findUnique({ where: { id: pur.orderId } });
  check('order payer is the wallet and decisionHash is the log row', order.payerAddress === walletC && order.decisionHash === p1.hash && order.status === 'COMPLETED');

  console.log('\n11. S11: issuer countersigns: whitelist_add(C) then mint(C), signed by the fund wallet');
  let whitelistHash: string | undefined;
  let mintHash: string | undefined;
  for (let i = 0; i < 3 && !mintHash; i++) {
    const r = (await api('PATCH', `/api/orders/${order.id}/approve`, gesToken, { action: 'approve', ...(whitelistHash ? { whitelistTxHash: whitelistHash } : {}) })).json;
    if (!r.requiresTransaction) break;
    check(`approve step ${r.step} destination is the wallet`, r.mintDetails.destination === walletC && r.signer === fundKp.publicKey());
    const t = await signAndSubmit(r.transactionXdr, fundKp, r.step === 'whitelist' ? 'whitelist_add(C)' : 'mint(C)');
    if (r.step === 'whitelist') whitelistHash = t.hash;
    else mintHash = t.hash;
  }
  check('mint submitted', !!mintHash);
  const fin = (await api('PATCH', `/api/orders/${order.id}/approve`, gesToken, { action: 'approve', tokenMintTxHash: mintHash })).json;
  check('order APPROVED after verified mint', fin.order?.approvalStatus === 'APPROVED');
  const units = BigInt(await read(tokenId, 'balance', [Sdk.nativeToScVal(walletC, { type: 'address' })]));
  check('wallet holds the fund units on-chain', units === 100_000_000n, `${units} units (10.0000000)`);
  const pur2 = (await api('GET', '/api/mandate-wallet/purchases', invToken)).json.purchases.find((x: any) => x.orderId === order.id);
  check('status COUNTERSIGNED', pur2.status === 'COUNTERSIGNED');

  console.log('\n12. Refund to C: second purchase rejected by the issuer, USDC back through the SAC');
  const p2 = (await api('POST', '/api/agent/proposals', agentToken, { fundId: fund.id, amountUsdc: '5', amountSource: 'investor_message', origin: 'chat', toolCallId: `e2e-${tag}-2` })).json;
  check('second proposal APPROVED', p2.outcome === 'APPROVED', `seq ${p2.seq}`);
  const ex2 = (await api('POST', `/api/agent/proposals/${p2.seq}/execute`, agentToken, {})).json;
  check('second execute CONFIRMED', ex2.status === 'CONFIRMED', ex2.txHash);
  records.push({ step: 'subscribe (agent) #2', hash: ex2.txHash, status: 'SUCCESS', link: expert(ex2.txHash), note: `decision = log row ${p2.seq} hash ${p2.hash}` });
  const order2 = await prisma.order.findUnique({ where: { decisionHash: p2.hash } });
  const rj = (await api('PATCH', `/api/orders/${order2.id}/approve`, gesToken, { action: 'reject' })).json;
  check('refund details are a SAC transfer to the wallet', rj.refundDetails?.method === 'sac_transfer' && rj.refundDetails.destination === walletC && rj.refundDetails.decoded.function === 'transfer');
  const before = await bal(walletC);
  const rfTx = await signAndSubmit(rj.refundDetails.transactionXdr, fundKp, 'refund to C (SAC transfer)');
  const rjFin = (await api('PATCH', `/api/orders/${order2.id}/approve`, gesToken, { action: 'reject', refundTxHash: rfTx.hash })).json;
  check('order REJECTED after verified refund', rjFin.order?.approvalStatus === 'REJECTED');
  const after = await bal(walletC);
  check('wallet USDC increased by the refund', after - before === 50_000_000n, `${before} -> ${after}`);

  console.log('\n12b. S14 kill switch: revoke_agent by the owner, the next agent purchase is refused by the wallet contract');
  const rvb = (await api('POST', '/api/mandate-wallet/build-call', invToken, { method: 'revoke_agent', params: {} })).json;
  const rvTx = await signAndSubmit(rvb.transactionXdr, owner, 'revoke_agent');
  rvTx.rec.logSeq = (await api('POST', '/api/mandate-wallet/confirm-call', invToken, { txHash: rvTx.hash, method: 'revoke_agent', params: {} })).json.logSeq;
  const p3 = (await api('POST', '/api/agent/proposals', agentToken, { fundId: fund.id, amountUsdc: '1', amountSource: 'investor_message', origin: 'chat', toolCallId: `e2e-${tag}-3` })).json;
  const ex3 = await api('POST', `/api/agent/proposals/${p3.seq}/execute`, agentToken, {}, false);
  check('policy re-reads is_revoked before building: 409 agent_revoked, no order', ex3.status === 409 && ex3.json.rule === 'agent_revoked' && !(await prisma.order.findUnique({ where: { decisionHash: p3.hash } })), ex3.json.rule);
  // Without our server in the path: the same subscribe, with the agent key as source, is refused by the wallet contract
  const agentG = (await api('GET', '/api/mandate-wallet', invToken)).json.wallet.agent;
  const simTx = new Sdk.TransactionBuilder(await retry('getAccount', () => server.getAccount(agentG)), { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(new Sdk.Contract(walletC).call('subscribe', Sdk.xdr.ScVal.scvBytes(Buffer.from(p3.hash, 'hex')), Sdk.nativeToScVal(fundKp.publicKey(), { type: 'address' }), Sdk.nativeToScVal(10_000_000n, { type: 'i128' })))
    .setTimeout(60)
    .build();
  const sim = await retry('simulate', () => server.simulateTransaction(simTx));
  check('wallet contract refuses subscribe after revoke: Error(Contract, #3) AgentRevoked', Sdk.rpc.Api.isSimulationError(sim) && /Error\(Contract, #3\)/.test(sim.error), 'simulation with the agent key as source');
  const sab = (await api('POST', '/api/mandate-wallet/build-call', invToken, { method: 'set_agent', params: {} })).json;
  const saTx = await signAndSubmit(sab.transactionXdr, owner, 'set_agent (re-enable)');
  saTx.rec.logSeq = (await api('POST', '/api/mandate-wallet/confirm-call', invToken, { txHash: saTx.hash, method: 'set_agent', params: {} })).json.logSeq;

  console.log('\n12c. S14 issuer freeze: set_pause(true) by the fund wallet, the next mint is refused by the FundToken');
  const p4 = (await api('POST', '/api/agent/proposals', agentToken, { fundId: fund.id, amountUsdc: '1', amountSource: 'investor_message', origin: 'chat', toolCallId: `e2e-${tag}-4` })).json;
  const ex4 = (await api('POST', `/api/agent/proposals/${p4.seq}/execute`, agentToken, {})).json;
  check('purchase after set_agent CONFIRMED', ex4.status === 'CONFIRMED', ex4.txHash);
  records.push({ step: 'subscribe (agent) #3', hash: ex4.txHash, status: 'SUCCESS', link: expert(ex4.txHash), note: `decision = log row ${p4.seq} hash ${p4.hash}` });
  const order4 = await prisma.order.findUnique({ where: { decisionHash: p4.hash } });
  const mintStep = (await api('PATCH', `/api/orders/${order4.id}/approve`, gesToken, { action: 'approve' })).json;
  check('approve returns the mint (wallet already whitelisted)', mintStep.step === 'mint');
  const pb = (await api('POST', `/api/funds/${fund.id}/pause/build`, gesToken, { paused: true })).json;
  check('pause decoded: set_pause(true) on the unit token', pb.decoded.function === 'set_pause' && pb.decoded.args[0].value === 'true' && /unit token of/.test(pb.decoded.contract.label ?? ''));
  const psTx = await signAndSubmit(pb.transactionXdr, fundKp, 'set_pause(true)');
  try {
    const pc = (await api('POST', `/api/funds/${fund.id}/pause/confirm`, gesToken, { txHash: psTx.hash, paused: true })).json;
    psTx.rec.logSeq = pc.logSeq;
    check('pause verified and read back', pc.paused === true);
    const fv = (await api('GET', `/api/funds/${fund.id}`, invToken)).json.fund;
    check('GET /api/funds/:id exposes paused = true', fv.paused === true);
    // The mint prepared before the freeze is submitted anyway: the FundToken refuses it on-chain
    const failed = await signAndSubmitExpectFail(mintStep.transactionXdr, fundKp, 'mint(C) while paused');
    check('mint while paused FAILED on-chain with Error(Contract, #3) Paused', failed.code === 3, `${failed.hash} code ${failed.code}`);
    const again = await api('PATCH', `/api/orders/${order4.id}/approve`, gesToken, { action: 'approve' }, false);
    check('API refuses to build a mint while paused (409)', again.status === 409, String(again.status));
  } finally {
    const ub = (await api('POST', `/api/funds/${fund.id}/pause/build`, gesToken, { paused: false })).json;
    const upTx = await signAndSubmit(ub.transactionXdr, fundKp, 'set_pause(false)');
    upTx.rec.logSeq = (await api('POST', `/api/funds/${fund.id}/pause/confirm`, gesToken, { txHash: upTx.hash, paused: false })).json.logSeq;
  }
  const m4 = (await api('PATCH', `/api/orders/${order4.id}/approve`, gesToken, { action: 'approve' })).json;
  const m4Tx = await signAndSubmit(m4.transactionXdr, fundKp, 'mint(C) after unpause');
  const m4Fin = (await api('PATCH', `/api/orders/${order4.id}/approve`, gesToken, { action: 'approve', tokenMintTxHash: m4Tx.hash })).json;
  check('mint after unpause verified', m4Fin.order?.approvalStatus === 'APPROVED');

  console.log('\n13. Wallet state read from the chain and decision log chain check');
  const state = (await api('GET', '/api/mandate-wallet', invToken)).json;
  check('state: spent in period 16 USDC, fund allowed', state.wallet.spentInPeriod === '16.0000000' && state.wallet.allowedFunds.length === 1, `balance ${state.wallet.usdcBalance}`);
  const verify = (await api('GET', '/api/decision-log/verify', invToken)).json;
  check('decision log chain verifies', verify.ok === true, `rows ${verify.count}`);
  const logRows = (await api('GET', '/api/decision-log', invToken)).json.entries;
  const byTx = new Map<string, number>();
  for (const r of logRows) if (r.payload.txHash) byTx.set(r.payload.txHash, r.seq);
  for (const r of records) if (r.logSeq == null) r.logSeq = byTx.get(r.hash) ?? null;
  const walletHashes = records.filter((r) => r.status === 'SUCCESS' && !/faucet|fund_token_deploy/.test(r.step));
  check('every wallet and order hash has a log row', walletHashes.every((r) => r.logSeq != null), walletHashes.map((r) => `${r.step}:${r.logSeq}`).join(', '));

  console.log('\n14. Test USDC transfer route (operator account, testnet only)');
  const fresh = Sdk.Keypair.random();
  await retry('friendbot', async () => { const r = await fetch(`https://friendbot.stellar.org?addr=${fresh.publicKey()}`); if (!r.ok) throw new Error(`friendbot ${r.status}`); });
  await sleep(3000);
  const tl = (await api('POST', '/api/stellar/usdc-trustline', invToken, { publicKey: fresh.publicKey() })).json;
  await signAndSubmit(tl.transactionXdr, fresh, 'usdc trustline (fresh account)');
  const tu = await api('POST', '/api/stellar/test-usdc-transfer', invToken, { publicKey: fresh.publicKey() }, false);
  check('test-usdc-transfer sent 100 test USDC', tu.status === 200 && /^[0-9a-f]{64}$/.test(tu.json.txHash ?? ''), tu.json.txHash ?? JSON.stringify(tu.json));
  records.push({ step: 'test-usdc-transfer (operator)', hash: tu.json.txHash, status: 'SUCCESS', link: expert(tu.json.txHash) });
  const tu2 = await api('POST', '/api/stellar/test-usdc-transfer', invToken, { publicKey: fresh.publicKey() }, false);
  check('second transfer the same day refused', tu2.status === 429, String(tu2.status));

  console.log('\n=== transactions ===');
  for (const r of records) console.log(`${r.step} | ${r.status} | ${r.hash} | ${r.link} | log ${r.logSeq ?? 'n/a'}${r.note ? ' | ' + r.note : ''}`);
  const out = { run: tag, network: 'Stellar testnet', at: new Date().toISOString(), owner: owner.publicKey(), fundWallet: fundKp.publicKey(), fundToken: tokenId, wallet: walletC, records, checks };
  fs.writeFileSync(path.join(here, 'last-run.json'), JSON.stringify(out, null, 2));
  console.log(`\nAll ${checks.length} checks passed. Evidence: scripts/e2e/last-run.json`);
}

main()
  .catch((e) => {
    console.error(`\nE2E FAILED: ${(e as Error).message}`);
    console.log('\n=== transactions so far ===');
    for (const r of records) console.log(`${r.step} | ${r.status} | ${r.hash} | ${r.link}`);
    console.log(`API log: ${process.env.E2E_API_LOG}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
