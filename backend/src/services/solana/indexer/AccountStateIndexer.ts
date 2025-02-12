import { PublicKey, Connection } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { AccountStateManager } from '../state/AccountStateManager';
import { AccountSchemaManager } from '../schema/AccountSchemaManager';
import { BN } from 'bn.js';

interface IndexOptions {
    maxEntries?: number;
    maxAge?: number;
    persistToDisk?: boolean;
    persistPath?: string;
    updateOnChange?: boolean;
    batchSize?: number;
    sortOrder?: 'asc' | 'desc';
    cacheEnabled?: boolean;
    compressionEnabled?: boolean;
}

interface IndexField {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'publicKey' | 'BN' | 'date';
    isArray?: boolean;
    sortable?: boolean;
    indexed?: boolean;
    unique?: boolean;
}

interface IndexEntry {
    pubkey: string;
    data: Record<string, any>;
    timestamp: number;
    slot?: number;
    signature?: string;
}

interface IndexQuery {
    fields?: string[];
    where?: WhereClause[];
    orderBy?: OrderByClause[];
    limit?: number;
    offset?: number;
}

interface WhereClause {
    field: string;
    operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'contains' | 'startsWith' | 'endsWith';
    value: any;
}

interface OrderByClause {
    field: string;
    direction: 'asc' | 'desc';
}

interface IndexStats {
    totalEntries: number;
    uniqueFields: number;
    lastUpdate: number;
    diskSize: number;
    memorySize: number;
}

export class AccountStateIndexer extends EventEmitter {
    private static instance: AccountStateIndexer;
    private connection: Connection;
    private stateManager: AccountStateManager;
    private schemaManager: AccountSchemaManager;
    private indices: Map<string, Map<string, IndexEntry>>;
    private fieldIndices: Map<string, Map<string, Set<string>>>;
    private sortedIndices: Map<string, string[]>;
    private options: Required<IndexOptions>;
    private updateQueue: Map<string, Promise<void>>;
    private persistenceTimer: NodeJS.Timer | null;

    private constructor(connection: Connection, options: Partial<IndexOptions> = {}) {
        super();
        this.connection = connection;
        this.stateManager = AccountStateManager.getInstance();
        this.schemaManager = AccountSchemaManager.getInstance();
        this.indices = new Map();
        this.fieldIndices = new Map();
        this.sortedIndices = new Map();
        this.updateQueue = new Map();
        this.options = {
            maxEntries: 1000000,
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
            persistToDisk: false,
            persistPath: './data/indices',
            updateOnChange: true,
            batchSize: 1000,
            sortOrder: 'desc',
            cacheEnabled: true,
            compressionEnabled: true,
            ...options
        };

        this.setupPersistence();
        this.setupCleanupInterval();
    }

    public static getInstance(connection: Connection, options?: Partial<IndexOptions>): AccountStateIndexer {
        if (!AccountStateIndexer.instance) {
            AccountStateIndexer.instance = new AccountStateIndexer(connection, options);
        }
        return AccountStateIndexer.instance;
    }

    public async createIndex(
        schemaName: string,
        fields: IndexField[]
    ): Promise<void> {
        if (this.indices.has(schemaName)) {
            throw new Error(`Index already exists for schema: ${schemaName}`);
        }

        // Validate fields against schema
        const schema = this.schemaManager.getSchema(schemaName);
        this.validateIndexFields(fields, schema);

        // Initialize indices
        this.indices.set(schemaName, new Map());
        this.fieldIndices.set(schemaName, new Map());
        this.sortedIndices.set(schemaName, []);

        // Create field indices
        for (const field of fields) {
            if (field.indexed) {
                this.fieldIndices.get(schemaName).set(field.name, new Set());
            }
        }

        this.emit('index:created', { schemaName, fields });
    }

