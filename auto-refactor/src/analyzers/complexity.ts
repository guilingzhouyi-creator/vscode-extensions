/**
 * Module: Static Analysis Engine — Cyclomatic Complexity Measurement
 * File Path: src/analyzers/complexity.ts
 * Architecture Role: Language-agnostic analyzer that measures each function-like node during
 *   the engine's single shared traversal and reports `high-complexity` findings
 * Dependencies & Triggers: core types, NodeKind/NormalizedNode, locN, runStreaming, plus a lazy
 *   `typescriptAdapter` require for the standalone path; triggered when the declarative
 *   `analyzers.complexity` entry is enabled by CLI / CI / daemon scans
 * Responsibilities: Compute CC as one plus the summed adapter-precomputed branchWeight, never
 *   descending into nested functions; resolve stable names from class and binding scope;
 *   memoize the CC value for reused subtrees through ctx.incremental; choose `error` at
 *   complexityFail and `warning` at complexityWarn; attach tiered extraction hints
 * Exit Semantics & Design Rationale: finalize() returns the accumulated issues while analyze()
 *   is the standalone contract that re-parses through TypeScriptAdapter; memoization is keyed
 *   by function start position and falls back to recompute on a key mismatch, so warm scans
 *   stay byte-identical to cold ones.
 */
import type * as ts from 'typescript';
import type {
    Analyzer,
    AnalyzerContext,
    Issue,
    Severity,
    AgentActionablePayload,
} from '../core/types';
import { SEVERITY_WARNING, SEVERITY_ERROR, SEVERITY_INFO } from '../core/types';
import {
    ANALYZER_COMPLEXITY,
    RULE_CPX_NEST_001,
    RULE_CPX_NEST_002,
    RULE_CPX_STM_001,
} from '../core/scoring/dimensionLiterals';
import { CODE_CPX_HIGH_COMPLEXITY, CODE_CPX_DEEP_NESTING } from '../core/constants/rule-codes';
import type { NormalizedNode } from '../core/ast/multilang';
import { NodeKind } from '../core/ast/multilang';
import { locN } from '../utils/normalized';
import { runStreaming } from '../core/ast/traverse';
import { maskedLinesOfPath } from '../core/policy/source-mask';
import { globToRegExp } from '../core/file-discovery';
import type { LoopSite } from '../core/intelligence/semanticComplexity';
import { detectComplexityAmplification } from '../core/intelligence/semanticComplexity';
import type { StructuredClarityResult } from './structured-clarity';
import { evaluateStructuredClarity, formatOptimizationHint } from './structured-clarity';
import {
    findLoopSitesInFunction,
    collectLoopAllocSites,
    createRoutineDescriptors,
    cyclomaticComplexity as computeCyclomaticComplexity,
} from './complexity-loops';
import {
    evaluateElasticComplexityBudget,
    evaluateFileCumulativeBudget,
} from '../core/intelligence/elastic-complexity-budget';
import { analyzeFunctionCohesionAndSkeleton } from '../core/intelligence/function-cohesion-skeleton';
import { evaluateDistributedRedundancy } from '../core/intelligence/semantic-domain-detector';
import { evaluateResourcePooling } from '../core/intelligence/resource-pooling-auditor';

/** Regular expression matching parser/AST related file path components. */
const MODULE_TYPESCRIPT_ADAPTER = '../core/ast/typescript-adapter';

const RE_PARSER_FILE_CONTEXT =
    /(?:adapter|parser|lexer|walker|codec|deserializer|ast|analyzer|audit|evaluator|graph|rule)/i;

/** Regular expression matching parser/AST related function names. */
const RE_PARSER_FUNCTION_NAME =
    /(?:parse|tokenize|decode|visit|walk|match|audit|analyze|evaluate|dispatch)/i;

/** Regular expression detecting switch, case, or match branch dispatches. */
const RE_SWITCH_OR_DISPATCH_LINE = /^\s*(?:switch\b|case\b|match\b)/;

/** Regular expression matching event-loop/daemon file path components. */
const RE_EVENT_LOOP_FILE_CONTEXT = /(?:daemon|server|worker|poller|eventloop)/i;

/** Regular expression matching event-loop/daemon function names. */
const RE_EVENT_LOOP_FUNCTION_NAME = /(?:daemon|poll|listen|loop)/i;

