import { SecurityCheck, ContractTemplate, ValidationError } from '../../../../types'
import { logger, logError } from '../../../../utils/logger'

interface SecurityModule {
  imports: string[]
  structs: string[]
  traits: string[]
  implementations: string[]
  helpers: string[]
}

interface SecurityPattern {
  name: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  code: string
  dependencies: string[]
  checks: SecurityCheck[]
}

export class SecurityPatternGenerator {
  private readonly patterns: Map<string, SecurityPattern>

  constructor() {
    this.patterns = new Map()
    this.initializePatterns()
  }

  public generateSecurityModule(options: {
    level: 'basic' | 'standard' | 'high'
    includeReentrancyGuard: boolean
    includeAccessControl: boolean
    includeInputValidation: boolean
  }): SecurityModule {
    try {
      const module: SecurityModule = {
        imports: [
          'use solana_program::{',
          '    account_info::AccountInfo,',
          '    entrypoint::ProgramResult,',
          '    program_error::ProgramError,',
          '    pubkey::Pubkey,',
          '    msg,',
          '};',
          'use std::cell::RefCell;'
        ],
        structs: [],
        traits: [],
        implementations: [],
        helpers: []
      }

      // Add reentrancy protection
      if (options.includeReentrancyGuard) {
        const guard = this.patterns.get('reentrancy_guard')
        if (guard) {
          module.structs.push(guard.code)
          module.imports.push(...guard.dependencies)
        }
      }

      // Add access control
      if (options.includeAccessControl) {
        const access = this.patterns.get('access_control')
        if (access) {
          module.traits.push(access.code)
          module.imports.push(...access.dependencies)
        }
      }

      // Add input validation
      if (options.includeInputValidation) {
        const validation = this.patterns.get('input_validation')
        if (validation) {
          module.helpers.push(validation.code)
          module.imports.push(...validation.dependencies)
        }
      }

      // Add security level specific patterns
      this.addSecurityLevelPatterns(module, options.level)

      return this.deduplicateModule(module)

    } catch (error) {
      logError('Security module generation failed', error as Error)
      throw error
    }
  }

  public validateSecurityPatterns(template: ContractTemplate): ValidationError[] {
    const errors: ValidationError[] = []

    try {
      // Check for reentrancy vulnerabilities
      if (!this.hasReentrancyProtection(template)) {
        errors.push({
          code: 'MISSING_REENTRANCY_PROTECTION',
          message: 'Contract lacks reentrancy protection',
          severity: 'high'
        })
      }

      // Check for proper access control
      if (!this.hasAccessControl(template)) {
        errors.push({
          code: 'MISSING_ACCESS_CONTROL',
          message: 'Contract lacks proper access control',
          severity: 'critical'
        })
      }

      // Check for input validation
      if (!this.hasInputValidation(template)) {
        errors.push({
          code: 'MISSING_INPUT_VALIDATION',
          message: 'Contract lacks input validation',
          severity: 'high'
        })
      }

      return errors

    } catch (error) {
      logError('Security pattern validation failed', error as Error)
      throw error
    }
  }

  private initializePatterns(): void {
    // Reentrancy Guard Pattern
    this.patterns.set('reentrancy_guard', {
      name: 'Reentrancy Guard',
      description: 'Prevents reentrancy attacks',
      severity: 'critical',
      code: `
#[derive(Default)]
pub struct ReentrancyGuard {
    entered: RefCell<bool>,
}

impl ReentrancyGuard {
    pub fn enter(&self) -> ProgramResult {
        let mut entered = self.entered.borrow_mut();
        if *entered {
            msg!("Reentrancy detected");
            return Err(ProgramError::Custom(1));
        }
        *entered = true;
        Ok(())
    }

    pub fn exit(&self) {
        *self.entered.borrow_mut() = false;
    }
}`,
      dependencies: [],
      checks: [{
        type: 'reentrancy',
        params: {},
        severity: 'critical'
      }]
    })

    // Access Control Pattern
    this.patterns.set('access_control', {
      name: 'Access Control',
      description: 'Implements role-based access control',
      severity: 'critical',
      code: `
pub trait AccessControl {
    fn is_admin(&self, account: &AccountInfo) -> bool;
    fn only_admin(&self, account: &AccountInfo) -> ProgramResult;
    fn grant_role(&mut self, role: &str, account: &Pubkey) -> ProgramResult;
    fn revoke_role(&mut self, role: &str, account: &Pubkey) -> ProgramResult;
    fn has_role(&self, role: &str, account: &Pubkey) -> bool;
}

impl AccessControl for State {
    fn is_admin(&self, account: &AccountInfo) -> bool {
        self.admin == *account.key
    }

    fn only_admin(&self, account: &AccountInfo) -> ProgramResult {
        if !self.is_admin(account) {
            msg!("Caller is not admin");
            return Err(ProgramError::Custom(2));
        }
        Ok(())
    }

    fn grant_role(&mut self, role: &str, account: &Pubkey) -> ProgramResult {
        self.roles.insert(role.to_string(), *account);
        Ok(())
    }

    fn revoke_role(&mut self, role: &str, account: &Pubkey) -> ProgramResult {
        self.roles.remove(role);
        Ok(())
    }

    fn has_role(&self, role: &str, account: &Pubkey) -> bool {
        self.roles.get(role).map_or(false, |r| r == account)
    }
}`,
      dependencies: ['use std::collections::HashMap;'],
      checks: [{
        type: 'access',
        params: {},
        severity: 'critical'
      }]
    })

    // Input Validation Pattern
    this.patterns.set('input_validation', {
      name: 'Input Validation',
      description: 'Validates all input parameters',
      severity: 'high',
      code: `
pub fn validate_account_ownership(
    account: &AccountInfo,
    owner: &Pubkey,
) -> ProgramResult {
    if account.owner != owner {
        msg!("Invalid account owner");
        return Err(ProgramError::Custom(3));
    }
    Ok(())
}

pub fn validate_account_size(
    account: &AccountInfo,
    min_size: usize,
) -> ProgramResult {
    if account.data_len() < min_size {
        msg!("Account data too small");
        return Err(ProgramError::Custom(4));
    }
    Ok(())
}

pub fn validate_signer(account: &AccountInfo) -> ProgramResult {
    if !account.is_signer {
        msg!("Missing required signature");
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}`,
      dependencies: [],
      checks: [{
        type: 'state',
        params: {},
        severity: 'high'
      }]
    })
  }

