import React, { createContext, useContext, useState, useEffect } from 'react';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit/sdk';
import { defaultModules } from '@creit.tech/stellar-wallets-kit/modules/utils';
import { Networks } from '@creit.tech/stellar-wallets-kit/types';
import * as StellarSdk from '@stellar/stellar-sdk';
import { userService } from '../services/api';
import { useAuth } from './useAuth';
import { persistConnectedWallet } from '../services/walletProfile';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';

interface WalletContextType {
  publicKey: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signAndSubmitTransaction: (xdr: string) => Promise<string>;
  // Signs without submitting (adds this wallet's signature, e.g. to a multisig transaction collected by the API)
  signTransaction: (xdr: string) => Promise<string>;
  getBalance: () => Promise<string>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

// The kit is a static singleton in v2; initialize it once per page load
let kitInitialized = false;
function initKit() {
  if (kitInitialized) return;
  StellarWalletsKit.init({
    modules: defaultModules(),
    network: Networks.TESTNET,
    selectedWalletId: localStorage.getItem('stellarWalletId') || undefined,
  });
  kitInitialized = true;
}

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    initKit();

    // Restore a previous connection
    const savedPublicKey = localStorage.getItem('stellarPublicKey');
    if (savedPublicKey) {
      setPublicKey(savedPublicKey);
      setIsConnected(true);
    }
  }, []);

  const connect = async () => {
    initKit();
    try {
      const { address } = await StellarWalletsKit.authModal();
      setPublicKey(address);
      setIsConnected(true);
      localStorage.setItem('stellarPublicKey', address);
      try {
        localStorage.setItem('stellarWalletId', StellarWalletsKit.selectedModule.productId);
      } catch {
        // selected module id is only used to restore the wallet choice after a reload
      }

      // Save the public key (never a secret) to the backend
      try {
        // A manager switches operational multisig signers; that is not a profile wallet change.
        await persistConnectedWallet(user?.role, !!localStorage.getItem('authToken'), address, userService.updateWallet);
      } catch (error) {
        console.error('Failed to save wallet to backend:', error);
      }
    } catch (error) {
      console.error('Error connecting wallet:', error);
    }
  };

  const disconnect = () => {
    setPublicKey(null);
    setIsConnected(false);
    localStorage.removeItem('stellarPublicKey');
    localStorage.removeItem('stellarWalletId');
    StellarWalletsKit.disconnect().catch(() => {});
  };

  const signTransaction = async (xdr: string): Promise<string> => {
    if (!publicKey) {
      throw new Error('Wallet not connected');
    }
    initKit();
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
      address: publicKey,
      networkPassphrase: Networks.TESTNET,
    });
    return signedTxXdr;
  };

  const signAndSubmitTransaction = async (xdr: string): Promise<string> => {
    if (!publicKey) {
      throw new Error('Wallet not connected');
    }
    initKit();

    try {
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
        address: publicKey,
        networkPassphrase: Networks.TESTNET,
      });

      // Submit to Stellar network
      const server = new StellarSdk.Horizon.Server(HORIZON_URL);
      const transaction = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
      const result = await server.submitTransaction(transaction as StellarSdk.Transaction);

      return result.hash;
    } catch (error) {
      console.error('Transaction failed:', error);
      throw error;
    }
  };

  const getBalance = async (): Promise<string> => {
    if (!publicKey) {
      throw new Error('Wallet not connected');
    }

    try {
      const server = new StellarSdk.Horizon.Server(HORIZON_URL);
      const account = await server.loadAccount(publicKey);
      const xlmBalance = account.balances.find((b: any) => b.asset_type === 'native');
      return xlmBalance ? xlmBalance.balance : '0';
    } catch (error) {
      console.error('Failed to get balance:', error);
      throw error;
    }
  };

  return (
    <WalletContext.Provider value={{ publicKey, isConnected, connect, disconnect, signAndSubmitTransaction, signTransaction, getBalance }}>
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};
