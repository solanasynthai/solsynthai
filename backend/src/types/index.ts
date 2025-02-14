import { PublicKey, TransactionInstruction, Keypair } from '@solana/web3.js'
import { BN } from 'bn.js'

// Contract Types
export interface ContractTemplate {
  name: string
  version: string
  description: string
  schemas: ContractSchema[]
  instructions: InstructionTemplate[]
  metadata: ContractMetadata
}

export interface ContractSchema {
  name: string
  version: number
  fields: SchemaField[]
  size: number
  discriminator?: number
}

export interface SchemaField {
  name: string
  type: FieldType
  size: number
  offset: number
  isOptional: boolean
  validator?: FieldValidator
}

export type FieldType =
  | 'u8'
  | 'u16'
  | 'u32'
  | 'u64'
  | 'i8'
  | 'i16'
  | 'i32'
  | 'i64'
  | 'f32'
  | 'f64'
  | 'bool'
  | 'string'
  | 'pubkey'
  | 'bytes'
  | Array<FieldType>
  | { enum: string[] }
  | { struct: SchemaField[] }

export interface FieldValidator {
  type: 'range' | 'regex' | 'enum' | 'custom'
  params: Record<string, any>
  message: string
}

// Instruction Types
export interface InstructionTemplate {
  name: string
  accounts: AccountMeta[]
  args: ArgumentTemplate[]
  code: string
  checks: SecurityCheck[]
}

export interface AccountMeta {
  name: string
  isSigner: boolean
  isWritable: boolean
  isPda: boolean
  seeds?: PdaSeed[]
}

export interface ArgumentTemplate {
  name: string
  type: FieldType
  validator?: FieldValidator
}

export interface SecurityCheck {
  type: SecurityCheckType
  params: Record<string, any>
  severity: 'low' | 'medium' | 'high' | 'critical'
}

export type SecurityCheckType =
  | 'ownership'
  | 'signer'
  | 'state'
  | 'reentrancy'
  | 'arithmetic'
  | 'access'

// PDA Types
export interface PdaSeed {
  type: FieldType
  path?: string
  value?: string | number | Buffer
}

export interface PdaInfo {
  publicKey: PublicKey
  bump: number
  seeds: Buffer[]
}

// State Management
export interface AccountState {
  pubkey: PublicKey
  data: Buffer
  owner: PublicKey
  executable: boolean
  lamports: number
  rentEpoch: number
  metadata: AccountMetadata
}

export interface AccountMetadata {
  schemaName: string
  schemaVersion: number
  lastUpdate: number
  authority: PublicKey
}

// Transaction Types
export interface TransactionContext {
  instructions: TransactionInstruction[]
  signers: Keypair[]
  feePayer: PublicKey
  metadata: TransactionMetadata
}

export interface TransactionMetadata {
  id: string
  timestamp: number
  origin: string
  priority?: 'low' | 'medium' | 'high'
}

// Event Types
export interface ContractEvent {
  type: string
  data: Record<string, any>
  slot: number
  timestamp: number
  signature?: string
}

// Error Types
export interface ValidationError {
  field?: string
  code: string
  message: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  metadata?: Record<string, any>
}

// Analysis Types
export interface AnalysisResult {
  errors: ValidationError[]
  warnings: ValidationError[]
  metrics: AnalysisMetrics
  timestamp: number
}

export interface AnalysisMetrics {
  codeSize: number
  complexity: number
  coverage: number
  securityScore: number
}

// Generation Types
export interface GenerationOptions {
  template: ContractTemplate
  optimization: OptimizationLevel
  security: SecurityLevel
  testing: boolean
}

export type OptimizationLevel = 'none' | 'basic' | 'aggressive'
export type SecurityLevel = 'basic' | 'standard' | 'high'

// Migration Types
export interface MigrationPlan {
  source: ContractSchema
  target: ContractSchema
  steps: MigrationStep[]
  estimatedGas: BN
}

export interface MigrationStep {
  type: 'add' | 'remove' | 'modify' | 'reorder'
  field: string
  details: Record<string, any>
}

// Monitoring Types
export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'failed'
  checks: HealthCheckResult[]
  timestamp: number
}

export interface HealthCheckResult {
  name: string
  status: 'pass' | 'warn' | 'fail'
  duration: number
  message?: string
}

// Service Types
export interface ServiceConfig {
  enabled: boolean
  maxRetries: number
  timeout: number
  rateLimits: RateLimits
}

export interface RateLimits {
  points: number
  duration: number
  blockDuration: number
}

// Utility Types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export type ValidationResult<T> = {
  isValid: boolean
  errors: ValidationError[]
  value: T | null
}

export type AsyncResult<T> = Promise<{
  success: boolean
  data?: T
  error?: Error
}>

// User defined type guards
export function isContractTemplate(value: any): value is ContractTemplate {
  return (
    value &&
    typeof value.name === 'string' &&
    typeof value.version === 'string' &&
    Array.isArray(value.schemas) &&
    Array.isArray(value.instructions)
  )
}

export function isValidationError(value: any): value is ValidationError {
  return (
    value &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    typeof value.severity === 'string'
  )
}
