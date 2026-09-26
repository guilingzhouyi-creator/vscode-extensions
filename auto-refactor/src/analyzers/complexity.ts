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
import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_ERROR, SEVERITY_INFO } from '../core/types';
import {
    ANALYZER_COMPLEXITY,
    RULE_CPX_NEST_001,
    RULE_CPX_NEST_002,
    RULE_CPX_STM_001,
} from '../core/scoring/dimensionLiterals';
import type { NormalizedNode } from '../core/multilang';
import { NodeKind } from '../core/multilang';
import { locN } from '../utils/normalized';
import { runStreaming } from '../core/traverse';
import { maskedLinesOfPath } from '../core/source-mask';
import { globToRegExp } from '../core/file-discovery';
import type { LoopSite } from '../core/intelligence/semanticComplexity';
import { detectComplexityAmplification } from '../core/intelligence/semanticComplexity';
import { evaluateStructuredClarity, formatOptimizationHint } from './structured-clarity';
import {
    findLoopSitesInFunction,
    collectLoopAllocSites,
    createRoutineDescriptors,
    cyclomaticComplexity,
} from './complexity-loops';
import {
    evaluateElasticComplexityBudget,
    evaluateFileCumulativeBudget,
} from '../core/intelligence/elastic-complexity-budget';
import { analyzeFunctionCohesionAndSkeleton } from '../core/intelligence/function-cohesion-skeleton';
import { evaluateDistributedRedundancy } from '../core/intelligence/semantic-domain-detector';
import { evaluateResourcePooling } from '../core/intelligence/resource-pooling-auditor';

function formatAnonymous(className: string | null, binding: string | null): string {
    if (binding) return binding;
    return className ? `${className}.<anonymous>` : 'anonymous';
}

/** Resolve a human-readable name for a function-like node using the threaded scope. */
function nameFor(node: NormalizedNode, className: string | null, binding: string | null): string {
    if (node.isConstructor) {
        return className ? `${className}.constructor` : 'constructor';
    }
    if (node.kind === NodeKind.Method) {
        const m = node.name || 'anonymous';
        return className ? `${className}.${m}` : m;
    }
    if (node.name) {
        return node.name;
    }
    return formatAnonymous(className, binding);
}

function resolveStartNode(node: NormalizedNode): NormalizedNode {
    const first = node.children?.[0];
    if (first && first.rawKind === 'FunctionKeyword') {
        return first;
    }
    return node;
}

function buildComplexityDetail(
    name: string,
    cc: number,
    warn: number,
    fail: number,
    clarity: ReturnType<typeof evaluateStructuredClarity>,
): Record<string, unknown> {
    const detail: Record<string, unknown> = {
        function: name,
        cyclomaticComplexity: cc,
        warn,
        fail,
    };
    if (clarity.isStructurallyClear) {
        detail.effectiveWarn = clarity.effectiveWarn;
        detail.effectiveFail = clarity.effectiveFail;
        detail.maxBranchDepth = clarity.maxDepth;
        detail.structuredClarity = true;
    }
    return detail;
}

