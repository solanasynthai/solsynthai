import { PublicKey, Connection, AccountInfo } from '@solana/web3.js';
import { BN } from 'bn.js';
import { AccountSchema, ValidationResult, ValidationError, ValidationErrorType } from '../types';
import { AccountDataSerializer } from '../serializer/AccountDataSerializer';
import { AccountSchemaManager } from '../schema/AccountSchemaManager';
import { EventEmitter } from 'events';

interface ValidationContext {
    pubkey: PublicKey;
    owner: PublicKey;
    schemaName: string;
    schemaVersion: number;
    timestamp: number;
    slot?: number;
}

interface ValidationOptions {
    strict?: boolean;
    checkRentExemption?: boolean;
    validateOwner?: boolean;
    checkDataSize?: boolean;
    deepValidation?: boolean;
    ignoreWarnings?: boolean;
    allowPartialValidation?: boolean;
    customValidators?: Map<string, (data: any, context: ValidationContext) => Promise<boolean>>;
}

interface ConstraintViolation {
    field: string;
    constraint: string;
    expected: any;
    actual: any;
    message: string;
}

export class AccountStateValidator extends EventEmitter {
    private static instance: AccountStateValidator;
    private connection: Connection;
    private serializer: AccountDataSerializer;
    private schemaManager: AccountSchemaManager;
    private customValidators: Map<string, (data: any, context: ValidationContext) => Promise<boolean>>;

    private constructor(connection: Connection) {
        super();
        this.connection = connection;
        this.serializer = AccountDataSerializer.getInstance();
        this.schemaManager = AccountSchemaManager.getInstance();
        this.customValidators = new Map();
    }

    public static getInstance(connection: Connection): AccountStateValidator {
        if (!AccountStateValidator.instance) {
            AccountStateValidator.instance = new AccountStateValidator(connection);
        }
        return AccountStateValidator.instance;
    }

    public async validateAccountState(
        accountInfo: AccountInfo<Buffer>,
        pubkey: PublicKey,
        schema: AccountSchema,
        options: ValidationOptions = {}
    ): Promise<ValidationResult> {
        const context: ValidationContext = {
            pubkey,
            owner: accountInfo.owner,
            schemaName: schema.name,
            schemaVersion: schema.version,
            timestamp: Date.now()
        };

        const errors: ValidationError[] = [];
        const warnings: ValidationError[] = [];

        try {
            // Basic account validation
            await this.validateBasicAccountProperties(accountInfo, pubkey, options, errors);

            // Data size validation
            if (options.checkDataSize) {
                this.validateDataSize(accountInfo.data, schema, errors);
            }

            // Deserialize and validate data structure
            const accountData = this.serializer.deserialize(accountInfo.data, schema);
            await this.validateAccountData(accountData, schema, context, options, errors, warnings);

            // Check rent exemption
            if (options.checkRentExemption) {
                await this.validateRentExemption(accountInfo, pubkey, errors);
            }

            // Run custom validators
            if (options.customValidators) {
                await this.runCustomValidators(accountData, context, options.customValidators, errors);
            }

            const isValid = errors.length === 0 && (options.ignoreWarnings || warnings.length === 0);

            this.emit('validation:complete', {
                pubkey: pubkey.toBase58(),
                valid: isValid,
                errors,
                warnings
            });

            return {
                isValid,
                errors,
                warnings
            };

        } catch (error) {
            const validationError: ValidationError = {
                field: '',
                message: `Validation failed: ${error.message}`,
                errorType: ValidationErrorType.VALIDATION_ERROR,
                error
            };

            this.emit('validation:error', {
                pubkey: pubkey.toBase58(),
                error: validationError
            });

            return {
                isValid: false,
                errors: [validationError],
                warnings
            };
        }
    }

    private async validateBasicAccountProperties(
        accountInfo: AccountInfo<Buffer>,
        pubkey: PublicKey,
        options: ValidationOptions,
        errors: ValidationError[]
    ): Promise<void> {
        // Check if account exists
        if (!accountInfo) {
            errors.push({
                field: 'account',
                message: 'Account does not exist',
                errorType: ValidationErrorType.ACCOUNT_NOT_FOUND
            });
            return;
        }

        // Validate owner if required
        if (options.validateOwner) {
            const ownerProgram = await this.connection.getAccountInfo(accountInfo.owner);
            if (!ownerProgram) {
                errors.push({
                    field: 'owner',
                    message: 'Owner program does not exist',
                    errorType: ValidationErrorType.INVALID_OWNER
                });
            }
        }

        // Check executable status
        if (accountInfo.executable) {
            errors.push({
                field: 'executable',
                message: 'Account should not be executable',
                errorType: ValidationErrorType.INVALID_ACCOUNT_TYPE
            });
        }
    }

