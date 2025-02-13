import { EventEmitter } from 'events';
import { StaticAnalyzer } from './StaticAnalyzer';
import { DataFlowAnalyzer } from '../utils/DataFlowAnalyzer';
import { CFGBuilder } from '../utils/CFGBuilder';
import { ReentrancyAnalyzer } from '../specialized/ReentrancyAnalyzer';
import { ValidationError } from '../../types';
import { BN } from 'bn.js';
import { logger } from '../../../utils/logger';

interface SecurityAnalysisOptions {
    level: 'basic' | 'standard' | 'high';
    includeDynamicAnalysis?: boolean;
    includeDataFlow?: boolean;
    cfg?: any;
    timeout?: number;
}

interface SecurityAnalysisResult {
    isSecure: boolean;
    score: number;
    criticalIssues: ValidationError[];
    highIssues: ValidationError[];
    mediumIssues: ValidationError[];
    lowIssues: ValidationError[];
    warnings: ValidationError[];
    metrics: SecurityMetrics;
    recommendations: SecurityRecommendation[];
}

interface SecurityMetrics {
    vulnerabilitiesByType: Record<string, number>;
    riskScore: number;
    complexityScore: number;
    attackSurfaceArea: number;
    securityCoverage: number;
}

interface SecurityRecommendation {
    id: string;
    type: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    description: string;
    impact: string;
    remediation: string;
    references: string[];
}

interface VulnerabilityPattern {
    id: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    pattern: RegExp;
    description: string;
    impact: string;
    remediation: string;
    falsePositives?: string[];
    cwe?: string;
}

export class SecurityAnalyzer extends EventEmitter {
    private static instance: SecurityAnalyzer;
    private staticAnalyzer: StaticAnalyzer;
    private dataFlowAnalyzer: DataFlowAnalyzer;
    private cfgBuilder: CFGBuilder;
    private reentrancyAnalyzer: ReentrancyAnalyzer;
    private vulnerabilityPatterns: VulnerabilityPattern[];

    constructor() {
        super();
        this.staticAnalyzer = new StaticAnalyzer();
        this.dataFlowAnalyzer = new DataFlowAnalyzer();
        this.cfgBuilder = new CFGBuilder();
        this.reentrancyAnalyzer = new ReentrancyAnalyzer();
        this.initializeVulnerabilityPatterns();
    }

    private initializeVulnerabilityPatterns(): void {
        this.vulnerabilityPatterns = [
            {
                id: 'REENTRANCY',
                severity: 'critical',
                pattern: /invoke|call|transfer(?!_ownership)|send/,
                description: 'Potential reentrancy vulnerability detected',
                impact: 'Contract could be drained of funds or have state corrupted',
                remediation: 'Implement reentrancy guards and follow checks-effects-interactions pattern',
                cwe: 'CWE-841'
            },
            {
                id: 'UNCHECKED_MATH',
                severity: 'high',
                pattern: /[\+\-\*\/]=?(?!\s*(?:checked|safe))/,
                description: 'Unchecked arithmetic operation',
                impact: 'Integer overflow/underflow can lead to incorrect calculations',
                remediation: 'Use checked math operations or explicit overflow checks',
                cwe: 'CWE-190'
            },
            {
                id: 'ARBITRARY_JUMP',
                severity: 'critical',
                pattern: /unsafe|asm|inline/,
                description: 'Potentially unsafe low-level operation',
                impact: 'Contract execution could jump to arbitrary locations',
                remediation: 'Avoid using unsafe code and inline assembly',
                cwe: 'CWE-695'
            },
            {
                id: 'UNPROTECTED_SELFDESTRUCT',
                severity: 'critical',
                pattern: /selfdestruct|suicide/,
                description: 'Unprotected selfdestruct operation',
                impact: 'Contract could be maliciously destroyed',
                remediation: 'Add proper access controls to selfdestruct operations',
                cwe: 'CWE-284'
            },
            {
                id: 'TIMESTAMP_DEPENDENCE',
                severity: 'medium',
                pattern: /block\.timestamp|now/,
                description: 'Timestamp manipulation vulnerability',
                impact: 'Contract logic could be manipulated by miners',
                remediation: 'Use block numbers instead of timestamps for time-sensitive operations',
                cwe: 'CWE-829'
            }
        ];
    }

