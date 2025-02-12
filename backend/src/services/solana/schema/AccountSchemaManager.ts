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

    # File: /backend/src/services/solana/schema/AccountSchemaManager.ts (continued)

    private validateSchema(schema: AccountSchema, options: SchemaValidationOptions): void {
        const errors: ValidationError[] = [];

        // Validate schema structure
        if (!schema.name || typeof schema.name !== 'string') {
            errors.push({
                field: 'name',
                message: 'Invalid schema name',
                errorType: ValidationErrorType.INVALID_TYPE
            });
        }

        if (!schema.fields || Object.keys(schema.fields).length === 0) {
            errors.push({
                field: 'fields',
                message: 'Schema must have at least one field',
                errorType: ValidationErrorType.REQUIRED_FIELD_MISSING
            });
            return;
        }

        // Validate version format
        if (!Number.isInteger(schema.version) || schema.version < 0) {
            errors.push({
                field: 'version',
                message: 'Version must be a non-negative integer',
                errorType: ValidationErrorType.INVALID_TYPE
            });
        }

        // Check for field name collisions
        const fieldNames = new Set<string>();
        for (const fieldName of Object.keys(schema.fields)) {
            if (fieldNames.has(fieldName.toLowerCase())) {
                errors.push({
                    field: fieldName,
                    message: 'Field name collision detected (case-insensitive)',
                    errorType: ValidationErrorType.CUSTOM_VALIDATION_FAILED
                });
            }
            fieldNames.add(fieldName.toLowerCase());
        }

        // Validate each field's structure and type
        for (const [fieldName, field] of Object.entries(schema.fields)) {
            // Validate field name format
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fieldName)) {
                errors.push({
                    field: fieldName,
                    message: 'Invalid field name format - must start with letter or underscore',
                    errorType: ValidationErrorType.INVALID_TYPE
                });
            }

            // Validate field type
            if (!this.isValidFieldType(field.type)) {
                errors.push({
                    field: fieldName,
                    message: `Invalid field type: ${field.type}`,
                    errorType: ValidationErrorType.INVALID_TYPE
                });
            }

            // Validate array fields
            if (field.array) {
                if (field.arrayLength !== undefined) {
                    if (!Number.isInteger(field.arrayLength) || field.arrayLength <= 0) {
                        errors.push({
                            field: fieldName,
                            message: 'Array length must be a positive integer',
                            errorType: ValidationErrorType.CONSTRAINT_VIOLATION
                        });
                    }
                    if (field.arrayLength > 1024) { // Maximum reasonable array length
                        errors.push({
                            field: fieldName,
                            message: 'Array length exceeds maximum allowed (1024)',
                            errorType: ValidationErrorType.CONSTRAINT_VIOLATION
                        });
                    }
                }
            }

            // Validate nested schemas
            if (field.nested) {
                const nestedErrors = this.validateNestedSchema(field.nested, `${fieldName}.`);
                errors.push(...nestedErrors);
            }

            // Validate field constraints
            if (field.constraints) {
                const constraintErrors = this.validateFieldConstraints(field, fieldName);
                errors.push(...constraintErrors);
            }

            // Validate default values
            if (field.defaultValue !== undefined) {
                const defaultValueErrors = this.validateDefaultValue(field, fieldName);
                errors.push(...defaultValueErrors);
            }
        }

        // Validate total schema size
        const totalSize = this.calculateSchemaSize(schema);
        if (totalSize > 10240) { // 10KB maximum reasonable size
            errors.push({
                field: 'schema',
                message: `Schema size (${totalSize} bytes) exceeds maximum allowed (10240 bytes)`,
                errorType: ValidationErrorType.CONSTRAINT_VIOLATION
            });
        }

        // Validate discriminator if present
        if (schema.discriminator !== undefined) {
            if (!Number.isInteger(schema.discriminator) || schema.discriminator < 0) {
                errors.push({
                    field: 'discriminator',
                    message: 'Discriminator must be a non-negative integer',
                    errorType: ValidationErrorType.INVALID_TYPE
                });
            }
        }

        // Validate schema metadata
        if (schema.metadata) {
            const metadataErrors = this.validateSchemaMetadata(schema.metadata);
            errors.push(...metadataErrors);
        }

        // Check for circular dependencies in nested schemas
        const circularDeps = this.checkCircularDependencies(schema);
        if (circularDeps.length > 0) {
            errors.push({
                field: 'schema',
                message: `Circular dependencies detected: ${circularDeps.join(' -> ')}`,
                errorType: ValidationErrorType.CUSTOM_VALIDATION_FAILED
            });
        }

        // Additional validations based on options
        if (options.strict) {
            const strictErrors = this.performStrictValidation(schema);
            errors.push(...strictErrors);
        }

        if (errors.length > 0) {
            throw new Error(`Schema validation failed:\n${this.formatValidationErrors(errors)}`);
        }
    }

    private isValidFieldType(type: DataType): boolean {
        const basicTypes = new Set([
            'u8', 'u16', 'u32', 'u64',
            'i8', 'i16', 'i32', 'i64',
            'bool', 'string', 'publicKey', 'bytes'
        ]);

        if (basicTypes.has(type as string)) {
            return true;
        }

        if (typeof type === 'object' && type !== null) {
            // Validate custom type structure
            return (
                typeof type.name === 'string' &&
                typeof type.size === 'number' &&
                typeof type.serialize === 'function' &&
                typeof type.deserialize === 'function' &&
                typeof type.validate === 'function'
            );
        }

        return false;
    }

    private validateNestedSchema(schema: AccountSchema, prefix: string): ValidationError[] {
        try {
            this.validateSchema(schema, { strict: true });
            return [];
        } catch (error) {
            if (error.message.includes('Schema validation failed:')) {
                return this.parseValidationErrors(error.message).map(err => ({
                    ...err,
                    field: prefix + err.field
                }));
            }
            throw error;
        }
    }

    private validateFieldConstraints(field: any, fieldName: string): ValidationError[] {
        const errors: ValidationError[] = [];
        const constraints = field.constraints;

        if (constraints.min !== undefined && constraints.max !== undefined) {
            if (constraints.min > constraints.max) {
                errors.push({
                    field: fieldName,
                    message: `Min value (${constraints.min}) cannot be greater than max value (${constraints.max})`,
                    errorType: ValidationErrorType.CONSTRAINT_VIOLATION
                });
            }
        }

        if (constraints.length !== undefined) {
            if (!Number.isInteger(constraints.length) || constraints.length <= 0) {
                errors.push({
                    field: fieldName,
                    message: 'Length constraint must be a positive integer',
                    errorType: ValidationErrorType.CONSTRAINT_VIOLATION
                });
            }
        }

        if (constraints.pattern) {
            try {
                new RegExp(constraints.pattern);
            } catch {
                errors.push({
                    field: fieldName,
                    message: 'Invalid regular expression pattern',
                    errorType: ValidationErrorType.CONSTRAINT_VIOLATION
                });
            }
        }

        return errors;
    }

    private validateDefaultValue(field: any, fieldName: string): ValidationError[] {
        const errors: ValidationError[] = [];
        const defaultValue = field.defaultValue;

        // Type checking
        switch (field.type) {
            case 'u8':
            case 'u16':
            case 'u32':
            case 'u64':
                if (!Number.isInteger(defaultValue) || defaultValue < 0) {
                    errors.push({
                        field: fieldName,
                        message: 'Default value must be a non-negative integer',
                        errorType: ValidationErrorType.INVALID_TYPE
                    });
                }
                break;
            case 'i8':
            case 'i16':
            case 'i32':
            case 'i64':
                if (!Number.isInteger(defaultValue)) {
                    errors.push({
                        field: fieldName,
                        message: 'Default value must be an integer',
                        errorType: ValidationErrorType.INVALID_TYPE
                    });
                }
                break;
            case 'bool':
                if (typeof defaultValue !== 'boolean') {
                    errors.push({
                        field: fieldName,
                        message: 'Default value must be a boolean',
                        errorType: ValidationErrorType.INVALID_TYPE
                    });
                }
                break;
            case 'string':
                if (typeof defaultValue !== 'string') {
                    errors.push({
                        field: fieldName,
                        message: 'Default value must be a string',
                        errorType: ValidationErrorType.INVALID_TYPE
                    });
                }
                break;
            case 'publicKey':
                try {
                    new PublicKey(defaultValue);
                } catch {
                    errors.push({
                        field: fieldName,
                        message: 'Default value must be a valid public key',
                        errorType: ValidationErrorType.INVALID_TYPE
                    });
                }
                break;
        }

        // Constraint validation
        if (field.constraints) {
            if (field.constraints.min !== undefined && defaultValue < field.constraints.min) {
                errors.push({
                    field: fieldName,
                    message: `Default value is less than minimum (${field.constraints.min})`,
                    errorType: ValidationErrorType.CONSTRAINT_VIOLATION
                });
            }
            if (field.constraints.max !== undefined && defaultValue > field.constraints.max) {
                errors.push({
                    field: fieldName,
                    message: `Default value is greater than maximum (${field.constraints.max})`,
                    errorType: ValidationErrorType.CONSTRAINT_VIOLATION
                });
            }
            if (field.constraints.pattern && typeof defaultValue === 'string') {
                const regex = new RegExp(field.constraints.pattern);
                if (!regex.test(defaultValue)) {
                    errors.push({
                        field: fieldName,
                        message: 'Default value does not match pattern constraint',
                        errorType: ValidationErrorType.CONSTRAINT_VIOLATION
                    });
                }
            }
        }

        return errors;
    }

    private validateSchemaMetadata(metadata: any): ValidationError[] {
        const errors: ValidationError[] = [];

        if (metadata.description && typeof metadata.description !== 'string') {
            errors.push({
                field: 'metadata.description',
                message: 'Description must be a string',
                errorType: ValidationErrorType.INVALID_TYPE
            });
        }

        if (metadata.authority) {
            try {
                new PublicKey(metadata.authority);
            } catch {
                errors.push({
                    field: 'metadata.authority',
                    message: 'Invalid authority public key',
                    errorType: ValidationErrorType.INVALID_TYPE
                });
            }
        }

        if (metadata.maxSize !== undefined) {
            if (!Number.isInteger(metadata.maxSize) || metadata.maxSize <= 0) {
                errors.push({
                    field: 'metadata.maxSize',
                    message: 'Max size must be a positive integer',
                    errorType: ValidationErrorType.CONSTRAINT_VIOLATION
                });
            }
        }

        return errors;
    }

    private checkCircularDependencies(schema: AccountSchema): string[] {
        const visited = new Set<string>();
        const path: string[] = [];
        const cycles: string[] = [];

        const dfs = (currentSchema: AccountSchema, schemaPath: string[]) => {
            if (schemaPath.includes(currentSchema.name)) {
                cycles.push([...schemaPath, currentSchema.name].join(' -> '));
                return;
            }

            if (visited.has(currentSchema.name)) {
                return;
            }

            visited.add(currentSchema.name);
            schemaPath.push(currentSchema.name);

            for (const field of Object.values(currentSchema.fields)) {
                if (field.nested) {
                    dfs(field.nested, [...schemaPath]);
                }
            }

            schemaPath.pop();
        };

        dfs(schema, path);
        return cycles;
    }

    private performStrictValidation(schema: AccountSchema): ValidationError[] {
        const errors: ValidationError[] = [];

        // Check for unused or redundant fields
        const usedFields = new Set<string>();
        this.findUsedFields(schema, usedFields);

        for (const fieldName of Object.keys(schema.fields)) {
            if (!usedFields.has(fieldName)) {
                errors.push({
                    field: fieldName,
                    message: 'Unused field detected',
                    errorType: ValidationErrorType.CUSTOM_VALIDATION_FAILED
                });
            }
        }

        // Additional strict validations can be added here

        return errors;
    }

    private findUsedFields(schema: AccountSchema, usedFields: Set<string>): void {
        for (const [fieldName, field] of Object.entries(schema.fields)) {
            usedFields.add(fieldName);
            if (field.nested) {
                this.findUsedFields(field.nested, usedFields);
            }
        }
    }

    private calculateSchemaSize(schema: AccountSchema): number {
        let size = 0;
        for (const field of Object.values(schema.fields)) {
            size += this.getFieldSize(field);
        }
        return size;
    }

    private getFieldSize(field: any): number {
        let baseSize = 0;
        switch (field.type) {
            case 'u8':
            case 'i8':
            case 'bool':
                baseSize = 1;
                break;
            case 'u16':
            case 'i16':
                baseSize = 2;
                break;
            case 'u32':
            case 'i32':
                baseSize = 4;
                break;
            case 'u64':
            case 'i64':
                baseSize = 8;
                break;
            case 'publicKey':
                baseSize = 32;
                break;
            case 'string':
                baseSize = field.constraints?.maxLength || 256;
                break;
            default:
                if (typeof field.type === 'object' && field.type.size) {
                    baseSize = field.type.size;
                }
        }

        if (field.array) {
            return baseSize * (field.arrayLength || 1);
        }

        if (field.nested) {
            return this.calculateSchemaSize(field.nested);
        }

        return baseSize;
    }

    private formatValidationErrors(errors: ValidationError[]): string {
        return errors
            .map(error => `${error.field}: ${error.message} (${error.errorType})`)
            .join('\n');
    }

    public compareSchemas(schema1: AccountSchema, schema2: AccountSchema): SchemaComparison {
        const comparison: SchemaComparison = {
            compatible: true,
            addedFields: [],
            removedFields: [],
            modifiedFields: [],
            breakingChanges: []
        };

        const fields1 = new Set(Object.keys(schema1.fields));
        const fields2 = new Set(Object.keys(schema2.fields));

        // Find added fields
        for (const field of fields2) {
            if (!fields1.has(field)) {
                comparison.addedFields.push({
                    name: field,
                    type: schema2.fields[field].type
                });
            }
        }

        // Find removed fields
        for (const field of fields1) {
            if (!fields2.has(field)) {
                comparison.removedFields.push({
                    name: field,
                    type: schema1.fields[field].type
                });
                if (schema1.fields[field].required) {
                    comparison.breakingChanges.push({
                        type: 'REMOVED_REQUIRED_FIELD',
                        field,
                        message: `Required field ${field} was removed`
                    });
                    comparison.compatible = false;
                }
            }
        }

        // Compare common fields
        for (const field of fields1) {
            if (fields2.has(field)) {
                const field1 = schema1.fields[field];
                const field2 = schema2.fields[field];
                const fieldChanges = this.compareFields(field, field1, field2);
                
                if (fieldChanges.breaking) {
                    comparison.breakingChanges.push(...fieldChanges.breakingChanges);
                    comparison.compatible = false;
                }
                
                if (fieldChanges.modified) {
                    comparison.modifiedFields.push({
                        name: field,
                        changes: fieldChanges.changes
                    });
                }
            }
        }

        return comparison;
    }

    private compareFields(fieldName: string, field1: any, field2: any): FieldComparison {
        const comparison: FieldComparison = {
            modified: false,
            breaking: false,
            changes: [],
            breakingChanges: []
        };

        // Check type changes
        if (!this.areTypesCompatible(field1.type, field2.type)) {
            comparison.modified = true;
            comparison.breaking = true;
            comparison.changes.push({
                type: 'TYPE_CHANGE',
                from: field1.type,
                to: field2.type
            });
            comparison.breakingChanges.push({
                type: 'INCOMPATIBLE_TYPE_CHANGE',
                field: fieldName,
                message: `Type changed from ${field1.type} to ${field2.type}`
            });
        }

        // Check array changes
        if (field1.array !== field2.array) {
            comparison.modified = true;
            comparison.breaking = true;
            comparison.changes.push({
                type: 'ARRAY_CHANGE',
                from: field1.array,
                to: field2.array
            });
            comparison.breakingChanges.push({
                type: 'ARRAY_STRUCTURE_CHANGE',
                field: fieldName,
                message: `Array structure changed`
            });
        }

        // Check array length changes
        if (field1.array && field2.array && field1.arrayLength !== field2.arrayLength) {
            comparison.modified = true;
            if (field2.arrayLength < field1.arrayLength) {
                comparison.breaking = true;
                comparison.breakingChanges.push({
                    type: 'ARRAY_LENGTH_REDUCTION',
                    field: fieldName,
                    message: `Array length reduced from ${field1.arrayLength} to ${field2.arrayLength}`
                });
            }
            comparison.changes.push({
                type: 'ARRAY_LENGTH_CHANGE',
                from: field1.arrayLength,
                to: field2.arrayLength
            });
        }

        // Check requirement changes
        if (field1.required !== field2.required) {
            comparison.modified = true;
            if (!field1.required && field2.required) {
                comparison.breaking = true;
                comparison.breakingChanges.push({
                    type: 'FIELD_REQUIREMENT_CHANGE',
                    field: fieldName,
                    message: `Field became required`
                });
            }
            comparison.changes.push({
                type: 'REQUIREMENT_CHANGE',
                from: field1.required,
                to: field2.required
            });
        }

        // Check constraint changes
        if (field1.constraints || field2.constraints) {
            const constraintChanges = this.compareConstraints(
                fieldName,
                field1.constraints || {},
                field2.constraints || {}
            );
            if (constraintChanges.modified) {
                comparison.modified = true;
                comparison.changes.push(...constraintChanges.changes);
                if (constraintChanges.breaking) {
                    comparison.breaking = true;
                    comparison.breakingChanges.push(...constraintChanges.breakingChanges);
                }
            }
        }

        // Check nested schema changes
        if (field1.nested && field2.nested) {
            const nestedComparison = this.compareSchemas(field1.nested, field2.nested);
            if (!nestedComparison.compatible) {
                comparison.breaking = true;
                comparison.breakingChanges.push({
                    type: 'NESTED_SCHEMA_CHANGE',
                    field: fieldName,
                    message: `Incompatible changes in nested schema`
                });
            }
            if (nestedComparison.modifiedFields.length > 0) {
                comparison.modified = true;
                comparison.changes.push({
                    type: 'NESTED_SCHEMA_MODIFICATION',
                    changes: nestedComparison
                });
            }
        }

        return comparison;
    }

    private compareConstraints(
        fieldName: string,
        constraints1: any,
        constraints2: any
    ): ConstraintComparison {
        const comparison: ConstraintComparison = {
            modified: false,
            breaking: false,
            changes: [],
            breakingChanges: []
        };

        // Check min/max changes
        if (constraints1.min !== constraints2.min) {
            comparison.modified = true;
            if ((constraints2.min || 0) > (constraints1.min || 0)) {
                comparison.breaking = true;
                comparison.breakingChanges.push({
                    type: 'MIN_CONSTRAINT_INCREASE',
                    field: fieldName,
                    message: `Minimum value increased from ${constraints1.min} to ${constraints2.min}`
                });
            }
            comparison.changes.push({
                type: 'MIN_CHANGE',
                from: constraints1.min,
                to: constraints2.min
            });
        }

        if (constraints1.max !== constraints2.max) {
            comparison.modified = true;
            if ((constraints2.max || Infinity) < (constraints1.max || Infinity)) {
                comparison.breaking = true;
                comparison.breakingChanges.push({
                    type: 'MAX_CONSTRAINT_DECREASE',
                    field: fieldName,
                    message: `Maximum value decreased from ${constraints1.max} to ${constraints2.max}`
                });
            }
            comparison.changes.push({
                type: 'MAX_CHANGE',
                from: constraints1.max,
                to: constraints2.max
            });
        }

        // Check pattern changes
        if (constraints1.pattern !== constraints2.pattern) {
            comparison.modified = true;
            comparison.breaking = true;
            comparison.breakingChanges.push({
                type: 'PATTERN_CHANGE',
                field: fieldName,
                message: `Validation pattern changed`
            });
            comparison.changes.push({
                type: 'PATTERN_CHANGE',
                from: constraints1.pattern,
                to: constraints2.pattern
            });
        }

        // Check custom validation changes
        if (constraints1.custom !== constraints2.custom) {
            comparison.modified = true;
            comparison.breaking = true;
            comparison.breakingChanges.push({
                type: 'CUSTOM_VALIDATION_CHANGE',
                field: fieldName,
                message: `Custom validation changed`
            });
            comparison.changes.push({
                type: 'CUSTOM_VALIDATION_CHANGE',
                from: constraints1.custom?.toString(),
                to: constraints2.custom?.toString()
            });
        }

        return comparison;
    }

    private areTypesCompatible(type1: any, type2: any): boolean {
        if (type1 === type2) return true;

        // Define type compatibility hierarchy
        const typeHierarchy = {
            'u8': ['u16', 'u32', 'u64'],
            'u16': ['u32', 'u64'],
            'u32': ['u64'],
            'i8': ['i16', 'i32', 'i64'],
            'i16': ['i32', 'i64'],
            'i32': ['i64']
        };

        // Check if type2 is in the compatible types list for type1
        return typeHierarchy[type1]?.includes(type2) || false;
    }

    public generateMigrationFunction(
        sourceSchema: AccountSchema,
        targetSchema: AccountSchema
    ): (data: any) => any {
        const comparison = this.compareSchemas(sourceSchema, targetSchema);
        if (!comparison.compatible) {
            throw new Error('Cannot generate migration function for incompatible schemas');
        }

        return (data: any) => {
            const result = { ...data };

            // Handle removed fields
            for (const field of comparison.removedFields) {
                delete result[field.name];
            }

            // Handle added fields
            for (const field of comparison.addedFields) {
                const targetField = targetSchema.fields[field.name];
                result[field.name] = targetField.defaultValue ?? this.getDefaultValueForType(targetField.type);
            }

            // Handle modified fields
            for (const field of comparison.modifiedFields) {
                const sourceField = sourceSchema.fields[field.name];
                const targetField = targetSchema.fields[field.name];
                result[field.name] = this.migrateFieldValue(
                    result[field.name],
                    sourceField,
                    targetField
                );
            }

            return result;
        };
    }

    private getDefaultValueForType(type: DataType): any {
        switch (type) {
            case 'u8':
            case 'u16':
            case 'u32':
            case 'u64':
            case 'i8':
            case 'i16':
            case 'i32':
            case 'i64':
                return 0;
            case 'bool':
                return false;
            case 'string':
                return '';
            case 'publicKey':
                return PublicKey.default;
            default:
                if (typeof type === 'object' && type.defaultValue) {
                    return type.defaultValue();
                }
                return null;
        }
    }

    private migrateFieldValue(value: any, sourceField: any, targetField: any): any {
        if (sourceField.type === targetField.type) return value;

        // Handle numeric type conversions
        if (this.isNumericType(sourceField.type) && this.isNumericType(targetField.type)) {
            return this.convertNumericValue(value, targetField.type);
        }

        // Handle array conversions
        if (sourceField.array && targetField.array) {
            return this.migrateArrayValue(value, sourceField, targetField);
        }

        // Handle nested schema conversions
        if (sourceField.nested && targetField.nested) {
            const migrationFn = this.generateMigrationFunction(
                sourceField.nested,
                targetField.nested
            );
            return migrationFn(value);
        }

        return value;
    }

    private isNumericType(type: string): boolean {
        return [
            'u8', 'u16', 'u32', 'u64',
            'i8', 'i16', 'i32', 'i64'
        ].includes(type);
    }

    private convertNumericValue(value: number | BN, targetType: string): number | BN {
        const bnValue = BN.isBN(value) ? value : new BN(value);
        
        switch (targetType) {
            case 'u8':
                return bnValue.toNumber() & 0xFF;
            case 'u16':
                return bnValue.toNumber() & 0xFFFF;
            case 'u32':
                return bnValue.toNumber() >>> 0;
            case 'u64':
                return bnValue;
            case 'i8':
                return (bnValue.toNumber() << 24) >> 24;
            case 'i16':
                return (bnValue.toNumber() << 16) >> 16;
            case 'i32':
                return bnValue.toNumber() | 0;
            case 'i64':
                return bnValue;
            default:
                throw new Error(`Invalid numeric type: ${targetType}`);
        }
    }

    private migrateArrayValue(value: any[], sourceField: any, targetField: any): any[] {
        const result = [...value];
        
        // Truncate or pad array if needed
        if (targetField.arrayLength) {
            while (result.length > targetField.arrayLength) {
                result.pop();
            }
            while (result.length < targetField.arrayLength) {
                result.push(this.getDefaultValueForType(targetField.type));
            }
        }

        // Convert array elements if needed
        if (sourceField.type !== targetField.type) {
            return result.map(item => 
                this.migrateFieldValue(
                    item,
                    { type: sourceField.type },
                    { type: targetField.type }
                )
            );
        }

        return result;
    }
}

interface SchemaComparison {
    compatible: boolean;
    addedFields: Array<{ name: string; type: any; }>;
    removedFields: Array<{ name: string; type: any; }>;
    modifiedFields: Array<{ name: string; changes: any[]; }>;
    breakingChanges: Array<{ type: string; field: string; message: string; }>;
}

interface FieldComparison {
    modified: boolean;
    breaking: boolean;
    changes: any[];
    breakingChanges: any[];
}

interface ConstraintComparison {
    modified: boolean;
    breaking: boolean;
    changes: any[];
    breakingChanges: any[];
}
