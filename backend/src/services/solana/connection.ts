import {
  Connection,
  Keypair,
  clusterApiUrl,
  PublicKey
} from '@solana/web3.js';
import config from '../../config';

export type Network = 'mainnet-beta' | 'testnet' | 'devnet';

export const getConnection = (network: Network = 'devnet'): Connection => {
  const endpoint = config.solana.rpcUrl || clusterApiUrl(network);
  return new Connection(endpoint, 'confirmed');
};

export const getFeeForMessage = async (
  connection: Connection,
  message: Uint8Array
): Promise<number> => {
  const { value } = await connection.getFeeForMessage(message);
  return value ?? 0;
};
