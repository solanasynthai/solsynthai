import { 
    AccountSchema,
    AccountField,
    AccountMetadata,
    DataType,
    FieldConstraints,
    CustomType,
    ValidationError,
    ValidationErrorType
} from '../layout/types';
import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha256';
import { BN } from 'bn.js';
import { PublicKey } from '@solana/web3.js';

export class SchemaBuilder {
    private schema: Partial<AccountSchema>;
    private currentField: string | null;
    private errors: ValidationError[];
    private customTypes: Map<string, CustomType>;

    constructor(name: string) {
        this.schema = {
            name,
            version: 1,
            fields: {},
            metadata: {
                rentExempt: true,
                mutable: true
            }
        };
        this.currentField = null;
        this.errors = [];
        this.customTypes = new Map();
    }

    public setVersion(version: number): SchemaBuilder {
        this.schema.version = version;
        return this;
    }

    public setDiscriminator(discriminator: number): SchemaBuilder {
        this.schema.discriminator = discriminator;
        return this;
    }

    public addField(name: string, type: DataType): SchemaBuilder {
        if (this.schema.fields[name]) {
            this.errors.push({
                field: name,
                message: `Duplicate field name: ${name}`,
                errorType: ValidationErrorType.CUSTOM_VALIDATION_FAILED
            });
            return this;
        }

        this.schema.fields[name] = {
            type,
            required: true
        };
        this.currentField = name;
        return this;
    }

    public makeOptional(): SchemaBuilder {
        if (!this.currentField) {
            throw new Error('No field selected');
        }
        this.schema.fields[this.currentField].required = false;
        return this;
    }

    public makeArray(length?: number): SchemaBuilder {
        if (!this.currentField) {
            throw new Error('No field selected');
        }
        this.schema.fields[this.currentField].array = true;
        if (length !== undefined) {
            this.schema.fields[this.currentField].arrayLength = length;
        }
        return this;
    }

    public addConstraint(constraint: FieldConstraints): SchemaBuilder {
        if (!this.currentField) {
            throw new Error('No field selected');
        }
        this.schema.fields[this.currentField].constraints = {
            ...this.schema.fields[this.currentField].constraints,
            ...constraint
        };
        return this;
    }

    public setDefaultValue(value: any): SchemaBuilder {
        if (!this.currentField) {
            throw new Error('No field selected');
        }
        this.schema.fields[this.currentField].defaultValue = value;
        return this;
    }

    public addDescription(description: string): SchemaBuilder {
        if (!this.currentField) {
            this.schema.metadata.description = description;
        } else {
            this.schema.fields[this.currentField].description = description;
        }
        return this;
    }

    public setAuthority(authority: string): SchemaBuilder {
        this.schema.metadata.authority = authority;
        return this;
    }

    public setMutable(mutable: boolean): SchemaBuilder {
        this.schema.metadata.mutable = mutable;
        return this;
    }

    public addNestedSchema(field: string, schema: AccountSchema): SchemaBuilder {
        if (this.schema.fields[field]) {
            this.errors.push({
                field,
                message: `Duplicate field name: ${field}`,
                errorType: ValidationErrorType.CUSTOM_VALIDATION_FAILED
            });
            return this;
        }

        this.schema.fields[field] = {
            type: 'nested',
            required: true,
            nested: schema
        };
        this.currentField = field;
        return this;
    }

    public registerCustomType(type: CustomType): SchemaBuilder {
        this.customTypes.set(type.name, type);
        return this;
    }

    public addCustomField(name: string, typeName: string): SchemaBuilder {
        const customType = this.customTypes.get(typeName);
        if (!customType) {
            this.errors.push({
                field: name,
                message: `Custom type not found: ${typeName}`,
                errorType: ValidationErrorType.INVALID_TYPE
            });
            return this;
        }

        this.schema.fields[name] = {
            type: typeName,
            required: true,
            customType
        };
        this.currentField = name;
        return this;
    }

    public setMaxSize(size: number): SchemaBuilder {
        this.schema.metadata.maxSize = size;
        return this;
    }

    public setCloseAuthority(authority: string): SchemaBuilder {
        this.schema.metadata.closeAuthority = authority;
        return this;
    }

    public generateDiscriminator(): SchemaBuilder {
        const nameBuffer = Buffer.from(this.schema.name);
        const versionBuffer = Buffer.from([this.schema.version]);
        const hash = sha256(Buffer.concat([nameBuffer, versionBuffer]));
        this.schema.discriminator = new BN(hash.slice(0, 8), 'le').toNumber();
        return this;
    }

