import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  PublicKey,
  Transaction,
  Connection,
  VersionedTransaction,
  SendOptions
} from '@solana/web3.js';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { Storage } from '../utils/storage';
import { ErrorWithCode } from '../utils/errors';
import { useNotification } from './NotificationContext';

interface WalletContextType {
  connected: boolean;
  publicKey: PublicKey | null;
  connecting: boolean;
  disconnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (transaction: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
  signAllTransactions: (transactions: (Transaction | VersionedTransaction)[]) => Promise<(Transaction | VersionedTransaction)[]>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  sendTransaction: (
    transaction: Transaction | VersionedTransaction,
    options?: SendOptions
  ) => Promise<string>;
}

const WalletContext = createContext<WalletContextType | null>(null);

interface WalletProviderProps {
  children: React.ReactNode;
}

export const WalletProvider: React.FC<WalletProviderProps> = ({ children }) => {
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [wallet, setWallet] = useState<any>(null);
  const [connection] = useState(() => 
    new Connection(import.meta.env.VITE_SOLANA_RPC_URL)
  );

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showNotification } = useNotification();

  // Initialize wallet adapter
  useEffect(() => {
    const initializeWallet = async () => {
      if (window.solana?.isPhantom) {
        setWallet(window.solana);
        if (window.solana.isConnected) {
          setConnected(true);
          setPublicKey(window.solana.publicKey);
          await handleReconnect();
        }
      }
    };

    initializeWallet();
    window.addEventListener('load', initializeWallet);

    return () => {
      window.removeEventListener('load', initializeWallet);
    };
  }, []);

  // Handle wallet connection events
  useEffect(() => {
    if (!wallet) return;

    const handleConnect = async () => {
      setConnected(true);
      setPublicKey(wallet.publicKey);
      await handleReconnect();
    };

    const handleDisconnect = () => {
      setConnected(false);
      setPublicKey(null);
      Storage.remove('auth_token');
      queryClient.clear();
      navigate('/login');
    };

    const handleAccountChange = async (publicKey: PublicKey | null) => {
      if (publicKey && publicKey.toString() !== wallet.publicKey?.toString()) {
        await disconnect();
        await connect();
      }
    };

    wallet.on('connect', handleConnect);
    wallet.on('disconnect', handleDisconnect);
    wallet.on('accountChanged', handleAccountChange);

    return () => {
      wallet.off('connect', handleConnect);
      wallet.off('disconnect', handleDisconnect);
      wallet.off('accountChanged', handleAccountChange);
    };
  }, [wallet]);

  const handleReconnect = async () => {
    const token = Storage.get('auth_token');
    if (token) {
      try {
        await api.getCurrentUser();
      } catch (error) {
        Storage.remove('auth_token');
        navigate('/login');
      }
    }
  };

  const connect = async () => {
    if (!wallet) {
      showNotification({
        type: 'error',
        message: 'Please install Phantom wallet'
      });
      return;
    }

    try {
      setConnecting(true);
      await wallet.connect();

      // Generate and sign login message
      const message = new TextEncoder().encode(
        `Sign this message to connect to SolSynthai\nNonce: ${Date.now()}`
      );
      const signature = await signMessage(message);

      // Authenticate with backend
      await api.login(wallet.publicKey.toString(), Buffer.from(signature).toString('base64'));
      
      showNotification({
        type: 'success',
        message: 'Connected successfully'
      });
    } catch (error: any) {
      showNotification({
        type: 'error',
        message: error.message || 'Failed to connect wallet'
      });
      throw new ErrorWithCode(
        error.message || 'Failed to connect wallet',
        'WALLET_CONNECT_ERROR'
      );
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!wallet) return;

    try {
      setDisconnecting(true);
      await wallet.disconnect();
      await api.logout();
      queryClient.clear();
      Storage.remove('auth_token');
      navigate('/login');
    } catch (error: any) {
      showNotification({
        type: 'error',
        message: error.message || 'Failed to disconnect wallet'
      });
    } finally {
      setDisconnecting(false);
    }
  };

  const signTransaction = async (transaction: Transaction | VersionedTransaction) => {
    if (!wallet || !connected) {
      throw new ErrorWithCode('Wallet not connected', 'WALLET_NOT_CONNECTED');
    }

    try {
      return await wallet.signTransaction(transaction);
    } catch (error: any) {
      throw new ErrorWithCode(
        error.message || 'Failed to sign transaction',
        'TRANSACTION_SIGN_ERROR'
      );
    }
  };

  const signAllTransactions = async (transactions: (Transaction | VersionedTransaction)[]) => {
    if (!wallet || !connected) {
      throw new ErrorWithCode('Wallet not connected', 'WALLET_NOT_CONNECTED');
    }

    try {
      return await wallet.signAllTransactions(transactions);
    } catch (error: any) {
      throw new ErrorWithCode(
        error.message || 'Failed to sign transactions',
        'TRANSACTIONS_SIGN_ERROR'
      );
    }
  };

  const signMessage = async (message: Uint8Array) => {
    if (!wallet || !connected) {
      throw new ErrorWithCode('Wallet not connected', 'WALLET_NOT_CONNECTED');
    }

    try {
      return await wallet.signMessage(message);
    } catch (error: any) {
      throw new ErrorWithCode(
        error.message || 'Failed to sign message',
        'MESSAGE_SIGN_ERROR'
      );
    }
  };

  const sendTransaction = async (
    transaction: Transaction | VersionedTransaction,
    options: SendOptions = {}
  ) => {
    if (!wallet || !connected) {
      throw new ErrorWithCode('Wallet not connected', 'WALLET_NOT_CONNECTED');
    }

    try {
      const signed = await signTransaction(transaction);
      const signature = await connection.sendRawTransaction(
        signed.serialize(),
        options
      );

      if (options.skipPreflight !== true) {
        await connection.confirmTransaction(signature, 'confirmed');
      }

      return signature;
    } catch (error: any) {
      throw new ErrorWithCode(
        error.message || 'Failed to send transaction',
        'TRANSACTION_SEND_ERROR'
      );
    }
  };

  return (
    <WalletContext.Provider
      value={{
        connected,
        publicKey,
        connecting,
        disconnecting,
        connect,
        disconnect,
        signTransaction,
        signAllTransactions,
        signMessage,
        sendTransaction,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};
