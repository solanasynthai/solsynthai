import React, { createContext, useContext, useState, useEffect } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';

interface WalletContextType {
  connected: boolean;
  publicKey: PublicKey | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (transaction: any) => Promise<any>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);

  const connect = async () => {
    // Implement wallet connection logic
  };

  const disconnect = async () => {
    // Implement wallet disconnection logic
  };

  const signTransaction = async (transaction: any) => {
    // Implement transaction signing logic
  };

  return (
    <WalletContext.Provider value={{
      connected,
      publicKey,
      connect,
      disconnect,
      signTransaction
    }}>
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletContextProvider');
  }
  return context;
};

# File: /frontend/src/contexts/ContractContext.tsx

import React, { createContext, useContext, useState } from 'react';

interface Contract {
  id: string;
  name: string;
  code: string;
  template: string;
  status: 'draft' | 'compiled' | 'deployed';
}

interface ContractContextType {
  contracts: Contract[];
  currentContract: Contract | null;
  setCurrentContract: (contract: Contract | null) => void;
  addContract: (contract: Contract) => void;
  updateContract: (id: string, updates: Partial<Contract>) => void;
  deleteContract: (id: string) => void;
}

const ContractContext = createContext<ContractContextType | undefined>(undefined);

export const ContractContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [currentContract, setCurrentContract] = useState<Contract | null>(null);

  const addContract = (contract: Contract) => {
    setContracts(prev => [...prev, contract]);
  };

  const updateContract = (id: string, updates: Partial<Contract>) => {
    setContracts(prev => prev.map(contract => 
      contract.id === id ? { ...contract, ...updates } : contract
    ));
  };

  const deleteContract = (id: string) => {
    setContracts(prev => prev.filter(contract => contract.id !== id));
  };

  return (
    <ContractContext.Provider value={{
      contracts,
      currentContract,
      setCurrentContract,
      addContract,
      updateContract,
      deleteContract
    }}>
      {children}
    </ContractContext.Provider>
  );
};

export const useContract = () => {
  const context = useContext(ContractContext);
  if (context === undefined) {
    throw new Error('useContract must be used within a ContractContextProvider');
  }
  return context;
};
