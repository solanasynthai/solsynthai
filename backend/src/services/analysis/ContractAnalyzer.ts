import { Connection, PublicKey } from '@solana/web3.js'
import { AnalysisResult, ValidationError, ContractTemplate, SecurityCheckType } from '../../types'
import { ReentrancyAnalyzer } from '../security/specialized/ReentrancyAnalyzer'
import { logger, logError } from '../../utils/logger'
import { Parser } from '@solidity-parser/parser'
import { BN } from 'bn.js'

export class ContractAnalyzer {
  private static instance: ContractAnalyzer
  private connection: Connection
  private reentrancyAnalyzer: ReentrancyAnalyzer

  private readonly COMPLEXITY_THRESHOLD = 25
  private readonly SIZE_THRESHOLD = 1024 * 50 // 50KB
  private readonly SECURITY_WEIGHT = {
    critical: 1.0,
    high: 0.7,
    medium: 0.4,
    low: 0.2
  }

  private constructor(connection: Connection) {
    this.connection = connection
    this.reentrancyAnalyzer = ReentrancyAnalyzer.getInstance()
  }

  public static getInstance(connection: Connection): ContractAnalyzer {
    if (!ContractAnalyzer.instance) {
      ContractAnalyzer.instance = new ContractAnalyzer(connection)
    }
    return ContractAnalyzer.instance
  }

  public async analyzeContract(
    template: ContractTemplate,
    programId?: PublicKey
  ): Promise<AnalysisResult> {
    const startTime = Date.now()
    const errors: ValidationError[] = []
    const warnings: ValidationError[] = []

    try {
      // Parse contract code
      const ast = Parser.parse(template.instructions[0].code, { tolerant: true })

      // Analyze structure
      const structureErrors = this.analyzeStructure(template)
      errors.push(...structureErrors.filter(e => e.severity === 'critical' || e.severity === 'high'))
      warnings.push(...structureErrors.filter(e => e.severity === 'medium' || e.severity === 'low'))

      // Analyze security
      const securityErrors = await this.analyzeSecurity(template, programId)
      errors.push(...securityErrors.filter(e => e.severity === 'critical' || e.severity === 'high'))
      warnings.push(...securityErrors.filter(e => e.severity === 'medium' || e.severity === 'low'))

      // Calculate metrics
      const metrics = this.calculateMetrics(template, errors, warnings)

      const result: AnalysisResult = {
        errors,
        warnings,
        metrics,
        timestamp: Date.now()
      }

      logger.info('Contract analysis completed', {
        duration: Date.now() - startTime,
        errorCount: errors.length,
        warningCount: warnings.length,
        securityScore: metrics.securityScore
      })

      return result

    } catch (error) {
      logError('Contract analysis failed', error as Error, {
        templateName: template.name,
        programId: programId?.toBase58()
      })
      throw error
    }
  }

  private analyzeStructure(template: ContractTemplate): ValidationError[] {
    const errors: ValidationError[] = []

    // Validate schema consistency
    for (const schema of template.schemas) {
      let offset = 0
      for (const field of schema.fields) {
        if (field.offset !== offset) {
          errors.push({
            code: 'INVALID_FIELD_OFFSET',
            message: `Invalid field offset for ${field.name} in schema ${schema.name}`,
            severity: 'high',
            field: field.name
          })
        }
        offset += field.size
      }

      if (schema.size !== offset) {
        errors.push({
          code: 'INVALID_SCHEMA_SIZE',
          message: `Invalid schema size for ${schema.name}`,
          severity: 'high',
          field: schema.name
        })
      }
    }

    // Validate instruction definitions
    for (const instruction of template.instructions) {
      // Check for duplicate account names
      const accountNames = new Set<string>()
      for (const account of instruction.accounts) {
        if (accountNames.has(account.name)) {
          errors.push({
            code: 'DUPLICATE_ACCOUNT',
            message: `Duplicate account name ${account.name} in instruction ${instruction.name}`,
            severity: 'high',
            field: account.name
          })
        }
        accountNames.add(account.name)
      }

      // Validate PDA seeds
      for (const account of instruction.accounts.filter(a => a.isPda)) {
        if (!account.seeds || account.seeds.length === 0) {
          errors.push({
            code: 'MISSING_PDA_SEEDS',
            message: `Missing PDA seeds for account ${account.name} in instruction ${instruction.name}`,
            severity: 'critical',
            field: account.name
          })
        }
      }
    }

    return errors
  }

  private async analyzeSecurity(
    template: ContractTemplate,
    programId?: PublicKey
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = []

    // Check for reentrancy vulnerabilities
    const reentrancyErrors = await this.reentrancyAnalyzer.analyze(template)
    errors.push(...reentrancyErrors)

    // Check for integer overflow/underflow
    for (const instruction of template.instructions) {
      const arithmeticErrors = this.checkArithmeticOperations(instruction.code)
      errors.push(...arithmeticErrors)
    }

    // Check for proper access control
    const accessErrors = this.checkAccessControl(template)
    errors.push(...accessErrors)

    // If program ID is provided, check on-chain state
    if (programId) {
      const onChainErrors = await this.checkOnChainState(programId)
      errors.push(...onChainErrors)
    }

    return errors
  }

