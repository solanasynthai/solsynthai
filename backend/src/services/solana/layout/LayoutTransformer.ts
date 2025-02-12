import { 
    AccountSchema,
    MemoryLayout,
    MemoryField,
    ValidationError,
    ValidationErrorType,
    DataType,
    AccountField
} from './types';
import { Buffer } from 'buffer';
import { BN } from 'bn.js';
import { PublicKey } from '@solana/web3.js';

export class LayoutTransformer {
    private static instance: LayoutTransformer;
    private typeAlignments: Map<DataType, number>;
    private typeSizes: Map<DataType, number>;

    private constructor() {
        this.typeAlignments = new Map();
        this.typeSizes = new Map();
        this.initializeTypeMaps();
    }

    public static getInstance(): LayoutTransformer {
        if (!LayoutTransformer.instance) {
            LayoutTransformer.instance = new LayoutTransformer();
        }
        return LayoutTransformer.instance;
    }

    private initializeTypeMaps(): void {
        // Initialize type sizes
        this.typeSizes.set('u8', 1);
        this.typeSizes.set('i8', 1);
        this.typeSizes.set('u16', 2);
        this.typeSizes.set('i16', 2);
        this.typeSizes.set('u32', 4);
        this.typeSizes.set('i32', 4);
        this.typeSizes.set('u64', 8);
        this.typeSizes.set('i64', 8);
        this.typeSizes.set('bool', 1);
        this.typeSizes.set('publicKey', 32);

        // Initialize type alignments
        this.typeAlignments.set('u8', 1);
        this.typeAlignments.set('i8', 1);
        this.typeAlignments.set('u16', 2);
        this.typeAlignments.set('i16', 2);
        this.typeAlignments.set('u32', 4);
        this.typeAlignments.set('i32', 4);
        this.typeAlignments.set('u64', 8);
        this.typeAlignments.set('i64', 8);
        this.typeAlignments.set('bool', 1);
        this.typeAlignments.set('publicKey', 8);
    }

    public computeLayout(schema: AccountSchema): MemoryLayout {
        const fields: MemoryField[] = [];
        let currentOffset = 0;
        let maxAlignment = 1;

        // Add discriminator if present
        if (schema.discriminator !== undefined) {
            fields.push({
                name: 'discriminator',
                offset: 0,
                size: 8,
                alignment: 8
            });
            currentOffset = 8;
            maxAlignment = 8;
        }

        // Process each field
        for (const [fieldName, field] of Object.entries(schema.fields)) {
            const fieldLayout = this.computeFieldLayout(field, currentOffset);
            maxAlignment = Math.max(maxAlignment, fieldLayout.alignment);

            // Add padding for alignment
            const padding = this.calculatePadding(currentOffset, fieldLayout.alignment);
            currentOffset += padding;

            fields.push({
                name: fieldName,
                offset: currentOffset,
                size: fieldLayout.size,
                alignment: fieldLayout.alignment,
                padding
            });

            currentOffset += fieldLayout.size;
        }

        // Add final padding to align the entire structure
        const finalPadding = this.calculatePadding(currentOffset, maxAlignment);
        const totalSize = currentOffset + finalPadding;

        return {
            size: totalSize,
            alignment: maxAlignment,
            fields
        };
    }

    public transformLayout(
        sourceSchema: AccountSchema,
        targetSchema: AccountSchema,
        data: Buffer
    ): Buffer {
        const sourceLayout = this.computeLayout(sourceSchema);
        const targetLayout = this.computeLayout(targetSchema);
        
        const result = Buffer.alloc(targetLayout.size);

        // Copy discriminator if present
        if (targetSchema.discriminator !== undefined) {
            const discriminator = new BN(targetSchema.discriminator).toBuffer('le', 8);
            discriminator.copy(result, 0);
        }

        // Transform each field
        for (const [fieldName, targetField] of Object.entries(targetSchema.fields)) {
            const sourceField = sourceSchema.fields[fieldName];
            if (!sourceField) continue;

            const targetFieldLayout = targetLayout.fields.find(f => f.name === fieldName);
            const sourceFieldLayout = sourceLayout.fields.find(f => f.name === fieldName);

            if (!targetFieldLayout || !sourceFieldLayout) continue;

            this.transformField(
                data,
                result,
                sourceField,
                targetField,
                sourceFieldLayout,
                targetFieldLayout
            );
        }

        return result;
    }

