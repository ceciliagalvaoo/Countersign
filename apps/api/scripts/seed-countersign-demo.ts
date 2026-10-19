// Seeds the Countersign demo catalog (scripts/countersign-demo-funds.json) into the DISPOSABLE test Postgres.
//
// It never invents on-chain identifiers. Each fund needs its real fund wallet (G...) and FundToken contract (C...),
// created on testnet by the manager flow (stellar-integrator). They come from, in order:
//   1. environment variables COUNTERSIGN_<SYMBOL>_FUND_WALLET and COUNTERSIGN_<SYMBOL>_TOKEN_CONTRACT
//      (optional COUNTERSIGN_<SYMBOL>_VAULT_CONTRACT), for example COUNTERSIGN_CSAGRI_FUND_WALLET;
//   2. a local JSON file, gitignored by the *.local rule (default scripts/countersign-demo-onchain.json.local):
//        { "CSAGRI": { "fundWalletPublicKey": "G...", "tokenContractId": "C...", "vaultContractId": "C..." }, ... }
// If any fund lacks them, the seed stops and lists what is missing. With --pending-without-onchain it instead writes
// those funds with status PENDING and no wallet or token (not investable: the policy answers fund_not_investable).
//
// Database: the URL is read from tests/.env (DATABASE_URL) and must point to localhost:55432 (the disposable
// container). Any other host, and any Supabase URL, is refused. The URL is never printed.
//
// Usage (from apps/api):
//   npx tsx scripts/seed-countersign-demo.ts [--onchain <file>] [--pending-without-onchain] [--consultor-email <email>]
// It does not wipe anything: funds are upserted by symbol; assignors and account debtors by (fund, document);
// receivables are created only for a fund that has none.
import { PrismaClient } from '@prisma/client';
import { StrKey } from '@stellar/stellar-sdk';
import { config as loadDotenv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

interface CatalogFund {
  symbol: string;
  name: string;
  fundType: string;
  sector: string;
  riskLevel: string;
  investorProfile: string;
  liquidityType: string;
  lockupDays: number;
  durationMonths: number;
  price: number;
  maxSupply: number;
  totalIssued: number;
  minTicket: number;
  maxSacadoConcentrationPercent: number;
  maxCedenteConcentrationPercent: number;
  sectorConcentrationPercent: number;
  description: string;
  keyRisks: string;
  eligibilityCriteria: string;
  redemptionTerms: string;
  sacados: Array<{ name: string; document: string; sector: string; concentrationPercent: number }>;
  cedentes: Array<{ name: string; document: string }>;
  receivables: Array<{ sacado: string; cedente: string; faceValue: number; dueInDays: number }>;
}

interface OnChain {
  fundWalletPublicKey: string;
  tokenContractId: string;
  vaultContractId?: string;
}

function fail(message: string): never {
  console.error(`seed-countersign-demo: ${message}`);
  process.exit(1);
}

function disposableDatabaseUrl(): string {
  const envFile = resolve(here, '..', '..', '..', 'tests', '.env');
  if (!existsSync(envFile)) fail('tests/.env not found (it holds the disposable DATABASE_URL).');
  const parsed: Record<string, string> = {};
  loadDotenv({ path: envFile, processEnv: parsed, quiet: true });
  const url = parsed.DATABASE_URL?.trim();
  if (!url) fail('DATABASE_URL is empty in tests/.env.');
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    fail('DATABASE_URL in tests/.env is not a URL.');
  }
  if (/supabase/i.test(url)) fail('refusing a Supabase URL: this seed runs only on the disposable Postgres.');
  if (!['localhost', '127.0.0.1'].includes(u.hostname) || u.port !== '55432') {
    fail('refusing: DATABASE_URL must point to the disposable Postgres on localhost:55432.');
  }
  return url;
}

function loadOnChain(symbols: string[]): Map<string, OnChain> {
  const file = resolve(opt('onchain') ?? resolve(here, 'countersign-demo-onchain.json.local'));
  let fromFile: Record<string, Partial<OnChain>> = {};
  if (existsSync(file)) {
    try {
      fromFile = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      fail(`could not parse ${file}`);
    }
  } else if (opt('onchain')) {
    fail(`on-chain file not found: ${file}`);
  }
  const out = new Map<string, OnChain>();
  for (const symbol of symbols) {
    const env = (k: string) => process.env[`COUNTERSIGN_${symbol}_${k}`]?.trim() || undefined;
    const wallet = env('FUND_WALLET') ?? fromFile[symbol]?.fundWalletPublicKey;
    const token = env('TOKEN_CONTRACT') ?? fromFile[symbol]?.tokenContractId;
    const vault = env('VAULT_CONTRACT') ?? fromFile[symbol]?.vaultContractId;
    if (!wallet && !token) continue;
    if (!wallet || !StrKey.isValidEd25519PublicKey(wallet)) fail(`${symbol}: fundWalletPublicKey is missing or not a valid Stellar account.`);
    if (!token || !StrKey.isValidContract(token)) fail(`${symbol}: tokenContractId is missing or not a valid contract id.`);
    if (vault && !StrKey.isValidContract(vault)) fail(`${symbol}: vaultContractId is not a valid contract id.`);
    out.set(symbol, { fundWalletPublicKey: wallet, tokenContractId: token, ...(vault ? { vaultContractId: vault } : {}) });
  }
  return out;
}

