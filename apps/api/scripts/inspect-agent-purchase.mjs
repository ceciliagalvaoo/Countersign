// Read-only comparison of a persisted agent session with its verified order.
// No calls to chat, execution, mint, approval, payment, or distribution endpoints.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import * as Sdk from '@stellar/stellar-sdk';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
if (!id || !/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw new Error('Pass a session id');
const session = JSON.parse(fs.readFileSync(path.join(root, '../agent/sessions', id + '.json'), 'utf8'));
const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
const url = process.env.DATABASE_URL || env.match(/^\s*DATABASE_URL\s*=\s*(.*)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '');
const engine = path.join(root, 'node_modules/.prisma/client/query_engine-windows-readonly.dll.node');
if (process.platform === 'win32' && fs.existsSync(engine)) process.env.PRISMA_QUERY_ENGINE_LIBRARY = engine;
const db = new PrismaClient({ datasourceUrl: url, log: [] });
try {
  const orders = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const rows = await tx.order.findMany({ where: { investorId: session.ownerUserId, payerAddress: { not: null } },
      select: { id: true, status: true, approvalStatus: true, decisionHash: true, txHash: true,
        tokenMintTxHash: true, payerAddress: true, shareHolder: true, quantity: true, total: true,
        fund: { select: { id: true, symbol: true, tokenContractId: true, fundWalletPublicKey: true } } },
      orderBy: { createdAt: 'desc' }, take: 20 });
    const result = [];
    for (const order of rows) {
      const hashes = [order.decisionHash, order.txHash, order.tokenMintTxHash].filter(Boolean);
      const logs = await tx.decisionLog.findMany({ where: { OR: hashes.flatMap(hash => [
        { hash }, { payload: { contains: `"txHash":"${hash.toLowerCase()}"` } },
      ]) }, select: { seq: true, hash: true, payload: true } });
      result.push({ ...order, log: logs.map(row => { const p = JSON.parse(row.payload);
        return { seq: row.seq, hash: row.hash, kind: p.kind, rule: p.rule, outcome: p.outcome, txHash: p.txHash }; }) });
    }
    return result;
  }, { timeout: 20000 });
  const rpc = new Sdk.rpc.Server('https://soroban-testnet.stellar.org');
  for (const order of orders) {
    order.network = {};
    for (const [kind, hash] of [['payment', order.txHash], ['mint', order.tokenMintTxHash]]) {
      if (!hash) continue;
      try {
        const result = await rpc.getTransaction(hash);
        order.network[kind] = { status: result.status };
        if (result.status === 'SUCCESS') {
          const tx = new Sdk.Transaction(result.envelopeXdr, Sdk.Networks.TESTNET);
          const call = tx.operations[0].func.invokeContract();
          order.network[kind] = { status: result.status, source: tx.source,
            contract: Sdk.Address.fromScAddress(call.contractAddress()).toString(),
            method: call.functionName().toString(), args: call.args().map(a => Sdk.scValToNative(a)) };
        }
      } catch { order.network[kind] = { status: 'UNAVAILABLE' }; }
    }
  }
  console.log(JSON.stringify({ session: { id: session.id, focus: session.plan.focus,
    nodes: session.plan.nodes.filter(n => ['agent_purchase', 'issuer_countersign', 'confirmed'].includes(n.id)),
    statusToolCalls: session.toolLog.filter(call => call.tool === 'get_status').length }, orders },
    (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
} catch (error) { console.error('Read-only inspection failed:', error.code || error.name); process.exitCode = 1; }
finally { await db.$disconnect(); }
