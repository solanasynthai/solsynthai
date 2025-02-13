import { EventEmitter } from 'events';
import { ValidationError } from '../../types';
import { CFGBuilder } from './CFGBuilder';
import { logger } from '../../../utils/logger';

interface DataFlowNode {
    id: string;
    type: 'entry' | 'exit' | 'instruction' | 'branch' | 'merge';
    code?: string;
    line: number;
    column: number;
    def?: Set<string>;
    use?: Set<string>;
    in?: Set<string>;
    out?: Set<string>;
    predecessors: Set<string>;
    successors: Set<string>;
    data: {
        variables?: Map<string, DataFlowValue>;
        taint?: Set<string>;
        constraints?: Map<string, Constraint>;
    };
}

interface DataFlowValue {
    type: 'constant' | 'variable' | 'expression';
    value: any;
    tainted: boolean;
    origin?: string;
    dependencies?: Set<string>;
}

interface Constraint {
    type: 'range' | 'null' | 'type' | 'custom';
    value: any;
    condition: string;
}

interface TaintSource {
    name: string;
    type: 'input' | 'storage' | 'external';
    pattern: RegExp;
}

interface DataFlowPath {
    nodes: string[];
    variables: Set<string>;
    taint: Set<string>;
    constraints: Map<string, Constraint>;
}

export class DataFlowAnalyzer extends EventEmitter {
    private cfg: any;
    private nodes: Map<string, DataFlowNode>;
    private workList: Set<string>;
    private taintSources: TaintSource[];
    private analyzed: boolean;
    private maxIterations: number = 1000;

    constructor() {
        super();
        this.nodes = new Map();
        this.workList = new Set();
        this.analyzed = false;
        this.initializeTaintSources();
    }

    private initializeTaintSources(): void {
        this.taintSources = [
            {
                name: 'user_input',
                type: 'input',
                pattern: /accounts\[\d+\]\.data|instruction_data/
            },
            {
                name: 'storage',
                type: 'storage',
                pattern: /load|get_storage|read_data/
            },
            {
                name: 'external_call',
                type: 'external',
                pattern: /invoke|call|transfer/
            }
        ];
    }

