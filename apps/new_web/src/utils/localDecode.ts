import * as StellarSdk from '@stellar/stellar-sdk';
import type { DecodedCall } from '../types/decodedCall';

/**
 * Structural decoding of a transaction envelope IN THE BROWSER, from the exact base64 XDR that will go to
 * the wallet. It is never what the card displays (the card shows the API decoder's output); it is the
 * independent second reading used to refuse signing when the two disagree, and the stand-in decoder of
 * the offline byte flip test.
 */

export interface LocalArg {
  type: string;
  /** Native value as text: strkey address, integer, hex for bytes, plain text for strings */
  value: string;
}

export type LocalOp =
  | { type: 'invoke'; contractId: string; function: string; args: LocalArg[] }
  | { type: 'deploy'; wasmHash: string | null; args: LocalArg[] }
  | { type: 'classic'; opType: string; fields: Record<string, string> };

export interface LocalDecoded {
  source: string;
  fee: string;
  /** Envelope hash computed for Stellar testnet (equals the submitted transaction hash on testnet) */
  testnetHash: string;
  ops: LocalOp[];
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Reads a field that is a property in stellar-sdk 17 and a method in older XDR bindings */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(obj: any, name: string): any {
  if (obj == null) return undefined;
  const v = obj[name];
  return typeof v === 'function' ? v.call(obj) : v;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nativeText(scv: any): LocalArg {
  const type = String(pick(scv, 'type') ?? pick(pick(scv, 'switch'), 'name') ?? 'unknown').replace(/^scv/, '').toLowerCase();
  let native: unknown;
  try {
    native = StellarSdk.scValToNative(scv);
  } catch {
    native = undefined;
  }
  let value: string;
  if (native instanceof Uint8Array) value = toHex(native);
  else if (typeof native === 'bigint' || typeof native === 'number' || typeof native === 'boolean') value = String(native);
  else if (typeof native === 'string') value = native;
  else if (native === undefined) value = '';
  else value = JSON.stringify(native, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  return { type, value };
}

function addressText(scAddress: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return StellarSdk.Address.fromScAddress(scAddress as any).toString();
}

function bytesText(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Uint8Array) return toHex(v);
  const inner = pick(v, 'value');
  return inner instanceof Uint8Array ? toHex(inner) : null;
}

/** Throws when the XDR is not a valid transaction envelope */
export function decodeLocally(xdrB64: string): LocalDecoded {
  const parsed = StellarSdk.TransactionBuilder.fromXDR(xdrB64, StellarSdk.Networks.TESTNET);
  if ('innerTransaction' in parsed) throw new Error('Fee bump envelopes are not expected here');
  const tx = parsed as StellarSdk.Transaction;
  const ops: LocalOp[] = tx.operations.map((op) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = op as any;
    if (o.type === 'invokeHostFunction') {
      const func = o.func;
      const kind: string = String(pick(func, 'type') ?? pick(pick(func, 'switch'), 'name'));
      if (kind === 'hostFunctionTypeInvokeContract') {
        const ic = pick(func, 'invokeContract');
        const fnName = pick(ic, 'functionName');
        const fnText = fnName instanceof Uint8Array ? new TextDecoder().decode(fnName) : String(fnName);
        return {
          type: 'invoke',
          contractId: addressText(pick(ic, 'contractAddress')),
          function: fnText,
          args: (pick(ic, 'args') as unknown[]).map(nativeText),
        };
      }
      if (kind === 'hostFunctionTypeCreateContractV2' || kind === 'hostFunctionTypeCreateContract') {
        const cc = pick(func, kind === 'hostFunctionTypeCreateContractV2' ? 'createContractV2' : 'createContract');
        const exec = pick(cc, 'executable');
        return {
          type: 'deploy',
          wasmHash: bytesText(pick(exec, 'wasmHash')),
          args: ((pick(cc, 'constructorArgs') as unknown[] | undefined) ?? []).map(nativeText),
        };
      }
      return { type: 'classic', opType: kind, fields: {} };
    }
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === 'type') continue;
      if (v && typeof v === 'object' && 'code' in (v as object)) {
        const a = v as StellarSdk.Asset;
        fields[k] = a.isNative() ? 'XLM' : `${a.getCode()} (${a.getIssuer()})`;
      } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        fields[k] = String(v);
      }
    }
    return { type: 'classic', opType: String(o.type), fields };
  });
  const hash = tx.hash() as unknown as Uint8Array;
  return { source: tx.source, fee: String(tx.fee), testnetHash: toHex(new Uint8Array(hash)), ops };
}

