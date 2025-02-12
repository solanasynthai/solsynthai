import { AST, Node, Expression } from '../types';
import { Vulnerability, SecurityReport } from './types';
import { ReentrancyAnalyzer } from './specialized/ReentrancyAnalyzer';
import { OverflowAnalyzer } from './specialized/OverflowAnalyzer';
import { AccountAccessAnalyzer } from './specialized/AccountAccessAnalyzer';

export class StaticAnalyzer {
  private reentrancyAnalyzer: ReentrancyAnalyzer;
  private overflowAnalyzer: OverflowAnalyzer;
  private accountAccessAnalyzer: AccountAccessAnalyzer;

  constructor() {
    this.reentrancyAnalyzer = new ReentrancyAnalyzer();
    this.overflowAnalyzer = new OverflowAnalyzer();
    this.accountAccessAnalyzer = new AccountAccessAnalyzer();
  }

  public async analyzeProgram(ast: AST): Promise<SecurityReport> {
    const vulnerabilities: Vulnerability[] = [];

    // Analyze program structure
    vulnerabilities.push(...await this.analyzeProgramStructure(ast));

    // Analyze instructions
    for (const node of ast.body) {
      if (node.type === 'Instruction') {
        vulnerabilities.push(...await this.analyzeInstruction(node));
      }
    }

    // Analyze account structures
    vulnerabilities.push(...await this.analyzeAccountStructures(ast));

    return this.generateSecurityReport(vulnerabilities);
  }

  private async analyzeProgramStructure(ast: AST): Promise<Vulnerability[]> {
    const vulnerabilities: Vulnerability[] = [];

    // Check program-level security patterns
    vulnerabilities.push(...await this.checkProgramConstraints(ast));
    vulnerabilities.push(...await this.checkStateManagement(ast));
    vulnerabilities.push(...await this.checkProgramAuthorization(ast));

    return vulnerabilities;
  }

  private async analyzeInstruction(node: Node): Promise<Vulnerability[]> {
    const vulnerabilities: Vulnerability[] = [];

    // Analyze reentrancy vulnerabilities
    vulnerabilities.push(...await this.reentrancyAnalyzer.analyze(node));

    // Analyze integer overflow/underflow
    vulnerabilities.push(...await this.overflowAnalyzer.analyze(node));

    // Analyze account access patterns
    vulnerabilities.push(...await this.accountAccessAnalyzer.analyze(node));

    return vulnerabilities;
  }

  private generateSecurityReport(vulnerabilities: Vulnerability[]): SecurityReport {
    const criticalIssues = vulnerabilities.filter(v => v.severity === 'CRITICAL');
    const highIssues = vulnerabilities.filter(v => v.severity === 'HIGH');
    const mediumIssues = vulnerabilities.filter(v => v.severity === 'MEDIUM');
    const lowIssues = vulnerabilities.filter(v => v.severity === 'LOW');

    return {
      summary: {
        criticalCount: criticalIssues.length,
        highCount: highIssues.length,
        mediumCount: mediumIssues.length,
        lowCount: lowIssues.length,
        totalIssues: vulnerabilities.length
      },
      vulnerabilities: {
        critical: criticalIssues,
        high: highIssues,
        medium: mediumIssues,
        low: lowIssues
      },
      recommendations: this.generateRecommendations(vulnerabilities),
      timestamp: new Date().toISOString()
    };
  }
}
