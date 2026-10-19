// A03, A04, A06, A07: contract layer cases of the adversarial suite (contracts/mandate-wallet on Stellar testnet).
// Negative tests of our own contract: a dedicated mandate wallet is deployed per run with disposable accounts
// (random keypairs funded by friendbot) and test USDC with no value. The agent key is a test identity that
// simulates a compromised server that leaked the agent key: every case calls the contract directly, never the API.
// Each refusal records the simulation result and, with the technique of spike S2 (variant B), a FAILED tx hash.
// The decision values are test hashes of a labelled string, not policy log rows: these cases bypass the policy
// by design, so they have no log line.
import {
  Sdk, toAddr, toI128, toU64, toBytes32, usdc, fmtUsdc, expert, friendbot, faucetUsdc, ensureTrustline, invoke,
  deployFromHash, read, usdcBalance, simulateCall, simulationError, submitRefusedCall, submitAsAgent, readFailure,
  walletFundKey, walletDecisionKey, TEST_USDC, PASSPHRASE, type Submitted,
} from '../lib/stellar.js';
import type { AdvRow, TxRef } from '../lib/report.js';

const ERR = { DecisionUsed: 4, FundNotAllowed: 5, OverTxCap: 6 } as const;
const PER_TX_CAP = usdc('1');
const PERIOD_CAP = usdc('3');
const FUND_CAP = usdc('2');
const DEPOSIT = usdc('2');
const AMOUNT = usdc('0.5');

const LOG_LINE = 'n/a: direct contract call that bypasses the policy by design (test decision hash, no log row)';
const COMPROMISED = 'agent key held by the suite, simulating a compromised server that leaked the agent key';

const decisionHex = (runId: string, label: string) => Sdk.hash(Buffer.from(`countersign-suite:${runId}:${label}`)).toString('hex');

interface Ctx {
  runId: string;
  owner: Sdk.Keypair;
  agent: Sdk.Keypair;
  fund: Sdk.Keypair;
  outsider: string;
  wallet: string;
  setup: TxRef[];
}

const ref = (label: string, s: Submitted, note?: string): TxRef => ({ label, hash: s.hash, status: s.status, link: expert(s.hash), note });

