import axios from 'axios';
import type { ChainProgress, ChainResponse, Receivable } from '../types/receivableChain';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true'
  },
});

// --- Auth Service ---
export const authService = {
  login: async (credentials: any) => {
    const response = await api.post('/auth/login', credentials);
    return response.data;
  },
  register: async (data: any) => {
    const response = await api.post('/auth/register', data);
    return response.data;
  },
  getProfile: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  },
};

// --- Dashboard Service ---
export const dashboardService = {
  getPendingCounts: async () => {
    const response = await api.get('/dashboard/pending-counts');
    return response.data;
  },
};

// --- User Service ---
export const userService = {
  getConsultores: async () => {
    const response = await api.get('/users/consultores');
    return response.data;
  },
  getInvestidores: async () => {
    const response = await api.get('/users/investidores');
    return response.data;
  },
  approveUser: async (id: string, status: 'APPROVED' | 'REJECTED') => {
    const response = await api.patch(`/users/${id}/approval`, { status });
    return response.data;
  },
  updateWallet: async (publicKey: string) => {
    const response = await api.patch('/users/wallet', { publicKey });
    return response.data;
  },
};

// --- Fund Service ---
export const fundService = {
  list: async () => {
    const response = await api.get('/funds');
    return response.data;
  },
  create: async (data: any) => {
    const response = await api.post('/funds', data);
    return response.data;
  },
  getById: async (id: string) => {
    const response = await api.get(`/funds/${id}`);
    return response.data;
  },
  // Share token (Soroban FundToken): the fund wallet signs the deploy, then the API verifies it on-chain
  buildTokenDeploy: async (id: string, deployer: string) => {
    const response = await api.post(`/funds/${id}/token/build-deploy`, { deployer });
    return response.data as { transactionXdr: string };
  },
  confirmTokenDeploy: async (id: string, txHash: string) => {
    const response = await api.post(`/funds/${id}/token/confirm`, { txHash });
    return response.data as { tokenContractId: string };
  },
  approve: async (id: string, status: 'APPROVED' | 'REJECTED', fundWalletPublicKey?: string) => {
    const response = await api.patch(`/funds/${id}/approval`, { 
      status,
      ...(fundWalletPublicKey && { fundWalletPublicKey })
    });
    return response.data;
  },
  deactivate: async (id: string) => {
    const response = await api.patch(`/funds/${id}/deactivate`);
    return response.data;
  },
  issueQuotas: async (id: string, amount: number) => {
    const response = await api.post(`/funds/${id}/issue`, { amount });
    return response.data;
  },
};

// --- Cedente Service ---
export const cedenteService = {
  list: async () => {
    const response = await api.get('/cedentes');
    return response.data;
  },
  updateStatus: async (id: string, status: 'APPROVED' | 'REJECTED') => {
    const response = await api.patch(`/cedentes/${id}/status`, { status });
    return response.data;
  },
  create: async (data: any) => {
    const response = await api.post('/cedentes', data);
    return response.data;
  },
  listByFund: async (fundId: string) => {
    const response = await api.get(`/cedentes/fund/${fundId}`);
    return response.data;
  }
};

// --- Sacado Service ---
export const sacadoService = {
  list: async () => {
    const response = await api.get('/sacados');
    return response.data;
  },
  updateStatus: async (id: string, status: 'APPROVED' | 'REJECTED') => {
    const response = await api.patch(`/sacados/${id}/status`, { status });
    return response.data;
  },
  create: async (data: any) => {
    const response = await api.post('/sacados', data);
    return response.data;
  },
  listByFund: async (fundId: string) => {
    const response = await api.get(`/sacados/fund/${fundId}`);
    return response.data;
  }
};

// --- Order Service ---
export const orderService = {
  list: async () => {
    const response = await api.get('/orders');
    return response.data;
  },
  create: async (data: any) => {
    const response = await api.post('/orders', data);
    return response.data;
  },
  // Share balances read from each fund's token contract on Stellar
  holdings: async () => {
    const response = await api.get('/orders/holdings');
    return response.data as { holdings: { id: string; symbol: string; tokenContractId: string; shares: number | null; wallets: string[] }[] };
  },
  complete: async (id: string, txHash: string) => {
    const response = await api.patch(`/orders/${id}/complete`, { txHash });
    return response.data;
  },
  cancel: async (id: string) => {
    const response = await api.patch(`/orders/${id}/cancel`);
    return response.data;
  },
  approve: async (id: string, action: 'approve' | 'reject', refundTxHash?: string, tokenMintTxHash?: string, whitelistTxHash?: string) => {
    const response = await api.patch(`/orders/${id}/approve`, { 
      action,
      ...(refundTxHash && { refundTxHash }),
      ...(tokenMintTxHash && { tokenMintTxHash }),
      // Mandate wallet orders: the verified whitelist_add gets its own decision log line
      ...(whitelistTxHash && { whitelistTxHash })
    });
    return response.data;
  }
};

