/**
 * Mandate wallet integration (stellar-integrator, build lines 1.4, 1.5, 1.7, 1.8).
 *
 * Same funnel as the rest of the platform: the API builds and simulates (prepareInvocation / prepareDeploy), the right
 * wallet signs (the investor for owner calls, the agent signer for subscribe), and the API decodes the CONFIRMED
 * transaction (getConfirmedCall) and checks contract, method, source and arguments BEFORE writing to the database.
 * Every verified confirmation is recorded with appendOnchainEvent (policy-guard), so no hash lacks a log row.
 *
 * Honest boundary: what the wallet contract enforces (allowlist, caps, decision reuse, revocation) is enforced by
 * our wallet contract on Stellar, not audited. Everything in this file runs on our server.
 */
import * as Sdk from '@stellar/stellar-sdk';
import type { PrismaClient, Order } from '@prisma/client';
import { STELLAR_CONFIG } from '../config/stellar.js';
import {
  assetContractId,
  EXPLORER_TX_BASE,
  getConfirmedCall,
  NETWORK_LABEL,
  NETWORK_PASSPHRASE,
  prepareDeploy,
  prepareInvocation,
  readContract,
  rpcServer,
  toAddressVal,
  toI128Val,
  toShareUnits,
} from './soroban.js';
import { isContractAddress, isPublicKey, toStellarAmount } from './stellarVerify.js';
import { createAgentKey, getAgentPublicKey, signSubscription } from '../agentSigner/index.js';
import { appendOnchainEvent, getEntry, type OnchainAction } from '../policy/decisionLog.js';

// ---------------------------------------------------------------------------------------------------------------
// Configuration and binding
// ---------------------------------------------------------------------------------------------------------------

export const MANDATE_WALLET_WASM_HASH = (process.env.MANDATE_WALLET_WASM_HASH || '').toLowerCase();
/** subscribe is short lived: an approved purchase is not valid for hours (multisig uses 6 h, this uses 300 s) */
export const SUBSCRIBE_TIMEOUT_SECONDS = 300;
const ZERO_HASH_HEX = '0'.repeat(64);

/** USDC Stellar Asset Contract on this network (same asset as the platform's order payments) */
export const usdcSacId = () => assetContractId(STELLAR_CONFIG.PAYMENT_ASSET);
export const explorerTx = (hash: string) => `${EXPLORER_TX_BASE}${hash}`;

let prismaRef: PrismaClient | null = null;
export function bindMandateWallet(prisma: PrismaClient) {
  prismaRef = prisma;
}
function db(prisma?: PrismaClient): PrismaClient {
  const p = prisma ?? prismaRef;
  if (!p) throw new Error('mandate wallet service is not bound to a database (call bindMandateWallet)');
  return p;
}

/** Kept for compatibility with the placeholder (policy-guard imported it); nothing throws it anymore */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`NOT IMPLEMENTED: ${what}`);
    this.name = 'NotImplementedError';
  }
}

/** A request that cannot be served as asked (bad input, missing setup); carries an HTTP status */
export class MandateWalletError extends Error {
  constructor(message: string, public readonly status = 400, public readonly details?: unknown) {
    super(message);
    this.name = 'MandateWalletError';
  }
}

/**
 * The network refused the purchase: the contract returned an error (simulation or a FAILED transaction), or the
 * network rejected the envelope. Nothing is written to the database for it and it is never retried automatically.
 * `txHash` is set only when a FAILED transaction exists in the ledger.
 */
export class ContractRefusedError extends Error {
  constructor(
    message: string,
    public readonly refusal: {
      stage: 'simulation' | 'submission' | 'ledger' | 'expired';
      code: number | null;
      errorName: string | null;
      contract: string | null;
      txHash: string | null;
      txUrl: string | null;
    }
  ) {
    super(message);
    this.name = 'ContractRefusedError';
  }
}

/**
 * The RPC could not be reached. Never a confirmation: if a signed envelope may have been sent, the reservation order
 * stays PENDING (txHash given) so PATCH /orders/:id/complete can verify it later; otherwise nothing was written.
 */
export class RpcUnavailableError extends Error {
  constructor(message: string, public readonly txHash: string | null, public readonly orderId: string | null) {
    super(message);
    this.name = 'RpcUnavailableError';
  }
}

const NETWORK_ERROR_RE = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|timeout|fetch failed|50[234]/i;

/** Error codes of contracts/mandate-wallet (public interface, never renumbered) */
export const WALLET_ERRORS: Record<number, string> = {
  1: 'InvalidConfig',
  2: 'InvalidAmount',
  3: 'AgentRevoked',
  4: 'DecisionUsed',
  5: 'FundNotAllowed',
  6: 'OverTxCap',
  7: 'OverPeriodCap',
  8: 'OverFundCap',
  9: 'Math',
};

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

const nativeKey = (v: unknown) =>
  JSON.stringify(v, (_k, x) =>
    typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? Buffer.from(x).toString('hex') : x?.type === 'Buffer' ? Buffer.from(x.data).toString('hex') : x
  );

/** Integer units (7 decimals) to a fixed 7 decimal string: 125000000n -> "12.5000000" */
export function formatUnits(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  return `${neg ? '-' : ''}${abs / 10_000_000n}.${(abs % 10_000_000n).toString().padStart(7, '0')}`;
}

/** USDC decimal (at most 7 decimals) to integer units, exact */
export function usdcToUnits(value: string | number): bigint {
  const text = typeof value === 'number' ? String(value) : value.trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,7})?$/.test(text)) throw new MandateWalletError('Amount must be a positive decimal with at most 7 decimals');
  const [whole, frac = ''] = text.split('.');
  return BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, '0'));
}

const hexOf = (v: unknown): string => {
  if (v instanceof Uint8Array) return Buffer.from(v).toString('hex');
  if (typeof v === 'string') return v.toLowerCase();
  throw new Error('expected bytes');
};

const hex32 = (hex: string) => {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new MandateWalletError('Expected 32 bytes as 64 hex characters');
  return Sdk.xdr.ScVal.scvBytes(Buffer.from(hex, 'hex'));
};
const u64Val = (n: number | bigint) => Sdk.nativeToScVal(BigInt(n), { type: 'u64' });

async function logEvent(params: Parameters<typeof appendOnchainEvent>[0], prisma?: PrismaClient) {
  return appendOnchainEvent(params, db(prisma));
}

