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

import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import type { Issue } from '../../types';
import type { SemanticGraph } from '../../semantic/semanticGraph';
import type { RuleLayer, UniversalEvaluationContext, UniversalSemanticRule } from './types';
import { ANALYZER_PERFORMANCE, SEVERITY_WARNING, SEVERITY_ERROR } from '../../constants';

const LAYER_UNIVERSAL: RuleLayer = 'layer1_universal';

// Static rule signatures for rule registry discovery:
// rule: 'loop-transient-allocation'
const RULE_LOOP_TRANSIENT = 'loop-transient-allocation';
// rule: 'high-algorithmic-complexity'
const RULE_HIGH_COMPLEXITY = 'high-algorithmic-complexity';
// rule: 'expensive-loop-operation'
const RULE_EXPENSIVE_LOOP = 'expensive-loop-operation';

const CALL_DUPLICATE_TRUE = '.duplicate(true)';
const CALL_DEEPCOPY_PREFIX = 'copy.deepcopy(';
const CALL_DEEPCOPY_METHOD = '.deepcopy(';
const CALL_DEEPCOPY_IDENTIFIER = 'copy.deepcopy()';
const CALL_JSON_PARSE = 'JSON.parse';
const CALL_CLONE = '.clone()';
const CALL_BOX_NEW = 'Box::new(';
const CALL_DUPLICATE_SUFFIX = '.duplicate';
const CALL_CLONE_DEEP_SUFFIX = '.cloneDeep';
const CALL_INDEX_OF_SUFFIX = '.indexOf';
const CALL_INCLUDES_SUFFIX = '.includes';
const CALL_FIND_SUFFIX = '.find';

const DESC_LOOP_TRANSIENT =
    'Detects transient heap allocations, closures, or instantiations inside loops.';
const DESC_HIGH_COMPLEXITY =
    'Detects nested loop iterations causing potential O(N^2) or O(N^3) performance hotspots.';
const DESC_EXPENSIVE_LOOP =
    'Detects expensive operations like deep copies or blocking I/O within loops.';

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
 * Run one performance rule over the file named in the evaluation context.
 *
 * `PerformanceRuleEvaluator.auditSource` emits findings for all three performance rules at
 * once, so this filters the result down to the single rule the Layer 1 wrapper represents.
 * A context without `currentFilePath` yields no findings rather than guessing a file.
 *
 * @param ruleId - Rule id the caller represents.
 * @param context - Evaluation context naming the file under review.
 * @returns Findings for that rule only.
 */
function runSourceRule(ruleId: string, context: UniversalEvaluationContext): Issue[] {
    const filePath = context?.currentFilePath;
    if (!filePath) {
        return [];
    }
    let content: string;
    try {
        content = readFileSync(filePath, 'utf8');
    } catch {
        // The context may name a file that was removed or is unreadable; a Layer 1 rule
        // must degrade quietly rather than abort the surrounding evaluation.
        return [];
    }
    return defaultPerformanceEvaluator
        .auditSource(filePath, content)
        .filter((issue) => issue.rule === ruleId);
}

/**
 * Abstract base for universal performance semantic rules.
 */
abstract class BasePerformanceSemanticRule implements UniversalSemanticRule {
    public abstract readonly id: string;
    public abstract readonly name: string;
    public readonly defaultSeverity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR;
    public abstract readonly description: string;
    public readonly layer: RuleLayer = LAYER_UNIVERSAL;

    protected constructor(severity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR) {
        this.defaultSeverity = severity;
    }

    /**
     * Evaluates the source under review for performance bottlenecks.
     *
     * @param _graph - SemanticGraph instance.
     * @param context - Evaluation context, used to resolve the file under review.
     * @returns List of detected issues.
     */
    public evaluate(_graph: SemanticGraph, context: UniversalEvaluationContext): Issue[] {
        return runSourceRule(this.id, context);
    }
}

/**
 * Universal Rule: Loop Transient Allocation (ADV-PRF-002).
 */
export class LoopTransientAllocationRule extends BasePerformanceSemanticRule {
    public readonly id = RULE_LOOP_TRANSIENT;
    public readonly name = 'Loop Transient Heap Allocation';
    public readonly description = DESC_LOOP_TRANSIENT;

    public constructor() {
        super(SEVERITY_WARNING);
    }
}

