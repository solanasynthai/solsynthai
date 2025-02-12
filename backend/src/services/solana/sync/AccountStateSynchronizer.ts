import { 
    Connection, 
    PublicKey, 
    AccountInfo, 
    Context, 
    Commitment 
} from '@solana/web3.js';
import { EventEmitter } from 'events';
import { BN } from 'bn.js';
import { AccountStateManager } from '../state/AccountStateManager';
import { AccountSchemaManager } from '../schema/AccountSchemaManager';
import { AccountStateValidator } from '../validators/AccountStateValidator';
import { AccountDataSerializer } from '../serializer/AccountDataSerializer';

interface SyncOptions {
    commitment?: Commitment;
    batchSize?: number;
    retryAttempts?: number;
    retryDelay?: number;
    validateData?: boolean;
    websocketEnabled?: boolean;
    includeTransactions?: boolean;
    syncInterval?: number;
}

interface SyncState {
    accountKey: string;
    slot: number;
    lastUpdate: number;
    status: 'syncing' | 'synchronized' | 'error';
    error?: Error;
    retryCount: number;
}

interface SyncUpdate {
    accountKey: string;
    oldState: any;
    newState: any;
    slot: number;
    timestamp: number;
    signature?: string;
}

export class AccountStateSynchronizer extends EventEmitter {
    private static instance: AccountStateSynchronizer;
    private connection: Connection;
    private stateManager: AccountStateManager;
    private schemaManager: AccountSchemaManager;
    private validator: AccountStateValidator;
    private serializer: AccountDataSerializer;
    private syncStates: Map<string, SyncState>;
    private subscriptions: Map<string, number>;
    private websocketSubscriptions: Map<string, number>;
    private pendingUpdates: Map<string, Promise<void>>;
    private intervalHandles: Map<string, NodeJS.Timeout>;
    private defaultOptions: Required<SyncOptions>;

    private constructor(connection: Connection) {
        super();
        this.connection = connection;
        this.stateManager = AccountStateManager.getInstance();
        this.schemaManager = AccountSchemaManager.getInstance();
        this.validator = AccountStateValidator.getInstance(connection);
        this.serializer = AccountDataSerializer.getInstance();
        this.syncStates = new Map();
        this.subscriptions = new Map();
        this.websocketSubscriptions = new Map();
        this.pendingUpdates = new Map();
        this.intervalHandles = new Map();
        this.defaultOptions = {
            commitment: 'confirmed',
            batchSize: 100,
            retryAttempts: 3,
            retryDelay: 1000,
            validateData: true,
            websocketEnabled: true,
            includeTransactions: false,
            syncInterval: 1000
        };
    }

    public static getInstance(connection: Connection): AccountStateSynchronizer {
        if (!AccountStateSynchronizer.instance) {
            AccountStateSynchronizer.instance = new AccountStateSynchronizer(connection);
        }
        return AccountStateSynchronizer.instance;
    }

    public async startSync(
        pubkey: PublicKey,
        schemaName: string,
        options: SyncOptions = {}
    ): Promise<void> {
        const accountKey = pubkey.toBase58();
        const mergedOptions = { ...this.defaultOptions, ...options };

        if (this.syncStates.has(accountKey)) {
            throw new Error(`Sync already in progress for account: ${accountKey}`);
        }

        try {
            // Initialize sync state
            this.syncStates.set(accountKey, {
                accountKey,
                slot: 0,
                lastUpdate: Date.now(),
                status: 'syncing',
                retryCount: 0
            });

            // Load initial account state
            await this.loadInitialState(pubkey, schemaName, mergedOptions);

            // Set up subscriptions
            if (mergedOptions.websocketEnabled) {
                await this.setupWebSocketSubscription(pubkey, schemaName, mergedOptions);
            }

            // Set up polling interval if needed
            if (mergedOptions.syncInterval > 0) {
                this.setupPollingInterval(pubkey, schemaName, mergedOptions);
            }

            this.emit('sync:started', { accountKey });

        } catch (error) {
            this.syncStates.set(accountKey, {
                accountKey,
                slot: 0,
                lastUpdate: Date.now(),
                status: 'error',
                error,
                retryCount: 0
            });

            this.emit('sync:error', { accountKey, error });
            throw error;
        }
    }

