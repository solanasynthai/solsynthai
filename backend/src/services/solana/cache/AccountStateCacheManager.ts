import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { BN } from 'bn.js';
import { LRUCache } from 'lru-cache';
import { AccountState, AccountStateMetadata, StateUpdate } from '../state/types';
import { EventEmitter } from 'events';

interface CacheOptions {
    maxSize: number;
    maxAge: number;
    updateAgeOnGet: boolean;
    persistToDisk: boolean;
    persistPath?: string;
    compressionEnabled: boolean;
    encryptionEnabled: boolean;
    encryptionKey?: Buffer;
}

interface CacheEntry {
    state: AccountState;
    metadata: AccountStateMetadata;
    lastAccess: number;
    accessCount: number;
    size: number;
    compressed: boolean;
    encrypted: boolean;
}

interface CachePersistenceData {
    version: number;
    timestamp: number;
    entries: Array<{
        key: string;
        data: Buffer;
        metadata: AccountStateMetadata;
    }>;
}

export class AccountStateCacheManager extends EventEmitter {
    private static instance: AccountStateCacheManager;
    private cache: LRUCache<string, CacheEntry>;
    private options: CacheOptions;
    private persistenceTimer: NodeJS.Timer | null;
    private isDirty: boolean;
    private compressionWorkers: Worker[];
    private encryptionWorkers: Worker[];
    private workerPool: WorkerPool;

    private constructor(options: Partial<CacheOptions> = {}) {
        super();
        this.options = {
            maxSize: 1024 * 1024 * 100, // 100MB default
            maxAge: 1000 * 60 * 60, // 1 hour default
            updateAgeOnGet: true,
            persistToDisk: false,
            compressionEnabled: true,
            encryptionEnabled: false,
            ...options
        };

        this.cache = new LRUCache({
            max: this.options.maxSize,
            maxAge: this.options.maxAge,
            updateAgeOnGet: this.options.updateAgeOnGet,
            dispose: (key, entry) => this.handleCacheEviction(key, entry)
        });

        this.isDirty = false;
        this.initializeWorkers();
        this.setupPersistence();
    }

    public static getInstance(options?: Partial<CacheOptions>): AccountStateCacheManager {
        if (!AccountStateCacheManager.instance) {
            AccountStateCacheManager.instance = new AccountStateCacheManager(options);
        }
        return AccountStateCacheManager.instance;
    }

    public async getState(pubkey: PublicKey): Promise<AccountState | null> {
        const key = pubkey.toBase58();
        const entry = this.cache.get(key);

        if (!entry) {
            return null;
        }

        try {
            const state = await this.decompressAndDecrypt(entry);
            this.updateAccessMetrics(key, entry);
            return state;
        } catch (error) {
            this.emit('error', {
                type: 'CACHE_READ_ERROR',
                key,
                error: error.message
            });
            return null;
        }
    }

    public async setState(
        pubkey: PublicKey,
        state: AccountState,
        metadata: AccountStateMetadata
    ): Promise<void> {
        const key = pubkey.toBase58();

        try {
            const size = this.calculateStateSize(state);
            const entry: CacheEntry = {
                state,
                metadata,
                lastAccess: Date.now(),
                accessCount: 0,
                size,
                compressed: this.options.compressionEnabled,
                encrypted: this.options.encryptionEnabled
            };

            if (entry.compressed || entry.encrypted) {
                entry.state = await this.compressAndEncrypt(state);
            }

            this.cache.set(key, entry);
            this.isDirty = true;
            this.emit('update', { type: 'SET', key, size });
        } catch (error) {
            this.emit('error', {
                type: 'CACHE_WRITE_ERROR',
                key,
                error: error.message
            });
            throw error;
        }
    }

    public async updateState(
        pubkey: PublicKey,
        updates: Partial<AccountState>
    ): Promise<void> {
        const key = pubkey.toBase58();
        const entry = this.cache.get(key);

        if (!entry) {
            throw new Error(`State not found in cache: ${key}`);
        }

        try {
            const currentState = await this.decompressAndDecrypt(entry);
            const updatedState = {
                ...currentState,
                ...updates,
                lastUpdate: Date.now()
            };

            await this.setState(pubkey, updatedState, entry.metadata);
            this.emit('update', { type: 'UPDATE', key });
        } catch (error) {
            this.emit('error', {
                type: 'CACHE_UPDATE_ERROR',
                key,
                error: error.message
            });
            throw error;
        }
    }

    public async invalidateState(pubkey: PublicKey): Promise<void> {
        const key = pubkey.toBase58();
        this.cache.delete(key);
        this.isDirty = true;
        this.emit('update', { type: 'INVALIDATE', key });
    }

    public async invalidateAll(): Promise<void> {
        this.cache.clear();
        this.isDirty = true;
        this.emit('update', { type: 'INVALIDATE_ALL' });
    }

    public async persist(): Promise<void> {
        if (!this.options.persistToDisk || !this.isDirty) {
            return;
        }

        try {
            const data = await this.preparePersistenceData();
            await this.writePersistenceData(data);
            this.isDirty = false;
            this.emit('persist', { timestamp: Date.now() });
        } catch (error) {
            this.emit('error', {
                type: 'PERSISTENCE_ERROR',
                error: error.message
            });
            throw error;
        }
    }

    public async restore(): Promise<void> {
        if (!this.options.persistToDisk) {
            return;
        }

        try {
            const data = await this.readPersistenceData();
            await this.restoreFromPersistenceData(data);
            this.emit('restore', { timestamp: Date.now() });
        } catch (error) {
            this.emit('error', {
                type: 'RESTORE_ERROR',
                error: error.message
            });
            throw error;
        }
    }

