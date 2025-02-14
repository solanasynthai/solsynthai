/**
 * File: RustCodeGenerator.ts
 * Location: /backend/src/services/generation/rust/RustCodeGenerator.ts
 * Created: 2025-02-14 17:38:23 UTC
 * Author: solanasynthai
 */

import { ContractSchema, InstructionTemplate, SecurityPatternGenerator } from '../../../types'
import { logger, logError } from '../../../utils/logger'
import { OptimizationLevel } from '../../../types'
import * as rust_format from 'rustfmt-wasm'

interface OptimizationOptions {
  level: OptimizationLevel
  inlineThreshold?: number
  vectorizeLoops?: boolean
  constPropagation?: boolean
}

export class RustCodeGenerator {
  private readonly SOLANA_VERSION = "1.16.0"
  private readonly MAX_PROGRAM_SIZE = 1024 * 1024 // 1MB
  private readonly securityGenerator: SecurityPatternGenerator

  constructor() {
    this.securityGenerator = new SecurityPatternGenerator()
  }

  public async generate(
    schema: ContractSchema,
    instructions: InstructionTemplate[],
    options: OptimizationOptions
  ): Promise<string> {
    try {
      const startTime = Date.now()

      // Generate code sections
      const imports = this.generateImports()
      const state = this.generateState(schema)
      const instructionCode = this.generateInstructions(instructions)
      const processor = this.generateProcessor(instructions)
      const utils = this.generateUtils()

      // Combine sections
      let code = [
        imports,
        state,
        instructionCode,
        processor,
        utils
      ].join('\n\n')

      // Apply optimizations
      code = await this.optimize(code, options)

      // Format code
      code = await this.formatCode(code)

      // Validate generated code
      await this.validateCode(code)

      logger.info('Rust code generation completed', {
        duration: Date.now() - startTime,
        codeSize: code.length,
        instructionCount: instructions.length
      })

      return code

    } catch (error) {
      logError('Rust code generation failed', error as Error)
      throw error
    }
  }

  private generateImports(): string {
    return `
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    program_pack::{Pack, Sealed},
    system_instruction,
    sysvar::{rent::Rent, Sysvar},
};
use borsh::{BorshDeserialize, BorshSerialize};
use thiserror::Error;
use std::convert::TryInto;

// Declare program ID
solana_program::declare_id!("So1SynTH5aiWKr2tW6YLxrzE6bHrRKgifQGdZhfsYVz");`
  }

  private generateState(schema: ContractSchema): string {
    const fields = schema.fields.map(field => {
      const rustType = this.getRustType(field.type)
      return `    pub ${field.name}: ${rustType},`
    }).join('\n')

    return `
#[derive(BorshSerialize, BorshDeserialize, Debug, Default, PartialEq)]
pub struct ${schema.name} {
${fields}
}

impl Sealed for ${schema.name} {}

impl Pack for ${schema.name} {
    const LEN: usize = ${schema.size};

    fn pack_into_slice(&self, dst: &mut [u8]) {
        let mut writer = std::io::Cursor::new(dst);
        self.serialize(&mut writer).unwrap();
    }

    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        let mut reader = std::io::Cursor::new(src);
        let result = Self::deserialize(&mut reader)
            .map_err(|_| ProgramError::InvalidAccountData)?;
        Ok(result)
    }
}`
  }

  private generateInstructions(instructions: InstructionTemplate[]): string {
    return instructions.map(instruction => {
      const args = instruction.args.map(arg => 
        `    pub ${arg.name}: ${this.getRustType(arg.type)},`
      ).join('\n')

      return `
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct ${instruction.name}Instruction {
${args}
}

impl ${instruction.name}Instruction {
    pub fn process(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        instruction_data: &[u8]
    ) -> ProgramResult {
        let instruction = Self::try_from_slice(instruction_data)?;
        ${this.generateSecurityChecks(instruction)}
        ${instruction.code}
        Ok(())
    }
}`
    }).join('\n\n')
  }

  private generateProcessor(instructions: InstructionTemplate[]): string {
    const instructionMatching = instructions.map((inst, index) => 
      `        ${index} => ${inst.name}Instruction::process(program_id, accounts, instruction_data),`
    ).join('\n')

    return `
entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let instruction = instruction_data[0];
    let instruction_data = &instruction_data[1..];

    match instruction {
${instructionMatching}
        _ => Err(ProgramError::InvalidInstructionData),
    }
}`
  }

