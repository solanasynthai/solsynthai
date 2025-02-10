import {
  Connection,
  Keypair,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  PublicKey,
} from '@solana/web3.js';
import { getConnection } from './connection';
import config from '../../config';
import { DeploymentResult } from '../../types';

export const deployContract = async (
  compiledCode: string,
  network: 'mainnet-beta' | 'testnet' | 'devnet' = 'devnet'
): Promise<DeploymentResult> => {
  try {
    const connection = getConnection(network);
    const wallet = loadDeployerWallet();

    // Create program account
    const programId = Keypair.generate();
    const programAccount = await createProgramAccount(
      connection,
      wallet,
      programId.publicKey,
      compiledCode
    );

    // Deploy program
    const transaction = await deployProgram(
      connection,
      wallet,
      programId,
      compiledCode
    );

    return {
      success: true,
      programId: programId.publicKey.toString(),
      transactionId: transaction
    };
  } catch (error) {
    console.error('Deployment Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};

const loadDeployerWallet = (): Keypair => {
  if (!config.solana.walletPrivateKey) {
    throw new Error('Deployer wallet private key not configured');
  }

  const privateKey = Buffer.from(config.solana.walletPrivateKey, 'base64');
  return Keypair.fromSecretKey(privateKey);
};

const createProgramAccount = async (
  connection: Connection,
  wallet: Keypair,
  programId: PublicKey,
  compiledCode: string
): Promise<string> => {
  const programDataSize = compiledCode.length;
  
  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: programId,
      lamports: await connection.getMinimumBalanceForRentExemption(programDataSize),
      space: programDataSize,
      programId: new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')
    })
  );

  return await sendAndConfirmTransaction(connection, transaction, [wallet]);
};

const deployProgram = async (
  connection: Connection,
  wallet: Keypair,
  programId: Keypair,
  compiledCode: string
): Promise<string> => {
  // Implementation would include the actual program deployment logic
  // This is a placeholder for the actual implementation
  return 'transaction_signature_placeholder';
};

# File: /backend/src/services/solana/program.ts

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
