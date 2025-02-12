import { Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { ContractDeploymentService } from '../services/deployment/ContractDeploymentService';
import { AccountStateManager } from '../services/solana/state/AccountStateManager';
import { ContractError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

export class DeploymentController {
    private deploymentService: ContractDeploymentService;
    private stateManager: AccountStateManager;

    constructor() {
        this.deploymentService = new ContractDeploymentService();
        this.stateManager = AccountStateManager.getInstance();
    }

    public deployContract = async (req: Request, res: Response): Promise<void> => {
        const { contractId, network, options } = req.body;

        try {
            const contract = await this.stateManager.loadAccount(
                new PublicKey(contractId)
            );

            if (!contract) {
                throw new NotFoundError('Contract');
            }

            const deployment = await this.deploymentService.deploy(
                contract,
                network,
                options
            );

            logger.info('Contract deployed', {
                contractId,
                network,
                programId: deployment.programId,
                signature: deployment.signature
            });

            res.json({
                success: true,
                data: {
                    programId: deployment.programId,
                    signature: deployment.signature,
                    network,
                    timestamp: deployment.timestamp,
                    status: deployment.status,
                    logs: deployment.logs
                }
            });
        } catch (error) {
            logger.error('Contract deployment failed', {
                contractId,
                network,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    };

    public getDeploymentStatus = async (req: Request, res: Response): Promise<void> => {
        const { deploymentId } = req.params;

        try {
            const status = await this.deploymentService.getDeploymentStatus(deploymentId);

            if (!status) {
                throw new NotFoundError('Deployment');
            }

            res.json({
                success: true,
                data: status
            });
        } catch (error) {
            logger.error('Deployment status check failed', {
                deploymentId,
                error: error.message
            });
            throw error;
        }
    };

    public simulateDeployment = async (req: Request, res: Response): Promise<void> => {
        const { contractId, network, options } = req.body;

        try {
            const contract = await this.stateManager.loadAccount(
                new PublicKey(contractId)
            );

            if (!contract) {
                throw new NotFoundError('Contract');
            }

            const simulation = await this.deploymentService.simulate(
                contract,
                network,
                options
            );

            logger.info('Deployment simulation completed', {
                contractId,
                network,
                computeUnits: simulation.computeUnits,
                requiredSpace: simulation.requiredSpace
            });

            res.json({
                success: true,
                data: {
                    computeUnits: simulation.computeUnits,
                    requiredSpace: simulation.requiredSpace,
                    estimatedCost: simulation.estimatedCost,
                    warnings: simulation.warnings,
                    logs: simulation.logs
                }
            });
        } catch (error) {
            logger.error('Deployment simulation failed', {
                contractId,
                network,
                error: error.message
            });
            throw error;
        }
    };

    public upgradeContract = async (req: Request, res: Response): Promise<void> => {
        const { contractId, programId, network, options } = req.body;

        try {
            const contract = await this.stateManager.loadAccount(
                new PublicKey(contractId)
            );

            if (!contract) {
                throw new NotFoundError('Contract');
            }

            const upgrade = await this.deploymentService.upgrade(
                contract,
                new PublicKey(programId),
                network,
                options
            );

            logger.info('Contract upgraded', {
                contractId,
                programId,
                network,
                signature: upgrade.signature
            });

            res.json({
                success: true,
                data: {
                    programId: upgrade.programId,
                    signature: upgrade.signature,
                    network,
                    timestamp: upgrade.timestamp,
                    status: upgrade.status,
                    logs: upgrade.logs
                }
            });
        } catch (error) {
            logger.error('Contract upgrade failed', {
                contractId,
                programId,
                network,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    };

    public validateDeployment = async (req: Request, res: Response): Promise<void> => {
        const { contractId, network, options } = req.body;

        try {
            const contract = await this.stateManager.loadAccount(
                new PublicKey(contractId)
            );

            if (!contract) {
                throw new NotFoundError('Contract');
            }

            const validationResult = await this.deploymentService.validateDeployment(
                contract,
                network,
                options
            );

            logger.info('Deployment validation completed', {
                contractId,
                network,
                isValid: validationResult.isValid
            });

            res.json({
                success: true,
                data: {
                    isValid: validationResult.isValid,
                    errors: validationResult.errors,
                    warnings: validationResult.warnings,
                    checks: validationResult.checks
                }
            });
        } catch (error) {
            logger.error('Deployment validation failed', {
                contractId,
                network,
                error: error.message
            });
            throw error;
        }
    };

    public getDeploymentHistory = async (req: Request, res: Response): Promise<void> => {
        const { contractId } = req.params;
        const { limit, offset } = req.query;

        try {
            const contract = await this.stateManager.loadAccount(
                new PublicKey(contractId)
            );

            if (!contract) {
                throw new NotFoundError('Contract');
            }

            const history = await this.deploymentService.getDeploymentHistory(
                contractId,
                {
                    limit: Number(limit) || 10,
                    offset: Number(offset) || 0
                }
            );

            res.json({
                success: true,
                data: {
                    deployments: history.deployments,
                    total: history.total,
                    hasMore: history.hasMore
                }
            });
        } catch (error) {
            logger.error('Deployment history fetch failed', {
                contractId,
                error: error.message
            });
            throw error;
        }
    };
}