    public async stopSync(pubkey: PublicKey): Promise<void> {
        const accountKey = pubkey.toBase58();

        // Clear subscriptions
        const subscriptionId = this.subscriptions.get(accountKey);
        if (subscriptionId !== undefined) {
            this.connection.removeAccountChangeListener(subscriptionId);
            this.subscriptions.delete(accountKey);
        }

        const wsSubscriptionId = this.websocketSubscriptions.get(accountKey);
        if (wsSubscriptionId !== undefined) {
            await this.connection.removeAccountChangeListener(wsSubscriptionId);
            this.websocketSubscriptions.delete(accountKey);
        }

        // Clear interval
        const intervalHandle = this.intervalHandles.get(accountKey);
        if (intervalHandle) {
            clearInterval(intervalHandle);
            this.intervalHandles.delete(accountKey);
        }

        // Clear state
        this.syncStates.delete(accountKey);
        this.pendingUpdates.delete(accountKey);

        this.emit('sync:stopped', { accountKey });
    }

    public async forceSyncAccount(pubkey: PublicKey): Promise<void> {
        const accountKey = pubkey.toBase58();
        const syncState = this.syncStates.get(accountKey);

        if (!syncState) {
            throw new Error(`No sync in progress for account: ${accountKey}`);
        }

        try {
            await this.syncAccountState(pubkey);
            this.emit('sync:forced', { accountKey });
        } catch (error) {
            this.emit('sync:error', { accountKey, error });
            throw error;
        }
    }

    public getSyncState(pubkey: PublicKey): SyncState | undefined {
        return this.syncStates.get(pubkey.toBase58());
    }

    private async loadInitialState(
        pubkey: PublicKey,
        schemaName: string,
        options: Required<SyncOptions>
    ): Promise<void> {
        const accountInfo = await this.connection.getAccountInfo(
            pubkey,
            options.commitment
        );

        if (!accountInfo) {
            throw new Error(`Account not found: ${pubkey.toBase58()}`);
        }

        const schema = this.schemaManager.getSchema(schemaName);

        if (options.validateData) {
            const validationResult = await this.validator.validateAccountState(
                accountInfo,
                pubkey,
                schema,
                { strict: true }
            );

            if (!validationResult.isValid) {
                throw new Error(
                    `Invalid account state: ${JSON.stringify(validationResult.errors)}`
                );
            }
        }

        await this.updateAccountState(pubkey, accountInfo, schema);
    }

    private async setupWebSocketSubscription(
        pubkey: PublicKey,
        schemaName: string,
        options: Required<SyncOptions>
    ): Promise<void> {
        const schema = this.schemaManager.getSchema(schemaName);

        const subscriptionId = this.connection.onAccountChange(
            pubkey,
            async (accountInfo: AccountInfo<Buffer>, context: Context) => {
                await this.handleAccountUpdate(
                    pubkey,
                    accountInfo,
                    schema,
                    context,
                    options
                );
            },
            options.commitment
        );

        this.websocketSubscriptions.set(pubkey.toBase58(), subscriptionId);
    }

    private setupPollingInterval(
        pubkey: PublicKey,
        schemaName: string,
        options: Required<SyncOptions>
    ): void {
        const intervalHandle = setInterval(
            () => this.syncAccountState(pubkey),
            options.syncInterval
        );

        this.intervalHandles.set(pubkey.toBase58(), intervalHandle);
    }

    private async handleAccountUpdate(
        pubkey: PublicKey,
        accountInfo: AccountInfo<Buffer>,
        schema: any,
        context: Context,
        options: Required<SyncOptions>
    ): Promise<void> {
        const accountKey = pubkey.toBase58();
        const syncState = this.syncStates.get(accountKey);

        if (!syncState) return;

        // Skip if slot is older than current state
        if (context.slot <= syncState.slot) return;

        try {
            // Queue update if there are pending updates
            if (this.pendingUpdates.has(accountKey)) {
                return this.queueUpdate(pubkey, accountInfo, schema, context);
            }

            const updatePromise = this.processAccountUpdate(
                pubkey,
                accountInfo,
                schema,
                context,
                options
            );

            this.pendingUpdates.set(accountKey, updatePromise);
            await updatePromise;

        } catch (error) {
            syncState.status = 'error';
            syncState.error = error;
            syncState.retryCount++;

            this.emit('sync:error', { accountKey, error });

            if (syncState.retryCount < options.retryAttempts) {
                setTimeout(
                    () => this.handleAccountUpdate(pubkey, accountInfo, schema, context, options),
                    options.retryDelay
                );
            }
        } finally {
            this.pendingUpdates.delete(accountKey);
        }
    }

