import { EventEmitter } from 'events';
import { SecurityAnalyzer } from '../security/analyzers/SecurityAnalyzer';
import { StaticAnalyzer } from '../security/analyzers/StaticAnalyzer';
import { DataFlowAnalyzer } from '../security/utils/DataFlowAnalyzer';
import { CFGBuilder } from '../security/utils/CFGBuilder';
import { ReentrancyAnalyzer } from '../security/specialized/ReentrancyAnalyzer';
import { RustFormatter } from '../generation/rust/utils/RustFormatter';
import { ValidationError, ValidationErrorType } from '../types';
import { logger } from '../../utils/logger';

interface AnalysisOptions {
    validateSyntax?: boolean;
    validateSecurity?: boolean;
    validateCompatibility?: boolean;
    securityLevel?: 'basic' | 'standard' | 'high';
    includeMetrics?: boolean;
    deepAnalysis?: boolean;
}

interface AnalysisResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
    metrics?: CodeMetrics;
    securityScore?: number;
    suggestions?: Suggestion[];
}

interface CodeMetrics {
    complexity: {
        cyclomatic: number;
        cognitive: number;
        halstead: HalsteadMetrics;
    };
    maintainability: {
        score: number;
        issues: string[];
    };
    size: {
        loc: number;
        sloc: number;
        comments: number;
        functions: number;
        structs: number;
    };
    documentation: {
        coverage: number;
        quality: number;
    };
}

interface HalsteadMetrics {
    volume: number;
    difficulty: number;
    effort: number;
    time: number;
    bugs: number;
}

interface Suggestion {
    type: 'security' | 'performance' | 'style' | 'compatibility';
    priority: 'high' | 'medium' | 'low';
    message: string;
    line?: number;
    recommendation: string;
}

export class ContractAnalyzer extends EventEmitter {
    private securityAnalyzer: SecurityAnalyzer;
    private staticAnalyzer: StaticAnalyzer;
    private dataFlowAnalyzer: DataFlowAnalyzer;
    private cfgBuilder: CFGBuilder;
    private reentrancyAnalyzer: ReentrancyAnalyzer;
    private formatter: RustFormatter;

    constructor() {
        super();
        this.securityAnalyzer = new SecurityAnalyzer();
        this.staticAnalyzer = new StaticAnalyzer();
        this.dataFlowAnalyzer = new DataFlowAnalyzer();
        this.cfgBuilder = new CFGBuilder();
        this.reentrancyAnalyzer = new ReentrancyAnalyzer();
        this.formatter = new RustFormatter();
    }

    public async analyzeCode(
        code: string,
        options: AnalysisOptions = {}
    ): Promise<AnalysisResult> {
        const startTime = Date.now();
        const result: AnalysisResult = {
            isValid: false,
            errors: [],
            warnings: []
        };

        try {
            // Format code for consistent analysis
            const formattedCode = this.formatter.format(code);

            // Build Control Flow Graph
            const cfg = this.cfgBuilder.buildFromCode(formattedCode);

            // Perform syntax validation
            if (options.validateSyntax) {
                const syntaxErrors = await this.validateSyntax(formattedCode);
                result.errors.push(...syntaxErrors);
            }

            // Perform security analysis
            if (options.validateSecurity) {
                const securityResult = await this.securityAnalyzer.analyzeContract(
                    formattedCode,
                    {
                        level: options.securityLevel || 'standard',
                        cfg
                    }
                );

                result.errors.push(...securityResult.criticalIssues);
                result.warnings.push(...securityResult.warnings);
                result.securityScore = securityResult.score;
            }

            // Check for reentrancy vulnerabilities
            const reentrancyIssues = await this.reentrancyAnalyzer.analyze(cfg);
            result.errors.push(...reentrancyIssues);

            // Perform data flow analysis
            const dataFlowIssues = await this.dataFlowAnalyzer.analyze(cfg);
            result.warnings.push(...dataFlowIssues);

            // Generate code metrics if requested
            if (options.includeMetrics) {
                result.metrics = await this.generateCodeMetrics(formattedCode, cfg);
            }

            // Deep analysis if requested
            if (options.deepAnalysis) {
                const deepAnalysisIssues = await this.performDeepAnalysis(formattedCode, cfg);
                result.warnings.push(...deepAnalysisIssues);
            }

            // Check compatibility
            if (options.validateCompatibility) {
                const compatibilityIssues = await this.checkCompatibility(formattedCode);
                result.warnings.push(...compatibilityIssues);
            }

            // Generate optimization suggestions
            result.suggestions = await this.generateSuggestions(
                formattedCode,
                result.errors,
                result.warnings,
                result.metrics
            );

            // Update final validity
            result.isValid = result.errors.length === 0;

            this.emit('analysis:complete', {
                duration: Date.now() - startTime,
                isValid: result.isValid,
                errorCount: result.errors.length,
                warningCount: result.warnings.length
            });

            return result;

        } catch (error) {
            logger.error('Contract analysis failed', {
                error: error.message,
                stack: error.stack
            });

            this.emit('analysis:error', {
                error: error.message,
                duration: Date.now() - startTime
            });

            throw error;
        }
    }

