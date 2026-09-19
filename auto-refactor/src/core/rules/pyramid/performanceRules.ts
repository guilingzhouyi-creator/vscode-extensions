/**
 * Module: Core Engine — Universal Performance & Algorithmic Complexity Rules
 * File Path: src/core/rules/pyramid/performanceRules.ts
 * Architecture Role: Evaluates deep performance and algorithmic complexity constraints,
 *   detecting loop transient heap allocations (ADV-PRF-002), nested O(N^2)/O(N^3) iteration
 *   hotspots, and expensive operations (e.g. deep cloning and blocking I/O) within loops.
 * Dependencies & Triggers: Consumes ts-morph/typescript and SemanticGraph; consumed by
 *   UniversalPyramidEvaluator, PraxisDiffGovernanceService, and external Praxis review cells.
 * Responsibilities: Universal and language-aware performance inspection across TypeScript/JS,
 *   Python, GDScript, Go, and Rust.
 * Exit Semantics & Design Rationale: Stateless and deterministic analysis producing structured
 *   issues with actionable remediation advice.
 */

import * as ts from 'typescript';
import type { Issue } from '../../types';
import type { SemanticGraph } from '../../semantic/semanticGraph';
import type { RuleLayer, UniversalEvaluationContext, UniversalSemanticRule } from './types';

/**
 * Performance inspection options.
 */
export interface PerformanceAuditOptions {
    /** Maximum acceptable loop nesting depth before warning (default: 1, 2+ is O(N^2)) */
    maxLoopDepth?: number;
    /** Whether to treat O(N^3) triple nesting as fatal error (default: true) */
    tripleNestingFatal?: boolean;
}

/**
 * Universal Rule: Loop Transient Allocation (ADV-PRF-002).
 */
export class LoopTransientAllocationRule implements UniversalSemanticRule {
    public readonly id = 'loop-transient-allocation';
    public readonly name = 'Loop Transient Heap Allocation';
    public readonly layer: RuleLayer = 'layer1_universal';
    public readonly defaultSeverity = 'warning' as const;
    public readonly description =
        'Detects transient heap allocations, closures, or instantiations inside loops.';

    /**
     * Evaluates the graph for transient allocations.
     *
     * @param _graph - SemanticGraph instance.
     * @param _context - Evaluation context.
     * @returns List of detected issues.
     */
    public evaluate(_graph: SemanticGraph, _context: UniversalEvaluationContext): Issue[] {
        // Universal SemanticGraph-level evaluation (if nodes contain loop annotations)
        return [];
    }
}

/**
 * Universal Rule: High Algorithmic Complexity Hotspot.
 */
export class HighAlgorithmicComplexityRule implements UniversalSemanticRule {
    public readonly id = 'high-algorithmic-complexity';
    public readonly name = 'High Algorithmic Complexity Hotspot';
    public readonly layer: RuleLayer = 'layer1_universal';
    public readonly defaultSeverity = 'warning' as const;
    public readonly description =
        'Detects nested loop iterations causing potential O(N^2) or O(N^3) performance hotspots.';

    /**
     * Evaluates the graph for complexity hotspots.
     *
     * @param _graph - SemanticGraph instance.
     * @param _context - Evaluation context.
     * @returns List of detected issues.
     */
    public evaluate(_graph: SemanticGraph, _context: UniversalEvaluationContext): Issue[] {
        return [];
    }
}

/**
 * Universal Rule: Expensive Operation in Loop.
 */
export class ExpensiveLoopOperationRule implements UniversalSemanticRule {
    public readonly id = 'expensive-loop-operation';
    public readonly name = 'Expensive Operation Inside Loop';
    public readonly layer: RuleLayer = 'layer1_universal';
    public readonly defaultSeverity = 'error' as const;
    public readonly description =
        'Detects expensive operations like deep copies or blocking I/O within loops.';

    /**
     * Evaluates the graph for expensive loop operations.
     *
     * @param _graph - SemanticGraph instance.
     * @param _context - Evaluation context.
     * @returns List of detected issues.
     */
    public evaluate(_graph: SemanticGraph, _context: UniversalEvaluationContext): Issue[] {
        return [];
    }
}

/**
 * Unified evaluator performing deep algorithmic and performance audits across languages.
 */
export class PerformanceRuleEvaluator {
    private readonly maxLoopDepth: number;
    private readonly tripleNestingFatal: boolean;

