import '../../policy/__tests__/setupEnv.js';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as Sdk from '@stellar/stellar-sdk';
import { createAgentKey, getAgentPublicKey, signSubscription, SignerRefusedError } from '../index.js';
import { openSeed } from '../keyCrypto.js';
import { appendEntry, verifyChain } from '../../policy/decisionLog.js';
import { blendConfig } from '../../config/blend.js';
import { createFund, createUser, FakeChain, prisma, randomC, randomG, resetDb } from '../../policy/__tests__/helpers.js';

const PASS = blendConfig.passphrase;
let chain: FakeChain;

// Capture every byte written to the console and stdout/stderr while the signer runs
const captured: string[] = [];
const originals = {
  log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug,
  out: process.stdout.write.bind(process.stdout), err: process.stderr.write.bind(process.stderr),
};
function startCapture() {
  for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const) (console as any)[k] = (...a: unknown[]) => captured.push(a.map(String).join(' '));
  (process.stdout as any).write = (c: any, ...r: any[]) => (captured.push(String(c)), originals.out(c, ...r));
  (process.stderr as any).write = (c: any, ...r: any[]) => (captured.push(String(c)), originals.err(c, ...r));
}
function stopCapture() {
  for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const) (console as any)[k] = (originals as any)[k];
  (process.stdout as any).write = originals.out;
  (process.stderr as any).write = originals.err;
}

before(() => { chain = new FakeChain(); });
after(async () => { await prisma.$disconnect(); });
beforeEach(async () => { await resetDb(); });

/** An investor with agent key, wallet, a fund and an APPROVED decision claimed for execution */
async function setup() {
  const { user } = await createUser();
  const fund = await createFund();
  const { publicKey: agentPub } = await createAgentKey(user.id, { prisma, fundAccount: false });
  const wallet = randomC();
  chain.wallets.set(user.id, wallet);
  const row = await appendEntry(
    { kind: 'decision', userId: user.id, origin: 'chat', fundId: fund.id, amountUnits: '1000000000', rule: 'all_rules_passed', outcome: 'APPROVED', mandateHash: 'ab'.repeat(32), toolCallId: 't' },
    prisma
  );
  await prisma.decisionExecution.create({ data: { seq: row.seq, userId: user.id, status: 'PENDING' } });
  return { user, fund, agentPub, wallet, seq: row.seq, hash: row.hash };
}

function buildXdr(o: { source: string; contract: string; method?: string; decision: string; fundWallet: string; amount: bigint; extraOp?: boolean; fee?: string }) {
  const b = new Sdk.TransactionBuilder(new Sdk.Account(o.source, '1'), { fee: o.fee ?? '100000', networkPassphrase: PASS })
    .addOperation(
      new Sdk.Contract(o.contract).call(
        o.method ?? 'subscribe',
        Sdk.nativeToScVal(Buffer.from(o.decision, 'hex')),
        Sdk.nativeToScVal(o.fundWallet, { type: 'address' }),
        Sdk.nativeToScVal(o.amount, { type: 'i128' })
      )
    )
    .setTimeout(300);
  if (o.extraOp) b.addOperation(Sdk.Operation.payment({ destination: randomG(), asset: Sdk.Asset.native(), amount: '1' }));
  return b.build().toXDR();
}

async function expectRefused(seq: number, xdr: string, field: string) {
  const before = await prisma.decisionLog.count();
  await assert.rejects(signSubscription(seq, xdr, { prisma, chain }), (e: any) => e instanceof SignerRefusedError && e.field === field);
  const last = await prisma.decisionLog.findFirstOrThrow({ orderBy: { seq: 'desc' } });
  assert.equal(await prisma.decisionLog.count(), before + 1);
  assert.equal(JSON.parse(last.payload).rule, 'signer_refused');
  // still PENDING: a refused envelope does not consume the decision
  assert.equal((await prisma.decisionExecution.findUniqueOrThrow({ where: { seq } })).status, 'PENDING');
}

