import OpenAI from 'openai'
import { ContractTemplate, GenerationOptions, AnalysisResult } from '../../types'
import { AIServiceError } from '../../utils/errors'
import { logger, logError } from '../../utils/logger'
import { ContractAnalyzer } from '../analysis/ContractAnalyzer'
import { TemplateEngine } from '../generation/template/TemplateEngine'
import { SecurityPatternGenerator } from '../generation/rust/security/SecurityPatternGenerator'
import { RustCodeGenerator } from '../generation/rust/RustCodeGenerator'
import config from '../../config/config'
import { Connection } from '@solana/web3.js'
import { CacheService } from '../cache/CacheService'
import { MetricsService } from '../monitoring/MetricsService'

export class AIGenerationService {
  private static instance: AIGenerationService
  private openai: OpenAI
  private analyzer: ContractAnalyzer
  private templateEngine: TemplateEngine
  private securityGenerator: SecurityPatternGenerator
  private rustGenerator: RustCodeGenerator
  private cache: CacheService
  private metrics: MetricsService

  private readonly MAX_RETRIES = 3
  private readonly RETRY_DELAY = 1000
  private readonly CACHE_TTL = 3600 // 1 hour
  private readonly MODEL_TEMPERATURE = 0.2

  private constructor() {
    this.openai = new OpenAI({
      apiKey: config.ai.openaiApiKey
    })
    
    const connection = new Connection(config.solana.rpcUrl)
    this.analyzer = ContractAnalyzer.getInstance(connection)
    this.templateEngine = TemplateEngine.getInstance()
    this.securityGenerator = new SecurityPatternGenerator()
    this.rustGenerator = new RustCodeGenerator()
    this.cache = CacheService.getInstance()
    this.metrics = MetricsService.getInstance()
  }

  public static getInstance(): AIGenerationService {
    if (!AIGenerationService.instance) {
      AIGenerationService.instance = new AIGenerationService()
    }
    return AIGenerationService.instance
  }

  public async generateContract(
    prompt: string,
    options: GenerationOptions
  ): Promise<{
    template: ContractTemplate
    analysis: AnalysisResult
    code: string
  }> {
    const startTime = performance.now()
    const cacheKey = this.generateCacheKey(prompt, options)

    try {
      // Check cache first
      const cached = await this.cache.get(cacheKey)
      if (cached) {
        this.metrics.increment('contract_generation_cache_hit')
        return JSON.parse(cached)
      }

      // Generate contract template
      const template = await this.generateTemplate(prompt, options)

      // Analyze template
      const analysis = await this.analyzer.analyzeContract(template)

      // Apply security patterns
      const securityModule = this.securityGenerator.generateSecurityModule({
        level: options.security,
        includeReentrancyGuard: this.needsReentrancyGuard(template),
        includeAccessControl: this.needsAccessControl(template),
        includeInputValidation: true
      })

      // Generate Rust code
      const code = await this.rustGenerator.generate(
        template.schemas[0],
        template.instructions,
        {
          level: options.optimization,
          inlineThreshold: 50,
          vectorizeLoops: true,
          constPropagation: true
        }
      )

      const result = { template, analysis, code }

      // Cache the result
      await this.cache.set(
        cacheKey,
        JSON.stringify(result),
        this.CACHE_TTL
      )

      // Record metrics
      this.recordMetrics(startTime, template, analysis)

      return result

    } catch (error) {
      logError('Contract generation failed', error as Error)
      throw new AIServiceError('Failed to generate contract', {
        prompt,
        error: (error as Error).message
      })
    }
  }

  private async generateTemplate(
    prompt: string,
    options: GenerationOptions,
    retry: number = 0
  ): Promise<ContractTemplate> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: config.ai.model,
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
        temperature: this.MODEL_TEMPERATURE,
        max_tokens: config.ai.maxTokens,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0
      })

      const templateString = completion.choices[0]?.message?.content
      if (!templateString) {
        throw new Error('No template generated')
      }

      return this.parseTemplate(templateString)

    } catch (error) {
      if (retry < this.MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY))
        return this.generateTemplate(prompt, options, retry + 1)
      }
      throw error
    }
  }

  private getSystemPrompt(options: GenerationOptions): string {
    return `You are an expert Solana smart contract developer. Generate a complete, secure, and optimized smart contract based on the following requirements:

- Security Level: ${options.security}
- Optimization Level: ${options.optimization}
- Testing Required: ${options.testing}

Follow these guidelines:
1. Use best practices for Solana program development
2. Implement proper error handling
3. Include input validation
4. Add security checks
5. Optimize for performance
6. Follow Rust coding standards
7. Add comprehensive comments
8. Include proper documentation

The response should be a complete contract template in JSON format with the following structure:
{
  "name": string,
  "version": string,
  "description": string,
  "schemas": Array<SchemaDefinition>,
  "instructions": Array<InstructionDefinition>,
  "metadata": ContractMetadata
}`
  }

  private parseTemplate(templateString: string): ContractTemplate {
    try {
      const template = JSON.parse(templateString)
      this.validateTemplate(template)
      return template
    } catch (error) {
      throw new Error(`Invalid template format: ${(error as Error).message}`)
    }
  }

  private validateTemplate(template: any): void {
    const requiredFields = ['name', 'version', 'description', 'schemas', 'instructions', 'metadata']
    for (const field of requiredFields) {
      if (!template[field]) {
        throw new Error(`Missing required field: ${field}`)
      }
    }

    if (!Array.isArray(template.schemas) || template.schemas.length === 0) {
      throw new Error('Template must include at least one schema')
    }

    if (!Array.isArray(template.instructions) || template.instructions.length === 0) {
      throw new Error('Template must include at least one instruction')
    }
  }

  private needsReentrancyGuard(template: ContractTemplate): boolean {
    return template.instructions.some(instruction =>
      instruction.code.includes('invoke') ||
      instruction.code.includes('transfer')
    )
  }

  private needsAccessControl(template: ContractTemplate): boolean {
    return template.instructions.some(instruction =>
      instruction.code.includes('admin') ||
      instruction.code.includes('owner') ||
      instruction.code.includes('authority')
    )
  }

  private generateCacheKey(prompt: string, options: GenerationOptions): string {
    const hash = require('crypto')
      .createHash('sha256')
      .update(`${prompt}${JSON.stringify(options)}`)
      .digest('hex')
    return `contract:${hash}`
  }

  private recordMetrics(
    startTime: number,
    template: ContractTemplate,
    analysis: AnalysisResult
  ): void {
    const duration = performance.now() - startTime
    this.metrics.gauge('contract_generation_duration', duration)
    this.metrics.gauge('contract_schema_count', template.schemas.length)
    this.metrics.gauge('contract_instruction_count', template.instructions.length)
    this.metrics.gauge('contract_security_score', analysis.metrics.securityScore)
    this.metrics.increment('contract_generation_total')
  }
}
