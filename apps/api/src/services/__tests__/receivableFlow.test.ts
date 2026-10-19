import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import * as S from '@stellar/stellar-sdk';
import { receivableRoutes } from '../../routes/receivable.js';
import { multisigRoutes } from '../../routes/multisig.js';
import { getOrCreatePending, mergeSignatures, signedWeight, submitSigned } from '../multisig.js';
// Loaded by the offline in-memory runner, without adding web sources to the API build.
const { recordReceivableStep } = require('../../../../new_web/src/services/receivableFlow.ts') as {
  recordReceivableStep: (...args: any[]) => Promise<any>;
};
const { persistConnectedWallet } = require('../../../../new_web/src/services/walletProfile.ts');

// Deterministic synthetic test keys, never loaded from a keystore or environment.
const a = S.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const b = S.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
const admin = S.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();
const vault = process.env.RECEIVABLE_VAULT_CONTRACT_ID!;
const set = { threshold: 2, signers: [a, b].map(k => ({ key: k.publicKey(), weight: 1 })) };
const sign = (xdr: string, key: S.Keypair) => { const tx = new S.Transaction(xdr, S.Networks.TESTNET); tx.sign(key); return tx.toXDR(); };

async function fixture() {
  const rec: any = { id: 'rec', fundId: 'fund', sacadoId: 'debtor', faceValue: 10,
    dueDate: new Date('2030-01-01'), paidValue: null, status: 'PENDING', chainStatus: 'NOT_REGISTERED',
    fund: { name: 'CSAGRI', symbol: 'CSAGRI', tokenContractId: vault, fundWalletPublicKey: a.publicKey() },
    cedente: { id: 'assignor', name: 'Assignor A' }, sacado: { name: 'Debtor B', publicKey: null } };
  const rows: any[] = [], logs: any[] = [], confirmed = new Map<string, any>();
  const registered = new Set(['fund']);
  let sequence = '10', built = 0, submitted = 0, fail = false, rpcFail = false, recStatus: number | null = null;
  const db: any = {
    receivable: { findUnique: async ({ where }: any) => where.id === rec.id ? rec : null, update: async ({ data }: any) => Object.assign(rec, data) },
    order: { findMany: async () => [{ shareHolder: a.publicKey() }] },
    decisionLog: { findFirst: async ({ where }: any) => logs.find(l => l.payload.includes(where.payload.contains)) },
    multisigTransaction: {
      findMany: async ({ where }: any) => rows.filter(r => r.purpose.startsWith(where.purpose.startsWith)).slice().reverse(),
      findUnique: async ({ where }: any) => rows.find(r => r.id === where.id),
      findFirst: async ({ where }: any) => rows.find(r => r.purpose === where.purpose && r.account === where.account && r.status === where.status && r.expiresAt > where.expiresAt.gt),
      create: async ({ data }: any) => { const row = { ...data, id: `pending${rows.length}`, status: 'PENDING', signedBy: [], createdAt: new Date() }; rows.push(row); return row; },
      update: async ({ where, data }: any) => Object.assign(rows.find(r => r.id === where.id), data),
    },
  };
  const horizon: any = { loadAccount: async () => ({ sequence }) };
  const app = Fastify(); app.decorate('prisma', db);
  app.addHook('onRequest', async req => { req.user = { id: 'manager', email: 'offline@example.invalid', role: 'GESTOR', scope: 'full' }; });
  await app.register(async child => receivableRoutes(child, {
    readContract: (async (_c: string, method: string, args: any[] = []) => {
      if (rpcFail) throw new Error('RPC unavailable');
      if (method === 'get_admin') return admin;
      if (method === 'get_receivable') { if (recStatus === null) throw new Error('Error(Contract, #5)'); return { status: recStatus }; }
      if (method === 'is_registered') return registered.has(S.scValToNative(args[0]));
      if (method === 'total_supply') return 100n;
      if (method === 'balance') return 90n; // protects holders/supply mismatch
      throw new Error(`Unexpected read ${method}`);
    }) as any,
    loadSignerSet: async () => set,
    getOrCreatePending: (prisma, purpose, account, build) => getOrCreatePending(prisma, purpose, account, build, horizon),
    prepareInvocation: async (source, c, method, args) => {
      built++;
      return new S.TransactionBuilder(new S.Account(source, sequence), { fee: '100', networkPassphrase: S.Networks.TESTNET })
        .addOperation(new S.Contract(c).call(method, ...args)).setTimeout(21600).build().toXDR();
    },
    getConfirmedCall: async hash => { if (!confirmed.has(hash)) throw new Error('Transaction failed or not found'); return confirmed.get(hash); },
    appendOnchainEvent: (async (data: any) => { logs.push({ seq: logs.length + 1, payload: JSON.stringify({ ...data, txHash: data.txHash.toLowerCase() }) }); return logs.at(-1); }) as any,
  }), { prefix: '/receivables' });
  await app.register(async child => multisigRoutes(child, {
    loadSignerSet: async () => set,
    submitSigned: async xdr => {
      submitted++;
      if (fail) return { ok: false, expired: false, reason: 'mock submission failure' };
      const tx = new S.Transaction(xdr, S.Networks.TESTNET);
      const call = (tx.operations[0] as S.Operation.InvokeHostFunction).func.invokeContract();
      const method = call.functionName().toString(), args = call.args().map(v => S.scValToNative(v));
      const hash = tx.hash().toString('hex');
      if (method === 'admin_register_entity') registered.add(String(args[0]));
      if (method === 'register_receivable') recStatus = 0;
      confirmed.set(hash, { kind: 'invoke', source: tx.source, contractId: vault, method, args });
      sequence = tx.sequence;
      return { ok: true, hash };
    },
  }), { prefix: '/multisig' });
  const request = async (method: 'GET' | 'POST', url: string, payload?: any) => {
    const r = await app.inject({ method, url, payload });
    if (r.statusCode >= 400) throw new Error(`${r.statusCode}: ${r.body}`);
    return r.json();
  };
  const api = {
    chain: (id: string, hash?: string, expectedStepId?: string) => request('POST', `/receivables/${id}/chain`, hash ? { txHash: hash } : { expectedStepId }),
    sign: (id: string, signedXdr: string) => request('POST', `/multisig/${id}/sign`, { signedXdr }),
    signAndSubmitTransaction: async () => { throw new Error('No direct submissions in tests'); },
  };
  return { app, rows, logs, api, rec, registered, confirmed, request,
    deps: (key: S.Keypair) => ({ ...api, signTransaction: async (xdr: string) => sign(xdr, key) }),
    counts: () => ({ built, submitted }), fail: (value: boolean) => { fail = value; },
    rpcFail: () => { rpcFail = true; }, setPaid: () => { rec.paidValue = 10; recStatus = 1; },
  };
}