    public async indexAccount(
        pubkey: PublicKey,
        schemaName: string
    ): Promise<void> {
        const accountKey = pubkey.toBase58();

        if (!this.indices.has(schemaName)) {
            throw new Error(`No index found for schema: ${schemaName}`);
        }

        try {
            // Queue update if there are pending updates
            if (this.updateQueue.has(accountKey)) {
                return this.queueIndexUpdate(pubkey, schemaName);
            }

            const updatePromise = this.processIndexUpdate(pubkey, schemaName);
            this.updateQueue.set(accountKey, updatePromise);
            await updatePromise;

        } catch (error) {
            this.emit('index:error', {
                accountKey,
                schemaName,
                error: error.message
            });
            throw error;
        } finally {
            this.updateQueue.delete(accountKey);
        }
    }

    public async query(
        schemaName: string,
        query: IndexQuery
    ): Promise<IndexEntry[]> {
        const index = this.indices.get(schemaName);
        if (!index) {
            throw new Error(`No index found for schema: ${schemaName}`);
        }

        try {
            let results = await this.executeQuery(schemaName, query);

            // Apply sorting
            if (query.orderBy?.length) {
                results = this.sortResults(results, query.orderBy);
            }

            // Apply pagination
            if (query.offset !== undefined || query.limit !== undefined) {
                results = this.paginateResults(results, query.offset, query.limit);
            }

            return results;

        } catch (error) {
            this.emit('query:error', {
                schemaName,
                query,
                error: error.message
            });
            throw error;
        }
    }

    private async executeQuery(
        schemaName: string,
        query: IndexQuery
    ): Promise<IndexEntry[]> {
        const index = this.indices.get(schemaName);
        const fieldIndices = this.fieldIndices.get(schemaName);

        // Start with all entries if no where clause
        let candidates = query.where?.length
            ? new Set<string>()
            : new Set(index.keys());

        // Apply where clauses
        if (query.where?.length) {
            for (const clause of query.where) {
                const matches = await this.executeWhereClause(
                    schemaName,
                    clause,
                    fieldIndices.get(clause.field)
                );

                if (candidates.size === 0) {
                    candidates = matches;
                } else {
                    candidates = new Set(
                        [...candidates].filter(key => matches.has(key))
                    );
                }
            }
        }

        // Convert candidates to entries
        const results = Array.from(candidates).map(key => index.get(key));

        // Filter null entries
        return results.filter(entry => entry !== undefined);
    }

    private async executeWhereClause(
        schemaName: string,
        clause: WhereClause,
        fieldIndex: Set<string>
    ): Promise<Set<string>> {
        const index = this.indices.get(schemaName);
        const matches = new Set<string>();

        // Use field index if available
        if (fieldIndex && ['eq', 'in'].includes(clause.operator)) {
            const values = Array.isArray(clause.value) ? clause.value : [clause.value];
            for (const value of values) {
                const encodedValue = this.encodeIndexValue(value);
                if (fieldIndex.has(encodedValue)) {
                    matches.add(encodedValue);
                }
            }
            return matches;
        }

        // Full scan for other operators
        for (const [key, entry] of index.entries()) {
            if (this.evaluateWhereClause(entry.data[clause.field], clause)) {
                matches.add(key);
            }
        }

        return matches;
    }

    private evaluateWhereClause(value: any, clause: WhereClause): boolean {
        switch (clause.operator) {
            case 'eq':
                return this.compareValues(value, clause.value) === 0;
            case 'neq':
                return this.compareValues(value, clause.value) !== 0;
            case 'gt':
                return this.compareValues(value, clause.value) > 0;
            case 'gte':
                return this.compareValues(value, clause.value) >= 0;
            case 'lt':
                return this.compareValues(value, clause.value) < 0;
            case 'lte':
                return this.compareValues(value, clause.value) <= 0;
            case 'in':
                return Array.isArray(clause.value) && 
                    clause.value.some(v => this.compareValues(value, v) === 0);
            case 'nin':
                return Array.isArray(clause.value) && 
                    !clause.value.some(v => this.compareValues(value, v) === 0);
            case 'contains':
                return String(value).includes(String(clause.value));
            case 'startsWith':
                return String(value).startsWith(String(clause.value));
            case 'endsWith':
                return String(value).endsWith(String(clause.value));
            default:
                throw new Error(`Unknown operator: ${clause.operator}`);
        }
    }

