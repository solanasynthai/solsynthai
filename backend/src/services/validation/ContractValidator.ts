import { Connection, PublicKey } from '@solana/web3.js';
import { getTypeInfo } from '@solana/spl-type-length-value';
import { Redis } from 'ioredis';
import { createHash } from 'crypto';
import { logger } from '../../utils/logger';
import { MetricsService } from '../monitoring/MetricsService';
import { ReentrancyAnalyzer } from '../security/specialized/ReentrancyAnalyzer';
import { ValidationError } from '../../utils/errors';
import { config } from '../../config';

interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  metrics: ValidationMetrics;
}

interface ValidationError {
  code: string;
  message: string;
  location?: {
    line: number;
    column: number;
  };
  severity: 'error' | 'critical';
}

interface ValidationWarning {
  code: string;
  message: string;
  location?: {
    line: number;
    column: number;
  };
  severity: 'warning' | 'info';
}

interface ValidationMetrics {
  complexityScore: number;
  securityScore: number;
  gasEstimate: number;
  size: number;
  entryPoints: number;
}

export class ContractValidator {
  private static instance: ContractValidator;
  private redis: Redis;
  private connection: Connection;
  private reentrancyAnalyzer: ReentrancyAnalyzer;
  private readonly CACHE_PREFIX = 'validation:';
  private readonly CACHE_TTL = 1800; // 30 minutes

  private constructor() {
    this.redis = new Redis(config.redis.url);
    this.connection = new Connection(config.solana.networks[config.solana.defaultNetwork]);
    this.reentrancyAnalyzer = new ReentrancyAnalyzer();
  }

  public static getInstance(): ContractValidator {
    if (!ContractValidator.instance) {
      ContractValidator.instance = new ContractValidator();
    }
    return ContractValidator.instance;
  }

  public async validate(
    sourceCode: string,
    compiledCode: Buffer,
    options: { skipCache?: boolean; strictMode?: boolean } = {}
  ): Promise<ValidationResult> {
    const startTime = Date.now();
    try {
      // Generate validation hash
      const validationHash = this.generateValidationHash(sourceCode, compiledCode);

      // Check cache unless skipCache is true
      if (!options.skipCache) {
        const cached = await this.getFromCache(validationHash);
        if (cached) {
          MetricsService.increment('validation.cache.hit');
          return cached;
        }
      }

      MetricsService.increment('validation.cache.miss');

      const errors: ValidationError[] = [];
      const warnings: ValidationWarning[] = [];

      // Basic validation checks
      this.validateBasicRequirements(sourceCode, compiledCode, errors, warnings);

      // Advanced validation
      await Promise.all([
        this.validateSyntax(sourceCode, errors, warnings),
        this.validateBytecode(compiledCode, errors, warnings),
        this.validateSecurityPatterns(sourceCode, errors, warnings),
        this.validateGasEfficiency(compiledCode, warnings)
      ]);

      // Calculate metrics
      const metrics = await this.calculateMetrics(sourceCode, compiledCode);

      // Apply strict mode if enabled
      if (options.strictMode) {
        this.applyStrictModeValidation(warnings, errors);
      }

      const result: ValidationResult = {
        isValid: errors.length === 0,
        errors,
        warnings,
        metrics
      };

      // Cache the result
      await this.cacheResult(validationHash, result);

      // Track validation metrics
      this.trackValidationMetrics(result, Date.now() - startTime);

      return result;
    } catch (error) {
      logger.error('Validation failed:', { error });
      throw error;
    }
  }

