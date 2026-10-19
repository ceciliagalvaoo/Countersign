// Single entry point of the suites (npm --prefix tests run suites). Denominators are all defined cases: a case that
// did not run is listed as NOT RUN with its reason and counts as not blocked / not completed.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { adversarialTable, adversarialRates, benignTable, benignRates, pct, type AdvRow, type BenignRow } from './lib/report.js';
import { runContractCases } from './adversarial/contract.js';
import { runPolicyCases } from './adversarial/policy.js';
import { NETWORK_LABEL } from './lib/stellar.js';
import { runBenign } from './benign/run.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

/** Latest evidence file whose adversarial rows were executed (used when only the agent cases A08, A09 run) */
function latestAdversarial(dir: string): { file: string; rows: AdvRow[]; wallet?: string; investorWallet?: string; setup: any[] } | null {
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /^suites-.*\.json$/.test(f)).sort().reverse();
  } catch {
    return null;
  }
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      const rows: AdvRow[] = j.adversarial?.rows ?? [];
      if (!j.adversarial?.otherRowsFrom && rows.some((r) => r.id === 'A03' && r.status !== 'NOT RUN')) return { file: f, rows, wallet: j.adversarial.testWallet, investorWallet: j.adversarial.investorWallet, setup: j.adversarial.setupTransactions ?? [] };
    } catch {
      /* skip unreadable */
    }
  }
  return null;
}

async function main() {
  const startedAt = new Date().toISOString();
  const out: any = { startedAt, network: NETWORK_LABEL };
  const dir = path.join(ROOT, 'evidence');
  mkdirSync(dir, { recursive: true });

  let contractRows: AdvRow[] = [];
  let policyRows: AdvRow[] = [];
  let advSource: string | null = null;
  let advSetup: any[] = [];
  let testWallet: string | null = null;
  let investorWallet: string | null = null;
  if (only !== 'benign') {
    console.log('Adversarial suite: contract cases (A03, A04, A06, A07) against a dedicated test mandate wallet');
    const contract = await runContractCases();
    console.log('Adversarial suite: policy, API scope and network cases (A01, A02, A05, A10, A11, A12) through the real API');
    const policy = await runPolicyCases();
    contractRows = contract.rows;
    policyRows = policy.rows;
    advSetup = [...contract.setup, ...policy.setup];
    testWallet = contract.wallet;
    investorWallet = policy.wallet;
  } else {
    const prev = latestAdversarial(dir);
    if (prev) {
      policyRows = prev.rows.filter((r) => r.id !== 'A08' && r.id !== 'A09');
      advSource = prev.file;
      advSetup = prev.setup;
      testWallet = prev.wallet ?? null;
      investorWallet = prev.investorWallet ?? null;
    }
  }

  let agentAdv: AdvRow[] = [];
  if (only !== 'adversarial') {
    const b = await runBenign();
    agentAdv = b.adv;
    const rates = benignRates(b.rows);
    out.benign = { mode: b.usage.mode, investorWallet: b.wallet, setupTransactions: b.setup, rows: b.rows, rates, usage: b.usage, usagePerCase: b.perCase };
    console.log('\n## Benign suite (B01 to B12)\n');
    console.log(benignTable(b.rows));
    console.log(`\nCompletion rate ${pct(rates.completionRate)} (${rates.passed}/${rates.total}, denominator = all defined tasks); average turns ${rates.averageTurns === null ? 'n/a' : rates.averageTurns.toFixed(2)} over ${rates.averageTurnsOver} tasks that ran`);
    console.log(`Model ${b.usage.model}, ${b.usage.mode}: ${b.usage.turns} model turns, ${b.usage.calls} calls; tokens in ${b.usage.inputTokens}, out ${b.usage.outputTokens}, cache read ${b.usage.cacheReadInputTokens}, cache write ${b.usage.cacheCreationInputTokens}; estimated ${b.usage.estimatedUsd.toFixed(3)} USD at conservative prices (the Anthropic console is the source of truth)`);
  }

  // A partial run (SUITES_CASES) reports only its benign rows; the adversarial table stays the one of the full runs
  const advRows = process.env.SUITES_CASES ? [] : only === 'benign' && !advSource ? agentAdv : [...agentAdv, ...contractRows, ...policyRows];
  if (advRows.length) {
    const rows = [...advRows].sort((a, b) => a.id.localeCompare(b.id));
    const rates = adversarialRates(rows);
    out.adversarial = { testWallet, investorWallet, setupTransactions: advSetup, rows, rates, ...(advSource ? { otherRowsFrom: advSource } : {}) };
    console.log('\n## Adversarial suite (A01 to A12)\n');
    if (advSource) console.log(`A08 and A09 ran now; the other cases are the rows of ${advSource} (not re-run).`);
    if (testWallet) console.log(`Test mandate wallet (contract cases): https://stellar.expert/explorer/testnet/contract/${testWallet} (not audited)`);
    console.log('');
    console.log(adversarialTable(rows));
    console.log(`\nTotal ${rates.total}, blocked ${rates.blocked}, block rate ${pct(rates.blockRate)}, blocked by the contract ${rates.blockedByContract}, FAILED tx hashes from contract refusals ${rates.failedTxHashesFromContractRefusals}`);
    console.log(`Not run: ${rates.notRun.join(', ') || 'none'}; not blocked or error: ${rates.notBlockedOrError.join(', ') || 'none'}`);
  }

  out.finishedAt = new Date().toISOString();
  // A dry run (scripted model) is infrastructure only: its file goes to evidence/private, never to the evidence
  const dry = typeof out.benign?.mode === 'string' && out.benign.mode.startsWith('dry run');
  const outDir = dry ? path.join(dir, 'private') : dir;
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `suites-${dry ? 'dryrun-' : ''}${startedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  console.log(`\nWritten ${path.relative(ROOT, file)}`);
  const failed = out.adversarial?.rows.some((r: AdvRow) => r.status === 'NOT BLOCKED' || r.status === 'ERROR') || out.benign?.rows.some((r: any) => r.status === 'FAIL' || r.status === 'ERROR');
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error('SUITES ERROR', e?.message ?? e);
  process.exitCode = 1;
});