    private compareValues(a: any, b: any): number {
        if (a instanceof BN && b instanceof BN) {
            return a.cmp(b);
        }
        if (a instanceof Date && b instanceof Date) {
            return a.getTime() - b.getTime();
        }
        if (a instanceof PublicKey && b instanceof PublicKey) {
            return a.toBuffer().compare(b.toBuffer());
        }
        return a < b ? -1 : a > b ? 1 : 0;
    }

    private sortResults(
        results: IndexEntry[],
        orderBy: OrderByClause[]
    ): IndexEntry[] {
        return results.sort((a, b) => {
            for (const clause of orderBy) {
                const valueA = a.data[clause.field];
                const valueB = b.data[clause.field];
                const comparison = this.compareValues(valueA, valueB);
                
                if (comparison !== 0) {
                    return clause.direction === 'asc' ? comparison : -comparison;
                }
            }
            return 0;
        });
    }

    private paginateResults(
        results: IndexEntry[],
        offset = 0,
        limit?: number
    ): IndexEntry[] {
        return results.slice(offset, limit ? offset + limit : undefined);
    }

    private encodeIndexValue(value: any): string {
        if (value instanceof BN) {
            return `bn:${value.toString(16)}`;
        }
        if (value instanceof Date) {
            return `date:${value.getTime()}`;
        }
        if (value instanceof PublicKey) {
            return `pk:${value.toBase58()}`;
        }
        return `v:${String(value)}`;
    }

    private async processIndexUpdate(
        pubkey: PublicKey,
        schemaName: string
    ): Promise<void> {
        const accountKey = pubkey.toBase58();
        const index = this.indices.get(schemaName);
        const fieldIndices = this.fieldIndices.get(schemaName);

        try {
            const accountState = await this.stateManager.loadAccount(pubkey);
            if (!accountState) {
                throw new Error(`Account state not found: ${accountKey}`);
            }

            // Create index entry
            const entry: IndexEntry = {
                pubkey: accountKey,
                data: accountState.data,
                timestamp: Date.now(),
                slot: accountState.slot,
                signature: accountState.signature
            };

            // Update main index
            index.set(accountKey, entry);

            // Update field indices
            for (const [fieldName, fieldIndex] of fieldIndices.entries()) {
                const value = accountState.data[fieldName];
                if (value !== undefined) {
                    const encodedValue = this.encodeIndexValue(value);
                    fieldIndex.add(encodedValue);
                }
            }

            // Update sorted indices
            this.updateSortedIndices(schemaName, accountKey);

            // Check size limits
            this.enforceIndexLimits(schemaName);

            this.emit('index:updated', {
                accountKey,
                schemaName,
                timestamp: Date.now()
            });

        } catch (error) {
            this.emit('index:error', {
                accountKey,
                schemaName,
                error: error.message
            });
            throw error;
        }
    }

    private async queueIndexUpdate(
        pubkey: PublicKey,
        schemaName: string
    ): Promise<void> {
        const accountKey = pubkey.toBase58();
        const pendingUpdate = this.updateQueue.get(accountKey);

        if (pendingUpdate) {
            await pendingUpdate;
            await this.processIndexUpdate(pubkey, schemaName);
        }
    }

    private updateSortedIndices(schemaName: string, accountKey: string): void {
        const sortedKeys = this.sortedIndices.get(schemaName);
        const index = sortedKeys.indexOf(accountKey);

        if (index !== -1) {
            sortedKeys.splice(index, 1);
        }

        if (this.options.sortOrder === 'desc') {
            sortedKeys.unshift(accountKey);
        } else {
            sortedKeys.push(accountKey);
        }
    }

    private enforceIndexLimits(schemaName: string): void {
        const index = this.indices.get(schemaName);
        const sortedKeys = this.sortedIndices.get(schemaName);

        while (index.size > this.options.maxEntries) {
            const oldestKey = sortedKeys.pop();
            if (oldestKey) {
                index.delete(oldestKey);
                this.removeFromFieldIndices(schemaName, oldestKey);
            }
        }
    }

