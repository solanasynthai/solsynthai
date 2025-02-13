import { EventEmitter } from 'events';
import { ValidationError } from '../../types';
import { DataFlowAnalyzer } from '../utils/DataFlowAnalyzer';
import { CFGBuilder } from '../utils/CFGBuilder';
import { BN } from 'bn.js';
import { logger } from '../../../utils/logger';

interface ArithmeticOperation {
    type: 'addition' | 'subtraction' | 'multiplication' | 'division' | 'modulo';
    operator: string;
    line: number;
    column: number;
    leftOperand: string;
    rightOperand: string;
    dataType: 'u8' | 'u16' | 'u32' | 'u64' | 'i8' | 'i16' | 'i32' | 'i64';
    isChecked: boolean;
}

interface VariableRange {
    min: BN;
    max: BN;
    isConstrained: boolean;
}

interface OverflowContext {
    operation: ArithmeticOperation;
    ranges: Map<string, VariableRange>;
    constraints: Map<string, string>;
    path: string[];
}

export class OverflowAnalyzer extends EventEmitter {
    private dataFlowAnalyzer: DataFlowAnalyzer;
    private cfgBuilder: CFGBuilder;
    private operations: ArithmeticOperation[];
    private variableRanges: Map<string, VariableRange>;
    private maxIterations: number = 1000;

    constructor() {
        super();
        this.dataFlowAnalyzer = new DataFlowAnalyzer();
        this.cfgBuilder = new CFGBuilder();
        this.operations = [];
        this.variableRanges = new Map();
    }

