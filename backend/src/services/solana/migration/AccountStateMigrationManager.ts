import { PublicKey } from '@solana/web3.js';
import { AccountStateManager } from '../state/AccountStateManager';
import { AccountSchemaManager } from '../schema/AccountSchemaManager';
import { AccountDataValidator } from '../validators/AccountDataValidator';
import { AccountDataSerializer } from '../serializer/AccountDataSerializer';
import { EventEmitter } from 'events';
import { BN } from 'bn.js';

interface MigrationPlan {
    accountKey: string;
    sourceVersion: number;
    targetVersion: number;
    steps: MigrationStep[];
    estimatedDuration: number;
    requiredSpace: number;
    fallbackStrategy: 'revert' | 'continue';
}

interface MigrationStep {
    fromVersion: number;
    toVersion: number;
    transformer: (data: any) => Promise<any>;
    validator: (data: any) => Promise<boolean>;
    estimatedDuration: number;
}

interface MigrationResult {
    success: boolean;
    accountKey: string;
    sourceVersion: number;
    targetVersion: number;
    duration: number;
    error?: Error;
    steps: {
        version: number;
        success: boolean;
        duration: number;
        error?: Error;
    }[];
}

interface MigrationOptions {
    dryRun?: boolean;
    validateOnly?: boolean;
    timeout?: number;
    parallel?: boolean;
    maxRetries?: number;
    retryDelay?: number;
    fallbackStrategy?: 'revert' | 'continue';
}

export class AccountStateMigrationManager extends EventEmitter {
    private static instance: AccountStateMigrationManager;
    private stateManager: AccountStateManager;
    private schemaManager: AccountSchemaManager;
    private validator: AccountDataValidator;
    private serializer: AccountDataSerializer;
    private activeMigrations: Map<string, MigrationPlan>;
    private migrationHistory: Map<string, MigrationResult[]>;
    private defaultOptions: Required<MigrationOptions>;

    private constructor() {
        super();
        this.stateManager = AccountStateManager.getInstance();
        this.schemaManager = AccountSchemaManager.getInstance();
        this.validator = AccountDataValidator.getInstance();
        this.serializer = AccountDataSerializer.getInstance();
        this.activeMigrations = new Map();
        this.migrationHistory = new Map();
        this.defaultOptions = {
            dryRun: false,
            validateOnly: false,
            timeout: 30000,
            parallel: false,
            maxRetries: 3,
            retryDelay: 1000,
            fallbackStrategy: 'revert'
        };
    }

    public static getInstance(): AccountStateMigrationManager {
        if (!AccountStateMigrationManager.instance) {
            AccountStateMigrationManager.instance = new AccountStateMigrationManager();
        }
        return AccountStateMigrationManager.instance;
    }

    public async planMigration(
        pubkey: PublicKey,
        targetVersion: number,
        options: MigrationOptions = {}
    ): Promise<MigrationPlan> {
        const accountKey = pubkey.toBase58();
        const currentState = await this.stateManager.loadAccount(pubkey);

        if (!currentState) {
            throw new Error(`Account not found: ${accountKey}`);
        }

        const sourceVersion = currentState.metadata.schemaVersion;
        if (sourceVersion === targetVersion) {
            throw new Error(`Account already at version ${targetVersion}`);
        }

        const steps = await this.buildMigrationSteps(
            currentState.metadata.schemaName,
            sourceVersion,
            targetVersion
        );

        const estimatedDuration = steps.reduce(
            (total, step) => total + step.estimatedDuration,
            0
        );

        const requiredSpace = await this.calculateRequiredSpace(
            currentState,
            steps,
            targetVersion
        );

        const plan: MigrationPlan = {
            accountKey,
            sourceVersion,
            targetVersion,
            steps,
            estimatedDuration,
            requiredSpace,
            fallbackStrategy: options.fallbackStrategy || this.defaultOptions.fallbackStrategy
        };

        this.activeMigrations.set(accountKey, plan);
        return plan;
    }

    public async executeMigration(
        pubkey: PublicKey,
        options: MigrationOptions = {}
    ): Promise<MigrationResult> {
        const accountKey = pubkey.toBase58();
        const plan = this.activeMigrations.get(accountKey);

        if (!plan) {
            throw new Error(`No migration plan found for account: ${accountKey}`);
        }

        const mergedOptions = { ...this.defaultOptions, ...options };
        const startTime = Date.now();
        const steps: MigrationResult['steps'] = [];

        try {
            let currentState = await this.stateManager.loadAccount(pubkey);
            if (!currentState) {
                throw new Error(`Account not found: ${accountKey}`);
            }

            if (mergedOptions.dryRun) {
                this.emit('migration:dryrun', { accountKey, plan });
                return this.simulateMigration(plan);
            }

            // Execute each migration step
            for (const step of plan.steps) {
                const stepStartTime = Date.now();
                try {
                    // Transform state
                    const transformedState = await this.executeStep(
                        currentState,
                        step,
                        mergedOptions
                    );

                    // Validate transformed state
                    if (!(await step.validator(transformedState))) {
                        throw new Error(`Validation failed for version ${step.toVersion}`);
                    }

                    // Update current state
                    currentState = {
                        ...transformedState,
                        metadata: {
                            ...currentState.metadata,
                            schemaVersion: step.toVersion
                        }
                    };

                    steps.push({
                        version: step.toVersion,
                        success: true,
                        duration: Date.now() - stepStartTime
                    });

                    this.emit('migration:step:complete', {
                        accountKey,
                        version: step.toVersion,
                        duration: Date.now() - stepStartTime
                    });

                } catch (error) {
                    steps.push({
                        version: step.toVersion,
                        success: false,
                        duration: Date.now() - stepStartTime,
                        error
                    });

                    if (mergedOptions.fallbackStrategy === 'revert') {
                        await this.revertMigration(pubkey, currentState);
                        throw error;
                    }
                }
            }

            // Update account with migrated state
            if (!mergedOptions.validateOnly) {
                await this.stateManager.updateAccount(pubkey, currentState);
            }

            const result: MigrationResult = {
                success: true,
                accountKey,
                sourceVersion: plan.sourceVersion,
                targetVersion: plan.targetVersion,
                duration: Date.now() - startTime,
                steps
            };

            this.updateMigrationHistory(accountKey, result);
            this.emit('migration:complete', result);
            return result;

        } catch (error) {
            const result: MigrationResult = {
                success: false,
                accountKey,
                sourceVersion: plan.sourceVersion,
                targetVersion: plan.targetVersion,
                duration: Date.now() - startTime,
                steps,
                error
            };

            this.updateMigrationHistory(accountKey, result);
            this.emit('migration:error', result);
            throw error;
        } finally {
            this.activeMigrations.delete(accountKey);
        }
    }