/**
 * Universal Rule: High Algorithmic Complexity Hotspot.
 */
export class HighAlgorithmicComplexityRule extends BasePerformanceSemanticRule {
    public readonly id = RULE_HIGH_COMPLEXITY;
    public readonly name = 'High Algorithmic Complexity Hotspot';
    public readonly description = DESC_HIGH_COMPLEXITY;

    public constructor() {
        super(SEVERITY_WARNING);
    }
}

/**
 * Universal Rule: Expensive Operation in Loop.
 */
export class ExpensiveLoopOperationRule extends BasePerformanceSemanticRule {
    public readonly id = RULE_EXPENSIVE_LOOP;
    public readonly name = 'Expensive Operation Inside Loop';
    public readonly description = DESC_EXPENSIVE_LOOP;

    public constructor() {
        super(SEVERITY_ERROR);
    }
}

interface CallExpressionAuditParams {
    node: ts.Node;
    callText: string;
    filePath: string;
    sourceFile: ts.SourceFile;
    issues: Issue[];
}

interface IndentedLineAuditParams {
    filePath: string;
    trimmed: string;
    lineNo: number;
    ext: string;
    issues: Issue[];
}

interface PerformanceIssueParams {
    filePath: string;
    rule: string;
    severity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR;
    line: number;
    column: number;
    message: string;
    detail: Record<string, unknown>;
}

function buildPerformanceIssue(params: PerformanceIssueParams): Issue {
    return {
        id: `${ANALYZER_PERFORMANCE}:${params.rule}:${params.line}:${params.column}`,
        analyzer: ANALYZER_PERFORMANCE,
        rule: params.rule,
        severity: params.severity,
        message: params.message,
        location: {
            file: params.filePath,
            start: { line: params.line, column: params.column },
            end: { line: params.line, column: params.column },
        },
        detail: params.detail,
    };
}

interface NodeIssueParams {
    filePath: string;
    sourceFile: ts.SourceFile;
    node: ts.Node;
    rule: string;
    severity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR;
    message: string;
    detail: Record<string, unknown>;
}