    private async processAccountUpdate(
        pubkey: PublicKey,
        accountInfo: AccountInfo<Buffer>,
        schema: any,
        context: Context,
        options: Required<SyncOptions>
    ): Promise<void> {
        const accountKey = pubkey.toBase58();
        const syncState = this.syncStates.get(accountKey);

        if (!syncState) return;

        if (options.validateData) {
            const validationResult = await this.validator.validateAccountState(
                accountInfo,
                pubkey,
                schema,
                { strict: true }
            );

            if (!validationResult.isValid) {
                throw new Error(
                    `Invalid account state: ${JSON.stringify(validationResult.errors)}`
                );
            }
        }

        const oldState = await this.stateManager.loadAccount(pubkey);
        await this.updateAccountState(pubkey, accountInfo, schema);
        const newState = await this.stateManager.loadAccount(pubkey);

        syncState.slot = context.slot;
        syncState.lastUpdate = Date.now();
        syncState.status = 'synchronized';
        syncState.retryCount = 0;

        const update: SyncUpdate = {
            accountKey,
            oldState,
            newState,
            slot: context.slot,
            timestamp: Date.now()
        };

        if (options.includeTransactions) {
            // Add signature of the transaction that caused the update
            update.signature = await this.findUpdateTransaction(pubkey, context.slot);
        }

        this.emit('sync:update', update);
    }

    private async updateAccountState(
        pubkey: PublicKey,
        accountInfo: AccountInfo<Buffer>,
        schema: any
    ): Promise<void> {
        const data = this.serializer.deserialize(accountInfo.data, schema);
        await this.stateManager.updateAccount(pubkey, data);
    }

    private async queueUpdate(
        pubkey: PublicKey,
        accountInfo: AccountInfo<Buffer>,
        schema: any,
        context: Context
    ): Promise<void> {
        const accountKey = pubkey.toBase58();
        const pendingUpdate = this.pendingUpdates.get(accountKey);

        if (pendingUpdate) {
            await pendingUpdate;
            await this.handleAccountUpdate(pubkey, accountInfo, schema, context, this.defaultOptions);
        }
    }

    private async findUpdateTransaction(
        pubkey: PublicKey,
        slot: number
    ): Promise<string | undefined> {
        try {
            const block = await this.connection.getBlock(slot, {
                maxSupportedTransactionVersion: 0
            });

            if (!block) return undefined;

            for (const tx of block.transactions) {
                if (tx.transaction.message.accountKeys.some(key => key.equals(pubkey))) {
                    return tx.transaction.signatures[0];
                }
            }

            return undefined;
        } catch {
            return undefined;
        }
    }

    private async syncAccountState(pubkey: PublicKey): Promise<void> {
        const accountKey = pubkey.toBase58();
        const syncState = this.syncStates.get(accountKey);

        if (!syncState) return;

        try {
            const accountInfo = await this.connection.getAccountInfo(
                pubkey,
                this.defaultOptions.commitment
            );

            if (!accountInfo) {
                throw new Error(`Account not found: ${accountKey}`);
            }

            const schema = this.schemaManager.getSchema(syncState.accountKey);
            await this.updateAccountState(pubkey, accountInfo, schema);

            syncState.lastUpdate = Date.now();
            syncState.status = 'synchronized';
            
            this.emit('sync:poll', { accountKey });

        } catch (error) {
            syncState.status = 'error';
            syncState.error = error;
            this.emit('sync:error', { accountKey, error });
        }
    }

    public async destroy(): Promise<void> {
        const accounts = Array.from(this.syncStates.keys());
        
        for (const accountKey of accounts) {
            await this.stopSync(new PublicKey(accountKey));
        }

        this.removeAllListeners();
    }
}