    private async buildMigrationSteps(
        schemaName: string,
        sourceVersion: number,
        targetVersion: number
    ): Promise<MigrationStep[]> {
        const steps: MigrationStep[] = [];
        let currentVersion = sourceVersion;

        while (currentVersion !== targetVersion) {
            const nextVersion = currentVersion < targetVersion 
                ? currentVersion + 1 
                : currentVersion - 1;

            const sourceSchema = this.schemaManager.getSchema(schemaName, currentVersion);
            const targetSchema = this.schemaManager.getSchema(schemaName, nextVersion);

            steps.push({
                fromVersion: currentVersion,
                toVersion: nextVersion,
                transformer: this.createTransformer(sourceSchema, targetSchema),
                validator: this.createValidator(targetSchema),
                estimatedDuration: this.estimateStepDuration(sourceSchema, targetSchema)
            });

            currentVersion = nextVersion;
        }

        return steps;
    }

    private createTransformer(sourceSchema: any, targetSchema: any): (data: any) => Promise<any> {
        return async (data: any) => {
            // Implementation would include field mapping, type conversion, etc.
            return this.schemaManager.generateMigrationFunction(sourceSchema, targetSchema)(data);
        };
    }

    private createValidator(schema: any): (data: any) => Promise<boolean> {
        return async (data: any) => {
            const validationResult = await this.validator.validateAccountData(data, schema);
            return validationResult.isValid;
        };
    }

    private estimateStepDuration(sourceSchema: any, targetSchema: any): number {
        // Implementation would analyze schema complexity to estimate duration
        return 1000; // Default 1 second per step
    }

    private async calculateRequiredSpace(
        currentState: any,
        steps: MigrationStep[],
        targetVersion: number
    ): Promise<number> {
        // Calculate maximum possible size after migration
        const targetSchema = this.schemaManager.getSchema(
            currentState.metadata.schemaName,
            targetVersion
        );
        
        const serializedSize = this.serializer.calculateSerializedSize(targetSchema);
        return serializedSize + 1024; // Add buffer for metadata
    }

    private async executeStep(
        state: any,
        step: MigrationStep,
        options: Required<MigrationOptions>
    ): Promise<any> {
        let attempts = 0;
        let lastError: Error;

        while (attempts < options.maxRetries) {
            try {
                const stepPromise = step.transformer(state);
                const result = await Promise.race([
                    stepPromise,
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Step timeout')), options.timeout)
                    )
                ]);

                return result;
            } catch (error) {
                lastError = error;
                attempts++;
                if (attempts < options.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, options.retryDelay));
                }
            }
        }

        throw lastError;
    }

    private async revertMigration(pubkey: PublicKey, originalState: any): Promise<void> {
        try {
            await this.stateManager.updateAccount(pubkey, originalState);
            this.emit('migration:reverted', {
                accountKey: pubkey.toBase58(),
                version: originalState.metadata.schemaVersion
            });
        } catch (error) {
            this.emit('migration:revert:error', {
                accountKey: pubkey.toBase58(),
                error
            });
            throw error;
        }
    }

    private simulateMigration(plan: MigrationPlan): MigrationResult {
        return {
            success: true,
            accountKey: plan.accountKey,
            sourceVersion: plan.sourceVersion,
            targetVersion: plan.targetVersion,
            duration: plan.estimatedDuration,
            steps: plan.steps.map(step => ({
                version: step.toVersion,
                success: true,
                duration: step.estimatedDuration
            }))
        };
    }

    private updateMigrationHistory(accountKey: string, result: MigrationResult): void {
        if (!this.migrationHistory.has(accountKey)) {
            this.migrationHistory.set(accountKey, []);
        }
        this.migrationHistory.get(accountKey).push(result);
    }

    public getMigrationHistory(pubkey: PublicKey): MigrationResult[] {
        return this.migrationHistory.get(pubkey.toBase58()) || [];
    }

    public clearMigrationHistory(pubkey: PublicKey): void {
        this.migrationHistory.delete(pubkey.toBase58());
    }
}
