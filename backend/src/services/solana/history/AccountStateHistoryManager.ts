import { PublicKey, Connection, AccountInfo, Context } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { AccountStateManager } from '../state/AccountStateManager';
import { AccountSchemaManager } from '../schema/AccountSchemaManager';
import { AccountDataSerializer } from '../serializer/AccountDataSerializer';
import { BN } from 'bn.js';

interface HistoryOptions {
    maxEntries?: number;
    retentionPeriod?: number;
    persistToDisk?: boolean;
    persistPath?: string;
    compressionEnabled?: boolean;
    includeSignatures?: boolean;
    trackChanges?: boolean;
}

interface StateChange {
    field: string;
    oldValue: any;
    newValue: any;
    type: 'update' | 'create' | 'delete';
}

interface HistoryEntry {
    pubkey: string;
    slot: number;
    timestamp: number;
    signature?: string;
    state: any;
    changes: StateChange[];
    metadata: {
        schemaName: string;
        schemaVersion: number;
        lamports: number;
        rentEpoch: number;
    };
}

interface HistoryQuery {
    startTime?: number;
    endTime?: number;
    startSlot?: number;
    endSlot?: number;
    signatures?: string[];
    fields?: string[];
    changeTypes?: ('update' | 'create' | 'delete')[];
    limit?: number;
}

interface HistoryStats {
    totalEntries: number;
    oldestEntry: number;
    newestEntry: number;
    diskSize: number;
    memorySize: number;
}

export class AccountStateHistoryManager extends EventEmitter {
    private static instance: AccountStateHistoryManager;
    private connection: Connection;
    private stateManager: AccountStateManager;
    private schemaManager: AccountSchemaManager;
    private serializer: AccountDataSerializer;
    private history: Map<string, HistoryEntry[]>;
    private options: Required<HistoryOptions>;
    private persistenceTimer: NodeJS.Timer | null;

    private constructor(connection: Connection, options: Partial<HistoryOptions> = {}) {
        super();
        this.connection = connection;
        this.stateManager = AccountStateManager.getInstance();
        this.schemaManager = AccountSchemaManager.getInstance();
        this.serializer = AccountDataSerializer.getInstance();
        this.history = new Map();
        this.options = {
            maxEntries: 1000,
            retentionPeriod: 30 * 24 * 60 * 60 * 1000, // 30 days
            persistToDisk: false,
            persistPath: './data/history',
            compressionEnabled: true,
            includeSignatures: true,
            trackChanges: true,
            ...options
        };

        this.setupPersistence();
        this.setupCleanupInterval();
    }

    public static getInstance(
        connection: Connection,
        options?: Partial<HistoryOptions>
    ): AccountStateHistoryManager {
        if (!AccountStateHistoryManager.instance) {
            AccountStateHistoryManager.instance = new AccountStateHistoryManager(connection, options);
        }
        return AccountStateHistoryManager.instance;
    }

    public async recordStateChange(
        pubkey: PublicKey,
        oldState: any,
        newState: any,
        context: Context,
        signature?: string
    ): Promise<void> {
        const accountKey = pubkey.toBase58();

        try {
            // Get account info for metadata
            const accountInfo = await this.connection.getAccountInfo(pubkey);
            if (!accountInfo) {
                throw new Error(`Account not found: ${accountKey}`);
            }

            // Calculate state changes
            const changes = this.options.trackChanges
                ? this.calculateStateChanges(oldState, newState)
                : [];

            // Create history entry
            const entry: HistoryEntry = {
                pubkey: accountKey,
                slot: context.slot,
                timestamp: Date.now(),
                signature: this.options.includeSignatures ? signature : undefined,
                state: newState,
                changes,
                metadata: {
                    schemaName: newState.metadata.schemaName,
                    schemaVersion: newState.metadata.schemaVersion,
                    lamports: accountInfo.lamports,
                    rentEpoch: accountInfo.rentEpoch
                }
            };

            // Add entry to history
            if (!this.history.has(accountKey)) {
                this.history.set(accountKey, []);
            }
            
            const accountHistory = this.history.get(accountKey);
            accountHistory.push(entry);

            // Enforce max entries limit
            while (accountHistory.length > this.options.maxEntries) {
                accountHistory.shift();
            }

            this.emit('history:recorded', {
                pubkey: accountKey,
                slot: context.slot,
                changes: changes.length
            });

            // Persist if enabled
            if (this.options.persistToDisk) {
                await this.persistAccountHistory(accountKey);
            }

        } catch (error) {
            this.emit('history:error', {
                pubkey: accountKey,
                error: error.message
            });
            throw error;
        }
    }

