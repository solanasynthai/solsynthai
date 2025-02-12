import { Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { AccountSchemaManager } from '../services/solana/schema/AccountSchemaManager';
import { AccountStateValidator } from '../services/solana/validators/AccountStateValidator';
import { SecurityAnalyzer } from '../services/security/SecurityAnalyzer';
import { ContractError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

export class ValidationController {
    private schemaManager: AccountSchemaManager;
    private stateValidator: AccountStateValidator;
    private securityAnalyzer: SecurityAnalyzer;

    constructor() {
        this.schemaManager = AccountSchemaManager.getInstance();
        this.stateValidator = AccountStateValidator.getInstance();
        this.securityAnalyzer = new SecurityAnalyzer();
    }

    public validateSchema = async (req: Request, res: Response): Promise<void> => {
        const { schema } = req.body;

        try {
            const validationResult = await this.schemaManager.validateSchema(schema);

            if (!validationResult.isValid) {
                throw new ContractError('Invalid schema', {
                    errors: validationResult.errors
                });
            }

            // Perform additional schema analysis
            const analysis = await this.schemaManager.analyzeSchema(schema);

            logger.info('Schema validation completed', {
                isValid: true,
                warnings: analysis.warnings.length
            });

            res.json({
                success: true,
                data: {
                    isValid: true,
                    analysis: {
                        complexity: analysis.complexity,
                        size: analysis.size,
                        warnings: analysis.warnings,
                        recommendations: analysis.recommendations
                    }
                }
            });
        } catch (error) {
            logger.error('Schema validation failed', {
                error: error.message,
                schema: JSON.stringify(schema)
            });
            throw error;
        }
    };

    public validateData = async (req: Request, res: Response): Promise<void> => {
        const { schema, data } = req.body;

        try {
            // Validate schema first
            const schemaValidation = await this.schemaManager.validateSchema(schema);
            if (!schemaValidation.isValid) {
                throw new ContractError('Invalid schema', {
                    errors: schemaValidation.errors
                });
            }

            // Validate data against schema
            const dataValidation = await this.stateValidator.validateAccountData(
                data,
                schema,
                {
                    strict: true,
                    checkDataSize: true
                }
            );

            logger.info('Data validation completed', {
                isValid: dataValidation.isValid,
                errors: dataValidation.errors.length,
                warnings: dataValidation.warnings.length
            });

            res.json({
                success: true,
                data: {
                    isValid: dataValidation.isValid,
                    errors: dataValidation.errors,
                    warnings: dataValidation.warnings
                }
            });
        } catch (error) {
            logger.error('Data validation failed', {
                error: error.message,
                schema: JSON.stringify(schema),
                data: JSON.stringify(data)
            });
            throw error;
        }
    };

    public validateSecurity = async (req: Request, res: Response): Promise<void> => {
        const { contractId, code } = req.body;

        try {
            // Analyze code security
            const securityAnalysis = await this.securityAnalyzer.analyzeContract(code);

            // Check for critical vulnerabilities
            if (securityAnalysis.criticalIssues.length > 0) {
                throw new ContractError('Critical security vulnerabilities detected', {
                    vulnerabilities: securityAnalysis.criticalIssues
                });
            }

            logger.info('Security validation completed', {
                contractId,
                issues: {
                    critical: securityAnalysis.criticalIssues.length,
                    high: securityAnalysis.highIssues.length,
                    medium: securityAnalysis.mediumIssues.length,
                    low: securityAnalysis.lowIssues.length
                }
            });

            res.json({
                success: true,
                data: {
                    isSecure: securityAnalysis.isSecure,
                    score: securityAnalysis.securityScore,
                    issues: {
                        critical: securityAnalysis.criticalIssues,
                        high: securityAnalysis.highIssues,
                        medium: securityAnalysis.mediumIssues,
                        low: securityAnalysis.lowIssues
                    },
                    recommendations: securityAnalysis.recommendations,
                    metrics: {
                        complexity: securityAnalysis.metrics.complexity,
                        coverage: securityAnalysis.metrics.coverage,
                        vulnerabilities: securityAnalysis.metrics.vulnerabilities
                    }
                }
            });
        } catch (error) {
            logger.error('Security validation failed', {
                contractId,
                error: error.message
            });
            throw error;
        }
    };

    public validateAccountState = async (req: Request, res: Response): Promise<void> => {
        const { pubkey } = req.params;
        const { checkRentExemption } = req.query;

        try {
            const accountInfo = await this.stateValidator.validateAccountInfo(
                new PublicKey(pubkey),
                {
                    checkRentExemption: checkRentExemption === 'true'
                }
            );

            logger.info('Account state validation completed', {
                pubkey,
                isValid: accountInfo.isValid
            });

            res.json({
                success: true,
                data: {
                    isValid: accountInfo.isValid,
                    state: accountInfo.state,
                    errors: accountInfo.errors,
                    warnings: accountInfo.warnings,
                    metrics: {
                        size: accountInfo.metrics.size,
                        lamports: accountInfo.metrics.lamports,
                        rentEpoch: accountInfo.metrics.rentEpoch
                    }
                }
            });
        } catch (error) {
            logger.error('Account state validation failed', {
                pubkey,
                error: error.message
            });
            throw error;
        }
    };

    public validateStructure = async (req: Request, res: Response): Promise<void> => {
        const { schema, structure } = req.body;

        try {
            const validationResult = await this.stateValidator.validateStructure(
                structure,
                schema,
                {
                    validateReferences: true,
                    validateConstraints: true
                }
            );

            logger.info('Structure validation completed', {
                isValid: validationResult.isValid,
                errors: validationResult.errors.length
            });

            res.json({
                success: true,
                data: {
                    isValid: validationResult.isValid,
                    errors: validationResult.errors,
                    warnings: validationResult.warnings,
                    details: validationResult.details
                }
            });
        } catch (error) {
            logger.error('Structure validation failed', {
                error: error.message,
                schema: JSON.stringify(schema),
                structure: JSON.stringify(structure)
            });
            throw error;
        }
    };
}
