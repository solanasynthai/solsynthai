import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Redis } from 'ioredis';
import { createHash } from 'crypto';
import { logger } from '../../utils/logger';
import { MetricsService } from '../monitoring/MetricsService';
import { CompilationOptions, CompilationResult, OptimizationLevel } from '../../types/contracts';
import { ValidationError } from '../../utils/errors';
import { config } from '../../config';

const execAsync = promisify(exec);

export class ContractCompiler {
  private static instance: ContractCompiler;
  private redis: Redis;
  private readonly CACHE_PREFIX = 'compilation:';
  private readonly CACHE_TTL = 3600; // 1 hour
  private readonly TEMP_DIR = path.join(process.cwd(), 'temp');
  private readonly COMPILER_VERSION = '1.75.0'; // Latest stable Rust version

  private constructor() {
    this.redis = new Redis(config.redis.url);
    this.ensureTempDirectory();
  }

  public static getInstance(): ContractCompiler {
    if (!ContractCompiler.instance) {
      ContractCompiler.instance = new ContractCompiler();
    }
    return ContractCompiler.instance;
  }

  public async compile(
    sourceCode: string,
    options: CompilationOptions = {}
  ): Promise<CompilationResult> {
    const startTime = Date.now();
    try {
      // Generate source hash for caching
      const sourceHash = this.generateSourceHash(sourceCode);
      
      // Check cache if skipCache is not set
      if (!options.skipCache) {
        const cached = await this.getFromCache(sourceHash, options);
        if (cached) {
          MetricsService.increment('compilation.cache.hit');
          return cached;
        }
      }

      MetricsService.increment('compilation.cache.miss');

      // Validate source code
      this.validateSourceCode(sourceCode);

      // Create temporary directory for compilation
      const tempDir = await this.createTempDirectory();
      const sourceFile = path.join(tempDir, 'lib.rs');
      const cargoFile = path.join(tempDir, 'Cargo.toml');

      // Write source code and Cargo.toml
      await Promise.all([
        this.writeSourceFile(sourceFile, sourceCode),
        this.writeCargoFile(cargoFile, options)
      ]);

      // Set up compilation flags
      const flags = this.getCompilationFlags(options);

      // Compile the contract
      const { program, metadata } = await this.executeCompilation(tempDir, flags);

      // Calculate compilation statistics
      const stats = {
        compilationTime: Date.now() - startTime,
        programSize: program.length,
        optimizationLevel: options.optimizationLevel || 'none'
      };

      const result: CompilationResult = {
        id: sourceHash,
        program,
        metadata,
        optimized: !!options.optimize,
        timestamp: new Date().toISOString(),
        compilerVersion: this.COMPILER_VERSION,
        stats
      };

      // Cache the result
      await this.cacheResult(sourceHash, result, options);

      // Track metrics
      this.trackCompilationMetrics(result);

      return result;
    } catch (error) {
      logger.error('Compilation failed:', { error });
      throw this.handleCompilationError(error);
    }
  }

  private async getFromCache(
    sourceHash: string,
    options: CompilationOptions
  ): Promise<CompilationResult | null> {
    const cacheKey = this.getCacheKey(sourceHash, options);
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (error) {
        logger.warn('Cache parsing failed:', { error });
        await this.redis.del(cacheKey);
      }
    }
    
