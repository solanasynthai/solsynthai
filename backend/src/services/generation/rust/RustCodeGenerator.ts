import { 
    ProgramStructure, 
    Instruction, 
    Account, 
    State,
    SecurityProfile,
    ValidationRule
} from '../types';
import { 
    generateAccountStructs,
    generateInstructions,
    generateStateManagement,
    generateSecurityModules
} from './generators';
import { RustFormatter } from './utils/RustFormatter';
import { SecurityPatternGenerator } from './security/SecurityPatternGenerator';
import { OptimizationEngine } from './optimization/OptimizationEngine';

export class RustCodeGenerator {
    private formatter: RustFormatter;
    private securityGenerator: SecurityPatternGenerator;
    private optimizationEngine: OptimizationEngine;

    constructor() {
        this.formatter = new RustFormatter();
        this.securityGenerator = new SecurityPatternGenerator();
        this.optimizationEngine = new OptimizationEngine();
    }

    public generateProgram(structure: ProgramStructure): string {
        try {
            // Generate program modules
            const modules = this.generateProgramModules(structure);
            
            // Generate security features
            const securityFeatures = this.generateSecurityFeatures(structure.securityProfile);
            
            // Combine and optimize
            const combinedCode = this.combineModules(modules, securityFeatures);
            
            // Optimize the generated code
            const optimizedCode = this.optimizationEngine.optimize(combinedCode);
            
            // Format the final code
            return this.formatter.format(optimizedCode);
        } catch (error) {
            throw new Error(`Failed to generate Rust program: ${error.message}`);
        }
    }

    private generateProgramModules(structure: ProgramStructure): string[] {
        const modules: string[] = [];

        // Generate program ID and version
        modules.push(this.generateProgramDeclaration(structure));

        // Generate error handling
        modules.push(this.generateErrorHandling(structure));

        // Generate account structures
        modules.push(generateAccountStructs(structure.accounts));

        // Generate program state
        modules.push(generateStateManagement(structure.state));

        // Generate instructions
        modules.push(generateInstructions(structure.instructions));

        // Generate validation modules
        modules.push(this.generateValidationModules(structure.validationRules));

        return modules;
    }

    private generateProgramDeclaration(structure: ProgramStructure): string {
        return `
            use anchor_lang::prelude::*;
            use anchor_spl::token::{self, Token};
            use std::convert::TryInto;
            
            declare_id!("${structure.programId}");
            
            #[program]
            pub mod ${structure.name.toLowerCase()} {
                use super::*;
                
                ${this.generateProgramMetadata(structure)}
            }
        `;
    }

    private generateProgramMetadata(structure: ProgramStructure): string {
        return `
            const PROGRAM_VERSION: &str = "${structure.version}";
            const PROGRAM_AUTHORITY: &str = "${structure.authority}";
            
            #[constant]
            pub const PROGRAM_SEED: &[u8] = b"${structure.name.toLowerCase()}_program";
        `;
    }

    private generateErrorHandling(structure: ProgramStructure): string {
        const errorCodes = this.extractErrorCodes(structure);
        
        return `
            #[error_code]
            pub enum ${structure.name}Error {
                #[msg("Invalid program authority")]
                InvalidAuthority,
                
                #[msg("Invalid account owner")]
                InvalidOwner,
                
                #[msg("Invalid account data")]
                InvalidAccountData,
                
                ${errorCodes.join(',\n')}
            }
        `;
    }

    private generateValidationModules(rules: ValidationRule[]): string {
        return `
            pub mod validation {
                use super::*;
                
                ${rules.map(rule => this.generateValidationRule(rule)).join('\n')}
                
                pub fn validate_program_access(program_id: &Pubkey) -> Result<()> {
                    require!(
                        *program_id == ID,
                        ${structure.name}Error::InvalidProgramId
                    );
                    Ok(())
                }
                
                pub fn validate_signer(signer: &Signer) -> Result<()> {
                    require!(
                        signer.is_signer,
                        ${structure.name}Error::SignerRequired
                    );
                    Ok(())
                }
            }
        `;
    }

    private generateValidationRule(rule: ValidationRule): string {
        return `
            pub fn ${rule.name}(${this.generateRuleParams(rule)}) -> Result<()> {
                require!(
                    ${rule.condition},
                    ${structure.name}Error::${rule.errorCode}
                );
                Ok(())
            }
        `;
    }

    private generateSecurityFeatures(profile: SecurityProfile): string {
        return `
            pub mod security {
                use super::*;
                
                ${this.securityGenerator.generateReentrancyGuard()}
                ${this.securityGenerator.generateAccessControl(profile)}
                ${this.securityGenerator.generateProgramGuard()}
                
                pub fn initialize_security(ctx: Context<SecurityContext>) -> Result<()> {
                    let clock = Clock::get()?;
                    ctx.accounts.security.is_initialized = true;
                    ctx.accounts.security.last_update = clock.unix_timestamp;
                    ctx.accounts.security.authority = ctx.accounts.authority.key();
                    Ok(())
                }
            }
        `;
    }

    private combineModules(modules: string[], securityFeatures: string): string {
        return `
            ${this.generateLicenseAndDocumentation()}
            
            ${modules.join('\n\n')}
            
            ${securityFeatures}
            
            ${this.generateTestModule()}
        `;
    }

    private generateLicenseAndDocumentation(): string {
        return `
            //! ${structure.name} Program
            //! Version: ${structure.version}
            //! 
            //! This program was generated by the Solana AI Contract Generator
            //! 
            //! SPDX-License-Identifier: Apache-2.0
            
            #![deny(missing_docs)]
            #![deny(warnings)]
            #![deny(unsafe_code)]
        `;
    }

    private generateTestModule(): string {
        return `
            #[cfg(test)]
            mod tests {
                use super::*;
                use anchor_lang::solana_program::program_pack::Pack;
                use anchor_lang::solana_program::system_instruction;
                
                #[test]
                fn test_initialization() {
                    // Test implementation
                }
            }
        `;
    }

    private extractErrorCodes(structure: ProgramStructure): string[] {
        const errorCodes = new Set<string>();
        
        // Extract from instructions
        structure.instructions.forEach(instruction => {
            instruction.errors.forEach(error => {
                errorCodes.add(this.formatErrorCode(error));
            });
        });
        
        // Extract from validation rules
        structure.validationRules.forEach(rule => {
            errorCodes.add(this.formatErrorCode(rule.error));
        });
        
        return Array.from(errorCodes);
    }

    private formatErrorCode(error: string): string {
        return `#[msg("${error}")]
                ${error.replace(/\s+/g, '')}`;
    }
}