    public async analyze(code: string): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];
        const startTime = Date.now();

        try {
            // Build CFG
            const cfg = this.cfgBuilder.buildFromCode(code);

            // Reset analysis state
            this.operations = [];
            this.variableRanges.clear();

            // Identify arithmetic operations
            await this.identifyArithmeticOperations(cfg);

            // Analyze each operation for potential overflow
            for (const operation of this.operations) {
                const context: OverflowContext = {
                    operation,
                    ranges: new Map(this.variableRanges),
                    constraints: new Map(),
                    path: []
                };

                const overflowIssues = await this.analyzeOperation(context);
                errors.push(...overflowIssues);
            }

            // Check for unchecked operations in loops
            const loopIssues = await this.analyzeLoopOperations(cfg);
            errors.push(...loopIssues);

            this.emit('analysis:complete', {
                duration: Date.now() - startTime,
                operations: this.operations.length,
                issues: errors.length
            });

            return errors;

        } catch (error) {
            logger.error('Overflow analysis failed', {
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

    private async identifyArithmeticOperations(cfg: any): Promise<void> {
        for (const node of cfg.nodes.values()) {
            if (!node.code) continue;

            // Match arithmetic operations
            const matches = this.findArithmeticOperations(node.code);
            for (const match of matches) {
                this.operations.push({
                    type: this.getOperationType(match.operator),
                    operator: match.operator,
                    line: node.line,
                    column: match.index,
                    leftOperand: match.left.trim(),
                    rightOperand: match.right.trim(),
                    dataType: this.inferDataType(match.left, match.right),
                    isChecked: this.isCheckedOperation(node.code, match)
                });
            }

            // Extract variable ranges from conditions
            this.extractVariableRanges(node.code);
        }
    }

    private findArithmeticOperations(code: string): Array<{ 
        operator: string; 
        left: string; 
        right: string; 
        index: number;
    }> {
        const operations: Array<{ operator: string; left: string; right: string; index: number }> = [];
        
        // Regular expressions for arithmetic operations
        const operationRegex = /(\w+(?:\[\w+\])?)\s*([\+\-\*\/%]=|\+|\-|\*|\/|%)\s*(\w+(?:\[\w+\])?)/g;
        let match;

        while ((match = operationRegex.exec(code)) !== null) {
            operations.push({
                operator: match[2],
                left: match[1],
                right: match[3],
                index: match.index
            });
        }

        return operations;
    }

    private getOperationType(operator: string): ArithmeticOperation['type'] {
        switch (operator) {
            case '+':
            case '+=':
                return 'addition';
            case '-':
            case '-=':
                return 'subtraction';
            case '*':
            case '*=':
                return 'multiplication';
            case '/':
            case '/=':
                return 'division';
            case '%':
            case '%=':
                return 'modulo';
            default:
                throw new Error(`Unknown operator: ${operator}`);
        }
    }

    private inferDataType(
        leftOperand: string,
        rightOperand: string
    ): ArithmeticOperation['dataType'] {
        // Check for type annotations in the code
        const typeAnnotationRegex = /:\s*(u8|u16|u32|u64|i8|i16|i32|i64)/;
        const leftMatch = leftOperand.match(typeAnnotationRegex);
        const rightMatch = rightOperand.match(typeAnnotationRegex);

        if (leftMatch) return leftMatch[1] as ArithmeticOperation['dataType'];
        if (rightMatch) return rightMatch[1] as ArithmeticOperation['dataType'];

        // Default to u64 if type cannot be inferred
        return 'u64';
    }

    private isCheckedOperation(code: string, match: any): boolean {
        const context = code.slice(Math.max(0, match.index - 50), 
                                match.index + match.operator.length + 50);
        
        // Check for checked arithmetic patterns
        const checkedPatterns = [
            /checked_add/,
            /checked_sub/,
            /checked_mul/,
            /checked_div/,
            /SafeMath/,
            /require!\(/,
            /assert!\(/
        ];

        return checkedPatterns.some(pattern => pattern.test(context));
    }

    private extractVariableRanges(code: string): void {
        // Extract range information from conditions
        const rangeRegex = /(\w+)\s*(<=?|>=?|==)\s*(\d+)/g;
        let match;

        while ((match = rangeRegex.exec(code)) !== null) {
            const [_, variable, operator, value] = match;
            const numValue = new BN(value);

            let currentRange = this.variableRanges.get(variable) || {
                min: new BN(0),
                max: new BN(2).pow(new BN(64)).sub(new BN(1)),
                isConstrained: false
            };

            switch (operator) {
                case '<=':
                    currentRange.max = BN.min(currentRange.max, numValue);
                    break;
                case '<':
                    currentRange.max = BN.min(currentRange.max, numValue.sub(new BN(1)));
                    break;
                case '>=':
                    currentRange.min = BN.max(currentRange.min, numValue);
                    break;
                case '>':
                    currentRange.min = BN.max(currentRange.min, numValue.add(new BN(1)));
                    break;
                case '==':
                    currentRange.min = numValue;
                    currentRange.max = numValue;
                    break;
            }

            currentRange.isConstrained = true;
            this.variableRanges.set(variable, currentRange);
        }
    }

    private async analyzeOperation(context: OverflowContext): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];
        const { operation } = context;

        // Skip checked operations
        if (operation.isChecked) return errors;

        // Get variable ranges
        const leftRange = this.getVariableRange(operation.leftOperand);
        const rightRange = this.getVariableRange(operation.rightOperand);

        // Check for potential overflow based on operation type
        switch (operation.type) {
            case 'addition':
                if (this.canOverflowAdd(leftRange, rightRange, operation.dataType)) {
                    errors.push(this.createOverflowError(operation, 'addition'));
                }
                break;

            case 'subtraction':
                if (this.canOverflowSub(leftRange, rightRange, operation.dataType)) {
                    errors.push(this.createOverflowError(operation, 'subtraction'));
                }
                break;

            case 'multiplication':
                if (this.canOverflowMul(leftRange, rightRange, operation.dataType)) {
                    errors.push(this.createOverflowError(operation, 'multiplication'));
                }
                break;

            case 'division':
                if (this.canOverflowDiv(rightRange)) {
                    errors.push(this.createOverflowError(operation, 'division'));
                }
                break;
        }

        return errors;
    }

    private getVariableRange(variable: string): VariableRange {
        // Handle numeric literals
        if (/^\d+$/.test(variable)) {
            const value = new BN(variable);
            return {
                min: value,
                max: value,
                isConstrained: true
            };
        }

        // Return stored range or default range
        return this.variableRanges.get(variable) || {
            min: new BN(0),
            max: new BN(2).pow(new BN(64)).sub(new BN(1)),
            isConstrained: false
        };
    }

    private canOverflowAdd(
        left: VariableRange,
        right: VariableRange,
        dataType: ArithmeticOperation['dataType']
    ): boolean {
        const maxValue = this.getMaxValueForType(dataType);
        return left.max.add(right.max).gt(maxValue);
    }

    private canOverflowSub(
        left: VariableRange,
        right: VariableRange,
        dataType: ArithmeticOperation['dataType']
    ): boolean {
        // Check for underflow
        if (dataType.startsWith('u')) {
            return left.min.lt(right.max);
        }
        
        const minValue = this.getMinValueForType(dataType);
        return left.min.sub(right.max).lt(minValue);
    }

    private canOverflowMul(
        left: VariableRange,
        right: VariableRange,
        dataType: ArithmeticOperation['dataType']
    ): boolean {
        const maxValue = this.getMaxValueForType(dataType);
        return left.max.mul(right.max).gt(maxValue);
    }

    private canOverflowDiv(right: VariableRange): boolean {
        return right.min.isZero() || 
               (right.min.isNeg() && right.max.isPos());
    }

    private getMaxValueForType(dataType: ArithmeticOperation['dataType']): BN {
        const bits = parseInt(dataType.slice(1));
        if (dataType.startsWith('u')) {
            return new BN(2).pow(new BN(bits)).sub(new BN(1));
        } else {
            return new BN(2).pow(new BN(bits - 1)).sub(new BN(1));
        }
    }

    private getMinValueForType(dataType: ArithmeticOperation['dataType']): BN {
        if (dataType.startsWith('u')) {
            return new BN(0);
        } else {
            const bits = parseInt(dataType.slice(1));
            return new BN(2).pow(new BN(bits - 1)).neg();
        }
    }

    private createOverflowError(
        operation: ArithmeticOperation,
        type: string
    ): ValidationError {
        return {
            line: operation.line,
            column: operation.column,
            message: `Potential ${type} overflow in ${operation.dataType} operation`,
            severity: 'high',
            errorType: 'ARITHMETIC_OVERFLOW',
            impact: `Operation could overflow/underflow leading to unexpected behavior`,
            remediation: `Use checked_${operation.type} or implement explicit bounds checking`
        };
    }

    private async analyzeLoopOperations(cfg: any): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];
        const loops = cfg.findLoops();

        for (const loop of loops) {
            const loopOperations = this.operations.filter(op => 
                this.isOperationInLoop(op, loop.body)
            );

            for (const operation of loopOperations) {
                if (!operation.isChecked) {
                    errors.push({
                        line: operation.line,
                        column: operation.column,
                        message: `Unchecked arithmetic operation in loop`,
                        severity: 'critical',
                        errorType: 'LOOP_ARITHMETIC_OVERFLOW',
                        impact: 'Operation could overflow/underflow after multiple iterations',
                        remediation: 'Implement bounds checking or use checked arithmetic'
                    });
                }
            }
        }

        return errors;
    }

    private isOperationInLoop(operation: ArithmeticOperation, loopNodes: Set<string>): boolean {
        return Array.from(loopNodes).some(nodeId => {
            const node = this.cfgBuilder.getNodeInfo(nodeId);
            return node && node.line === operation.line;
        });
    }

    public getOperations(): ArithmeticOperation[] {
        return [...this.operations];
    }

    public getVariableRanges(): Map<string, VariableRange> {
        return new Map(this.variableRanges);
    }

    public async cleanup(): Promise<void> {
        this.operations = [];
        this.variableRanges.clear();
        this.removeAllListeners();
    }
}