    return null;
  }

  private async cacheResult(
    sourceHash: string,
    result: CompilationResult,
    options: CompilationOptions
  ): Promise<void> {
    const cacheKey = this.getCacheKey(sourceHash, options);
    await this.redis.setex(
      cacheKey,
      this.CACHE_TTL,
      JSON.stringify(result)
    );
  }

  private getCacheKey(sourceHash: string, options: CompilationOptions): string {
    const optionsHash = createHash('sha256')
      .update(JSON.stringify(options))
      .digest('hex');
    return `${this.CACHE_PREFIX}${sourceHash}:${optionsHash}`;
  }

  private generateSourceHash(sourceCode: string): string {
    return createHash('sha256')
      .update(sourceCode)
      .digest('hex');
  }

  private validateSourceCode(sourceCode: string): void {
    if (!sourceCode || sourceCode.trim().length === 0) {
      throw new ValidationError('Source code cannot be empty');
    }

    if (sourceCode.length > config.compiler.maxSize) {
      throw new ValidationError(`Source code exceeds maximum size of ${config.compiler.maxSize} bytes`);
    }

    // Basic syntax validation
    if (!this.hasValidSyntax(sourceCode)) {
      throw new ValidationError('Source code contains invalid syntax');
    }
  }

  private hasValidSyntax(sourceCode: string): boolean {
    // Basic Rust syntax validation
    const basicChecks = [
      /^\s*(?:pub\s+)?(?:mod|fn|struct|enum|trait|impl|use)\s+/m, // Valid Rust constructs
      /\{[\s\S]*\}/m, // Balanced braces
      /#!\[.*\]/m // Attribute syntax
    ];

    return basicChecks.some(pattern => pattern.test(sourceCode));
  }

  private async createTempDirectory(): Promise<string> {
    const tempDir = path.join(
      this.TEMP_DIR,
      `compilation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    );
    await fs.mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  private async writeSourceFile(filePath: string, sourceCode: string): Promise<void> {
    await fs.writeFile(filePath, sourceCode, 'utf8');
  }

  private async writeCargoFile(filePath: string, options: CompilationOptions): Promise<void> {
    const cargoToml = this.generateCargoToml(options);
    await fs.writeFile(filePath, cargoToml, 'utf8');
  }

  private generateCargoToml(options: CompilationOptions): string {
    return `[package]
name = "solana-contract"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
solana-program = "1.16"
borsh = "0.10"
thiserror = "1.0"
${options.features?.map(feature => `${feature} = "*"`).join('\n') || ''}

[profile.release]
opt-level = ${this.getOptLevel(options.optimizationLevel)}
overflow-checks = true
lto = true
`;
  }

  private getOptLevel(level?: OptimizationLevel): number {
    switch (level) {
      case 'speed':
        return 3;
      case 'size':
        return 'z' as any;
      case 'balanced':
        return 2;
      default:
        return 1;
    }
  }

  private getCompilationFlags(options: CompilationOptions): string[] {
    const flags = ['--release'];

    if (options.optimize) {
      flags.push('--target-cpu=native');
      flags.push('--cfg=feature="optimization"');
    }

    if (options.features?.length) {
      flags.push(`--features="${options.features.join(' ')}"`);
    }

    return flags;
  }

  private async executeCompilation(
    tempDir: string,
    flags: string[]
  ): Promise<{ program: Buffer; metadata: any }> {
    try {
      const { stdout, stderr } = await execAsync(
        `cd "${tempDir}" && cargo build ${flags.join(' ')}`,
        {
          timeout: config.compiler.timeout,
          maxBuffer: 10 * 1024 * 1024 // 10MB
        }
      );

      const programPath = path.join(tempDir, 'target/release/libsolana_contract.so');
      const program = await fs.readFile(programPath);
      
      // Extract metadata from stdout/stderr
      const metadata = this.extractMetadata(stdout, stderr);

      return { program, metadata };
    } finally {
      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private extractMetadata(stdout: string, stderr: string): any {
    return {
      warnings: this.extractWarnings(stderr),
      optimizations: this.extractOptimizations(stdout),
      timestamp: new Date().toISOString()
    };
  }

  private extractWarnings(stderr: string): string[] {
    return stderr
      .split('\n')
      .filter(line => line.includes('warning:'))
      .map(line => line.trim());
  }

  private extractOptimizations(stdout: string): string[] {
    return stdout
      .split('\n')
      .filter(line => line.includes('Optimizing'))
      .map(line => line.trim());
  }

  private handleCompilationError(error: any): Error {
    if (error instanceof ValidationError) {
      return error;
    }

    if (error.code === 'ETIMEDOUT') {
      return new Error('Compilation timed out');
    }

    if (error.stderr?.includes('error:')) {
      const errorMessage = error.stderr
        .split('\n')
        .find((line: string) => line.includes('error:'))
        ?.trim();
      return new Error(errorMessage || 'Compilation failed');
    }

    return new Error('Unknown compilation error occurred');
  }

  private trackCompilationMetrics(result: CompilationResult): void {
    MetricsService.timing('compilation.duration', result.stats.compilationTime);
    MetricsService.gauge('compilation.program_size', result.stats.programSize);
    MetricsService.increment('compilation.total');
    
    if (result.optimized) {
      MetricsService.increment('compilation.optimized');
    }
  }

  private async ensureTempDirectory(): Promise<void> {
    try {
      await fs.access(this.TEMP_DIR);
    } catch {
      await fs.mkdir(this.TEMP_DIR, { recursive: true });
    }
  }
}

export default ContractCompiler.getInstance();
