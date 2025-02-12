import { 
    AccountSchema, 
    ValidationResult, 
    ValidationError,
    ValidationErrorType,
    SchemaValidationOptions,
    AccountField,
    DataType,
    FieldConstraints
} from '../layout/types';
import { PublicKey } from '@solana/web3.js';
import { BN } from 'bn.js';

export class AccountDataValidator {
    private static instance: AccountDataValidator;
    private typeValidators: Map<DataType, (value: any, field: AccountField) => boolean>;
    private constraintValidators: Map<string, (value: any, constraint: any) => boolean>;

    private constructor() {
        this.typeValidators = new Map();
        this.constraintValidators = new Map();
        this.initializeValidators();
    }

    public static getInstance(): AccountDataValidator {
        if (!AccountDataValidator.instance) {
            AccountDataValidator.instance = new AccountDataValidator();
        }
        return AccountDataValidator.instance;
    }

    private initializeValidators(): void {
        // Number type validators
        this.typeValidators.set('u8', (value) => this.validateUnsignedInteger(value, 8));
        this.typeValidators.set('u16', (value) => this.validateUnsignedInteger(value, 16));
        this.typeValidators.set('u32', (value) => this.validateUnsignedInteger(value, 32));
        this.typeValidators.set('u64', (value) => this.validateUnsignedInteger(value, 64));
        this.typeValidators.set('i8', (value) => this.validateSignedInteger(value, 8));
        this.typeValidators.set('i16', (value) => this.validateSignedInteger(value, 16));
        this.typeValidators.set('i32', (value) => this.validateSignedInteger(value, 32));
        this.typeValidators.set('i64', (value) => this.validateSignedInteger(value, 64));

        // Other base type validators
        this.typeValidators.set('bool', (value) => typeof value === 'boolean');
        this.typeValidators.set('string', (value) => typeof value === 'string');
        this.typeValidators.set('publicKey', (value) => this.validatePublicKey(value));
        this.typeValidators.set('bytes', (value) => Buffer.isBuffer(value));

        // Constraint validators
        this.constraintValidators.set('min', (value, min) => this.validateMinConstraint(value, min));
        this.constraintValidators.set('max', (value, max) => this.validateMaxConstraint(value, max));
        this.constraintValidators.set('length', (value, length) => this.validateLengthConstraint(value, length));
        this.constraintValidators.set('pattern', (value, pattern) => this.validatePatternConstraint(value, pattern));
    }

    public validateAccountData(
        data: any, 
        schema: AccountSchema, 
        options: SchemaValidationOptions = {}
    ): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationError[] = [];

        try {
            // Validate discriminator if present
            if (schema.discriminator !== undefined) {
                if (data.discriminator !== schema.discriminator) {
                    errors.push({
                        field: 'discriminator',
                        message: `Invalid discriminator: expected ${schema.discriminator}, got ${data.discriminator}`,
                        errorType: ValidationErrorType.INVALID_TYPE
                    });
                    return { isValid: false, errors, warnings };
                }
            }

            // Validate each field according to schema
            for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
                const value = data[fieldName];

                // Check required fields
                if (fieldSchema.required && (value === undefined || value === null)) {
                    errors.push({
                        field: fieldName,
                        message: `Required field missing: ${fieldName}`,
                        errorType: ValidationErrorType.REQUIRED_FIELD_MISSING
                    });
                    continue;
                }

                // Skip validation for optional empty fields
                if (!fieldSchema.required && (value === undefined || value === null)) {
                    continue;
                }

                // Validate field type
                if (!this.validateFieldType(value, fieldSchema)) {
                    errors.push({
                        field: fieldName,
                        message: `Invalid type for field ${fieldName}: expected ${fieldSchema.type}`,
                        errorType: ValidationErrorType.INVALID_TYPE,
                        value
                    });
                    continue;
                }

                // Validate field constraints
                if (fieldSchema.constraints) {
                    const constraintErrors = this.validateFieldConstraints(value, fieldSchema.constraints);
                    if (constraintErrors.length > 0) {
                        errors.push(...constraintErrors.map(error => ({
                            ...error,
                            field: fieldName
                        })));
                    }
                }

                // Validate nested schemas
                if (fieldSchema.nested) {
                    const nestedResult = this.validateAccountData(value, fieldSchema.nested, options);
                    errors.push(...nestedResult.errors.map(error => ({
                        ...error,
                        field: `${fieldName}.${error.field}`
                    })));
                    warnings.push(...nestedResult.warnings.map(warning => ({
                        ...warning,
                        field: `${fieldName}.${warning.field}`
                    })));
                }

                // Validate arrays
                if (fieldSchema.array) {
                    if (!Array.isArray(value)) {
                        errors.push({
                            field: fieldName,
                            message: `Expected array for field ${fieldName}`,
                            errorType: ValidationErrorType.INVALID_TYPE,
                            value
                        });
                        continue;
                    }

                    if (fieldSchema.arrayLength !== undefined && value.length !== fieldSchema.arrayLength) {
                        errors.push({
                            field: fieldName,
                            message: `Invalid array length for field ${fieldName}: expected ${fieldSchema.arrayLength}, got ${value.length}`,
                            errorType: ValidationErrorType.CONSTRAINT_VIOLATION,
                            value
                        });
                    }

                    // Validate each array element
                    value.forEach((element, index) => {
                        if (!this.validateFieldType(element, { ...fieldSchema, array: false })) {
                            errors.push({
                                field: `${fieldName}[${index}]`,
                                message: `Invalid type for array element`,
                                errorType: ValidationErrorType.INVALID_TYPE,
                                value: element
                            });
                        }
                    });
                }
            }

