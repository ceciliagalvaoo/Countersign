/**
 * PROVISIONAL shape of the transaction decoder output (owner: stellar-integrator, decodeInvocation in
 * apps/api/src/services/mandateWallet.ts, returned by POST /api/mandate-wallet/build-call as `decoded`
 * and by POST /api/tx/decode).
 *
 * The approval card is rendered ONLY from a DecodedCall. Nothing written by the language model goes in.
 * When the decoder's final shape is known, reconcile it here, in toDecodedCall, and nowhere else.
 */

export interface DecodedArg {
  /** Parameter name from the contract spec (fund_wallet, fund_cap, ...) or "arg0" when unknown */
  name: string;
  /** Soroban type as reported by the decoder: address, i128, u64, bytes, bool, symbol, string ... */
  type: string;
  /** Raw value as a string (address strkey, integer units, hex) */
  value: string;
  /** Readable form produced by the decoder ("50.0000000 USDC", "30 days (2592000 seconds)"); may be empty */
  display: string;
  /** Label the decoder attached to an address, from the API database ("fund wallet of X"); never LLM text */
  label?: string | null;
}

export interface DecodedCall {
  /** Network the decoder says it assumed. Only cross-checked; the card states the network itself. */
  network: string | null;
  /** invoke: a contract call; deploy: creation of a contract instance from a Wasm hash */
  kind: 'invoke' | 'deploy';
  /** Contract called (C...), null for a deploy */
  contractId: string | null;
  /** Contract function, or "__constructor" for a deploy */
  function: string;
  args: DecodedArg[];
  /** Account whose signature the transaction needs (G...) */
  signer: string | null;
  /** Transaction source account (G...) */
  source: string | null;
  /** Optional: maximum fee in stroops */
  fee?: string | null;
  /** Optional: label the decoder attached to the contract */
  contractLabel?: string | null;
  /** Optional: Wasm hash of a deploy */
  wasmHash?: string | null;
  /** Optional: envelope hash the decoder computed under the network it states (checked against the bytes) */
  envelopeHash?: string | null;
}

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return String(v);
  return null;
};

function adaptArg(raw: unknown, index: number): DecodedArg {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Raw;
    const value = str(r.value) ?? str(r.raw) ?? (r.value !== undefined ? JSON.stringify(r.value) : '');
    return {
      name: str(r.name) ?? str(r.key) ?? `arg${index}`,
      type: str(r.type) ?? str(r.scType) ?? 'unknown',
      value,
      display: str(r.display) ?? str(r.readable) ?? '',
      label: str(r.label),
    };
  }
  const value = str(raw) ?? JSON.stringify(raw);
  return { name: `arg${index}`, type: 'unknown', value, display: '' };
}

function adaptArgs(raw: unknown): DecodedArg[] {
  if (Array.isArray(raw)) return raw.map(adaptArg);
  if (raw && typeof raw === 'object') {
    // Map form: { fund_wallet: "G...", fund_cap: { type, value, display } }
    return Object.entries(raw as Raw).map(([name, v], i) => {
      const a = adaptArg(v, i);
      return { ...a, name };
    });
  }
  return [];
}

export class DecoderShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecoderShapeError';
  }
}

/**
 * Adapter from whatever the API decoder returns to DecodedCall. Accepts the field names announced in
 * projeto/Agents/stellar-integrator.md (method, contractId, args, source, fee) and the provisional ones
 * (function, signer). Throws when the essential fields are missing: no card is better than a wrong card.
 */
export function toDecodedCall(raw: unknown): DecodedCall {
  if (!raw || typeof raw !== 'object') throw new DecoderShapeError('The decoder returned nothing');
  const r = raw as Raw;
  // stellar-integrator shape (18/10): contract { address, label?, wasmHash? }, source { address, label? },
  // operation "invoke_contract" | "create_contract", fee { totalStroops, resourceFeeStroops, totalXlm }
  const contractObj = r.contract && typeof r.contract === 'object' ? (r.contract as Raw) : null;
  const sourceObj = r.source && typeof r.source === 'object' ? (r.source as Raw) : null;
  const feeObj = r.fee && typeof r.fee === 'object' ? (r.fee as Raw) : null;
  const wasmHash = str(contractObj?.wasmHash) ?? str(r.wasmHash) ?? str(r.wasm_hash);
  const op = str(r.operation) ?? str(r.kind);
  const kind: DecodedCall['kind'] =
    op === 'create_contract' || op === 'deploy' || op === 'createContract' || (!!wasmHash && !contractObj?.address && !r.contractId)
      ? 'deploy'
      : 'invoke';
  const fn = str(r.function) ?? str(r.method) ?? str(r.fn) ?? (kind === 'deploy' ? '__constructor' : null);
  if (!fn) throw new DecoderShapeError('The decoder did not report the contract function');
  const contractId = str(contractObj?.address) ?? str(r.contractId) ?? (typeof r.contract === 'string' ? r.contract : null);
  if (kind === 'invoke' && !contractId) throw new DecoderShapeError('The decoder did not report the contract');
  const source = str(sourceObj?.address) ?? (typeof r.source === 'string' ? r.source : null) ?? str(r.sourceAccount);
  return {
    network: str(r.network),
    kind,
    contractId,
    function: fn,
    args: adaptArgs(r.args ?? r.arguments ?? r.constructorArgs),
    // Owner calls are signed by the source account (auth entries with source_account credentials)
    signer: str(r.signer) ?? source,
    source,
    fee: str(feeObj?.totalStroops) ?? str(r.fee) ?? str(r.maxFee),
    contractLabel: str(contractObj?.label) ?? str(r.contractLabel),
    wasmHash,
    envelopeHash: str(r.txHash),
  };
}

/** Finds an argument by contract parameter name (or by position as a fallback) */
export function argOf(call: DecodedCall, name: string, position?: number): DecodedArg | undefined {
  return call.args.find((a) => a.name === name) ?? (position !== undefined ? call.args[position] : undefined);
}