describe('1.3 agent signer', () => {
  test('signs exactly subscribe(decision, fund wallet, amount) on her wallet, once', async () => {
    const s = await setup();
    const good = buildXdr({ source: s.agentPub, contract: s.wallet, decision: s.hash, fundWallet: s.fund.fundWalletPublicKey!, amount: 1_000_000_000n });
    const signed = await signSubscription(s.seq, good, { prisma, chain });
    const tx = Sdk.TransactionBuilder.fromXDR(signed, PASS) as Sdk.Transaction;
    assert.equal(tx.signatures.length, 1);
    assert.ok(Sdk.Keypair.fromPublicKey(s.agentPub).verify(tx.hash(), tx.signatures[0].signature()));
    assert.equal((await prisma.decisionExecution.findUniqueOrThrow({ where: { seq: s.seq } })).status, 'SIGNED');
    // a second signature for the same decision is refused
    await assert.rejects(signSubscription(s.seq, good, { prisma, chain }), SignerRefusedError);
    assert.equal((await verifyChain(prisma)).ok, true);
  });

  test('refuses another method', async () => {
    const s = await setup();
    await expectRefused(s.seq, buildXdr({ source: s.agentPub, contract: s.wallet, method: 'withdraw', decision: s.hash, fundWallet: s.fund.fundWalletPublicKey!, amount: 1_000_000_000n }), 'method');
  });
  test('refuses another destination (A02: planted address)', async () => {
    const s = await setup();
    await expectRefused(s.seq, buildXdr({ source: s.agentPub, contract: s.wallet, decision: s.hash, fundWallet: randomG(), amount: 1_000_000_000n }), 'destination');
  });
  test('refuses another amount', async () => {
    const s = await setup();
    await expectRefused(s.seq, buildXdr({ source: s.agentPub, contract: s.wallet, decision: s.hash, fundWallet: s.fund.fundWalletPublicKey!, amount: 1_000_000_001n }), 'amount');
  });
  test('refuses another contract', async () => {
    const s = await setup();
    await expectRefused(s.seq, buildXdr({ source: s.agentPub, contract: randomC(), decision: s.hash, fundWallet: s.fund.fundWalletPublicKey!, amount: 1_000_000_000n }), 'contract');
  });
  test('refuses another source', async () => {
    const s = await setup();
    await expectRefused(s.seq, buildXdr({ source: randomG(), contract: s.wallet, decision: s.hash, fundWallet: s.fund.fundWalletPublicKey!, amount: 1_000_000_000n }), 'source');
  });
  test('refuses another decision hash', async () => {
    const s = await setup();
    await expectRefused(s.seq, buildXdr({ source: s.agentPub, contract: s.wallet, decision: 'cd'.repeat(32), fundWallet: s.fund.fundWalletPublicKey!, amount: 1_000_000_000n }), 'decision');
  });
  test('refuses a second operation, an excessive fee and a tampered envelope', async () => {
    const s = await setup();
    const base = { source: s.agentPub, contract: s.wallet, decision: s.hash, fundWallet: s.fund.fundWalletPublicKey!, amount: 1_000_000_000n };
    await expectRefused(s.seq, buildXdr({ ...base, extraOp: true }), 'operation');
    await expectRefused(s.seq, buildXdr({ ...base, fee: '20000000' }), 'fee');
    // flip bytes inside the envelope (adulterated XDR)
    const raw = Buffer.from(buildXdr(base), 'base64');
    raw[raw.length - 20] ^= 0xff;
    raw[40] ^= 0xff;
    await assert.rejects(signSubscription(s.seq, raw.toString('base64'), { prisma, chain }), SignerRefusedError);
  });
  test('refuses a decision that is not APPROVED or not claimed for execution', async () => {
    const s = await setup();
    const rejected = await appendEntry(
      { kind: 'decision', userId: s.user.id, origin: 'chat', fundId: s.fund.id, amountUnits: '1000000000', rule: 'amount_over_purchase_cap', outcome: 'REJECTED', mandateHash: null, toolCallId: 't' },
      prisma
    );
    const x = buildXdr({ source: s.agentPub, contract: s.wallet, decision: rejected.hash, fundWallet: s.fund.fundWalletPublicKey!, amount: 1_000_000_000n });
    await assert.rejects(signSubscription(rejected.seq, x, { prisma, chain }), (e: any) => e.field === 'decision');
    await prisma.decisionExecution.update({ where: { seq: s.seq }, data: { status: 'CONFIRMED' } });
    const good = buildXdr({ source: s.agentPub, contract: s.wallet, decision: s.hash, fundWallet: s.fund.fundWalletPublicKey!, amount: 1_000_000_000n });
    await assert.rejects(signSubscription(s.seq, good, { prisma, chain }), (e: any) => e.field === 'decision');
  });

  test('the secret is encrypted at rest and never appears in any output', async () => {
    captured.length = 0;
    startCapture();
    let s;
    try {
      s = await setup();
      const good = buildXdr({ source: s.agentPub, contract: s.wallet, decision: s.hash, fundWallet: s.fund.fundWalletPublicKey!, amount: 1_000_000_000n });
      await signSubscription(s.seq, buildXdr({ source: s.agentPub, contract: s.wallet, decision: s.hash, fundWallet: randomG(), amount: 1n }), { prisma, chain }).catch(() => undefined);
      await signSubscription(s.seq, good, { prisma, chain });
    } finally {
      stopCapture();
    }
    const row = await prisma.agentKey.findUniqueOrThrow({ where: { userId: s!.user.id } });
    const seed = openSeed(row, s!.user.id, row.publicKey, process.env.AGENT_KEY_ENCRYPTION_SECRET!);
    const kp = Sdk.Keypair.fromRawEd25519Seed(seed);
    assert.equal(kp.publicKey(), s!.agentPub);
    const forms = [kp.secret(), seed.toString('hex'), seed.toString('base64')];
    seed.fill(0);
    const everything = captured.join('\n') + JSON.stringify(row) + (await prisma.decisionLog.findMany()).map((r) => r.payload).join('');
    for (const f of forms) assert.ok(!everything.includes(f), 'secret leaked');
    // wrong key or another investor's row does not decrypt
    assert.throws(() => openSeed(row, 'someone-else', row.publicKey, process.env.AGENT_KEY_ENCRYPTION_SECRET!));
    assert.throws(() => openSeed(row, s!.user.id, row.publicKey, 'ab'.repeat(32)));
    // createAgentKey returns only the public key and is idempotent
    const again = await createAgentKey(s!.user.id, { prisma, fundAccount: false });
    assert.deepEqual(Object.keys(again).sort(), ['created', 'funded', 'publicKey']);
    assert.equal(again.publicKey, s!.agentPub);
    assert.equal(await getAgentPublicKey(s!.user.id, prisma), s!.agentPub);
  });
});
