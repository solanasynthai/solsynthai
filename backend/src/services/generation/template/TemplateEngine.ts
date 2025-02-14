/**
 * File: TemplateEngine.ts
 * Location: /backend/src/services/generation/template/TemplateEngine.ts
 * Created: 2025-02-14 17:37:05 UTC
 * Author: solanasynthai
 */

import { ContractTemplate, SchemaField, InstructionTemplate, SecurityCheck } from '../../../types'
import { logger, logError } from '../../../utils/logger'
import { readFileSync } from 'fs'
import { join } from 'path'
import Handlebars from 'handlebars'
import { nanoid } from 'nanoid'

export class TemplateEngine {
  private static instance: TemplateEngine
  private templates: Map<string, Handlebars.TemplateDelegate>
  private readonly TEMPLATES_DIR = join(__dirname, '../../../../templates')
  private readonly DEFAULT_TEMPLATE = 'basic_contract'

  private constructor() {
    this.templates = new Map()
    this.registerHelpers()
    this.loadTemplates()
  }

  public static getInstance(): TemplateEngine {
    if (!TemplateEngine.instance) {
      TemplateEngine.instance = new TemplateEngine()
    }
    return TemplateEngine.instance
  }

  public async generateContract(template: ContractTemplate): Promise<string> {
    try {
      const startTime = Date.now()
      const templateName = this.determineTemplate(template)
      const compiledTemplate = this.templates.get(templateName)

      if (!compiledTemplate) {
        throw new Error(`Template ${templateName} not found`)
      }

      // Prepare template context
      const context = this.prepareContext(template)

      // Generate code
      const generatedCode = compiledTemplate(context)

      // Validate generated code
      this.validateGeneratedCode(generatedCode)

      logger.info('Contract generation completed', {
        templateName,
        duration: Date.now() - startTime,
        schemaCount: template.schemas.length,
        instructionCount: template.instructions.length
      })

      return generatedCode

    } catch (error) {
      logError('Contract generation failed', error as Error, {
        templateName: template.name
      })
      throw error
    }
  }

  private registerHelpers(): void {
    // Field type conversion helper
    Handlebars.registerHelper('solanaType', (fieldType: string) => {
      const typeMap: Record<string, string> = {
        'u8': 'u8',
        'u16': 'u16',
        'u32': 'u32',
        'u64': 'u64',
        'i8': 'i8',
        'i16': 'i16',
        'i32': 'i32',
        'i64': 'i64',
        'f32': 'f32',
        'f64': 'f64',
        'bool': 'bool',
        'string': 'String',
        'pubkey': 'Pubkey',
        'bytes': 'Vec<u8>'
      }
      return typeMap[fieldType] || fieldType
    })

    // Security check helper
    Handlebars.registerHelper('securityCheck', (check: SecurityCheck) => {
      const checkTemplates: Record<string, string> = {
        'ownership': 'require!(ctx.accounts.{{account}}.owner == ctx.program_id, "Invalid account owner");',
        'signer': 'require!(ctx.accounts.{{account}}.is_signer, "{{account}} must be a signer");',
        'state': 'require!({{account}}.{{field}} == {{value}}, "Invalid state");',
        'reentrancy': 'require!(!{{account}}.is_locked, "Reentrancy not allowed");'
      }
      return checkTemplates[check.type] || ''
    })

    // PDA seeds helper
    Handlebars.registerHelper('pdaSeeds', (seeds: any[]) => {
      return seeds.map(seed => {
        if (typeof seed === 'string') {
          return `b"${seed}"`;
        }
        return `&${seed.toString()}`
      }).join(', ')
    })

    // Unique identifier helper
    Handlebars.registerHelper('uniqueId', () => nanoid())

    // Field serialization helper
    Handlebars.registerHelper('serializeField', (field: SchemaField) => {
      const serializationMap: Record<string, string> = {
        'u8': 'write_u8',
        'u16': 'write_u16',
        'u32': 'write_u32',
        'u64': 'write_u64',
        'i8': 'write_i8',
        'i16': 'write_i16',
        'i32': 'write_i32',
        'i64': 'write_i64',
        'bool': 'write_bool',
        'pubkey': 'write_pubkey',
        'string': 'write_string'
      }
      return serializationMap[field.type] || 'write_bytes'
    })
  }

