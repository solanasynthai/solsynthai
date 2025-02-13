// File: /backend/src/services/security/utils/CFGBuilder.ts

import { EventEmitter } from 'events';
import { ValidationError } from '../../types';
import { logger } from '../../../utils/logger';

interface CFGNode {
    id: string;
    type: 'entry' | 'exit' | 'basic' | 'branch' | 'merge';
    code?: string;
    line: number;
    column: number;
    children: string[];
    parents: string[];
    data: {
        variables?: Set<string>;
        conditions?: Set<string>;
        loops?: boolean;
        functionName?: string;
        isEntry?: boolean;
        isExit?: boolean;
    };
}

interface BasicBlock {
    id: string;
    instructions: string[];
    start: number;
    end: number;
    successors: string[];
    predecessors: string[];
}

interface Loop {
    header: string;
    body: Set<string>;
    exits: Set<string>;
}

interface FunctionContext {
    name: string;
    parameters: string[];
    returnType?: string;
    startLine: number;
    endLine: number;
}

export class CFGBuilder extends EventEmitter {
    private nodes: Map<string, CFGNode>;
    private basicBlocks: Map<string, BasicBlock>;
    private loops: Map<string, Loop>;
    private functions: Map<string, FunctionContext>;
    private currentFunctionName: string | null;
    private nodeCounter: number;
    private blockCounter: number;
    private readonly commentRegex = /(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g;
    private readonly statementEndRegex = /[;{}]/g;

    constructor() {
        super();
        this.nodes = new Map();
        this.basicBlocks = new Map();
        this.loops = new Map();
        this.functions = new Map();
        this.currentFunctionName = null;
        this.nodeCounter = 0;
        this.blockCounter = 0;
    }

    public buildFromCode(code: string): any {
        try {
            // Clean code
            const cleanedCode = this.preprocessCode(code);
            
            // Parse code into AST-like structure
            const statements = this.parseCode(cleanedCode);
            
            // Create entry node
            const entryNode = this.createNode('entry');
            let currentNode = entryNode;

            // Process each statement
            for (const stmt of statements) {
                currentNode = this.processStatement(stmt, currentNode);
            }

            // Create exit node and connect
            const exitNode = this.createNode('exit');
            this.connect(currentNode, exitNode);

            // Identify and analyze loops
            this.identifyLoops();

            // Validate graph structure
            this.validateGraph();

            return {
                nodes: this.nodes,
                basicBlocks: this.basicBlocks,
                loops: this.loops,
                functions: this.functions,
                entry: entryNode.id,
                exit: exitNode.id,
                getNodeCount: () => this.nodes.size,
                getEdgeCount: () => this.countEdges(),
                findLoops: () => Array.from(this.loops.values()),
                getNode: (id: string) => this.nodes.get(id),
                getSuccessors: (id: string) => this.nodes.get(id)?.children || [],
                getPredecessors: (id: string) => this.nodes.get(id)?.parents || [],
                getAllPaths: () => this.findAllPaths(entryNode.id, exitNode.id),
                getBasicBlocks: () => Array.from(this.basicBlocks.values()),
                getConnectedComponents: () => this.findConnectedComponents(),
                getDominators: (nodeId: string) => this.getDominators(nodeId),
                getPostDominators: (nodeId: string) => this.getPostDominators(nodeId),
                findCycles: () => this.findCycles(),
                getNodeInfo: (nodeId: string) => this.getNodeInfo(nodeId),
                getLoopInfo: (nodeId: string) => this.getLoopInfo(nodeId),
                getFunctionContext: (name: string) => this.getFunctionContext(name),
                validatePath: (path: string[]) => this.validatePath(path),
                identifyDeadCode: () => this.identifyDeadCode(),
                optimizeGraph: () => this.optimizeGraph(),
                serializeGraph: () => this.serializeGraph(),
                cleanup: () => this.cleanup()
            };

        } catch (error) {
            logger.error('CFG construction failed', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    private preprocessCode(code: string): string {
        // Remove comments
        code = code.replace(this.commentRegex, '');
        
        // Normalize whitespace
        code = code.replace(/\s+/g, ' ').trim();
        
        // Ensure proper statement termination
        code = code.replace(/([^;{}])\n/g, '$1;\n');
        
        return code;
    }

    private parseCode(code: string): any[] {
        const statements: any[] = [];
        let currentBlock: string[] = [];
        let bracketCount = 0;
        let currentFunction: FunctionContext | null = null;

        const lines = code.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Count brackets for block detection
            bracketCount += (line.match(/{/g) || []).length;
            bracketCount -= (line.match(/}/g) || []).length;

            // Function detection
            if (line.startsWith('fn ')) {
                const functionMatch = line.match(/fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.*?)\)(?:\s*->\s*([a-zA-Z_][a-zA-Z0-9_<>]*))?\s*{/);
                if (functionMatch) {
                    currentFunction = {
                        name: functionMatch[1],
                        parameters: functionMatch[2].split(',').map(p => p.trim()),
                        returnType: functionMatch[3],
                        startLine: i + 1,
                        endLine: -1
                    };
                    this.functions.set(currentFunction.name, currentFunction);
                    statements.push({
                        type: 'function',
                        context: currentFunction,
                        line: i + 1,
                        code: line
                    });
                    continue;
                }
            }

            // Control flow statements
            if (line.startsWith('if ') || line.startsWith('match ')) {
                statements.push(this.parseControlFlow(line, i + 1));
                continue;
            }

            // Loop statements
            if (line.startsWith('while ') || line.startsWith('for ')) {
                statements.push(this.parseLoop(line, i + 1));
                continue;
            }

            // Return statements
            if (line.startsWith('return')) {
                statements.push({
                    type: 'return',
                    code: line,
                    line: i + 1
                });
                
                if (currentFunction) {
                    currentFunction.endLine = i + 1;
                }
                continue;
            }

            // Handle basic statements
            if (line.endsWith(';') || line.endsWith('}')) {
                currentBlock.push(line);
                if (bracketCount === 0) {
                    statements.push({
                        type: 'basic',
                        code: currentBlock.join('\n'),
                        line: i + 1 - currentBlock.length
                    });
                    currentBlock = [];
                }
            } else {
                currentBlock.push(line);
            }
        }

        return statements;
    }

    private parseControlFlow(line: string, lineNumber: number): any {
        const condition = line.match(/(?:if|match)\s+(.+?)\s*{/)?.[1];
        return {
            type: 'branch',
            condition,
            line: lineNumber,
            code: line
        };
    }

    private parseLoop(line: string, lineNumber: number): any {
        const condition = line.match(/(?:while|for)\s+(.+?)\s*{/)?.[1];
        return {
            type: 'loop',
            condition,
            line: lineNumber,
            code: line
        };
    }

    private processStatement(stmt: any, currentNode: CFGNode): CFGNode {
        switch (stmt.type) {
            case 'function':
                return this.processFunctionStatement(stmt, currentNode);
            case 'branch':
                return this.processBranchStatement(stmt, currentNode);
            case 'loop':
                return this.processLoopStatement(stmt, currentNode);
            case 'return':
                return this.processReturnStatement(stmt, currentNode);
            default:
                return this.processBasicStatement(stmt, currentNode);
        }
    }

    private processFunctionStatement(stmt: any, currentNode: CFGNode): CFGNode {
        this.currentFunctionName = stmt.context.name;
        const node = this.createNode('basic', {
            code: stmt.code,
            line: stmt.line,
            functionName: stmt.context.name
        });
        this.connect(currentNode, node);
        return node;
    }

    private processBranchStatement(stmt: any, currentNode: CFGNode): CFGNode {
        const branchNode = this.createNode('branch', {
            code: stmt.code,
            line: stmt.line,
            conditions: new Set([stmt.condition])
        });
        this.connect(currentNode, branchNode);

        // Create merge node for branch completion
        const mergeNode = this.createNode('merge');
        
        // Create true branch
        const trueBranch = this.createNode('basic');
        this.connect(branchNode, trueBranch);
        this.connect(trueBranch, mergeNode);

        // Create false branch
        const falseBranch = this.createNode('basic');
        this.connect(branchNode, falseBranch);
        this.connect(falseBranch, mergeNode);

        return mergeNode;
    }

    private processLoopStatement(stmt: any, currentNode: CFGNode): CFGNode {
        const loopHeader = this.createNode('branch', {
            code: stmt.code,
            line: stmt.line,
            conditions: new Set([stmt.condition]),
            loops: true
        });
        this.connect(currentNode, loopHeader);

        // Create loop body
        const loopBody = this.createNode('basic');
        this.connect(loopHeader, loopBody);
        this.connect(loopBody, loopHeader); // Back edge

        // Create loop exit
        const loopExit = this.createNode('basic');
        this.connect(loopHeader, loopExit);

        // Record loop information
        this.loops.set(loopHeader.id, {
            header: loopHeader.id,
            body: new Set([loopBody.id]),
            exits: new Set([loopExit.id])
        });

        return loopExit;
    }

    private processReturnStatement(stmt: any, currentNode: CFGNode): CFGNode {
        const node = this.createNode('basic', {
            code: stmt.code,
            line: stmt.line,
            isExit: true
        });
        this.connect(currentNode, node);
        return node;
    }

    private processBasicStatement(stmt: any, currentNode: CFGNode): CFGNode {
        const node = this.createNode('basic', {
            code: stmt.code,
            line: stmt.line
        });
        this.connect(currentNode, node);
        return node;
    }

    private createNode(type: CFGNode['type'], data: Partial<CFGNode['data']> = {}): CFGNode {
        const id = `node_${++this.nodeCounter}`;
        const node: CFGNode = {
            id,
            type,
            line: 0,
            column: 0,
            children: [],
            parents: [],
            data: {
                variables: new Set(),
                conditions: new Set(),
                loops: false,
                ...data
            }
        };
        this.nodes.set(id, node);
        return node;
    }

    private connect(from: CFGNode, to: CFGNode): void {
        from.children.push(to.id);
        to.parents.push(from.id);
    }

    private validateGraph(): void {
        // Check for unreachable nodes
        const reachable = this.findReachableNodes();
        for (const [nodeId, node] of this.nodes) {
            if (!reachable.has(nodeId)) {
                logger.warn('Unreachable node detected', { nodeId, node });
            }
        }

        // Check for proper entry/exit nodes
        const entryNodes = Array.from(this.nodes.values())
            .filter(node => node.parents.length === 0);
        const exitNodes = Array.from(this.nodes.values())
            .filter(node => node.children.length === 0);

        if (entryNodes.length !== 1) {
            logger.warn('Invalid number of entry nodes', { count: entryNodes.length });
        }
        if (exitNodes.length === 0) {
            logger.warn('No exit nodes found');
        }

        // Check for consistency
        for (const [nodeId, node] of this.nodes) {
            // Validate parent-child relationships
            for (const childId of node.children) {
                const child = this.nodes.get(childId);
                if (!child) {
                    logger.error('Invalid child reference', { nodeId, childId });
                    continue;
                }
                if (!child.parents.includes(nodeId)) {
                    logger.error('Inconsistent parent-child relationship', {
                        nodeId,
                        childId
                    });
                }
            }

            // Validate data consistency
            if (node.type === 'branch' && !node.data.conditions?.size) {
                logger.warn('Branch node without conditions', { nodeId });
            }
        }
    }

    private identifyLoops(): void {
        const visited = new Set<string>();
        const stack = new Set<string>();

        const dfs = (nodeId: string) => {
            if (stack.has(nodeId)) {
                // Found a back edge, identify loop
                this.analyzeLoop(nodeId, stack);
                return;
            }

            if (visited.has(nodeId)) return;

            visited.add(nodeId);
            stack.add(nodeId);

            const node = this.nodes.get(nodeId);
            if (node) {
                for (const childId of node.children) {
                    dfs(childId);
                }
            }

            stack.delete(nodeId);
        };

        // Start DFS from entry nodes
        for (const [nodeId, node] of this.nodes) {
            if (node.parents.length === 0) {
                dfs(nodeId);
            }
        }
    }

    private analyzeLoop(headerNodeId: string, stack: Set<string>): void {
        const loopNodes = new Set<string>();
        const exits = new Set<string>();

        // Collect loop nodes
        for (const nodeId of stack) {
            loopNodes.add(nodeId);
        }

        // Find exit nodes
        for (const nodeId of loopNodes) {
            const node = this.nodes.get(nodeId);
            if (node) {
                for (const childId of node.children) {
                    if (!loopNodes.has(childId)) {
                        exits.add(childId);
                    }
                }
            }
        }

        this.loops.set(headerNodeId, {
            header: headerNodeId,
            body: loopNodes,
            exits
        });
    }

    private findReachableNodes(): Set<string> {
        const reachable = new Set<string>();
        const stack: string[] = [];

        // Start from entry nodes
        for (const [nodeId, node] of this.nodes) {
            if (node.parents.length === 0) {
                stack.push(nodeId);
            }
        }

        // DFS
        while (stack.length > 0) {
            const nodeId = stack.pop()!;
            if (reachable.has(nodeId)) continue;

            reachable.add(nodeId);
            const node = this.nodes.get(nodeId);
            if (node) {
                stack.push(...node.children);
            }
        }

        return reachable;
    }

    private findAllPaths(start: string, end: string): string[][] {
        const paths: string[][] = [];
        const visited = new Set<string>();

        const dfs = (current: string, path: string[]) => {
            if (visited.has(current)) return;
            if (current === end) {
                paths.push([...path, current]);
                return;
            }

            visited.add(current);
            path.push(current);

            const node = this.nodes.get(current);
            if (node) {
                for (const childId of node.children) {
                    dfs(childId, [...path]);
                }
            }

            visited.delete(current);
        };

        dfs(start, []);
        return paths;
    }

    private findConnectedComponents(): string[][] {
        const components: string[][] = [];
        const visited = new Set<string>();

        const dfs = (nodeId: string, component: string[]) => {
            if (visited.has(nodeId)) return;

            visited.add(nodeId);
            component.push(nodeId);

            const node = this.nodes.get(nodeId);
            if (node) {
                for (const childId of node.children) {
                    dfs(childId, component);
                }
                for (const parentId of node.parents) {
                    dfs(parentId, component);
                }
            }
        };

        // Find components starting from each unvisited node
        for (const nodeId of this.nodes.keys()) {
            if (!visited.has(nodeId)) {
                const component: string[] = [];
                dfs(nodeId, component);
                if (component.length > 0) {
                    components.push(component);
                }
            }
        }

        return components;
    }

    private getLoopInfo(nodeId: string): Loop | null {
        // Check if node is a loop header
        if (this.loops.has(nodeId)) {
            return this.loops.get(nodeId)!;
        }

        // Check if node is part of any loop
        for (const [headerId, loop] of this.loops) {
            if (loop.body.has(nodeId)) {
                return loop;
            }
        }

        return null;
    }

    private getFunctionContext(name: string): FunctionContext | null {
        return this.functions.get(name) || null;
    }

    private validatePath(path: string[]): boolean {
        for (let i = 0; i < path.length - 1; i++) {
            const node = this.nodes.get(path[i]);
            if (!node || !node.children.includes(path[i + 1])) {
                return false;
            }
        }
        return true;
    }

    private identifyDeadCode(): string[] {
        const deadNodes: string[] = [];
        const reachable = this.findReachableNodes();

        for (const nodeId of this.nodes.keys()) {
            if (!reachable.has(nodeId)) {
                deadNodes.push(nodeId);
            }
        }

        return deadNodes;
    }

    private optimizeGraph(): void {
        // Remove empty nodes
        for (const [nodeId, node] of this.nodes) {
            if (node.type === 'basic' && !node.code?.trim()) {
                this.removeNode(nodeId);
            }
        }

        // Merge consecutive basic blocks
        let changed = true;
        while (changed) {
            changed = false;
            for (const [nodeId, node] of this.nodes) {
                if (node.type === 'basic' && node.children.length === 1) {
                    const child = this.nodes.get(node.children[0]);
                    if (child && child.type === 'basic' && child.parents.length === 1) {
                        this.mergeNodes(node, child);
                        changed = true;
                        break;
                    }
                }
            }
        }
    }

    private removeNode(nodeId: string): void {
        const node = this.nodes.get(nodeId);
        if (!node) return;

        // Reconnect parents to children
        for (const parentId of node.parents) {
            const parent = this.nodes.get(parentId);
            if (parent) {
                parent.children = parent.children.filter(id => id !== nodeId);
                parent.children.push(...node.children);
            }
        }

        for (const childId of node.children) {
            const child = this.nodes.get(childId);
            if (child) {
                child.parents = child.parents.filter(id => id !== nodeId);
                child.parents.push(...node.parents);
            }
        }

        this.nodes.delete(nodeId);
    }

    private mergeNodes(node1: CFGNode, node2: CFGNode): void {
        // Combine code
        node1.code = `${node1.code || ''}\n${node2.code || ''}`;
        
        // Update edges
        node1.children = node2.children;
        for (const childId of node2.children) {
            const child = this.nodes.get(childId);
            if (child) {
                child.parents = child.parents.filter(id => id !== node2.id);
                child.parents.push(node1.id);
            }
        }

        // Update data
        node1.data.variables = new Set([
            ...(node1.data.variables || []),
            ...(node2.data.variables || [])
        ]);

        // Remove merged node
        this.nodes.delete(node2.id);
    }

    private serializeGraph(): string {
        return JSON.stringify({
            nodes: Array.from(this.nodes.entries()),
            basicBlocks: Array.from(this.basicBlocks.entries()),
            loops: Array.from(this.loops.entries()),
            functions: Array.from(this.functions.entries())
        }, null, 2);
    }

    public cleanup(): void {
        this.nodes.clear();
        this.basicBlocks.clear();
        this.loops.clear();
        this.functions.clear();
        this.currentFunctionName = null;
        this.nodeCounter = 0;
        this.blockCounter = 0;
        this.removeAllListeners();
    }
}
