import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
  BPF_LOADER_PROGRAM_ID
} from '@solana/web3.js';
import { Redis } from 'ioredis';
import { MetricsService } from '../monitoring/MetricsService';
import { TransactionService } from './TransactionService';
import { ContractCache } from '../cache/ContractCache';
import { logger } from '../../utils/logger';
import { ApiError } from '../../utils/errors';
import { config } from '../../config';
import type { 
  DeploymentRequest,
  DeploymentStatus,
  DeploymentMetadata,
  NetworkType,
  DeploymentResult 
} from '../../types/contracts';

export class DeploymentService {
  private static instance: DeploymentService;
  private redis: Redis;
  private metrics: MetricsService;
  private txService: TransactionService;
  private cache: ContractCache;

  private readonly DEPLOYMENT_PREFIX = 'deployment:';
  private readonly STATUS_EXPIRY = 86400; // 24 hours
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 5000; // 5 seconds

  private constructor() {
    this.redis = new Redis(config.redis.url);
    this.metrics = MetricsService.getInstance();
    this.txService = TransactionService.getInstance();
    this.cache = ContractCache.getInstance();
  }

  public static getInstance(): DeploymentService {
    if (!DeploymentService.instance) {
      DeploymentService.instance = new DeploymentService();
    }
    return DeploymentService.instance;
  }

