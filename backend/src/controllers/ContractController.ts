import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { ContractCompiler } from '../services/compiler/ContractCompiler';
import { ContractValidator } from '../services/validation/ContractValidator';
import { MetricsService } from '../services/monitoring/MetricsService';
import { ErrorWithCode } from '../utils/errors';
import { logger } from '../utils/logger';
import { config } from '../config';
import { Contract, ContractStatus, ValidationResult } from '../types';

export class ContractController {
  private db: Pool;
  private redis: Redis;
  private compiler: ContractCompiler;
  private validator: ContractValidator;

  constructor() {
    this.db = new Pool(config.database);
    this.redis = new Redis(config.redis.url);
    this.compiler = ContractCompiler.getInstance();
    this.validator = ContractValidator.getInstance();
  }

  public listContracts = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const {
      page = 1,
      limit = 10,
      status,
      search,
      authorId,
      visibility
    } = req.query;

    try {
      const offset = (Number(page) - 1) * Number(limit);
      
      let query = `
        SELECT c.*, u.username as author_name,
        COUNT(*) OVER() as total_count
        FROM contracts c
        JOIN users u ON c.author_id = u.id
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramCount = 1;

      if (status) {
        query += ` AND c.status = $${paramCount}`;
        params.push(status);
        paramCount++;
      }

      if (search) {
        query += ` AND (c.name ILIKE $${paramCount} OR c.description ILIKE $${paramCount})`;
        params.push(`%${search}%`);
        paramCount++;
      }

      if (authorId) {
        query += ` AND c.author_id = $${paramCount}`;
        params.push(authorId);
        paramCount++;
      }

      if (visibility) {
        query += ` AND c.visibility = $${paramCount}`;
        params.push(visibility);
        paramCount++;
      }

      // Add organization check if user is in organization
      if (req.user?.organizationId) {
        query += ` AND (c.visibility = 'public' OR (c.visibility = 'organization' AND c.organization_id = $${paramCount}))`;
        params.push(req.user.organizationId);
        paramCount++;
      } else {
        query += ` AND c.visibility = 'public'`;
      }

      query += ` ORDER BY c.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
      params.push(limit, offset);

      const { rows } = await this.db.query(query, params);
      const totalCount = rows[0]?.total_count || 0;

      res.json({
        contracts: rows.map(row => ({
          ...row,
          total_count: undefined
        })),
        total: totalCount,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(totalCount / Number(limit))
      });

      MetricsService.increment('contract.list', { status, visibility });
    } catch (error) {
      next(error);
    }
  };

  public getContract = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const { rows } = await this.db.query(`
        SELECT c.*, u.username as author_name
        FROM contracts c
        JOIN users u ON c.author_id = u.id
        WHERE c.id = $1
      `, [id]);

      if (rows.length === 0) {
        throw new ErrorWithCode('Contract not found', 'CONTRACT_NOT_FOUND');
      }

      const contract = rows[0];

      // Check visibility permissions
      if (contract.visibility === 'private' && 
          contract.author_id !== req.user?.id) {
        throw new ErrorWithCode('Access denied', 'ACCESS_DENIED');
      }

      if (contract.visibility === 'organization' && 
          contract.organization_id !== req.user?.organizationId) {
        throw new ErrorWithCode('Access denied', 'ACCESS_DENIED');
      }

      res.json(contract);
      MetricsService.increment('contract.get', { status: contract.status });
    } catch (error) {
      next(error);
    }
  };

  public createContract = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const {
        name,
        description,
        sourceCode,
        visibility = 'private',
        organizationId = null
      } = req.body;

      // Validate contract
      const validationResult = await this.validator.validate(sourceCode);
      if (!validationResult.isValid) {
        throw new ErrorWithCode(
          'Contract validation failed',
          'VALIDATION_ERROR',
          { errors: validationResult.errors }
        );
      }

      // Insert contract
      const { rows: [contract] } = await client.query(`
        INSERT INTO contracts (
          name,
          description,
          source_code,
          author_id,
          status,
          visibility,
          organization_id,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        name,
        description,
        sourceCode,
        req.user!.id,
        ContractStatus.DRAFT,
        visibility,
        organizationId,
        { validation: validationResult }
      ]);

      await client.query('COMMIT');
      
      res.status(201).json(contract);
      
      MetricsService.increment('contract.create', {
        visibility,
        hasOrganization: !!organizationId
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  };

  public updateContract = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const updates = req.body;

      // Check contract exists and user has permission
      const { rows } = await client.query(`
        SELECT * FROM contracts WHERE id = $1
      `, [id]);

      if (rows.length === 0) {
        throw new ErrorWithCode('Contract not found', 'CONTRACT_NOT_FOUND');
      }

      const contract = rows[0];

      if (contract.author_id !== req.user!.id) {
        throw new ErrorWithCode('Access denied', 'ACCESS_DENIED');
      }

      // Validate source code if updated
      let validationResult: ValidationResult | undefined;
      if (updates.sourceCode) {
        validationResult = await this.validator.validate(updates.sourceCode);
        if (!validationResult.isValid) {
          throw new ErrorWithCode(
            'Contract validation failed',
            'VALIDATION_ERROR',
            { errors: validationResult.errors }
          );
        }
      }

      // Update contract
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramCount = 1;

      Object.entries(updates).forEach(([key, value]) => {
        if (value !== undefined && key !== 'id') {
          updateFields.push(`${key} = $${paramCount}`);
          updateValues.push(value);
          paramCount++;
        }
      });

      if (validationResult) {
        updateFields.push(`metadata = jsonb_set(metadata, '{validation}', $${paramCount})`);
        updateValues.push(JSON.stringify(validationResult));
      }

      updateValues.push(id);

      const { rows: [updated] } = await client.query(`
        UPDATE contracts
        SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${paramCount}
        RETURNING *
      `, updateValues);

      await client.query('COMMIT');

      res.json(updated);

      MetricsService.increment('contract.update', {
        status: updated.status
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  };

  public deleteContract = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const { id } = req.params;

      // Check contract exists and user has permission
      const { rows } = await client.query(`
        SELECT * FROM contracts WHERE id = $1
      `, [id]);

      if (rows.length === 0) {
        throw new ErrorWithCode('Contract not found', 'CONTRACT_NOT_FOUND');
      }

      const contract = rows[0];

      if (contract.author_id !== req.user!.id) {
        throw new ErrorWithCode('Access denied', 'ACCESS_DENIED');
      }

      // Delete contract
      await client.query(`
        DELETE FROM contracts WHERE id = $1
      `, [id]);

      await client.query('COMMIT');

      res.status(204).end();

      MetricsService.increment('contract.delete', {
        status: contract.status
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  };

  public compileContract = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { id } = req.params;
      const { optimize = false } = req.body;

      // Get contract
      const { rows } = await this.db.query(`
        SELECT * FROM contracts WHERE id = $1
      `, [id]);

      if (rows.length === 0) {
        throw new ErrorWithCode('Contract not found', 'CONTRACT_NOT_FOUND');
      }

      const contract = rows[0];

      // Check permissions
      if (contract.author_id !== req.user!.id) {
        throw new ErrorWithCode('Access denied', 'ACCESS_DENIED');
      }

      // Compile contract
      const result = await this.compiler.compile(contract.source_code, {
        optimize,
        target: 'solana'
      });

      // Update contract
      await this.db.query(`
        UPDATE contracts
        SET bytecode = $1,
            status = $2,
            metadata = jsonb_set(
              metadata,
              '{compilation}',
              $3::jsonb
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `, [
        result.bytecode,
        ContractStatus.COMPILED,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          optimize,
          success: true
        }),
        id
      ]);

      res.json({
        success: true,
        bytecode: result.bytecode.toString('hex')
      });

      MetricsService.increment('contract.compile', {
        optimize: optimize.toString()
      });
    } catch (error) {
      next(error);
    }
  };
}

export default new ContractController();
