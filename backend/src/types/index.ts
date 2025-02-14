import { WebSocket } from 'ws'
import { Request } from 'express'

// Database Models
export interface User {
  id: string
  username: string
  email: string
  password_hash: string
  role: UserRole
  created_at: Date
  updated_at: Date
  last_login_at: Date | null
  is_active: boolean
  is_email_verified: boolean
  verification_token?: string
  reset_token?: string
  reset_token_expires_at?: Date
}

export interface Contract {
  id: string
  name: string
  description?: string
  author_id: string
  code: string
  status: ContractStatus
  security_level: SecurityLevel
  optimization_level: OptimizationLevel
  version: string
  is_template: boolean
  created_at: Date
  updated_at: Date
  published_at?: Date
  compilation_result?: CompilationResult
  analysis_result?: AnalysisResult
  metadata?: Record<string, unknown>
}

export interface ContractVersion {
  id: string
  contract_id: string
  version: string
  code: string
  commit_message?: string
  created_at: Date
  author_id: string
  compilation_result?: CompilationResult
  analysis_result?: AnalysisResult
}

export interface ContractAudit {
  id: string
  contract_id: string
  auditor_id: string
  version: string
  status: AuditStatus
  findings: AuditFinding[]
  started_at: Date
  completed_at?: Date
  report?: string
  severity_score: number
}

// WebSocket Message Types
export interface WSMessage {
  type: WSMessageType
  payload: unknown
  id: string
  timestamp: number
}

export interface WSContractUpdateMessage extends WSMessage {
  type: 'CONTRACT_UPDATE'
  payload: {
    contractId: string
    status: ContractStatus
    changes: Partial<Contract>
  }
}

export interface WSAnalysisResultMessage extends WSMessage {
  type: 'ANALYSIS_RESULT'
  payload: {
    contractId: string
    result: AnalysisResult
  }
}

export interface WSCompilationResultMessage extends WSMessage {
  type: 'COMPILATION_RESULT'
  payload: {
    contractId: string
    result: CompilationResult
  }
}

export interface WSErrorMessage extends WSMessage {
  type: 'ERROR'
  payload: {
    code: string
    message: string
    details?: unknown
  }
}

// WebSocket Client Type
export interface WSClient {
  id: string
  ws: WebSocket
  userId: string
  subscriptions: Set<string>
  lastPing: number
}

// Service Interfaces
export interface IAnalyzerService {
  analyzeContract(code: string, options: AnalysisOptions): Promise<AnalysisResult>
  validateSyntax(code: string): Promise<ValidationResult>
  checkSecurityPatterns(code: string): Promise<SecurityCheckResult>
}

export interface ITemplateService {
  generateFromPrompt(prompt: string, options: TemplateOptions): Promise<string>
  loadTemplate(name: string): Promise<string>
  saveTemplate(name: string, code: string): Promise<void>
}

export interface ICacheService {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttl?: number): Promise<void>
  del(key: string): Promise<void>
  flush(): Promise<void>
}

// Request Extensions
export interface AuthenticatedRequest extends Request {
  user: User
  sessionId: string
}

// Enums
export enum UserRole {
  ADMIN = 'admin',
  DEVELOPER = 'developer',
  AUDITOR = 'auditor'
}

export enum ContractStatus {
  DRAFT = 'draft',
  REVIEWING = 'reviewing',
  PUBLISHED = 'published',
  ARCHIVED = 'archived'
}

export enum SecurityLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high'
}

export enum OptimizationLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high'
}

export enum AuditStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export enum WSMessageType {
  CONTRACT_UPDATE = 'CONTRACT_UPDATE',
  ANALYSIS_RESULT = 'ANALYSIS_RESULT',
  COMPILATION_RESULT = 'COMPILATION_RESULT',
  ERROR = 'ERROR'
}

// Result Types
export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export interface SecurityCheckResult {
  score: number
  vulnerabilities: Vulnerability[]
  recommendations: Recommendation[]
}

export interface CompilationResult {
  success: boolean
  bytecode?: string
  abi?: unknown[]
  errors?: CompilationError[]
  warnings?: CompilationWarning[]
  gasEstimates?: GasEstimates
}

export interface AnalysisResult {
  securityScore: number
  optimizationScore: number
  vulnerabilities: Vulnerability[]
  suggestions: Suggestion[]
  metrics: CodeMetrics
}

// Utility Types
export interface ValidationError {
  code: string
  message: string
  line?: number
  column?: number
  severity: 'error'
}

export interface ValidationWarning {
  code: string
  message: string
  line?: number
  column?: number
  severity: 'warning'
}

export interface Vulnerability {
  id: string
  name: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  location: CodeLocation
  cweId?: string
  fix?: string
}

export interface Recommendation {
  id: string
  title: string
  description: string
  priority: 'low' | 'medium' | 'high'
  impact: string
  effort: string
  code?: string
}

export interface CompilationError {
  code: string
  message: string
  location?: CodeLocation
  severity: 'error'
}

export interface CompilationWarning {
  code: string
  message: string
  location?: CodeLocation
  severity: 'warning'
}

export interface GasEstimates {
  deployment: number
  methods: Record<string, number>
}

export interface CodeMetrics {
  linesOfCode: number
  cyclomaticComplexity: number
  halsteadDifficulty: number
  maintainabilityIndex: number
  testCoverage?: number
}

export interface CodeLocation {
  file: string
  line: number
  column: number
  length?: number
}

export interface AuditFinding {
  id: string
  title: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  category: string
  location?: CodeLocation
  recommendation?: string
  references?: string[]
}

// Configuration Types
export interface AnalysisOptions {
  securityLevel: SecurityLevel
  optimizationLevel: OptimizationLevel
  includeGasAnalysis?: boolean
  includeTestCoverage?: boolean
}

export interface TemplateOptions {
  language: 'rust' | 'typescript'
  framework?: string
  securityLevel: SecurityLevel
  optimizationLevel: OptimizationLevel
  includeTests?: boolean
}

// Export all types
export type {
  User,
  Contract,
  ContractVersion,
  ContractAudit,
  WSMessage,
  WSContractUpdateMessage,
  WSAnalysisResultMessage,
  WSCompilationResultMessage,
  WSErrorMessage,
  WSClient,
  IAnalyzerService,
  ITemplateService,
  ICacheService,
  AuthenticatedRequest
}
