import { Node, Account, Validation } from '../ast/types';
import { SecurityLevel, SecurityCheck } from '../../security/types';

export class SolanaInstructionBuilder {
  private instruction: Partial<Node>;
  private securityChecks: SecurityCheck[];

  constructor() {
    this.instruction = {};
    this.securityChecks = [];
  }

  public withName(name: string): this {
    this.instruction.id = name;
    return this;
  }

  public withAccounts(accounts: Account[]): this {
    this.instruction.accounts = accounts.map(account => ({
      ...account,
      validation: this.generateAccountConstraints(account)
    }));
    return this;
  }

  public withValidation(validation: Validation): this {
    this.instruction.validation = validation;
    return this;
  }

  public withSecurityChecks(level: SecurityLevel): this {
    this.securityChecks = this.generateSecurityChecks(level);
    return this;
  }

  public build(): Node {
    return {
      ...this.instruction,
      type: 'Instruction',
      securityChecks: this.securityChecks,
      body: this.generateInstructionBody()
    } as Node;
  }

  private generateAccountConstraints(account: Account): string[] {
    const constraints: string[] = [];

    if (account.isMutable) {
      constraints.push('#[account(mut)]');
    }

    if (account.isSigner) {
      constraints.push('Signer<\'info>');
    }

    if (account.isPayer) {
      constraints.push('#[account(payer = payer)]');
    }

    return constraints;
  }

  private generateSecurityChecks(level: SecurityLevel): SecurityCheck[] {
    const checks: SecurityCheck[] = [];

    switch (level) {
      case 'HIGH':
        checks.push(
          { type: 'ReentrancyGuard', priority: 1 },
          { type: 'AccountValidation', priority: 1 },
          { type: 'OwnershipCheck', priority: 1 }
        );
        break;
      case 'MEDIUM':
        checks.push(
          { type: 'AccountValidation', priority: 1 },
          { type: 'OwnershipCheck', priority: 2 }
        );
        break;
      case 'LOW':
        checks.push(
          { type: 'AccountValidation', priority: 2 }
        );
        break;
    }

    return checks.sort((a, b) => a.priority - b.priority);
  }

  private generateInstructionBody(): Expression[] {
    const body: Expression[] = [];

    // Add security checks
    this.securityChecks.forEach(check => {
      body.push(this.generateSecurityCheck(check));
    });

    // Add account validations
    if (this.instruction.accounts) {
      body.push(...this.generateAccountValidations(this.instruction.accounts));
    }

    // Add main instruction logic
    body.push(...this.generateInstructionLogic());

    return body;
  }

  private generateSecurityCheck(check: SecurityCheck): Expression {
    // Implementation for security check generation
    return {
      type: 'SecurityCheck',
      checkType: check.type,
      // Additional implementation details
    };
  }
}