    public async getHistory(
        pubkey: PublicKey,
        query: HistoryQuery = {}
    ): Promise<HistoryEntry[]> {
        const accountKey = pubkey.toBase58();
        const history = this.history.get(accountKey) || [];

        let filtered = history;

        // Apply time range filter
        if (query.startTime || query.endTime) {
            filtered = filtered.filter(entry => 
                (!query.startTime || entry.timestamp >= query.startTime) &&
                (!query.endTime || entry.timestamp <= query.endTime)
            );
        }

        // Apply slot range filter
        if (query.startSlot || query.endSlot) {
            filtered = filtered.filter(entry =>
                (!query.startSlot || entry.slot >= query.startSlot) &&
                (!query.endSlot || entry.slot <= query.endSlot)
            );
        }

        // Filter by signatures
        if (query.signatures?.length) {
            filtered = filtered.filter(entry =>
                entry.signature && query.signatures.includes(entry.signature)
            );
        }

        // Filter by change types
        if (query.changeTypes?.length) {
            filtered = filtered.filter(entry =>
                entry.changes.some(change => 
                    query.changeTypes.includes(change.type)
                )
            );
        }

        // Filter fields
        if (query.fields?.length) {
            filtered = filtered.map(entry => ({
                ...entry,
                state: this.filterFields(entry.state, query.fields),
                changes: entry.changes.filter(change =>
                    query.fields.includes(change.field)
                )
            }));
        }

        // Apply limit
        if (query.limit) {
            filtered = filtered.slice(-query.limit);
        }

        return filtered;
    }

    public async getStateAtSlot(
        pubkey: PublicKey,
        slot: number
    ): Promise<any | null> {
        const history = await this.getHistory(pubkey, { endSlot: slot, limit: 1 });
        return history.length > 0 ? history[0].state : null;
    }

    public async getStateChanges(
        pubkey: PublicKey,
        startSlot: number,
        endSlot: number
    ): Promise<StateChange[]> {
        const history = await this.getHistory(pubkey, { startSlot, endSlot });
        return history.flatMap(entry => entry.changes);
    }