/** Regular expression detecting deep control-flow jump/escape statements. */
const RE_CONTROL_FLOW_ESCAPE = /^(?:return\b|throw\b|break\b|continue\b)/;

/** Regular expression detecting case or default labels in switch statements. */
const RE_STATE_MACHINE_BRANCH = /^(?:case\b|default:)/;

/** Canonical analyzer rule identifier for cyclomatic complexity. */
const _RULE_HIGH_COMPLEXITY = 'high-complexity';

/** Syntactic keyword name for function declarations. */
const KIND_FUNCTION_KEYWORD = 'FunctionKeyword';

/** Default placeholder name for anonymous functions. */
const ANONYMOUS_FUNCTION_NAME = 'anonymous';

/** Canonical constructor method name. */
const CONSTRUCTOR_NAME = 'constructor';

/** Agent actionable action tag for pure predicate extraction. */
const ACTION_EXTRACT_PURE_PREDICATE = 'extract_pure_predicate';

/** Agent actionable action tag for guard clause refactoring. */
const ACTION_APPLY_GUARD_CLAUSE = 'apply_guard_clause';

/** Defect taxonomy category for control flow anomalies. */
const TAXONOMY_CTRL_FLOW = 'CTRL_FLOW';

/** Code template snippet for lookup strategy pattern. */
const SNIPPET_STRATEGY_MAP = 'const strategyMap: Record<string, () => Result> = { ... };';

/** Code template snippet for guard clause early return. */
const SNIPPET_GUARD_CLAUSE = 'if (!condition) return defaultValue;';

/** Context category for AST and parser traversal functions. */
const CONTEXT_AST_PARSER = 'ast-parser';

/** Context category for explicit state machines. */
const CONTEXT_STATE_MACHINE = 'state-machine';

/** Context category for event loop and daemon workers. */
const CONTEXT_EVENT_LOOP = 'event-loop';

/** Context category for general business domain logic. */
const CONTEXT_GENERAL_BUSINESS = 'general-business';

/** Refactoring suggestion for flat functions with high branching complexity. */
const SUGGESTION_FLAT_HIGH_BRANCHING =
    'Function has flat control flow but high branching. ' +
    'Consider a lookup table (map/strategy pattern) to eliminate branches.';

/** Refactoring suggestion for unbounded control-flow nesting depth. */
const SUGGESTION_UNBOUNDED_NESTING =
    'Flatten control flow using early returns (guard clauses) or extract nested blocks.';

/** Refactoring suggestion for deep control-flow jump over a long line span. */
const SUGGESTION_DEEP_ESCAPE =
    'Extract deeply nested block into a localized helper method to reduce jump distance.';

/** Refactoring suggestion for oversized state machine branch cases. */
const SUGGESTION_STATE_MACHINE =
    'Extract branch body into a dedicated action to keep dispatch lean.';

/** Refactoring suggestion for tautological empty traversal loops. */
const SUGGESTION_TAUTOLOGICAL_LOOP =
    'Eliminate vacuous iteration loop or replace with direct expression / slice lookup.';

const RULE_CPX_TRV_001 = 'CPX-TRV-001';

/** Minimum physical line count to classify a dispatch construct as a state machine. */
const MIN_STATE_MACHINE_LINES = 15;

/** Relaxed nesting depth budget for parsers, state machines, and event loops. */
const DEPTH_BUDGET_COMPLEX = 5;

/** Strict baseline nesting depth budget for general business logic. */
const DEPTH_BUDGET_GENERAL = 3;

/** Maximum LOC for a short-span guard exempt from unbounded nesting warnings. */
const SHORT_SPAN_GUARD_LOC = 25;

/** Maximum nesting depth for a short-span guard exemption. */
const SHORT_SPAN_GUARD_DEPTH = 4;

/** Minimum function line span required to evaluate deep control escapes. */
const HIGH_SPAN_WARN_LINES = 60;

/** Minimum nesting depth required to evaluate deep control escapes. */
const ESCAPE_EVALUATION_MIN_DEPTH = 4;

/** Indentation threshold (spaces) for escape evaluation under complex budgets. */
const INDENT_SPACES_COMPLEX_BUDGET = 20;

/** Indentation threshold (spaces) for escape evaluation under standard budgets. */
const INDENT_SPACES_STANDARD_BUDGET = 16;

