import { 
    Connection,
    PublicKey, 
    Transaction, 
    TransactionInstruction,
    VersionedTransaction,
    TransactionMessage,
    AddressLookupTableAccount,
    CompiledInstruction,
    SimulateTransactionConfig,
    BlockheightBasedTransactionConfirmationStrategy,
    SendTransactionError,
    TokenAccountsFilter,
    Keypair
} from '@solana/web3.js';
import { Logger } from '../../../utils/logger';
import { metrics } from '../../../utils/metrics';
import { redisConfig } from '../../../config/redis.config';
import { ProgramRegistry } from '../../../services/program/ProgramRegistry';
import { ConnectionPool } from '../../../utils/ConnectionPool';
import { z } from 'zod';
import { APIError } from '../../../utils/errors';
import { RateLimiter } from '../../../utils/rateLimiter';
import { CircuitBreaker } from '../../../utils/circuitBreaker';
import { InstructionDecoder } from '../../../utils/InstructionDecoder';
import { createHash, randomBytes } from 'crypto';
import { BpfLoaderUpgradeable } from '@solana/spl-governance';
import { validateInstruction } from '../../../utils/instructionValidator';
import { ProgramMetadataService } from '../../program/ProgramMetadataService';

const VALIDATION_CONSTANTS = {
    MAX_TRANSACTION_SIZE: 1232,
    ADDRESS_VALIDATION_LIMIT: 1000,
    TRANSACTION_VALIDATION_LIMIT: 100,
    CACHE_TTL: {
        ADDRESS: 3600,      // 1 hour
        TRANSACTION: 300,   // 5 minutes
        ACCOUNT: 1800,      // 30 minutes
        PROGRAM: 7200      // 2 hours
    },
    SIMULATION_CONFIG: {
        sigVerify: true,
        replaceRecentBlockhash: true,
        commitment: 'processed' as const,
        accounts: {
            encoding: 'base64' as const,
            addresses: []
        }
    },
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,
    MAX_LOOKUP_TABLES: 10
};

const VALIDATION_SCHEMAS = {
    account: z.object({
        address: z.string().refine(
            (val) => {
                try {
                    new PublicKey(val);
                    return true;
                } catch {
                    return false;
                }
            },
            { message: "Invalid Solana address format" }
        ),
        type: z.enum(['token', 'program', 'system', 'stake', 'vote', 'pda', 'multisig', 'mint']),
        permissions: z.array(z.enum(['read', 'write', 'execute', 'delegate', 'close', 'freeze'])),
        metadata: z.object({
            name: z.string().optional(),
            description: z.string().optional(),
            tags: z.array(z.string()).optional(),
            createdAt: z.date(),
            updatedAt: z.date(),
            version: z.number().optional(),
            deployedBy: z.string().optional(),
            upgradeable: z.boolean().optional(),
            programData: z.string().optional()
        }).optional(),
        securityLevel: z.enum(['critical', 'high', 'medium', 'low']).optional(),
        riskScore: z.number().min(0).max(100).optional(),
        frozen: z.boolean().optional()
    }).strict(),

    transaction: z.object({
        instructions: z.array(z.object({
            programId: z.string().refine(
                (val) => {
                    try {
                        new PublicKey(val);
                        return true;
                    } catch {
                        return false;
                    }
                },
                { message: "Invalid program ID format" }
            ),
            keys: z.array(z.object({
                pubkey: z.string(),
                isSigner: z.boolean(),
                isWritable: z.boolean()
            })),
            data: z.string()
        })).max(20),
        recentBlockhash: z.string(),
        feePayer: z.string().refine(
            (val) => {
                try {
                    new PublicKey(val);
                    return true;
                } catch {
                    return false;
                }
            },
            { message: "Invalid fee payer address format" }
        ),
        version: z.union([z.literal('legacy'), z.literal('0')]),
        lookupTables: z.array(z.object({
            key: z.string(),
            addresses: z.array(z.string())
        })).max(VALIDATION_CONSTANTS.MAX_LOOKUP_TABLES).optional()
    }).strict()
};

interface ValidationContext {
    requestId: string;
    timestamp: number;
    source: string;
    validationType: 'address' | 'account' | 'transaction';
}

interface ValidationResult<T> {
    success: boolean;
    data?: T;
    error?: Error;
    duration: number;
    context: ValidationContext;
}

