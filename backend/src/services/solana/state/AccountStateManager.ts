import { 
    PublicKey, 
    Connection, 
    AccountInfo, 
    Commitment,
    Context,
    KeyedAccountInfo,
    ParsedAccountData
} from '@solana/web3.js';
import { AccountDataSerializer } from '../serializer/AccountDataSerializer';
import { AccountSchemaManager } from '../schema/AccountSchemaManager';
import { BN } from 'bn.js';
import { EventEmitter } from 'events';

interface AccountStateMetadata {
    pubkey: PublicKey;
    owner: PublicKey;
    lamports: number;
    rentEpoch: number;
    executable: boolean;
    schemaName: string;
    schemaVersion: number;
    lastUpdate: number;
    updateCount: number;
}

interface StateUpdate {
    timestamp: number;
    signature?: string;
    slot?: number;
    changes: {
        field: string;
        oldValue: any;
        newValue: any;
    }[];
}

interface AccountStateOptions {
    commitment?: Commitment;
    prefetchData?: boolean;
    websocket?: boolean;
}

export class AccountStateManager extends EventEmitter {
    private static instance: AccountStateManager;
    private connection: Connection;
    private serializer: AccountDataSerializer;
    private schemaManager: AccountSchemaManager;
    private states: Map<string, AccountState>;
    private subscriptions: Map<string, number>;
    private webSocketSubscriptions: Map<string, number>;
    private pendingUpdates: Map<string, Promise<void>>;
    private updateQueue: Map<string, StateUpdate[]>;
    private options: AccountStateOptions;

    private constructor(connection: Connection, options: AccountStateOptions = {}) {
        super();
        this.connection = connection;
        this.serializer = AccountDataSerializer.getInstance();
        this.schemaManager = AccountSchemaManager.getInstance();
        this.states = new Map();
        this.subscriptions = new Map();
        this.webSocketSubscriptions = new Map();
        this.pendingUpdates = new Map();
        this.updateQueue = new Map();
        this.options = {
            commitment: 'confirmed',
            prefetchData: true,
            websocket: true,
            ...options
        };
    }

    public static getInstance(connection: Connection, options?: AccountStateOptions): AccountStateManager {
        if (!AccountStateManager.instance) {
            AccountStateManager.instance = new AccountStateManager(connection, options);
        }
        return AccountStateManager.instance;
    }

    public async loadAccount(
        pubkey: PublicKey, 
        schemaName: string, 
        version?: number
    ): Promise<AccountState> {
        const accountKey = pubkey.toBase58();

        try {
            // Check if account is already loaded
            if (this.states.has(accountKey)) {
                return this.states.get(accountKey);
            }

            // Fetch account data
            const accountInfo = await this.connection.getAccountInfo(
                pubkey,
                this.options.commitment
            );

            if (!accountInfo) {
                throw new Error(`Account not found: ${accountKey}`);
            }

            // Get schema
            const schema = this.schemaManager.getSchema(schemaName, version);

            // Create account state
            const state = await this.createAccountState(
                pubkey,
                accountInfo,
                schema,
                schemaName,
                version || schema.version
            );

            // Store state
            this.states.set(accountKey, state);

            // Set up monitoring if enabled
            if (this.options.websocket) {
                await this.setupAccountSubscription(pubkey, schema);
            }

            return state;
        } catch (error) {
            throw new Error(`Failed to load account ${accountKey}: ${error.message}`);
        }
    }

    public async updateAccount(
        pubkey: PublicKey,
        updates: Record<string, any>,
        signature?: string
    ): Promise<void> {
        const accountKey = pubkey.toBase58();
        const state = this.states.get(accountKey);

        if (!state) {
            throw new Error(`Account state not found: ${accountKey}`);
        }

        // Queue update if there are pending updates
        if (this.pendingUpdates.has(accountKey)) {
            return this.queueUpdate(accountKey, updates, signature);
        }

        try {
            const updatePromise = this.processAccountUpdate(state, updates, signature);
            this.pendingUpdates.set(accountKey, updatePromise);
            await updatePromise;
        } finally {
            this.pendingUpdates.delete(accountKey);
            // Process queued updates
            await this.processUpdateQueue(accountKey);
        }
    }

