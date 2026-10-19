// Read-only investigation; no API /chain calls, builds, signatures, or submissions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import * as Sdk from '@stellar/stellar-sdk';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
if (!id || !/^[a-z0-9]+$/.test(id)) throw new Error('Pass the receivable id');
const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
const setting = name => process.env[name] || env.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`, 'm'))?.[1].trim().replace(/^['"]|['"]$/g, '');
const winEngine = path.join(root, 'node_modules/.prisma/client/query_engine-windows-readonly.dll.node');
if (process.platform === 'win32' && fs.existsSync(winEngine)) process.env.PRISMA_QUERY_ENGINE_LIBRARY = winEngine;
const db = new PrismaClient({ datasourceUrl: setting('DATABASE_URL'), log: [] });
try {
  const snapshot = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const receivable = await tx.receivable.findUnique({ where: { id }, select: {
      id: true, fundId: true, cedenteId: true, sacadoId: true, faceValue: true, paidValue: true,
      status: true, chainStatus: true, chainTxHash: true,
      fund: { select: { name: true, symbol: true } },
      cedente: { select: { name: true } }, sacado: { select: { name: true } },
    } });
    const transactions = await tx.multisigTransaction.findMany({ where: { purpose: { startsWith: `receivable:${id}:` } }, orderBy: { createdAt: 'asc' } });
    return { receivable, transactions };
  }, { timeout: 20000 });
  const rpc = new Sdk.rpc.Server('https://soroban-testnet.stellar.org');
  const transactions = [];
  for (const row of snapshot.transactions) {
    const tx = new Sdk.Transaction(row.xdr, Sdk.Networks.TESTNET);
    const call = tx.operations[0].func.invokeContract();
    let networkStatus = 'UNAVAILABLE';
    try { networkStatus = (await rpc.getTransaction(row.txHash)).status; } catch { /* unverified */ }
    const logged = await db.decisionLog.findFirst({ where: { payload: { contains: `"txHash":"${row.txHash.toLowerCase()}"` } }, select: { seq: true } });
    transactions.push({ id: row.id, purpose: row.purpose, status: row.status, txHash: row.txHash,
      signedBy: row.signedBy, expiresAt: row.expiresAt, method: call.functionName().toString(),
      args: call.args().map(a => Sdk.scValToNative(a)), networkStatus, decisionLogSeq: logged?.seq ?? null });
  }
  console.log(JSON.stringify({ receivable: snapshot.receivable, transactions }, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
} catch (e) {
  console.error('Read-only inspection failed:', e.code || e.name); process.exitCode = 1;
} finally { await db.$disconnect(); }
