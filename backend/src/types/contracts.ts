import { PublicKey } from '@solana/web3.js';

// Contract Core Types
export interface Contract {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  authorId: string;
  programId: string;
  status: ContractStatus;
  visibility: ContractVisibility;
  createdAt: Date;
  updatedAt: Date;
  deployedAt?: Date;
  lastAuditedAt?: Date;
  metadata: ContractMetadata;
}

export type ContractStatus = 
  | 'draft'
  | 'compiled'
  | 'audited'
  | 'deployed'
  | 'archived'
  | 'deprecated';

export type ContractVisibility = 
  | 'private'
  | 'public'
  | 'organization';

export interface ContractMetadata {
  language: 'rust' | 'typescript';
  framework?: string;
  compilerVersion: string;
  optimizationLevel?: OptimizationLevel;
  license?: string;
  tags: string[];
  dependencies: ContractDependency[];
  sourceCodeHash: string;
  binaryHash: string;
}

// Compilation Types
export interface CompilationOptions {
  optimize?: boolean;
  optimizationLevel?: OptimizationLevel;
  release?: boolean;
  features?: string[];
  skipCache?: boolean;
}

export interface CompilationResult {
  id: string;
  program: Buffer;
  metadata: any;
  optimized: boolean;
  timestamp: string;
  compilerVersion: string;
  stats: {
    compilationTime: number;
    programSize: number;
    optimizationLevel: OptimizationLevel | 'none';
  };
}

export type OptimizationLevel = 'speed' | 'size' | 'balanced';

// Deployment Types
export interface DeploymentRequest {
  deploymentId: string;
  contractId: string;
  network: NetworkType;
  programId: PublicKey;
  upgradeAuthority?: PublicKey;
  metadata?: DeploymentMetadata;
  transaction: any;
}

export interface DeploymentResult {
  programId: string;
  signature: string;
  timestamp: string;
  network: NetworkType;
  error?: string;
}

export interface DeploymentStatus {
  status: 'queued' | 'processing' | 'retrying' | 'completed' | 'failed';
  timestamp: number;
  retries: number;
  result?: DeploymentResult;
  error?: string;
}

export interface DeploymentMetadata {
  version: string;
  description?: string;
  upgradeAuthority?: string;
  initialSupply?: number;
  maxSupply?: number;
  decimals?: number;
  features?: string[];
}

export type NetworkType = 'mainnet-beta' | 'testnet' | 'devnet' | 'localnet';

// Analysis Types
export interface AnalysisResult {
  security: SecurityReport;
  performance: PerformanceMetrics;
  complexity: ComplexityMetrics;
  dataFlow?: DataFlowAnalysis;
  gasEstimates?: GasEstimates;
  timestamp: string;
}

export interface SecurityReport {
  score: number;
  vulnerabilities: Vulnerability[];
  warnings: SecurityWarning[];
  suggestions: SecuritySuggestion[];
}

export interface Vulnerability {
  id: string;
  type: VulnerabilityType;
  severity: VulnerabilityLevel;
  location: CodeLocation;
  description: string;
  impact: string;
  remediation: string;
  confidence: number;
}

export type VulnerabilityType =
  | 'reentrancy'
  | 'arithmetic'
  | 'access-control'
  | 'data-validation'
  | 'logic'
  | 'upgrade-safety'
  | 'dos'
  | 'flash-loan'
  | 'oracle'
  | 'other';

export type VulnerabilityLevel =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'informational';

export interface SecurityWarning {
  id: string;
  type: string;
  message: string;
  location: CodeLocation;
  severity: 'high' | 'medium' | 'low';
}

export interface SecuritySuggestion {
  id: string;
  type: string;
  message: string;
  location?: CodeLocation;
  improvement: string;
}

// Performance and Complexity Metrics
export interface PerformanceMetrics {
  executionTime: number;
  memoryUsage: number;
  computeUnits: number;
  storageImpact: number;
  optimizationSuggestions: OptimizationSuggestion[];
}

export interface ComplexityMetrics {
  cyclomaticComplexity: number;
  halsteadMetrics: HalsteadMetrics;
  maintenanceIndex: number;
  sourceLines: number;
  commentLines: number;
  functions: FunctionMetrics[];
}

export interface HalsteadMetrics {
  programLength: number;
  vocabulary: number;
  volume: number;
  difficulty: number;
  effort: number;
  time: number;
  bugs: number;
}

export interface FunctionMetrics {
  name: string;
  complexity: number;
  lines: number;
  parameters: number;
  returns: number;
}

// Gas and Data Flow Analysis
export interface GasEstimates {
  base: number;
  average: number;
  maximum: number;
  byFunction: Record<string, FunctionGasEstimate>;
}

export interface FunctionGasEstimate {
  base: number;
  average: number;
  maximum: number;
  factors: GasFactor[];
}

export interface GasFactor {
  type: string;
  impact: number;
  description: string;
}

export interface DataFlowAnalysis {
  variables: VariableFlow[];
  functions: FunctionFlow[];
  externalCalls: ExternalCallFlow[];
}

export interface VariableFlow {
  name: string;
  type: string;
  writes: CodeLocation[];
  reads: CodeLocation[];
  dependencies: string[];
}

export interface FunctionFlow {
  name: string;
  calls: string[];
  calledBy: string[];
  stateModifications: string[];
  externalInteractions: string[];
}

export interface ExternalCallFlow {
  target: string;
  function: string;
  location: CodeLocation;
  impact: string[];
}

// Utility Types
export interface CodeLocation {
  file: string;
  line: number;
  column: number;
  length?: number;
}

export interface ContractDependency {
  name: string;
  version: string;
  url?: string;
  checksum?: string;
}

export interface OptimizationSuggestion {
  type: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  location?: CodeLocation;
  recommendation: string;
}

// Error Types
export interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: VulnerabilityLevel;
  errorType: string;
  impact: string;
  remediation: string;
}

// Event Types
export interface ContractEvent {
  type: ContractEventType;
  contractId: string;
  timestamp: Date;
  data: any;
}

export type ContractEventType =
  | 'created'
  | 'updated'
  | 'compiled'
  | 'analyzed'
  | 'deployed'
  | 'audited'
  | 'archived';
