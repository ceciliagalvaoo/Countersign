import { useState } from 'react';
import * as StellarSdk from '@stellar/stellar-sdk';
import toast from 'react-hot-toast';
import { orderService } from '../services/api';
import { useWallet } from '../contexts/WalletContext';
import { buildPaymentTransaction } from '../utils/stellar';
import { getErrorMessage } from '../utils/errorHandler';

interface Order {
  id: string;
  quantity: number;
  total: number;
  investor: {
    publicKey?: string;
  };
  fund: {
    name: string;
    symbol: string;
  };
}

export const useOrderApproval = (onSuccess: () => void) => {
  const { publicKey, isConnected, connect, signAndSubmitTransaction } = useWallet();
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleApprove = async (order: Order) => {
    if (!isConnected || !publicKey) {
      toast.error('Please connect your wallet to approve investments');
      await connect();
      return;
    }

    setProcessingId(order.id);
    const toastId = toast.loading('Preparing the fund unit mint...');
    try {
      // The API returns, one at a time, the transactions the fund wallet must sign on the fund's
      // FundToken contract: whitelist_add (allowlist, simulated onboarding check) when needed, then mint. The mint hash is then verified on-chain.
      let whitelistTxHash: string | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await orderService.approve(order.id, 'approve', undefined, undefined, whitelistTxHash);
        if (!response.requiresTransaction) break;

        if (response.signer !== publicKey) {
          toast.error('Connect the fund wallet (the FundToken admin) to approve this order', { id: toastId });
          return;
        }

        toast.loading(response.step === 'whitelist' ? 'Adding the investor to the fund allowlist (simulated onboarding check)...' : 'Minting fund units (issuer countersignature)...', { id: toastId });
        const txHash = await signAndSubmitTransaction(response.transactionXdr);
        if (response.step === 'whitelist') whitelistTxHash = txHash;

        if (response.step === 'mint') {
          await orderService.approve(order.id, 'approve', undefined, txHash);
          toast.success(
            `Countersigned: ${response.mintDetails.amount} ${response.mintDetails.fundSymbol} fund units minted, verified on-chain.`,
            { id: toastId }
          );
          onSuccess();
          return;
        }
      }
      toast.error('Could not complete the fund unit mint', { id: toastId });
    } catch (error: any) {
      console.error('Approval error:', error);
      toast.error(getErrorMessage(error), { id: toastId });
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (order: Order) => {
    if (!isConnected || !publicKey) {
      toast.error('Please connect your wallet to process refunds');
      await connect();
      return;
    }

    setProcessingId(order.id);
    try {
      // Step 1: Request rejection and get refund details
      const response = await orderService.approve(order.id, 'reject');

      if (response.requiresRefund && response.refundDetails) {
        // The API only accepts a refund sent by the fund wallet that received the payment
        if (response.refundDetails.source && response.refundDetails.source !== publicKey) {
          const src: string = response.refundDetails.source;
          toast.error(`Connect the fund wallet (${src.slice(0, 4)}...${src.slice(-4)}) to send the refund`);
          return;
        }
        const toastId = toast.loading('Processing refund...');

        try {
          // Step 2: sign the refund. A mandate wallet (C...) is refunded by a USDC SAC transfer the API built
          // (a classic payment cannot reach a contract address); other orders keep the classic payment with memo.
          let refundXdr: string;
          if (response.refundDetails.method === 'sac_transfer' && response.refundDetails.transactionXdr) {
            refundXdr = response.refundDetails.transactionXdr;
          } else {
            const transaction = await buildPaymentTransaction({
              sourcePublicKey: publicKey,
              destination: response.refundDetails.destination,
              amount: response.refundDetails.amount,
              memo: response.refundDetails.memo,
              // Refunds go back in the payment asset (USDC)
              asset: new StellarSdk.Asset(response.refundDetails.asset.code, response.refundDetails.asset.issuer),
            });
            refundXdr = transaction.toXDR();
          }

          const refundTxHash = await signAndSubmitTransaction(refundXdr);

          toast.dismiss(toastId);
          toast.success(`Refund sent! Tx: ${refundTxHash.substring(0, 8)}...`);

          // Step 3: Complete rejection with refund tx hash
          await orderService.approve(order.id, 'reject', refundTxHash);
          
          toast.success('Investment rejected and refunded successfully!');
          onSuccess();
        } catch (refundError: any) {
          toast.dismiss(toastId);
          console.error('Refund error:', refundError);
          toast.error(refundError.message || 'Failed to process refund');
        }
      } else {
        toast.success('Investment rejected successfully!');
        onSuccess();
      }
    } catch (error: any) {
      console.error('Rejection error:', error);
      toast.error(getErrorMessage(error));
    } finally {
      setProcessingId(null);
    }
  };

  return {
    processingId,
    handleApprove,
    handleReject,
  };
};