    public validate(): ValidationError[] {
        const errors = [...this.errors];

        // Validate schema name
        if (!this.schema.name || this.schema.name.length === 0) {
            errors.push({
                field: 'name',
                message: 'Schema name is required',
                errorType: ValidationErrorType.REQUIRED_FIELD_MISSING
            });
        }

        // Validate version
        if (!this.schema.version || this.schema.version < 0) {
            errors.push({
                field: 'version',
                message: 'Invalid schema version',
                errorType: ValidationErrorType.INVALID_TYPE
            });
        }

        // Validate fields
        if (!this.schema.fields || Object.keys(this.schema.fields).length === 0) {
            errors.push({
                field: 'fields',
                message: 'Schema must have at least one field',
                errorType: ValidationErrorType.REQUIRED_FIELD_MISSING
            });
        }

        // Validate field definitions
        for (const [fieldName, field] of Object.entries(this.schema.fields)) {
            errors.push(...this.validateField(fieldName, field));
        }

        // Validate metadata
        if (this.schema.metadata) {
            errors.push(...this.validateMetadata(this.schema.metadata));
        }

        return errors;
    }

    private validateField(fieldName: string, field: AccountField): ValidationError[] {
        const errors: ValidationError[] = [];

        // Validate field name
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fieldName)) {
            errors.push({
                field: fieldName,
                message: 'Invalid field name format',
                errorType: ValidationErrorType.INVALID_TYPE
            });
        }

        // Validate field type
        if (!field.type) {
            errors.push({
                field: fieldName,
                message: 'Field type is required',
                errorType: ValidationErrorType.REQUIRED_FIELD_MISSING
            });
        }

        // Validate array fields
        if (field.array) {
            if (field.arrayLength !== undefined && field.arrayLength <= 0) {
                errors.push({
                    field: fieldName,
                    message: 'Array length must be positive',
                    errorType: ValidationErrorType.CONSTRAINT_VIOLATION
                });
            }
        }

        // Validate nested schemas
        if (field.nested) {
            const nestedBuilder = new SchemaBuilder(field.nested.name);
            errors.push(...nestedBuilder.validate());
        }

        // Validate custom types
        if (field.customType) {
            if (!this.customTypes.has(field.type)) {
                errors.push({
                    field: fieldName,
                    message: `Custom type ${field.type} not registered`,
                    errorType: ValidationErrorType.INVALID_TYPE
                });
            }
        }

        // Validate constraints
        if (field.constraints) {
            errors.push(...this.validateConstraints(fieldName, field));
        }

        return errors;
    }

    private validateConstraints(fieldName: string, field: AccountField): ValidationError[] {
        const errors: ValidationError[] = [];
        const constraints = field.constraints;

        if (constraints.min !== undefined && constraints.max !== undefined) {
            if (constraints.min > constraints.max) {
                errors.push({
                    field: fieldName,
                    message: 'Min value cannot be greater than max value',
                    errorType: ValidationErrorType.CONSTRAINT_VIOLATION
                });
            }
        }

        if (constraints.length !== undefined && constraints.length <= 0) {
            errors.push({
                field: fieldName,
                message: 'Length constraint must be positive',
                errorType: ValidationErrorType.CONSTRAINT_VIOLATION
            });
        }

        if (constraints.pattern) {
            try {
                new RegExp(constraints.pattern);
            } catch {
                errors.push({
                    field: fieldName,
                    message: 'Invalid pattern constraint',
                    errorType: ValidationErrorType.CONSTRAINT_VIOLATION
                });
            }
        }

        return errors;
    }

    private validateMetadata(metadata: AccountMetadata): ValidationError[] {
        const errors: ValidationError[] = [];

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

        if (metadata.closeAuthority) {
            try {
                new PublicKey(metadata.closeAuthority);
            } catch {
                errors.push({
                    field: 'metadata.closeAuthority',
                    message: 'Invalid close authority public key',
                    errorType: ValidationErrorType.INVALID_TYPE
                });
            }
        }

        if (metadata.maxSize !== undefined && metadata.maxSize <= 0) {
            errors.push({
                field: 'metadata.maxSize',
                message: 'Max size must be positive',
                errorType: ValidationErrorType.CONSTRAINT_VIOLATION
            });
        }

        return errors;
    }

    public build(): AccountSchema {
        const errors = this.validate();
        if (errors.length > 0) {
            throw new Error(`Schema validation failed: ${JSON.stringify(errors, null, 2)}`);
        }

        return this.schema as AccountSchema;
    }
}