  private loadTemplates(): void {
    try {
      const templateFiles = [
        'basic_contract.hbs',
        'token_contract.hbs',
        'nft_contract.hbs',
        'dao_contract.hbs',
        'defi_contract.hbs'
      ]

      for (const file of templateFiles) {
        const templatePath = join(this.TEMPLATES_DIR, file)
        const templateContent = readFileSync(templatePath, 'utf8')
        const templateName = file.replace('.hbs', '')
        this.templates.set(templateName, Handlebars.compile(templateContent))
      }

      logger.info('Templates loaded successfully', {
        count: this.templates.size,
        templates: Array.from(this.templates.keys())
      })

    } catch (error) {
      logError('Failed to load templates', error as Error)
      throw error
    }
  }

  private determineTemplate(template: ContractTemplate): string {
    // Analyze template requirements
    const hasToken = template.schemas.some(s => 
      s.fields.some(f => f.name.toLowerCase().includes('mint'))
    )
    const hasNFT = template.schemas.some(s => 
      s.fields.some(f => f.name.toLowerCase().includes('metadata'))
    )
    const hasGovernance = template.schemas.some(s => 
      s.fields.some(f => f.name.toLowerCase().includes('proposal'))
    )
    const hasDeFi = template.schemas.some(s => 
      s.fields.some(f => ['swap', 'pool', 'liquidity'].some(term => 
        f.name.toLowerCase().includes(term)
      ))
    )

    // Select appropriate template
    if (hasToken) return 'token_contract'
    if (hasNFT) return 'nft_contract'
    if (hasGovernance) return 'dao_contract'
    if (hasDeFi) return 'defi_contract'
    return this.DEFAULT_TEMPLATE
  }

  private prepareContext(template: ContractTemplate): any {
    return {
      name: template.name,
      version: template.version,
      description: template.description,
      schemas: template.schemas.map(schema => ({
        ...schema,
        fields: schema.fields.map(field => ({
          ...field,
          solanaType: Handlebars.helpers.solanaType(field.type),
          serializer: Handlebars.helpers.serializeField(field)
        }))
      })),
      instructions: template.instructions.map(instruction => ({
        ...instruction,
        uniqueId: nanoid(),
        hasReentrancyGuard: this.needsReentrancyGuard(instruction)
      })),
      metadata: {
        ...template.metadata,
        generated: new Date().toISOString(),
        generator: 'SolSynthai Template Engine v1.0'
      }
    }
  }

  private validateGeneratedCode(code: string): void {
    // Check for basic syntax
    if (!code.includes('use solana_program::')) {
      throw new Error('Missing Solana program imports')
    }

    // Check for program ID
    if (!code.includes('declare_id!')) {
      throw new Error('Missing program ID declaration')
    }

    // Check for instruction processing
    if (!code.includes('pub fn process_instruction')) {
      throw new Error('Missing instruction processor')
    }

    // Check for potential security issues
    const securityChecks = [
      { pattern: /unwrap\(\)/, message: 'Unsafe unwrap detected' },
      { pattern: /panic!\(/, message: 'Panic macro detected' },
      { pattern: /\.clone\(\)/, message: 'Unnecessary clone detected' }
    ]

    for (const check of securityChecks) {
      if (check.pattern.test(code)) {
        logger.warn('Security warning in generated code', {
          warning: check.message
        })
      }
    }
  }

  private needsReentrancyGuard(instruction: InstructionTemplate): boolean {
    const riskPatterns = [
      /transfer/i,
      /swap/i,
      /exchange/i,
      /cross_program_invoke/i,
      /invoke/i
    ]
    return riskPatterns.some(pattern => pattern.test(instruction.code))
  }
}