function buildComplexityIssue(
    node: NormalizedNode,
    ctx: AnalyzerContext,
    name: string,
    cc: number,
    clarity: ReturnType<typeof evaluateStructuredClarity>,
): Issue {
    const t = ctx.options;
    const severity: Severity = cc >= clarity.effectiveFail ? SEVERITY_ERROR : SEVERITY_WARNING;
    const startNode = resolveStartNode(node);

    const message = clarity.isStructurallyClear
        ? `Function "${name}" has cyclomatic complexity ${cc} (exceeds relaxed threshold ` +
          `${clarity.effectiveWarn} for shallow structure).`
        : `Function "${name}" has cyclomatic complexity ${cc} (threshold ${t.complexityWarn}).`;

    const suggestion = clarity.isStructurallyClear
        ? 'Function has flat control flow but high branching. ' +
          'Consider a lookup table (map/strategy pattern) to eliminate branches.'
        : formatOptimizationHint(cc);

    return {
        id: `complexity:high-complexity:${ctx.filePath}:${node.start?.line ?? 1}`,
        analyzer: ANALYZER_COMPLEXITY,
        rule: 'high-complexity',
        severity,
        message,
        location: locN(startNode, ctx.filePath),
        detail: buildComplexityDetail(name, cc, t.complexityWarn, t.complexityFail, clarity),
        suggestion,
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

        const { TypeScriptAdapter } =
            require('../core/typescript-adapter') as typeof import('../core/typescript-adapter');
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
        const cc = cyclomaticComplexity(node);
        if (state) {
            state.setComplexity(fnKey, cc);
        }
        return cc;
    }

    private ensureFileState(filePath: string, content?: string): void {
        if (this.maskedFor === filePath) return;
        this.maskedLines = maskedLinesOfPath(filePath, content || '');
        this.maskedFor = filePath;
        this.functionCCs = [];
        this.fileFunctions = [];
    }

    private checkElasticBudget(
        node: NormalizedNode,
        ctx: AnalyzerContext,
        name: string,
        cc: number,
        loc: number,
        maxDepth: number,
        startLine: number,
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
                name,
                filePath: ctx.filePath,
                language: lang,
                cc,
                loc,
                maxDepth,
                startLine,
                startColumn: node.start?.column ?? 1,
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
        _parent: NormalizedNode | undefined,
        _grandparent: NormalizedNode | undefined,
        _depth: number,
        className: string | null,
        binding: string | null,
    ): void {
        if (!node.functionLike) return;
        const name = nameFor(node, className, binding);

        // The engine drives visit/finalize directly (only the standalone contract calls
        // analyze), so the masked view is built here on first use per file.
        this.ensureFileState(ctx.filePath, ctx.content);

        // Collect loop sites within the function boundaries
        const fnSites = findLoopSitesInFunction(
            node,
            name,
            ctx.filePath,
            ctx.content,
            this.maskedLines,
        );
        if (fnSites.length > 0) {
            this.loopSites.set(name, fnSites);
        }

        const cc = this.computeComplexity(node, ctx.incremental);
        this.functionCCs.push(cc);

        const startLine = node.start?.line ?? 1;
        const endLine = node.end?.line ?? startLine;
        const loc = Math.max(1, endLine - startLine + 1);

        const clarity = evaluateStructuredClarity(
            node,
            ctx,
            ctx.options.complexityWarn,
            ctx.options.complexityFail,
        );

        const allLines = ctx.content ? ctx.content.split('\n') : [];
        const fnLines = allLines.slice(startLine - 1, endLine);
        this.fileFunctions.push({ name, startLine, endLine, cc, lines: fnLines });

        this.checkElasticBudget(node, ctx, name, cc, loc, clarity.maxDepth, startLine);
        this.checkControlFlowNestingAndEscapes(
            node,
            ctx,
            name,
            loc,
            clarity.maxDepth,
            startLine,
            fnLines,
        );

        if (cc >= clarity.effectiveWarn) {
            this.issues.push(buildComplexityIssue(node, ctx, name, cc, clarity));
        }
    }

    /**
     * Context-aware evaluation of control-flow nesting depth, elastic budgets, and deep escapes.
     * Differentiates legitimate state machines, AST parsers, and short-span guards from
     * unbounded business logic nesting.
     */
    private checkControlFlowNestingAndEscapes(
        _node: NormalizedNode,
        ctx: AnalyzerContext,
        name: string,
        loc: number,
        maxDepth: number,
        startLine: number,
        fnLines: string[],
    ): void {
        const { depthBudget, contextKind, isStateMachine } = this.resolveNestingBudget(
            ctx,
            name,
            fnLines,
        );

        this.checkUnboundedNesting(ctx, name, loc, maxDepth, depthBudget, contextKind, startLine);
        this.checkDeepLongSpanEscapes(
            ctx,
            name,
            loc,
            maxDepth,
            depthBudget,
            contextKind,
            startLine,
            fnLines,
        );
        if (isStateMachine) {
            this.checkStateMachineDiscipline(ctx, name, startLine, fnLines);
        }
    }

    private resolveNestingBudget(
        ctx: AnalyzerContext,
        name: string,
        fnLines: string[],
    ): { depthBudget: number; contextKind: string; isStateMachine: boolean } {
        const isParserContext =
            /(?:adapter|parser|lexer|walker|codec|deserializer|ast|analyzer|audit|evaluator|graph|rule)/i.test(
                ctx.filePath,
            ) || /(?:parse|tokenize|decode|visit|walk|match|audit|analyze|evaluate|dispatch)/i.test(name);

        const hasSwitchOrDispatch = fnLines.some((l) =>
            /^\s*(?:switch\b|case\b|match\b)/.test(l),
        );
        const isStateMachine = hasSwitchOrDispatch && fnLines.length >= 15;
        const isEventLoop =
            /(?:daemon|server|worker|poller|eventloop)/i.test(ctx.filePath) ||
            /(?:daemon|poll|listen|loop)/i.test(name);

        if (isParserContext) {
            return { depthBudget: 5, contextKind: 'ast-parser', isStateMachine };
        }
        if (isStateMachine) {
            return { depthBudget: 5, contextKind: 'state-machine', isStateMachine };
        }
        if (isEventLoop) {
            return { depthBudget: 5, contextKind: 'event-loop', isStateMachine };
        }
        return { depthBudget: 3, contextKind: 'general-business', isStateMachine };
    }

    private checkUnboundedNesting(
        ctx: AnalyzerContext,
        name: string,
        loc: number,
        maxDepth: number,
        depthBudget: number,
        contextKind: string,
        startLine: number,
    ): void {
        if (maxDepth <= depthBudget) return;
        const isShortSpanGuard = loc <= 25 && maxDepth <= 4;
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
            suggestion:
                'Flatten control flow using early returns (guard clauses) or extract nested blocks.',
        });
    }

    private checkDeepLongSpanEscapes(
        ctx: AnalyzerContext,
        name: string,
        loc: number,
        maxDepth: number,
        depthBudget: number,
        contextKind: string,
        startLine: number,
        fnLines: string[],
    ): void {
        if (loc < 60 || maxDepth < 4) return;

        const thresholdIndent = depthBudget >= 5 ? 20 : 16;
        let deepJumpLine = -1;

        for (let i = 0; i < fnLines.length; i++) {
            if (i < 40) continue;
            const line = fnLines[i];
            const trimmed = line.trimStart();
            const indentSpaces = line.length - trimmed.length;
            if (indentSpaces < thresholdIndent) continue;
            if (!/^(?:return\b|throw\b|break\b|continue\b)/.test(trimmed)) continue;
            if (depthBudget >= 5 && loc <= 120) continue;

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
            suggestion:
                'Extract deeply nested block into a localized helper method to reduce jump distance.',
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
            if (/^(?:case\b|default:)/.test(trimmed)) {
                if (currentCaseLength > 35 && currentCaseLine > 0) {
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
                `function '${name}' has length ${caseLength} LOC (threshold: 35).`,
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
            suggestion:
                'Extract branch body into a dedicated action to keep dispatch lean.',
        });
    }

    private finalizeAmplification(ctx: AnalyzerContext): void {
        if (this.loopSites.size === 0) return;
        const toRegExps = (globs: unknown): RegExp[] =>
            ((globs ?? []) as string[]).map((glob) => globToRegExp(glob));
        const ampIssues = detectComplexityAmplification(
            this.loopSites,
            toRegExps(ctx.options?.blockingIoAllowPatterns),
            toRegExps(ctx.options?.allocationAllowPatterns),
        );
        this.issues.push(...ampIssues);
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
            const fileBudgetIssue = evaluateFileCumulativeBudget(
                ctx.filePath,
                ctx.content ? ctx.content.split('\n').length : 1,
                this.functionCCs,
            );
            if (fileBudgetIssue) {
                this.issues.push(fileBudgetIssue);
                void 0;
            }
        }

        if (flagCohesion && this.fileFunctions.length >= 2) {
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
        if (!flagRedundancy || this.fileFunctions.length < 2) return;

        const descriptors = createRoutineDescriptors(this.fileFunctions, ctx.filePath);
        const redundancyResult = evaluateDistributedRedundancy(
            descriptors,
            ctx.content ? ctx.content.split('\n').length : 100,
        );
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