test('distinct wallets complete one persisted assignor step; next debtor step requires another click', async t => {
  const f = await fixture(); t.after(() => f.app.close());
  const first = await recordReceivableStep('rec', a.publicKey(), f.deps(a));
  assert.equal(first.kind, 'waiting'); assert.equal(first.step.stepId, 'cedente');
  const id = f.rows[0].id, hash = f.rows[0].txHash;
  const progress = await f.request('GET', '/receivables/rec/chain'); // reload: no build
  assert.equal(progress.steps.find((s: any) => s.stepId === 'cedente').multisig.id, id);
  assert.equal(f.counts().built, 1);
  const repeat = await f.api.sign(id, sign(f.rows[0].xdr, a));
  assert.equal(repeat.weight, 1); assert.equal(repeat.signedBy.length, 1);
  const resumed = await f.api.chain('rec'); // same login, different wallet
  assert.equal(resumed.multisig.id, id); assert.equal(f.rows[0].txHash, hash);
  const second = await recordReceivableStep('rec', b.publicKey(), f.deps(b));
  assert.equal(second.kind, 'confirmed'); assert.equal(second.step.txHash, hash);
  assert.deepEqual(new Set(f.rows[0].signedBy), new Set([a.publicKey(), b.publicKey()]));
  assert.equal(f.rows[0].status, 'SUBMITTED'); assert.equal(f.logs.length, 1);
  assert.equal(f.rows.length, 1, 'no pending request for the next stage created');
  assert.equal(f.counts().submitted, 1);
  const after = await f.request('GET', '/receivables/rec/chain');
  assert.equal(after.chainStatus, 'NOT_REGISTERED');
  assert.equal(after.steps.find((s: any) => s.stepId === 'cedente').txHash, hash);
  assert.equal(after.steps.find((s: any) => s.stepId === 'sacado').state, 'NOT_STARTED');
  const debtor = await recordReceivableStep('rec', b.publicKey(), f.deps(b));
  assert.equal(debtor.step.stepId, 'sacado');
  assert.notEqual(debtor.step.multisig!.id, id); assert.equal(f.rows.length, 2);
  assert.notEqual(f.rows[1].purpose, f.rows[0].purpose);
});