    private validateDataSize(
        data: Buffer,
        schema: AccountSchema,
        errors: ValidationError[]
    ): void {
        const expectedSize = this.serializer.calculateSerializedSize(schema);
        if (data.length !== expectedSize) {
            errors.push({
                field: 'data',
                message: `Invalid data size: expected ${expectedSize}, got ${data.length}`,
                errorType: ValidationErrorType.INVALID_DATA_SIZE
            });
        }
    }

    private async validateAccountData(
        data: any,
        schema: AccountSchema,
        context: ValidationContext,
        options: ValidationOptions,
        errors: ValidationError[],
        warnings: ValidationError[]
    ): Promise<void> {
        // Validate required fields
        await this.validateRequiredFields(data, schema, errors);

        // Validate field types and constraints
        await this.validateFieldTypes(data, schema, context, options, errors);

        // Validate nested structures if deep validation is enabled
        if (options.deepValidation) {
            await this.validateNestedStructures(data, schema, context, options, errors);
        }

        // Validate business rules
        await this.validateBusinessRules(data, schema, context, errors);

        // Check for unknown fields in strict mode
        if (options.strict) {
            this.validateUnknownFields(data, schema, warnings);
        }
    }

    private async validateRequiredFields(
        data: any,
        schema: AccountSchema,
        errors: ValidationError[]
    ): Promise<void> {
        for (const [fieldName, field] of Object.entries(schema.fields)) {
            if (field.required && (data[fieldName] === undefined || data[fieldName] === null)) {
                errors.push({
                    field: fieldName,
                    message: 'Required field is missing',
                    errorType: ValidationErrorType.REQUIRED_FIELD_MISSING
                });
            }
        }
    }

    private async validateFieldTypes(
        data: any,
        schema: AccountSchema,
        context: ValidationContext,
        options: ValidationOptions,
        errors: ValidationError[]
    ): Promise<void> {
        for (const [fieldName, field] of Object.entries(schema.fields)) {
            if (data[fieldName] === undefined) continue;

            const value = data[fieldName];
            
            // Type validation
            if (!this.isValidFieldType(value, field.type)) {
                errors.push({
                    field: fieldName,
                    message: `Invalid field type: expected ${field.type}`,
                    errorType: ValidationErrorType.INVALID_FIELD_TYPE
                });
                continue;
            }

            // Constraint validation
            if (field.constraints) {
                const violations = this.validateConstraints(value, field.constraints);
                for (const violation of violations) {
                    errors.push({
                        field: fieldName,
                        message: violation.message,
                        errorType: ValidationErrorType.CONSTRAINT_VIOLATION,
                        constraint: violation.constraint,
                        expected: violation.expected,
                        actual: violation.actual
                    });
                }
            }
        }
    }

    private async validateNestedStructures(
        data: any,
        schema: AccountSchema,
        context: ValidationContext,
        options: ValidationOptions,
        errors: ValidationError[]
    ): Promise<void> {
        for (const [fieldName, field] of Object.entries(schema.fields)) {
            if (field.nested && data[fieldName]) {
                const nestedSchema = this.schemaManager.getSchema(field.nested.name, field.nested.version);
                const nestedContext = {
                    ...context,
                    schemaName: field.nested.name,
                    schemaVersion: field.nested.version
                };

                const nestedErrors: ValidationError[] = [];
                const nestedWarnings: ValidationError[] = [];

                await this.validateAccountData(
                    data[fieldName],
                    nestedSchema,
                    nestedContext,
                    options,
                    nestedErrors,
                    nestedWarnings
                );

                // Add nested errors with field path
                errors.push(...nestedErrors.map(error => ({
                    ...error,
                    field: `${fieldName}.${error.field}`
                })));
            }
        }
    }

    private async validateBusinessRules(
        data: any,
        schema: AccountSchema,
        context: ValidationContext,
        errors: ValidationError[]
    ): Promise<void> {
        // Implement business rule validation logic
        if (schema.businessRules) {
            for (const rule of schema.businessRules) {
                try {
                    const isValid = await rule.validate(data, context);
                    if (!isValid) {
                        errors.push({
                            field: rule.field || '',
                            message: rule.message,
                            errorType: ValidationErrorType.BUSINESS_RULE_VIOLATION
                        });
                    }
                } catch (error) {
                    errors.push({
                        field: rule.field || '',
                        message: `Business rule validation failed: ${error.message}`,
                        errorType: ValidationErrorType.VALIDATION_ERROR,
                        error
                    });
                }
            }
        }
    }

