import { 
    AccountSchema,
    SerializationOptions,
    DeserializationOptions,
    ValidationError,
    ValidationErrorType,
    DataType,
    AccountField
} from '../layout/types';
import { Buffer } from 'buffer';
import { BN } from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { AccountDataValidator } from '../validators/AccountDataValidator';
import { LayoutTransformer } from '../layout/LayoutTransformer';

export class AccountDataSerializer {
    private static instance: AccountDataSerializer;
    private validator: AccountDataValidator;
    private layoutTransformer: LayoutTransformer;
    private maxBufferSize: number = 1024 * 1024; // 1MB default max size

    private constructor() {
        this.validator = AccountDataValidator.getInstance();
        this.layoutTransformer = LayoutTransformer.getInstance();
    }

    public static getInstance(): AccountDataSerializer {
        if (!AccountDataSerializer.instance) {
            AccountDataSerializer.instance = new AccountDataSerializer();
        }
        return AccountDataSerializer.instance;
    }

    public serialize(
        data: any,
        schema: AccountSchema,
        options: SerializationOptions = {}
    ): Buffer {
        try {
            // Validate data against schema if not explicitly skipped
            if (!options.skipValidation) {
                const validationResult = this.validator.validateAccountData(data, schema);
                if (!validationResult.isValid) {
                    throw new Error(`Validation failed: ${JSON.stringify(validationResult.errors)}`);
                }
            }

            // Calculate required buffer size
            const layout = this.layoutTransformer.computeLayout(schema);
            if (layout.size > this.maxBufferSize) {
                throw new Error(`Data size exceeds maximum buffer size: ${layout.size} > ${this.maxBufferSize}`);
            }

            const buffer = Buffer.alloc(layout.size);

            // Write discriminator if present
            if (schema.discriminator !== undefined) {
                this.writeDiscriminator(buffer, schema.discriminator);
            }

            // Serialize each field
            for (const [fieldName, field] of Object.entries(schema.fields)) {
                const fieldLayout = layout.fields.find(f => f.name === fieldName);
                if (!fieldLayout) continue;

                this.serializeField(
                    buffer,
                    data[fieldName],
                    field,
                    fieldLayout.offset,
                    options
                );
            }

            return buffer;
        } catch (error) {
            throw new Error(`Serialization failed: ${error.message}`);
        }
    }

    public deserialize(
        buffer: Buffer,
        schema: AccountSchema,
        options: DeserializationOptions = {}
    ): any {
        try {
            // Validate buffer size
            const layout = this.layoutTransformer.computeLayout(schema);
            if (buffer.length < layout.size) {
                throw new Error(`Buffer size too small: ${buffer.length} < ${layout.size}`);
            }

            // Verify discriminator if present
            if (schema.discriminator !== undefined) {
                this.verifyDiscriminator(buffer, schema.discriminator);
            }

            const result: any = {};

            // Deserialize each field
            for (const [fieldName, field] of Object.entries(schema.fields)) {
                const fieldLayout = layout.fields.find(f => f.name === fieldName);
                if (!fieldLayout) continue;

                result[fieldName] = this.deserializeField(
                    buffer,
                    field,
                    fieldLayout.offset,
                    options
                );
            }

            // Set default values for missing optional fields
            if (options.preserveDefaults) {
                this.setDefaultValues(result, schema);
            }

            // Validate deserialized data if not explicitly skipped
            if (!options.skipValidation) {
                const validationResult = this.validator.validateAccountData(result, schema);
                if (!validationResult.isValid) {
                    throw new Error(`Validation failed: ${JSON.stringify(validationResult.errors)}`);
                }
            }

            return result;
        } catch (error) {
            throw new Error(`Deserialization failed: ${error.message}`);
        }
    }

    private serializeField(
        buffer: Buffer,
        value: any,
        field: AccountField,
        offset: number,
        options: SerializationOptions
    ): void {
        if (field.array) {
            this.serializeArray(buffer, value, field, offset, options);
            return;
        }

        if (field.nested) {
            this.serializeNested(buffer, value, field.nested, offset, options);
            return;
        }

        this.serializeValue(buffer, value, field.type, offset, options);
    }

    private serializeArray(
        buffer: Buffer,
        value: any[],
        field: AccountField,
        offset: number,
        options: SerializationOptions
    ): void {
        if (!Array.isArray(value)) {
            throw new Error(`Expected array for field type ${field.type}`);
        }

        if (field.arrayLength && value.length !== field.arrayLength) {
            throw new Error(`Array length mismatch: expected ${field.arrayLength}, got ${value.length}`);
        }

        const elementSize = this.getTypeSize(field.type);
        value.forEach((element, index) => {
            this.serializeValue(
                buffer,
                element,
                field.type,
                offset + (index * elementSize),
                options
            );
        });
    }

    private serializeNested(
        buffer: Buffer,
        value: any,
        schema: AccountSchema,
        offset: number,
        options: SerializationOptions
    ): void {
        const nestedBuffer = this.serialize(value, schema, options);
        nestedBuffer.copy(buffer, offset);
    }

