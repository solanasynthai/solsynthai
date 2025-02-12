import { PublicKey, Connection } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { AccountStateManager } from '../state/AccountStateManager';
import { AccountStateIndexer } from '../indexer/AccountStateIndexer';
import { AccountSchemaManager } from '../schema/AccountSchemaManager';
import { BN } from 'bn.js';

interface QueryOptions {
    maxResults?: number;
    timeout?: number;
    useCache?: boolean;
    retryAttempts?: number;
    retryDelay?: number;
    parallel?: boolean;
    sortOrder?: 'asc' | 'desc';
    includeMetadata?: boolean;
}

interface QueryFilter {
    field: string;
    operator: FilterOperator;
    value: any;
    orConditions?: QueryFilter[];
}

type FilterOperator = 
    | 'eq' | 'neq' 
    | 'gt' | 'gte' 
    | 'lt' | 'lte'
    | 'in' | 'nin'
    | 'contains' | 'startsWith' | 'endsWith'
    | 'between' | 'exists' | 'notExists';

interface QuerySort {
    field: string;
    direction: 'asc' | 'desc';
}

interface QueryResult<T = any> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
    executionTime: number;
    cached: boolean;
}

interface QueryCache {
    key: string;
    result: QueryResult;
    timestamp: number;
    expiresAt: number;
}

interface QueryStats {
    totalQueries: number;
    cacheHits: number;
    cacheMisses: number;
    averageExecutionTime: number;
    slowestQuery: number;
    fastestQuery: number;
}

export class AccountStateQueryManager extends EventEmitter {
    private static instance: AccountStateQueryManager;
    private connection: Connection;
    private stateManager: AccountStateManager;
    private indexer: AccountStateIndexer;
    private schemaManager: AccountSchemaManager;
    private queryCache: Map<string, QueryCache>;
    private queryStats: QueryStats;
    private defaultOptions: Required<QueryOptions>;

    private constructor(connection: Connection) {
        super();
        this.connection = connection;
        this.stateManager = AccountStateManager.getInstance();
        this.indexer = AccountStateIndexer.getInstance(connection);
        this.schemaManager = AccountSchemaManager.getInstance();
        this.queryCache = new Map();
        this.queryStats = {
            totalQueries: 0,
            cacheHits: 0,
            cacheMisses: 0,
            averageExecutionTime: 0,
            slowestQuery: 0,
            fastestQuery: Number.MAX_VALUE
        };
        this.defaultOptions = {
            maxResults: 1000,
            timeout: 30000,
            useCache: true,
            retryAttempts: 3,
            retryDelay: 1000,
            parallel: true,
            sortOrder: 'desc',
            includeMetadata: false
        };

        this.setupCacheCleanup();
    }

    public static getInstance(connection: Connection): AccountStateQueryManager {
        if (!AccountStateQueryManager.instance) {
            AccountStateQueryManager.instance = new AccountStateQueryManager(connection);
        }
        return AccountStateQueryManager.instance;
    }

    public async query<T = any>(
        schemaName: string,
        filter: QueryFilter[],
        sort?: QuerySort[],
        page = 1,
        pageSize = 50,
        options: Partial<QueryOptions> = {}
    ): Promise<QueryResult<T>> {
        const startTime = Date.now();
        const mergedOptions = { ...this.defaultOptions, ...options };
        const cacheKey = this.generateCacheKey(schemaName, filter, sort, page, pageSize);

        try {
            // Check cache
            if (mergedOptions.useCache) {
                const cachedResult = this.getCachedResult(cacheKey);
                if (cachedResult) {
                    this.updateQueryStats(Date.now() - startTime, true);
                    return cachedResult;
                }
            }

            // Execute query
            const result = await this.executeQuery<T>(
                schemaName,
                filter,
                sort,
                page,
                pageSize,
                mergedOptions
            );

            // Cache result
            if (mergedOptions.useCache) {
                this.cacheResult(cacheKey, result);
            }

            this.updateQueryStats(Date.now() - startTime, false);
            return result;

        } catch (error) {
            this.emit('query:error', {
                schemaName,
                filter,
                error: error.message
            });
            throw error;
        }
    }

    private async executeQuery<T>(
        schemaName: string,
        filter: QueryFilter[],
        sort: QuerySort[],
        page: number,
        pageSize: number,
        options: Required<QueryOptions>
    ): Promise<QueryResult<T>> {
        const schema = this.schemaManager.getSchema(schemaName);
        const startTime = Date.now();

        // Get filtered accounts from indexer
        const indexQuery = this.convertToIndexQuery(filter, sort);
        const indexResults = await this.indexer.query(schemaName, indexQuery);

        // Apply pagination
        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        const paginatedResults = indexResults.slice(start, end);

        // Load full account data if needed
        const accountData = options.parallel
            ? await Promise.all(paginatedResults.map(result => 
                this.loadAccountData<T>(new PublicKey(result.pubkey), options)
              ))
            : await this.loadAccountsSequentially<T>(paginatedResults, options);

        // Format results
        const formattedResults = accountData.map((data, index) => ({
            ...data,
            ...(options.includeMetadata ? { metadata: paginatedResults[index] } : {})
        }));

        return {
            data: formattedResults,
            total: indexResults.length,
            page,
            pageSize,
            hasMore: end < indexResults.length,
            executionTime: Date.now() - startTime,
            cached: false
        };
    }

