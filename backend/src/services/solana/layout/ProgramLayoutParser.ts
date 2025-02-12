import { Buffer } from 'buffer';
import { Layout, struct, u8, u16, u32, u64, blob, union, seq } from 'buffer-layout';
import { PublicKey } from '@solana/web3.js';
import { BN } from 'bn.js';
import { encodeAccountData, decodeAccountData } from '../utils/accountEncoding';
import { InstructionType, AccountType, SchemaField, DataType } from '../types';

export class ProgramLayoutParser {
    private static instance: ProgramLayoutParser;
    private accountLayouts: Map<string, Layout>;
    private instructionLayouts: Map<string, Layout>;
    private accountValidators: Map<string, (data: Buffer) => boolean>;

    private constructor() {
        this.accountLayouts = new Map();
        this.instructionLayouts = new Map();
        this.accountValidators = new Map();
        this.initializeBaseLayouts();
    }

    public static getInstance(): ProgramLayoutParser {
        if (!ProgramLayoutParser.instance) {
            ProgramLayoutParser.instance = new ProgramLayoutParser();
        }
        return ProgramLayoutParser.instance;
    }

    private initializeBaseLayouts(): void {
        // Basic data type layouts
        this.registerDataTypeLayout('u8', u8());
        this.registerDataTypeLayout('u16', u16());
        this.registerDataTypeLayout('u32', u32());
        this.registerDataTypeLayout('u64', u64());
        this.registerDataTypeLayout('publicKey', blob(32));
        
        // Complex data type layouts
        this.registerDataTypeLayout('string', this.createStringLayout());
        this.registerDataTypeLayout('vec', this.createVectorLayout());
        this.registerDataTypeLayout('option', this.createOptionLayout());
    }

    public parseInstructionData(instructionType: InstructionType, data: Buffer): any {
        const layout = this.instructionLayouts.get(instructionType);
        if (!layout) {
            throw new Error(`No layout registered for instruction type: ${instructionType}`);
        }

        try {
            const decodedData = layout.decode(data);
            return this.normalizeDecodedData(decodedData);
        } catch (error) {
            throw new Error(`Failed to decode instruction data: ${error.message}`);
        }
    }

    public serializeInstructionData(instructionType: InstructionType, data: any): Buffer {
        const layout = this.instructionLayouts.get(instructionType);
        if (!layout) {
            throw new Error(`No layout registered for instruction type: ${instructionType}`);
        }

        try {
            const normalizedData = this.denormalizeData(data);
            const buffer = Buffer.alloc(layout.span);
            layout.encode(normalizedData, buffer);
            return buffer;
        } catch (error) {
            throw new Error(`Failed to encode instruction data: ${error.message}`);
        }
    }

    public parseAccountData(accountType: AccountType, data: Buffer): any {
        const layout = this.accountLayouts.get(accountType);
        if (!layout) {
            throw new Error(`No layout registered for account type: ${accountType}`);
        }

        const validator = this.accountValidators.get(accountType);
        if (validator && !validator(data)) {
            throw new Error(`Invalid account data format for type: ${accountType}`);
        }

        try {
            return decodeAccountData(layout, data);
        } catch (error) {
            throw new Error(`Failed to decode account data: ${error.message}`);
        }
    }

    public serializeAccountData(accountType: AccountType, data: any): Buffer {
        const layout = this.accountLayouts.get(accountType);
        if (!layout) {
            throw new Error(`No layout registered for account type: ${accountType}`);
        }

        try {
            return encodeAccountData(layout, data);
        } catch (error) {
            throw new Error(`Failed to encode account data: ${error.message}`);
        }
    }

    public registerInstructionLayout(type: InstructionType, fields: SchemaField[]): void {
        const layout = this.createStructLayout(fields);
        this.instructionLayouts.set(type, layout);
    }

    public registerAccountLayout(type: AccountType, fields: SchemaField[], validator?: (data: Buffer) => boolean): void {
        const layout = this.createStructLayout(fields);
        this.accountLayouts.set(type, layout);
        if (validator) {
            this.accountValidators.set(type, validator);
        }
    }

    private createStructLayout(fields: SchemaField[]): Layout {
        const layoutFields = fields.map(field => {
            const fieldLayout = this.getLayoutForDataType(field.type);
            return field.repeating ? seq(fieldLayout, field.length || 0) : fieldLayout;
        });

        return struct(layoutFields);
    }

    private getLayoutForDataType(dataType: DataType): Layout {
        const layout = this.accountLayouts.get(dataType);
        if (!layout) {
            throw new Error(`Unsupported data type: ${dataType}`);
        }
        return layout;
    }

    private createStringLayout(): Layout {
        return struct([
            u32('length'),
            blob(u32(), 'chars'),
        ]);
    }

    private createVectorLayout(): Layout {
        return struct([
            u32('length'),
            seq(u8(), u32(), 'elements'),
        ]);
    }

    private createOptionLayout(): Layout {
        return union(u8(), struct([]));
    }

    private normalizeDecodedData(data: any): any {
        if (data instanceof BN) {
            return data.toString();
        }
        if (data instanceof Buffer) {
            return new PublicKey(data).toString();
        }
        if (Array.isArray(data)) {
            return data.map(item => this.normalizeDecodedData(item));
        }
        if (typeof data === 'object' && data !== null) {
            const normalized = {};
            for (const [key, value] of Object.entries(data)) {
                normalized[key] = this.normalizeDecodedData(value);
            }
            return normalized;
        }
        return data;
    }

    private denormalizeData(data: any): any {
        if (typeof data === 'string' && data.length === 44) {
            return new PublicKey(data).toBuffer();
        }
        if (Array.isArray(data)) {
            return data.map(item => this.denormalizeData(item));
        }
        if (typeof data === 'object' && data !== null) {
            const denormalized = {};
            for (const [key, value] of Object.entries(data)) {
                denormalized[key] = this.denormalizeData(value);
            }
            return denormalized;
        }
        return data;
    }
}