async function walletState(c: Ctx) {
  const [limits, fund, outsiderFund, spent, balance] = await Promise.all([
    read(c.wallet, 'limits'),
    read(c.wallet, 'fund', [toAddr(c.fund.publicKey())]),
    read(c.wallet, 'fund', [toAddr(c.outsider)]),
    read(c.wallet, 'spent_in_period'),
    usdcBalance(c.wallet),
  ]);
  return JSON.stringify({ limits, fund, outsiderFund, spent, balance: balance.toString() }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

async function setup(): Promise<Ctx> {
  const wasmHash = process.env.MANDATE_WALLET_WASM_HASH;
  if (!wasmHash || !/^[0-9a-f]{64}$/.test(wasmHash)) throw new Error('MANDATE_WALLET_WASM_HASH missing (read by run.sh from apps/api/.env)');
  const runId = new Date().toISOString();
  const owner = Sdk.Keypair.random();
  const agent = Sdk.Keypair.random();
  const fund = Sdk.Keypair.random();
  const outsider = Sdk.Keypair.random().publicKey();
  console.log('  setup: funding disposable accounts with friendbot');
  for (const kp of [owner, agent, fund]) if (!(await friendbot(kp.publicKey()))) throw new Error('friendbot refused');
  console.log('  setup: test USDC for the owner (Blend testnet faucet), trustline for the fund wallet');
  await faucetUsdc(owner);
  await ensureTrustline(fund, TEST_USDC);
  const usdcId = TEST_USDC.contractId(PASSPHRASE);
  const setupRefs: TxRef[] = [];
  const dep = await deployFromHash(
    owner,
    wasmHash,
    [toAddr(owner.publicKey()), toAddr(agent.publicKey()), toAddr(usdcId), toI128(PER_TX_CAP), toI128(PERIOD_CAP), toU64(86400n), toBytes32(decisionHex(runId, 'mandate'))],
    'suite deploy mandate-wallet'
  );
  const wallet = dep.id;
  setupRefs.push(ref('setup: owner deploys the test mandate wallet', dep));
  console.log(`  setup: test wallet ${wallet}`);
  // The fund token address is stored by allow_fund and never called by subscribe; the test USDC SAC stands in for it
  setupRefs.push(ref('setup: owner allow_fund(fund wallet, cap 2 USDC)', await invoke(owner, wallet, 'allow_fund', [toAddr(fund.publicKey()), toAddr(usdcId), toI128(FUND_CAP)], 'suite allow_fund')));
  setupRefs.push(ref('setup: owner deposits 2 test USDC', await invoke(owner, usdcId, 'transfer', [toAddr(owner.publicKey()), toAddr(wallet), toI128(DEPOSIT)], 'suite deposit')));
  return { runId, owner, agent, fund, outsider, wallet, setup: setupRefs };
}

/** One refused subscribe: simulation, then the FAILED transaction (S2 variant B), then a state check */
async function refusedSubscribe(c: Ctx, o: { case: string; refusedArgs: any[]; equivalentArgs: any[]; extraReadOnly: any[]; expectCode: number }) {
  const before = await walletState(c);
  const { sim } = await simulateCall(c.agent.publicKey(), c.wallet, 'subscribe', o.refusedArgs);
  const simErr = simulationError(sim);
  let tx: Submitted | null = null;
  let txErr: string | null = null;
  try {
    tx = await submitRefusedCall({ kp: c.agent, contractId: c.wallet, method: 'subscribe', equivalentArgs: o.equivalentArgs, refusedArgs: o.refusedArgs, extraReadOnly: o.extraReadOnly, label: `${o.case} refused subscribe` });
  } catch (e) {
    txErr = (e as Error).message;
  }
  const after = await walletState(c);
  const reading = tx && tx.status === 'FAILED' ? readFailure(tx.res) : null;
  const expected = `Error(Contract, #${o.expectCode})`;
  const simOk = simErr === expected;
  const txOk = !!reading && reading.contractCode === o.expectCode && reading.diagnosticContract === c.wallet && reading.finalError === expected;
  const unchanged = before === after;
  return { simErr, simOk, tx, txErr, reading, txOk, unchanged, expected, succeeded: tx?.status === 'SUCCESS' };
}

function rowFromSubscribe(base: Pick<AdvRow, 'id' | 'family' | 'vector' | 'expected'>, r: Awaited<ReturnType<typeof refusedSubscribe>>, extraHashes: TxRef[] = []): AdvRow {
  const hashes = [...extraHashes];
  if (r.tx) hashes.push(ref(`${base.id}: refused subscribe submitted by the agent key`, r.tx, r.reading ? `consensus: ${r.reading.consensus}, fee ${r.reading.feeChargedStroops} stroops; RPC diagnostic events: ${r.reading.diagnosticError} from ${r.reading.diagnosticContract}` : undefined));
  const blocked = !r.succeeded && r.unchanged && (r.simOk || r.txOk);
  const proof = [r.simOk ? 'simulation' : null, r.txOk ? 'failed tx hash' : null].filter(Boolean).join(' + ') || 'none';
  const obtained = [
    `simulation: ${r.simErr ?? 'passed'}`,
    r.tx ? `submitted: ${r.tx.status}${r.reading ? ` (${r.reading.consensus}; diagnostic ${r.reading.diagnosticError})` : ''}` : `submitted: no ledger answer (${r.txErr})`,
    `wallet state ${r.unchanged ? 'unchanged' : 'CHANGED'}`,
  ].join('; ');
  return {
    ...base,
    obtained,
    layer: blocked ? 'contract' : null,
    ruleOrError: `${r.expected}, read from the simulation and from the RPC diagnostic events of the FAILED tx (diagnostics are not consensus; the hash, txFAILED and fee are)`,
    logLine: LOG_LINE,
    proof,
    hashes,
    status: blocked ? 'BLOCKED' : 'NOT BLOCKED',
    details: { simulationError: r.simErr, failure: r.reading, submitError: r.txErr, stateUnchanged: r.unchanged, keyHolder: COMPROMISED },
  };
}

async function a03(c: Ctx): Promise<AdvRow> {
  const d = decisionHex(c.runId, 'A03');
  const eq = decisionHex(c.runId, 'A03-equivalent');
  const r = await refusedSubscribe(c, {
    case: 'A03',
    refusedArgs: [toBytes32(d), toAddr(c.outsider), toI128(AMOUNT)],
    equivalentArgs: [toBytes32(eq), toAddr(c.fund.publicKey()), toI128(AMOUNT)],
    extraReadOnly: [walletFundKey(c.wallet, c.outsider), walletDecisionKey(c.wallet, d)],
    expectCode: ERR.FundNotAllowed,
  });
  const outsiderBalance = await usdcBalance(c.outsider);
  const row = rowFromSubscribe(
    { id: 'A03', family: 'Induced transfer (bypass)', vector: `subscribe signed only by the agent key, ${fmtUsdc(AMOUNT)} USDC to a G... address outside the allowlist`, expected: 'contract refuses: Error(Contract, #5) FundNotAllowed' },
    r
  );
  if (outsiderBalance !== 0n) row.status = 'NOT BLOCKED';
  return row;
}

async function a04(c: Ctx): Promise<AdvRow> {
  const d = decisionHex(c.runId, 'A04');
  const eq = decisionHex(c.runId, 'A04-equivalent');
  const over = PER_TX_CAP + usdc('0.5');
  const r = await refusedSubscribe(c, {
    case: 'A04',
    refusedArgs: [toBytes32(d), toAddr(c.fund.publicKey()), toI128(over)],
    equivalentArgs: [toBytes32(eq), toAddr(c.fund.publicKey()), toI128(AMOUNT)],
    extraReadOnly: [walletDecisionKey(c.wallet, d)],
    expectCode: ERR.OverTxCap,
  });
  return rowFromSubscribe(
    { id: 'A04', family: 'Induced transfer (bypass)', vector: `subscribe signed only by the agent key, ${fmtUsdc(over)} USDC to the allowlisted fund, per_tx_cap ${fmtUsdc(PER_TX_CAP)}`, expected: 'contract refuses: Error(Contract, #6) OverTxCap' },
    r
  );
}

async function a06(c: Ctx): Promise<AdvRow> {
  const before = await walletState(c);
  const big = usdc('1000000');
  const attempts = [
    { method: 'set_limits', args: [toI128(big), toI128(big), toU64(86400n), toBytes32(decisionHex(c.runId, 'A06-mandate'))] },
    { method: 'allow_fund', args: [toAddr(c.outsider), toAddr(TEST_USDC.contractId(PASSPHRASE)), toI128(big)] },
  ];
  const hashes: TxRef[] = [];
  const parts: string[] = [];
  const details: any[] = [];
  let allFailed = true;
  for (const a of attempts) {
    for (const mode of ['none', 'forged'] as const) {
      const label = `A06 agent ${a.method} (${mode === 'none' ? 'no owner authorization' : 'owner authorization signed with the agent key'})`;
      try {
        const out = await submitAsAgent({ kp: c.agent, contractId: c.wallet, method: a.method, args: a.args, mode, label });
        if (!out.submitted) {
          parts.push(`${a.method}/${mode}: simulation error ${out.simulation.detail}, not submitted`);
          allFailed = false;
          details.push({ method: a.method, mode, simulation: out.simulation });
          continue;
        }
        const s = out.submitted;
        const reading = s.status === 'FAILED' ? readFailure(s.res) : null;
        // The refusal must be an auth failure, not some other trap
        if (s.status !== 'FAILED' || !reading?.finalError?.startsWith('Error(Auth')) allFailed = false;
        const why = reading ? `${reading.finalError} ("${reading.hostMessage}")` : '';
        hashes.push(ref(label, s, reading ? `consensus: ${reading.consensus}, fee ${reading.feeChargedStroops} stroops; RPC diagnostic events: host function failed with ${why}` : 'SUCCEEDED: owner function accepted the agent key'));
        parts.push(`${a.method}/${mode}: simulation passed (recording mode), submitted ${s.status}${reading ? ` ${reading.consensus}, diagnostic ${why}` : ''}`);
        details.push({ method: a.method, mode, simulation: out.simulation, failure: reading });
      } catch (e) {
        // Rejected before any ledger (for example txMalformed or a bad auth signature at admission): blocked, no hash
        const msg = (e as Error).message;
        parts.push(`${a.method}/${mode}: rejected before the ledger, no hash (${msg.slice(0, 160)})`);
        details.push({ method: a.method, mode, submitError: msg });
      }
    }
  }
  const after = await walletState(c);
  const unchanged = before === after;
  const blocked = allFailed && unchanged;
  parts.push(`limits and allowlist ${unchanged ? 'unchanged' : 'CHANGED'}`);
  return {
    id: 'A06',
    family: 'Privilege escalation',
    vector: 'agent key alone calling set_limits (caps to 1,000,000 USDC) and allow_fund (outsider address), each without owner authorization and with the owner entry signed by the agent key',
    expected: 'contract refuses: owner authorization missing (owner.require_auth)',
    obtained: parts.join('; '),
    layer: blocked ? 'contract' : null,
    ruleOrError: 'owner.require_auth() in require_owner: Error(Auth, InvalidAction), read from the host_fn_failed diagnostic event of each FAILED tx (diagnostics are not consensus; the hash, txFAILED and fee are)',
    logLine: LOG_LINE,
    proof: hashes.length ? 'failed tx hash (the simulation passes in recording mode, so it proves nothing here)' : 'rejected at submission, no hash',
    hashes,
    status: blocked ? 'BLOCKED' : 'NOT BLOCKED',
    details: { attempts: details, stateUnchanged: unchanged, keyHolder: COMPROMISED },
  };
}

async function a07(c: Ctx): Promise<AdvRow> {
  const d = decisionHex(c.runId, 'A07');
  const first = await invoke(c.agent, c.wallet, 'subscribe', [toBytes32(d), toAddr(c.fund.publicKey()), toI128(AMOUNT)], 'A07 first subscribe');
  const firstRef = ref('A07 setup: first subscribe with this decision (accepted)', first, 'setup of the case, not product evidence');
  const eq = decisionHex(c.runId, 'A07-equivalent');
  const r = await refusedSubscribe(c, {
    case: 'A07',
    refusedArgs: [toBytes32(d), toAddr(c.fund.publicKey()), toI128(AMOUNT)],
    equivalentArgs: [toBytes32(eq), toAddr(c.fund.publicKey()), toI128(AMOUNT)],
    extraReadOnly: [walletDecisionKey(c.wallet, d)],
    expectCode: ERR.DecisionUsed,
  });
  const row = rowFromSubscribe(
    { id: 'A07', family: 'Privilege escalation', vector: 'subscribe signed by the agent key reusing a decision already used by an accepted subscribe', expected: 'contract refuses: Error(Contract, #4) DecisionUsed (emitted by the wallet, not FundToken NotWhitelisted)' },
    r,
    [firstRef]
  );
  return row;
}

const CASES: Array<Pick<AdvRow, 'id' | 'family' | 'vector' | 'expected'> & { run: (c: Ctx) => Promise<AdvRow> }> = [
  { id: 'A03', family: 'Induced transfer (bypass)', vector: 'subscribe called directly with the agent key, to an address outside the allowlist', expected: 'contract refuses: Error(Contract, #5) FundNotAllowed', run: a03 },
  { id: 'A04', family: 'Induced transfer (bypass)', vector: 'subscribe called directly above per_tx_cap', expected: 'contract refuses: Error(Contract, #6) OverTxCap', run: a04 },
  { id: 'A06', family: 'Privilege escalation', vector: 'agent key alone calling set_limits and allow_fund', expected: 'contract refuses: owner authorization missing', run: a06 },
  { id: 'A07', family: 'Privilege escalation', vector: 'subscribe reusing a decision already used', expected: 'contract refuses: Error(Contract, #4) DecisionUsed', run: a07 },
];

export async function runContractCases(): Promise<{ rows: AdvRow[]; setup: TxRef[]; wallet: string | null }> {
  let c: Ctx;
  try {
    c = await setup();
  } catch (e) {
    const reason = `setup of the test wallet failed: ${(e as Error).message}`;
    return { rows: CASES.map(({ run: _r, ...b }) => ({ ...b, obtained: '', layer: null, ruleOrError: 'n/a', logLine: 'n/a', proof: 'none', hashes: [], status: 'NOT RUN', notRunReason: reason })), setup: [], wallet: null };
  }
  const rows: AdvRow[] = [];
  for (const k of CASES) {
    console.log(`  ${k.id}: running`);
    try {
      const row = await k.run(c);
      console.log(`  ${k.id}: ${row.status}`);
      rows.push(row);
    } catch (e) {
      const { run: _r, ...b } = k;
      rows.push({ ...b, obtained: `error: ${(e as Error).message}`, layer: null, ruleOrError: 'n/a', logLine: 'n/a', proof: 'none', hashes: [], status: 'ERROR' });
      console.log(`  ${k.id}: ERROR ${(e as Error).message}`);
    }
  }
  return { rows, setup: c.setup, wallet: c.wallet };
}
