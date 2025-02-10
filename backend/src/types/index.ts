export interface ContractTemplate {
  id: string;
  name: string;
  description: string;
  code: string;
  version: string;
}

export interface CompilationResult {
  success: boolean;
  bytecode?: string;
  errors?: string[];
  warnings?: string[];
}

export interface DeploymentResult {
  success: boolean;
  programId?: string;
  error?: string;
  transactionId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}