    private calculateStateChanges(oldState: any, newState: any): StateChange[] {
        const changes: StateChange[] = [];

        // Handle creation
        if (!oldState && newState) {
            return Object.entries(newState).map(([field, value]) => ({
                field,
                oldValue: null,
                newValue: value,
                type: 'create'
            }));
        }

        // Handle deletion
        if (oldState && !newState) {
            return Object.entries(oldState).map(([field, value]) => ({
                field,
                oldValue: value,
                newValue: null,
                type: 'delete'
            }));
        }

        // Handle updates
        for (const [field, newValue] of Object.entries(newState)) {
            const oldValue = oldState[field];
            if (!this.areValuesEqual(oldValue, newValue)) {
                changes.push({
                    field,
                    oldValue,
                    newValue,
                    type: 'update'
                });
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

    private filterFields(state: any, fields: string[]): any {
        const filtered: any = {};
        for (const field of fields) {
            if (state.hasOwnProperty(field)) {
                filtered[field] = state[field];
            }
        }
        return filtered;
    }

    private async persistAccountHistory(accountKey: string): Promise<void> {
        if (!this.options.persistToDisk) return;

        try {
            const fs = require('fs').promises;
            const path = require('path');
            const history = this.history.get(accountKey);

            if (!history) return;

            // Ensure directory exists
            await fs.mkdir(this.options.persistPath, { recursive: true });

            const filePath = path.join(
                this.options.persistPath,
                `${accountKey}.history`
            );

            const data = {
                timestamp: Date.now(),
                entries: history
            };

            const serialized = this.options.compressionEnabled
                ? await this.compressData(JSON.stringify(data))
                : JSON.stringify(data);

            await fs.writeFile(filePath, serialized);

        } catch (error) {
            this.emit('persist:error', {
                pubkey: accountKey,
                error: error.message
            });
        }
    }

    private async restoreAccountHistory(accountKey: string): Promise<void> {
        if (!this.options.persistToDisk) return;

        try {
            const fs = require('fs').promises;
            const path = require('path');
            const filePath = path.join(
                this.options.persistPath,
                `${accountKey}.history`
            );

            const content = await fs.readFile(filePath);
            const data = this.options.compressionEnabled
                ? await this.decompressData(content)
                : JSON.parse(content);

            this.history.set(accountKey, data.entries);

        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.emit('restore:error', {
                    pubkey: accountKey,
                    error: error.message
                });
            }
        }
    }

    private async compressData(data: string): Promise<Buffer> {
        const zlib = require('zlib');
        const { promisify } = require('util');
        const deflate = promisify(zlib.deflate);
        return deflate(data);
    }

    private async decompressData(data: Buffer): Promise<any> {
        const zlib = require('zlib');
        const { promisify } = require('util');
        const inflate = promisify(zlib.inflate);
        const decompressed = await inflate(data);
        return JSON.parse(decompressed.toString());
    }

    private setupPersistence(): void {
        if (!this.options.persistToDisk) return;

        this.persistenceTimer = setInterval(
            () => this.persistAllHistory(),
            5 * 60 * 1000 // Every 5 minutes
        );

        process.on('SIGINT', () => this.handleShutdown());
        process.on('SIGTERM', () => this.handleShutdown());
    }

    private async persistAllHistory(): Promise<void> {
        if (!this.options.persistToDisk) return;

        for (const accountKey of this.history.keys()) {
            await this.persistAccountHistory(accountKey);
        }
    }

    private setupCleanupInterval(): void {
        setInterval(() => this.cleanupHistory(), 60 * 60 * 1000); // Every hour
    }

    private cleanupHistory(): void {
        const cutoffTime = Date.now() - this.options.retentionPeriod;

        for (const [accountKey, history] of this.history.entries()) {
            const filtered = history.filter(entry => entry.timestamp >= cutoffTime);
            
            if (filtered.length !== history.length) {
                this.history.set(accountKey, filtered);
                this.emit('cleanup:completed', {
                    pubkey: accountKey,
                    removedEntries: history.length - filtered.length
                });
            }
        }
    }

    public getStats(pubkey?: PublicKey): HistoryStats {
        if (pubkey) {
            return this.getAccountStats(pubkey);
        }

        let totalEntries = 0;
        let oldestEntry = Date.now();
        let newestEntry = 0;
        let memorySize = 0;

        for (const history of this.history.values()) {
            totalEntries += history.length;
            if (history.length > 0) {
                oldestEntry = Math.min(oldestEntry, history[0].timestamp);
                newestEntry = Math.max(newestEntry, history[history.length - 1].timestamp);
            }
            memorySize += this.calculateHistorySize(history);
        }

        return {
            totalEntries,
            oldestEntry,
            newestEntry,
            diskSize: this.calculateDiskSize(),
            memorySize
        };
    }

    private getAccountStats(pubkey: PublicKey): HistoryStats {
        const accountKey = pubkey.toBase58();
        const history = this.history.get(accountKey) || [];

        return {
        totalEntries: history.length,
        oldestEntry: history[0]?.timestamp || 0,
        newestEntry: history[history.length - 1]?.timestamp || 0,
        diskSize: this.calculateAccountDiskSize(accountKey),
        memorySize: this.calculateHistorySize(history)
    };
}

private calculateHistorySize(history: HistoryEntry[]): number {
    let size = 0;

    for (const entry of history) {
        // Base fields
        size += 8; // slot (number)
        size += 8; // timestamp (number)
        size += entry.pubkey.length;
        size += entry.signature ? entry.signature.length : 0;

        // State size
        size += JSON.stringify(entry.state).length;

        // Changes array
        for (const change of entry.changes) {
            size += change.field.length;
            size += JSON.stringify(change.oldValue).length;
            size += JSON.stringify(change.newValue).length;
            size += change.type.length;
        }

        // Metadata
        size += JSON.stringify(entry.metadata).length;
    }

    return size;
}

private calculateDiskSize(): number {
    if (!this.options.persistToDisk) {
        return 0;
    }

    try {
        const fs = require('fs');
        const path = require('path');
        let totalSize = 0;

        const files = fs.readdirSync(this.options.persistPath);
        for (const file of files) {
            if (file.endsWith('.history')) {
                const filePath = path.join(this.options.persistPath, file);
                const stats = fs.statSync(filePath);
                totalSize += stats.size;
            }
        }

        return totalSize;
    } catch {
        return 0;
    }
}

private calculateAccountDiskSize(accountKey: string): number {
    if (!this.options.persistToDisk) {
        return 0;
    }

    try {
        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(
            this.options.persistPath,
            `${accountKey}.history`
        );
        const stats = fs.statSync(filePath);
        return stats.size;
    } catch {
        return 0;
    }
}

private async handleShutdown(): Promise<void> {
    if (this.persistenceTimer) {
        clearInterval(this.persistenceTimer);
    }

    try {
        await this.persistAllHistory();
        this.emit('shutdown:complete');
    } catch (error) {
        this.emit('shutdown:error', { error: error.message });
    } finally {
        process.exit(0);
    }
}

public async loadHistory(pubkey: PublicKey): Promise<void> {
    const accountKey = pubkey.toBase58();

    try {
        await this.restoreAccountHistory(accountKey);
        this.emit('history:loaded', { pubkey: accountKey });
    } catch (error) {
        this.emit('history:load:error', {
            pubkey: accountKey,
            error: error.message
        });
        throw error;
    }
}

public async clearHistory(pubkey?: PublicKey): Promise<void> {
    if (pubkey) {
        const accountKey = pubkey.toBase58();
        this.history.delete(accountKey);

        if (this.options.persistToDisk) {
            try {
                const fs = require('fs').promises;
                const path = require('path');
                const filePath = path.join(
                    this.options.persistPath,
                    `${accountKey}.history`
                );
                await fs.unlink(filePath);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }
        }

        this.emit('history:cleared', { pubkey: accountKey });
    } else {
        this.history.clear();

        if (this.options.persistToDisk) {
            try {
                const fs = require('fs').promises;
                await fs.rm(this.options.persistPath, { recursive: true });
                await fs.mkdir(this.options.persistPath, { recursive: true });
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }
        }

        this.emit('history:cleared:all');
    }
}

public getFieldHistory(
    pubkey: PublicKey,
    field: string,
    query: HistoryQuery = {}
): StateChange[] {
    const history = this.history.get(pubkey.toBase58()) || [];
    let changes: StateChange[] = [];

    for (const entry of history) {
        const fieldChanges = entry.changes.filter(change => change.field === field);
        if (fieldChanges.length > 0) {
            changes.push(...fieldChanges.map(change => ({
                ...change,
                timestamp: entry.timestamp,
                slot: entry.slot,
                signature: entry.signature
            })));
        }
    }

    // Apply time range filter
    if (query.startTime || query.endTime) {
        changes = changes.filter(change => 
            (!query.startTime || change.timestamp >= query.startTime) &&
            (!query.endTime || change.timestamp <= query.endTime)
        );
    }

    // Apply slot range filter
    if (query.startSlot || query.endSlot) {
        changes = changes.filter(change =>
            (!query.startSlot || change.slot >= query.startSlot) &&
            (!query.endSlot || change.slot <= query.endSlot)
        );
    }

    // Apply limit
    if (query.limit) {
        changes = changes.slice(-query.limit);
    }

    return changes;
}

public async exportHistory(
    pubkey: PublicKey,
    format: 'json' | 'csv' = 'json'
): Promise<string> {
    const history = this.history.get(pubkey.toBase58()) || [];

    if (format === 'csv') {
        return this.exportToCsv(history);
    }

    return JSON.stringify(history, null, 2);
}

private exportToCsv(history: HistoryEntry[]): string {
    const rows = [];
    
    // Header
    rows.push([
        'Timestamp',
        'Slot',
        'Signature',
        'Field',
        'Old Value',
        'New Value',
        'Change Type'
    ].join(','));

    // Data rows
    for (const entry of history) {
        for (const change of entry.changes) {
            rows.push([
                new Date(entry.timestamp).toISOString(),
                entry.slot,
                entry.signature || '',
                change.field,
                JSON.stringify(change.oldValue || ''),
                JSON.stringify(change.newValue || ''),
                change.type
            ].join(','));
        }
    }

    return rows.join('\n');
}

public async destroy(): Promise<void> {
    if (this.persistenceTimer) {
        clearInterval(this.persistenceTimer);
    }

    await this.persistAllHistory();
    this.history.clear();
    this.removeAllListeners();
}
}