    private async validateSyntax(code: string): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];
        
        try {
            // Tokenize code
            const tokens = this.tokenizeCode(code);
            
            // Check syntax
            let lineNumber = 1;
            let inComment = false;
            let braceStack: string[] = [];
            let parenStack: string[] = [];
            
            for (const token of tokens) {
                if (token.type === 'NEWLINE') {
                    lineNumber++;
                    continue;
                }

                // Handle comments
                if (token.type === 'COMMENT_START') {
                    inComment = true;
                    continue;
                }
                if (token.type === 'COMMENT_END') {
                    inComment = false;
                    continue;
                }
                if (inComment) continue;

                // Check braces and parentheses
                if (token.value === '{') braceStack.push('{');
                if (token.value === '}') {
                    if (braceStack.length === 0) {
                        errors.push({
                            line: lineNumber,
                            column: token.column,
                            message: 'Unexpected closing brace',
                            severity: 'error'
                        });
                    }
                    braceStack.pop();
                }

                if (token.value === '(') parenStack.push('(');
                if (token.value === ')') {
                    if (parenStack.length === 0) {
                        errors.push({
                            line: lineNumber,
                            column: token.column,
                            message: 'Unexpected closing parenthesis',
                            severity: 'error'
                        });
                    }
                    parenStack.pop();
                }
            }

            // Check for unclosed braces/parentheses
            if (braceStack.length > 0) {
                errors.push({
                    line: lineNumber,
                    column: 0,
                    message: `Unclosed braces: ${braceStack.length}`,
                    severity: 'error'
                });
            }

            if (parenStack.length > 0) {
                errors.push({
                    line: lineNumber,
                    column: 0,
                    message: `Unclosed parentheses: ${parenStack.length}`,
                    severity: 'error'
                });
            }

        } catch (error) {
            errors.push({
                line: 0,
                column: 0,
                message: `Syntax validation failed: ${error.message}`,
                severity: 'error'
            });
        }

        return errors;
    }

    private async generateCodeMetrics(
        code: string,
        cfg: any
    ): Promise<CodeMetrics> {
        const metrics: CodeMetrics = {
            complexity: {
                cyclomatic: this.calculateCyclomaticComplexity(cfg),
                cognitive: this.calculateCognitiveComplexity(cfg),
                halstead: this.calculateHalsteadMetrics(code)
            },
            maintainability: {
                score: 0,
                issues: []
            },
            size: {
                loc: this.countLines(code),
                sloc: this.countSourceLines(code),
                comments: this.countComments(code),
                functions: this.countFunctions(code),
                structs: this.countStructs(code)
            },
            documentation: {
                coverage: this.calculateDocumentationCoverage(code),
                quality: this.assessDocumentationQuality(code)
            }
        };

        // Calculate maintainability score
        metrics.maintainability = this.calculateMaintainabilityScore(metrics);

        return metrics;
    }

    private calculateCyclomaticComplexity(cfg: any): number {
        const edges = cfg.getEdgeCount();
        const nodes = cfg.getNodeCount();
        const connectedComponents = cfg.getConnectedComponents().length;
        return edges - nodes + 2 * connectedComponents;
    }

    private calculateCognitiveComplexity(cfg: any): number {
        let complexity = 0;
        const visited = new Set();

        const calculateNodeComplexity = (node: any, depth: number) => {
            if (visited.has(node)) return;
            visited.add(node);

            // Add complexity for nesting
            complexity += depth;

            // Add complexity for logical operators
            complexity += node.logicalOperators?.length || 0;

            // Add complexity for loops and conditionals
            if (node.type === 'loop') complexity += 1;
            if (node.type === 'if') complexity += 1;
            if (node.type === 'switch') complexity += 1;

            // Recursively process child nodes
            for (const child of node.getChildren()) {
                calculateNodeComplexity(child, depth + 1);
            }
        };

        calculateNodeComplexity(cfg.getRoot(), 0);
        return complexity;
    }

    private calculateHalsteadMetrics(code: string): HalsteadMetrics {
        const operators = new Set();
        const operands = new Set();
        let totalOperators = 0;
        let totalOperands = 0;

        // Count operators and operands
        const tokens = this.tokenizeCode(code);
        for (const token of tokens) {
            if (token.type === 'OPERATOR') {
                operators.add(token.value);
                totalOperators++;
            } else if (token.type === 'IDENTIFIER' || token.type === 'LITERAL') {
                operands.add(token.value);
                totalOperands++;
            }
        }

        const n1 = operators.size;
        const n2 = operands.size;
        const N1 = totalOperators;
        const N2 = totalOperands;

        const vocabulary = n1 + n2;
        const length = N1 + N2;
        const volume = length * Math.log2(vocabulary);
        const difficulty = (n1 / 2) * (N2 / n2);
        const effort = difficulty * volume;
        const time = effort / 18;
        const bugs = volume / 3000;

        return {
            volume,
            difficulty,
            effort,
            time,
            bugs
        };
    }

    private calculateMaintainabilityScore(metrics: CodeMetrics): {
        score: number;
        issues: string[];
    } {
        const issues: string[] = [];
        let score = 100;

        // Penalize high complexity
        if (metrics.complexity.cyclomatic > 10) {
            score -= 10;
            issues.push('High cyclomatic complexity');
        }

        if (metrics.complexity.cognitive > 15) {
            score -= 10;
            issues.push('High cognitive complexity');
        }

        // Penalize low documentation
        if (metrics.documentation.coverage < 0.7) {
            score -= 15;
            issues.push('Insufficient documentation coverage');
        }

        if (metrics.documentation.quality < 0.6) {
            score -= 10;
            issues.push('Poor documentation quality');
        }

        // Penalize large functions/files
        if (metrics.size.sloc > 500) {
            score -= 10;
            issues.push('File is too large');
        }

        return { score, issues };
    }

    private async generateSuggestions(
        code: string,
        errors: ValidationError[],
        warnings: ValidationError[],
        metrics?: CodeMetrics
    ): Promise<Suggestion[]> {
        const suggestions: Suggestion[] = [];

        // Add suggestions based on errors
        for (const error of errors) {
            if (error.severity === 'error') {
                suggestions.push({
                    type: 'security',
                    priority: 'high',
                    message: `Critical issue: ${error.message}`,
                    line: error.line,
                    recommendation: this.generateRecommendation(error)
                });
            }
        }

        // Add suggestions based on metrics
        if (metrics) {
            if (metrics.complexity.cyclomatic > 10) {
                suggestions.push({
                    type: 'performance',
                    priority: 'medium',
                    message: 'High cyclomatic complexity detected',
                    recommendation: 'Consider breaking down complex functions into smaller, more manageable pieces'
                });
            }

            if (metrics.documentation.coverage < 0.7) {
                suggestions.push({
                    type: 'style',
                    priority: 'medium',
                    message: 'Low documentation coverage',
                    recommendation: 'Add documentation to improve code maintainability'
                });
            }
        }

        // Add suggestions based on warnings
        for (const warning of warnings) {
            suggestions.push({
                type: 'compatibility',
                priority: 'low',
                message: warning.message,
                line: warning.line,
                recommendation: this.generateRecommendation(warning)
            });
        }

        return suggestions;
    }

    private generateRecommendation(issue: ValidationError): string {
        const recommendations: Record<string, string> = {
            'REENTRANCY': 'Implement a reentrancy guard using mutex patterns',
            'UNCHECKED_MATH': 'Use checked math operations or explicit overflow checks',
            'UNPROTECTED_UPDATE': 'Add access control checks to state-modifying functions',
            'MISSING_VALIDATION': 'Implement comprehensive input validation',
            'TIMESTAMP_DEPENDENCE': 'Use block numbers instead of timestamps for time-sensitive operations',
            'FLOATING_PRAGMA': 'Lock the compiler version to ensure consistent behavior',
            'DOS_LOOP': 'Implement proper bounds and gas checks for loops',
            'UNSAFE_CASTING': 'Use safe casting operations with explicit checks',
            'MISSING_EVENTS': 'Add events for important state changes',
            'HARDCODED_ADDRESS': 'Make addresses configurable through constructor or admin functions',
            'WEAK_ACCESS': 'Implement strong access control mechanisms',
            'MISSING_ZERO_CHECK': 'Add zero address validation',
            'UNINITIALIZED_STATE': 'Ensure proper initialization of state variables',
            'UNSAFE_DELEGATECALL': 'Avoid delegatecall or implement strict safety checks',
            'VARIABLE_SHADOWING': 'Rename variables to avoid shadowing',
            'MISSING_MODIFIER': 'Add appropriate modifiers for access control',
            'INSUFFICIENT_GAS': 'Optimize gas usage or implement batching',
            'LOCKED_ETHER': 'Implement withdrawal patterns',
            'ARBITRARY_JUMP': 'Remove dynamic jumps or implement strict validation',
            'STATE_DEPENDENCY': 'Implement proper state synchronization',
            'WEAK_RANDOMNESS': 'Use verifiable random functions (VRF) for randomness',
            'FRONT_RUNNING': 'Implement commit-reveal patterns or other front-running protections',
            'OVERFLOW_UNDERFLOW': 'Use SafeMath or checked arithmetic operations',
            'RACE_CONDITION': 'Implement proper synchronization mechanisms',
            'DOS_GAS_LIMIT': 'Implement gas-efficient patterns and avoid unbounded operations'
        };

        const defaultRecommendation = 'Review and refactor the code according to best practices';
        return recommendations[issue.errorType] || defaultRecommendation;
    }

    private tokenizeCode(code: string): Array<{ type: string; value: string; line: number; column: number }> {
        const tokens: Array<{ type: string; value: string; line: number; column: number }> = [];
        let line = 1;
        let column = 0;
        let i = 0;

        while (i < code.length) {
            let char = code[i];

            // Track line and column
            if (char === '\n') {
                line++;
                column = 0;
                tokens.push({ type: 'NEWLINE', value: '\n', line, column });
                i++;
                continue;
            }
            column++;

            // Skip whitespace
            if (/\s/.test(char)) {
                i++;
                continue;
            }

            // Handle comments
            if (char === '/' && code[i + 1] === '/') {
                tokens.push({ type: 'COMMENT_START', value: '//', line, column });
                i += 2;
                while (i < code.length && code[i] !== '\n') i++;
                tokens.push({ type: 'COMMENT_END', value: '', line, column });
                continue;
            }

            if (char === '/' && code[i + 1] === '*') {
                tokens.push({ type: 'COMMENT_START', value: '/*', line, column });
                i += 2;
                while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
                    if (code[i] === '\n') {
                        line++;
                        column = 0;
                    }
                    i++;
                }
                i += 2;
                tokens.push({ type: 'COMMENT_END', value: '*/', line, column });
                continue;
            }

            // Handle string literals
            if (char === '"' || char === "'") {
                let value = char;
                const quote = char;
                i++;
                column++;
                while (i < code.length && code[i] !== quote) {
                    if (code[i] === '\\' && i + 1 < code.length) {
                        value += code[i] + code[i + 1];
                        i += 2;
                        column += 2;
                    } else {
                        value += code[i];
                        i++;
                        column++;
                    }
                }
                value += code[i];
                tokens.push({ type: 'LITERAL', value, line, column });
                i++;
                continue;
            }

            // Handle numbers
            if (/\d/.test(char)) {
                let value = '';
                while (i < code.length && /[\d.]/.test(code[i])) {
                    value += code[i];
                    i++;
                    column++;
                }
                tokens.push({ type: 'LITERAL', value, line, column });
                continue;
            }

            // Handle identifiers
            if (/[a-zA-Z_]/.test(char)) {
                let value = '';
                while (i < code.length && /[a-zA-Z0-9_]/.test(code[i])) {
                    value += code[i];
                    i++;
                    column++;
                }
                tokens.push({ type: 'IDENTIFIER', value, line, column });
                continue;
            }

            // Handle operators
            const operators = ['==', '!=', '>=', '<=', '=>', '+=', '-=', '*=', '/=', '++', '--'];
            const twoCharOp = code.slice(i, i + 2);
            if (operators.includes(twoCharOp)) {
                tokens.push({ type: 'OPERATOR', value: twoCharOp, line, column });
                i += 2;
                column += 2;
                continue;
            }

            // Handle single-char operators and punctuation
            const singleCharOps = '+-*/%=<>!&|^~?:.,;{}[]()';
            if (singleCharOps.includes(char)) {
                tokens.push({ type: 'OPERATOR', value: char, line, column });
                i++;
                continue;
            }

            // Skip unknown characters
            i++;
        }

        return tokens;
    }

    private async checkCompatibility(code: string): Promise<ValidationError[]> {
        const warnings: ValidationError[] = [];
        const tokens = this.tokenizeCode(code);
        
        // Check for deprecated features
        const deprecatedFeatures = new Map([
            ['syscall', 'Use cross-program invocation (CPI) instead of syscalls'],
            ['declare_id!', 'Consider using more recent program ID declaration patterns']
        ]);

        let line = 1;
        for (const token of tokens) {
            if (token.type === 'IDENTIFIER') {
                if (deprecatedFeatures.has(token.value)) {
                    warnings.push({
                        line: token.line,
                        column: token.column,
                        message: `Deprecated feature: ${deprecatedFeatures.get(token.value)}`,
                        severity: 'warning'
                    });
                }
            }
            if (token.type === 'NEWLINE') line++;
        }

        return warnings;
    }

    private async performDeepAnalysis(code: string, cfg: any): Promise<ValidationError[]> {
        const warnings: ValidationError[] = [];

        // Perform data flow analysis
        const dataFlowResults = await this.dataFlowAnalyzer.analyze(cfg);
        warnings.push(...dataFlowResults);

        // Check for common anti-patterns
        const antiPatterns = await this.detectAntiPatterns(code);
        warnings.push(...antiPatterns);

        // Check for potential optimization opportunities
        const optimizationOpportunities = await this.findOptimizationOpportunities(code, cfg);
        warnings.push(...optimizationOpportunities);

        return warnings;
    }

    private countLines(code: string): number {
        return code.split('\n').length;
    }

    private countSourceLines(code: string): number {
        return code.split('\n')
            .filter(line => line.trim() && !line.trim().startsWith('//'))
            .length;
    }

    private countComments(code: string): number {
        return code.split('\n')
            .filter(line => line.trim().startsWith('//') || line.trim().startsWith('/*'))
            .length;
    }

    private countFunctions(code: string): number {
        const functionMatches = code.match(/fn\s+\w+\s*\(/g);
        return functionMatches ? functionMatches.length : 0;
    }

    private countStructs(code: string): number {
        const structMatches = code.match(/struct\s+\w+/g);
        return structMatches ? structMatches.length : 0;
    }

    private calculateDocumentationCoverage(code: string): number {
        const functions = code.match(/fn\s+\w+\s*\(/g) || [];
        const documentedFunctions = code.match(/\/\/\/.*\s*fn\s+\w+\s*\(/g) || [];
        return functions.length > 0 ? documentedFunctions.length / functions.length : 1;
    }

    private assessDocumentationQuality(code: string): number {
        const docComments = code.match(/\/\/\/[^\n]+/g) || [];
        let totalScore = 0;

        for (const comment of docComments) {
            let score = 0;
            // Check for parameter documentation
            if (comment.includes('@param')) score += 0.3;
            // Check for return value documentation
            if (comment.includes('@return')) score += 0.3;
            // Check for description length
            if (comment.length > 50) score += 0.2;
            // Check for examples
            if (comment.includes('@example')) score += 0.2;
            totalScore += score;
        }

        return docComments.length > 0 ? totalScore / docComments.length : 0;
    }

    private async detectAntiPatterns(code: string): Promise<ValidationError[]> {
        const warnings: ValidationError[] = [];
        const tokens = this.tokenizeCode(code);

        // Check for large functions
        let currentFunctionLines = 0;
        let inFunction = false;
        let functionStartLine = 0;

        for (const token of tokens) {
            if (token.type === 'IDENTIFIER' && token.value === 'fn') {
                inFunction = true;
                functionStartLine = token.line;
            } else if (token.type === 'OPERATOR' && token.value === '}' && inFunction) {
                if (currentFunctionLines > 50) {
                    warnings.push({
                        line: functionStartLine,
                        column: 0,
                        message: 'Function is too large (> 50 lines)',
                        severity: 'warning'
                    });
                }
                inFunction = false;
                currentFunctionLines = 0;
            } else if (token.type === 'NEWLINE' && inFunction) {
                currentFunctionLines++;
            }
        }

        return warnings;
    }

    private async findOptimizationOpportunities(code: string, cfg: any): Promise<ValidationError[]> {
        const warnings: ValidationError[] = [];

        // Check for expensive operations in loops
        const loops = cfg.findLoops();
        for (const loop of loops) {
            const expensiveOps = this.findExpensiveOperations(loop);
            if (expensiveOps.length > 0) {
                warnings.push({
                    line: loop.startLine,
                    column: 0,
                    message: `Expensive operation(s) in loop: ${expensiveOps.join(', ')}`,
                    severity: 'warning'
                });
            }
        }

        return warnings;
    }

    private findExpensiveOperations(node: any): string[] {
        const expensive: string[] = [];
        const expensivePatterns = [
            { pattern: /clone/, description: 'cloning' },
            { pattern: /to_string/, description: 'string conversion' },
            { pattern: /serialize/, description: 'serialization' },
            { pattern: /deserialize/, description: 'deserialization' },
            { pattern: /allocate/, description: 'memory allocation' }
        ];

        const nodeText = node.getText();
        for (const { pattern, description } of expensivePatterns) {
            if (pattern.test(nodeText)) {
                expensive.push(description);
            }
        }

        return expensive;
    }

    public async cleanup(): Promise<void> {
        this.removeAllListeners();
    }
}