    public async watchAccount(
        pubkey: PublicKey,
        callback: (state: AccountState, update: StateUpdate) => void
    ): Promise<() => void> {
        const accountKey = pubkey.toBase58();
        const state = this.states.get(accountKey);

        if (!state) {
            throw new Error(`Account state not found: ${accountKey}`);
        }

        const listener = (update: StateUpdate) => {
            callback(state, update);
        };

        state.on('update', listener);

        // Return unsubscribe function
        return () => {
            state.off('update', listener);
        };
    }

    public async unloadAccount(pubkey: PublicKey): Promise<void> {
        const accountKey = pubkey.toBase58();

        // Remove subscriptions
        const subscriptionId = this.subscriptions.get(accountKey);
        if (subscriptionId !== undefined) {
            this.connection.removeAccountChangeListener(subscriptionId);
            this.subscriptions.delete(accountKey);
        }

        const wsSubscriptionId = this.webSocketSubscriptions.get(accountKey);
        if (wsSubscriptionId !== undefined) {
            await this.connection.removeAccountChangeListener(wsSubscriptionId);
            this.webSocketSubscriptions.delete(accountKey);
        }

        // Remove state
        this.states.delete(accountKey);
        this.updateQueue.delete(accountKey);
        this.pendingUpdates.delete(accountKey);
    }

    private async createAccountState(
        pubkey: PublicKey,
        accountInfo: AccountInfo<Buffer>,
        schema: AccountSchema,
        schemaName: string,
        schemaVersion: number
    ): Promise<AccountState> {
        // Deserialize account data
        const data = this.serializer.deserialize(accountInfo.data, schema);

        // Create metadata
        const metadata: AccountStateMetadata = {
            pubkey,
            owner: accountInfo.owner,
            lamports: accountInfo.lamports,
            rentEpoch: accountInfo.rentEpoch,
            executable: accountInfo.executable,
            schemaName,
            schemaVersion,
            lastUpdate: Date.now(),
            updateCount: 0
        };

        // Create state instance
        const state = new AccountState(this, metadata, data);

        return state;
    }

    private async setupAccountSubscription(
        pubkey: PublicKey,
        schema: AccountSchema
    ): Promise<void> {
        const accountKey = pubkey.toBase58();

        // Set up WebSocket subscription
        const wsSubscriptionId = this.connection.onAccountChange(
            pubkey,
            (accountInfo: AccountInfo<Buffer>, context: Context) => {
                this.handleAccountUpdate(
                    pubkey,
                    accountInfo,
                    schema,
                    context
                );
            },
            this.options.commitment
        );

        this.webSocketSubscriptions.set(accountKey, wsSubscriptionId);
    }

    private async handleAccountUpdate(
        pubkey: PublicKey,
        accountInfo: AccountInfo<Buffer>,
        schema: AccountSchema,
        context: Context
    ): Promise<void> {
        const accountKey = pubkey.toBase58();
        const state = this.states.get(accountKey);

        if (!state) {
            return;
        }

        try {
            // Deserialize new data
            const newData = this.serializer.deserialize(accountInfo.data, schema);

            // Compare with current state and generate update
            const changes = this.compareStates(state.data, newData);

            if (changes.length > 0) {
                const update: StateUpdate = {
                    timestamp: Date.now(),
                    slot: context.slot,
                    changes
                };

                // Update state
                state.updateData(newData, update);
            }
        } catch (error) {
            this.emit('error', {
                pubkey,
                error: `Failed to process account update: ${error.message}`
            });
        }
    }