    public async analyzeContract(
        code: string,
        options: SecurityAnalysisOptions
    ): Promise<SecurityAnalysisResult> {
        const startTime = Date.now();
        let cfg = options.cfg;

        try {
            // Build CFG if not provided
            if (!cfg) {
                cfg = this.cfgBuilder.buildFromCode(code);
            }

            // Initialize result structure
            const result: SecurityAnalysisResult = {
                isSecure: true,
                score: 100,
                criticalIssues: [],
                highIssues: [],
                mediumIssues: [],
                lowIssues: [],
                warnings: [],
                metrics: {
                    vulnerabilitiesByType: {},
                    riskScore: 0,
                    complexityScore: 0,
                    attackSurfaceArea: 0,
                    securityCoverage: 0
                },
                recommendations: []
            };

            // Perform static analysis
            const staticAnalysisIssues = await this.performStaticAnalysis(code, cfg);
            this.categorizeIssues(staticAnalysisIssues, result);

            // Perform data flow analysis if requested
            if (options.includeDataFlow) {
                const dataFlowIssues = await this.performDataFlowAnalysis(cfg);
                this.categorizeIssues(dataFlowIssues, result);
            }

            // Check for reentrancy vulnerabilities
            const reentrancyIssues = await this.reentrancyAnalyzer.analyze(cfg);
            this.categorizeIssues(reentrancyIssues, result);

            // Perform pattern-based vulnerability detection
            const patternIssues = await this.detectVulnerabilityPatterns(code);
            this.categorizeIssues(patternIssues, result);

            // Calculate security metrics
            result.metrics = this.calculateSecurityMetrics(result);

            // Generate security score
            result.score = this.calculateSecurityScore(result);
            result.isSecure = this.determineSecurityStatus(result);

            // Generate recommendations
            result.recommendations = this.generateRecommendations(result);

            this.emit('analysis:complete', {
                duration: Date.now() - startTime,
                issues: {
                    critical: result.criticalIssues.length,
                    high: result.highIssues.length,
                    medium: result.mediumIssues.length,
                    low: result.lowIssues.length
                },
                score: result.score
            });

            return result;

        } catch (error) {
            logger.error('Security analysis failed', {
                error: error.message,
                stack: error.stack
            });

            this.emit('analysis:error', {
                error: error.message,
                duration: Date.now() - startTime
            });

            throw error;
        }
    }

    private async performStaticAnalysis(code: string, cfg: any): Promise<ValidationError[]> {
        const issues: ValidationError[] = [];

        // Check for unsafe operations
        const unsafeOps = await this.staticAnalyzer.findUnsafeOperations(code);
        issues.push(...unsafeOps);

        // Check for access control issues
        const accessIssues = await this.staticAnalyzer.checkAccessControl(code);
        issues.push(...accessIssues);

        // Check for input validation issues
        const validationIssues = await this.staticAnalyzer.checkInputValidation(code);
        issues.push(...validationIssues);

        // Check for state manipulation issues
        const stateIssues = await this.staticAnalyzer.checkStateManipulation(code, cfg);
        issues.push(...stateIssues);

        return issues;
    }

    private async performDataFlowAnalysis(cfg: any): Promise<ValidationError[]> {
        return this.dataFlowAnalyzer.analyze(cfg);
    }

    private async detectVulnerabilityPatterns(code: string): Promise<ValidationError[]> {
        const issues: ValidationError[] = [];
        const lines = code.split('\n');

        for (const pattern of this.vulnerabilityPatterns) {
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (pattern.pattern.test(line)) {
                    // Check for false positives
                    if (pattern.falsePositives && 
                        pattern.falsePositives.some(fp => line.includes(fp))) {
                        continue;
                    }

                    issues.push({
                        line: i + 1,
                        column: line.search(pattern.pattern),
                        message: pattern.description,
                        severity: pattern.severity,
                        errorType: pattern.id,
                        impact: pattern.impact,
                        remediation: pattern.remediation,
                        cwe: pattern.cwe
                    });
                }
            }
        }