test('submission failure keeps both signatures and never reports success; retry needs no new signature', async t => {
  const f = await fixture(); t.after(() => f.app.close());
  await recordReceivableStep('rec', a.publicKey(), f.deps(a));
  f.fail(true);
  await assert.rejects(recordReceivableStep('rec', b.publicKey(), f.deps(b)), /Submission failed/);
  assert.equal(f.rows[0].status, 'PENDING'); assert.equal(f.rows[0].signedBy.length, 2);
  assert.equal(f.logs.length, 0); assert.equal(f.rec.chainTxHash, undefined);
  f.fail(false);
  const deps = { ...f.deps(b), signTransaction: async () => { throw new Error('Must reuse collected signatures'); } };
  assert.equal((await recordReceivableStep('rec', b.publicKey(), deps)).kind, 'confirmed');
  assert.equal(f.rows.length, 1);
});

test('reload recovers a submitted but unverified hash before creating another pending request', async t => {
  const f = await fixture(); t.after(() => f.app.close());
  await recordReceivableStep('rec', a.publicKey(), f.deps(a));
  const res = await f.api.sign(f.rows[0].id, sign(f.rows[0].xdr, b));
  assert.equal(res.submitted, true); assert.equal(f.logs.length, 0);
  const recovery = await f.api.chain('rec');
  assert.equal(recovery.verificationRequired, true); assert.equal(recovery.txHash, res.txHash);
  const result = await recordReceivableStep('rec', b.publicKey(), f.deps(b));
  assert.equal(result.kind, 'confirmed'); assert.equal(f.rows.length, 1); assert.equal(f.logs.length, 1);
  await f.api.chain('rec', res.txHash); assert.equal(f.logs.length, 1, 'confirmation is log-idempotent');
});

test('wrong XDR, unknown hash, RPC outage, and holders/supply mismatch are refused', async t => {
  const f = await fixture(); t.after(() => f.app.close());
  await recordReceivableStep('rec', a.publicKey(), f.deps(a));
  const altered = new S.TransactionBuilder(new S.Account(admin, '10'), { fee: '100', networkPassphrase: S.Networks.TESTNET })
    .addOperation(new S.Contract(vault).call('admin_register_entity', S.nativeToScVal('sacado', { type: 'symbol' })))
    .setTimeout(21600).build(); altered.sign(b);
  await assert.rejects(f.api.sign(f.rows[0].id, altered.toXDR()), /not the pending one/);
  await assert.rejects(f.api.chain('rec', 'f'.repeat(64)), /verification failed/);
  f.confirmed.set('b'.repeat(64), { kind: 'invoke', source: a.publicKey(), contractId: vault, method: 'admin_register_entity', args: ['cedente', 'assignor', 'Assignor A'] });
  await assert.rejects(f.api.chain('rec', 'b'.repeat(64)), /Not one of this receivable/);
  f.setPaid(); await assert.rejects(f.api.chain('rec'), /Known shareholders/);
  f.rpcFail(); await assert.rejects(f.request('GET', '/receivables/rec/chain'), /RPC unavailable/);
  assert.equal(f.counts().submitted, 0); assert.equal(f.logs.length, 0);
});

test('HTTP 200 without explicit verification or a hash is not on-chain success', async () => {
  const base: any = { chain: async () => ({ done: false, verificationRequired: true, txHash: 'a'.repeat(64) }),
    sign: async () => { throw new Error('not expected'); }, signTransaction: async () => '', signAndSubmitTransaction: async () => '' };
  await assert.rejects(recordReceivableStep('rec', a.publicKey(), base), /not verified on-chain/);
  base.chain = async () => ({ done: false, verificationRequired: true });
  await assert.rejects(recordReceivableStep('rec', a.publicKey(), base), /no transaction hash/);
});