    private compareStates(oldState: any, newState: any): StateUpdate['changes'] {
        const changes: StateUpdate['changes'] = [];

        for (const [field, newValue] of Object.entries(newState)) {
            const oldValue = oldState[field];
            if (!this.areValuesEqual(oldValue, newValue)) {
                changes.push({ field, oldValue, newValue });
            }
        }

        return changes;
    }

    private areValuesEqual(value1: any, value2: any): boolean {
        if (value1 === value2) return true;

        if (value1 instanceof BN && value2 instanceof BN) {
            return value1.eq(value2);
        }

        if (value1 instanceof PublicKey && value2 instanceof PublicKey) {
            return value1.equals(value2);
        }

        if (Array.isArray(value1) && Array.isArray(value2)) {
            return (
                value1.length === value2.length &&
                value1.every((v, i) => this.areValuesEqual(v, value2[i]))
            );
        }

        if (typeof value1 === 'object' && typeof value2 === 'object') {
            const keys1 = Object.keys(value1);
            const keys2 = Object.keys(value2);
            return (
                keys1.length === keys2.length &&
                keys1.every(key => this.areValuesEqual(value1[key], value2[key]))
            );
        }

        return false;
    }

    private async queueUpdate(
        accountKey: string,
        updates: Record<string, any>,
        signature?: string
    ): Promise<void> {
        if (!this.updateQueue.has(accountKey)) {
            this.updateQueue.set(accountKey, []);
        }

        const queue = this.updateQueue.get(accountKey);
        queue.push({
            timestamp: Date.now(),
            signature,
            changes: Object.entries(updates).map(([field, newValue]) => ({
                field,
                oldValue: this.states.get(accountKey).data[field],
                newValue
            }))
        });
    }

    private async processUpdateQueue(accountKey: string): Promise<void> {
        const queue = this.updateQueue.get(accountKey);
        if (!queue?.length) return;

        const state = this.states.get(accountKey);
        if (!state) return;

        while (queue.length > 0) {
            const update = queue.shift();
            const updates = Object.fromEntries(
                update.changes.map(change => [change.field, change.newValue])
            );

            try {
                await this.processAccountUpdate(state, updates, update.signature);
            } catch (error) {
                this.emit('error', {
                    pubkey: state.pubkey,
                    error: `Failed to process queued update: ${error.message}`
                });
            }
        }
    }

    private async processAccountUpdate(
        state: AccountState,
        updates: Record<string, any>,
        signature?: string
    ): Promise<void> {
        // Validate updates against schema
        const schema = this.schemaManager.getSchema(
            state.metadata.schemaName,
            state.metadata.schemaVersion
        );

        const newData = { ...state.data, ...updates };
        const validationResult = this.serializer.validate(newData, schema);

        if (!validationResult.valid) {
            throw new Error(`Invalid update data: ${JSON.stringify(validationResult.errors)}`);
        }

        // Create update record
        const changes = Object.entries(updates).map(([field, newValue]) => ({
            field,
            oldValue: state.data[field],
            newValue
        }));

        const update: StateUpdate = {
            timestamp: Date.now(),
            signature,
            changes
        };

        // Update state
        state.updateData(newData, update);
    }
}

class AccountState extends EventEmitter {
    public readonly metadata: AccountStateMetadata;
    private _data: any;
    private _updateHistory: StateUpdate[];

    constructor(
        private manager: AccountStateManager,
        metadata: AccountStateMetadata,
        initialData: any
    ) {
        super();
        this.metadata = metadata;
        this._data = initialData;
        this._updateHistory = [];
    }

    get data(): any {
        return this._data;
    }

    get updateHistory(): StateUpdate[] {
        return [...this._updateHistory];
    }

    get pubkey(): PublicKey {
        return this.metadata.pubkey;
    }

    public updateData(newData: any, update: StateUpdate): void {
        this._data = newData;
        this._updateHistory.push(update);
        this.metadata.lastUpdate = update.timestamp;
        this.metadata.updateCount++;
        this.emit('update', update);
    }
}