            // Check for unknown fields in strict mode
            if (options.strict) {
                const schemaFields = new Set(Object.keys(schema.fields));
                for (const field of Object.keys(data)) {
                    if (!schemaFields.has(field) && field !== 'discriminator') {
                        if (options.ignoreUnknownFields) {
                            warnings.push({
                                field,
                                message: `Unknown field: ${field}`,
                                errorType: ValidationErrorType.CUSTOM_VALIDATION_FAILED
                            });
                        } else {
                            errors.push({
                                field,
                                message: `Unknown field: ${field}`,
                                errorType: ValidationErrorType.CUSTOM_VALIDATION_FAILED
                            });
                        }
                    }
                }
            }

            // Run custom validators if provided
            if (options.customValidators) {
                for (const [field, validator] of Object.entries(options.customValidators)) {
                    if (!validator(data[field])) {
                        errors.push({
                            field,
                            message: `Custom validation failed for field: ${field}`,
                            errorType: ValidationErrorType.CUSTOM_VALIDATION_FAILED,
                            value: data[field]
                        });
                    }
                }
            }

            return {
                isValid: errors.length === 0,
                errors,
                warnings
            };

        } catch (error) {
            errors.push({
                field: '',
                message: `Validation failed: ${error.message}`,
                errorType: ValidationErrorType.CUSTOM_VALIDATION_FAILED
            });

            return {
                isValid: false,
                errors,
                warnings
            };
        }
    }

    private validateFieldType(value: any, field: AccountField): boolean {
        const validator = this.typeValidators.get(field.type);
        if (!validator) {
            throw new Error(`No validator found for type: ${field.type}`);
        }
        return validator(value, field);
    }

    private validateFieldConstraints(value: any, constraints: FieldConstraints): ValidationError[] {
        const errors: ValidationError[] = [];

        for (const [constraintName, constraintValue] of Object.entries(constraints)) {
            const validator = this.constraintValidators.get(constraintName);
            if (!validator) {
                continue;
            }

            if (!validator(value, constraintValue)) {
                errors.push({
                    field: '',
                    message: `Constraint violation: ${constraintName}`,
                    errorType: ValidationErrorType.CONSTRAINT_VIOLATION,
                    constraint: { [constraintName]: constraintValue },
                    value
                });
            }
        }

        return errors;
    }

    private validateUnsignedInteger(value: any, bits: number): boolean {
        if (typeof value === 'number') {
            return Number.isInteger(value) && value >= 0 && value < Math.pow(2, bits);
        }
        if (value instanceof BN) {
            return value.gte(new BN(0)) && value.lt(new BN(2).pow(new BN(bits)));
        }
        return false;
    }

    private validateSignedInteger(value: any, bits: number): boolean {
        if (typeof value === 'number') {
            const max = Math.pow(2, bits - 1) - 1;
            const min = -Math.pow(2, bits - 1);
            return Number.isInteger(value) && value >= min && value <= max;
        }
        if (value instanceof BN) {
            const max = new BN(2).pow(new BN(bits - 1)).sub(new BN(1));
            const min = new BN(2).pow(new BN(bits - 1)).neg();
            return value.gte(min) && value.lte(max);
        }
        return false;
    }

    private validatePublicKey(value: any): boolean {
        try {
            if (typeof value === 'string') {
                new PublicKey(value);
                return true;
            }
            if (value instanceof PublicKey) {
                return true;
            }
            if (Buffer.isBuffer(value) && value.length === 32) {
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    private validateMinConstraint(value: any, min: number): boolean {
        if (typeof value === 'number') {
            return value >= min;
        }
        if (value instanceof BN) {
            return value.gte(new BN(min));
        }
        if (typeof value === 'string' || Array.isArray(value)) {
            return value.length >= min;
        }
        return false;
    }

    private validateMaxConstraint(value: any, max: number): boolean {
        if (typeof value === 'number') {
            return value <= max;
        }
        if (value instanceof BN) {
            return value.lte(new BN(max));
        }
        if (typeof value === 'string' || Array.isArray(value)) {
            return value.length <= max;
        }
        return false;
    }

    private validateLengthConstraint(value: any, length: number): boolean {
        if (typeof value === 'string' || Array.isArray(value) || Buffer.isBuffer(value)) {
            return value.length === length;
        }
        return false;
    }

    private validatePatternConstraint(value: any, pattern: string): boolean {
        if (typeof value !== 'string') {
            return false;
        }
        try {
            const regex = new RegExp(pattern);
            return regex.test(value);
        } catch {
            return false;
        }
    }
}
