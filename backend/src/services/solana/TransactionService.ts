import {
  Connection,
  Transaction,
  PublicKey,
  TransactionInstruction,
  Commitment,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { Redis } from 'ioredis';
import { MetricsService } from '../monitoring/MetricsService';
import { logger } from '../../utils/logger';
import { ApiError } from '../../utils/errors';
import { config } from '../../config';
import type { 
  TransactionFees, 
  TransactionSimulation,
  SimulationResult,
  PriorityLevel
} from '../../types/transactions';

export class TransactionService {
  private static instance: TransactionService;
  private redis: Redis;
  private metrics: MetricsService;

  private readonly SIMULATION_CACHE_PREFIX = 'sim:';
  private readonly SIMULATION_CACHE_TTL = 300; // 5 minutes
  private readonly MAX_COMPUTE_UNITS = 1_400_000;
  private readonly DEFAULT_PRIORITY_FEES = {
    low: 1000,
    medium: 10000,
    high: 100000
  };

  private constructor() {
    this.redis = new Redis(config.redis.url);
    this.metrics = MetricsService.getInstance();
  }

  public static getInstance(): TransactionService {
    if (!TransactionService.instance) {
      TransactionService.instance = new TransactionService();
    }
    return TransactionService.instance;
  }

  public async estimateFees(
    connection: Connection,
    transaction: Transaction,
    commitment: Commitment = 'confirmed'
  ): Promise<TransactionFees> {
    const startTime = Date.now();

    try {
      // Get recent blockhash and fee calculator
      const { blockhash, lastValidBlockHeight, feeCalculator } = 
        await connection.getLatestBlockhashAndContext(commitment);

      // Set transaction properties
      transaction.recentBlockhash = blockhash;
      transaction.lastValidBlockHeight = lastValidBlockHeight;

      // Calculate base fee
      const baseFee = feeCalculator.lamportsPerSignature * transaction.signatures.length;

      // Simulate transaction to get compute units
      const simulation = await this.simulateTransaction(connection, transaction);
      const computeUnits = simulation.unitsConsumed || 0;

      // Calculate priority fee based on network congestion
      const priorityFee = await this.calculatePriorityFee(connection, 'medium');

      const totalFees = baseFee + priorityFee;

      this.metrics.timing('transaction.fee_estimation', Date.now() - startTime);

      return {
        baseFee,
        priorityFee,
        computeUnits,
        totalFees,
        lamportsPerSignature: feeCalculator.lamportsPerSignature,
        lastValidBlockHeight,
        estimation: {
          solana: totalFees / LAMPORTS_PER_SOL,
          usd: await this.convertSolToUsd(totalFees)
        }
      };

    } catch (error) {
      this.metrics.increment('transaction.fee_estimation_error');
      logger.error('Fee estimation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new ApiError('FEE_ESTIMATION_FAILED', 'Failed to estimate transaction fees');
    }
  }

  public async simulateTransaction(
    connection: Connection,
    transaction: Transaction
  ): Promise<SimulationResult> {
    const cacheKey = `${this.SIMULATION_CACHE_PREFIX}${transaction.signature}`;
    
    try {
      // Check cache
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.metrics.increment('transaction.simulation_cache_hit');
        return JSON.parse(cached);
      }

      // Add compute budget instruction if not present
      if (!this.hasComputeBudgetInstruction(transaction)) {
        transaction.instructions.unshift(
          ComputeBudgetProgram.setComputeUnitLimit({
            units: this.MAX_COMPUTE_UNITS
          })
        );
      }

      // Simulate transaction
      const simulation = await connection.simulateTransaction(transaction);

      if (simulation.value.err) {
        throw new ApiError('SIMULATION_FAILED', simulation.value.err.toString());
      }

      const result: SimulationResult = {
        successful: true,
        unitsConsumed: simulation.value.unitsConsumed || 0,
        logs: simulation.value.logs || [],
        accounts: this.parseAffectedAccounts(simulation),
        returnData: simulation.value.returnData
      };

      // Cache successful simulation
      await this.redis.set(
        cacheKey,
        JSON.stringify(result),
        'EX',
        this.SIMULATION_CACHE_TTL
      );

      return result;

    } catch (error) {
      this.metrics.increment('transaction.simulation_error');
      throw error;
    }
  }

  public async createVersionedTransaction(
    connection: Connection,
    instructions: TransactionInstruction[],
    feePayer: PublicKey,
    priorityLevel: PriorityLevel = 'medium'
  ): Promise<VersionedTransaction> {
    try {
      // Get latest blockhash
      const { blockhash } = await connection.getLatestBlockhash();

      // Add compute budget and priority fee instructions
      const priorityFee = await this.calculatePriorityFee(connection, priorityLevel);
      const computeBudgetIx = [
        ComputeBudgetProgram.setComputeUnitLimit({
          units: this.MAX_COMPUTE_UNITS
        }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: priorityFee
        })
      ];

      // Create transaction message
      const message = new TransactionMessage({
        payerKey: feePayer,
        recentBlockhash: blockhash,
        instructions: [...computeBudgetIx, ...instructions]
      }).compileToV0Message();

      return new VersionedTransaction(message);

    } catch (error) {
      this.metrics.increment('transaction.creation_error');
      throw new ApiError('TRANSACTION_CREATION_FAILED', 'Failed to create transaction');
    }
  }

  private async calculatePriorityFee(
    connection: Connection,
    priority: PriorityLevel
  ): Promise<number> {
    try {
      // Get recent priority fee levels
      const priorityFees = await connection.getRecentPrioritizationFees();
      
      if (priorityFees.length === 0) {
        return this.DEFAULT_PRIORITY_FEES[priority];
      }

      // Calculate fee based on recent transactions
      const sortedFees = priorityFees
        .map(fee => fee.prioritizationFee)
        .sort((a, b) => a - b);

      const feePercentiles = {
        low: sortedFees[Math.floor(sortedFees.length * 0.25)],
        medium: sortedFees[Math.floor(sortedFees.length * 0.5)],
        high: sortedFees[Math.floor(sortedFees.length * 0.75)]
      };

      return feePercentiles[priority] || this.DEFAULT_PRIORITY_FEES[priority];

    } catch (error) {
      logger.warn('Failed to calculate priority fee, using default', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return this.DEFAULT_PRIORITY_FEES[priority];
    }
  }

  private hasComputeBudgetInstruction(transaction: Transaction): boolean {
    return transaction.instructions.some(
      ix => ix.programId.equals(ComputeBudgetProgram.programId)
    );
  }

  private parseAffectedAccounts(simulation: TransactionSimulation): string[] {
    const accounts = new Set<string>();
    
    simulation.value.accounts?.forEach(account => {
      if (account?.executable) {
        accounts.add(account.pubkey.toString());
      }
    });

    return Array.from(accounts);
  }

  private async convertSolToUsd(lamports: number): Promise<number> {
    try {
      // Get SOL/USD price from cache or API
      const price = await this.getSolanaPrice();
      return (lamports / LAMPORTS_PER_SOL) * price;
    } catch {
      return 0;
    }
  }

  private async getSolanaPrice(): Promise<number> {
    const cacheKey = 'price:sol-usd';
    
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return parseFloat(cached);
      }

      // Fetch price from CoinGecko API
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
      );
      const data = await response.json();
      const price = data.solana.usd;

      // Cache price for 5 minutes
      await this.redis.set(cacheKey, price.toString(), 'EX', 300);

      return price;
    } catch {
      return 0;
    }
  }
}

export default TransactionService.getInstance();