        return issues;
    }

    private categorizeIssues(
        issues: ValidationError[],
        result: SecurityAnalysisResult
    ): void {
        for (const issue of issues) {
            switch (issue.severity) {
                case 'critical':
                    result.criticalIssues.push(issue);
                    break;
                case 'high':
                    result.highIssues.push(issue);
                    break;
                case 'medium':
                    result.mediumIssues.push(issue);
                    break;
                case 'low':
                    result.lowIssues.push(issue);
                    break;
                default:
                    result.warnings.push(issue);
            }

            // Track vulnerability types
            result.metrics.vulnerabilitiesByType[issue.errorType] = 
                (result.metrics.vulnerabilitiesByType[issue.errorType] || 0) + 1;
        }
    }

    private calculateSecurityMetrics(result: SecurityAnalysisResult): SecurityMetrics {
        const metrics = result.metrics;

        // Calculate risk score (0-100, lower is better)
        metrics.riskScore = 
            (result.criticalIssues.length * 25) +
            (result.highIssues.length * 15) +
            (result.mediumIssues.length * 10) +
            (result.lowIssues.length * 5);
        metrics.riskScore = Math.min(100, metrics.riskScore);

        // Calculate complexity score
        metrics.complexityScore = this.calculateComplexityScore(result);

        // Calculate attack surface area
        metrics.attackSurfaceArea = this.calculateAttackSurface(result);

        // Calculate security coverage
        metrics.securityCoverage = this.calculateSecurityCoverage(result);

        return metrics;
    }

    private calculateComplexityScore(result: SecurityAnalysisResult): number {
        let score = 0;

        // Add complexity for each type of vulnerability
        score += Object.keys(result.metrics.vulnerabilitiesByType).length * 5;

        // Add complexity for interaction patterns
        score += result.criticalIssues.filter(i => 
            i.errorType.includes('INTERACTION') || 
            i.errorType.includes('CALL')
        ).length * 10;

        // Add complexity for state management
        score += result.highIssues.filter(i => 
            i.errorType.includes('STATE') || 
            i.errorType.includes('STORAGE')
        ).length * 8;

        return Math.min(100, score);
    }

    private calculateAttackSurface(result: SecurityAnalysisResult): number {
        let surface = 0;

        // Count external interfaces
        surface += result.criticalIssues.filter(i => 
            i.errorType.includes('EXTERNAL') || 
            i.errorType.includes('PUBLIC')
        ).length * 15;

        // Count state variables
        surface += result.highIssues.filter(i => 
            i.errorType.includes('STORAGE') || 
            i.errorType.includes('STATE')
        ).length * 10;

        // Count complex operations
        surface += result.mediumIssues.filter(i => 
            i.errorType.includes('COMPLEX') || 
            i.errorType.includes('CALCULATION')
        ).length * 5;

        return Math.min(100, surface);
    }

    private calculateSecurityCoverage(result: SecurityAnalysisResult): number {
        // Start with perfect coverage and subtract for issues
        let coverage = 100;

        // Subtract for missing security patterns
        coverage -= (result.criticalIssues.length * 15);
        coverage -= (result.highIssues.length * 10);
        coverage -= (result.mediumIssues.length * 5);
        coverage -= (result.lowIssues.length * 2);

        // Ensure coverage doesn't go below 0
        return Math.max(0, coverage);
    }

    private calculateSecurityScore(result: SecurityAnalysisResult): number {
        // Start with perfect score and subtract based on issues
        let score = 100;

        // Major deductions for critical issues
        score -= (result.criticalIssues.length * 20);

        // Significant deductions for high issues
        score -= (result.highIssues.length * 10);

        // Moderate deductions for medium issues
        score -= (result.mediumIssues.length * 5);

        // Minor deductions for low issues
        score -= (result.lowIssues.length * 2);

        // Additional deductions based on metrics
        score -= (result.metrics.riskScore * 0.2);
        score -= (result.metrics.complexityScore * 0.1);
        score -= ((100 - result.metrics.securityCoverage) * 0.1);

        // Ensure score doesn't go below 0
        return Math.max(0, score);
    }

    private determineSecurityStatus(result: SecurityAnalysisResult): boolean {
        // Contract is considered secure if:
        // 1. No critical issues
        // 2. Security score above 70
        // 3. No more than 2 high issues
        // 4. Security coverage above 80%
        return (
            result.criticalIssues.length === 0 &&
            result.score >= 70 &&
            result.highIssues.length <= 2 &&
            result.metrics.securityCoverage >= 80
        );
    }

    private generateRecommendations(result: SecurityAnalysisResult): SecurityRecommendation[] {
        const recommendations: SecurityRecommendation[] = [];

        // Generate recommendations for critical issues
        for (const issue of result.criticalIssues) {
            recommendations.push({
                id: `REC_${issue.errorType}`,
                type: 'critical',
                title: `Fix ${issue.errorType.toLowerCase().replace(/_/g, ' ')}`,
                description: issue.message,
                impact: issue.impact || 'Critical security vulnerability that could compromise the contract',
                remediation: issue.remediation || this.getRemediationForIssue(issue.errorType),
                references: this.getReferencesForIssue(issue.errorType)
            });
        }

        // Generate recommendations for high priority issues
        for (const issue of result.highIssues) {
            recommendations.push({
                id: `REC_${issue.errorType}`,
                type: 'high',
                title: `Address ${issue.errorType.toLowerCase().replace(/_/g, ' ')}`,
                description: issue.message,
                impact: issue.impact || 'High-risk security vulnerability',
                remediation: issue.remediation || this.getRemediationForIssue(issue.errorType),
                references: this.getReferencesForIssue(issue.errorType)
            });
        }

        // Generate recommendations based on metrics
        if (result.metrics.complexityScore > 70) {
            recommendations.push({
                id: 'REC_HIGH_COMPLEXITY',
                type: 'medium',
                title: 'Reduce code complexity',
                description: 'High code complexity increases the risk of vulnerabilities',
                impact: 'Complex code is harder to audit and more prone to bugs',
                remediation: 'Break down complex functions into smaller, more manageable pieces',
                references: [
                    'https://docs.solana.com/developing/programming-model/overview',
                    'https://github.com/solana-labs/solana/tree/master/sdk/program'
                ]
            });
        }

        if (result.metrics.securityCoverage < 80) {
            recommendations.push({
                id: 'REC_LOW_SECURITY_COVERAGE',
                type: 'high',
                title: 'Improve security coverage',
                description: 'Security coverage is below recommended threshold',
                impact: 'Insufficient security measures could lead to vulnerabilities',
                remediation: 'Implement additional security checks and validations',
                references: [
                    'https://docs.solana.com/developing/security',
                    'https://github.com/solana-labs/solana-security-txt'
                ]
            });
        }

        // Deduplicate recommendations
        return Array.from(new Map(recommendations.map(r => [r.id, r])).values());
    }

    private getRemediationForIssue(issueType: string): string {
        const remediations: Record<string, string> = {
            'REENTRANCY': 'Implement a reentrancy guard using the ReentrancyGuard pattern and ensure all state changes occur before external calls',
            'UNCHECKED_MATH': 'Use checked math operations or implement explicit overflow checks using safe math libraries',
            'ARBITRARY_JUMP': 'Remove dynamic jump operations and implement proper control flow mechanisms',
            'ACCESS_CONTROL': 'Implement proper access control mechanisms using program-derived addresses (PDAs)',
            'UNINITIALIZED_STATE': 'Add initialization checks and ensure proper state management',
            'TIMESTAMP_DEPENDENCE': 'Use block numbers or epochs instead of timestamps for time-sensitive operations',
            'DOS_VULNERABLE': 'Implement proper bounds checking and gas-efficient patterns',
            'PRICE_MANIPULATION': 'Use time-weighted average prices (TWAP) or other manipulation-resistant price feeds',
            'FLASH_LOAN_ATTACK': 'Implement proper checks and balances to prevent flash loan exploits',
            'FRONT_RUNNING': 'Implement commit-reveal schemes or other front-running protections'
        };

        return remediations[issueType] || 'Review and update the code following security best practices';
    }

    private getReferencesForIssue(issueType: string): string[] {
        const baseReferences = [
            'https://docs.solana.com/developing/security',
            'https://github.com/solana-labs/solana/tree/master/sdk/program'
        ];

        const specificReferences: Record<string, string[]> = {
            'REENTRANCY': [
                'https://docs.solana.com/developing/security/reentrancy',
                'https://github.com/solana-labs/solana-program-library/tree/master/token/program'
            ],
            'UNCHECKED_MATH': [
                'https://docs.solana.com/developing/security/math',
                'https://github.com/solana-labs/solana/blob/master/sdk/program/src/math.rs'
            ],
            'ACCESS_CONTROL': [
                'https://docs.solana.com/developing/security/access-control',
                'https://github.com/solana-labs/solana-program-library/tree/master/token/program/src/state'
            ]
        };

        return [...baseReferences, ...(specificReferences[issueType] || [])];
    }

    public async validateSecurityRequirements(
        requirements: string[],
        result: SecurityAnalysisResult
    ): Promise<boolean> {
        for (const requirement of requirements) {
            switch (requirement) {
                case 'NO_CRITICAL_ISSUES':
                    if (result.criticalIssues.length > 0) return false;
                    break;
                case 'MIN_SECURITY_SCORE':
                    if (result.score < 70) return false;
                    break;
                case 'MIN_SECURITY_COVERAGE':
                    if (result.metrics.securityCoverage < 80) return false;
                    break;
                case 'MAX_COMPLEXITY':
                    if (result.metrics.complexityScore > 70) return false;
                    break;
                case 'MAX_ATTACK_SURFACE':
                    if (result.metrics.attackSurfaceArea > 60) return false;
                    break;
            }
        }
        return true;
    }

    public async cleanup(): Promise<void> {
        this.removeAllListeners();
    }
}