    private async compressAndEncrypt(state: AccountState): Promise<Buffer> {
        let data = Buffer.from(JSON.stringify(state));

        if (this.options.compressionEnabled) {
            data = await this.workerPool.compress(data);
        }

        if (this.options.encryptionEnabled && this.options.encryptionKey) {
            data = await this.workerPool.encrypt(data, this.options.encryptionKey);
        }

        return data;
    }

    private async decompressAndDecrypt(entry: CacheEntry): Promise<AccountState> {
        let data = entry.state as unknown as Buffer;

        if (entry.encrypted && this.options.encryptionKey) {
            data = await this.workerPool.decrypt(data, this.options.encryptionKey);
        }

        if (entry.compressed) {
            data = await this.workerPool.decompress(data);
        }

        return JSON.parse(data.toString());
    }

    private calculateStateSize(state: AccountState): number {
        const serialized = JSON.stringify(state);
        return Buffer.byteLength(serialized, 'utf8');
    }

    private updateAccessMetrics(key: string, entry: CacheEntry): void {
        entry.lastAccess = Date.now();
        entry.accessCount++;
        this.emit('access', { key, accessCount: entry.accessCount });
    }

    private handleCacheEviction(key: string, entry: CacheEntry): void {
        this.isDirty = true;
        this.emit('evict', {
            key,
            reason: 'CACHE_FULL',
            size: entry.size,
            accessCount: entry.accessCount
        });
    }

    private async preparePersistenceData(): Promise<CachePersistenceData> {
        const entries: CachePersistenceData['entries'] = [];

        for (const [key, entry] of this.cache.entries()) {
            entries.push({
                key,
                data: await this.compressAndEncrypt(entry.state),
                metadata: entry.metadata
            });
        }

        return {
            version: 1,
            timestamp: Date.now(),
            entries
        };
    }

    private async writePersistenceData(data: CachePersistenceData): Promise<void> {
        if (!this.options.persistPath) {
            throw new Error('Persistence path not configured');
        }

        const fs = require('fs').promises;
        const serialized = JSON.stringify(data);
        await fs.writeFile(this.options.persistPath, serialized, 'utf8');
    }

    private async readPersistenceData(): Promise<CachePersistenceData> {
        if (!this.options.persistPath) {
            throw new Error('Persistence path not configured');
        }

        const fs = require('fs').promises;
        const data = await fs.readFile(this.options.persistPath, 'utf8');
        return JSON.parse(data);
    }

    private async restoreFromPersistenceData(data: CachePersistenceData): Promise<void> {
        for (const entry of data.entries) {
            const state = await this.decompressAndDecrypt({
                state: entry.data,
                metadata: entry.metadata,
                compressed: this.options.compressionEnabled,
                encrypted: this.options.encryptionEnabled
            } as CacheEntry);

            await this.setState(new PublicKey(entry.key), state, entry.metadata);
        }
    }

    private initializeWorkers(): void {
        this.workerPool = new WorkerPool({
            minWorkers: 2,
            maxWorkers: 4,
            taskTimeout: 5000
        });
    }

    private setupPersistence(): void {
        if (this.options.persistToDisk) {
            this.persistenceTimer = setInterval(
                () => this.persist(),
                1000 * 60 * 5 // Persist every 5 minutes
            );
        }
    }

    public destroy(): void {
        if (this.persistenceTimer) {
            clearInterval(this.persistenceTimer);
        }
        this.workerPool.terminate();
        this.cache.clear();
        this.removeAllListeners();
    }
}

class WorkerPool {
    private workers: Worker[];
    private taskQueue: Array<{
        task: () => Promise<any>;
        resolve: (result: any) => void;
        reject: (error: Error) => void;
    }>;
    private isProcessing: boolean;

    constructor(private options: {
        minWorkers: number;
        maxWorkers: number;
        taskTimeout: number;
    }) {
        this.workers = [];
        this.taskQueue = [];
        this.isProcessing = false;
        this.initializeWorkers();
    }

    public async compress(data: Buffer): Promise<Buffer> {
        return this.scheduleTask(() => {
            const worker = this.getAvailableWorker();
            return worker.compress(data);
        });
    }

    public async decompress(data: Buffer): Promise<Buffer> {
        return this.scheduleTask(() => {
            const worker = this.getAvailableWorker();
            return worker.decompress(data);
        });
    }

    public async encrypt(data: Buffer, key: Buffer): Promise<Buffer> {
        return this.scheduleTask(() => {
            const worker = this.getAvailableWorker();
            return worker.encrypt(data, key);
        });
    }

    public async decrypt(data: Buffer, key: Buffer): Promise<Buffer> {
        return this.scheduleTask(() => {
            const worker = this.getAvailableWorker();
            return worker.decrypt(data, key);
        });
    }

    private async scheduleTask<T>(task: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.taskQueue.push({ task, resolve, reject });
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }

    private async processQueue(): Promise<void> {
        if (this.taskQueue.length === 0) {
            this.isProcessing = false;
            return;
        }

        this.isProcessing = true;
        const { task, resolve, reject } = this.taskQueue.shift()!;

        try {
            const result = await Promise.race([
                task(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Task timeout')), this.options.taskTimeout)
                )
            ]);
            resolve(result);
        } catch (error) {
            reject(error);
        }

        setImmediate(() => this.processQueue());
    }

    private getAvailableWorker(): Worker {
        // Simple round-robin worker selection
        const worker = this.workers.shift()!;
        this.workers.push(worker);
        return worker;
    }

    private initializeWorkers(): void {
        for (let i = 0; i < this.options.minWorkers; i++) {
            this.workers.push(new Worker(require.resolve('./worker')));
        }
    }

    public terminate(): void {
        this.workers.forEach(worker => worker.terminate());
        this.workers = [];
        this.taskQueue = [];
        this.isProcessing = false;
    }
}