    private validateUnknownFields(
        data: any,
        schema: AccountSchema,
        warnings: ValidationError[]
    ): void {
        const knownFields = new Set(Object.keys(schema.fields));
        for (const field of Object.keys(data)) {
            if (!knownFields.has(field)) {
                warnings.push({
                    field,
                    message: 'Unknown field detected',
                    errorType: ValidationErrorType.UNKNOWN_FIELD
                });
            }
        }
    }

    private async validateRentExemption(
        accountInfo: AccountInfo<Buffer>,
        pubkey: PublicKey,
        errors: ValidationError[]
    ): Promise<void> {
        const rentExemptionBalance = await this.connection.getMinimumBalanceForRentExemption(
            accountInfo.data.length
        );

        if (accountInfo.lamports < rentExemptionBalance) {
            errors.push({
                field: 'lamports',
                message: `Account is not rent exempt. Required: ${rentExemptionBalance}, Current: ${accountInfo.lamports}`,
                errorType: ValidationErrorType.NOT_RENT_EXEMPT
            });
        }
    }

    private async runCustomValidators(
        data: any,
        context: ValidationContext,
        validators: Map<string, (data: any, context: ValidationContext) => Promise<boolean>>,
        errors: ValidationError[]
    ): Promise<void> {
        for (const [name, validator] of validators.entries()) {
            try {
                const isValid = await validator(data, context);
                if (!isValid) {
                    errors.push({
                        field: '',
                        message: `Custom validation '${name}' failed`,
                        errorType: ValidationErrorType.CUSTOM_VALIDATION_FAILED
                    });
                }
            } catch (error) {
                errors.push({
                    field: '',
                    message: `Custom validator '${name}' error: ${error.message}`,
                    errorType: ValidationErrorType.VALIDATION_ERROR,
                    error
                });
            }
        }
    }

    private isValidFieldType(value: any, type: string): boolean {
        switch (type) {
            case 'u8':
            case 'u16':
            case 'u32':
                return Number.isInteger(value) && value >= 0 && value < Math.pow(2, parseInt(type.slice(1)));
            case 'u64':
                return BN.isBN(value) || (Number.isInteger(value) && value >= 0);
            case 'i8':
            case 'i16':
            case 'i32':
                const bits = parseInt(type.slice(1));
                const max = Math.pow(2, bits - 1) - 1;
                const min = -Math.pow(2, bits - 1);
                return Number.isInteger(value) && value >= min && value <= max;
            case 'i64':
                return BN.isBN(value) || Number.isInteger(value);
            case 'bool':
                return typeof value === 'boolean';
            case 'string':
                return typeof value === 'string';
            case 'publicKey':
                return value instanceof PublicKey || (typeof value === 'string' && value.length === 44);
            case 'array':
                return Array.isArray(value);
            default:
                return true; // Custom types are validated elsewhere
        }
    }

    private validateConstraints(value: any, constraints: any): ConstraintViolation[] {
        const violations: ConstraintViolation[] = [];

        if (constraints.min !== undefined && value < constraints.min) {
            violations.push({
                field: '',
                constraint: 'min',
                expected: constraints.min,
                actual: value,
                message: `Value is less than minimum (${constraints.min})`
            });
        }

        if (constraints.max !== undefined && value > constraints.max) {
            violations.push({
                field: '',
                constraint: 'max',
                expected: constraints.max,
                actual: value,
                message: `Value exceeds maximum (${constraints.max})`
            });
        }

        if (constraints.length !== undefined && value.length !== constraints.length) {
            violations.push({
                field: '',
                constraint: 'length',
                expected: constraints.length,
                actual: value.length,
                message: `Invalid length: expected ${constraints.length}, got ${value.length}`
            });
        }

        if (constraints.pattern && typeof value === 'string') {
            const regex = new RegExp(constraints.pattern);
            if (!regex.test(value)) {
                violations.push({
                    field: '',
                    constraint: 'pattern',
                    expected: constraints.pattern,
                    actual: value,
                    message: 'Value does not match required pattern'
                });
            }
        }

        return violations;
    }
}