  private async validateSyntax(
    sourceCode: string,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): Promise<void> {
    // Check for required program attributes
    if (!sourceCode.includes('#[program]')) {
      errors.push({
        code: 'MISSING_PROGRAM_ATTRIBUTE',
        message: 'Missing #[program] attribute',
        severity: 'error'
      });
    }

    // Check for proper entry point definition
    if (!sourceCode.match(/pub\s+fn\s+process_instruction/)) {
      errors.push({
        code: 'MISSING_ENTRY_POINT',
        message: 'Missing process_instruction entry point',
        severity: 'error'
      });
    }

    // Check for potential infinite loops
    const infiniteLoopPattern = /while\s+true|loop\s*{[^}]*}/g;
    const matches = sourceCode.match(infiniteLoopPattern);
    if (matches) {
      warnings.push({
        code: 'POTENTIAL_INFINITE_LOOP',
        message: 'Potential infinite loop detected',
        severity: 'warning'
      });
    }
  }

  private async validateBytecode(
    compiledCode: Buffer,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): Promise<void> {
    try {
      // Check program size
      if (compiledCode.length > 1024 * 1024) { // 1MB limit
        errors.push({
          code: 'PROGRAM_SIZE_EXCEEDED',
          message: 'Program size exceeds 1MB limit',
          severity: 'error'
        });
      }

      // Validate ELF header
      if (!this.isValidELFHeader(compiledCode)) {
        errors.push({
          code: 'INVALID_ELF_HEADER',
          message: 'Invalid ELF header in compiled program',
          severity: 'critical'
        });
      }

      // Check for deprecated instructions
      const deprecatedInstructions = this.findDeprecatedInstructions(compiledCode);
      if (deprecatedInstructions.length > 0) {
        warnings.push({
          code: 'DEPRECATED_INSTRUCTIONS',
          message: `Found deprecated instructions: ${deprecatedInstructions.join(', ')}`,
          severity: 'warning'
        });
      }
    } catch (error) {
      logger.error('Bytecode validation failed:', { error });
      errors.push({
        code: 'BYTECODE_VALIDATION_FAILED',
        message: 'Failed to validate program bytecode',
        severity: 'critical'
      });
    }
  }

  private async validateSecurityPatterns(
    sourceCode: string,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): Promise<void> {
    // Check for reentrancy vulnerabilities
    const reentrancyIssues = await this.reentrancyAnalyzer.analyze(sourceCode);
    reentrancyIssues.forEach(issue => {
      if (issue.severity === 'high') {
        errors.push({
          code: 'REENTRANCY_VULNERABILITY',
          message: issue.message,
          location: issue.location,
          severity: 'critical'
        });
      } else {
        warnings.push({
          code: 'POTENTIAL_REENTRANCY',
          message: issue.message,
          location: issue.location,
          severity: 'warning'
        });
      }
    });

    // Check for unsafe arithmetic
    if (this.hasUnsafeArithmetic(sourceCode)) {
      warnings.push({
        code: 'UNSAFE_ARITHMETIC',
        message: 'Detected potential unsafe arithmetic operations',
        severity: 'warning'
      });
    }

    // Check for proper error handling
    if (!this.hasProperErrorHandling(sourceCode)) {
      warnings.push({
        code: 'INSUFFICIENT_ERROR_HANDLING',
        message: 'Insufficient error handling detected',
        severity: 'warning'
      });
    }
  }

  private async validateGasEfficiency(
    compiledCode: Buffer,
    warnings: ValidationWarning[]
  ): Promise<void> {
    const gasEstimate = await this.estimateGasUsage(compiledCode);
    const threshold = 200000; // Example threshold

    if (gasEstimate > threshold) {
      warnings.push({
        code: 'HIGH_GAS_USAGE',
        message: `High gas usage detected (${gasEstimate} units)`,
        severity: 'warning'
      });
    }
  }

  private async calculateMetrics(
    sourceCode: string,
    compiledCode: Buffer
  ): Promise<ValidationMetrics> {
    return {
      complexityScore: this.calculateComplexityScore(sourceCode),
      securityScore: await this.calculateSecurityScore(sourceCode),
      gasEstimate: await this.estimateGasUsage(compiledCode),
      size: compiledCode.length,
      entryPoints: this.countEntryPoints(sourceCode)
    };
  }

  private calculateComplexityScore(sourceCode: string): number {
    // Implement cyclomatic complexity calculation
    const branchingPatterns = [
      /if\s+/g,
      /else\s+/g,
      /while\s+/g,
      /for\s+/g,
      /match\s+/g
    ];

    return branchingPatterns.reduce((score, pattern) => {
      const matches = sourceCode.match(pattern);
      return score + (matches ? matches.length : 0);
    }, 1);
  }

  private async calculateSecurityScore(sourceCode: string): Promise<number> {
    let score = 100;
    
    // Deduct points for security issues
    const securityIssues = await this.reentrancyAnalyzer.analyze(sourceCode);
    score -= securityIssues.length * 10;

    // Check for other security patterns
    if (!this.hasProperErrorHandling(sourceCode)) score -= 15;
    if (this.hasUnsafeArithmetic(sourceCode)) score -= 20;
    if (!this.hasInputValidation(sourceCode)) score -= 15;

    return Math.max(0, score);
  }

  private async estimateGasUsage(compiledCode: Buffer): Promise<number> {
    // Implement gas estimation logic
    const INSTRUCTION_COSTS: Record<string, number> = {
      'add': 1,
      'mul': 2,
      'div': 3,
      'load': 1,
      'store': 2,
      'call': 5
    };

    let totalCost = 0;
    // Analysis would go here
    return totalCost;
  }

  private generateValidationHash(sourceCode: string, compiledCode: Buffer): string {
    return createHash('sha256')
      .update(sourceCode)
      .update(compiledCode)
      .digest('hex');
  }

  private async getFromCache(hash: string): Promise<ValidationResult | null> {
    const cached = await this.redis.get(`${this.CACHE_PREFIX}${hash}`);
    return cached ? JSON.parse(cached) : null;
  }

  private async cacheResult(hash: string, result: ValidationResult): Promise<void> {
    await this.redis.setex(
      `${this.CACHE_PREFIX}${hash}`,
      this.CACHE_TTL,
      JSON.stringify(result)
    );
  }

  private trackValidationMetrics(result: ValidationResult, duration: number): void {
    MetricsService.timing('validation.duration', duration);
    MetricsService.gauge('validation.errors', result.errors.length);
    MetricsService.gauge('validation.warnings', result.warnings.length);
    MetricsService.gauge('validation.security_score', result.metrics.securityScore);
  }

  private isValidELFHeader(compiledCode: Buffer): boolean {
    // Check ELF magic number
    return compiledCode.slice(0, 4).toString('hex') === '7f454c46';
  }

  private findDeprecatedInstructions(compiledCode: Buffer): string[] {
    // Implementation would identify deprecated Solana instructions
    return [];
  }

  private hasUnsafeArithmetic(sourceCode: string): boolean {
    const unsafePatterns = [
      /\+=/,
      /-=/,
      /\*=/,
      /\/=/
    ];
    return unsafePatterns.some(pattern => pattern.test(sourceCode));
  }

  private hasProperErrorHandling(sourceCode: string): boolean {
    return sourceCode.includes('Result<') && sourceCode.includes('Error');
  }

  private hasInputValidation(sourceCode: string): boolean {
    return sourceCode.includes('require!') || sourceCode.includes('assert!');
  }

  private countEntryPoints(sourceCode: string): number {
    const entryPointPattern = /pub\s+fn\s+\w+\s*\(/g;
    const matches = sourceCode.match(entryPointPattern);
    return matches ? matches.length : 0;
  }

  private applyStrictModeValidation(
    warnings: ValidationWarning[],
    errors: ValidationError[]
  ): void {
    // Convert relevant warnings to errors in strict mode
    const strictWarnings = warnings.filter(w => 
      ['UNSAFE_ARITHMETIC', 'POTENTIAL_REENTRANCY'].includes(w.code)
    );

    errors.push(...strictWarnings.map(w => ({
      code: w.code,
      message: `[Strict Mode] ${w.message}`,
      location: w.location,
      severity: 'error'
    })));

    // Remove converted warnings
    warnings = warnings.filter(w => 
      !strictWarnings.find(sw => sw.code === w.code)
    );
  }
}

export default ContractValidator.getInstance();
