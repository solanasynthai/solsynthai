import { Parser } from '@solidity-parser/parser';
import { MetricsService } from '../monitoring/MetricsService';
import { logger } from '../../utils/logger';
import { ApiError } from '../../utils/errors';
import type { OptimizationOptions, OptimizationResult } from '../../types/contracts';

const metrics = MetricsService.getInstance();

export class Optimizer {
  private static instance: Optimizer;
  
  // Optimization patterns for common code structures
  private readonly PATTERNS = {
    LOOP_INVARIANT: /for\s*\([^)]+\)\s*{([^}]+)}/g,
    REDUNDANT_COMPUTATION: /(\w+(?:\[\w+\])?)\s*=\s*([^;]+);.*\1\s*=\s*\2;/g,
    UNUSED_VARIABLE: /let\s+(\w+)\s*=\s*[^;]+;(?:(?!\1).)*$/gs,
    DEAD_CODE: /if\s*\(false\)|if\s*\(true\)\s*{([^}]+)}/g
  };

  private readonly OPTIMIZATION_LEVELS = {
    speed: {
      inlineThreshold: 50,
      loopUnrolling: true,
      constantFolding: true,
      deadCodeElimination: true,
      instructionReordering: true
    },
    size: {
      inlineThreshold: 20,
      loopUnrolling: false,
      constantFolding: true,
      deadCodeElimination: true,
      instructionReordering: false
    },
    balanced: {
      inlineThreshold: 35,
      loopUnrolling: true,
      constantFolding: true,
      deadCodeElimination: true,
      instructionReordering: true
    }
  };

  private constructor() {}

  public static getInstance(): Optimizer {
    if (!Optimizer.instance) {
      Optimizer.instance = new Optimizer();
    }
    return Optimizer.instance;
  }

  public async optimize(
    sourceCode: string,
    options: OptimizationOptions
  ): Promise<string> {
    const startTime = Date.now();
    const optimizationLevel = options.level || 'balanced';
    const settings = this.OPTIMIZATION_LEVELS[optimizationLevel];

    try {
      // Parse the source code
      const ast = Parser.parse(sourceCode, { tolerant: true });

      // Apply optimizations based on level
      let optimizedCode = sourceCode;
      const optimizations: OptimizationResult[] = [];

      // 1. Constant folding
      if (settings.constantFolding) {
        const constantFoldingResult = this.applyConstantFolding(optimizedCode);
        optimizedCode = constantFoldingResult.code;
        optimizations.push(constantFoldingResult.stats);
      }

      // 2. Dead code elimination
      if (settings.deadCodeElimination) {
        const deadCodeResult = this.eliminateDeadCode(optimizedCode);
        optimizedCode = deadCodeResult.code;
        optimizations.push(deadCodeResult.stats);
      }

      // 3. Loop optimizations
      if (settings.loopUnrolling) {
        const loopOptResult = this.optimizeLoops(optimizedCode, settings.inlineThreshold);
        optimizedCode = loopOptResult.code;
        optimizations.push(loopOptResult.stats);
      }

      // 4. Instruction reordering
      if (settings.instructionReordering) {
        const reorderResult = this.reorderInstructions(optimizedCode);
        optimizedCode = reorderResult.code;
        optimizations.push(reorderResult.stats);
      }

      // 5. BPF-specific optimizations
      const bpfOptResult = this.applyBPFOptimizations(optimizedCode, options.target === 'bpf');
      optimizedCode = bpfOptResult.code;
      optimizations.push(bpfOptResult.stats);

      // Record metrics
      metrics.timing('optimization.duration', Date.now() - startTime);
      metrics.gauge('optimization.size_reduction', 
        ((sourceCode.length - optimizedCode.length) / sourceCode.length) * 100
      );

      // Validate optimized code
      await this.validateOptimizedCode(optimizedCode);

      logger.info('Code optimization completed', {
        level: optimizationLevel,
        optimizations: optimizations.map(o => o.type),
        sizeReduction: `${((sourceCode.length - optimizedCode.length) / sourceCode.length * 100).toFixed(2)}%`
      });

      return optimizedCode;

    } catch (error) {
      metrics.increment('optimization.error', {
        level: optimizationLevel,
        errorType: error instanceof ApiError ? error.code : 'UNKNOWN'
      });

      logger.error('Optimization failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        level: optimizationLevel
      });

      throw new ApiError('OPTIMIZATION_ERROR', 'Failed to optimize contract code');
    }
  }

  private applyConstantFolding(code: string): { code: string; stats: OptimizationResult } {
    const constants: Map<string, string> = new Map();
    let optimizedCode = code;
    
    // Find and replace constant expressions
    const constantPattern = /const\s+(\w+)\s*=\s*([^;]+);/g;
    let match;
    
    while ((match = constantPattern.exec(code)) !== null) {
      const [_, name, value] = match;
      if (this.isConstantExpression(value)) {
        constants.set(name, this.evaluateConstantExpression(value));
      }
    }

    // Replace constant usage
    constants.forEach((value, name) => {
      const usage = new RegExp(`\\b${name}\\b`, 'g');
      optimizedCode = optimizedCode.replace(usage, value);
    });

    return {
      code: optimizedCode,
      stats: {
        type: 'constant_folding',
        replacements: constants.size,
        sizeReduction: code.length - optimizedCode.length
      }
    };
  }

  private eliminateDeadCode(code: string): { code: string; stats: OptimizationResult } {
    let optimizedCode = code;
    let replacements = 0;

    // Remove unreachable code
    Object.entries(this.PATTERNS).forEach(([type, pattern]) => {
      optimizedCode = optimizedCode.replace(pattern, (match, content) => {
        replacements++;
        return type === 'DEAD_CODE' && match.includes('if (true)') ? content : '';
      });
    });

    return {
      code: optimizedCode,
      stats: {
        type: 'dead_code_elimination',
        replacements,
        sizeReduction: code.length - optimizedCode.length
      }
    };
  }

  private optimizeLoops(
    code: string, 
    inlineThreshold: number
  ): { code: string; stats: OptimizationResult } {
    let optimizedCode = code;
    let optimizations = 0;

    // Unroll small loops
    optimizedCode = optimizedCode.replace(this.PATTERNS.LOOP_INVARIANT, (match, body) => {
      if (body.length <= inlineThreshold) {
        optimizations++;
        return this.unrollLoop(match, body);
      }
      return match;
    });

    return {
      code: optimizedCode,
      stats: {
        type: 'loop_optimization',
        replacements: optimizations,
        sizeReduction: code.length - optimizedCode.length
      }
    };
  }

  private reorderInstructions(code: string): { code: string; stats: OptimizationResult } {
    // Implement instruction reordering logic based on dependency graph
    // This is a simplified version - extend based on needs
    return {
      code,
      stats: {
        type: 'instruction_reordering',
        replacements: 0,
        sizeReduction: 0
      }
    };
  }

  private applyBPFOptimizations(
    code: string,
    isBPFTarget: boolean
  ): { code: string; stats: OptimizationResult } {
    if (!isBPFTarget) {
      return { code, stats: { type: 'bpf_optimization', replacements: 0, sizeReduction: 0 } };
    }

    let optimizedCode = code;
    let optimizations = 0;

    // BPF-specific optimizations
    const bpfOptimizations = [
      // Minimize stack usage
      { pattern: /let\s+mut\s+(\w+)/, replacement: 'let $1' },
      // Use BPF-friendly memory access patterns
      { pattern: /\.iter\(\)\.enumerate\(\)/, replacement: '.iter()' },
      // Optimize arithmetic operations
      { pattern: /(\w+)\s*\+=\s*1/, replacement: '$1 = $1.saturating_add(1)' }
    ];

    bpfOptimizations.forEach(({ pattern, replacement }) => {
      const newCode = optimizedCode.replace(pattern, replacement);
      if (newCode !== optimizedCode) {
        optimizations++;
        optimizedCode = newCode;
      }
    });

    return {
      code: optimizedCode,
      stats: {
        type: 'bpf_optimization',
        replacements: optimizations,
        sizeReduction: code.length - optimizedCode.length
      }
    };
  }

  private isConstantExpression(expr: string): boolean {
    try {
      // Check if expression can be evaluated at compile time
      new Function(`return ${expr}`)();
      return true;
    } catch {
      return false;
    }
  }

  private evaluateConstantExpression(expr: string): string {
    try {
      return new Function(`return ${expr}`)().toString();
    } catch {
      return expr;
    }
  }

  private unrollLoop(loop: string, body: string): string {
    // Simple loop unrolling - extend based on needs
    return body.repeat(4); // Unroll up to 4 iterations
  }

  private async validateOptimizedCode(code: string): Promise<void> {
    try {
      Parser.parse(code, { tolerant: true });
    } catch (error) {
      throw new ApiError(
        'INVALID_OPTIMIZATION',
        'Optimization resulted in invalid code',
        { detail: error instanceof Error ? error.message : undefined }
      );
    }
  }
}

export default Optimizer.getInstance();