    private async loadAccountData<T>(
        pubkey: PublicKey,
        options: Required<QueryOptions>
    ): Promise<T> {
        let attempts = 0;
        let lastError: Error;

        while (attempts < options.retryAttempts) {
            try {
                const account = await this.stateManager.loadAccount(pubkey);
                if (!account) {
                    throw new Error(`Account not found: ${pubkey.toBase58()}`);
                }
                return account.data as T;
            } catch (error) {
                lastError = error;
                attempts++;
                if (attempts < options.retryAttempts) {
                    await new Promise(resolve => 
                        setTimeout(resolve, options.retryDelay)
                    );
                }
            }
        }

        throw lastError;
    }

    private async loadAccountsSequentially<T>(
        results: any[],
        options: Required<QueryOptions>
    ): Promise<T[]> {
        const accounts: T[] = [];
        for (const result of results) {
            const account = await this.loadAccountData<T>(
                new PublicKey(result.pubkey),
                options
            );
            accounts.push(account);
        }
        return accounts;
    }

    private convertToIndexQuery(
        filter: QueryFilter[],
        sort?: QuerySort[]
    ): any {
        return {
            where: this.convertFilters(filter),
            orderBy: sort?.map(s => ({
                field: s.field,
                direction: s.direction
            }))
        };
    }

    private convertFilters(filters: QueryFilter[]): any[] {
        return filters.map(filter => {
            if (filter.orConditions) {
                return {
                    or: this.convertFilters(filter.orConditions)
                };
            }

            return {
                field: filter.field,
                operator: this.convertOperator(filter.operator),
                value: this.convertValue(filter.value)
            };
        });
    }

    private convertOperator(operator: FilterOperator): string {
        const operatorMap: Record<FilterOperator, string> = {
            eq: 'eq',
            neq: 'neq',
            gt: 'gt',
            gte: 'gte',
            lt: 'lt',
            lte: 'lte',
            in: 'in',
            nin: 'nin',
            contains: 'contains',
            startsWith: 'startsWith',
            endsWith: 'endsWith',
            between: 'between',
            exists: 'exists',
            notExists: 'notExists'
        };

        return operatorMap[operator] || 'eq';
    }

    private convertValue(value: any): any {
        if (value instanceof BN) {
            return value.toString();
        }
        if (value instanceof PublicKey) {
            return value.toBase58();
        }
        if (value instanceof Date) {
            return value.getTime();
        }
        return value;
    }

    private generateCacheKey(
        schemaName: string,
        filter: QueryFilter[],
        sort: QuerySort[],
        page: number,
        pageSize: number
    ): string {
        const queryData = {
            schemaName,
            filter,
            sort,
            page,
            pageSize
        };
        return JSON.stringify(queryData);
    }

    private getCachedResult(key: string): QueryResult | null {
        const cached = this.queryCache.get(key);
        if (!cached || Date.now() > cached.expiresAt) {
            return null;
        }
        return cached.result;
    }

    private cacheResult(key: string, result: QueryResult): void {
        this.queryCache.set(key, {
            key,
            result,
            timestamp: Date.now(),
            expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes cache
        });
    }

    private updateQueryStats(executionTime: number, cached: boolean): void {
        this.queryStats.totalQueries++;
        if (cached) {
            this.queryStats.cacheHits++;
        } else {
            this.queryStats.cacheMisses++;
        }

        this.queryStats.averageExecutionTime = 
            (this.queryStats.averageExecutionTime * (this.queryStats.totalQueries - 1) + executionTime) / 
            this.queryStats.totalQueries;

        this.queryStats.slowestQuery = Math.max(this.queryStats.slowestQuery, executionTime);
        this.queryStats.fastestQuery = Math.min(this.queryStats.fastestQuery, executionTime);
    }

    private setupCacheCleanup(): void {
        setInterval(() => this.cleanupCache(), 60 * 1000); // Every minute
    }

    private cleanupCache(): void {
        const now = Date.now();
        for (const [key, cache] of this.queryCache.entries()) {
            if (now > cache.expiresAt) {
                this.queryCache.delete(key);
            }
        }
    }

    public getQueryStats(): QueryStats {
        return { ...this.queryStats };
    }

    public clearCache(): void {
        this.queryCache.clear();
        this.emit('cache:cleared', { timestamp: Date.now() });
    }

    public async destroy(): Promise<void> {
        this.clearCache();
        this.removeAllListeners();
    }
}
