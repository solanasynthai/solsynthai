export interface AccountSchema {
    name: string;
    version: number;
    discriminator?: number;
    fields: Record<string, AccountField>;
    metadata?: AccountMetadata;
}

export interface AccountField {
    type: DataType;
    required: boolean;
    array?: boolean;
    arrayLength?: number;
    nested?: AccountSchema;
    constraints?: FieldConstraints;
    defaultValue?: any;
    description?: string;
}

export interface AccountMetadata {
    description?: string;
    authority?: string;
    rentExempt: boolean;
    mutable: boolean;
    closeAuthority?: string;
    maxSize?: number;
}

export interface FieldConstraints {
    min?: number;
    max?: number;
    length?: number;
    pattern?: string;
    custom?: (value: any) => boolean;
}

export type DataType =
    | 'u8'
    | 'u16'
    | 'u32'
    | 'u64'
    | 'i8'
    | 'i16'
    | 'i32'
    | 'i64'
    | 'bool'
    | 'string'
    | 'publicKey'
    | 'bytes'
    | 'option'
    | 'vec'
    | 'map'
    | CustomType;

export interface CustomType {
    name: string;
    size: number;
    serialize: (value: any) => Buffer;
    deserialize: (buffer: Buffer) => any;
    validate: (value: any) => boolean;
}

export interface Layout<T = any> {
    span: number;
    property?: string;
    decode(buffer: Buffer, offset?: number): T;
    encode(src: T, buffer: Buffer, offset?: number): number;
    getSpan(buffer?: Buffer, offset?: number): number;
    replicate(property: string): Layout<T>;
}

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
}

export interface ValidationError {
    field: string;
    message: string;
    errorType: ValidationErrorType;
    constraint?: FieldConstraints;
    value?: any;
}

export enum ValidationErrorType {
    REQUIRED_FIELD_MISSING = 'REQUIRED_FIELD_MISSING',
    INVALID_TYPE = 'INVALID_TYPE',
    CONSTRAINT_VIOLATION = 'CONSTRAINT_VIOLATION',
    SIZE_EXCEEDED = 'SIZE_EXCEEDED',
    PATTERN_MISMATCH = 'PATTERN_MISMATCH',
    CUSTOM_VALIDATION_FAILED = 'CUSTOM_VALIDATION_FAILED'
}

export interface SerializationOptions {
    skipValidation?: boolean;
    preserveDefaults?: boolean;
    encoding?: BufferEncoding;
    endian?: 'le' | 'be';
}

export interface DeserializationOptions {
    skipValidation?: boolean;
    preserveRaw?: boolean;
    encoding?: BufferEncoding;
    endian?: 'le' | 'be';
}

export interface LayoutOptions {
    alignment?: number;
    maxSize?: number;
    padding?: number;
    validate?: boolean;
}

export interface SchemaValidationOptions {
    strict?: boolean;
    ignoreUnknownFields?: boolean;
    customValidators?: Record<string, (value: any) => boolean>;
}

export interface MemoryLayout {
    size: number;
    alignment: number;
    fields: MemoryField[];
}

export interface MemoryField {
    name: string;
    offset: number;
    size: number;
    alignment: number;
    padding?: number;
}

export interface ParsedAccount<T = any> {
    parsed: T;
    raw: Buffer;
    schema: AccountSchema;
    discriminator?: number;
    version: number;
}
