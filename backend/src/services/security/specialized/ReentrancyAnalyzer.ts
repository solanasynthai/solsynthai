import { EventEmitter } from 'events';
import { ValidationError } from '../../types';
import { DataFlowAnalyzer } from '../utils/DataFlowAnalyzer';
import { CFGBuilder } from '../utils/CFGBuilder';
import { logger } from '../../../utils/logger';

interface ReentrancyPattern {
    id: string;
    type: 'direct' | 'cross-function' | 'cross-contract';
    severity: 'critical' | 'high' | 'medium';
    pattern: {
        entryPoint: RegExp;
        stateModification: RegExp;
        externalCall: RegExp;
    };
    description: string;
    impact: string;
    remediation: string;
}

interface StateAccess {
    variable: string;
    type: 'read' | 'write';
    location: {
        line: number;
        column: number;
    };
    inExternalCall: boolean;
}

interface ExternalCall {
    target: string;
    line: number;
    column: number;
    stateBefore: Set<string>;
    stateAfter: Set<string>;
    function: string;
}

export class ReentrancyAnalyzer extends EventEmitter {
    private dataFlowAnalyzer: DataFlowAnalyzer;
    private cfgBuilder: CFGBuilder;
    private patterns: ReentrancyPattern[];
    private stateAccesses: Map<string, StateAccess[]>;
    private externalCalls: ExternalCall[];
    private guardedFunctions: Set<string>;
    private vulnerablePaths: Map<string, string[]>;

    constructor() {
        super();
        this.dataFlowAnalyzer = new DataFlowAnalyzer();
        this.cfgBuilder = new CFGBuilder();
        this.stateAccesses = new Map();
        this.externalCalls = [];
        this.guardedFunctions = new Set();
        this.vulnerablePaths = new Map();
        this.initializePatterns();
    }

    private initializePatterns(): void {
        this.patterns = [
            {
                id: 'DIRECT_REENTRANCY',
                type: 'direct',
                severity: 'critical',
                pattern: {
                    entryPoint: /pub\s+fn\s+(\w+)/,
                    stateModification: /\b\w+\s*=\s*.*|\w+\.push\(.*\)|\w+\.pop\(\)/,
                    externalCall: /invoke|call|transfer(?!_ownership)/
                },
                description: 'Direct reentrancy vulnerability detected',
                impact: 'Function can be reentered before state updates are finalized',
                remediation: 'Implement reentrancy guard and follow checks-effects-interactions pattern'
            },
            {
                id: 'CROSS_FUNCTION_REENTRANCY',
                type: 'cross-function',
                severity: 'high',
                pattern: {
                    entryPoint: /pub\s+fn\s+(\w+)/,
                    stateModification: /\b\w+\s*=\s*.*|\w+\.push\(.*\)|\w+\.pop\(\)/,
                    externalCall: /invoke_signed|invoke_unchecked/
                },
                description: 'Cross-function reentrancy vulnerability detected',
                impact: 'Contract state can be manipulated through multiple function calls',
                remediation: 'Implement contract-wide reentrancy guard and state validation'
            },
            {
                id: 'CROSS_CONTRACT_REENTRANCY',
                type: 'cross-contract',
                severity: 'critical',
                pattern: {
                    entryPoint: /pub\s+fn\s+(\w+)/,
                    stateModification: /\b\w+\s*=\s*.*|\w+\.push\(.*\)|\w+\.pop\(\)/,
                    externalCall: /cross_program_invoke|cpi/
                },
                description: 'Cross-contract reentrancy vulnerability detected',
                impact: 'Contract vulnerable to reentrancy attacks through external contract calls',
                remediation: 'Implement strong access controls and state validation across contracts'
            }
        ];
    }

