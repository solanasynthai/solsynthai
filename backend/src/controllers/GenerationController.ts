import { Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { AIGenerationService } from '../services/ai/AIGenerationService';
import { CodeOptimizer } from '../services/optimization/CodeOptimizer';
import { ContractAnalyzer } from '../services/analysis/ContractAnalyzer';
import { SchemaGenerator } from '../services/generation/SchemaGenerator';
import { ContractError, AIServiceError } from '../utils/errors';
import { logger } from '../utils/logger';
import config from '../config/config';

export class GenerationController {
    private aiService: AIGenerationService;
    private optimizer: CodeOptimizer;
    private analyzer: ContractAnalyzer;
    private schemaGenerator: SchemaGenerator;

    constructor() {
        this.aiService = new AIGenerationService(config.ai.openaiApiKey);
        this.optimizer = new CodeOptimizer();
        this.analyzer = new ContractAnalyzer();
        this.schemaGenerator = new SchemaGenerator();
    }

    public generateContract = async (req: Request, res: Response): Promise<void> => {
        const { description, template, options } = req.body;
        const requestId = req.id;

        try {
            // Generate initial prompt
            const prompt = await this.aiService.createGenerationPrompt(
                description,
                template,
                options
            );

            // Generate contract code
            const generation = await this.aiService.generateContractCode(
                prompt,
                {
                    maxTokens: config.ai.maxTokens,
                    temperature: options?.temperature || 0.7,
                    model: config.ai.model,
                    requestId
                }
            );

            // Validate generated code
            const validationResult = await this.analyzer.validateGeneratedCode(
                generation.code,
                {
                    validateSyntax: true,
                    validateSecurity: true,
                    validateCompatibility: true
                }
            );

            if (!validationResult.isValid) {
                // Attempt to fix issues
                const fixedCode = await this.aiService.fixCodeIssues(
                    generation.code,
                    validationResult.errors
                );

                // Revalidate fixed code
                const revalidation = await this.analyzer.validateGeneratedCode(
                    fixedCode,
                    {
                        validateSyntax: true,
                        validateSecurity: true,
                        validateCompatibility: true
                    }
                );

                if (!revalidation.isValid) {
                    throw new ContractError('Generated code validation failed', {
                        errors: revalidation.errors
                    });
                }

                generation.code = fixedCode;
            }

            // Generate schema
            const schema = await this.schemaGenerator.generateFromCode(
                generation.code,
                {
                    includeMetadata: true,
                    validateSchema: true
                }
            );

            // Optimize the code
            const optimizedCode = await this.optimizer.optimize(generation.code, {
                level: options?.optimizationLevel || 'standard',
                target: 'solana'
            });

            logger.info('Contract generation completed', {
                requestId,
                template: template || 'custom',
                optimizations: optimizedCode.optimizations.length,
                schema: schema.name
            });

            res.json({
                success: true,
                data: {
                    code: optimizedCode.code,
                    schema: schema,
                    metrics: {
                        complexity: optimizedCode.metrics.complexity,
                        size: optimizedCode.metrics.size,
                        efficiency: optimizedCode.metrics.efficiency
                    },
                    optimizations: optimizedCode.optimizations,
                    warnings: validationResult.warnings,
                    generationMetadata: {
                        model: generation.model,
                        timestamp: generation.timestamp,
                        requestId: generation.requestId
                    }
                }
            });
        } catch (error) {
            logger.error('Contract generation failed', {
                requestId,
                template: template || 'custom',
                error: error.message,
                stack: error.stack
            });

            if (error.isAxiosError) {
                throw new AIServiceError('AI service unavailable', {
                    status: error.response?.status,
                    data: error.response?.data
                });
            }
            throw error;
        }
    };

    public optimizeContract = async (req: Request, res: Response): Promise<void> => {
        const { code, options } = req.body;
        const requestId = req.id;

        try {
            // Analyze code before optimization
            const preAnalysis = await this.analyzer.analyzeCode(code);

            // Perform optimization
            const optimizedCode = await this.optimizer.optimize(code, {
                level: options?.level || 'standard',
                target: 'solana',
                preserveSemantics: true,
                ...options
            });

            // Analyze optimized code
            const postAnalysis = await this.analyzer.analyzeCode(optimizedCode.code);

            // Calculate improvement metrics
            const improvements = {
                size: preAnalysis.metrics.size - postAnalysis.metrics.size,
                complexity: preAnalysis.metrics.complexity - postAnalysis.metrics.complexity,
                efficiency: postAnalysis.metrics.efficiency - preAnalysis.metrics.efficiency
            };

            logger.info('Contract optimization completed', {
                requestId,
                improvements,
                optimizations: optimizedCode.optimizations.length
            });

            res.json({
                success: true,
                data: {
                    code: optimizedCode.code,
                    optimizations: optimizedCode.optimizations,
                    metrics: {
                        original: preAnalysis.metrics,
                        optimized: postAnalysis.metrics,
                        improvements
                    },
                    warnings: optimizedCode.warnings
                }
            });
        } catch (error) {
            logger.error('Contract optimization failed', {
                requestId,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    };

    public analyzeContract = async (req: Request, res: Response): Promise<void> => {
        const { code, options } = req.body;
        const requestId = req.id;

        try {
            // Perform comprehensive analysis
            const analysis = await this.analyzer.analyzeCode(code, {
                analyzeSecurity: true,
                analyzePerformance: true,
                analyzeQuality: true,
                ...options
            });

            // Generate improvement suggestions
            const suggestions = await this.analyzer.generateSuggestions(
                analysis,
                {
                    maxSuggestions: options?.maxSuggestions || 5,
                    priorityThreshold: options?.priorityThreshold || 'medium'
                }
            );

            logger.info('Contract analysis completed', {
                requestId,
                issues: {
                    security: analysis.security.issues.length,
                    performance: analysis.performance.issues.length,
                    quality: analysis.quality.issues.length
                }
            });

            res.json({
                success: true,
                data: {
                    metrics: {
                        security: analysis.security.score,
                        performance: analysis.performance.score,
                        quality: analysis.quality.score,
                        overall: analysis.overallScore
                    },
                    issues: {
                        security: analysis.security.issues,
                        performance: analysis.performance.issues,
                        quality: analysis.quality.issues
                    },
                    suggestions: suggestions,
                    complexity: {
                        cognitive: analysis.complexity.cognitive,
                        cyclomatic: analysis.complexity.cyclomatic,
                        halstead: analysis.complexity.halstead
                    },
                    coverage: {
                        statements: analysis.coverage.statements,
                        branches: analysis.coverage.branches,
                        functions: analysis.coverage.functions,
                        lines: analysis.coverage.lines
                    }
                }
            });
        } catch (error) {
            logger.error('Contract analysis failed', {
                requestId,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    };
}