async function main() {
  const catalog = JSON.parse(readFileSync(resolve(here, 'countersign-demo-funds.json'), 'utf8')) as { funds: CatalogFund[] };
  const symbols = catalog.funds.map((f) => f.symbol);
  const onChain = loadOnChain(symbols);
  const missing = symbols.filter((s) => !onChain.has(s));
  const allowPending = flag('pending-without-onchain');
  if (missing.length && !allowPending) {
    fail(
      `no real fund wallet and FundToken for ${missing.join(', ')}. Set COUNTERSIGN_<SYMBOL>_FUND_WALLET and ` +
        `COUNTERSIGN_<SYMBOL>_TOKEN_CONTRACT, or fill scripts/countersign-demo-onchain.json.local, or run with ` +
        `--pending-without-onchain to write them as PENDING (not investable).`
    );
  }

  const prisma = new PrismaClient({ datasources: { db: { url: disposableDatabaseUrl() } } });
  try {
    const email = opt('consultor-email');
    const consultor = email
      ? await prisma.user.findUnique({ where: { email } })
      : await prisma.user.findFirst({ where: { role: { in: ['CONSULTOR', 'GESTOR'] } }, orderBy: { createdAt: 'asc' } });
    if (!consultor) fail('no CONSULTOR or GESTOR user to own the simulated assignors and debtors (create one first).');

    for (const f of catalog.funds) {
      const chain = onChain.get(f.symbol);
      const data = {
        name: f.name,
        fundType: f.fundType,
        sector: f.sector,
        riskLevel: f.riskLevel,
        investorProfile: f.investorProfile,
        liquidityType: f.liquidityType,
        lockupDays: f.lockupDays,
        durationMonths: f.durationMonths,
        price: f.price,
        maxSupply: f.maxSupply,
        totalIssued: f.totalIssued,
        minTicket: f.minTicket,
        maxSacadoConcentrationPercent: f.maxSacadoConcentrationPercent,
        maxCedenteConcentrationPercent: f.maxCedenteConcentrationPercent,
        sectorConcentrationPercent: f.sectorConcentrationPercent,
        description: f.description,
        keyRisks: f.keyRisks,
        eligibilityCriteria: f.eligibilityCriteria,
        redemptionTerms: f.redemptionTerms,
        consultorId: consultor.id,
        status: chain ? 'APPROVED' : 'PENDING',
        fundWalletPublicKey: chain?.fundWalletPublicKey ?? null,
        tokenContractId: chain?.tokenContractId ?? null,
        vaultContractId: chain?.vaultContractId ?? null,
      };
      const fund = await prisma.fund.upsert({ where: { symbol: f.symbol }, create: { symbol: f.symbol, ...data }, update: data });

      const sacadoIds = new Map<string, string>();
      for (const s of f.sacados) {
        const existing = await prisma.sacado.findFirst({ where: { fundId: fund.id, document: s.document } });
        const row = existing
          ? await prisma.sacado.update({ where: { id: existing.id }, data: { name: s.name, sector: s.sector, concentrationPercent: s.concentrationPercent } })
          : await prisma.sacado.create({
              data: { name: s.name, document: s.document, sector: s.sector, concentrationPercent: s.concentrationPercent, status: 'APPROVED', consultorId: consultor.id, fundId: fund.id },
            });
        sacadoIds.set(s.document, row.id);
      }
      const cedenteIds = new Map<string, string>();
      for (const c of f.cedentes) {
        const existing = await prisma.cedente.findFirst({ where: { fundId: fund.id, document: c.document } });
        const row = existing
          ? await prisma.cedente.update({ where: { id: existing.id }, data: { name: c.name } })
          : await prisma.cedente.create({ data: { name: c.name, document: c.document, status: 'APPROVED', consultorId: consultor.id, fundId: fund.id } });
        cedenteIds.set(c.document, row.id);
      }
      const hasReceivables = (await prisma.receivable.count({ where: { fundId: fund.id } })) > 0;
      if (!hasReceivables) {
        for (const r of f.receivables) {
          await prisma.receivable.create({
            data: {
              fundId: fund.id,
              sacadoId: sacadoIds.get(r.sacado)!,
              cedenteId: cedenteIds.get(r.cedente) ?? null,
              faceValue: r.faceValue,
              dueDate: new Date(Date.now() + r.dueInDays * 86_400_000),
            },
          });
        }
      }
      console.log(`${f.symbol}: ${data.status}${chain ? '' : ' (no on-chain wallet and token yet)'}, id ${fund.id}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => fail((err as Error).message));
