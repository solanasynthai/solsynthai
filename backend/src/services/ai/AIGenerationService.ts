import OpenAI from 'openai';
import { EventEmitter } from 'events';
import { ContractTemplate } from '../../types';
import { TemplateEngine } from '../generation/template/TemplateEngine';
import { SecurityPatternGenerator } from '../generation/rust/security/SecurityPatternGenerator';
import { RustCodeGenerator } from '../generation/rust/RustCodeGenerator';
import { ContractAnalyzer } from '../analysis/ContractAnalyzer';
import { AIServiceError } from '../../utils/errors';
import { logger } from '../../utils/logger';

interface GenerationOptions {
    temperature?: number;
    maxTokens?: number;
    model?: string;
    requestId?: string;
    includeTests?: boolean;
    securityLevel?: 'basic' | 'standard' | 'high';
    optimizationLevel?: 'minimal' | 'standard' | 'aggressive';
}

interface GenerationResult {
    code: string;
    model: string;
    timestamp: number;
    requestId?: string;
    metadata?: {
        tokens: number;
        processingTime: number;
        optimizations?: string[];
        securityChecks?: string[];
    };
}

export class AIGenerationService extends EventEmitter {
    private openai: OpenAI;
    private templateEngine: TemplateEngine;
    private securityGenerator: SecurityPatternGenerator;
    private codeGenerator: RustCodeGenerator;
    private analyzer: ContractAnalyzer;
    private readonly DEFAULT_MODEL = 'gpt-4';
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY = 1000;
    private readonly MAX_CONCURRENT_REQUESTS = 5;
    private activeRequests = 0;

    constructor(apiKey: string) {
        super();
        this.openai = new OpenAI({ apiKey });
        this.templateEngine = TemplateEngine.getInstance();
        this.securityGenerator = new SecurityPatternGenerator();
        this.codeGenerator = new RustCodeGenerator();
        this.analyzer = new ContractAnalyzer();
    }

    public async generateContractCode(
        prompt: string,
        options: GenerationOptions = {}
    ): Promise<GenerationResult> {
        const startTime = Date.now();
        const requestId = options.requestId || crypto.randomUUID();

        try {
            await this.checkConcurrencyLimit();
            this.activeRequests++;

            // Generate initial code
            const generatedCode = await this.retryOperation(
                () => this.generateInitialCode(prompt, options),
                'Initial code generation failed'
            );

            // Analyze and enhance code
            const enhancedCode = await this.enhanceGeneratedCode(
                generatedCode,
                options
            );

            // Validate final code
            const validationResult = await this.analyzer.validateGeneratedCode(
                enhancedCode,
                {
                    validateSyntax: true,
                    validateSecurity: true,
                    validateCompatibility: true
                }
            );

            if (!validationResult.isValid) {
                throw new AIServiceError(
                    'Generated code validation failed',
                    { errors: validationResult.errors }
                );
            }

            const result: GenerationResult = {
                code: enhancedCode,
                model: options.model || this.DEFAULT_MODEL,
                timestamp: Date.now(),
                requestId,
                metadata: {
                    tokens: generatedCode.length,
                    processingTime: Date.now() - startTime
                }
            };

            this.emit('generation:complete', {
                requestId,
                duration: Date.now() - startTime
            });

            return result;

        } catch (error) {
            this.emit('generation:error', {
                requestId,
                error: error.message
            });
            throw this.handleError(error);
        } finally {
            this.activeRequests--;
        }
    }

    private async generateInitialCode(
        prompt: string,
        options: GenerationOptions
    ): Promise<string> {
        const completion = await this.openai.chat.completions.create({
            model: options.model || this.DEFAULT_MODEL,
            messages: [
                {
                    role: 'system',
                    content: this.getSystemPrompt(options)
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: options.temperature || 0.7,
            max_tokens: options.maxTokens || 2000,
            presence_penalty: 0.6,
            frequency_penalty: 0.3
        });

        return completion.choices[0]?.message?.content || '';
    }

    private async enhanceGeneratedCode(
        code: string,
        options: GenerationOptions
    ): Promise<string> {
        // Add security patterns
        let enhancedCode = await this.addSecurityPatterns(code, options.securityLevel);

        // Add test cases if requested
        if (options.includeTests) {
            enhancedCode = await this.addTestCases(enhancedCode);
        }

        // Optimize code
        enhancedCode = await this.optimizeCode(enhancedCode, options.optimizationLevel);

        return enhancedCode;
    }

    private async addSecurityPatterns(
        code: string,
        securityLevel: GenerationOptions['securityLevel'] = 'standard'
    ): Promise<string> {
        const securityModule = this.securityGenerator.generateSecurityModule({
            level: securityLevel,
            includeReentrancyGuard: true,
            includeAccessControl: true,
            includeInputValidation: true
        });

        return this.codeGenerator.integrateSecurityPatterns(code, securityModule);
    }

    private async addTestCases(code: string): Promise<string> {
        const testCases = await this.generateTestCases(code);
        return `${code}\n\n${testCases}`;
    }

    private async optimizeCode(
        code: string,
        level: GenerationOptions['optimizationLevel'] = 'standard'
    ): Promise<string> {
        return this.codeGenerator.optimize(code, { level });
    }

    private async generateTestCases(code: string): Promise<string> {
        const completion = await this.openai.chat.completions.create({
            model: this.DEFAULT_MODEL,
            messages: [
                {
                    role: 'system',
                    content: 'Generate comprehensive test cases for the following Solana program code.'
                },
                {
                    role: 'user',
                    content: code
                }
            ],
            temperature: 0.5,
            max_tokens: 1000
        });

        return completion.choices[0]?.message?.content || '';
    }

    private getSystemPrompt(options: GenerationOptions): string {
        return `You are an expert Solana smart contract developer. Generate secure, optimized, and well-documented Rust code for Solana programs.
                Security Level: ${options.securityLevel || 'standard'}
                Optimization Level: ${options.optimizationLevel || 'standard'}
                
                Include:
                - Comprehensive error handling
                - Input validation
                - Access control
                - Documentation and comments
                - Security best practices
                
                Follow Solana program development guidelines and best practices.`;
    }

    private async checkConcurrencyLimit(): Promise<void> {
        if (this.activeRequests >= this.MAX_CONCURRENT_REQUESTS) {
            throw new AIServiceError(
                'Too many concurrent requests',
                { maxConcurrent: this.MAX_CONCURRENT_REQUESTS }
            );
        }
    }

    private async retryOperation<T>(
        operation: () => Promise<T>,
        errorMessage: string
    ): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;
                if (attempt < this.MAX_RETRIES) {
                    await new Promise(resolve => 
                        setTimeout(resolve, this.RETRY_DELAY * attempt)
                    );
                }
            }
        }

        throw new AIServiceError(
            `${errorMessage}: ${lastError?.message}`,
            { cause: lastError }
        );
    }

    private handleError(error: any): Error {
        if (error instanceof AIServiceError) {
            return error;
        }

        if (error.response?.status === 429) {
            return new AIServiceError('Rate limit exceeded, please try again later');
        }

        if (error.response?.status === 413) {
            return new AIServiceError('Input too large');
        }

        return new AIServiceError(
            'AI service error',
            { cause: error }
        );
    }

    public async validateGenerationCapability(): Promise<boolean> {
        try {
            await this.openai.models.list();
            return true;
        } catch {
            return false;
        }
    }

    public async cleanup(): Promise<void> {
        this.removeAllListeners();
    }
}