/**
 * Stand-in decoder used only by the offline test: maps the local reading to a DecodedCall with
 * positional argument names. The UI never uses this to render the card.
 */
export function localToDecodedCall(local: LocalDecoded, argNames: string[] = []): DecodedCall {
  const op = local.ops[0];
  if (!op || op.type === 'classic') throw new Error('Not a contract call');
  const args = op.args.map((a, i) => ({ name: argNames[i] ?? `arg${i}`, type: a.type, value: a.value, display: '' }));
  return op.type === 'invoke'
    ? { network: 'Stellar testnet', kind: 'invoke', contractId: op.contractId, function: op.function, args, signer: local.source, source: local.source, fee: local.fee }
    : { network: 'Stellar testnet', kind: 'deploy', contractId: null, function: '__constructor', args, signer: local.source, source: local.source, fee: local.fee, wasmHash: op.wasmHash };
}

const ADDRESS = /^[GC][A-Z2-7]{55}$/;
const INTEGER = /^-?\d+$/;

export interface ConsistencyResult {
  ok: boolean;
  problems: string[];
  local: LocalDecoded | null;
}

/**
 * Second reading of the envelope: the API decoder's output must describe the same contract, function,
 * source and arguments as the bytes the wallet will sign. Any disagreement blocks signing.
 */
export function checkConsistency(decoded: DecodedCall, xdrB64: string): ConsistencyResult {
  let local: LocalDecoded;
  try {
    local = decodeLocally(xdrB64);
  } catch (e) {
    return { ok: false, problems: [`The transaction could not be read in your browser: ${(e as Error).message}`], local: null };
  }
  const problems: string[] = [];
  if (decoded.network && !/testnet/i.test(decoded.network)) problems.push(`The decoder assumed another network (${decoded.network})`);
  if (decoded.envelopeHash && decoded.envelopeHash.toLowerCase() !== local.testnetHash) {
    problems.push('The decoder read a different envelope, or another network, than the bytes your wallet will sign');
  }
  if (local.ops.length !== 1) problems.push(`Expected one operation, the transaction has ${local.ops.length}`);
  const op = local.ops[0];
  if (decoded.source && decoded.source !== local.source) problems.push('Source account differs from the transaction');
  if (op?.type === 'invoke') {
    if (decoded.kind !== 'invoke') problems.push('The transaction calls a contract, the decoder reported a deploy');
    if (decoded.contractId !== op.contractId) problems.push('Contract differs from the transaction');
    if (decoded.function !== op.function) problems.push('Function differs from the transaction');
  } else if (op?.type === 'deploy') {
    if (decoded.kind !== 'deploy') problems.push('The transaction deploys a contract, the decoder reported a call');
    if (decoded.wasmHash && op.wasmHash && decoded.wasmHash.toLowerCase() !== op.wasmHash) problems.push('Wasm hash differs from the transaction');
  } else if (op) {
    problems.push('The transaction is not a contract call');
  }
  if (op && op.type !== 'classic') {
    if (decoded.args.length !== op.args.length) problems.push('Number of arguments differs from the transaction');
    op.args.forEach((a, i) => {
      const d = decoded.args[i];
      if (!d) return;
      if (ADDRESS.test(a.value) && ADDRESS.test(d.value) && a.value !== d.value) problems.push(`Argument ${d.name} differs from the transaction`);
      if (INTEGER.test(a.value) && INTEGER.test(d.value) && BigInt(a.value) !== BigInt(d.value)) problems.push(`Argument ${d.name} differs from the transaction`);
      if (/^[0-9a-f]{64}$/i.test(a.value) && /^[0-9a-f]{64}$/i.test(d.value) && a.value !== d.value.toLowerCase()) problems.push(`Argument ${d.name} differs from the transaction`);
    });
  }
  return { ok: problems.length === 0, problems, local };
}