    private serializeValue(
        buffer: Buffer,
        value: any,
        type: DataType,
        offset: number,
        options: SerializationOptions
    ): void {
        switch (type) {
            case 'u8':
                buffer.writeUInt8(value, offset);
                break;
            case 'u16':
                buffer.writeUInt16LE(value, offset);
                break;
            case 'u32':
                buffer.writeUInt32LE(value, offset);
                break;
            case 'u64':
                if (value instanceof BN) {
                    value.toBuffer('le', 8).copy(buffer, offset);
                } else {
                    new BN(value).toBuffer('le', 8).copy(buffer, offset);
                }
                break;
            case 'i8':
                buffer.writeInt8(value, offset);
                break;
            case 'i16':
                buffer.writeInt16LE(value, offset);
                break;
            case 'i32':
                buffer.writeInt32LE(value, offset);
                break;
            case 'i64':
                if (value instanceof BN) {
                    value.toBuffer('le', 8).copy(buffer, offset);
                } else {
                    new BN(value).toBuffer('le', 8).copy(buffer, offset);
                }
                break;
            case 'bool':
                buffer.writeUInt8(value ? 1 : 0, offset);
                break;
            case 'publicKey':
                if (value instanceof PublicKey) {
                    value.toBuffer().copy(buffer, offset);
                } else {
                    new PublicKey(value).toBuffer().copy(buffer, offset);
                }
                break;
            case 'string':
                this.serializeString(buffer, value, offset);
                break;
            default:
                if (typeof type === 'object' && type.serialize) {
                    type.serialize(value, buffer, offset);
                } else {
                    throw new Error(`Unsupported type: ${type}`);
                }
        }
    }

    private deserializeField(
        buffer: Buffer,
        field: AccountField,
        offset: number,
        options: DeserializationOptions
    ): any {
        if (field.array) {
            return this.deserializeArray(buffer, field, offset, options);
        }

        if (field.nested) {
            return this.deserializeNested(buffer, field.nested, offset, options);
        }

        return this.deserializeValue(buffer, field.type, offset, options);
    }

    private deserializeArray(
        buffer: Buffer,
        field: AccountField,
        offset: number,
        options: DeserializationOptions
    ): any[] {
        const length = field.arrayLength || 0;
        const elementSize = this.getTypeSize(field.type);
        const result = [];

        for (let i = 0; i < length; i++) {
            result.push(
                this.deserializeValue(
                    buffer,
                    field.type,
                    offset + (i * elementSize),
                    options
                )
            );
        }

        return result;
    }

    private deserializeNested(
        buffer: Buffer,
        schema: AccountSchema,
        offset: number,
        options: DeserializationOptions
    ): any {
        const layout = this.layoutTransformer.computeLayout(schema);
        const slice = buffer.slice(offset, offset + layout.size);
        return this.deserialize(slice, schema, options);
    }

    private deserializeValue(
        buffer: Buffer,
        type: DataType,
        offset: number,
        options: DeserializationOptions
    ): any {
        switch (type) {
            case 'u8':
                return buffer.readUInt8(offset);
            case 'u16':
                return buffer.readUInt16LE(offset);
            case 'u32':
                return buffer.readUInt32LE(offset);
            case 'u64':
                return new BN(buffer.slice(offset, offset + 8), 'le');
            case 'i8':
                return buffer.readInt8(offset);
            case 'i16':
                return buffer.readInt16LE(offset);
            case 'i32':
                return buffer.readInt32LE(offset);
            case 'i64':
                return new BN(buffer.slice(offset, offset + 8), 'le');
            case 'bool':
                return buffer.readUInt8(offset) !== 0;
            case 'publicKey':
                return new PublicKey(buffer.slice(offset, offset + 32));
            case 'string':
                return this.deserializeString(buffer, offset);
            default:
                if (typeof type === 'object' && type.deserialize) {
                    return type.deserialize(buffer, offset);
                }
                throw new Error(`Unsupported type: ${type}`);
        }
    }

    private serializeString(buffer: Buffer, value: string, offset: number): void {
        const stringBuffer = Buffer.from(value, 'utf8');
        buffer.writeUInt32LE(stringBuffer.length, offset);
        stringBuffer.copy(buffer, offset + 4);
    }

    private deserializeString(buffer: Buffer, offset: number): string {
        const length = buffer.readUInt32LE(offset);
        return buffer.slice(offset + 4, offset + 4 + length).toString('utf8');
    }

    private writeDiscriminator(buffer: Buffer, discriminator: number): void {
        new BN(discriminator).toBuffer('le', 8).copy(buffer, 0);
    }

    private verifyDiscriminator(buffer: Buffer, expected: number): void {
        const actual = new BN(buffer.slice(0, 8), 'le').toNumber();
        if (actual !== expected) {
            throw new Error(`Invalid discriminator: expected ${expected}, got ${actual}`);
        }
    }

    private setDefaultValues(data: any, schema: AccountSchema): void {
        for (const [fieldName, field] of Object.entries(schema.fields)) {
            if (data[fieldName] === undefined && field.defaultValue !== undefined) {
                data[fieldName] = field.defaultValue;
            }
        }
    }

    private getTypeSize(type: DataType): number {
        switch (type) {
            case 'u8':
            case 'i8':
            case 'bool':
                return 1;
            case 'u16':
            case 'i16':
                return 2;
            case 'u32':
            case 'i32':
                return 4;
            case 'u64':
            case 'i64':
                return 8;
            case 'publicKey':
                return 32;
            case 'string':
                return 4; // Length prefix
            default:
                if (typeof type === 'object' && type.size) {
                    return type.size;
                }
                throw new Error(`Unknown type size: ${type}`);
        }
    }
}