  public async createDeploymentTransaction(params: {
    connection: Connection;
    programId: PublicKey;
    compiledContract: Buffer;
    upgradeAuthority?: PublicKey;
    params?: Record<string, any>;
    metadata?: DeploymentMetadata;
  }): Promise<Transaction> {
    const {
      connection,
      programId,
      compiledContract,
      upgradeAuthority,
      params
    } = params;

    try {
      // Calculate required space and rent
      const programDataSize = compiledContract.length;
      const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(
        programDataSize
      );

      // Create program account
      const transaction = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: upgradeAuthority || programId,
          newAccountPubkey: programId,
          lamports: rentExemptBalance,
          space: programDataSize,
          programId: BPF_LOADER_PROGRAM_ID
        })
      );

      // Load program data
      const chunks = this.chunkProgramData(compiledContract);
      let offset = 0;

      for (const chunk of chunks) {
        transaction.add(
          this.createLoadInstruction(
            programId,
            BPF_LOADER_PROGRAM_ID,
            chunk,
            offset
          )
        );
        offset += chunk.length;
      }

      // Initialize program if params provided
      if (params) {
        transaction.add(
          await this.createInitializeInstruction(
            programId,
            params,
            upgradeAuthority
          )
        );
      }

      return transaction;

    } catch (error) {
      logger.error('Failed to create deployment transaction', {
        error: error instanceof Error ? error.message : 'Unknown error',
        programId: programId.toString()
      });
      throw new ApiError('DEPLOYMENT_PREPARATION_FAILED', 'Failed to prepare deployment transaction');
    }
  }

  public async queueDeployment(request: DeploymentRequest): Promise<string> {
    const deploymentId = request.deploymentId;
    
    try {
      // Store deployment data
      await this.redis.hset(
        `${this.DEPLOYMENT_PREFIX}${deploymentId}`,
        {
          status: 'queued',
          timestamp: Date.now(),
          retries: 0,
          ...request
        }
      );

      // Add to deployment queue
      await this.redis.lpush('deployment:queue', deploymentId);

      this.metrics.increment('deployment.queued', {
        network: request.network
      });

      return deploymentId;

    } catch (error) {
      logger.error('Failed to queue deployment', {
        error: error instanceof Error ? error.message : 'Unknown error',
        deploymentId
      });
      throw new ApiError('DEPLOYMENT_QUEUE_FAILED', 'Failed to queue deployment');
    }
  }

  public async processDeployment(deploymentId: string): Promise<DeploymentResult> {
    const deployment = await this.getDeployment(deploymentId);
    if (!deployment) {
      throw new ApiError('DEPLOYMENT_NOT_FOUND', 'Deployment not found');
    }

    try {
      // Update status
      await this.updateDeploymentStatus(deploymentId, 'processing');

      // Get connection for network
      const connection = new Connection(
        config.solana.networks[deployment.network as NetworkType],
        'confirmed'
      );

      // Send transaction
      const signature = await sendAndConfirmTransaction(
        connection,
        deployment.transaction,
        [deployment.programId]
      );

      // Verify deployment
      const programInfo = await connection.getAccountInfo(
        new PublicKey(deployment.programId)
      );

      if (!programInfo?.executable) {
        throw new ApiError('DEPLOYMENT_VERIFICATION_FAILED', 'Program not deployed correctly');
      }

      // Update status and store result
      const result: DeploymentResult = {
        programId: deployment.programId.toString(),
        signature,
        timestamp: new Date().toISOString(),
        network: deployment.network
      };

      await this.updateDeploymentStatus(deploymentId, 'completed', result);

      this.metrics.increment('deployment.success', {
        network: deployment.network
      });

      return result;

    } catch (error) {
      const retries = await this.incrementRetryCount(deploymentId);
      
      if (retries < this.MAX_RETRIES) {
        // Requeue with delay
        setTimeout(() => this.queueDeployment(deployment), this.RETRY_DELAY);
        await this.updateDeploymentStatus(deploymentId, 'retrying');
      } else {
        await this.updateDeploymentStatus(deploymentId, 'failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        this.metrics.increment('deployment.failed', {
          network: deployment.network,
          errorType: error instanceof ApiError ? error.code : 'UNKNOWN'
        });

        throw error;
      }
    }
  }

  public async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus | null> {
    const status = await this.redis.hgetall(`${this.DEPLOYMENT_PREFIX}${deploymentId}`);
    return status.status ? status as DeploymentStatus : null;
  }

  private createLoadInstruction(
    programId: PublicKey,
    programDataId: PublicKey,
    data: Buffer,
    offset: number
  ): TransactionInstruction {
    const keys = [
      { pubkey: programId, isSigner: true, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
    ];

    return new TransactionInstruction({
      keys,
      programId: programDataId,
      data: Buffer.concat([
        Buffer.from([0]), // Load instruction
        Buffer.from(new Uint32Array([offset]).buffer),
        data
      ])
    });
  }

  private async createInitializeInstruction(
    programId: PublicKey,
    params: Record<string, any>,
    upgradeAuthority?: PublicKey
  ): Promise<TransactionInstruction> {
    // Implementation specific to your program's initialization needs
    // This is a placeholder - implement based on your program's requirements
    return new TransactionInstruction({
      keys: [
        { pubkey: programId, isSigner: false, isWritable: true },
        { pubkey: upgradeAuthority || programId, isSigner: true, isWritable: false }
      ],
      programId,
      data: Buffer.from([1, ...Object.values(params)]) // Initialize instruction
    });
  }

  private chunkProgramData(data: Buffer): Buffer[] {
    const chunkSize = 900; // Solana transaction size limit consideration
    const chunks: Buffer[] = [];
    
    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.slice(i, i + chunkSize));
    }
    
    return chunks;
  }

  private async updateDeploymentStatus(
    deploymentId: string,
    status: string,
    data?: any
  ): Promise<void> {
    const key = `${this.DEPLOYMENT_PREFIX}${deploymentId}`;
    await this.redis.hset(key, 'status', status);
    
    if (data) {
      await this.redis.hset(key, 'result', JSON.stringify(data));
    }
    
    await this.redis.expire(key, this.STATUS_EXPIRY);
  }

  private async incrementRetryCount(deploymentId: string): Promise<number> {
    const key = `${this.DEPLOYMENT_PREFIX}${deploymentId}`;
    return await this.redis.hincrby(key, 'retries', 1);
  }
}

export default DeploymentService.getInstance();