/** Line index offset within function body before deep escape scanning begins. */
const ESCAPE_SCAN_START_INDEX = 40;

/** Maximum function LOC tolerated before deep escapes are flagged under complex budgets. */
const ESCAPE_SPAN_EXTENDED_LIMIT = 120;

/** Maximum allowed physical lines within a single state machine case branch. */
const MAX_CASE_BRANCH_LINES = 35;

/** Minimum number of file functions required to trigger cohesion or redundancy audits. */
const MIN_FUNCTIONS_FOR_COHESION = 2;

/** Fallback line count for redundancy evaluation when source content is absent. */
const DEFAULT_CONTENT_LINE_COUNT = 100;

/**
 * Context payload for constructing structured complexity issue details.
 */
interface ComplexityDetailContext {
    name: string;
    cyclomaticComplexity: number;
    warn: number;
    fail: number;
    clarity: StructuredClarityResult;
}

/**
 * Parameter payload for constructing a high-complexity Issue record.
 */
interface ComplexityIssueContext {
    node: NormalizedNode;
    ctx: AnalyzerContext;
    name: string;
    cyclomaticComplexity: number;
    clarity: StructuredClarityResult;
}

/**
 * Encapsulated metric profile of an analyzed function node.
 */
interface FunctionMetricContext {
    name: string;
    cyclomaticComplexity: number;
    loc: number;
    maxDepth: number;
    startLine: number;
    isExported?: boolean;
}

/**
 * Context payload for evaluating control-flow nesting and deep jump escapes.
 */
interface ComplexityNestingContext {
    ctx: AnalyzerContext;
    name: string;
    loc: number;
    maxDepth: number;
    depthBudget: number;
    contextKind: string;
    startLine: number;
}

function formatAnonymous(className: string | null, binding: string | null): string {
    if (binding) return binding;
    return className ? `${className}.<${ANONYMOUS_FUNCTION_NAME}>` : ANONYMOUS_FUNCTION_NAME;
}

/** Resolve a human-readable name for a function-like node using the threaded scope. */
function getFunctionName(
    node: NormalizedNode,
    className: string | null,
    binding: string | null,
): string {
    if (node.isConstructor) {
        return className ? `${className}.${CONSTRUCTOR_NAME}` : CONSTRUCTOR_NAME;
    }
    if (node.kind === NodeKind.Method) {
        const methodName = node.name || ANONYMOUS_FUNCTION_NAME;
        return className ? `${className}.${methodName}` : methodName;
    }
    return node.name ? node.name : formatAnonymous(className, binding);
}

function resolveStartNode(node: NormalizedNode): NormalizedNode {
    const first = node.children?.[0];
    return first && first.rawKind === KIND_FUNCTION_KEYWORD ? first : node;
}

function buildComplexityDetail(context: ComplexityDetailContext): Record<string, unknown> {
    const detail: Record<string, unknown> = {
        function: context.name,
        cyclomaticComplexity: context.cyclomaticComplexity,
        warn: context.warn,
        fail: context.fail,
    };
    if (context.clarity.isStructurallyClear) {
        detail.effectiveWarn = context.clarity.effectiveWarn;
        detail.effectiveFail = context.clarity.effectiveFail;
        detail.maxBranchDepth = context.clarity.maxDepth;
        detail.structuredClarity = true;
    }
    return detail;
}

