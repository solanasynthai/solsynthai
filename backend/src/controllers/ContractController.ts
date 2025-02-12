import { Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { AccountStateManager } from '../services/solana/state/AccountStateManager';
import { AccountSchemaManager } from '../services/solana/schema/AccountSchemaManager';
import { ContractError, NotFoundError } from '../utils/errors';
import { validateContractData } from '../validators/contractValidator';
import { logger } from '../utils/logger';

export class ContractController {
    private stateManager: AccountStateManager;
    private schemaManager: AccountSchemaManager;

    constructor() {
        this.stateManager = AccountStateManager.getInstance();
        this.schemaManager = AccountSchemaManager.getInstance();
    }

    public createContract = async (req: Request, res: Response): Promise<void> => {
        const { name, description, schema, template } = req.body;

        try {
            // Validate schema
            const validationResult = await this.schemaManager.validateSchema(schema);
            if (!validationResult.isValid) {
                throw new ContractError('Invalid schema', {
                    errors: validationResult.errors
                });
            }

            // Create contract
            const contract = await this.stateManager.createContract({
                name,
                description,
                schema,
                template
            });

            logger.info('Contract created', { contractId: contract.pubkey });

            res.status(201).json({
                success: true,
                data: contract
            });
        } catch (error) {
            logger.error('Contract creation failed', { error });
            throw error;
        }
    };

    public getContract = async (req: Request, res: Response): Promise<void> => {
        const { pubkey } = req.params;

        try {
            const contract = await this.stateManager.loadAccount(
                new PublicKey(pubkey)
            );

            if (!contract) {
                throw new NotFoundError('Contract');
            }

            res.json({
                success: true,
                data: contract
            });
        } catch (error) {
            logger.error('Contract fetch failed', { pubkey, error });
            throw error;
        }
    };

    public updateContract = async (req: Request, res: Response): Promise<void> => {
        const { pubkey } = req.params;
        const { updates } = req.body;

        try {
            const contract = await this.stateManager.loadAccount(
                new PublicKey(pubkey)
            );

            if (!contract) {
                throw new NotFoundError('Contract');
            }

            // Validate updates
            const validationResult = await validateContractData(updates, contract.schema);
            if (!validationResult.isValid) {
                throw new ContractError('Invalid contract data', {
                    errors: validationResult.errors
                });
            }

            // Apply updates
            const updatedContract = await this.stateManager.updateAccount(
                new PublicKey(pubkey),
                updates
            );

            logger.info('Contract updated', { contractId: pubkey });

            res.json({
                success: true,
                data: updatedContract
            });
        } catch (error) {
            logger.error('Contract update failed', { pubkey, error });
            throw error;
        }
    };

    public validateContract = async (req: Request, res: Response): Promise<void> => {
        const { pubkey } = req.params;
        const { data } = req.body;

        try {
            const contract = await this.stateManager.loadAccount(
                new PublicKey(pubkey)
            );

            if (!contract) {
                throw new NotFoundError('Contract');
            }

            const validationResult = await validateContractData(data, contract.schema);

            res.json({
                success: true,
                data: validationResult
            });
        } catch (error) {
            logger.error('Contract validation failed', { pubkey, error });
            throw error;
        }
    };

    public deleteContract = async (req: Request, res: Response): Promise<void> => {
        const { pubkey } = req.params;

        try {
            const contract = await this.stateManager.loadAccount(
                new PublicKey(pubkey)
            );

            if (!contract) {
                throw new NotFoundError('Contract');
            }

            await this.stateManager.deleteAccount(new PublicKey(pubkey));

            logger.info('Contract deleted', { contractId: pubkey });

            res.json({
                success: true,
                message: 'Contract deleted successfully'
            });
        } catch (error) {
            logger.error('Contract deletion failed', { pubkey, error });
            throw error;
        }
    };
}
