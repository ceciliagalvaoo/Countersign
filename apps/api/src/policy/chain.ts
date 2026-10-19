import * as Sdk from '@stellar/stellar-sdk';
import { readContract, toAddressVal } from '../services/soroban.js';
import { readOnChainBadge } from '../services/zkBadge.js';
import { getMandateWalletContractId } from '../services/mandateWallet.js';

/**
 * Everything the policy reads from the network, behind one interface so the rules stay pure and the tests can
 * inject a fake. The default implementation reads the investor's mandate wallet contract (views agreed in
 * projeto/Agents/README.md section 6) and the BadgeVerifier contract by simulation (readContract).
 */
export interface ChainReader {
  /** Mandate wallet contract (C...) of this investor, or null when she has not deployed one */
  walletFor(userId: string): Promise<string | null>;
  /** mandate_hash() as 64 hex characters */
  mandateHash(wallet: string): Promise<string>;
  /** owner() of the wallet (the investor's G... address) */
  owner(wallet: string): Promise<string>;
  /** spent_in_period() in USDC units (7 decimals) */
  spentInPeriod(wallet: string): Promise<bigint>;
  /** is_revoked(): the owner revoked the agent */
  isRevoked(wallet: string): Promise<boolean>;
  /** fund(fund_wallet): true when the fund wallet is in the wallet's on-chain allowlist */
  fundAllowed(wallet: string, fundWallet: string): Promise<boolean>;
  /** BadgeVerifier badge(owner).threshold in USDC cents, or null when there is no badge */
  badgeThresholdCents(owner: string): Promise<number | null>;
}

const toHex = (v: unknown): string => {
  if (v instanceof Uint8Array) return Buffer.from(v).toString('hex');
  if (typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase();
  throw new Error('Unexpected mandate_hash value');
};

export const sorobanChainReader: ChainReader = {
  async walletFor(userId) {
    return getMandateWalletContractId(userId);
  },
  async mandateHash(wallet) {
    return toHex(await readContract(wallet, 'mandate_hash'));
  },
  async owner(wallet) {
    return String(await readContract<string>(wallet, 'owner'));
  },
  async spentInPeriod(wallet) {
    return BigInt(await readContract<bigint | number>(wallet, 'spent_in_period'));
  },
  async isRevoked(wallet) {
    return (await readContract<boolean>(wallet, 'is_revoked')) === true;
  },
  async fundAllowed(wallet, fundWallet) {
    const entry = await readContract<unknown>(wallet, 'fund', [toAddressVal(fundWallet)]);
    return entry !== null && entry !== undefined;
  },
  async badgeThresholdCents(owner) {
    if (!Sdk.StrKey.isValidEd25519PublicKey(owner)) return null;
    const badge = await readOnChainBadge(owner);
    return badge ? badge.threshold : null;
  },
};

let current: ChainReader = sorobanChainReader;

export function getChainReader(): ChainReader {
  return current;
}

/** Test hook: replaces the chain reader (returns the previous one) */
export function setChainReader(reader: ChainReader): ChainReader {
  const prev = current;
  current = reader;
  return prev;
}