function buildComplexityIssue(context: ComplexityIssueContext): Issue {
    const { node, ctx, name, cyclomaticComplexity, clarity } = context;
    const options = ctx.options;
    const severity: Severity =
        cyclomaticComplexity >= clarity.effectiveFail ? SEVERITY_ERROR : SEVERITY_WARNING;
    const startNode = resolveStartNode(node);

    const message = clarity.isStructurallyClear
        ? `Function "${name}" has cyclomatic complexity ${cyclomaticComplexity} (exceeds relaxed threshold ` +
          `${clarity.effectiveWarn} for shallow structure).`
        : `Function "${name}" has cyclomatic complexity ${cyclomaticComplexity} (threshold ${options.complexityWarn}).`;

    const suggestion = clarity.isStructurallyClear
        ? SUGGESTION_FLAT_HIGH_BRANCHING
        : formatOptimizationHint(cyclomaticComplexity);

    const actionable: AgentActionablePayload = {
        action: clarity.isStructurallyClear
            ? ACTION_EXTRACT_PURE_PREDICATE
            : ACTION_APPLY_GUARD_CLAUSE,
        code: CODE_CPX_HIGH_COMPLEXITY,
        taxonomy: TAXONOMY_CTRL_FLOW,
        safeToAutomate: false,
        templateSnippet: clarity.isStructurallyClear ? SNIPPET_STRATEGY_MAP : SNIPPET_GUARD_CLAUSE,
        targetArguments: {
            cyclomaticComplexity,
            threshold: options.complexityWarn,
            functionName: name,
        },
    };

    const detailContext: ComplexityDetailContext = {
        name,
        cyclomaticComplexity,
        warn: options.complexityWarn,
        fail: options.complexityFail,
        clarity,
    };

    return {
        id: `complexity:high-complexity:${ctx.filePath}:${node.start?.line ?? 1}`,
        analyzer: ANALYZER_COMPLEXITY,
        rule: 'high-complexity',
        severity,
        message,
        location: locN(startNode, ctx.filePath),
        detail: buildComplexityDetail(detailContext),
        suggestion,
        actionable,
    };
}

/**
 * Cyclomatic complexity analyzer (language-agnostic).
 */
export class ComplexityAnalyzer implements Analyzer {
    name = 'complexity' as const;

    private issues: Issue[] = [];
    private loopSites: Map<string, LoopSite[]> = new Map();
    /** Masked view of the current file, so loop-body braces can be matched without string noise. */
    private maskedLines: string[] = [];
    /** Cached split lines of the current file to prevent repeated full-file splits. */
    private cachedLines: string[] = [];
    /** File the cached masked view belongs to; the engine may reuse one instance across files. */
    private maskedFor = '';
    private functionCCs: number[] = [];
    private fileFunctions: Array<{
        name: string;
        startLine: number;
        endLine: number;
        cc: number;
        lines: string[];
    }> = [];

    analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
        this.issues = [];
        this.loopSites.clear();
        this.functionCCs = [];
        this.fileFunctions = [];
        this.maskedLines = maskedLinesOfPath(ctx.filePath, ctx.content);
        this.cachedLines = ctx.content ? ctx.content.split('\n') : [];
        this.maskedFor = ctx.filePath;