    private computeFieldLayout(field: AccountField, currentOffset: number): { size: number; alignment: number } {
        if (field.array) {
            return this.computeArrayLayout(field);
        }

        if (field.nested) {
            return this.computeNestedLayout(field.nested);
        }

        const size = this.getTypeSize(field.type);
        const alignment = this.getTypeAlignment(field.type);

        return { size, alignment };
    }

    private computeArrayLayout(field: AccountField): { size: number; alignment: number } {
        const elementSize = this.getTypeSize(field.type);
        const elementAlignment = this.getTypeAlignment(field.type);
        const length = field.arrayLength || 0;

        return {
            size: elementSize * length,
            alignment: elementAlignment
        };
    }

    private computeNestedLayout(schema: AccountSchema): { size: number; alignment: number } {
        const layout = this.computeLayout(schema);
        return {
            size: layout.size,
            alignment: layout.alignment
        };
    }

    private transformField(
        sourceBuffer: Buffer,
        targetBuffer: Buffer,
        sourceField: AccountField,
        targetField: AccountField,
        sourceLayout: MemoryField,
        targetLayout: MemoryField
    ): void {
        // Handle basic type transformations
        if (this.isBasicType(sourceField.type) && this.isBasicType(targetField.type)) {
            this.transformBasicType(
                sourceBuffer,
                targetBuffer,
                sourceField.type,
                targetField.type,
                sourceLayout.offset,
                targetLayout.offset
            );
            return;
        }

        // Handle array transformations
        if (sourceField.array && targetField.array) {
            this.transformArray(
                sourceBuffer,
                targetBuffer,
                sourceField,
                targetField,
                sourceLayout,
                targetLayout
            );
            return;
        }

        // Handle nested structure transformations
        if (sourceField.nested && targetField.nested) {
            this.transformNested(
                sourceBuffer,
                targetBuffer,
                sourceField.nested,
                targetField.nested,
                sourceLayout,
                targetLayout
            );
            return;
        }
    }

    private transformBasicType(
        sourceBuffer: Buffer,
        targetBuffer: Buffer,
        sourceType: DataType,
        targetType: DataType,
        sourceOffset: number,
        targetOffset: number
    ): void {
        const sourceSize = this.getTypeSize(sourceType);
        const value = this.readValue(sourceBuffer, sourceType, sourceOffset, sourceSize);
        this.writeValue(targetBuffer, targetType, targetOffset, value);
    }

    private transformArray(
        sourceBuffer: Buffer,
        targetBuffer: Buffer,
        sourceField: AccountField,
        targetField: AccountField,
        sourceLayout: MemoryField,
        targetLayout: MemoryField
    ): void {
        const elementSize = this.getTypeSize(sourceField.type);
        const length = Math.min(
            sourceField.arrayLength || 0,
            targetField.arrayLength || 0
        );

        for (let i = 0; i < length; i++) {
            const sourceOffset = sourceLayout.offset + (i * elementSize);
            const targetOffset = targetLayout.offset + (i * elementSize);

            this.transformBasicType(
                sourceBuffer,
                targetBuffer,
                sourceField.type,
                targetField.type,
                sourceOffset,
                targetOffset
            );
        }
    }

    private transformNested(
        sourceBuffer: Buffer,
        targetBuffer: Buffer,
        sourceSchema: AccountSchema,
        targetSchema: AccountSchema,
        sourceLayout: MemoryField,
        targetLayout: MemoryField
    ): void {
        const sourceSlice = sourceBuffer.slice(
            sourceLayout.offset,
            sourceLayout.offset + sourceLayout.size
        );

        const transformedData = this.transformLayout(
            sourceSchema,
            targetSchema,
            sourceSlice
        );

        transformedData.copy(targetBuffer, targetLayout.offset);
    }

    private readValue(buffer: Buffer, type: DataType, offset: number, size: number): any {
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
            default:
                throw new Error(`Unsupported type: ${type}`);
        }
    }

    private writeValue(buffer: Buffer, type: DataType, offset: number, value: any): void {
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
            default:
                throw new Error(`Unsupported type: ${type}`);
        }
    }

    private calculatePadding(offset: number, alignment: number): number {
        return (alignment - (offset % alignment)) % alignment;
    }

    private getTypeSize(type: DataType): number {
        const size = this.typeSizes.get(type);
        if (size === undefined) {
            throw new Error(`Unknown type size: ${type}`);
        }
        return size;
    }

    private getTypeAlignment(type: DataType): number {
        const alignment = this.typeAlignments.get(type);
        if (alignment === undefined) {
            throw new Error(`Unknown type alignment: ${type}`);
        }
        return alignment;
    }

    private isBasicType(type: DataType): boolean {
        return this.typeSizes.has(type);
    }
}