    public async analyze(cfg: any): Promise<ValidationError[]> {
        this.cfg = cfg;
        const errors: ValidationError[] = [];
        const startTime = Date.now();

        try {
            // Initialize analysis
            this.initializeAnalysis();

            // Perform reaching definitions analysis
            await this.performReachingDefinitions();

            // Perform taint analysis
            const taintIssues = await this.performTaintAnalysis();
            errors.push(...taintIssues);

            // Analyze control dependencies
            const controlIssues = await this.analyzeControlDependencies();
            errors.push(...controlIssues);

            // Analyze data dependencies
            const dataIssues = await this.analyzeDataDependencies();
            errors.push(...dataIssues);

            // Find unsafe paths
            const pathIssues = await this.findUnsafePaths();
            errors.push(...pathIssues);

            this.analyzed = true;
            this.emit('analysis:complete', {
                duration: Date.now() - startTime,
                issues: errors.length
            });

            return errors;

        } catch (error) {
            logger.error('Data flow analysis failed', {
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

    private initializeAnalysis(): void {
        this.nodes.clear();
        this.workList.clear();

        // Create nodes from CFG
        this.cfg.nodes.forEach((cfgNode: any) => {
            const node: DataFlowNode = {
                id: cfgNode.id,
                type: this.getNodeType(cfgNode),
                code: cfgNode.code,
                line: cfgNode.line,
                column: cfgNode.column,
                def: new Set(this.extractDefinitions(cfgNode)),
                use: new Set(this.extractUses(cfgNode)),
                in: new Set(),
                out: new Set(),
                predecessors: new Set(cfgNode.predecessors),
                successors: new Set(cfgNode.successors),
                data: {
                    variables: new Map(),
                    taint: new Set(),
                    constraints: new Map()
                }
            };

            this.nodes.set(node.id, node);
            this.workList.add(node.id);
        });
    }

    private async performReachingDefinitions(): Promise<void> {
        let iterations = 0;
        
        while (this.workList.size > 0 && iterations < this.maxIterations) {
            const nodeId = Array.from(this.workList)[0];
            this.workList.delete(nodeId);
            const node = this.nodes.get(nodeId)!;

            // Calculate new IN set
            const newIn = new Set<string>();
            for (const predId of node.predecessors) {
                const pred = this.nodes.get(predId);
                if (pred && pred.out) {
                    for (const def of pred.out) {
                        newIn.add(def);
                    }
                }
            }

            // Calculate new OUT set
            const newOut = new Set(newIn);
            if (node.def) {
                for (const def of node.def) {
                    newOut.add(def);
                }
            }

            // Check for changes
            if (!this.setsEqual(newIn, node.in!) || !this.setsEqual(newOut, node.out!)) {
                node.in = newIn;
                node.out = newOut;
                
                // Add successors to worklist
                for (const succId of node.successors) {
                    this.workList.add(succId);
                }
            }

            iterations++;
        }

        if (iterations >= this.maxIterations) {
            logger.warn('Reaching definitions analysis reached maximum iterations', {
                iterations,
                maxIterations: this.maxIterations
            });
        }
    }

    private async performTaintAnalysis(): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];
        
        // Identify initial taint sources
        for (const [nodeId, node] of this.nodes) {
            if (node.code) {
                for (const source of this.taintSources) {
                    if (source.pattern.test(node.code)) {
                        node.data.taint?.add(source.name);
                        
                        // Track variables defined in tainted node
                        if (node.def) {
                            for (const def of node.def) {
                                if (node.data.variables) {
                                    node.data.variables.set(def, {
                                        type: 'variable',
                                        value: undefined,
                                        tainted: true,
                                        origin: source.name
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        // Propagate taint
        let changes = true;
        let iterations = 0;
        
        while (changes && iterations < this.maxIterations) {
            changes = false;
            
            for (const [nodeId, node] of this.nodes) {
                const oldTaint = new Set(node.data.taint);
                
                // Propagate taint from predecessors
                for (const predId of node.predecessors) {
                    const pred = this.nodes.get(predId);
                    if (pred && pred.data.taint) {
                        for (const taint of pred.data.taint) {
                            node.data.taint?.add(taint);
                        }
                    }
                }

                // Propagate taint through variable uses
                if (node.use) {
                    for (const use of node.use) {
                        // Check if any reaching definition is tainted
                        for (const predId of node.predecessors) {
                            const pred = this.nodes.get(predId);
                            if (pred?.data.variables?.get(use)?.tainted) {
                                node.data.taint?.add('propagated');
                                break;
                            }
                        }
                    }
                }

                // Check for taint in sensitive operations
                if (node.data.taint?.size && this.isSensitiveOperation(node)) {
                    errors.push({
                        line: node.line,
                        column: node.column,
                        message: `Potentially tainted data used in sensitive operation`,
                        severity: 'high'
                    });
                }

                // Check if taint changed
                if (!this.setsEqual(oldTaint, node.data.taint!)) {
                    changes = true;
                }
            }

            iterations++;
        }

        if (iterations >= this.maxIterations) {
            logger.warn('Taint analysis reached maximum iterations', {
                iterations,
                maxIterations: this.maxIterations
            });
        }

        return errors;
    }

    private async analyzeControlDependencies(): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];
        const controlDependencies = new Map<string, Set<string>>();

        // Build post-dominator tree
        const postDomTree = this.buildPostDominatorTree();

        // Find control dependencies
        for (const [nodeId, node] of this.nodes) {
            if (node.type === 'branch') {
                const affected = new Set<string>();
                this.findControlDependentNodes(nodeId, postDomTree, affected);
                controlDependencies.set(nodeId, affected);

                // Check for tainted conditions affecting sensitive operations
                if (node.data.taint?.size) {
                    for (const affectedId of affected) {
                        const affectedNode = this.nodes.get(affectedId);
                        if (affectedNode && this.isSensitiveOperation(affectedNode)) {
                            errors.push({
                                line: node.line,
                                column: node.column,
                                message: `Tainted condition controls sensitive operation at line ${affectedNode.line}`,
                                severity: 'high'
                            });
                        }
                    }
                }
            }
        }

        return errors;
    }

    private async analyzeDataDependencies(): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];
        const dataDependencies = new Map<string, Set<string>>();

        for (const [nodeId, node] of this.nodes) {
            const dependencies = new Set<string>();

            // Find data dependencies through use-def chains
            if (node.use) {
                for (const use of node.use) {
                    for (const predId of node.predecessors) {
                        const pred = this.nodes.get(predId);
                        if (pred?.def?.has(use)) {
                            dependencies.add(predId);
                        }
                    }
                }
            }

            dataDependencies.set(nodeId, dependencies);

            // Check for circular dependencies
            if (this.hasCircularDependency(nodeId, dependencies, new Set())) {
                errors.push({
                    line: node.line,
                    column: node.column,
                    message: 'Circular data dependency detected',
                    severity: 'medium'
                });
            }

            // Check for dependencies on tainted data
            for (const depId of dependencies) {
                const dep = this.nodes.get(depId);
                if (dep?.data.taint?.size && this.isSensitiveOperation(node)) {
                    errors.push({
                        line: node.line,
                        column: node.column,
                        message: `Sensitive operation depends on tainted data from line ${dep.line}`,
                        severity: 'high'
                    });
                }
            }
        }

        return errors;
    }

    private async findUnsafePaths(): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];
        const entryNodes = this.findEntryNodes();
        const exitNodes = this.findExitNodes();

        for (const entryId of entryNodes) {
            const visited = new Set<string>();
            const path: DataFlowPath = {
                nodes: [],
                variables: new Set(),
                taint: new Set(),
                constraints: new Map()
            };

            await this.explorePaths(entryId, exitNodes, visited, path, errors);
        }

        return errors;
    }

    private async explorePaths(
        nodeId: string,
        exitNodes: Set<string>,
        visited: Set<string>,
        path: DataFlowPath,
        errors: ValidationError[]
    ): Promise<void> {
        if (visited.has(nodeId)) return;
        
        const node = this.nodes.get(nodeId);
        if (!node) return;

        visited.add(nodeId);
        path.nodes.push(nodeId);

        // Update path state
        if (node.def) {
            for (const def of node.def) {
                path.variables.add(def);
            }
        }
        if (node.data.taint) {
            for (const taint of node.data.taint) {
                path.taint.add(taint);
            }
        }
        if (node.data.constraints) {
            for (const [var_, constraint] of node.data.constraints) {
                path.constraints.set(var_, constraint);
            }
        }

        // Check for unsafe conditions
        if (this.isUnsafePath(path)) {
            errors.push({
                line: node.line,
                column: node.column,
                message: 'Potentially unsafe execution path detected',
                severity: 'medium'
            });
        }

        // Continue exploration
        for (const succId of node.successors) {
            await this.explorePaths(
                succId,
                exitNodes,
                new Set(visited),
                {
                    nodes: [...path.nodes],
                    variables: new Set(path.variables),
                    taint: new Set(path.taint),
                    constraints: new Map(path.constraints)
                },
                errors
            );
        }
    }

    private getNodeType(cfgNode: any): DataFlowNode['type'] {
        if (cfgNode.isEntry) return 'entry';
        if (cfgNode.isExit) return 'exit';
        if (cfgNode.isBranch) return 'branch';
        if (cfgNode.isMerge) return 'merge';
        return 'instruction';
    }

    private extractDefinitions(cfgNode: any): string[] {
        const defs: string[] = [];
        if (cfgNode.code) {
            // Match variable assignments
            const assignmentRegex = /\b(\w+)\s*(?::\s*\w+)?\s*=\s*[^=]/g;
            let match;
            while ((match = assignmentRegex.exec(cfgNode.code)) !== null) {
                defs.push(match[1]);
            }

            // Match mutation patterns
            const mutationRegex = /\b(\w+)(?:\.\w+)*\s*(?:\+=|-=|\*=|\/=|%=)/g;
            while ((match = mutationRegex.exec(cfgNode.code)) !== null) {
                defs.push(match[1]);
            }

            // Match function parameters
            const paramRegex = /fn\s+\w+\s*\(([^)]*)\)/g;
            while ((match = paramRegex.exec(cfgNode.code)) !== null) {
                const params = match[1].split(',');
                for (const param of params) {
                    const paramName = param.trim().split(':')[0].trim();
                    if (paramName) defs.push(paramName);
                }
            }
        }
        return [...new Set(defs)];
    }

    private extractUses(cfgNode: any): string[] {
        const uses: string[] = [];
        if (cfgNode.code) {
            // Match variable uses in expressions
            const useRegex = /\b(\w+)\b(?!\s*(?:=|:))/g;
            let match;
            while ((match = useRegex.exec(cfgNode.code)) !== null) {
                uses.push(match[1]);
            }

            // Remove keywords and function names
            const keywords = new Set(['fn', 'let', 'mut', 'if', 'else', 'while', 'for', 'return']);
            return [...new Set(uses)].filter(use => !keywords.has(use));
        }
        return uses;
    }

    private buildPostDominatorTree(): Map<string, Set<string>> {
        const postDom = new Map<string, Set<string>>();
        const exitNodes = this.findExitNodes();

        // Initialize post-dominators
        for (const [nodeId, _] of this.nodes) {
            postDom.set(nodeId, new Set(this.nodes.keys()));
        }

        // Set exit nodes to only post-dominate themselves
        for (const exitId of exitNodes) {
            postDom.set(exitId, new Set([exitId]));
        }

        // Iteratively update post-dominators
        let changed = true;
        while (changed) {
            changed = false;
            for (const [nodeId, node] of this.nodes) {
                if (exitNodes.has(nodeId)) continue;

                const oldPostDom = new Set(postDom.get(nodeId));
                const newPostDom = new Set([nodeId]);

                // Intersect post-dominators of all successors
                let first = true;
                for (const succId of node.successors) {
                    const succPostDom = postDom.get(succId);
                    if (succPostDom) {
                        if (first) {
                            newPostDom.clear();
                            for (const id of succPostDom) {
                                newPostDom.add(id);
                            }
                            first = false;
                        } else {
                            for (const id of newPostDom) {
                                if (!succPostDom.has(id)) {
                                    newPostDom.delete(id);
                                }
                            }
                        }
                    }
                }

                newPostDom.add(nodeId);

                if (!this.setsEqual(oldPostDom, newPostDom)) {
                    postDom.set(nodeId, newPostDom);
                    changed = true;
                }
            }
        }

        return postDom;
    }

    private findControlDependentNodes(
        nodeId: string,
        postDomTree: Map<string, Set<string>>,
        affected: Set<string>
    ): void {
        const node = this.nodes.get(nodeId);
        if (!node) return;

        for (const succId of node.successors) {
            if (!postDomTree.get(nodeId)?.has(succId)) {
                this.findAffectedNodes(succId, postDomTree.get(nodeId), affected);
            }
        }
    }

    private findAffectedNodes(
        nodeId: string,
        postDominators: Set<string> | undefined,
        affected: Set<string>
    ): void {
        if (!postDominators || affected.has(nodeId)) return;

        affected.add(nodeId);
        const node = this.nodes.get(nodeId);
        if (!node) return;

        for (const succId of node.successors) {
            if (!postDominators.has(succId)) {
                this.findAffectedNodes(succId, postDominators, affected);
            }
        }
    }

    private hasCircularDependency(
        nodeId: string,
        dependencies: Set<string>,
        visited: Set<string>
    ): boolean {
        if (visited.has(nodeId)) return true;
        visited.add(nodeId);

        for (const depId of dependencies) {
            const depDeps = this.nodes.get(depId)?.data.variables?.keys() || [];
            for (const dep of depDeps) {
                if (this.hasCircularDependency(dep, dependencies, new Set(visited))) {
                    return true;
                }
            }
        }

        return false;
    }

    private findEntryNodes(): Set<string> {
        const entryNodes = new Set<string>();
        for (const [nodeId, node] of this.nodes) {
            if (node.type === 'entry' || node.predecessors.size === 0) {
                entryNodes.add(nodeId);
            }
        }
        return entryNodes;
    }

    private findExitNodes(): Set<string> {
        const exitNodes = new Set<string>();
        for (const [nodeId, node] of this.nodes) {
            if (node.type === 'exit' || node.successors.size === 0) {
                exitNodes.add(nodeId);
            }
        }
        return exitNodes;
    }

    private isUnsafePath(path: DataFlowPath): boolean {
        // Check for tainted data flow to sensitive operations
        const hasTaintedFlow = path.taint.size > 0 && this.hasPathToSensitiveOperation(path.nodes);

        // Check for constraint violations
        const hasConstraintViolation = this.checkConstraintViolations(path.constraints);

        // Check for unprotected external calls
        const hasUnprotectedCalls = this.hasUnprotectedExternalCalls(path.nodes);

        return hasTaintedFlow || hasConstraintViolation || hasUnprotectedCalls;
    }

    private hasPathToSensitiveOperation(nodes: string[]): boolean {
        for (const nodeId of nodes) {
            const node = this.nodes.get(nodeId);
            if (node && this.isSensitiveOperation(node)) {
                return true;
            }
        }
        return false;
    }

    private checkConstraintViolations(constraints: Map<string, Constraint>): boolean {
        for (const [variable, constraint] of constraints) {
            switch (constraint.type) {
                case 'range':
                    if (!this.isInRange(constraint.value)) return true;
                    break;
                case 'null':
                    if (constraint.value === null) return true;
                    break;
                case 'type':
                    if (!this.isTypeValid(constraint.value, constraint.condition)) return true;
                    break;
            }
        }
        return false;
    }

    private hasUnprotectedExternalCalls(nodes: string[]): boolean {
        let hasExternalCall = false;
        let hasProtection = false;

        for (const nodeId of nodes) {
            const node = this.nodes.get(nodeId);
            if (!node) continue;

            if (node.code?.includes('invoke') || node.code?.includes('call')) {
                hasExternalCall = true;
            }
            if (node.code?.includes('require') || node.code?.includes('assert')) {
                hasProtection = true;
            }
        }

        return hasExternalCall && !hasProtection;
    }

    private isSensitiveOperation(node: DataFlowNode): boolean {
        if (!node.code) return false;

        const sensitivePatterns = [
            /transfer/i,
            /withdraw/i,
            /delete/i,
            /upgrade/i,
            /initialize/i,
            /admin/i,
            /owner/i,
            /auth/i
        ];

        return sensitivePatterns.some(pattern => pattern.test(node.code));
    }

    private isInRange(value: any): boolean {
        if (typeof value !== 'number') return false;
        // Implement range validation logic
        return value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER;
    }

    private isTypeValid(value: any, expectedType: string): boolean {
        switch (expectedType) {
            case 'number':
                return typeof value === 'number';
            case 'string':
                return typeof value === 'string';
            case 'boolean':
                return typeof value === 'boolean';
            case 'pubkey':
                return value instanceof Uint8Array && value.length === 32;
            default:
                return false;
        }
    }

    private setsEqual(a: Set<any>, b: Set<any>): boolean {
        if (a.size !== b.size) return false;
        for (const item of a) {
            if (!b.has(item)) return false;
        }
        return true;
    }

    public async cleanup(): Promise<void> {
        this.nodes.clear();
        this.workList.clear();
        this.analyzed = false;
        this.removeAllListeners();
    }
}