        const { TypeScriptAdapter } = require(
            MODULE_TYPESCRIPT_ADAPTER,
        ) as typeof import('../core/ast/typescript-adapter');
        const adapter = new TypeScriptAdapter();
        const ast = adapter.parse(sf.text, ctx.filePath);
        return runStreaming(adapter, ast.root, [
            { analyzer: this, ctx: { ...ctx, sourceFile: sf, root: ast.root, adapter } },
        ]);
    }

    private computeComplexity(node: NormalizedNode, state: AnalyzerContext['incremental']): number {
        const fnKey = `${node.start?.line ?? 1}:${node.start?.column ?? 1}`;
        if (state && state.isReusedFunction(node)) {
            const cached = state.getComplexity(fnKey);
            if (cached !== undefined) return cached;
        }
        const cyclomaticComplexity = computeCyclomaticComplexity(node);
        if (state) {
            state.setComplexity(fnKey, cyclomaticComplexity);
        }
        return cyclomaticComplexity;
    }

    private ensureFileState(filePath: string, content?: string): void {
        if (this.maskedFor === filePath) return;
        this.maskedLines = maskedLinesOfPath(filePath, content || '');
        this.cachedLines = content ? content.split('\n') : [];
        this.maskedFor = filePath;
        this.functionCCs = [];
        this.fileFunctions = [];
    }

    private resolveIsExported(
        node: NormalizedNode,
        parent: NormalizedNode | undefined,
        fnLines: string[],
    ): boolean {
        if (node.exported) {
            return true;
        }
        const firstLine = fnLines[0] || '';
        if (/\bexport\b/.test(firstLine)) {
            return true;
        }
        const isParentClassExported = Boolean(
            parent && (parent.exported || (parent.isClassDefining && parent.exported)),
        );
        if (isParentClassExported && node.kind === NodeKind.Method) {
            const isPrivateOrProtected =
                /\b(private|protected)\b/.test(firstLine) ||
                Boolean(node.name && node.name.startsWith('#'));
            return !isPrivateOrProtected;
        }
        return false;
    }

    private checkElasticBudget(
        node: NormalizedNode,
        ctx: AnalyzerContext,
        metrics: FunctionMetricContext,
    ): void {
        const opts = ctx.options as Record<string, unknown> | undefined;
        const thresh = ctx.config?.thresholds as unknown as Record<string, unknown> | undefined;
        const flagElasticBudget = Boolean(
            opts?.enforceElasticBudget ?? thresh?.enforceElasticBudget ?? false,
        );
        if (!flagElasticBudget) return;

        const lang = ctx.filePath.split('.').pop() || 'ts';
        const budgetResult = evaluateElasticComplexityBudget(
            {
                name: metrics.name,
                filePath: ctx.filePath,
                language: lang,
                cc: metrics.cyclomaticComplexity,
                loc: metrics.loc,
                maxDepth: metrics.maxDepth,
                startLine: metrics.startLine,
                startColumn: node.start?.column ?? 1,
                isExported: metrics.isExported,
            },
            ctx.options.complexityWarn,
            ctx.options.complexityFail,
        );
        if (budgetResult.issues.length > 0) {
            this.issues.push(...budgetResult.issues);
        }
    }

    visit(
        node: NormalizedNode,
        ctx: AnalyzerContext,
        parent?: NormalizedNode,
        ...scope: [
            grandparent?: NormalizedNode,
            depth?: number,
            className?: string | null,
            binding?: string | null,
        ]
    ): void {
        if (!node.functionLike) return;
        const className = scope[2] ?? null;
        const binding = scope[3] ?? null;
        const name = getFunctionName(node, className, binding);

        // The engine drives visit/finalize directly (only the standalone contract calls
        // analyze), so the masked view is built here on first use per file.
        this.ensureFileState(ctx.filePath, ctx.content);

        // Collect loop sites within the function boundaries
        const fnSites = findLoopSitesInFunction(
            node,
            name,
            ctx.filePath,
            this.cachedLines,
            this.maskedLines,
        );
        if (fnSites.length > 0) {
            this.loopSites.set(name, fnSites);
        }

        const cyclomaticComplexity = this.computeComplexity(node, ctx.incremental);
        this.functionCCs.push(cyclomaticComplexity);

        const startLine = node.start?.line ?? 1;
        const endLine = node.end?.line ?? startLine;
        const loc = Math.max(1, endLine - startLine + 1);

        const clarity = evaluateStructuredClarity(
            node,
            ctx,
            ctx.options.complexityWarn,
            ctx.options.complexityFail,
        );

        const fnLines = this.cachedLines.slice(startLine - 1, endLine);
        this.fileFunctions.push({
            name,
            startLine,
            endLine,
            cc: cyclomaticComplexity,
            lines: fnLines,
        });

        const isExported = this.resolveIsExported(node, parent, fnLines);
        const metrics: FunctionMetricContext = {
            name,
            cyclomaticComplexity,
            loc,
            maxDepth: clarity.maxDepth,
            startLine,
            isExported,
        };

        this.checkElasticBudget(node, ctx, metrics);
        this.checkNestingEscapes(ctx, metrics, fnLines);

        if (cyclomaticComplexity >= clarity.effectiveWarn) {
            this.issues.push(
                buildComplexityIssue({
                    node,
                    ctx,
                    name,
                    cyclomaticComplexity,
                    clarity,
                }),
            );
        }
    }

    /**
     * Context-aware evaluation of control-flow nesting depth, elastic budgets, and deep escapes.
     * Differentiates legitimate state machines, AST parsers, and short-span guards from
     * unbounded business logic nesting.
     */
    private checkNestingEscapes(
        ctx: AnalyzerContext,
        metrics: FunctionMetricContext,
        fnLines: string[],
    ): void {
        const { depthBudget, contextKind, isStateMachine } = this.resolveNestingBudget(
            ctx,
            metrics.name,
            fnLines,
        );

        const nestingContext: ComplexityNestingContext = {
            ctx,
            name: metrics.name,
            loc: metrics.loc,
            maxDepth: metrics.maxDepth,
            depthBudget,
            contextKind,
            startLine: metrics.startLine,
        };

        this.checkUnboundedNesting(nestingContext);
        this.checkDeepLongSpanEscapes(nestingContext, fnLines);
        if (isStateMachine) {
            this.checkStateMachineDiscipline(ctx, metrics.name, metrics.startLine, fnLines);
        }
    }

    private resolveNestingBudget(
        ctx: AnalyzerContext,
        name: string,
        fnLines: string[],
    ): { depthBudget: number; contextKind: string; isStateMachine: boolean } {
        const isParserContext =
            RE_PARSER_FILE_CONTEXT.test(ctx.filePath) || RE_PARSER_FUNCTION_NAME.test(name);

        const hasSwitchOrDispatch = fnLines.some((l) => RE_SWITCH_OR_DISPATCH_LINE.test(l));
        const isStateMachine = hasSwitchOrDispatch && fnLines.length >= MIN_STATE_MACHINE_LINES;
        const isEventLoop =
            RE_EVENT_LOOP_FILE_CONTEXT.test(ctx.filePath) || RE_EVENT_LOOP_FUNCTION_NAME.test(name);

        if (isParserContext) {
            return {
                depthBudget: DEPTH_BUDGET_COMPLEX,
                contextKind: CONTEXT_AST_PARSER,
                isStateMachine,
            };
        }
        if (isStateMachine) {
            return {
                depthBudget: DEPTH_BUDGET_COMPLEX,
                contextKind: CONTEXT_STATE_MACHINE,
                isStateMachine,
            };
        }
        if (isEventLoop) {
            return {
                depthBudget: DEPTH_BUDGET_COMPLEX,
                contextKind: CONTEXT_EVENT_LOOP,
                isStateMachine,
            };
        }
        return {
            depthBudget: DEPTH_BUDGET_GENERAL,
            contextKind: CONTEXT_GENERAL_BUSINESS,
            isStateMachine,
        };
    }

    private checkUnboundedNesting(context: ComplexityNestingContext): void {
        const { ctx, name, loc, maxDepth, depthBudget, contextKind, startLine } = context;
        if (maxDepth <= depthBudget) return;
        const isShortSpanGuard = loc <= SHORT_SPAN_GUARD_LOC && maxDepth <= SHORT_SPAN_GUARD_DEPTH;
        if (isShortSpanGuard) return;

        this.issues.push({
            id: `${ANALYZER_COMPLEXITY}:${RULE_CPX_NEST_001}:${ctx.filePath}:${startLine}`,
            analyzer: ANALYZER_COMPLEXITY,
            rule: RULE_CPX_NEST_001,
            severity: SEVERITY_WARNING,
            message:
                `Unbounded control-flow nesting: function '${name}' has nesting depth ${maxDepth} ` +
                `exceeding elastic budget ${depthBudget} for context '${contextKind}'.`,
            location: {
                file: ctx.filePath,
                start: { line: startLine, column: 1 },
                end: { line: startLine, column: 1 },
            },
            detail: {
                function: name,
                maxDepth,
                depthBudget,
                contextKind,
                loc,
            },
            suggestion: SUGGESTION_UNBOUNDED_NESTING,
            actionable: {
                action: ACTION_APPLY_GUARD_CLAUSE,
                code: CODE_CPX_DEEP_NESTING,
                taxonomy: TAXONOMY_CTRL_FLOW,
                safeToAutomate: false,
                templateSnippet: SNIPPET_GUARD_CLAUSE,
                targetArguments: {
                    maxDepth,
                    depthBudget,
                    functionName: name,
                },
            },
        });
    }

    private checkDeepLongSpanEscapes(context: ComplexityNestingContext, fnLines: string[]): void {
        const { ctx, name, loc, maxDepth, depthBudget, contextKind, startLine } = context;
        if (loc < HIGH_SPAN_WARN_LINES || maxDepth < ESCAPE_EVALUATION_MIN_DEPTH) return;

        const thresholdIndent =
            depthBudget >= DEPTH_BUDGET_COMPLEX
                ? INDENT_SPACES_COMPLEX_BUDGET
                : INDENT_SPACES_STANDARD_BUDGET;
        let deepJumpLine = -1;

        for (let i = 0; i < fnLines.length; i++) {
            if (i < ESCAPE_SCAN_START_INDEX) continue;
            const line = fnLines[i];
            const trimmed = line.trimStart();
            const indentSpaces = line.length - trimmed.length;
            if (indentSpaces < thresholdIndent) continue;
            if (!RE_CONTROL_FLOW_ESCAPE.test(trimmed)) continue;
            if (depthBudget >= DEPTH_BUDGET_COMPLEX && loc <= ESCAPE_SPAN_EXTENDED_LIMIT) continue;

            deepJumpLine = startLine + i;
            break;
        }

        if (deepJumpLine <= 0) return;

        this.issues.push({
            id: `${ANALYZER_COMPLEXITY}:${RULE_CPX_NEST_002}:${ctx.filePath}:${deepJumpLine}`,
            analyzer: ANALYZER_COMPLEXITY,
            rule: RULE_CPX_NEST_002,
            severity: SEVERITY_WARNING,
            message:
                `Cognitive jump cost: deep control-flow jump (nesting >= 4) ` +
                `in function '${name}' over long span (${loc} LOC).`,
            location: {
                file: ctx.filePath,
                start: { line: deepJumpLine, column: 1 },
                end: { line: deepJumpLine, column: 1 },
            },
            detail: {
                function: name,
                loc,
                maxDepth,
                jumpLine: deepJumpLine,
                contextKind,
            },
            suggestion: SUGGESTION_DEEP_ESCAPE,
        });
    }

    private checkStateMachineDiscipline(
        ctx: AnalyzerContext,
        name: string,
        startLine: number,
        fnLines: string[],
    ): void {
        let currentCaseLine = -1;
        let currentCaseLength = 0;

        for (let i = 0; i < fnLines.length; i++) {
            const trimmed = fnLines[i].trim();
            if (RE_STATE_MACHINE_BRANCH.test(trimmed)) {
                if (currentCaseLength > MAX_CASE_BRANCH_LINES && currentCaseLine > 0) {
                    this.pushStateMachineCaseIssue(ctx, name, currentCaseLine, currentCaseLength);
                }
                currentCaseLine = startLine + i;
                currentCaseLength = 0;
            } else if (currentCaseLine > 0 && trimmed.length > 0 && !trimmed.startsWith('//')) {
                currentCaseLength++;
            }
        }
    }

    private pushStateMachineCaseIssue(
        ctx: AnalyzerContext,
        name: string,
        caseLine: number,
        caseLength: number,
    ): void {
        this.issues.push({
            id: `${ANALYZER_COMPLEXITY}:${RULE_CPX_STM_001}:${ctx.filePath}:${caseLine}`,
            analyzer: ANALYZER_COMPLEXITY,
            rule: RULE_CPX_STM_001,
            severity: SEVERITY_INFO,
            message:
                `State machine branch discipline: case branch at line ${caseLine} in ` +
                `function '${name}' has length ${caseLength} LOC (threshold: ${MAX_CASE_BRANCH_LINES}).`,
            location: {
                file: ctx.filePath,
                start: { line: caseLine, column: 1 },
                end: { line: caseLine, column: 1 },
            },
            detail: {
                function: name,
                branchLine: caseLine,
                branchLength: caseLength,
            },
            suggestion: SUGGESTION_STATE_MACHINE,
        });
    }

    private finalizeAmplification(ctx: AnalyzerContext): void {
        if (this.loopSites.size === 0) return;
        const thresh = ctx.config?.thresholds as unknown as Record<string, unknown> | undefined;
        const ioPatterns = ctx.options?.blockingIoAllowPatterns ?? thresh?.blockingIoAllowPatterns;
        const allocPatterns =
            ctx.options?.allocationAllowPatterns ?? thresh?.allocationAllowPatterns;
        const toRegExps = (globs: unknown): RegExp[] =>
            ((globs ?? []) as string[]).map((glob) => globToRegExp(glob));
        const ampIssues = detectComplexityAmplification(
            this.loopSites,
            toRegExps(ioPatterns),
            toRegExps(allocPatterns),
        );
        this.issues.push(...ampIssues);

        const normFile = ctx.filePath.replace(/\\/g, '/');
        const isExempt =
            normFile.includes('/test/') ||
            normFile.includes('/tests/') ||
            normFile.includes('/fixtures/') ||
            normFile.includes('/bench') ||
            normFile.endsWith('.test.ts') ||
            normFile.endsWith('.spec.ts');

        if (!isExempt) {
            for (const [fnSymbol, loops] of this.loopSites.entries()) {
                for (let i = 0; i < loops.length; i++) {
                    const loop = loops[i];
                    if (loop.isTautological) {
                        this.issues.push({
                            id: `${ANALYZER_COMPLEXITY}:${RULE_CPX_TRV_001}:${normFile}:${loop.line}`,
                            analyzer: ANALYZER_COMPLEXITY,
                            rule: RULE_CPX_TRV_001,
                            severity: SEVERITY_WARNING,
                            message: `Tautological loop traversal detected in '${fnSymbol}': iteration exhibits zero or negligible state mutation entropy delta (deltaEntropy: ${loop.deltaEntropy ?? 0} <= 0.05).`,
                            location: {
                                file: normFile,
                                start: { line: loop.line, column: 1 },
                                end: { line: loop.line, column: 1 },
                            },
                            detail: {
                                symbol: fnSymbol,
                                scaleVariable: loop.scaleVariable,
                                deltaEntropy: loop.deltaEntropy ?? 0,
                            },
                            suggestion: SUGGESTION_TAUTOLOGICAL_LOOP,
                        });
                    }
                }
            }
        }
    }

    private finalizeElasticAndCohesion(
        ctx: AnalyzerContext,
        opts: Record<string, unknown> | undefined,
        thresh: Record<string, unknown> | undefined,
    ): void {
        const flagElasticBudget = Boolean(
            opts?.enforceElasticBudget ?? thresh?.enforceElasticBudget ?? false,
        );
        const flagCohesion = Boolean(
            opts?.flagCohesionSkeleton ?? thresh?.flagCohesionSkeleton ?? false,
        );

        if (flagElasticBudget) {
            const lineCount =
                this.cachedLines.length > 0
                    ? this.cachedLines.length
                    : ctx.content
                      ? ctx.content.split('\n').length
                      : 1;
            const fileBudgetIssue = evaluateFileCumulativeBudget(
                ctx.filePath,
                lineCount,
                this.functionCCs,
            );
            if (fileBudgetIssue) {
                this.issues.push(fileBudgetIssue);
            }
        }

        if (flagCohesion && this.fileFunctions.length >= MIN_FUNCTIONS_FOR_COHESION) {
            const cohesionResult = analyzeFunctionCohesionAndSkeleton(
                ctx.filePath,
                this.fileFunctions,
            );
            this.issues.push(...cohesionResult.issues);
        }
    }

    private finalizeRedundancy(
        ctx: AnalyzerContext,
        opts: Record<string, unknown> | undefined,
        thresh: Record<string, unknown> | undefined,
    ): void {
        const flagRedundancy = Boolean(
            opts?.flagDistributedRedundancy ?? thresh?.flagDistributedRedundancy ?? false,
        );
        if (!flagRedundancy || this.fileFunctions.length < MIN_FUNCTIONS_FOR_COHESION) return;

        const descriptors = createRoutineDescriptors(this.fileFunctions, ctx.filePath);
        const lineCount =
            this.cachedLines.length > 0
                ? this.cachedLines.length
                : ctx.content
                  ? ctx.content.split('\n').length
                  : DEFAULT_CONTENT_LINE_COUNT;
        const redundancyResult = evaluateDistributedRedundancy(descriptors, lineCount);
        this.issues.push(...redundancyResult.issues);
    }

    private finalizePooling(
        opts: Record<string, unknown> | undefined,
        thresh: Record<string, unknown> | undefined,
    ): void {
        const flagPooling = Boolean(
            opts?.flagResourcePooling ?? thresh?.flagResourcePooling ?? false,
        );
        if (!flagPooling || this.loopSites.size === 0) return;

        const allocSites = collectLoopAllocSites(this.loopSites);
        if (allocSites.length > 0) {
            const poolingResult = evaluateResourcePooling(allocSites, []);
            this.issues.push(...poolingResult.issues);
        }
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        const opts = ctx.options as Record<string, unknown> | undefined;
        const thresh = ctx.config?.thresholds as unknown as Record<string, unknown> | undefined;

        this.finalizeAmplification(ctx);
        this.finalizeElasticAndCohesion(ctx, opts, thresh);
        this.finalizeRedundancy(ctx, opts, thresh);
        this.finalizePooling(opts, thresh);

        return this.issues;
    }

    getLoopSites(): Map<string, LoopSite[]> {
        return this.loopSites;
    }
}