/** Testnet only: the agent account pays the fees of subscribe, so it must exist with XLM (friendbot) */
async function ensureAccountExists(publicKey: string): Promise<boolean> {
  try {
    await rpcServer.getAccount(publicKey);
    return true;
  } catch {
    if (STELLAR_CONFIG.NETWORK !== 'testnet') return false;
    try {
      const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Wallet lookups
// ---------------------------------------------------------------------------------------------------------------

export async function getMandateWallet(userId: string, prisma?: PrismaClient) {
  return db(prisma).mandateWallet.findUnique({ where: { userId } });
}

/** Mandate wallet contract (C...) registered for this investor after a verified deploy, or null */
export async function getMandateWalletContractId(userId: string): Promise<string | null> {
  const row = await db().mandateWallet.findUnique({ where: { userId }, select: { contractId: true } });
  return row?.contractId ?? null;
}

async function requireWallet(userId: string, prisma?: PrismaClient) {
  const wallet = await getMandateWallet(userId, prisma);
  if (!wallet) throw new MandateWalletError('You have no mandate wallet yet', 404);
  return wallet;
}

// ---------------------------------------------------------------------------------------------------------------
// Decoder for the WYSIWYS card (line 1.7): the card shows what is in the XDR, nothing else
// ---------------------------------------------------------------------------------------------------------------

type ArgKind = 'address' | 'usdc' | 'units' | 'seconds' | 'bytes32' | 'bool' | 'any';
interface ArgSpec {
  name: string;
  kind: ArgKind;
}
const A = (name: string, kind: ArgKind): ArgSpec => ({ name, kind });

const WALLET_METHODS: Record<string, ArgSpec[]> = {
  __constructor: [
    A('owner', 'address'),
    A('agent', 'address'),
    A('usdc', 'address'),
    A('per_tx_cap', 'usdc'),
    A('period_cap', 'usdc'),
    A('period_secs', 'seconds'),
    A('mandate_hash', 'bytes32'),
  ],
  set_limits: [A('per_tx_cap', 'usdc'), A('period_cap', 'usdc'), A('period_secs', 'seconds'), A('mandate_hash', 'bytes32')],
  allow_fund: [A('fund_wallet', 'address'), A('fund_token', 'address'), A('fund_cap', 'usdc')],
  disallow_fund: [A('fund_wallet', 'address')],
  revoke_agent: [],
  set_agent: [A('agent', 'address')],
  withdraw: [A('amount', 'usdc')],
  withdraw_units: [A('fund_token', 'address'), A('amount', 'units')],
  subscribe: [A('decision', 'bytes32'), A('fund_wallet', 'address'), A('amount', 'usdc')],
};
const SAC_METHODS: Record<string, ArgSpec[]> = {
  transfer: [A('from', 'address'), A('to', 'address'), A('amount', 'usdc')],
};
const FUND_TOKEN_METHODS: Record<string, ArgSpec[]> = {
  whitelist_add: [A('address', 'address')],
  whitelist_remove: [A('address', 'address')],
  mint: [A('to', 'address'), A('amount', 'units')],
  set_pause: [A('paused', 'bool')],
};

export interface DecodedArg {
  name: string;
  type: string; // Soroban type of the value in the XDR (address, i128, u64, bytes, bool, ...)
  value: string; // exact value from the XDR (address, integer, hex)
  display: string; // human readable rendering of the same value
  label?: string; // what the address is, when we know it ("your mandate wallet", "fund wallet of X")
}

export interface DecodedAuthEntry {
  credentials: 'source_account' | 'address';
  address?: string;
  label?: string;
  expirationLedger?: number;
  invocations: { depth: number; contract: string | null; contractLabel?: string; function: string }[];
}

export interface DecodedTransaction {
  network: string; // added out of band: the XDR does not contain the network
  networkSource: 'out_of_band';
  txHash: string; // hash of the envelope under this network passphrase (unchanged by signing)
  source: { address: string; label?: string };
  sequence: string;
  operation: 'invoke_contract' | 'create_contract';
  contract: { address: string | null; label?: string; wasmHash?: string };
  function: string;
  args: DecodedArg[];
  fee: { totalStroops: string; resourceFeeStroops: string | null; totalXlm: string };
  timeBounds: { minTime: string | null; maxTime: string | null };
  memo: { type: string; value: string | null };
  authEntries: DecodedAuthEntry[];
  signatures: number;
}

type Labeler = (address: string) => string | undefined;

/** Labels for addresses the investor or manager can recognise, built from the database (never from the client) */
async function buildLabeler(userId: string | null, prisma: PrismaClient): Promise<{ label: Labeler; walletId: string | null; fundTokens: Set<string> }> {
  const labels = new Map<string, string>();
  const sac = usdcSacId();
  labels.set(sac, 'USDC (Stellar Asset Contract)');
  let walletId: string | null = null;
  if (userId) {
    const wallet = await prisma.mandateWallet.findUnique({ where: { userId } });
    if (wallet) {
      walletId = wallet.contractId;
      labels.set(wallet.contractId, 'your mandate wallet');
      labels.set(wallet.ownerAddress, 'your wallet (owner)');
    }
    const agent = await prisma.agentKey.findUnique({ where: { userId }, select: { publicKey: true } });
    if (agent) labels.set(agent.publicKey, 'your agent key');
  }
  const funds = await prisma.fund.findMany({
    where: { OR: [{ fundWalletPublicKey: { not: null } }, { tokenContractId: { not: null } }] },
    select: { name: true, fundWalletPublicKey: true, tokenContractId: true },
  });
  const fundTokens = new Set<string>();
  for (const f of funds) {
    if (f.fundWalletPublicKey && !labels.has(f.fundWalletPublicKey)) labels.set(f.fundWalletPublicKey, `fund wallet of ${f.name}`);
    if (f.tokenContractId) {
      fundTokens.add(f.tokenContractId);
      if (!labels.has(f.tokenContractId)) labels.set(f.tokenContractId, `unit token of ${f.name}`);
    }
  }
  return { label: (a) => labels.get(a), walletId, fundTokens };
}

function scTypeName(v: Sdk.xdr.ScVal): string {
  return v.switch().name.replace(/^scv/, '').toLowerCase();
}

function decodeArg(v: Sdk.xdr.ScVal, spec: ArgSpec, label: Labeler): DecodedArg {
  const type = scTypeName(v);
  const base = { name: spec.name, type };
  try {
    switch (v.switch().name) {
      case 'scvAddress': {
        const address = Sdk.Address.fromScVal(v).toString();
        const l = label(address);
        return { ...base, value: address, display: l ? `${l} (${address})` : address, ...(l ? { label: l } : {}) };
      }
      case 'scvI128':
      case 'scvU128':
      case 'scvI64':
      case 'scvU64':
      case 'scvU32':
      case 'scvI32': {
        const n = BigInt(Sdk.scValToNative(v) as bigint | number);
        if (spec.kind === 'usdc') return { ...base, value: n.toString(), display: `${formatUnits(n)} USDC` };
        if (spec.kind === 'units') return { ...base, value: n.toString(), display: `${formatUnits(n)} fund units` };
        if (spec.kind === 'seconds') {
          const days = Number(n) / 86_400;
          const d = Number.isInteger(days) ? String(days) : days.toFixed(4);
          return { ...base, value: n.toString(), display: `${d} days (${n} seconds)` };
        }
        return { ...base, value: n.toString(), display: n.toString() };
      }
      case 'scvBytes': {
        const hex = v.bytes().toString('hex');
        const short = hex.length > 16 ? `${hex.slice(0, 8)}...${hex.slice(-8)}` : hex;
        return { ...base, value: hex, display: `${short} (${v.bytes().length} bytes)` };
      }
      case 'scvBool':
        return { ...base, value: String(v.b()), display: v.b() ? 'true' : 'false' };
      default: {
        const native = nativeKey(Sdk.scValToNative(v));
        return { ...base, value: native, display: native };
      }
    }
  } catch {
    const raw = v.toXDR('base64');
    return { ...base, value: raw, display: `undecodable ${type} value` };
  }
}

function specsFor(contract: string | null, method: string, walletId: string | null, fundTokens: Set<string>, isDeploy: boolean, wasmHash?: string): ArgSpec[] | null {
  if (isDeploy) return wasmHash === MANDATE_WALLET_WASM_HASH ? WALLET_METHODS.__constructor : null;
  if (!contract) return null;
  if (walletId && contract === walletId) return WALLET_METHODS[method] ?? null;
  if (contract === usdcSacId()) return SAC_METHODS[method] ?? null;
  if (fundTokens.has(contract)) return FUND_TOKEN_METHODS[method] ?? null;
  return null;
}

function flattenInvocation(inv: Sdk.xdr.SorobanAuthorizedInvocation, label: Labeler, depth = 0, out: DecodedAuthEntry['invocations'] = []) {
  const fn = inv.function();
  if (fn.switch().name === 'sorobanAuthorizedFunctionTypeContractFn') {
    const c = fn.contractFn();
    const contract = Sdk.Address.fromScAddress(c.contractAddress()).toString();
    const l = label(contract);
    out.push({ depth, contract, ...(l ? { contractLabel: l } : {}), function: c.functionName().toString() });
  } else {
    out.push({ depth, contract: null, function: 'create_contract' });
  }
  for (const sub of inv.subInvocations()) flattenInvocation(sub, label, depth + 1, out);
  return out;
}

/**
 * Decodes an envelope that must hold exactly one invokeHostFunction operation (contract call or contract deploy).
 * The network label is appended out of band: no field of the XDR names the network.
 */
export async function decodeInvocation(xdrB64: string, opts: { userId?: string | null; prisma?: PrismaClient } = {}): Promise<DecodedTransaction> {
  const prisma = db(opts.prisma);
  let parsed: Sdk.Transaction | Sdk.FeeBumpTransaction;
  try {
    parsed = Sdk.TransactionBuilder.fromXDR(xdrB64, NETWORK_PASSPHRASE);
  } catch {
    throw new MandateWalletError('Not a transaction envelope');
  }
  if (parsed instanceof Sdk.FeeBumpTransaction) throw new MandateWalletError('Fee bump envelopes are not decoded');
  const tx = parsed;
  if (tx.operations.length !== 1 || tx.operations[0].type !== 'invokeHostFunction') {
    throw new MandateWalletError('Expected exactly one invokeHostFunction operation');
  }
  const op = tx.operations[0] as Sdk.Operation.InvokeHostFunction;
  const { label, walletId, fundTokens } = await buildLabeler(opts.userId ?? null, prisma);

  let operation: DecodedTransaction['operation'];
  let contract: DecodedTransaction['contract'];
  let fnName: string;
  let rawArgs: Sdk.xdr.ScVal[];
  let specs: ArgSpec[] | null;
  const func = op.func;
  switch (func.switch().name) {
    case 'hostFunctionTypeInvokeContract': {
      const call = func.invokeContract();
      const address = Sdk.Address.fromScAddress(call.contractAddress()).toString();
      const l = label(address);
      operation = 'invoke_contract';
      contract = { address, ...(l ? { label: l } : {}) };
      fnName = call.functionName().toString();
      rawArgs = call.args();
      specs = specsFor(address, fnName, walletId, fundTokens, false);
      break;
    }
    case 'hostFunctionTypeCreateContractV2':
    case 'hostFunctionTypeCreateContract': {
      const v2 = func.switch().name === 'hostFunctionTypeCreateContractV2';
      const create = v2 ? func.createContractV2() : func.createContract();
      const exec = create.executable();
      const wasmHash = exec.switch().name === 'contractExecutableWasm' ? exec.wasmHash().toString('hex') : undefined;
      operation = 'create_contract';
      contract = {
        address: null,
        label: wasmHash === MANDATE_WALLET_WASM_HASH ? 'new mandate wallet (Countersign wallet contract, not audited)' : 'new contract',
        ...(wasmHash ? { wasmHash } : {}),
      };
      fnName = '__constructor';
      rawArgs = v2 ? func.createContractV2().constructorArgs() : [];
      specs = specsFor(null, fnName, walletId, fundTokens, true, wasmHash);
      break;
    }
    default:
      throw new MandateWalletError('Unsupported host function');
  }

  const args = rawArgs.map((v, i) => decodeArg(v, specs?.[i] ?? A(`arg${i}`, 'any'), label));

  const authEntries: DecodedAuthEntry[] = (op.auth ?? []).map((entry) => {
    const creds = entry.credentials();
    const invocations = flattenInvocation(entry.rootInvocation(), label);
    if (creds.switch().name === 'sorobanCredentialsAddress') {
      const a = creds.address();
      const address = Sdk.Address.fromScAddress(a.address()).toString();
      const l = label(address);
      return { credentials: 'address' as const, address, ...(l ? { label: l } : {}), expirationLedger: a.signatureExpirationLedger(), invocations };
    }
    return { credentials: 'source_account' as const, invocations };
  });

  let resourceFee: string | null = null;
  try {
    const ext = tx.toEnvelope().v1().tx().ext();
    if (ext.switch() === 1) resourceFee = ext.sorobanData().resourceFee().toString();
  } catch {
    resourceFee = null;
  }
  const tb = tx.timeBounds;
  const iso = (secs?: string) => (secs && secs !== '0' ? new Date(Number(secs) * 1000).toISOString() : null);
  const sourceLabel = label(tx.source);
  const memo = tx.memo;

  return {
    network: NETWORK_LABEL,
    networkSource: 'out_of_band',
    txHash: tx.hash().toString('hex'),
    source: { address: tx.source, ...(sourceLabel ? { label: sourceLabel } : {}) },
    sequence: tx.sequence,
    operation,
    contract,
    function: fnName,
    args,
    fee: { totalStroops: tx.fee, resourceFeeStroops: resourceFee, totalXlm: formatUnits(BigInt(tx.fee)) },
    timeBounds: { minTime: iso(tb?.minTime), maxTime: iso(tb?.maxTime) },
    memo: { type: memo.type, value: memo.value === null || memo.value === undefined ? null : Buffer.isBuffer(memo.value) ? memo.value.toString('hex') : String(memo.value) },
    authEntries,
    signatures: tx.signatures.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// S0: deploy (signed by the investor, who is the owner)
// ---------------------------------------------------------------------------------------------------------------

export interface WalletLimits {
  perTxCapUnits: bigint;
  periodCapUnits: bigint;
  periodSecs: number;
  mandateHashHex: string;
}

/** Initial limits: the approved mandate when there is one, else the limits the investor typed (hash all zero) */
async function initialLimits(
  userId: string,
  body: { perTxCapUsdc?: string; periodCapUsdc?: string; periodDays?: number } | undefined,
  prisma: PrismaClient
): Promise<{ limits: WalletLimits; source: 'approved_mandate' | 'investor_input' }> {
  const approved = await prisma.mandate.findFirst({ where: { userId, status: 'APPROVED' }, orderBy: { version: 'desc' } });
  if (approved?.hash) {
    const { mandateFromCanonicalJson, setLimitsArgs } = await import('../policy/mandate.js');
    const a = setLimitsArgs(mandateFromCanonicalJson(approved.json), approved.hash);
    return {
      limits: { perTxCapUnits: BigInt(a.perTxCapUnits), periodCapUnits: BigInt(a.periodCapUnits), periodSecs: a.periodSecs, mandateHashHex: a.mandateHashHex },
      source: 'approved_mandate',
    };
  }
  if (!body?.perTxCapUsdc || !body.periodCapUsdc || !body.periodDays) {
    throw new MandateWalletError('No approved mandate: send the initial limits (perTxCapUsdc, periodCapUsdc, periodDays)');
  }
  if (!Number.isInteger(body.periodDays) || body.periodDays < 1 || body.periodDays > 366) throw new MandateWalletError('periodDays must be 1 to 366');
  return {
    limits: {
      perTxCapUnits: usdcToUnits(body.perTxCapUsdc),
      periodCapUnits: usdcToUnits(body.periodCapUsdc),
      periodSecs: body.periodDays * 86_400,
      mandateHashHex: ZERO_HASH_HEX,
    },
    source: 'investor_input',
  };
}

export async function buildDeploy(
  userId: string,
  ownerG: string,
  limitsInput?: { perTxCapUsdc?: string; periodCapUsdc?: string; periodDays?: number },
  prisma?: PrismaClient
) {
  const p = db(prisma);
  if (!isPublicKey(ownerG)) throw new MandateWalletError('Owner must be a Stellar account address (G...)');
  if (!MANDATE_WALLET_WASM_HASH) throw new MandateWalletError('MANDATE_WALLET_WASM_HASH is not configured on the server', 500);
  if (await getMandateWallet(userId, p)) throw new MandateWalletError('You already have a mandate wallet', 409);

  const { limits, source } = await initialLimits(userId, limitsInput, p);
  if (limits.perTxCapUnits <= 0n || limits.periodCapUnits < limits.perTxCapUnits) {
    throw new MandateWalletError('Limits must satisfy 0 < per purchase cap <= period cap');
  }
  // The agent key is generated and kept by the agent signer (policy-guard); only its public key comes back
  const agent = await createAgentKey(userId, { prisma: p });
  if (agent.publicKey === ownerG) throw new MandateWalletError('The agent key cannot be the owner', 500);
  const agentFunded = agent.funded || (await ensureAccountExists(agent.publicKey));

  const transactionXdr = await prepareDeploy(ownerG, MANDATE_WALLET_WASM_HASH, [
    toAddressVal(ownerG),
    toAddressVal(agent.publicKey),
    toAddressVal(usdcSacId()),
    toI128Val(limits.perTxCapUnits),
    toI128Val(limits.periodCapUnits),
    u64Val(limits.periodSecs),
    hex32(limits.mandateHashHex),
  ]);
  const decoded = await decodeInvocation(transactionXdr, { userId, prisma: p });
  return {
    transactionXdr,
    decoded,
    signer: ownerG,
    agentPublicKey: agent.publicKey,
    agentAccountFunded: agentFunded,
    limitsSource: source,
    network: NETWORK_LABEL,
  };
}

export async function confirmDeploy(userId: string, txHash: string, prisma?: PrismaClient) {
  const p = db(prisma);
  if (await getMandateWallet(userId, p)) throw new MandateWalletError('You already have a mandate wallet', 409);
  const reused = await p.mandateWallet.findUnique({ where: { deployTxHash: txHash.toLowerCase() } });
  if (reused) throw new MandateWalletError('Transaction already used', 409);

  let call;
  try {
    call = await getConfirmedCall(txHash);
  } catch (e) {
    throw new MandateWalletError(`Deploy verification failed: ${(e as Error).message}`);
  }
  const agentG = await getAgentPublicKey(userId, p);
  const args = call.args ?? [];
  const ok =
    call.kind === 'deploy' &&
    call.wasmHash === MANDATE_WALLET_WASM_HASH &&
    !!call.contractId &&
    isContractAddress(call.contractId) &&
    isPublicKey(call.source) &&
    args.length === 7 &&
    args[0] === call.source && // owner = the account that signed and paid the deploy
    !!agentG &&
    args[1] === agentG && // agent = this investor's agent key
    args[2] === usdcSacId(); // the real USDC SAC, not a token of the owner's choosing
  if (!ok) throw new MandateWalletError('Transaction is not a mandate wallet deploy by you with your agent key and USDC');

  // Read the new contract back (state, not just the envelope)
  const contractId = call.contractId!;
  const [owner, agent, limits, mandateHash] = await Promise.all([
    readContract<string>(contractId, 'owner'),
    readContract<string>(contractId, 'agent'),
    readContract<{ per_tx_cap: bigint; period_cap: bigint; period_secs: bigint }>(contractId, 'limits'),
    readContract<unknown>(contractId, 'mandate_hash'),
  ]);
  const hashHex = hexOf(mandateHash);
  const stateOk =
    owner === call.source &&
    agent === agentG &&
    String(limits.per_tx_cap) === String(args[3]) &&
    String(limits.period_cap) === String(args[4]) &&
    String(limits.period_secs) === String(args[5]) &&
    hashHex === hexOf(args[6]);
  if (!stateOk) throw new MandateWalletError('Deployed wallet state does not match the deploy transaction');

  const row = await p.mandateWallet.create({
    data: {
      userId,
      contractId,
      ownerAddress: owner,
      agentPublicKey: agent,
      usdcContractId: usdcSacId(),
      deployTxHash: txHash.toLowerCase(),
    },
  });
  const log = await logEvent({ userId, action: 'deploy_wallet', txHash, mandateHash: hashHex === ZERO_HASH_HEX ? null : hashHex }, p);
  return {
    wallet: row,
    limits: { perTxCapUnits: String(limits.per_tx_cap), periodCapUnits: String(limits.period_cap), periodSecs: String(limits.period_secs) },
    mandateHash: hashHex,
    txHash: txHash.toLowerCase(),
    txUrl: explorerTx(txHash.toLowerCase()),
    network: NETWORK_LABEL,
    logSeq: log.seq,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Owner calls (Red tier): every destination and token comes from the database, never from the client
// ---------------------------------------------------------------------------------------------------------------

export const OWNER_METHODS = ['set_limits', 'allow_fund', 'disallow_fund', 'revoke_agent', 'set_agent', 'withdraw', 'withdraw_units'] as const;
export type OwnerMethod = (typeof OWNER_METHODS)[number];

export interface OwnerCallParams {
  fundId?: string;
  fundCapUsdc?: string;
  amountUsdc?: string;
  units?: string;
}

/** Builds the exact argument list of an owner call from the database and the investor's explicit inputs */
async function ownerCallArgs(userId: string, method: OwnerMethod, params: OwnerCallParams, p: PrismaClient) {
  const fundFromDb = async () => {
    if (!params.fundId) throw new MandateWalletError('fundId is required');
    const fund = await p.fund.findUnique({
      where: { id: params.fundId },
      select: { id: true, name: true, status: true, fundWalletPublicKey: true, tokenContractId: true },
    });
    if (!fund) throw new MandateWalletError('Fund not found', 404);
    if (!fund.fundWalletPublicKey || !fund.tokenContractId) throw new MandateWalletError('Fund has no wallet or unit token yet');
    return fund;
  };
  switch (method) {
    case 'set_limits': {
      const approved = await p.mandate.findFirst({ where: { userId, status: 'APPROVED' }, orderBy: { version: 'desc' } });
      if (!approved?.hash) throw new MandateWalletError('Approve the mandate first: set_limits anchors the approved mandate');
      const { mandateFromCanonicalJson, setLimitsArgs } = await import('../policy/mandate.js');
      const a = setLimitsArgs(mandateFromCanonicalJson(approved.json), approved.hash);
      return {
        args: [toI128Val(BigInt(a.perTxCapUnits)), toI128Val(BigInt(a.periodCapUnits)), u64Val(a.periodSecs), hex32(a.mandateHashHex)],
        fundId: null as string | null,
        amountUnits: undefined as string | undefined,
        mandateHash: a.mandateHashHex as string | null,
      };
    }
    case 'allow_fund': {
      const fund = await fundFromDb();
      if (fund.status !== 'APPROVED') throw new MandateWalletError('Fund is not approved');
      if (!params.fundCapUsdc) throw new MandateWalletError('fundCapUsdc is required: the most this wallet may ever pay to this fund');
      const cap = usdcToUnits(params.fundCapUsdc);
      if (cap <= 0n) throw new MandateWalletError('fundCapUsdc must be greater than zero');
      return {
        args: [toAddressVal(fund.fundWalletPublicKey!), toAddressVal(fund.tokenContractId!), toI128Val(cap)],
        fundId: fund.id,
        amountUnits: cap.toString(),
        mandateHash: null,
      };
    }
    case 'disallow_fund': {
      const fund = await fundFromDb();
      return { args: [toAddressVal(fund.fundWalletPublicKey!)], fundId: fund.id, amountUnits: undefined, mandateHash: null };
    }
    case 'revoke_agent':
      return { args: [], fundId: null, amountUnits: undefined, mandateHash: null };
    case 'set_agent': {
      // Re-enables (or rotates to) the agent key the signer holds for this investor; never a key from the client
      const agent = await getAgentPublicKey(userId, p);
      if (!agent) throw new MandateWalletError('No agent key for this investor', 409);
      return { args: [toAddressVal(agent)], fundId: null, amountUnits: undefined, mandateHash: null };
    }
    case 'withdraw': {
      if (!params.amountUsdc) throw new MandateWalletError('amountUsdc is required');
      const units = usdcToUnits(params.amountUsdc);
      if (units <= 0n) throw new MandateWalletError('amountUsdc must be greater than zero');
      return { args: [toI128Val(units)], fundId: null, amountUnits: units.toString(), mandateHash: null };
    }
    case 'withdraw_units': {
      const fund = await fundFromDb();
      if (!params.units) throw new MandateWalletError('units is required');
      const units = usdcToUnits(params.units);
      if (units <= 0n) throw new MandateWalletError('units must be greater than zero');
      return { args: [toAddressVal(fund.tokenContractId!), toI128Val(units)], fundId: fund.id, amountUnits: units.toString(), mandateHash: null };
    }
  }
}

export async function buildOwnerCall(userId: string, method: OwnerMethod, params: OwnerCallParams = {}, prisma?: PrismaClient) {
  const p = db(prisma);
  if (!(OWNER_METHODS as readonly string[]).includes(method)) throw new MandateWalletError('Unsupported wallet call');
  const wallet = await requireWallet(userId, p);
  const { args } = await ownerCallArgs(userId, method, params, p);
  const transactionXdr = await prepareInvocation(wallet.ownerAddress, wallet.contractId, method, args);
  const decoded = await decodeInvocation(transactionXdr, { userId, prisma: p });
  return { transactionXdr, decoded, signer: wallet.ownerAddress, network: NETWORK_LABEL };
}

export async function confirmOwnerCall(userId: string, txHash: string, method: OwnerMethod, params: OwnerCallParams = {}, prisma?: PrismaClient) {
  const p = db(prisma);
  if (!(OWNER_METHODS as readonly string[]).includes(method)) throw new MandateWalletError('Unsupported wallet call');
  const wallet = await requireWallet(userId, p);
  const expected = await ownerCallArgs(userId, method, params, p);
  let call;
  try {
    call = await getConfirmedCall(txHash);
  } catch (e) {
    throw new MandateWalletError(`Wallet call verification failed: ${(e as Error).message}`);
  }
  const ok =
    call.kind === 'invoke' &&
    call.contractId === wallet.contractId &&
    call.method === method &&
    call.source === wallet.ownerAddress &&
    nativeKey(call.args) === nativeKey(expected.args.map((a) => Sdk.scValToNative(a)));
  if (!ok) throw new MandateWalletError(`Transaction is not ${method} on your mandate wallet signed by you with the expected arguments`);
  const log = await logEvent(
    {
      userId,
      action: method as OnchainAction,
      txHash,
      fundId: expected.fundId,
      ...(expected.amountUnits ? { amountUnits: expected.amountUnits } : {}),
      mandateHash: expected.mandateHash,
    },
    p
  );
  return { verified: true, method, txHash: txHash.toLowerCase(), txUrl: explorerTx(txHash.toLowerCase()), network: NETWORK_LABEL, logSeq: log.seq };
}

// ---------------------------------------------------------------------------------------------------------------
// Deposit: USDC from the owner (G) to the wallet (C) through the SAC. No memo: the destination is the contract
// ---------------------------------------------------------------------------------------------------------------

export async function buildDeposit(userId: string, amountUsdc: string, prisma?: PrismaClient) {
  const p = db(prisma);
  const wallet = await requireWallet(userId, p);
  const units = usdcToUnits(amountUsdc);
  if (units <= 0n) throw new MandateWalletError('amountUsdc must be greater than zero');
  const transactionXdr = await prepareInvocation(wallet.ownerAddress, usdcSacId(), 'transfer', [
    toAddressVal(wallet.ownerAddress),
    toAddressVal(wallet.contractId),
    toI128Val(units),
  ]);
  const decoded = await decodeInvocation(transactionXdr, { userId, prisma: p });
  return { transactionXdr, decoded, signer: wallet.ownerAddress, network: NETWORK_LABEL };
}

export async function confirmDeposit(userId: string, txHash: string, amountUsdc: string, prisma?: PrismaClient) {
  const p = db(prisma);
  const wallet = await requireWallet(userId, p);
  const units = usdcToUnits(amountUsdc);
  let call;
  try {
    call = await getConfirmedCall(txHash);
  } catch (e) {
    throw new MandateWalletError(`Deposit verification failed: ${(e as Error).message}`);
  }
  const ok =
    call.kind === 'invoke' &&
    call.contractId === usdcSacId() &&
    call.method === 'transfer' &&
    call.source === wallet.ownerAddress &&
    call.args?.[0] === wallet.ownerAddress &&
    call.args?.[1] === wallet.contractId &&
    String(call.args?.[2]) === units.toString();
  if (!ok) throw new MandateWalletError('Transaction is not a USDC transfer from you to your mandate wallet of that amount');
  const log = await logEvent({ userId, action: 'deposit', txHash, amountUnits: units.toString() }, p);
  return { verified: true, txHash: txHash.toLowerCase(), txUrl: explorerTx(txHash.toLowerCase()), network: NETWORK_LABEL, logSeq: log.seq };
}

// ---------------------------------------------------------------------------------------------------------------
// State read from the chain (GET /api/mandate-wallet)
// ---------------------------------------------------------------------------------------------------------------

export async function readWalletState(userId: string, prisma?: PrismaClient) {
  const p = db(prisma);
  const wallet = await getMandateWallet(userId, p);
  if (!wallet) return { network: NETWORK_LABEL, wallet: null };
  const c = wallet.contractId;
  const [owner, agent, revoked, limits, mandateHash, spent, usdcBalance] = await Promise.all([
    readContract<string>(c, 'owner'),
    readContract<string>(c, 'agent'),
    readContract<boolean>(c, 'is_revoked'),
    readContract<{ per_tx_cap: bigint; period_cap: bigint; period_secs: bigint }>(c, 'limits'),
    readContract<unknown>(c, 'mandate_hash'),
    readContract<bigint>(c, 'spent_in_period'),
    readContract<bigint>(wallet.usdcContractId, 'balance', [toAddressVal(c)]),
  ]);
  const funds = await p.fund.findMany({
    where: { fundWalletPublicKey: { not: null }, tokenContractId: { not: null } },
    select: { id: true, name: true, symbol: true, fundWalletPublicKey: true, tokenContractId: true },
  });
  const fundStates = await Promise.all(
    funds.map(async (f) => {
      try {
        const entry = await readContract<{ token: string; cap: bigint; spent: bigint } | null | undefined>(c, 'fund', [toAddressVal(f.fundWalletPublicKey!)]);
        if (!entry) return null;
        const units = await readContract<bigint>(f.tokenContractId!, 'balance', [toAddressVal(c)]).catch(() => null);
        return {
          fundId: f.id,
          name: f.name,
          symbol: f.symbol,
          fundWallet: f.fundWalletPublicKey,
          fundToken: entry.token,
          capUnits: String(entry.cap),
          spentUnits: String(entry.spent),
          cap: formatUnits(BigInt(entry.cap)),
          spent: formatUnits(BigInt(entry.spent)),
          unitBalance: units === null ? null : formatUnits(BigInt(units)),
        };
      } catch {
        return null;
      }
    })
  );
  return {
    network: NETWORK_LABEL,
    wallet: {
      contractId: c,
      owner,
      agent,
      revoked,
      limits: {
        perTxCapUnits: String(limits.per_tx_cap),
        periodCapUnits: String(limits.period_cap),
        periodSecs: String(limits.period_secs),
        perTxCap: formatUnits(BigInt(limits.per_tx_cap)),
        periodCap: formatUnits(BigInt(limits.period_cap)),
        periodDays: Number(limits.period_secs) / 86_400,
      },
      mandateHash: hexOf(mandateHash),
      spentInPeriodUnits: String(spent),
      spentInPeriod: formatUnits(BigInt(spent)),
      usdcBalanceUnits: String(usdcBalance),
      usdcBalance: formatUnits(BigInt(usdcBalance)),
      allowedFunds: fundStates.filter((f) => f !== null),
      deployTxHash: wallet.deployTxHash,
      deployTxUrl: explorerTx(wallet.deployTxHash),
      contractUrl: `${EXPLORER_TX_BASE.replace(/tx\/$/, 'contract/')}${c}`,
      // Constant label: enforced by our wallet contract on Stellar, not audited
      enforcement: 'enforced by our wallet contract on Stellar testnet, not audited',
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// S9 and S10: subscribe executed by the agent, verified before the order completes
// ---------------------------------------------------------------------------------------------------------------

/** One transaction at a time per agent account (sequence numbers; TRY_AGAIN_LATER otherwise) */
const agentQueues = new Map<string, Promise<unknown>>();
function serializeByAccount<T>(account: string, job: () => Promise<T>): Promise<T> {
  const prev = agentQueues.get(account) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(job);
  agentQueues.set(account, next);
  next
    .finally(() => {
      if (agentQueues.get(account) === next) agentQueues.delete(account);
    })
    .catch(() => undefined);
  return next;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorOfScVal(v: Sdk.xdr.ScVal): { code: number } | null {
  if (v.switch().name !== 'scvError') return null;
  const e = v.error();
  if (e.switch().name !== 'sceContract') return null;
  return { code: Number(e.contractCode()) };
}

/**
 * Contract error reported by the RPC's diagnostic events of a FAILED transaction. Diagnostic events are not part
 * of consensus: the hash, txFAILED and the fee are; the code is what the RPC reports.
 */
export function contractErrorFromDiagnostics(events: Sdk.xdr.DiagnosticEvent[] | undefined, prefer?: string): { code: number; contract: string | null } | null {
  const found: { code: number; contract: string | null }[] = [];
  for (const d of events ?? []) {
    try {
      const ev = d.event();
      const cid = ev.contractId();
      const contract = cid ? Sdk.StrKey.encodeContract(cid as unknown as Buffer) : null;
      const body = ev.body().v0();
      for (const v of [...body.topics(), body.data()]) {
        const err = errorOfScVal(v);
        if (err) found.push({ code: err.code, contract });
      }
    } catch {
      /* skip undecodable event */
    }
  }
  return found.find((f) => prefer && f.contract === prefer) ?? found[0] ?? null;
}

/** Contract error in a simulation failure message, e.g. "HostError: Error(Contract, #5)" */
export function contractErrorFromMessage(message: string): number | null {
  const m = /Error\(Contract, #(\d+)\)/.exec(message);
  return m ? Number(m[1]) : null;
}

function errorName(code: number | null, contract: string | null, wallet: string): string | null {
  if (code === null) return null;
  if (contract === null || contract === wallet) return WALLET_ERRORS[code] ?? null;
  if (contract === usdcSacId()) return `USDC contract error ${code}`;
  return null;
}

/**
 * Sends a signed envelope and polls getTransaction until SUCCESS or FAILED. TRY_AGAIN_LATER is resent (same
 * envelope, same hash); DUPLICATE means it is already in flight. If the envelope's maxTime passes without the
 * transaction in a ledger it can no longer be included, which is reported as expired (never "done").
 */
export async function submitAndWait(signedXdr: string) {
  const tx = Sdk.TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE) as Sdk.Transaction;
  const hash = tx.hash().toString('hex');
  const maxTime = Number(tx.timeBounds?.maxTime ?? 0);

  for (let attempt = 1; ; attempt++) {
    let send: Sdk.rpc.Api.SendTransactionResponse;
    try {
      send = await rpcServer.sendTransaction(tx);
    } catch {
      // Unknown whether it reached the network: never assume either way, poll by hash until the time bound
      if (attempt >= 6) break;
      await sleep(1500 * attempt);
      continue;
    }
    if (send.status === 'PENDING' || send.status === 'DUPLICATE') break;
    if (send.status === 'TRY_AGAIN_LATER' && attempt < 10) {
      await sleep(2500);
      continue;
    }
    const detail = send.errorResult ? send.errorResult.result().switch().name : send.status;
    return { hash, status: 'REJECTED' as const, detail, diagnostics: send.diagnosticEvents };
  }

  let answered = false;
  for (;;) {
    let res: Sdk.rpc.Api.GetTransactionResponse;
    try {
      res = await rpcServer.getTransaction(hash);
      answered = true;
    } catch {
      // RPC unreachable: after the time bound the outcome is still unknown (never reported as done)
      if (!maxTime || Date.now() / 1000 > maxTime + 30) return { hash, status: answered ? ('EXPIRED' as const) : ('UNKNOWN' as const) };
      await sleep(2000);
      continue;
    }
    if (res.status === Sdk.rpc.Api.GetTransactionStatus.SUCCESS) return { hash, status: 'SUCCESS' as const, res };
    if (res.status === Sdk.rpc.Api.GetTransactionStatus.FAILED) return { hash, status: 'FAILED' as const, res };
    // NOT_FOUND: keep polling until the time bound has clearly passed (plus a few ledgers)
    if (maxTime && Date.now() / 1000 > maxTime + 30) return { hash, status: 'EXPIRED' as const };
    await sleep(2000);
  }
}

/**
 * S10: the confirmed transaction must be exactly subscribe(decision of this order, fund wallet from the database,
 * order total) on the investor's registered mandate wallet, sent by her agent key; the hash is used by no order.
 */
export async function verifySubscription(
  order: Pick<Order, 'id' | 'investorId' | 'fundId' | 'total' | 'payerAddress' | 'decisionHash'>,
  txHash: string,
  prisma?: PrismaClient
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const p = db(prisma);
  if (!/^[0-9a-f]{64}$/i.test(txHash)) return { ok: false, reason: 'Invalid transaction hash' };
  if (!order.payerAddress || !isContractAddress(order.payerAddress) || !order.decisionHash) {
    return { ok: false, reason: 'Order is not a mandate wallet order' };
  }
  const [wallet, fund, agentG] = await Promise.all([
    p.mandateWallet.findUnique({ where: { userId: order.investorId } }),
    p.fund.findUnique({ where: { id: order.fundId }, select: { fundWalletPublicKey: true } }),
    getAgentPublicKey(order.investorId, p),
  ]);
  if (!wallet || wallet.contractId !== order.payerAddress) return { ok: false, reason: 'Order payer is not the investor registered mandate wallet' };
  if (!fund?.fundWalletPublicKey) return { ok: false, reason: 'Fund wallet not configured' };
  if (!agentG) return { ok: false, reason: 'No agent key for this investor' };

  const reused = await p.order.findFirst({
    where: { id: { not: order.id }, OR: [{ txHash }, { refundTxHash: txHash }, { tokenMintTxHash: txHash }] },
    select: { id: true },
  });
  if (reused) return { ok: false, reason: 'Transaction already used by another order' };

  let call;
  try {
    call = await getConfirmedCall(txHash);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  let decisionHex = '';
  try {
    decisionHex = hexOf(call.args?.[0]);
  } catch {
    decisionHex = '';
  }
  const ok =
    call.kind === 'invoke' &&
    call.contractId === wallet.contractId &&
    call.method === 'subscribe' &&
    call.source === agentG &&
    call.args?.length === 3 &&
    decisionHex === order.decisionHash.toLowerCase() &&
    call.args?.[1] === fund.fundWalletPublicKey &&
    String(call.args?.[2]) === toShareUnits(order.total).toString();
  return ok ? { ok: true } : { ok: false, reason: 'Transaction is not subscribe(decision, fund wallet, amount) of this order on the investor wallet by her agent key' };
}

/** Marks a verified mandate wallet order COMPLETED (atomic) and records the on-chain event once */
export async function completeWalletOrder(orderId: string, txHash: string, prisma?: PrismaClient) {
  const p = db(prisma);
  const order = await p.order.findUniqueOrThrow({ where: { id: orderId } });
  const done = await p.order.updateMany({ where: { id: orderId, status: 'PENDING' }, data: { status: 'COMPLETED', txHash: txHash.toLowerCase() } });
  if (done.count === 0) return { completed: false as const };
  const approved = await p.mandate.findFirst({ where: { userId: order.investorId, status: 'APPROVED' }, orderBy: { version: 'desc' } });
  const log = await logEvent(
    {
      userId: order.investorId,
      action: 'subscribe',
      txHash,
      fundId: order.fundId,
      amountUnits: toShareUnits(order.total).toString(),
      mandateHash: approved?.hash ?? null,
    },
    p
  );
  return { completed: true as const, logSeq: log.seq };
}

/**
 * Executes an APPROVED decision of the policy log: builds subscribe(decision, fund_wallet, amount) on the
 * investor's mandate wallet with the agent key as source, gets it signed by signSubscription(seq, xdr) (which
 * re-checks everything), submits it through RPC, polls until the ledger answers, verifies the confirmed call and
 * completes the order. Resolves with the confirmed transaction hash.
 *
 * A refusal (simulation error, rejected envelope, FAILED transaction, expired) throws ContractRefusedError and
 * leaves nothing in the database (the reservation order is removed). It is never retried automatically.
 */
export async function executeSubscription(decisionSeq: number): Promise<{ txHash: string; orderId: string; decision: string; txUrl: string; network: string }> {
  const p = db();
  const entry = await getEntry(decisionSeq, p);
  if (!entry) throw new MandateWalletError('Decision not found', 404);
  const d = entry.payload;
  if (d.kind !== 'decision' || d.outcome !== 'APPROVED' || !d.fundId) throw new MandateWalletError('Only an APPROVED decision can be executed', 409);

  const wallet = await requireWallet(d.userId, p);
  const agentG = await getAgentPublicKey(d.userId, p);
  if (!agentG) throw new MandateWalletError('No agent key for this investor', 409);
  const fund = await p.fund.findUnique({
    where: { id: d.fundId },
    select: { id: true, status: true, price: true, totalIssued: true, fundWalletPublicKey: true, tokenContractId: true },
  });
  if (!fund?.fundWalletPublicKey || !fund.tokenContractId || fund.status !== 'APPROVED') {
    throw new MandateWalletError('Fund is not open for investment', 409);
  }
  const amountUnits = BigInt(d.amountUnits);
  if (amountUnits <= 0n) throw new MandateWalletError('Decision amount must be positive', 409);
  const fundWallet = fund.fundWalletPublicKey;

  return serializeByAccount(agentG, async () => {
    // An order with this decision already exists: executing again would be the same decision twice
    const existing = await p.order.findUnique({ where: { decisionHash: entry.hash } });
    if (existing) throw new MandateWalletError('This decision already has an order', 409, { orderId: existing.id, status: existing.status });

    const total = Number(toStellarAmount(Number(amountUnits) / 1e7));
    const quantity = Number(toStellarAmount(total / fund.price));
    if (toShareUnits(total) !== amountUnits) throw new MandateWalletError('Amount cannot be represented exactly', 409);

    // Quotas still available (paid and not refunded, or recently reserved)
    const reserved = await p.order.aggregate({
      where: {
        fundId: fund.id,
        OR: [
          { status: 'COMPLETED', approvalStatus: { not: 'REJECTED' } },
          { status: 'PENDING', createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
        ],
      },
      _sum: { quantity: true },
    });
    if (quantity > fund.totalIssued - (reserved._sum.quantity ?? 0) + 1e-7) throw new MandateWalletError('Not enough fund units available', 409);

    // 1. Build and simulate with the agent key as source. A contract refusal surfaces here without a hash
    let unsigned: string;
    try {
      unsigned = await prepareInvocation(
        agentG,
        wallet.contractId,
        'subscribe',
        [hex32(entry.hash), toAddressVal(fundWallet), toI128Val(amountUnits)],
        SUBSCRIBE_TIMEOUT_SECONDS
      );
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      const code = contractErrorFromMessage(msg);
      if (code === null && NETWORK_ERROR_RE.test(msg)) {
        throw new RpcUnavailableError('Stellar RPC unavailable while simulating; nothing was signed, sent or recorded', null, null);
      }
      const name = errorName(code, null, wallet.contractId);
      throw new ContractRefusedError(
        code !== null ? `Refused in simulation by the wallet contract: Error(Contract, #${code})${name ? ` ${name}` : ''}` : `Simulation failed: ${msg.slice(0, 300)}`,
        { stage: 'simulation', code, errorName: name, contract: code !== null ? wallet.contractId : null, txHash: null, txUrl: null }
      );
    }

    // 2. The agent signer re-checks the decoded call against the decision and signs (or refuses and logs)
    const signed = await signSubscription(decisionSeq, unsigned, { prisma: p });

    // 3. Reserve the units with a PENDING order (removed again if the network does not confirm)
    const order = await p.order.create({
      data: {
        fundId: fund.id,
        investorId: d.userId,
        quantity,
        price: fund.price,
        total,
        status: 'PENDING',
        payerAddress: wallet.contractId,
        decisionHash: entry.hash,
      },
    });
    const dropOrder = () => p.order.deleteMany({ where: { id: order.id, status: 'PENDING', txHash: null } }).catch(() => undefined);

    // 4. Submit and wait for the ledger
    let out: Awaited<ReturnType<typeof submitAndWait>>;
    try {
      out = await submitAndWait(signed);
    } catch (e) {
      // Unexpected: the envelope may be in flight, keep the PENDING order for later verification
      throw new RpcUnavailableError(`Submission status unknown: ${(e as Error).message}`, Sdk.TransactionBuilder.fromXDR(signed, NETWORK_PASSPHRASE).hash().toString('hex'), order.id);
    }
    if (out.status === 'UNKNOWN') {
      throw new RpcUnavailableError(
        `Stellar RPC unavailable: transaction ${out.hash} is not confirmed (status unknown). The order stays pending; verify it later with PATCH /api/orders/${order.id}/complete`,
        out.hash,
        order.id
      );
    }
    if (out.status === 'REJECTED') {
      await dropOrder();
      const err = contractErrorFromDiagnostics(out.diagnostics, wallet.contractId);
      throw new ContractRefusedError(`The network rejected the transaction before the ledger: ${out.detail}`, {
        stage: 'submission',
        code: err?.code ?? null,
        errorName: errorName(err?.code ?? null, err?.contract ?? null, wallet.contractId),
        contract: err?.contract ?? null,
        txHash: null,
        txUrl: null,
      });
    }
    if (out.status === 'EXPIRED') {
      await dropOrder();
      throw new ContractRefusedError('The transaction expired before reaching a ledger; nothing was executed', {
        stage: 'expired',
        code: null,
        errorName: null,
        contract: null,
        txHash: null,
        txUrl: null,
      });
    }
    if (out.status === 'FAILED') {
      await dropOrder();
      const res = out.res as Sdk.rpc.Api.GetFailedTransactionResponse;
      const err = contractErrorFromDiagnostics(res.diagnosticEventsXdr, wallet.contractId);
      const name = errorName(err?.code ?? null, err?.contract ?? null, wallet.contractId);
      throw new ContractRefusedError(
        `Transaction failed on-chain (${out.hash}); the RPC's diagnostic events report ${err ? `Error(Contract, #${err.code})${name ? ` ${name}` : ''}` : 'no contract error'}`,
        { stage: 'ledger', code: err?.code ?? null, errorName: name, contract: err?.contract ?? null, txHash: out.hash, txUrl: explorerTx(out.hash) }
      );
    }

    // 5. SUCCESS: decode the confirmed transaction and check it before the order completes
    const check = await verifySubscription(order, out.hash, p);
    if (!check.ok) {
      // The payment happened on-chain: keep the PENDING order (with the payer and decision) for PATCH /orders/:id/complete
      throw new MandateWalletError(`Confirmed transaction did not verify: ${check.reason}`, 502, { orderId: order.id, txHash: out.hash });
    }
    await completeWalletOrder(order.id, out.hash, p);
    return { txHash: out.hash, orderId: order.id, decision: entry.hash, txUrl: explorerTx(out.hash), network: NETWORK_LABEL };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Status for the confirmation screen (line 1.8)
// ---------------------------------------------------------------------------------------------------------------

export type PurchaseStatus = 'PENDING_NETWORK' | 'CONFIRMED_AWAITING_ISSUER' | 'COUNTERSIGNED' | 'REFUNDED' | 'FAILED';

export async function listPurchases(userId: string, prisma?: PrismaClient) {
  const p = db(prisma);
  const orders = await p.order.findMany({
    where: { investorId: userId, payerAddress: { not: null } },
    include: { fund: { select: { id: true, name: true, symbol: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const hashes = orders.map((o) => o.decisionHash).filter((h): h is string => !!h);
  const rows = hashes.length ? await p.decisionLog.findMany({ where: { hash: { in: hashes } }, select: { seq: true, hash: true } }) : [];
  const seqByHash = new Map(rows.map((r) => [r.hash, r.seq]));
  const pendingExecutions = await p.decisionExecution.findMany({
    where: { userId, status: { in: ['PENDING', 'SIGNED'] } },
    select: { seq: true, status: true, createdAt: true },
  });
  const link = (h: string | null) => (h ? explorerTx(h) : null);
  return {
    network: NETWORK_LABEL,
    inFlight: pendingExecutions.map((e) => ({ decisionSeq: e.seq, status: 'PENDING_NETWORK' as PurchaseStatus, executionStatus: e.status, since: e.createdAt })),
    purchases: orders.map((o) => {
      const status: PurchaseStatus =
        o.status === 'FAILED' ? 'FAILED' : o.status !== 'COMPLETED'
          ? 'PENDING_NETWORK'
          : o.approvalStatus === 'APPROVED'
            ? 'COUNTERSIGNED'
            : o.approvalStatus === 'REJECTED'
              ? 'REFUNDED'
              : 'CONFIRMED_AWAITING_ISSUER';
      return {
        orderId: o.id,
        status,
        decision: o.decisionHash,
        decisionSeq: o.decisionHash ? seqByHash.get(o.decisionHash) ?? null : null,
        fund: o.fund,
        amountUsdc: toStellarAmount(o.total),
        units: toStellarAmount(o.quantity),
        payer: o.payerAddress,
        subscribeTxHash: o.txHash,
        subscribeTxUrl: link(o.txHash),
        mintTxHash: o.tokenMintTxHash,
        mintTxUrl: link(o.tokenMintTxHash),
        refundTxHash: o.refundTxHash,
        refundTxUrl: link(o.refundTxHash),
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Issuer side for orders paid by a mandate wallet (line 1.5): refund through the SAC, verified by getConfirmedCall
// ---------------------------------------------------------------------------------------------------------------

/** Refund of a mandate wallet order: USDC transfer from the fund wallet to the wallet contract through the SAC */
export async function buildWalletRefund(order: Pick<Order, 'total' | 'payerAddress'>, fundWallet: string, prisma?: PrismaClient) {
  if (!order.payerAddress || !isContractAddress(order.payerAddress)) throw new MandateWalletError('Order is not a mandate wallet order');
  const units = toShareUnits(order.total);
  const transactionXdr = await prepareInvocation(fundWallet, usdcSacId(), 'transfer', [
    toAddressVal(fundWallet),
    toAddressVal(order.payerAddress),
    toI128Val(units),
  ]);
  const decoded = await decodeInvocation(transactionXdr, { prisma });
  return { transactionXdr, decoded, units: units.toString() };
}

export async function verifyWalletRefund(order: Pick<Order, 'total' | 'payerAddress'>, fundWallet: string, txHash: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let call;
  try {
    call = await getConfirmedCall(txHash);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const ok =
    call.kind === 'invoke' &&
    call.contractId === usdcSacId() &&
    call.method === 'transfer' &&
    call.source === fundWallet &&
    call.args?.[0] === fundWallet &&
    call.args?.[1] === order.payerAddress &&
    String(call.args?.[2]) === toShareUnits(order.total).toString();
  return ok ? { ok: true } : { ok: false, reason: 'Transaction is not a USDC transfer of the order total from the fund wallet to the mandate wallet' };
}

/** Records a verified issuer side event for an order paid by a mandate wallet */
export async function logOrderEvent(order: Pick<Order, 'investorId' | 'fundId'>, action: 'whitelist_add' | 'mint' | 'refund', txHash: string, amountUnits?: bigint, prisma?: PrismaClient) {
  return logEvent(
    { userId: order.investorId, action, txHash, fundId: order.fundId, ...(amountUnits !== undefined ? { amountUnits: amountUnits.toString() } : {}) },
    prisma
  );
}
