import axios from 'axios';
import api from './api';
import type {
  ApproveMandateResponse,
  BuiltTransaction,
  ChainVerifyResult,
  DecisionLogEntry,
  MandateOverview,
  OrderRow,
  PurchasesResponse,
  WalletState,
} from '../types/countersign';
import { toWalletState } from '../types/countersign';

/**
 * Countersign API calls of the /agent page and of the issuer's pause button, all with the investor's
 * (or manager's) full JWT already set on the shared axios instance by AuthContext.
 * Payloads reconciled with apps/api/src/routes/mandateWallet.ts (stellar-integrator, 18/10).
 */

/** Owner functions of the mandate wallet the investor signs on the card (OWNER_METHODS of the API) */
export type OwnerMethod = 'set_limits' | 'allow_fund' | 'disallow_fund' | 'revoke_agent' | 'set_agent' | 'withdraw' | 'withdraw_units';

/** params of build-call and confirm-call; the API reads fund_wallet and fund_token from its database */
export interface OwnerParams {
  fundId?: string;
  /** allow_fund: required, decimal USDC */
  fundCapUsdc?: string;
  /** withdraw: decimal USDC */
  amountUsdc?: string;
  /** withdraw_units: decimal fund units */
  units?: string;
}

export const mandateWalletService = {
  /** null when the investor has no mandate wallet yet ({ wallet: null }) */
  get: async (): Promise<WalletState | null> => {
    try {
      const r = await api.get('/mandate-wallet');
      return toWalletState(r.data);
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 404) return null;
      throw e;
    }
  },
  /** Without limits the API takes the caps and mandate_hash of her approved mandate; 400 when none is approved */
  buildDeploy: async (ownerPublicKey: string) =>
    (await api.post('/mandate-wallet/build-deploy', { ownerPublicKey })).data as BuiltTransaction & { agentPublicKey?: string; limitsSource?: string },
  confirmDeploy: async (txHash: string) => (await api.post('/mandate-wallet/confirm', { txHash })).data as Record<string, unknown>,
  buildCall: async (method: OwnerMethod, params: OwnerParams = {}) =>
    (await api.post('/mandate-wallet/build-call', { method, params })).data as BuiltTransaction,
  confirmCall: async (txHash: string, method: OwnerMethod, params: OwnerParams = {}) =>
    (await api.post('/mandate-wallet/confirm-call', { txHash, method, params })).data as Record<string, unknown>,
  buildDeposit: async (amountUsdc: string) => (await api.post('/mandate-wallet/build-deposit', { amountUsdc })).data as BuiltTransaction,
  confirmDeposit: async (txHash: string, amountUsdc: string) =>
    (await api.post('/mandate-wallet/confirm-deposit', { txHash, amountUsdc })).data as Record<string, unknown>,
  purchases: async () => (await api.get('/mandate-wallet/purchases')).data as PurchasesResponse,
};

export const txService = {
  /** POST /api/tx/decode { transactionXdr } -> { decoded } (adapted by toDecodedCall) */
  decode: async (transactionXdr: string) => {
    const r = await api.post('/tx/decode', { transactionXdr });
    const d = r.data as Record<string, unknown>;
    return (d && typeof d === 'object' && 'decoded' in d ? d.decoded : d) as unknown;
  },
};

export const mandateService = {
  overview: async () => (await api.get('/mandates')).data as MandateOverview,
  approve: async (mandateHash: string) => (await api.post('/mandates/approve', { mandateHash })).data as ApproveMandateResponse,
};

export const decisionLogService = {
  list: async (limit = 200) => ((await api.get('/decision-log', { params: { limit } })).data as { entries: DecisionLogEntry[] }).entries,
  verify: async () => (await api.get('/decision-log/verify')).data as ChainVerifyResult,
};

export const agentTokenService = {
  /** POST /api/agent/session-token with the full JWT; the agent scope token is the only one apps/agent receives */
  mint: async () => (await api.post('/agent/session-token')).data as { token: string; scope: 'agent'; expiresIn: number; userId: string },
};

export const countersignOrders = {
  list: async () => ((await api.get('/orders')).data as { orders: OrderRow[] }).orders,
};

export const stellarConfigService = {
  get: async () =>
    (await api.get('/stellar/config')).data as { network: string; paymentAsset?: { code: string; issuer: string } | null },
};

export const fundPauseService = {
  // body { paused } ; response { transactionXdr, decoded, signer }
  build: async (fundId: string, paused: boolean) => (await api.post(`/funds/${fundId}/pause/build`, { paused })).data as BuiltTransaction,
  // body { txHash, paused }
  confirm: async (fundId: string, txHash: string, paused: boolean) =>
    (await api.post(`/funds/${fundId}/pause/confirm`, { txHash, paused })).data as { paused?: boolean; txHash?: string },
};
