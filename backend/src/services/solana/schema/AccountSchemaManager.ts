import { 
    AccountSchema,
    ValidationError,
    ValidationErrorType,
    SchemaValidationOptions,
    MemoryLayout
} from '../layout/types';
import { SchemaBuilder } from '../builders/SchemaBuilder';
import { LayoutTransformer } from '../layout/LayoutTransformer';
import { AccountDataValidator } from '../validators/AccountDataValidator';
import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha256';

interface SchemaVersion {
    schema: AccountSchema;
    layout: MemoryLayout;
    hash: string;
    timestamp: number;
}

interface SchemaMigration {
    sourceVersion: number;
    targetVersion: number;
    migrationFn: (data: any) => any;
}

export class AccountSchemaManager {
    private static instance: AccountSchemaManager;
    private schemas: Map<string, Map<number, SchemaVersion>>;
    private migrations: Map<string, SchemaMigration[]>;
    private layoutTransformer: LayoutTransformer;
    private validator: AccountDataValidator;

    private constructor() {
        this.schemas = new Map();
        this.migrations = new Map();
        this.layoutTransformer = LayoutTransformer.getInstance();
        this.validator = AccountDataValidator.getInstance();
    }

    public static getInstance(): AccountSchemaManager {
        if (!AccountSchemaManager.instance) {
            AccountSchemaManager.instance = new AccountSchemaManager();
        }
        return AccountSchemaManager.instance;
    }

    public registerSchema(
        schema: AccountSchema,
        options: SchemaValidationOptions = {}
    ): void {
        try {
            // Validate schema
            this.validateSchema(schema, options);

            // Compute layout and hash
            const layout = this.layoutTransformer.computeLayout(schema);
            const hash = this.computeSchemaHash(schema);

            const schemaVersion: SchemaVersion = {
                schema,
                layout,
                hash,
                timestamp: Date.now()
            };

            // Store schema version
            if (!this.schemas.has(schema.name)) {
                this.schemas.set(schema.name, new Map());
            }

            const versions = this.schemas.get(schema.name);
            versions.set(schema.version, schemaVersion);

        } catch (error) {
            throw new Error(`Failed to register schema: ${error.message}`);
        }
    }

    public getSchema(name: string, version?: number): AccountSchema {
        const versions = this.schemas.get(name);
        if (!versions) {
            throw new Error(`Schema not found: ${name}`);
        }

        if (version === undefined) {
            // Get latest version
            const latestVersion = Math.max(...Array.from(versions.keys()));
            return versions.get(latestVersion).schema;
        }

        const schemaVersion = versions.get(version);
        if (!schemaVersion) {
            throw new Error(`Schema version not found: ${name}@${version}`);
        }

        return schemaVersion.schema;
    }

    public async migrateData(
        data: any,
        sourceName: string,
        sourceVersion: number,
        targetVersion: number
    ): Promise<any> {
        const sourceSchema = this.getSchema(sourceName, sourceVersion);
        const targetSchema = this.getSchema(sourceName, targetVersion);

        // Validate source data
        const validationResult = this.validator.validateAccountData(data, sourceSchema);
        if (!validationResult.isValid) {
            throw new Error(`Invalid source data: ${JSON.stringify(validationResult.errors)}`);
        }

        try {
            let migratedData = { ...data };

            // Get migration path
            const migrations = this.getMigrationPath(
                sourceName,
                sourceVersion,
                targetVersion
            );

            // Apply migrations in sequence
            for (const migration of migrations) {
                migratedData = await migration.migrationFn(migratedData);

                // Validate intermediate results
                const intermediateSchema = this.getSchema(sourceName, migration.targetVersion);
                const intermediateValidation = this.validator.validateAccountData(
                    migratedData,
                    intermediateSchema
                );

                if (!intermediateValidation.isValid) {
                    throw new Error(
                        `Migration validation failed at version ${migration.targetVersion}: ${
                            JSON.stringify(intermediateValidation.errors)
                        }`
                    );
                }
            }

            return migratedData;

        } catch (error) {
            throw new Error(`Migration failed: ${error.message}`);
        }
    }

    public registerMigration(
        schemaName: string,
        sourceVersion: number,
        targetVersion: number,
        migrationFn: (data: any) => any
    ): void {
        // Validate versions exist
        this.getSchema(schemaName, sourceVersion);
        this.getSchema(schemaName, targetVersion);

        if (!this.migrations.has(schemaName)) {
            this.migrations.set(schemaName, []);
        }

        const migrations = this.migrations.get(schemaName);
        migrations.push({
            sourceVersion,
            targetVersion,
            migrationFn
        });

        // Sort migrations by version
        migrations.sort((a, b) => a.sourceVersion - b.sourceVersion);
    }

    public getSchemaVersions(name: string): number[] {
        const versions = this.schemas.get(name);
        if (!versions) {
            throw new Error(`Schema not found: ${name}`);
        }
        return Array.from(versions.keys()).sort((a, b) => a - b);
    }

    public validateSchemaCompatibility(
        schema1: AccountSchema,
        schema2: AccountSchema
    ): ValidationError[] {
        const errors: ValidationError[] = [];

        // Check basic compatibility
        if (schema1.name !== schema2.name) {
            errors.push({
                field: 'name',
                message: 'Schema names do not match',
                errorType: ValidationErrorType.CUSTOM_VALIDATION_FAILED
            });
            return errors;
        }

        // Compare fields
        const fields1 = new Set(Object.keys(schema1.fields));
        const fields2 = new Set(Object.keys(schema2.fields));

        // Check for removed required fields
        for (const [fieldName, field] of Object.entries(schema1.fields)) {
            if (field.required && !fields2.has(fieldName)) {
                errors.push({
                    field: fieldName,
                    message: 'Required field removed',
                    errorType: ValidationErrorType.REQUIRED_FIELD_MISSING
                });
            }
        }

        // Check field type compatibility
        for (const [fieldName, field1] of Object.entries(schema1.fields)) {
            const field2 = schema2.fields[fieldName];
            if (!field2) continue;

            if (!this.areTypesCompatible(field1.type, field2.type)) {
                errors.push({
                    field: fieldName,
                    message: 'Incompatible field type change',
                    errorType: ValidationErrorType.INVALID_TYPE
                });
            }
        }

        return errors;
    }

    private validateSchema(
        schema: AccountSchema,
        options: SchemaValidationOptions
    ): void {
        const errors: ValidationError[] = [];

        // Validate schema structure
        if (!schema.name || typeof schema.name !== 'string') {
            errors.push({
                field: 'name',
                message: 'Invalid schema
