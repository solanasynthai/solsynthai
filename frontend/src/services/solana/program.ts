import { Connection, PublicKey } from '@solana/web3.js';
import { getConnection } from './connection';

export interface ProgramInfo {
  programId: string;
  owner: string;
  executable: boolean;
  lamports: number;
  dataSize: number;
}

export const getProgramInfo = async (
  programId: string,
  network: 'mainnet-beta' | 'testnet' | 'devnet' = 'devnet'
): Promise<ProgramInfo> => {
  const connection = getConnection(network);
  
  try {
    const publicKey = new PublicKey(programId);
    const accountInfo = await connection.getAccountInfo(publicKey);
    
    if (!accountInfo) {
      throw new Error('Program not found');
    }

    return {
      programId,
      owner: accountInfo.owner.toString(),
      executable: accountInfo.executable,
      lamports: accountInfo.lamports,
      dataSize: accountInfo.data.length,
    };
  } catch (error) {
    console.error('Error fetching program info:', error);
    throw error;
  }
};