export class AccountValidator {
    private readonly logger: Logger;
    private readonly metricsClient: typeof metrics;
    private readonly rateLimiter: RateLimiter;
    private readonly circuitBreaker: CircuitBreaker;
    private readonly programRegistry: ProgramRegistry;
    private readonly connectionPool: ConnectionPool;
    private readonly instructionDecoder: InstructionDecoder;
    private readonly programMetadataService: ProgramMetadataService;

    constructor() {
        this.logger = new Logger('AccountValidator');
        this.metricsClient = metrics;
        this.rateLimiter = new RateLimiter({
            windowMs: 60000,
            maxRequests: VALIDATION_CONSTANTS.ADDRESS_VALIDATION_LIMIT
        });
        this.circuitBreaker = new CircuitBreaker({
            failureThreshold: 5,
            recoveryTimeout: 30000,
            resetTimeout: 60000
        });
        this.programRegistry = ProgramRegistry.getInstance();
        this.connectionPool = ConnectionPool.getInstance();
        this.instructionDecoder = new InstructionDecoder();
        this.programMetadataService = new ProgramMetadataService();
    }

    async validateAddress(address: string, source: string = 'api'): Promise<ValidationResult<boolean>> {
        const context: ValidationContext = {
            requestId: randomBytes(16).toString('hex'),
            timestamp: Date.now(),
            source,
            validationType: 'address'
        };

        const startTime = performance.now();

        try {
            await this.rateLimiter.checkLimit(`address_validation:${source}`);
            
            const cacheKey = `valid_address:${address}`;
            const cachedResult = await redisConfig.get(cacheKey);
            
            if (cachedResult !== null) {
                this.metricsClient.increment('address_validation.cache.hit', { source });
                return {
                    success: true,
                    data: cachedResult === 'true',
                    duration: performance.now() - startTime,
                    context
                };
            }

            this.metricsClient.increment('address_validation.attempt', { source });
            this.logger.debug('Starting address validation', { context, address });

            const isValid = await this.circuitBreaker.execute(async () => {
                const pubkey = new PublicKey(address);
                const connection = await this.getConnection();

                try {
                    const [accountInfo, isOnCurve] = await Promise.all([
                        connection.getAccountInfo(pubkey),
                        PublicKey.isOnCurve(pubkey.toBytes())
                    ]);

                    return Boolean(accountInfo) && isOnCurve;
                } finally {
                    await this.connectionPool.release(connection);
                }
            });

            await redisConfig.setex(
                cacheKey, 
                VALIDATION_CONSTANTS.CACHE_TTL.ADDRESS,
                isValid.toString()
            );

            this.metricsClient.increment('address_validation.result', {
                source,
                valid: isValid.toString()
            });

            return {
                success: true,
                data: isValid,
                duration: performance.now() - startTime,
                context
            };
        } catch (error) {
            this.logger.error('Address validation failed', {
                context,
                error,
                address
            });
            this.metricsClient.increment('address_validation.error', { source });
            
            return {
                success: false,
                error: new APIError('ADDRESS_VALIDATION_FAILED', 'Failed to validate address'),
                duration: performance.now() - startTime,
                context
            };
        }
    }

    async validateAccount(
        accountData: unknown,
        source: string = 'api'
    ): Promise<ValidationResult<z.infer<typeof VALIDATION_SCHEMAS.account>>> {
        const context: ValidationContext = {
            requestId: randomBytes(16).toString('hex'),
            timestamp: Date.now(),
            source,
            validationType: 'account'
        };

        const startTime = performance.now();

        try {
            await this.rateLimiter.checkLimit('account_validation');
            this.metricsClient.increment('account_validation.attempt', { source });
            this.logger.debug('Starting account validation', { context, accountData });

            const validatedAccount = VALIDATION_SCHEMAS.account.parse(accountData);
            
            const [accountState, programMetadata] = await Promise.all([
                this.validateAccountState(validatedAccount),
                validatedAccount.type === 'program' 
                    ? this.programMetadataService.getProgramMetadata(validatedAccount.address)
                    : null
            ]);

            if (programMetadata) {
                validatedAccount.metadata = {
                    ...validatedAccount.metadata,
                    ...programMetadata
                };
            }

            const riskScore = await this.calculateRiskScore(validatedAccount, accountState);
            validatedAccount.riskScore = riskScore;

            await this.validateAccountPermissions(validatedAccount);

            this.metricsClient.increment('account_validation.success', { source });
            this.metricsClient.histogram('account_validation.risk_score', riskScore, { source });

            return {
                success: true,
                data: validatedAccount,
                duration: performance.now() - startTime,
                context
            };
        } catch (error) {
            this.logger.error('Account validation failed', {
                context,
                error,
                accountData
            });
            this.metricsClient.increment('account_validation.error', { source });
            
            return {
                success: false,
                error: error instanceof z.ZodError 
                    ? new APIError('INVALID_ACCOUNT_FORMAT', error.errors[0].message)
                    : error,
                duration: performance.now() - startTime,
                context
            };
        }
    }