    public async analyze(cfg: any): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];
        const startTime = Date.now();

        try {
            // Reset analysis state
            this.stateAccesses.clear();
            this.externalCalls = [];
            this.guardedFunctions.clear();
            this.vulnerablePaths.clear();

            // Identify state variables and accesses
            await this.identifyStateAccesses(cfg);

            // Identify external calls
            await this.identifyExternalCalls(cfg);

            // Identify reentrancy guards
            await this.identifyReentrancyGuards(cfg);

            // Analyze each pattern
            for (const pattern of this.patterns) {
                const vulnerabilities = await this.analyzePattern(pattern, cfg);
                errors.push(...vulnerabilities);
            }

            // Find vulnerable paths
            const pathVulnerabilities = await this.findVulnerablePaths(cfg);
            errors.push(...pathVulnerabilities);

            this.emit('analysis:complete', {
                duration: Date.now() - startTime,
                vulnerabilities: errors.length
            });

            return errors;

        } catch (error) {
            logger.error('Reentrancy analysis failed', {
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

    private async identifyStateAccesses(cfg: any): Promise<void> {
        for (const node of cfg.nodes.values()) {
            if (!node.code) continue;

            const stateReads = this.findStateReads(node.code);
            const stateWrites = this.findStateWrites(node.code);

            // Record state accesses
            for (const variable of stateReads) {
                this.recordStateAccess(variable, 'read', node);
            }

            for (const variable of stateWrites) {
                this.recordStateAccess(variable, 'write', node);
            }
        }
    }

    private findStateReads(code: string): string[] {
        const reads: string[] = [];
        const readPattern = /\b(\w+)\s*(?:\.|\[|$)/g;
        let match;

        while ((match = readPattern.exec(code)) !== null) {
            if (!this.isLocalVariable(match[1])) {
                reads.push(match[1]);
            }
        }

        return reads;
    }

    private findStateWrites(code: string): string[] {
        const writes: string[] = [];
        const writePattern = /\b(\w+)\s*(?:=|\+=|-=|\*=|\/=|%=)/g;
        let match;

        while ((match = writePattern.exec(code)) !== null) {
            if (!this.isLocalVariable(match[1])) {
                writes.push(match[1]);
            }
        }

        return writes;
    }

    private isLocalVariable(name: string): boolean {
        // Check for common local variable patterns
        return /^(?:let|mut|temp|_|i|j|k|x|y|z|loop|index)/.test(name);
    }

    private recordStateAccess(
        variable: string,
        type: StateAccess['type'],
        node: any
    ): void {
        if (!this.stateAccesses.has(variable)) {
            this.stateAccesses.set(variable, []);
        }

        this.stateAccesses.get(variable)!.push({
            variable,
            type,
            location: {
                line: node.line,
                column: node.column
            },
            inExternalCall: this.isInExternalCall(node)
        });
    }

    private async identifyExternalCalls(cfg: any): Promise<void> {
        for (const node of cfg.nodes.values()) {
            if (!node.code) continue;

            const callPattern = /(?:invoke|call|transfer|cross_program_invoke)\s*\((.*?)\)/g;
            let match;

            while ((match = callPattern.exec(node.code)) !== null) {
                this.externalCalls.push({
                    target: this.extractCallTarget(match[1]),
                    line: node.line,
                    column: node.column,
                    stateBefore: this.getStateBefore(node),
                    stateAfter: this.getStateAfter(node),
                    function: this.getCurrentFunction(node)
                });
            }
        }
    }

    private async identifyReentrancyGuards(cfg: any): Promise<void> {
        const guardPatterns = [
            /ReentrancyGuard/,
            /nonReentrant/,
            /mutex/,
            /locked\s*=\s*true/
        ];

        for (const node of cfg.nodes.values()) {
            if (!node.code) continue;

            // Check for guard implementations
            if (guardPatterns.some(pattern => pattern.test(node.code))) {
                const functionName = this.getCurrentFunction(node);
                if (functionName) {
                    this.guardedFunctions.add(functionName);
                }
            }
        }
    }

    private async analyzePattern(
        pattern: ReentrancyPattern,
        cfg: any
    ): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];

        // Find functions matching the pattern
        for (const node of cfg.nodes.values()) {
            if (!node.code || !pattern.pattern.entryPoint.test(node.code)) continue;

            const functionName = this.getCurrentFunction(node);
            if (!functionName || this.guardedFunctions.has(functionName)) continue;

            const reachableNodes = cfg.getSuccessors(node.id);
            let foundStateModification = false;
            let foundExternalCall = false;
            let stateModificationLine = 0;
            let externalCallLine = 0;

            // Check pattern sequence
            for (const reachableId of reachableNodes) {
                const reachableNode = cfg.getNode(reachableId);
                if (!reachableNode?.code) continue;

                if (pattern.pattern.stateModification.test(reachableNode.code)) {
                    foundStateModification = true;
                    stateModificationLine = reachableNode.line;
                }

                if (pattern.pattern.externalCall.test(reachableNode.code)) {
                    foundExternalCall = true;
                    externalCallLine = reachableNode.line;
                }

                // Check for state modification after external call
                if (foundExternalCall && 
                    foundStateModification && 
                    stateModificationLine > externalCallLine) {
                    errors.push({
                        line: node.line,
                        column: node.column,
                        message: pattern.description,
                        severity: pattern.severity,
                        errorType: pattern.id,
                        impact: pattern.impact,
                        remediation: pattern.remediation
                    });
                    break;
                }
            }
        }

        return errors;
    }

    private async findVulnerablePaths(cfg: any): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];
        const paths = await this.findAllPaths(cfg);

        for (const path of paths) {
            const vulnerabilities = this.analyzePathForVulnerabilities(path, cfg);
            errors.push(...vulnerabilities);
        }

        return errors;
    }

    private async findAllPaths(cfg: any): Promise<string[][]> {
        const paths: string[][] = [];
        const visited = new Set<string>();

        const dfs = (nodeId: string, currentPath: string[]) => {
            if (visited.has(nodeId)) return;
            
            currentPath.push(nodeId);
            visited.add(nodeId);

            const node = cfg.getNode(nodeId);
            if (!node) {
                visited.delete(nodeId);
                currentPath.pop();
                return;
            }

            if (node.children.length === 0) {
                paths.push([...currentPath]);
            } else {
                for (const childId of node.children) {
                    dfs(childId, [...currentPath]);
                }
            }

            visited.delete(nodeId);
            currentPath.pop();
        };

        // Start DFS from entry points
        const entryNodes = Array.from(cfg.nodes.values())
            .filter((node: any) => node.parents.length === 0)
            .map((node: any) => node.id);

        for (const entryId of entryNodes) {
            dfs(entryId, []);
        }

        return paths;
    }

    private analyzePathForVulnerabilities(
        path: string[],
        cfg: any
    ): ValidationError[] {
        const errors: ValidationError[] = [];
        let lastExternalCall: ExternalCall | null = null;
        let stateModificationsAfterCall: StateAccess[] = [];

        for (const nodeId of path) {
            const node = cfg.getNode(nodeId);
            if (!node?.code) continue;

            // Check for external calls
            const call = this.findExternalCall(node);
            if (call) {
                if (lastExternalCall) {
                    // Check for state modifications between calls
                    if (stateModificationsAfterCall.length > 0) {
                        errors.push({
                            line: call.line,
                            column: call.column,
                            message: 'Potential cross-function reentrancy vulnerability',
                            severity: 'high',
                            errorType: 'CROSS_FUNCTION_REENTRANCY',
                            impact: 'Multiple external calls with state modifications',
                            remediation: 'Implement contract-wide reentrancy guard'
                        });
                    }
                }
                lastExternalCall = call;
                stateModificationsAfterCall = [];
            }

            // Track state modifications
            const stateAccesses = this.findStateModifications(node);
            if (lastExternalCall) {
                stateModificationsAfterCall.push(...stateAccesses);
            }
        }

        return errors;
    }

    private findExternalCall(node: any): ExternalCall | null {
        return this.externalCalls.find(call =>
            call.line === node.line && call.column === node.column
        ) || null;
    }

    private findStateModifications(node: any): StateAccess[] {
        const modifications: StateAccess[] = [];
        for (const [_, accesses] of this.stateAccesses) {
            modifications.push(...accesses.filter(access =>
                access.location.line === node.line &&
                access.location.column === node.column &&
                access.type === 'write'
            ));
        }
        return modifications;
    }
