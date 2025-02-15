import { Router } from 'express';
import { z } from 'zod';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AuthMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { DeploymentService } from '../../services/solana/DeploymentService';
import { TransactionService } from '../../services/solana/TransactionService';
import { ContractCache } from '../../services/cache/ContractCache';
import { CompilerService } from '../../services/compiler/CompilerService';
import { ApiError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { MetricsService } from '../../services/monitoring/MetricsService';
import { config } from '../../config';
import type { DeploymentStatus, NetworkType } from '../../types/contracts';

const router = Router();
const metrics = MetricsService.getInstance();
const deploymentService = DeploymentService.getInstance();
const transactionService = TransactionService.getInstance();
const compilerService = CompilerService.getInstance();
const cache = ContractCache.getInstance();

const DeployContractSchema = z.object({
  contractId: z.string().uuid(),
  network: z.enum(['mainnet-beta', 'testnet', 'devnet']),
  upgradeAuthority: z.string().optional(),
  params: z.record(z.string(), z.any()).optional(),
  metadata: z.object({
    name: z.string(),
    symbol: z.string().optional(),
    description: z.string().optional(),
    image: z.string().optional(),
  }).optional(),
});

router.post('/contract',
  AuthMiddleware.authenticate,
  validate(DeployContractSchema),
  async (req, res, next) => {
    const startTime = Date.now();
    const { contractId, network, upgradeAuthority, params, metadata } = req.body;
    const userId = req.user.id;

    try {
      // Verify network access permissions
      if (network === 'mainnet-beta' && !await AuthMiddleware.hasMainnetAccess(userId)) {
        throw new ApiError('UNAUTHORIZED', 'Mainnet deployment requires additional permissions');
      }

      // Get contract from cache or storage
      const contract = await cache.getContract(contractId);
      if (!contract) {
        throw new ApiError('CONTRACT_NOT_FOUND', 'Contract not found');
      }

      // Setup connection based on network
      const connection = new Connection(
        config.solana.networks[network as NetworkType],
        'confirmed'
      );

      // Compile contract if not already compiled
      let compiledContract = await cache.getCompiledContract(contractId);
      if (!compiledContract) {
        logger.info('Compiling contract', { contractId, network });
        compiledContract = await compilerService.compile(contract.code, {
          optimize: true,
          bpfProgram: true,
        });
        await cache.setCompiledContract(contractId, compiledContract);
      }

      // Generate deployment keypair
      const programId = Keypair.generate();
      logger.info('Generated program ID', { 
        contractId, 
        programId: programId.publicKey.toString() 
      });

      // Prepare deployment transaction
      const deploymentTx = await deploymentService.createDeploymentTransaction({
        connection,
        programId: programId.publicKey,
        compiledContract,
        upgradeAuthority: upgradeAuthority ? new PublicKey(upgradeAuthority) : undefined,
        params,
        metadata,
      });

      // Estimate fees
      const fees = await transactionService.estimateFees(connection, deploymentTx);
      
      // Check user balance
      const balance = await connection.getBalance(new PublicKey(req.user.walletAddress));
      if (balance < fees.totalFees) {
        throw new ApiError('INSUFFICIENT_FUNDS', 'Insufficient funds for deployment');
      }

      // Initialize deployment status tracking
      const deploymentId = await deploymentService.initializeDeployment({
        contractId,
        programId: programId.publicKey.toString(),
        network,
        userId,
        status: 'pending' as DeploymentStatus,
      });

      // Queue deployment
      await deploymentService.queueDeployment({
        deploymentId,
        transaction: deploymentTx,
        programId,
        network,
        metadata: {
          contractId,
          userId,
          timestamp: new Date().toISOString(),
        },
      });

      // Record metrics
      metrics.timing('deployment.preparation_time', Date.now() - startTime, { network });
      metrics.increment('deployment.initiated', { network });

      res.json({
        success: true,
        data: {
          deploymentId,
          programId: programId.publicKey.toString(),
          estimatedFees: fees,
          status: 'pending',
        },
      });

    } catch (error) {
      metrics.increment('deployment.error', {
        network,
        errorType: error instanceof ApiError ? error.code : 'UNKNOWN',
      });

      logger.error('Deployment failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        contractId,
        network,
        userId,
      });

      next(error);
    }
  }
);

router.get('/status/:deploymentId',
  AuthMiddleware.authenticate,
  async (req, res, next) => {
    try {
      const deploymentId = req.params.deploymentId;
      const status = await deploymentService.getDeploymentStatus(deploymentId);

      if (!status) {
        throw new ApiError('DEPLOYMENT_NOT_FOUND', 'Deployment not found');
      }

      // Verify ownership
      if (status.userId !== req.user.id) {
        throw new ApiError('UNAUTHORIZED', 'Not authorized to view this deployment');
      }

      res.json({ status });

    } catch (error) {
      next(error);
    }
  }
);

router.post('/verify/:deploymentId',
  AuthMiddleware.authenticate,
  async (req, res, next) => {
    try {
      const deploymentId = req.params.deploymentId;
      const deployment = await deploymentService.getDeployment(deploymentId);

      if (!deployment) {
        throw new ApiError('DEPLOYMENT_NOT_FOUND', 'Deployment not found');
      }

      // Verify deployment ownership
      if (deployment.userId !== req.user.id) {
        throw new ApiError('UNAUTHORIZED', 'Not authorized to verify this deployment');
      }

      const verificationResult = await deploymentService.verifyDeployment(deployment);

      res.json({
        success: true,
        data: verificationResult,
      });

    } catch (error) {
      next(error);
    }
  }
);

export default router;
