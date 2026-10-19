import * as Sdk from '@stellar/stellar-sdk';
import type { PrismaClient } from '@prisma/client';
import { STELLAR_CONFIG } from '../config/stellar.js';
import { blendConfig } from '../config/blend.js';

// Signature collection for transactions whose source is a native Stellar multisig account (for example the platform
// admin after contracts/scripts/secure-admin.sh). The API never signs: each signer adds a signature from their own
// wallet, the API checks every signature against the account's signer list on the network, and submits the
// transaction once the signed weight reaches the account's medium threshold (contract calls are medium operations).

const horizon = new Sdk.Horizon.Server(STELLAR_CONFIG.HORIZON_URL);
const PASSPHRASE = blendConfig.passphrase;

/** Time the signers have to collect their signatures before the transaction expires */
export const MULTISIG_TX_TIMEOUT_SECONDS = 6 * 60 * 60;

export interface SignerSet {
  signers: { key: string; weight: number }[];
  threshold: number;
}

/** Signers (with a non-zero weight) and medium threshold of an account, read from the network */
export async function loadSignerSet(account: string): Promise<SignerSet> {
  const acc = await horizon.loadAccount(account);
  return {
    signers: acc.signers
      .filter((s) => s.type === 'ed25519_public_key' && s.weight > 0)
      .map((s) => ({ key: s.key, weight: s.weight })),
    threshold: Math.max(acc.thresholds.med_threshold, 1),
  };
}

/** True when no single key can sign for the account on its own */
export const needsMultipleSignatures = (set: SignerSet) => !set.signers.some((s) => s.weight >= set.threshold);

export const signedWeight = (set: SignerSet, signedBy: string[]) =>
  set.signers.filter((s) => signedBy.includes(s.key)).reduce((sum, s) => sum + s.weight, 0);

/**
 * Merges the signatures of `signedXdr` into the pending envelope. Only valid signatures of the account's signers over
 * this exact transaction are kept, so a signer can neither change the transaction nor add unrelated signatures.
 */
export function mergeSignatures(pendingXdr: string, signedXdr: string, set: SignerSet) {
  const pending = new Sdk.Transaction(pendingXdr, PASSPHRASE);
  let incoming: Sdk.Transaction;
  try {
    incoming = new Sdk.Transaction(signedXdr, PASSPHRASE);
  } catch {
    throw new Error('Invalid signed transaction');
  }
  const hash = pending.hash();
  if (!incoming.hash().equals(hash)) {
    throw new Error('The signed transaction is not the pending one');
  }

  const signerFor = (sig: Sdk.xdr.DecoratedSignature) => set.signers.find(s => {
    const kp = Sdk.Keypair.fromPublicKey(s.key);
    return kp.signatureHint().equals(sig.hint()) && kp.verify(hash, sig.signature());
  });
  if (!incoming.signatures.some(sig => signerFor(sig)))
    throw new Error('No valid account signature in the signed transaction (check wallet and network)');

  const signedBy: string[] = [];
  const signatures: Sdk.xdr.DecoratedSignature[] = [];
  for (const sig of [...pending.signatures, ...incoming.signatures]) {
    const signer = signerFor(sig);
    if (signer && !signedBy.includes(signer.key)) {
      signedBy.push(signer.key);
      signatures.push(sig);
    }
  }

  const envelope = pending.toEnvelope();
  envelope.v1().signatures(signatures);
  return { xdr: envelope.toXDR('base64'), signedBy, weight: signedWeight(set, signedBy) };
}

/** Submits a fully signed transaction. `expired` means it can no longer succeed and must be rebuilt. */
export async function submitSigned(xdr: string, client = horizon): Promise<{ ok: true; hash: string } | { ok: false; expired: boolean; reason: string }> {
  const tx = new Sdk.Transaction(xdr, PASSPHRASE);
  try {
    const res = await client.submitTransaction(tx);
    if (res.successful === false || res.hash !== tx.hash().toString('hex'))
      return { ok: false, expired: false, reason: 'Submission did not confirm the expected successful transaction' };
    return { ok: true, hash: res.hash };
  } catch (error: any) {
    // A lost HTTP response may follow a successful submission. Check this exact
    // hash before interpreting an advanced sequence as expiry and rebuilding.
    try {
      const found = await client.transactions().transaction(tx.hash().toString('hex')).call();
      if (found.successful && found.hash === tx.hash().toString('hex')) return { ok: true, hash: found.hash };
    } catch { /* unverified: retain pending signatures unless definitively expired */ }
    const codes = error?.response?.data?.extras?.result_codes;
    // A `tx_failed` result does not tell whether the transaction was applied (and its sequence spent) or rejected
    // at validation (e.g. op_bad_auth). The account's sequence number is what decides if it can still be submitted.
    let expired = codes?.transaction === 'tx_too_late';
    try {
      const acc = await client.loadAccount(tx.source);
      expired ||= BigInt(acc.sequence) >= BigInt(tx.sequence);
    } catch {
      // Network error: keep the transaction pending, the signers can retry
    }
    return { ok: false, expired, reason: codes ? JSON.stringify(codes) : String(error?.message ?? error) };
  }
}

/**
 * Returns the pending transaction for `purpose`, or builds a new one with `build` when there is none, it expired, or
 * the account's sequence number moved on (another transaction from the account was submitted in between).
 */
export async function getOrCreatePending(
  prisma: PrismaClient,
  purpose: string,
  account: string,
  build: () => Promise<string>,
  client = horizon
) {
  const existing = await prisma.multisigTransaction.findFirst({
    where: { purpose, account, status: 'PENDING', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    const acc = await client.loadAccount(account);
    const tx = new Sdk.Transaction(existing.xdr, PASSPHRASE);
    if (BigInt(tx.sequence) === BigInt(acc.sequence) + 1n) return existing;
    await prisma.multisigTransaction.update({ where: { id: existing.id }, data: { status: 'EXPIRED' } });
  }

  const xdr = await build();
  const tx = new Sdk.Transaction(xdr, PASSPHRASE);
  const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
  return prisma.multisigTransaction.create({
    data: {
      purpose,
      account,
      xdr,
      txHash: tx.hash().toString('hex'),
      expiresAt: maxTime > 0 ? new Date(maxTime * 1000) : new Date(Date.now() + MULTISIG_TX_TIMEOUT_SECONDS * 1000),
    },
  });
}
