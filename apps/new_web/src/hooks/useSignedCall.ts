import { useCallback, useRef, useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { txService } from '../services/countersign';
import type { BuiltTransaction } from '../types/countersign';
import { toDecodedCall, type DecodedCall } from '../types/decodedCall';
import { checkConsistency, type ConsistencyResult } from '../utils/localDecode';
import { errorText, isNoResponse, parseContractError } from '../utils/contractErrors';

/**
 * The build, sign, verify loop for a transaction the investor (or the issuer) signs, with the approval card in front:
 *   1. the API builds and simulates and returns the XDR and its decoded form (or we ask POST /api/tx/decode);
 *   2. the card is rendered from `decoded`, checked against a second reading of the same bytes;
 *   3. only the click on "Sign in your wallet" opens the wallet (WalletContext.signAndSubmitTransaction);
 *   4. success is the API's confirm response (it decodes the confirmed transaction), never the wallet's.
 */

export type SignPhase =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'review'; notice?: string }
  | { kind: 'awaiting_wallet' }
  | { kind: 'pending'; hash: string; note: string }
  | { kind: 'confirmed'; hash: string; result: unknown }
  | { kind: 'refused_contract'; code: number; name: string; detail: string }
  | { kind: 'failed'; message: string; hash?: string };

export interface PreparedCall {
  xdr: string;
  decoded: DecodedCall;
  check: ConsistencyResult;
}

export interface CallSpec {
  build: () => Promise<BuiltTransaction>;
  confirm: (txHash: string) => Promise<unknown>;
}

export function useSignedCall() {
  const { signAndSubmitTransaction } = useWallet();
  const [phase, setPhase] = useState<SignPhase>({ kind: 'idle' });
  const [prepared, setPrepared] = useState<PreparedCall | null>(null);
  const spec = useRef<CallSpec | null>(null);

  const reset = useCallback(() => {
    spec.current = null;
    setPrepared(null);
    setPhase({ kind: 'idle' });
  }, []);

  const prepare = useCallback(async (s: CallSpec) => {
    spec.current = s;
    setPrepared(null);
    setPhase({ kind: 'preparing' });
    try {
      const built = await s.build();
      if (!built?.transactionXdr) throw new Error('The API returned no transaction');
      // The card is rendered from the decoder only. If the build response did not carry it, ask the decoder.
      const raw = built.decoded ?? (await txService.decode(built.transactionXdr));
      const decoded = toDecodedCall(raw);
      const check = checkConsistency(decoded, built.transactionXdr);
      setPrepared({ xdr: built.transactionXdr, decoded, check });
      setPhase({ kind: 'review' });
    } catch (e) {
      const contract = parseContractError(e);
      if (contract) setPhase({ kind: 'refused_contract', ...contract, detail: 'The simulation of this transaction was refused by the contract; nothing was signed.' });
      else setPhase({ kind: 'failed', message: `Could not prepare the transaction: ${errorText(e)}. Nothing was signed.` });
    }
  }, []);

  const confirmHash = useCallback(async (hash: string) => {
    const s = spec.current;
    if (!s) return;
    setPhase({ kind: 'pending', hash, note: 'Submitted. Waiting for the API to read the confirmed transaction: pending, not done.' });
    try {
      const result = await s.confirm(hash);
      setPhase({ kind: 'confirmed', hash, result });
    } catch (e) {
      if (isNoResponse(e)) {
        setPhase({ kind: 'pending', hash, note: `Not verified yet (${errorText(e)}): pending, not done.` });
      } else {
        setPhase({ kind: 'failed', hash, message: `The API did not accept this transaction: ${errorText(e)}. Not done.` });
      }
    }
  }, []);

  const sign = useCallback(async () => {
    if (!prepared || !prepared.check.ok) return;
    setPhase({ kind: 'awaiting_wallet' });
    let hash: string;
    try {
      hash = await signAndSubmitTransaction(prepared.xdr);
    } catch (e) {
      const contract = parseContractError(e);
      if (contract) {
        setPhase({ kind: 'refused_contract', ...contract, detail: 'The network rejected the transaction.' });
        return;
      }
      const text = errorText(e);
      if (/declin|reject|cancel|denied|closed/i.test(text)) {
        setPhase({ kind: 'review', notice: 'Signature cancelled in the wallet. Nothing was submitted.' });
        return;
      }
      // Horizon timeout or no answer: the transaction may still land. Ask the API with the envelope hash.
      const local = prepared.check.local?.testnetHash;
      if (local && (/timeout|504|network error/i.test(text) || isNoResponse(e))) {
        await confirmHash(local);
        return;
      }
      setPhase({ kind: 'failed', message: `Not submitted: ${text}. Not done.` });
      return;
    }
    const expected = prepared.check.local?.testnetHash;
    if (expected && hash.toLowerCase() !== expected) {
      setPhase({ kind: 'failed', hash, message: 'The submitted transaction is not the one shown on the card. Not done.' });
      return;
    }
    await confirmHash(hash);
  }, [prepared, signAndSubmitTransaction, confirmHash]);

  const retryConfirm = useCallback(() => {
    if (phase.kind === 'pending') void confirmHash(phase.hash);
  }, [phase, confirmHash]);

  return { phase, prepared, prepare, sign, retryConfirm, reset };
}

export type SignedCall = ReturnType<typeof useSignedCall>;