    private removeFromFieldIndices(schemaName: string, accountKey: string): void {
        const fieldIndices = this.fieldIndices.get(schemaName);
        const entry = this.indices.get(schemaName).get(accountKey);

        if (!entry) return;

        for (const [fieldName, fieldIndex] of fieldIndices.entries()) {
        const value = entry.data[fieldName];
        if (value !== undefined) {
            const encodedValue = this.encodeIndexValue(value);
            fieldIndex.delete(encodedValue);
        }
    }
}

private validateIndexFields(fields: IndexField[], schema: any): void {
    for (const field of fields) {
        const schemaField = schema.fields[field.name];
        if (!schemaField) {
            throw new Error(`Field not found in schema: ${field.name}`);
        }

        if (field.unique && !field.indexed) {
            throw new Error(`Unique fields must be indexed: ${field.name}`);
        }

        if (field.sortable && field.type === 'array') {
            throw new Error(`Array fields cannot be sortable: ${field.name}`);
        }

        this.validateFieldType(field.type, schemaField.type);
    }
}

private validateFieldType(indexType: string, schemaType: string): void {
    const validTypes = new Map([
        ['string', ['string']],
        ['number', ['u8', 'u16', 'u32', 'u64', 'i8', 'i16', 'i32', 'i64']],
        ['boolean', ['bool']],
        ['publicKey', ['publicKey']],
        ['BN', ['u64', 'i64']],
        ['date', ['i64']]
    ]);

    const allowedTypes = validTypes.get(indexType);
    if (!allowedTypes?.includes(schemaType)) {
        throw new Error(`Invalid field type mapping: ${indexType} cannot index ${schemaType}`);
    }
}

private setupPersistence(): void {
    if (!this.options.persistToDisk) {
        return;
    }

    this.persistenceTimer = setInterval(
        () => this.persistIndices(),
        5 * 60 * 1000 // Persist every 5 minutes
    );

    process.on('SIGINT', () => this.handleShutdown());
    process.on('SIGTERM', () => this.handleShutdown());
}

private async persistIndices(): Promise<void> {
    if (!this.options.persistToDisk) {
        return;
    }

    try {
        const fs = require('fs').promises;
        const path = require('path');

        // Ensure directory exists
        await fs.mkdir(this.options.persistPath, { recursive: true });

        for (const [schemaName, index] of this.indices.entries()) {
            const filePath = path.join(this.options.persistPath, `${schemaName}.idx`);
            const data = {
                timestamp: Date.now(),
                entries: Array.from(index.entries()),
                fieldIndices: Array.from(this.fieldIndices.get(schemaName).entries()),
                sortedIndices: this.sortedIndices.get(schemaName)
            };

            const serialized = this.options.compressionEnabled
                ? await this.compressData(JSON.stringify(data))
                : JSON.stringify(data);

            await fs.writeFile(filePath, serialized);
        }

        this.emit('persist:success', {
            timestamp: Date.now(),
            schemas: Array.from(this.indices.keys())
        });
    } catch (error) {
        this.emit('persist:error', {
            timestamp: Date.now(),
            error: error.message
        });
    }
}

private async restoreIndices(): Promise<void> {
    if (!this.options.persistToDisk) {
        return;
    }

    try {
        const fs = require('fs').promises;
        const path = require('path');

        const files = await fs.readdir(this.options.persistPath);
        for (const file of files) {
            if (!file.endsWith('.idx')) continue;

            const filePath = path.join(this.options.persistPath, file);
            const content = await fs.readFile(filePath, 'utf8');
            const data = this.options.compressionEnabled
                ? await this.decompressData(content)
                : JSON.parse(content);

            const schemaName = path.basename(file, '.idx');
            
            // Restore indices
            this.indices.set(schemaName, new Map(data.entries));
            this.fieldIndices.set(schemaName, new Map(data.fieldIndices));
            this.sortedIndices.set(schemaName, data.sortedIndices);

            // Validate restored data
            await this.validateRestoredData(schemaName);
        }

        this.emit('restore:success', {
            timestamp: Date.now(),
            schemas: Array.from(this.indices.keys())
        });
    } catch (error) {
        this.emit('restore:error', {
            timestamp: Date.now(),
            error: error.message
        });
    }
}

private async validateRestoredData(schemaName: string): Promise<void> {
    const index = this.indices.get(schemaName);
    const fieldIndices = this.fieldIndices.get(schemaName);
    const sortedIndices = this.sortedIndices.get(schemaName);

    // Validate index integrity
    for (const [key, entry] of index.entries()) {
        if (!sortedIndices.includes(key)) {
            sortedIndices.push(key);
        }

        // Validate field indices
        for (const [fieldName, fieldIndex] of fieldIndices.entries()) {
            const value = entry.data[fieldName];
            if (value !== undefined) {
                const encodedValue = this.encodeIndexValue(value);
                fieldIndex.add(encodedValue);
            }
        }
    }

    // Sort indices if necessary
    if (this.options.sortOrder === 'desc') {
        sortedIndices.sort((a, b) => {
            const entryA = index.get(a);
            const entryB = index.get(b);
            return entryB.timestamp - entryA.timestamp;
        });
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

private setupCleanupInterval(): void {
    setInterval(() => this.cleanupExpiredEntries(), 60 * 60 * 1000); // Every hour
}

private async cleanupExpiredEntries(): Promise<void> {
    const now = Date.now();
    const expiration = now - this.options.maxAge;

    for (const [schemaName, index] of this.indices.entries()) {
        const expiredKeys = Array.from(index.entries())
            .filter(([_, entry]) => entry.timestamp < expiration)
            .map(([key]) => key);

        for (const key of expiredKeys) {
            index.delete(key);
            this.removeFromFieldIndices(schemaName, key);
            const sortedIndex = this.sortedIndices.get(schemaName);
            const position = sortedIndex.indexOf(key);
            if (position !== -1) {
                sortedIndex.splice(position, 1);
            }
        }

        if (expiredKeys.length > 0) {
            this.emit('cleanup:completed', {
                schemaName,
                removedCount: expiredKeys.length,
                timestamp: now
            });
        }
    }
}

private async handleShutdown(): Promise<void> {
    clearInterval(this.persistenceTimer);
    await this.persistIndices();
    this.emit('shutdown');
    process.exit(0);
}

public getStats(schemaName: string): IndexStats {
    const index = this.indices.get(schemaName);
    if (!index) {
        throw new Error(`No index found for schema: ${schemaName}`);
    }

    const fieldIndices = this.fieldIndices.get(schemaName);
    let memorySize = 0;

    // Calculate memory usage
    for (const entry of index.values()) {
        memorySize += this.calculateEntrySize(entry);
    }

    return {
        totalEntries: index.size,
        uniqueFields: fieldIndices.size,
        lastUpdate: Math.max(...Array.from(index.values()).map(e => e.timestamp)),
        diskSize: this.calculateDiskSize(schemaName),
        memorySize
    };
}

private calculateEntrySize(entry: IndexEntry): number {
    let size = 0;
    size += entry.pubkey.length;
    size += JSON.stringify(entry.data).length;
    size += 8; // timestamp
    size += entry.slot ? 8 : 0;
    size += entry.signature ? entry.signature.length : 0;
    return size;
}

private calculateDiskSize(schemaName: string): number {
    if (!this.options.persistToDisk) {
        return 0;
    }

    try {
        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(this.options.persistPath, `${schemaName}.idx`);
        const stats = fs.statSync(filePath);
        return stats.size;
    } catch {
        return 0;
    }
}

public async destroy(): Promise<void> {
    clearInterval(this.persistenceTimer);
    await this.persistIndices();
    this.indices.clear();
    this.fieldIndices.clear();
    this.sortedIndices.clear();
    this.updateQueue.clear();
    this.removeAllListeners();
}