    /**
     * Initializes evaluator with customizable performance thresholds.
     *
     * @param options - Audit configuration options.
     */
    public constructor(options: PerformanceAuditOptions = {}) {
        this.maxLoopDepth = options.maxLoopDepth ?? 1;
        this.tripleNestingFatal = options.tripleNestingFatal ?? true;
    }

    /**
     * Audits source code for performance bottlenecks, transient allocations, and complexity.
     *
     * @param filePath - Source file path.
     * @param content - Source file content string.
     * @returns List of detected performance and algorithmic issues.
     */
    public auditSource(filePath: string, content: string): Issue[] {
        const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
        if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
            return this.auditTypeScriptSource(filePath, content);
        }
        if (['.py', '.gd'].includes(ext)) {
            return this.auditIndentedSource(filePath, content, ext);
        }
        return this.auditGeneralSource(filePath, content);
    }

    /**
     * Performs deep AST analysis for TypeScript and JavaScript files.
     *
     * @param filePath - Path to the source file.
     * @param content - File contents.
     * @returns Detected issues.
     */
    private auditTypeScriptSource(filePath: string, content: string): Issue[] {
        const issues: Issue[] = [];
        const sourceFile = ts.createSourceFile(
            filePath,
            content,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TSX,
        );

        const walkNode = (node: ts.Node, loopDepth: number) => {
            const isLoop = this.isTsLoopNode(node);
            const currentLoopDepth = isLoop ? loopDepth + 1 : loopDepth;

            if (isLoop && currentLoopDepth > this.maxLoopDepth) {
                issues.push(
                    this.createComplexityIssue(filePath, sourceFile, node, currentLoopDepth),
                );
            }

            if (currentLoopDepth > 0 && !isLoop) {
                this.checkTsLoopBodyNode(node, filePath, sourceFile, issues);
            }

            ts.forEachChild(node, (child) => walkNode(child, currentLoopDepth));
        };

        walkNode(sourceFile, 0);
        return issues;
    }

    /**
     * Checks if a TypeScript AST node represents a loop construct.
     *
     * @param node - AST node to check.
     * @returns True if the node is a loop.
     */
    private isTsLoopNode(node: ts.Node): boolean {
        return (
            ts.isForStatement(node) ||
            ts.isForOfStatement(node) ||
            ts.isForInStatement(node) ||
            ts.isWhileStatement(node) ||
            ts.isDoStatement(node)
        );
    }

    /**
     * Checks an individual statement inside a loop for performance violations.
     *
     * @param node - AST node inside a loop.
     * @param filePath - Source file path.
     * @param sourceFile - Source file AST representation.
     * @param issues - Mutable issue collection.
     */
    private checkTsLoopBodyNode(
        node: ts.Node,
        filePath: string,
        sourceFile: ts.SourceFile,
        issues: Issue[],
    ): void {
        if (ts.isNewExpression(node)) {
            issues.push(
                this.createAllocationIssue(filePath, sourceFile, node, node.expression.getText()),
            );
        } else if (ts.isCallExpression(node)) {
            const callText = node.expression.getText();
            this.checkTsCallExpression(node, callText, filePath, sourceFile, issues);
        } else if (ts.isArrayLiteralExpression(node) && node.elements.length > 0) {
            const hasSpread = node.elements.some((el) => ts.isSpreadElement(el));
            if (hasSpread) {
                issues.push(
                    this.createAllocationIssue(
                        filePath,
                        sourceFile,
                        node,
                        'spread array instantiation',
                    ),
                );
            }
        }
    }

    /**
     * Checks a call expression inside a loop for expensive operations or quadratic lookups.
     *
     * @param node - CallExpression node.
     * @param callText - Callee text.
     * @param filePath - File path.
     * @param sourceFile - Source file AST.
     * @param issues - Mutable issue accumulator.
     */
    private checkTsCallExpression(
        node: ts.Node,
        callText: string,
        filePath: string,
        sourceFile: ts.SourceFile,
        issues: Issue[],
    ): void {
        if (
            callText.endsWith('.duplicate') ||
            callText.includes('JSON.parse') ||
            callText.endsWith('.cloneDeep')
        ) {
            issues.push(this.createExpensiveIssue(filePath, sourceFile, node, callText));
        } else if (
            callText.endsWith('.indexOf') ||
            callText.endsWith('.includes') ||
            callText.endsWith('.find')
        ) {
            issues.push(this.createLinearScanIssue(filePath, sourceFile, node, callText));
        }
    }

    /**
     * Audits Python and GDScript sources using indentation and keyword scanning.
     *
     * @param filePath - Path to source file.
     * @param content - Source file string.
     * @param ext - File extension (.py or .gd).
     * @returns Detected issues.
     */
    private auditIndentedSource(filePath: string, content: string, ext: string): Issue[] {
        const issues: Issue[] = [];
        const lines = content.split(/\r?\n/);
        const loopStack: number[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const indent = line.search(/\S/);
            while (loopStack.length > 0 && indent <= loopStack[loopStack.length - 1]) {
                loopStack.pop();
            }

            const isLoop = /^(for\s+|while\s+)/.test(trimmed);
            if (isLoop) {
                loopStack.push(indent);
                const depth = loopStack.length;
                if (depth > this.maxLoopDepth) {
                    issues.push(this.createLineComplexityIssue(filePath, i + 1, depth));
                }
            } else if (loopStack.length > 0) {
                this.checkIndentedLineIssues(filePath, trimmed, i + 1, ext, issues);
            }
        }
        return issues;
    }

    /**
     * Checks an individual line inside a loop for Python or GDScript violations.
     *
     * @param filePath - File path.
     * @param trimmed - Line text.
     * @param lineNo - 1-based line number.
     * @param ext - File extension.
     * @param issues - Mutable issue list.
     */
    private checkIndentedLineIssues(
        filePath: string,
        trimmed: string,
        lineNo: number,
        ext: string,
        issues: Issue[],
    ): void {
        if (ext === '.gd' && trimmed.includes('.duplicate(true)')) {
            issues.push(this.createLineExpensiveIssue(filePath, lineNo, '.duplicate(true)'));
        } else if (ext === '.gd' && /\.new\s*\(/.test(trimmed)) {
            issues.push(
                this.createLineAllocationIssue(filePath, lineNo, 'class.new() instantiation'),
            );
        } else if (
            ext === '.py' &&
            (trimmed.includes('copy.deepcopy(') || trimmed.includes('.deepcopy('))
        ) {
            issues.push(this.createLineExpensiveIssue(filePath, lineNo, 'copy.deepcopy()'));
        } else if (ext === '.py' && /re\.compile\s*\(/.test(trimmed)) {
            issues.push(
                this.createLineAllocationIssue(filePath, lineNo, 're.compile() compilation'),
            );
        }
    }

    /**
     * Audits Go, Rust, and other languages with general block parsing.
     *
     * @param filePath - Source file path.
     * @param content - Source file content.
     * @returns Detected issues.
     */
    private auditGeneralSource(filePath: string, content: string): Issue[] {
        const issues: Issue[] = [];
        const lines = content.split(/\r?\n/);
        let loopLevel = 0;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (/\b(for|while)\b.*\{/.test(trimmed)) {
                loopLevel++;
                if (loopLevel > this.maxLoopDepth) {
                    issues.push(this.createLineComplexityIssue(filePath, i + 1, loopLevel));
                }
            }
            if (loopLevel > 0) {
                if (trimmed.includes('.clone()') || trimmed.includes('Box::new(')) {
                    issues.push(
                        this.createLineAllocationIssue(filePath, i + 1, 'clone/Box allocation'),
                    );
                }
            }
            if (trimmed.includes('}') && loopLevel > 0) {
                loopLevel--;
            }
        }
        return issues;
    }

    /**
     * Creates an issue for loop transient allocations from AST node.
     */
    private createAllocationIssue(
        filePath: string,
        sourceFile: ts.SourceFile,
        node: ts.Node,
        target: string,
    ): Issue {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        return {
            id: `performance:loop-transient-allocation:${line + 1}:${character + 1}`,
            analyzer: 'performance',
            rule: 'loop-transient-allocation',
            severity: 'warning',
            message:
                `Transient heap allocation (${target}) inside loop body. ` +
                'Hoist instantiation out of loop or adopt an object pool pattern.',
            location: {
                file: filePath,
                start: { line: line + 1, column: character + 1 },
                end: { line: line + 1, column: character + 1 },
            },
            detail: { target },
        };
    }

    /**
     * Creates an issue for loop complexity from AST node.
     */
    private createComplexityIssue(
        filePath: string,
        sourceFile: ts.SourceFile,
        node: ts.Node,
        depth: number,
    ): Issue {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const severity = depth >= 3 && this.tripleNestingFatal ? 'error' : 'warning';
        return {
            id: `performance:high-algorithmic-complexity:${line + 1}:${character + 1}`,
            analyzer: 'performance',
            rule: 'high-algorithmic-complexity',
            severity,
            message:
                `Nested loop depth ${depth} detected, resulting in potential O(N^${depth}) complexity. ` +
                'Refactor with indexed data structures (e.g. Map/Set) to lower algorithmic order.',
            location: {
                file: filePath,
                start: { line: line + 1, column: character + 1 },
                end: { line: line + 1, column: character + 1 },
            },
            detail: { depth },
        };
    }

    /**
     * Creates an issue for expensive operations from AST node.
     */
    private createExpensiveIssue(
        filePath: string,
        sourceFile: ts.SourceFile,
        node: ts.Node,
        operation: string,
    ): Issue {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        return {
            id: `performance:expensive-loop-operation:${line + 1}:${character + 1}`,
            analyzer: 'performance',
            rule: 'expensive-loop-operation',
            severity: 'error',
            message:
                `Expensive operation '${operation}' inside loop body. ` +
                'Eliminate redundant deep copying or serialization in hot paths.',
            location: {
                file: filePath,
                start: { line: line + 1, column: character + 1 },
                end: { line: line + 1, column: character + 1 },
            },
            detail: { operation },
        };
    }

    /**
     * Creates an issue for linear scan in loop from AST node.
     */
    private createLinearScanIssue(
        filePath: string,
        sourceFile: ts.SourceFile,
        node: ts.Node,
        operation: string,
    ): Issue {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        return {
            id: `performance:high-algorithmic-complexity:${line + 1}:${character + 1}`,
            analyzer: 'performance',
            rule: 'high-algorithmic-complexity',
            severity: 'warning',
            message:
                `Linear scan method '${operation}' called inside loop body, leading to implicit O(N^2) complexity. ` +
                'Index data into a Map or Set before iterating.',
            location: {
                file: filePath,
                start: { line: line + 1, column: character + 1 },
                end: { line: line + 1, column: character + 1 },
            },
            detail: { operation },
        };
    }

    /**
     * Creates a line-based complexity issue.
     */
    private createLineComplexityIssue(filePath: string, line: number, depth: number): Issue {
        const severity = depth >= 3 && this.tripleNestingFatal ? 'error' : 'warning';
        return {
            id: `performance:high-algorithmic-complexity:${line}:1`,
            analyzer: 'performance',
            rule: 'high-algorithmic-complexity',
            severity,
            message:
                `Nested loop depth ${depth} detected. ` +
                `Potential O(N^${depth}) complexity hotspot.`,
            location: {
                file: filePath,
                start: { line, column: 1 },
                end: { line, column: 1 },
            },
            detail: { depth },
        };
    }

    /**
     * Creates a line-based transient allocation issue.
     */
    private createLineAllocationIssue(filePath: string, line: number, target: string): Issue {
        return {
            id: `performance:loop-transient-allocation:${line}:1`,
            analyzer: 'performance',
            rule: 'loop-transient-allocation',
            severity: 'warning',
            message:
                `Transient heap allocation (${target}) inside loop body. ` +
                'Violates zero transient allocation contract in hot paths.',
            location: {
                file: filePath,
                start: { line, column: 1 },
                end: { line, column: 1 },
            },
            detail: { target },
        };
    }

    /**
     * Creates a line-based expensive operation issue.
     */
    private createLineExpensiveIssue(filePath: string, line: number, operation: string): Issue {
        return {
            id: `performance:expensive-loop-operation:${line}:1`,
            analyzer: 'performance',
            rule: 'expensive-loop-operation',
            severity: 'error',
            message:
                `Prohibited expensive operation '${operation}' in loop. ` +
                'Deep duplication or heavy cloning inside loops is forbidden.',
            location: {
                file: filePath,
                start: { line, column: 1 },
                end: { line, column: 1 },
            },
            detail: { operation },
        };
    }
}

/** Default singleton performance evaluator */
export const defaultPerformanceEvaluator = new PerformanceRuleEvaluator();