// --- ZK Badge Service ---
export const badgeService = {
  // Opening of the investor's commitment + platform attestation (only for the investor themself)
  zkWitness: async (userId: string) => {
    const response = await api.get(`/badges/${userId}/zk-witness`);
    return response.data;
  },
  buildClaim: async (userId: string, threshold: number, proof: { a: string; b: string; c: string }) => {
    const response = await api.post(`/badges/${userId}/zk-claim/build`, { threshold, proof });
    return response.data as { transactionXdr: string };
  },
  confirmClaim: async (userId: string, txHash: string) => {
    const response = await api.post(`/badges/${userId}/zk-claim/confirm`, { txHash });
    return response.data as { verified: boolean; tier: string };
  },
};

// --- Receivable Service ---
export const receivableService = {
  get: async (id: string): Promise<{ receivable: Receivable }> => {
    const response = await api.get(`/receivables/${id}`);
    return response.data;
  },
  list: async () => {
    const response = await api.get('/receivables');
    return response.data;
  },
  create: async (data: { fundId: string; cedenteId: string; sacadoId: string; faceValue: number; dueDate: string }) => {
    const response = await api.post('/receivables', data);
    return response.data;
  },
  markPaid: async (id: string, paidValue: number) => {
    const response = await api.patch(`/receivables/${id}/mark-paid`, { paidValue });
    return response.data;
  },
  // Next ReceivableVault call to sign (or { done: true }); with txHash, verifies and records it
  progress: async (id: string): Promise<ChainProgress> => {
    const response = await api.get(`/receivables/${id}/chain`);
    return response.data;
  },
  chain: async (id: string, txHash?: string, expectedStepId?: string) => {
    const response = await api.post(`/receivables/${id}/chain`, txHash ? { txHash } : { expectedStepId });
    return response.data as ChainResponse;
  },
};

// --- Multisig Service ---
export const multisigService = {
  // Adds the connected wallet's signature; the API submits once the account's threshold is reached
  sign: async (id: string, signedXdr: string) => {
    const response = await api.post(`/multisig/${id}/sign`, { signedXdr });
    return response.data as { submitted: boolean; txHash?: string; signedBy: string[]; weight: number; threshold: number };
  },
};

// --- Stellar Service ---
export const stellarService = {
  // Testnet only: returns a faucet transaction (trustlines + test USDC) for the user's wallet to sign
  getTestUsdc: async (publicKey: string) => {
    const response = await api.post('/stellar/test-usdc', { publicKey });
    return response.data as { transactionXdr: string };
  },
  getUsdcTrustline: async (publicKey: string) => {
    const response = await api.post('/stellar/usdc-trustline', { publicKey });
    return response.data as { hasTrustline: boolean; transactionXdr: string | null };
  },
  // Testnet only: the operator account sends test USDC once the trustline exists (404 when not deployed)
  sendTestUsdc: async (publicKey: string) => {
    const response = await api.post('/stellar/test-usdc-transfer', { publicKey });
    return response.data as { txHash?: string; amount?: string };
  },
};

// --- Pool Service ---
export const poolService = {
  getAvailablePools: async () => {
    const response = await api.get('/pools/available');
    return response.data;
  },
  list: async () => {
    const response = await api.get('/pools');
    return response.data;
  },
  getById: async (id: string) => {
    const response = await api.get(`/pools/${id}`);
    return response.data;
  },
  getByFund: async (fundId: string) => {
    const response = await api.get(`/funds/${fundId}/pools`);
    return response.data;
  },
  create: async (data: {
    name: string;
    fundId: string;
    blendPoolAddress: string;
    assetAddress: string;
  }) => {
    const response = await api.post('/pools', data);
    return response.data;
  },
  buildDepositTx: async (poolId: string, amount: number, userAddress: string) => {
    const response = await api.post('/pools/build-deposit', {
      poolId,
      amount,
      userAddress,
    });
    return response.data;
  },
  confirmDeposit: async (poolId: string, amount: number, txHash: string) => {
    const response = await api.post('/pools/deposit', {
      poolId,
      amount,
      txHash,
    });
    return response.data;
  },
  buildWithdrawTx: async (poolId: string, amount: number, userAddress: string) => {
    const response = await api.post('/pools/build-withdraw', {
      poolId,
      amount,
      userAddress,
    });
    return response.data;
  },
  confirmWithdraw: async (poolId: string, amount: number, txHash: string) => {
    const response = await api.post('/pools/withdraw', {
      poolId,
      amount,
      txHash,
    });
    return response.data;
  },
  updateYield: async (poolId: string, currentBalance: number, apy?: number) => {
    const response = await api.post(`/pools/${poolId}/update-yield`, {
      currentBalance,
      apy,
    });
    return response.data;
  },
};

export default api;
