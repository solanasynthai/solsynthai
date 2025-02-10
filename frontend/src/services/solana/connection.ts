import { Connection, Keypair, clusterApiUrl } from '@solana/web3.js';

export type Network = 'mainnet-beta' | 'testnet' | 'devnet';

export const getConnection = (network: Network = 'devnet'): Connection => {
  const endpoint = process.env.REACT_APP_SOLANA_RPC_URL || clusterApiUrl(network);
  return new Connection(endpoint, 'confirmed');
};

export const getBalance = async (
  publicKey: string,
  connection: Connection
): Promise<number> => {
  try {
    const balance = await connection.getBalance(Keypair.generate().publicKey);
    return balance / 10 ** 9; // Convert lamports to SOL
  } catch (error) {
    console.error('Error fetching balance:', error);
    throw error;
  }
};
