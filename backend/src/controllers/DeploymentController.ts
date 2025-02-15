import { Request, Response, NextFunction } from 'express';
import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { ErrorWithCode } from '../utils/errors';
import { MetricsService } from '../services/monitoring/MetricsService';
import { logger } from '../utils/logger';
import { config } from '../config';
import { DeploymentStatus, Network } from '../types';
import { BpfLoader } from '../services/solana/BpfLoader';
import { validateProgramSize } from '../utils/validation';

export class DeploymentController {
  private db: Pool;
  private redis: Redis;
  private connections: Map<Network, Connection>;
  private bpfLoader: BpfLoader;

  constructor() {
    this.db = new Pool(config.database);
    this.redis = new Redis(config.redis.url);
    this.connections = new Map(
      Object.entries(config.solana.networks).map(([network, url]) => [
        network as Network,
        new Connection(url, { commitment: 'confirmed' })
      ])
    );
    this.bpfLoader = new BpfLoader();
  }

  public createDeployment = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const {
        contractId,
        network,
        programId,
        metadata = {}
      } = req.body;

      // Validate network
      if (!Object.values(Network).includes(network)) {
        throw new ErrorWithCode('Invalid network', 'INVALID_NETWORK');
      }

      // Get contract
      const { rows: [contract] } = await client.query(`
        SELECT * FROM contracts WHERE id = $1
      `, [contractId]);

      if (!contract) {
        throw new ErrorWithCode('Contract not found', 'CONTRACT_NOT_FOUND');
      }

      // Check contract ownership
      if (contract.author_id !== req.user!.id) {
        throw new ErrorWithCode('Access denied', 'ACCESS_DENIED');
      }

      // Validate program ID
      try {
        new PublicKey(programId);
      } catch {
        throw new ErrorWithCode('Invalid program ID', 'INVALID_PROGRAM_ID');
      }

      // Validate contract status
      if (contract.status !== 'compiled') {
        throw new ErrorWithCode(
          'Contract must be compiled before deployment',
          'INVALID_CONTRACT_STATUS'
        );
      }

      // Validate program size
      const maxSize = config.solana.maxProgramSize;
      if (!validateProgramSize(contract.bytecode, maxSize)) {
        throw new ErrorWithCode(
          `Program size exceeds maximum of ${maxSize} bytes`,
          'PROGRAM_SIZE_EXCEEDED'
        );
      }

      // Create deployment record
      const { rows: [deployment] } = await client.query(`
        INSERT INTO deployments (
          contract_id,
          network,
          program_id,
          deployer_id,
          status,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [
        contractId,
        network,
        programId,
        req.user!.id,
        DeploymentStatus.PENDING,
        metadata
      ]);

      await client.query('COMMIT');

      // Start async deployment
      this.handleDeployment(deployment).catch(error => {
        logger.error('Deployment failed:', { error, deploymentId: deployment.id });
      });

      res.status(201).json(deployment);

      MetricsService.increment('deployment.create', { network });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  };

  public getDeployment = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;

      const { rows: [deployment] } = await this.db.query(`
        SELECT d.*, c.name as contract_name, c.author_id
        FROM deployments d
        JOIN contracts c ON d.contract_id = c.id
        WHERE d.id = $1
      `, [id]);

      if (!deployment) {
        throw new ErrorWithCode('Deployment not found', 'DEPLOYMENT_NOT_FOUND');
      }

      // Check permissions
      if (deployment.author_id !== req.user!.id) {
        throw new ErrorWithCode('Access denied', 'ACCESS_DENIED');
      }

      res.json(deployment);

      MetricsService.increment('deployment.get');
    } catch (error) {
      next(error);
    }
  };

  public listDeployments = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const {
        page = 1,
        limit = 10,
        contractId,
        network,
        status
      } = req.query;

      const offset = (Number(page) - 1) * Number(limit);
      
      let query = `
        SELECT d.*, c.name as contract_name,
        COUNT(*) OVER() as total_count
        FROM deployments d
        JOIN contracts c ON d.contract_id = c.id
        WHERE c.author_id = $1
      `;
      const params: any[] = [req.user!.id];
      let paramCount = 2;

      if (contractId) {
        query += ` AND d.contract_id = $${paramCount}`;
        params.push(contractId);
        paramCount++;
      }

      if (network) {
        query += ` AND d.network = $${paramCount}`;
        params.push(network);
        paramCount++;
      }

      if (status) {
        query += ` AND d.status = $${paramCount}`;
        params.push(status);
        paramCount++;
      }

      query += ` ORDER BY d.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
      params.push(limit, offset);

      const { rows } = await this.db.query(query, params);
      const totalCount = rows[0]?.total_count || 0;

      res.json({
        deployments: rows.map(row => ({
          ...row,
          total_count: undefined
        })),
        total: totalCount,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(totalCount / Number(limit))
      });

      MetricsService.increment('deployment.list', { network, status });
    } catch (error) {
      next(error);
    }
  };

  private async handleDeployment(deployment: any): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // Update status to processing
      await client.query(`
        UPDATE deployments
        SET status = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [DeploymentStatus.PROCESSING, deployment.id]);

      // Get contract bytecode
      const { rows: [contract] } = await client.query(`
        SELECT bytecode FROM contracts WHERE id = $1
      `, [deployment.contract_id]);

      // Get connection for network
      const connection = this.connections.get(deployment.network as Network);
      if (!connection) {
        throw new Error(`No connection for network: ${deployment.network}`);
      }

      // Deploy program
      const programId = new PublicKey(deployment.program_id);
      const result = await this.bpfLoader.load(
        connection,
        contract.bytecode,
        programId
      );

      // Update deployment status
      await client.query(`
        UPDATE deployments
        SET status = $1,
            signature = $2,
            metadata = jsonb_set(
              metadata,
              '{deployment}',
              $3::jsonb
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `, [
        DeploymentStatus.SUCCESS,
        result.signature,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          slot: result.slot,
          computeUnits: result.computeUnits
        }),
        deployment.id
      ]);

      await client.query('COMMIT');

      MetricsService.increment('deployment.success', { 
        network: deployment.network 
      });
    } catch (error) {
      await client.query('ROLLBACK');

      // Update deployment with error
      await this.db.query(`
        UPDATE deployments
        SET status = $1,
            error_message = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [
        DeploymentStatus.FAILED,
        error.message,
        deployment.id
      ]);

      MetricsService.increment('deployment.failure', { 
        network: deployment.network,
        error: error.code || 'UNKNOWN'
      });

      throw error;
    } finally {
      client.release();
    }
  }
}

export default new DeploymentController();
