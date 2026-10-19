import { Horizon, StrKey } from '@stellar/stellar-sdk';
import { STELLAR_CONFIG } from '../config/stellar.js';

const horizon = new Horizon.Server(STELLAR_CONFIG.HORIZON_URL);

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export const isTxHash = (hash: string) => /^[0-9a-f]{64}$/i.test(hash);

export const isPublicKey = (key: string) => StrKey.isValidEd25519PublicKey(key);

/** Contract address (C...), e.g. an investor's mandate wallet. Never accepted where a G... account is required */
export const isContractAddress = (addr: string) => typeof addr === 'string' && StrKey.isValidContract(addr);

/** Stellar amounts have 7 decimal places; compare them as integer stroops to avoid float errors */
export function toStroops(amount: number | string): bigint {
  return BigInt(Math.round(Number(amount) * 1e7));
}

/** Formats an amount the way Stellar payment operations expect it (max 7 decimals) */
export function toStellarAmount(amount: number): string {
  return (Math.round(amount * 1e7) / 1e7).toFixed(7);
}

async function loadTransaction(hash: string) {
  if (!isTxHash(hash)) return { error: 'Invalid transaction hash' } as const;
  try {
    const tx = await horizon.transactions().transaction(hash).call();
    if (!tx.successful) return { error: 'Transaction failed on-chain' } as const;
    return { tx } as const;
  } catch {
    return { error: 'Transaction not found on the Stellar network' } as const;
  }
}

/** Checks that a transaction exists and succeeded, optionally requiring a source account */
export async function verifyTransaction(hash: string, sourceAccount?: string): Promise<VerifyResult> {
  const result = await loadTransaction(hash);
  if ('error' in result) return { ok: false, reason: result.error as string };
  if (sourceAccount && result.tx.source_account !== sourceAccount) {
    return { ok: false, reason: 'Transaction was not submitted by the expected account' };
  }
  return { ok: true };
}

/**
 * Checks that a transaction contains a successful payment to `to` of at least `amount`.
 * Defaults to native XLM; pass `asset` for an issued asset. `from` and `memo` are checked when given.
 */
export async function verifyPayment(params: {
  hash: string;
  to: string;
  amount: number | string;
  from?: string;
  memo?: string;
  asset?: { code: string; issuer: string };
}): Promise<VerifyResult> {
  const result = await loadTransaction(params.hash);
  if ('error' in result) return { ok: false, reason: result.error as string };
  if (params.memo !== undefined && (result.tx.memo_type !== 'text' || result.tx.memo !== params.memo)) {
    return { ok: false, reason: 'Transaction memo does not match the order' };
  }

  const ops = await horizon.operations().forTransaction(params.hash).limit(100).call();
  const expected = toStroops(params.amount);
  const paid = ops.records.some((op: any) => {
    if (op.type !== 'payment' || op.to !== params.to) return false;
    if (params.from && op.from !== params.from) return false;
    const assetMatches = params.asset
      ? op.asset_code === params.asset.code && op.asset_issuer === params.asset.issuer
      : op.asset_type === 'native';
    return assetMatches && toStroops(op.amount) >= expected;
  });
  return paid ? { ok: true } : { ok: false, reason: 'Transaction does not contain the expected payment' };
}

/** Checks that an account exists and can hold the given issued asset (has a trustline to it) */
export async function hasTrustline(publicKey: string, asset: { code: string; issuer: string }): Promise<boolean> {
  try {
    const account = await horizon.loadAccount(publicKey);
    return account.balances.some(
      (b: any) => b.asset_code === asset.code && b.asset_issuer === asset.issuer
    );
  } catch {
    return false;
  }
}