    async validateTransaction(
        transactionData: unknown,
        source: string = 'api'
    ): Promise<ValidationResult<boolean>> {
        const context: ValidationContext = {
            requestId: randomBytes(16).toString('hex'),
            timestamp: Date.now(),
            source,
            validationType: 'transaction'
        };

        const startTime = performance.now();

        try {
            await this.rateLimiter.checkLimit('transaction_validation');
            this.metricsClient.increment('transaction_validation.attempt', { source });
            this.logger.debug('Starting transaction validation', { context, transactionData });

            const validatedTx = VALIDATION_SCHEMAS.transaction.parse(transactionData);
            const connection = await this.getConnection();

            try {
                const tx = await this.constructTransaction(validatedTx, connection);
                const lookupTables = await this.resolveLookupTables(validatedTx, connection);

                await Promise.all([
                    this.validateTransactionSize(tx),
                    this.validateTransactionFees(tx, connection),
                    this.validateInstructions(tx.instructions),
                    this.simulateTransaction(tx, connection, lookupTables)
                ]);

                this.metricsClient.increment('transaction_validation.success', { source });

                return {
                    success: true,
                    data: true,
                    duration: performance.now() - startTime,
                    context
                };
            } finally {
                await this.connectionPool.release(connection);
            }
        } catch (error) {
            this.logger.error('Transaction validation failed', {
                context,
                error,
                transactionData
            });
            this.metricsClient.increment('transaction_validation.error', { source });

            return {
                success: false,
                error: error instanceof z.ZodError
                    ? new APIError('INVALID_TRANSACTION_FORMAT', error.errors[0].message)
                    : error,
                duration: performance.now() - startTime,
                context
            };
        }
    }

    private async getConnection(): Promise<Connection> {
        return this.connectionPool.acquire({
            commitment: 'confirmed',
            timeout: 30000,
            maxRetries: VALIDATION_CONSTANTS.MAX_RETRIES,
            endpoints: [
                process.env.SOLANA_RPC_PRIMARY!,
                process.env.SOLANA_RPC_SECONDARY!,
                process.env.SOLANA_RPC_FALLBACK!
            ],
            loadBalancing: 'least-loaded'
        });
    }

    private async validateAccountState(account: z.infer<typeof VALIDATION_SCHEMAS.account>): Promise<any> {
        return this.circuitBreaker.execute(async () => {
            const connection = await this.getConnection();

            try {
                const [accountInfo, rentExemption] = await Promise.all([
                    connection.getAccountInfo(new PublicKey(account.address)),
                    connection.getMinimumBalanceForRentExemption(0)
                ]);

                if (!accountInfo) {
                    throw new APIError('ACCOUNT_NOT_FOUND', 'Account does not exist on chain');
                }

                const state = {
                    space: accountInfo.data.length,
                    executable: accountInfo.executable,
                    lamports: accountInfo.lamports,
                    owner: accountInfo.owner.toBase58(),
                    rentEpoch: accountInfo.rentEpoch,
                    isRentExempt: accountInfo.lamports >= rentExemption
                };

                await redisConfig.hset(
                    `account_state:${account.address}`,
                    {
                        ...state,
                        lastChecked: Date.now()
                    }
                );

                return state;
            } finally {
                await this.connectionPool.release(connection);
            }
        });
    }

    private async validateAccountPermissions(
        account: z.infer<typeof VALIDATION_SCHEMAS.account>
    ): Promise<void> {
        const permissionSet = new Set(account.permissions);
        const accountType = account.type;
        const requiredPermissions = this.programRegistry.getRequiredPermissions(accountType);
        
        for (const permission of requiredPermissions) {
            if (!permissionSet.has(permission)) {
                throw new APIError(
                    'INVALID_PERMISSIONS',
                    `${accountType} accounts must have ${permission} permission`
                );
            }
        } ▋