  private generateUtils(): string {
    return `
#[derive(Error, Debug, Copy, Clone)]
pub enum ContractError {
    #[error("Invalid instruction")]
    InvalidInstruction,
    #[error("Account not initialized")]
    NotInitialized,
    #[error("Invalid account owner")]
    InvalidOwner,
    #[error("Insufficient funds")]
    InsufficientFunds,
    #[error("Account already initialized")]
    AlreadyInitialized,
}

impl From<ContractError> for ProgramError {
    fn from(e: ContractError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

pub fn assert_owned_by(account: &AccountInfo, owner: &Pubkey) -> ProgramResult {
    if account.owner != owner {
        msg!("Account owner mismatch");
        return Err(ContractError::InvalidOwner.into());
    }
    Ok(())
}

pub fn assert_initialized<T: Pack + Default>(
    account_info: &AccountInfo,
) -> Result<T, ProgramError> {
    let account: T = T::unpack_unchecked(&account_info.data.borrow())?;
    Ok(account)
}

pub fn assert_uninitialized<T: Pack + Default>(
    account_info: &AccountInfo,
) -> ProgramResult {
    if !(account_info.data.borrow().iter().all(|x| *x == 0)) {
        return Err(ContractError::AlreadyInitialized.into());
    }
    Ok(())
}

pub fn assert_signer(account_info: &AccountInfo) -> ProgramResult {
    if !account_info.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}`
  }

  private getRustType(fieldType: string): string {
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
  }

  private generateSecurityChecks(instruction: InstructionTemplate): string {
    return instruction.checks.map(check => {
      switch (check.type) {
        case 'ownership':
          return `assert_owned_by(&accounts[${check.params.accountIndex}], program_id)?;`
        case 'signer':
          return `assert_signer(&accounts[${check.params.accountIndex}])?;`
        case 'state':
          return `assert_initialized(&accounts[${check.params.accountIndex}])?;`
        default:
          return ''
      }
    }).join('\n        ')
  }

  private async optimize(code: string, options: OptimizationOptions): Promise<string> {
    let optimized = code

    if (options.level === 'aggressive') {
      // Inline small functions
      if (options.inlineThreshold) {
        optimized = this.inlineFunctions(optimized, options.inlineThreshold)
      }

      // Vectorize loops
      if (options.vectorizeLoops) {
        optimized = this.vectorizeLoops(optimized)
      }

      // Constant propagation
      if (options.constPropagation) {
        optimized = this.propagateConstants(optimized)
      }
    }

    return optimized
  }

  private inlineFunctions(code: string, threshold: number): string {
    // Implementation of function inlining optimization
    const smallFunctionPattern = /fn\s+(\w+)\s*\([^)]*\)\s*->\s*[^{]*\{([^}]*)\}/g
    return code.replace(smallFunctionPattern, (match, name, body) => {
      if (body.length <= threshold) {
        return `#[inline(always)]\n${match}`
      }
      return match
    })
  }

  private vectorizeLoops(code: string): string {
    // Implementation of loop vectorization
    return code.replace(
      /for\s+(\w+)\s+in\s+(\w+)\.iter\(\)/g,
      'for $1 in $2.par_iter()'
    )
  }

  private propagateConstants(code: string): string {
    // Implementation of constant propagation
    const constPattern = /const\s+(\w+):\s*(\w+)\s*=\s*([^;]+);/g
    const constants = new Map<string, string>()
    
    code = code.replace(constPattern, (match, name, type, value) => {
      constants.set(name, value.trim())
      return match
    })

    for (const [name, value] of constants) {
      code = code.replace(new RegExp(`\\b${name}\\b`, 'g'), value)
    }

    return code
  }

  private async formatCode(code: string): Promise<string> {
    try {
      return await rust_format.format(code)
    } catch (error) {
      logger.warn('Failed to format Rust code', { error })
      return code
    }
  }

  private async validateCode(code: string): Promise<void> {
    // Check program size
    if (code.length > this.MAX_PROGRAM_SIZE) {
      throw new Error(`Program size exceeds limit: ${code.length} bytes`)
    }

    // Check for common issues
    const checks = [
      { pattern: /unwrap\(\)/, message: 'Unsafe unwrap detected' },
      { pattern: /panic!\(/, message: 'Panic macro detected' },
      { pattern: /expect\(/, message: 'Unsafe expect detected' },
      { pattern: /as\s+([ui]\d+)/, message: 'Unsafe type cast detected' }
    ]

    for (const check of checks) {
      if (check.pattern.test(code)) {
        logger.warn('Potential code issue detected', { issue: check.message })
      }
    }
  }
}