test('signature weight is distinct and submission service checks failures and uncertain responses', async () => {
  const raw = new S.TransactionBuilder(new S.Account(admin, '10'), { fee: '100', networkPassphrase: S.Networks.TESTNET })
    .addOperation(new S.Contract(vault).call('admin_register_fund')).setTimeout(21600).build().toXDR();
  const once = mergeSignatures(raw, sign(raw, a), set);
  const twice = mergeSignatures(once.xdr, sign(raw, a), set);
  assert.equal(twice.weight, 1); assert.equal(signedWeight(set, [a.publicKey(), a.publicKey()]), 1);
  const both = mergeSignatures(once.xdr, sign(raw, b), set); assert.equal(both.weight, 2);
  const wrongNetwork = new S.Transaction(raw, S.Networks.PUBLIC); wrongNetwork.sign(b);
  assert.throws(() => mergeSignatures(once.xdr, wrongNetwork.toXDR(), set), /check wallet and network/);
  const hash = new S.Transaction(both.xdr, S.Networks.TESTNET).hash().toString('hex');
  const bad: any = { submitTransaction: async () => ({ successful: false, hash }) };
  assert.equal((await submitSigned(both.xdr, bad)).ok, false);
  const uncertain: any = { submitTransaction: async () => { throw new Error('lost response'); },
    transactions: () => ({ transaction: () => ({ call: async () => ({ successful: true, hash }) }) }) };
  assert.deepEqual(await submitSigned(both.xdr, uncertain), { ok: true, hash });
});

test('switching operational manager wallets leaves the persisted profile binding unchanged', async () => {
  let bound = 'original-profile-wallet';
  const update = async (key: string) => { bound = key; };
  await persistConnectedWallet('GESTOR', true, a.publicKey(), update);
  await persistConnectedWallet('GESTOR', true, b.publicKey(), update);
  await persistConnectedWallet(undefined, true, b.publicKey(), update);
  assert.equal(bound, 'original-profile-wallet');
  await persistConnectedWallet('INVESTIDOR', true, a.publicKey(), update);
  assert.equal(bound, a.publicKey(), 'investor binding still works');
});

test('a changed stage between preview and click requires review before a wallet prompt', async t => {
  const f = await fixture(); t.after(() => f.app.close());
  f.registered.add('cedente');
  const result = await recordReceivableStep('rec', a.publicKey(), { ...f.deps(a), expectedStepId: 'cedente',
    signTransaction: async () => { throw new Error('Must not open another stage for signing'); } });
  assert.equal(result.kind, 'review'); assert.equal(result.step.stepId, 'sacado');
  assert.equal(f.rows.length, 0, 'do not even prepare a pending request for an unexpected stage');
  assert.equal(f.counts().submitted, 0);
});

test('confirmed step is reported independently; holders guard still blocks the next distribute', async t => {
  const f = await fixture(); t.after(() => f.app.close());
  f.setPaid();
  const hash = 'c'.repeat(64);
  f.confirmed.set(hash, { kind: 'invoke', contractId: vault, source: a.publicKey(), method: 'pay', args: ['rec', a.publicKey(), 100000000n] });
  const result = await f.api.chain('rec', hash);
  assert.equal(result.verified, true); assert.equal(result.stepId, 'pay');
  assert.equal(f.logs.length, 1);
  await assert.rejects(f.api.chain('rec'), /Known shareholders/);
  assert.equal(f.counts().built, 0); assert.equal(f.counts().submitted, 0);
});

test('receivable detail is read-only and can be loaded directly by id', async t => {
  const f = await fixture(); t.after(() => f.app.close());
  const result = await f.request('GET', '/receivables/rec');
  assert.equal(result.receivable.id, 'rec');
  assert.equal(result.receivable.faceValue, 10);
  await assert.rejects(f.request('GET', '/receivables/missing'), /404/);
  assert.equal(f.rows.length, 0); assert.equal(f.logs.length, 0);
  assert.deepEqual(f.counts(), { built: 0, submitted: 0 });
});