  private checkArithmeticOperations(code: string): ValidationError[] {
    const errors: ValidationError[] = []
    const ast = Parser.parse(code, { tolerant: true })

    // Visit all binary operations
    Parser.visit(ast, {
      BinaryOperation: (node: any) => {
        if (['+', '-', '*', '/'].includes(node.operator)) {
          // Check if operation involves unsafe types
          if (this.isUnsafeArithmetic(node)) {
            errors.push({
              code: 'UNSAFE_ARITHMETIC',
              message: `Potentially unsafe arithmetic operation at line ${node.loc.start.line}`,
              severity: 'high',
              metadata: {
                line: node.loc.start.line,
                column: node.loc.start.column,
                operator: node.operator
              }
            })
          }
        }
      }
    })

    return errors
  }

  private isUnsafeArithmetic(node: any): boolean {
    // Check if operation uses checked math
    const code = node.parent?.toString() || ''
    if (code.includes('.checked_') || code.includes('SafeMath')) {
      return false
    }

    // Check operand types
    const leftType = this.getOperandType(node.left)
    const rightType = this.getOperandType(node.right)

    return this.isUnsafeType(leftType) || this.isUnsafeType(rightType)
  }

  private isUnsafeType(type: string): boolean {
    return ['u64', 'u128', 'i64', 'i128'].includes(type)
  }

  private getOperandType(node: any): string {
    // Implement type inference logic
    return node.typeAnnotation || 'unknown'
  }

  private checkAccessControl(template: ContractTemplate): ValidationError[] {
    const errors: ValidationError[] = []

    for (const instruction of template.instructions) {
      // Check if critical operations have proper signer checks
      const hasCriticalOperation = this.hasCriticalOperation(instruction.code)
      const hasSignerCheck = instruction.accounts.some(acc => acc.isSigner)

      if (hasCriticalOperation && !hasSignerCheck) {
        errors.push({
          code: 'MISSING_SIGNER_CHECK',
          message: `Critical operation in ${instruction.name} without signer check`,
          severity: 'critical',
          field: instruction.name
        })
      }

      // Check for proper authority validation
      if (!this.hasAuthorityValidation(instruction)) {
        errors.push({
          code: 'MISSING_AUTHORITY_CHECK',
          message: `Missing authority validation in ${instruction.name}`,
          severity: 'high',
          field: instruction.name
        })
      }
    }

    return errors
  }

  private async checkOnChainState(programId: PublicKey): Promise<ValidationError[]> {
    const errors: ValidationError[] = []

    try {
      const programInfo = await this.connection.getAccountInfo(programId)
      
      if (!programInfo) {
        errors.push({
          code: 'PROGRAM_NOT_FOUND',
          message: 'Program not found on-chain',
          severity: 'critical'
        })
        return errors
      }

      // Check program size
      if (programInfo.data.length > this.SIZE_THRESHOLD) {
        errors.push({
          code: 'PROGRAM_SIZE_WARNING',
          message: 'Program size exceeds recommended threshold',
          severity: 'medium',
          metadata: {
            size: programInfo.data.length,
            threshold: this.SIZE_THRESHOLD
          }
        })
      }

      // Check program ownership
      if (!programInfo.owner.equals(new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))) {
        errors.push({
          code: 'INVALID_PROGRAM_OWNER',
          message: 'Program has unexpected owner',
          severity: 'critical',
          metadata: {
            owner: programInfo.owner.toBase58()
          }
        })
      }
    } catch (error) {
      logError('Failed to check on-chain state', error as Error, {
        programId: programId.toBase58()
      })
    }

    return errors
  }

  private calculateMetrics(
    template: ContractTemplate,
    errors: ValidationError[],
    warnings: ValidationError[]
  ) {
    // Calculate code size
    const codeSize = template.instructions.reduce(
      (size, inst) => size + inst.code.length,
      0
    )

    // Calculate cyclomatic complexity
    const complexity = this.calculateComplexity(template)

    // Calculate test coverage (if tests exist)
    const coverage = template.metadata.testCoverage || 0

    // Calculate security score
    const securityScore = this.calculateSecurityScore(errors, warnings)

    return {
      codeSize,
      complexity,
      coverage,
      securityScore
    }
  }

  private calculateComplexity(template: ContractTemplate): number {
    let complexity = 1

    for (const instruction of template.instructions) {
      const ast = Parser.parse(instruction.code, { tolerant: true })

      // Count decision points
      Parser.visit(ast, {
        IfStatement: () => complexity++,
        WhileStatement: () => complexity++,
        DoWhileStatement: () => complexity++,
        ForStatement: () => complexity++,
        SwitchCase: () => complexity++,
        LogicalExpression: () => complexity++
      })
    }

    return complexity
  }

  private calculateSecurityScore(errors: ValidationError[], warnings: ValidationError[]): number {
    const baseScore = 100
    let deductions = 0

    // Calculate deductions based on severity
    for (const error of errors) {
      deductions += this.SECURITY_WEIGHT[error.severity] * 20
    }

    for (const warning of warnings) {
      deductions += this.SECURITY_WEIGHT[warning.severity] * 10
    }

    // Ensure score is between 0 and 100
    return Math.max(0, Math.min(100, baseScore - deductions))
  }

  private hasCriticalOperation(code: string): boolean {
    const criticalPatterns = [
      /\.transfer/,
      /\.close/,
      /\.initialize/,
      /set_authority/,
      /upgrade/
    ]
    return criticalPatterns.some(pattern => pattern.test(code))
  }

  private hasAuthorityValidation(instruction: any): boolean {
    const validationPatterns = [
      /require.*authority/i,
      /assert.*authority/i,
      /check.*authority/i
    ]
    return validationPatterns.some(pattern => pattern.test(instruction.code))
  }
}
