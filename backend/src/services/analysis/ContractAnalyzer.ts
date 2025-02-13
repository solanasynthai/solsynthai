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
            'MISSING_VALIDATION
