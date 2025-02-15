import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Optimizer } from './optimization';
import { logger } from '../../utils/logger';
import { MetricsService } from '../../services/monitoring/MetricsService';
import { ApiError } from '../../utils/errors';
import { ContractCache } from '../cache/ContractCache';
import { config } from '../../config';
import type { CompilationOptions, CompilationResult } from '../../types/contracts';

const execAsync = promisify(exec);
const metrics = MetricsService.getInstance();
const cache = ContractCache.getInstance();

export class CompilerService {
  private static instance: CompilerService;
  private optimizer: Optimizer;
  private readonly TEMP_DIR: string;
  private readonly CARGO_TEMPLATE: string;
  private readonly MAX_COMPILE_TIME = 300000; // 5 minutes
  private readonly COMPILER_VERSION = '1.75.0'; // Rust version

  private constructor() {
    this.optimizer = new Optimizer();
    this.TEMP_DIR = join(process.cwd(), 'temp', 'compile');
    this.CARGO_TEMPLATE = this.loadCargoTemplate();
  }

  public static getInstance(): CompilerService {
    if (!CompilerService.instance) {
      CompilerService.instance = new CompilerService();
    }
    return CompilerService.instance;
  }

  public async compile(
    sourceCode: string,
    options: CompilationOptions = {}
  ): Promise<CompilationResult> {
    const startTime = Date.now();
    const compilationId = randomUUID();

    try {
      // Check cache first
      if (!options.skipCache) {
        const cachedResult = await cache.getCompiledContract(sourceCode);
        if (cachedResult) {
          metrics.increment('compilation.cache_hit');
          return cachedResult;
        }
      }

      // Create temporary directory
      const workDir = join(this.TEMP_DIR, compilationId);
      await mkdir(workDir, { recursive: true });

      // Apply optimizations if enabled
      const optimizedCode = options.optimize
        ? await this.optimizer.optimize(sourceCode, {
            level: options.optimizationLevel || 'balanced',
            target: 'bpf',
          })
        : sourceCode;

      // Set up project structure
      await this.setupProject(workDir, optimizedCode);

      // Run compilation
      const { program, metadata } = await this.runCompilation(workDir, options);

      // Verify compilation result
      await this.verifyCompilation(program);

      const result: CompilationResult = {
        id: compilationId,
        program,
        metadata,
        optimized: options.optimize || false,
        timestamp: new Date().toISOString(),
        compilerVersion: this.COMPILER_VERSION,
        stats: {
          compilationTime: Date.now() - startTime,
          programSize: Buffer.from(program).length,
          optimizationLevel: options.optimizationLevel || 'none'
        }
      };

      // Cache successful compilation
      if (!options.skipCache) {
        await cache.setCompiledContract(sourceCode, result);
      }

      // Record metrics
      metrics.timing('compilation.duration', Date.now() - startTime);
      metrics.gauge('compilation.program_size', result.stats.programSize);
      metrics.increment('compilation.success');

      return result;

    } catch (error) {
      metrics.increment('compilation.error', {
        errorType: error instanceof ApiError ? error.code : 'UNKNOWN'
      });

      logger.error('Compilation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        compilationId
      });

      throw new ApiError(
        'COMPILATION_ERROR',
        'Failed to compile contract',
        { detail: error instanceof Error ? error.message : undefined }
      );
    }
  }

  private async setupProject(workDir: string, sourceCode: string): Promise<void> {
    // Write Cargo.toml
    const cargoToml = this.CARGO_TEMPLATE.replace(
      '{{program_name}}',
      'solana_program'
    );
    await writeFile(join(workDir, 'Cargo.toml'), cargoToml);

    // Create src directory and write program
    const srcDir = join(workDir, 'src');
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, 'lib.rs'), sourceCode);
  }

  private async runCompilation(
    workDir: string,
    options: CompilationOptions
  ): Promise<{ program: Buffer; metadata: any }> {
    const buildCommand = this.getBuildCommand(options);
    
    try {
      const { stdout, stderr } = await execAsync(buildCommand, {
        cwd: workDir,
        timeout: this.MAX_COMPILE_TIME,
        env: {
          ...process.env,
          RUSTFLAGS: this.getRustFlags(options),
          CARGO_TARGET_DIR: join(workDir, 'target')
        }
      });

      // Parse compilation output
      const metadata = this.parseCompilationOutput(stdout, stderr);

      // Read compiled program
      const program = await readFile(
        join(workDir, 'target', 'deploy', 'solana_program.so')
      );

      return { program, metadata };

    } catch (error) {
      throw new Error(
        `Compilation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async verifyCompilation(program: Buffer): Promise<void> {
    // Verify program size
    const MAX_PROGRAM_SIZE = 1024 * 1024; // 1MB
    if (program.length > MAX_PROGRAM_SIZE) {
      throw new ApiError(
        'PROGRAM_TOO_LARGE',
        'Compiled program exceeds maximum size'
      );
    }

    // Additional verification steps can be added here
  }

  private getBuildCommand(options: CompilationOptions): string {
    const cmd = ['cargo', 'build-bpf'];
    
    if (options.release) {
      cmd.push('--release');
    }

    if (options.features?.length) {
      cmd.push('--features', options.features.join(','));
    }

    return cmd.join(' ');
  }

  private getRustFlags(options: CompilationOptions): string {
    const flags = ['-C', 'link-arg=-zstack-size=32768'];

    if (options.optimize) {
      flags.push('-C', 'opt-level=3');
    }

    return flags.join(' ');
  }

  private parseCompilationOutput(stdout: string, stderr: string): any {
    // Parse relevant information from compilation output
    // This is a simplified version - expand based on needs
    return {
      warnings: stderr.split('\n').filter(line => line.includes('warning:')),
      buildInfo: stdout.split('\n').filter(line => line.includes('Finished'))
    };
  }

  private loadCargoTemplate(): string {
    return `
[package]
name = "{{program_name}}"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
solana-program = "1.17"
borsh = "0.10"
thiserror = "1.0"

[features]
no-entrypoint = []

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1
`;
  }
}

export default CompilerService.getInstance();
``` ▋
