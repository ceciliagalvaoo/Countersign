export interface Receivable {
  id: string;
  fundId: string;
  cedenteId?: string | null;
  sacadoId: string;
  faceValue: number;
  dueDate: string;
  status: 'PENDING' | 'PAID' | 'DISTRIBUTED';
  paidValue?: number | null;
  paidAt?: string | null;
  createdAt?: string;
  chainStatus: string;
  chainTxHash?: string | null;
  fund?: { name: string; symbol: string };
  cedente?: { name: string; document?: string } | null;
  sacado?: { name: string; document?: string };
}

export interface ChainStep {
  stepId?: string;
  label?: string;
  entity?: { id: string; name: string; kind: string };
  step?: string;
  state?: string;
  txHash?: string;
  verificationHash?: string;
  multisig?: {
    id: string; signers: { key: string; weight: number }[];
    threshold: number; signedBy: string[]; weight: number; expiresAt: string;
  };
}
export interface ChainResponse extends ChainStep {
  done: boolean;
  verified?: boolean;
  verificationRequired?: boolean;
  reviewRequired?: boolean;
  signer?: string;
  transactionXdr?: string;
  chainStatus?: string;
}
export interface ChainProgress { chainStatus: string; steps: ChainStep[] }
export interface SignatureResult {
  submitted: boolean; txHash?: string; signedBy: string[]; weight: number; threshold: number;
}
