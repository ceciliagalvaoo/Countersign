import type { ChainResponse, SignatureResult } from '../types/receivableChain';

interface Dependencies {
  expectedStepId?: string;
  chain: (id: string, hash?: string, expectedStepId?: string) => Promise<ChainResponse>;
  sign: (id: string, xdr: string) => Promise<SignatureResult>;
  signTransaction: (xdr: string) => Promise<string>;
  signAndSubmitTransaction: (xdr: string) => Promise<string>;
}

// One explicit step per click. A completed step never opens the next wallet prompt.
export async function recordReceivableStep(id: string, publicKey: string, deps: Dependencies) {
  const next = await deps.chain(id, undefined, deps.expectedStepId);
  const label = next.label || next.step || 'Vault step';
  const confirm = async (hash: string | undefined) => {
    if (!hash) throw new Error('Submission returned no transaction hash; on-chain success is unverified');
    const confirmed = await deps.chain(id, hash);
    if (confirmed.verified !== true || confirmed.txHash !== hash)
      throw new Error('Transaction not verified on-chain; do not start another step');
    return { kind: 'confirmed' as const, step: confirmed, message: `${confirmed.label || label} confirmed on Stellar` };
  };
  if (next.verificationRequired) return confirm(next.txHash);
  if (next.done) return { kind: 'done' as const, step: next, message: `On-chain record up to date (${next.chainStatus})` };
  if (next.reviewRequired || (deps.expectedStepId && deps.expectedStepId !== next.stepId))
    return { kind: 'review' as const, step: next, message: `Progress changed. Review ${label} and click again to sign this step. No wallet signature requested.` };
  if (!next.transactionXdr) throw new Error('No transaction prepared for this step');
  if (next.multisig) {
    const m = next.multisig;
    if (m.weight < m.threshold && !m.signers.some(s => s.key === publicKey))
      throw new Error(`Connect an eligible signer for ${label}`);
    if (m.weight < m.threshold && m.signedBy.includes(publicKey))
      return { kind: 'waiting' as const, step: next, message: `You already signed ${label}. Waiting for another signer (${m.weight}/${m.threshold} weight).` };
    // Fully collected signatures may be retried after a failed submission, without signing again.
    const signed = m.weight >= m.threshold ? next.transactionXdr : await deps.signTransaction(next.transactionXdr);
    const result = await deps.sign(m.id, signed);
    if (!result.submitted) return { kind: 'waiting' as const,
      step: { ...next, multisig: { ...m, ...result } },
      message: `${label}: signature saved (${result.signedBy.length} signers, weight ${result.weight}/${result.threshold}). Awaiting another signer; not confirmed on-chain.` };
    return confirm(result.txHash);
  }
  if (next.signer !== publicKey) throw new Error(`Connect the expected wallet (${next.signer}) for ${label}`);
  return confirm(await deps.signAndSubmitTransaction(next.transactionXdr));
}