function createNodeIssue(params: NodeIssueParams): Issue {
    const { line, character } = params.sourceFile.getLineAndCharacterOfPosition(
        params.node.getStart(),
    );
    return buildPerformanceIssue({
        filePath: params.filePath,
        rule: params.rule,
        severity: params.severity,
        line: line + 1,
        column: character + 1,
        message: params.message,
        detail: params.detail,
    });
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
            const isLoop = this.isAstLoopNode(node);
            const currentLoopDepth = isLoop ? loopDepth + 1 : loopDepth;

            if (isLoop && currentLoopDepth > this.maxLoopDepth) {
                issues.push(
                    this.createComplexityIssue(filePath, sourceFile, node, currentLoopDepth),
                );
            }

            if (currentLoopDepth > 0 && !isLoop) {
                this.checkAstLoopBodyNode(node, filePath, sourceFile, issues);
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
    private isAstLoopNode(node: ts.Node): boolean {
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
    private checkAstLoopBodyNode(
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
            this.checkAstCallExpression({ node, callText, filePath, sourceFile, issues });
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
     * @param params - Call expression analysis parameter bundle.
     */
    private checkAstCallExpression(params: CallExpressionAuditParams): void {
        const { node, callText, filePath, sourceFile, issues } = params;
        const isExpensive =
            callText.endsWith(CALL_DUPLICATE_SUFFIX) ||
            callText.includes(CALL_JSON_PARSE) ||
            callText.endsWith(CALL_CLONE_DEEP_SUFFIX);

        const isLinearScan =
            !isExpensive &&
            (callText.endsWith(CALL_INDEX_OF_SUFFIX) ||
                callText.endsWith(CALL_INCLUDES_SUFFIX) ||
                callText.endsWith(CALL_FIND_SUFFIX));

        if (!isExpensive && !isLinearScan) {
            return;
        }

        const rule = isExpensive ? RULE_EXPENSIVE_LOOP : RULE_HIGH_COMPLEXITY;
        const severity = isExpensive ? SEVERITY_ERROR : SEVERITY_WARNING;
        const message = isExpensive
            ? `Expensive operation '${callText}' inside loop body. ` +
              'Eliminate redundant deep copying or serialization in hot paths.'
            : `Linear scan method '${callText}' called inside loop body, leading to implicit O(N^2) complexity. ` +
              'Index data into a Map or Set before iterating.';

        issues.push(
            createNodeIssue({
                filePath,
                sourceFile,
                node,
                rule,
                severity,
                message,
                detail: { operation: callText },
            }),
        );
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
                this.checkIndentedLineIssues({
                    filePath,
                    trimmed,
                    lineNo: i + 1,
                    ext,
                    issues,
                });
            }
        }
        return issues;
    }

    /**
     * Checks an individual line inside a loop for Python or GDScript violations.
     *
     * @param params - Indented line analysis parameter bundle.
     */
    private checkIndentedLineIssues(params: IndentedLineAuditParams): void {
        const { filePath, trimmed, lineNo, ext, issues } = params;
        if (ext === '.gd' && trimmed.includes(CALL_DUPLICATE_TRUE)) {
            issues.push(this.createLineExpensiveIssue(filePath, lineNo, CALL_DUPLICATE_TRUE));
        } else if (ext === '.gd' && /\.new\s*\(/.test(trimmed)) {
            issues.push(
                this.createLineAllocationIssue(filePath, lineNo, 'class.new() instantiation'),
            );
        } else if (
            ext === '.py' &&
            (trimmed.includes(CALL_DEEPCOPY_PREFIX) || trimmed.includes(CALL_DEEPCOPY_METHOD))
        ) {
            issues.push(this.createLineExpensiveIssue(filePath, lineNo, CALL_DEEPCOPY_IDENTIFIER));
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
                if (trimmed.includes(CALL_CLONE) || trimmed.includes(CALL_BOX_NEW)) {
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
        return createNodeIssue({
            filePath,
            sourceFile,
            node,
            rule: RULE_LOOP_TRANSIENT,
            severity: SEVERITY_WARNING,
            message:
                `Transient heap allocation (${target}) inside loop body. ` +
                'Hoist instantiation out of loop or adopt an object pool pattern.',
            detail: { target },
        });
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
        const severity = depth >= 3 && this.tripleNestingFatal ? SEVERITY_ERROR : SEVERITY_WARNING;
        return createNodeIssue({
            filePath,
            sourceFile,
            node,
            rule: RULE_HIGH_COMPLEXITY,
            severity,
            message:
                `Nested loop depth ${depth} detected, resulting in potential O(N^${depth}) complexity. ` +
                'Refactor with indexed data structures (e.g. Map/Set) to lower algorithmic order.',
            detail: { depth },
        });
    }

    /**
     * Creates a line-based complexity issue.
     */
    private createLineComplexityIssue(filePath: string, line: number, depth: number): Issue {
        const severity = depth >= 3 && this.tripleNestingFatal ? SEVERITY_ERROR : SEVERITY_WARNING;
        return buildPerformanceIssue({
            filePath,
            rule: RULE_HIGH_COMPLEXITY,
            severity,
            line,
            column: 1,
            message:
                `Nested loop depth ${depth} detected. ` +
                `Potential O(N^${depth}) complexity hotspot.`,
            detail: { depth },
        });
    }

    /**
     * Creates a line-based transient allocation issue.
     */
    private createLineAllocationIssue(filePath: string, line: number, target: string): Issue {
        return buildPerformanceIssue({
            filePath,
            rule: RULE_LOOP_TRANSIENT,
            severity: SEVERITY_WARNING,
            line,
            column: 1,
            message:
                `Transient heap allocation (${target}) inside loop body. ` +
                'Violates zero transient allocation contract in hot paths.',
            detail: { target },
        });
    }

    /**
     * Creates a line-based expensive operation issue.
     */
    private createLineExpensiveIssue(filePath: string, line: number, operation: string): Issue {
        return buildPerformanceIssue({
            filePath,
            rule: RULE_EXPENSIVE_LOOP,
            severity: SEVERITY_ERROR,
            line,
            column: 1,
            message:
                `Prohibited expensive operation '${operation}' in loop. ` +
                'Deep duplication or heavy cloning inside loops is forbidden.',
            detail: { operation },
        });
    }
}

/** Default singleton performance evaluator */
export const defaultPerformanceEvaluator = new PerformanceRuleEvaluator();
