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
import { SEVERITY_WARNING, SEVERITY_ERROR } from '../core/types';
import { ANALYZER_COMPLEXITY } from '../core/scoring/dimensionLiterals';
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

        if (cc >= clarity.effectiveWarn) {
            this.issues.push(buildComplexityIssue(node, ctx, name, cc, clarity));
        }
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