  private addSecurityLevelPatterns(module: SecurityModule, level: string): void {
    switch (level) {
      case 'high':
        // Add advanced security patterns
        module.helpers.push(this.generatePanicHandlers())
        module.helpers.push(this.generateArithmeticChecks())
        module.helpers.push(this.generateDataValidation())
        break
      
      case 'standard':
        // Add standard security patterns
        module.helpers.push(this.generateBasicChecks())
        break
      
      case 'basic':
        // Add minimal security patterns
        module.helpers.push(this.generateRequiredChecks())
        break
    }
  }

  private generatePanicHandlers(): string {
    return `
#[inline(always)]
pub fn handle_program_error(error: &str) -> ProgramResult {
    msg!("Program error: {}", error);
    Err(ProgramError::Custom(0xFF))
}

#[inline(always)]
pub fn handle_overflow() -> ProgramResult {
    msg!("Arithmetic overflow");
    Err(ProgramError::Custom(0xFE))
}`
  }

  private generateArithmeticChecks(): string {
    return `
#[inline(always)]
pub fn checked_add(a: u64, b: u64) -> Result<u64, ProgramError> {
    a.checked_add(b).ok_or_else(|| {
        msg!("Arithmetic overflow in addition");
        ProgramError::Custom(0xFD)
    })
}

#[inline(always)]
pub fn checked_sub(a: u64, b: u64) -> Result<u64, ProgramError> {
    a.checked_sub(b).ok_or_else(|| {
        msg!("Arithmetic underflow in subtraction");
        ProgramError::Custom(0xFC)
    })
}`
  }

  private generateDataValidation(): string {
    return `
pub fn validate_buffer(buffer: &[u8], expected_size: usize) -> ProgramResult {
    if buffer.len() != expected_size {
        msg!("Invalid buffer size");
        return Err(ProgramError::Custom(0xFB));
    }
    Ok(())
}

pub fn validate_utf8(buffer: &[u8]) -> ProgramResult {
    if std::str::from_utf8(buffer).is_err() {
        msg!("Invalid UTF-8 sequence");
        return Err(ProgramError::Custom(0xFA));
    }
    Ok(())
}`
  }

  private generateBasicChecks(): string {
    return `
pub fn validate_program_id(program_id: &Pubkey, expected: &Pubkey) -> ProgramResult {
    if program_id != expected {
        msg!("Invalid program id");
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}`
  }

  private generateRequiredChecks(): string {
    return `
pub fn validate_not_empty<T>(slice: &[T]) -> ProgramResult {
    if slice.is_empty() {
        msg!("Empty slice");
        return Err(ProgramError::Custom(0xF9));
    }
    Ok(())
}`
  }

  private deduplicateModule(module: SecurityModule): SecurityModule {
    return {
      imports: [...new Set(module.imports)],
      structs: [...new Set(module.structs)],
      traits: [...new Set(module.traits)],
      implementations: [...new Set(module.implementations)],
      helpers: [...new Set(module.helpers)]
    }
  }

  private hasReentrancyProtection(template: ContractTemplate): boolean {
    return template.instructions.some(inst => 
      inst.checks.some(check => check.type === 'reentrancy')
    )
  }

  private hasAccessControl(template: ContractTemplate): boolean {
    return template.instructions.some(inst =>
      inst.checks.some(check => check.type === 'access')
    )
  }

  private hasInputValidation(template: ContractTemplate): boolean {
    return template.instructions.some(inst =>
      inst.checks.some(check => check.type === 'state')
    )
  }
}
