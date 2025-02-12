import { Buffer } from 'buffer';
import { 
    struct, 
    u8, 
    u16, 
    u32, 
    u64, 
    i8, 
    i16, 
    i32, 
    i64, 
    bool, 
    vec, 
    option, 
    map, 
    array, 
    publicKey, 
    Layout 
} from '@solana/buffer-layout';
import { PublicKey } from '@solana/web3.js';
import { BN } from 'bn.js';

export class SolanaProgramLayoutParser {
    private static instance: SolanaProgramLayoutParser;
    private layouts: Map<string, Layout>;
    private customLayouts: Map<string, Layout>;
    private accountSchemas: Map<string, AccountSchema>;

    private constructor() {
        this.layouts = new Map();
        this.customLayouts = new Map();
        this.accountSchemas = new Map();
        this.initializeBaseLayouts();
    }

    public static getInstance(): SolanaProgramLayoutParser {
        if (!SolanaProgramLayoutParser.instance) {
            SolanaProgramLayoutParser.instance = new SolanaProgramLayoutParser();
        }
        return SolanaProgramLayoutParser.instance;
    }

    private initializeBaseLayouts(): void {
        // Basic Types
        this.layouts.set('u8', u8());
        this.layouts.set('u16', u16());
        this.layouts.set('u32', u32());
        this.layouts.set('u64', u64());
        this.layouts.set('i8', i8());
        this.layouts.set('i16', i16());
        this.layouts.set('i32', i32());
        this.layouts.set('i64', i64());
        this.layouts.set('bool', bool());
        this.layouts.set('publicKey', publicKey());

        // Initialize custom layouts
        this.initializeCustomLayouts();
    }

    private initializeCustomLayouts(): void {
        // String Layout
        this.customLayouts.set('string', this.createStringLayout());

        // Optional Types
        this.customLayouts.set('optionalPublicKey', this.createOptionalLayout(publicKey()));
        this.customLayouts.set('optionalU64', this.createOptionalLayout(u64()));

        // Vector Types
        this.customLayouts.set('pubkeyVector', this.createVectorLayout(publicKey()));
        this.customLayouts.set('u64Vector', this.createVectorLayout(u64()));

        // Map Types
        this.customLayouts.set('pubkeyMap', this.createMapLayout(publicKey(), u64()));
    }

    public registerAccountSchema(name: string, schema: AccountSchema): void {
        const layout = this.createSchemaLayout(schema);
        this.accountSchemas.set(name, schema);
        this.layouts.set(name, layout);
    }

    public parseAccountData(accountName: string, data: Buffer): any {
        const layout = this.layouts.get(accountName);
        if (!layout) {
            throw new Error(`No layout registered for account type: ${accountName}`);
        }

        try {
            const decoded = layout.decode(data);
            return this.normalizeDecodedData(decoded);
        } catch (error) {
            throw new Error(`Failed to decode account data: ${error.message}`);
        }
    }

    public serializeAccountData(accountName: string, data: any): Buffer {
        const layout = this.layouts.get(accountName);
        if (!layout) {
            throw new Error(`No layout registered for account type: ${accountName}`);
        }

        try {
            const normalizedData = this.denormalizeData(data);
            const buffer = Buffer.alloc(layout.span);
            layout.encode(normalizedData, buffer);
            return buffer;
        } catch (error) {
            throw new Error(`Failed to encode account data: ${error.message}`);
        }
    }

    public getAccountSize(accountName: string): number {
        const layout = this.layouts.get(accountName);
        if (!layout) {
            throw new Error(`No layout registered for account type: ${accountName}`);
        }
        return layout.span;
    }

    private createSchemaLayout(schema: AccountSchema): Layout {
        const fields = Object.entries(schema.fields).map(([name, field]) => {
            const layout = this.getLayoutForType(field.type);
            return { name, layout };
        });

        return struct(fields);
    }

    private getLayoutForType(type: string): Layout {
        // Check base layouts
        const baseLayout = this.layouts.get(type);
        if (baseLayout) return baseLayout;

        // Check custom layouts
        const customLayout = this.customLayouts.get(type);
        if (customLayout) return customLayout;

        // Check account layouts
        const accountLayout = this.accountSchemas.get(type);
        if (accountLayout) return this.createSchemaLayout(accountLayout);

        throw new Error(`Unsupported data type: ${type}`);
    }

    private createStringLayout(): Layout {
        return struct([
            u32('length'),
            array(u8(), u32(), 'chars')
        ]);
    }

    private createOptionalLayout(valueLayout: Layout): Layout {
        return struct([
            bool('exists'),
            valueLayout
        ]);
    }

    private createVectorLayout(elementLayout: Layout): Layout {
        return struct([
            u32('length'),
            array(elementLayout, u32(), 'elements')
        ]);
    }

    private createMapLayout(keyLayout: Layout, valueLayout: Layout): Layout {
        return struct([
            u32('size'),
            array(struct([
                keyLayout,
                valueLayout
            ]), u32(), 'entries')
        ]);
    }

    private normalizeDecodedData(data: any): any {
        if (data instanceof BN) {
            return data.toString();
        }
        if (data instanceof Buffer) {
            if (data.length === 32) {
                return new PublicKey(data).toString();
            }
            return data.toString('hex');
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
        if (typeof data === 'string') {
            // Check if it's a public key
            if (data.length === 44) {
                return new PublicKey(data).toBuffer();
            }
            // Check if it's a hex string
            if (data.match(/^[0-9a-fA-F]+$/)) {
                return Buffer.from(data, 'hex');
            }
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

    public validateAccountData(accountName: string, data: Buffer): boolean {
        const schema = this.accountSchemas.get(accountName);
        if (!schema) {
            throw new Error(`No schema registered for account type: ${accountName}`);
        }

        try {
            const decoded = this.parseAccountData(accountName, data);
            return this.validateDecodedData(decoded, schema);
        } catch {
            return false;
        }
    }

    private validateDecodedData(data: any, schema: AccountSchema): boolean {
        for (const [fieldName, field] of Object.entries(schema.fields)) {
            const value = data[fieldName];
            
            // Check required fields
            if (field.required && (value === undefined || value === null)) {
                return false;
            }

            // Check field types
            if (!this.validateFieldType(value, field.type)) {
                return false;
            }

            // Check field constraints
            if (field.constraints && !this.validateFieldConstraints(value, field.constraints)) {
                return false;
            }
        }

        return true;
    }

    private validateFieldType(value: any, type: string): boolean {
        switch (type) {
            case 'u8':
            case 'u16':
            case 'u32':
            case 'u64':
                return typeof value === 'number' && value >= 0;
            case 'i8':
            case 'i16':
            case 'i32':
            case 'i64':
                return typeof value === 'number';
            case 'bool':
                return typeof value === 'boolean';
            case 'publicKey':
                return typeof value === 'string' && value.length === 44;
            case 'string':
                return typeof value === 'string';
            default:
                return true; // Custom types are assumed valid
        }
    }

    private validateFieldConstraints(value: any, constraints: any): boolean {
        if (constraints.min !== undefined && value < constraints.min) {
            return false;
        }
        if (constraints.max !== undefined && value > constraints.max) {
            return false;
        }
        if (constraints.length !== undefined && value.length !== constraints.length) {
            return false;
        }
        if (constraints.pattern && !new RegExp(constraints.pattern).test(value)) {
            return false;
        }
        return true;
    }
}
