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
import type { NormalizedNode } from '../core/multilang';
import { NodeKind } from '../core/multilang';
import { locN } from '../utils/normalized';
import { runStreaming } from '../core/traverse';
import { maskedLinesOfPath } from '../core/sourceMask';
import { globToRegExp } from '../core/fileDiscovery';
import type { LoopSite } from '../core/intelligence/semanticComplexity';
import {
    detectComplexityAmplification,
    isBoundedCollection,
} from '../core/intelligence/semanticComplexity';

/**
 * Cyclomatic-complexity value at or above which the extraction hint is labelled critical.
 */
const CRITICAL_COMPLEXITY_THRESHOLD = 30;

/**
 * Cyclomatic-complexity value at or above which the extraction hint is labelled high.
 */
const HIGH_COMPLEXITY_THRESHOLD = 20;

/**
 * Number of leading extraction tips shown for the high-complexity hint tier.
 */
const HIGH_COMPLEXITY_TIP_COUNT = 3;

/**
 * Maximum window of lines inside a loop body inspected for allocations and blocking I/O.
 */
const MAX_LOOP_INSPECTION_WINDOW_LINES = 30;

/** Default scale collection variable name when loop target cannot be parsed. */
const DEFAULT_SCALE_VAR = 'dynamicCollection';

/**
 * Cyclomatic complexity of a function-like node: base 1 + sum of `branchWeight` over every
 * decision point inside it, NOT descending into nested function-like nodes (each nested
 * function is its own complexity unit, measured separately). Branch weights are precomputed
 * by the language adapter, so this is fully language-agnostic.
 */
function walkChildrenCC(node: NormalizedNode): number {
    let sum = 0;
    const kids = node.children;
    if (!kids) return 0;
    for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.functionLike) continue;
        sum += (c.branchWeight || 0) + walkChildrenCC(c);
    }
    return sum;
}

function cyclomaticComplexity(node: NormalizedNode): number {
    return 1 + walkChildrenCC(node);
}

/** Resolve a human-readable name for a function-like node using the threaded scope. */
function nameFor(node: NormalizedNode, className: string | null, binding: string | null): string {
    if (node.kind === NodeKind.Function) {
        if (node.name) return node.name;
        return binding ?? (className ? className + '.<anonymous>' : 'anonymous');
    }
    if (node.kind === NodeKind.Method && !node.isConstructor) {
        const m = node.name ?? 'anonymous';
        return className ? className + '.' + m : m;
    }
    if (node.isConstructor) {
        return className ? className + '.constructor' : 'constructor';
    }
    return binding ?? (className ? className + '.<anonymous>' : 'anonymous');
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

    analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
        this.issues = [];
        this.loopSites.clear();
        this.maskedLines = maskedLinesOfPath(ctx.filePath, ctx.content);

        const { TypeScriptAdapter } =
            require('../core/typescriptAdapter') as typeof import('../core/typescriptAdapter');
        const adapter = new TypeScriptAdapter();
        const ast = adapter.parse(sf.text, ctx.filePath);
        return runStreaming(adapter, ast.root, [
            { analyzer: this, ctx: { ...ctx, sourceFile: sf, root: ast.root, adapter } },
        ]);
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
        const t = ctx.options;
        const state = ctx.incremental;
        const name = nameFor(node, className, binding);

        // The engine drives visit/finalize directly (only the standalone contract calls
        // analyze), so the masked view is built here on first use per file.
        if (this.maskedFor !== ctx.filePath) {
            this.maskedLines = maskedLinesOfPath(ctx.filePath, ctx.content);
            this.maskedFor = ctx.filePath;
        }

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

        const fnKey = `${node.start?.line ?? 1}:${node.start?.column ?? 1}`;
        let cc: number;
        if (state && state.isReusedFunction(node)) {
            const cached = state.getComplexity(fnKey);
            cc = cached !== undefined ? cached : cyclomaticComplexity(node);
        } else {
            cc = cyclomaticComplexity(node);
        }
        if (state) state.setComplexity(fnKey, cc);
        if (cc < t.complexityWarn) return;

        const severity: Severity = cc >= t.complexityFail ? 'error' : 'warning';
        const first = node.children && node.children[0];
        const startNode = first && first.rawKind === 'FunctionKeyword' ? first : node;

        this.issues.push({
            id: `complexity:high-complexity:${ctx.filePath}:${node.start?.line ?? 1}`,
            analyzer: 'complexity',
            rule: 'high-complexity',
            severity,
            message: `Function "${name}" has cyclomatic complexity ${cc} (threshold ${t.complexityWarn}).`,
            location: locN(startNode, ctx.filePath),
            detail: {
                function: name,
                cyclomaticComplexity: cc,
                warn: t.complexityWarn,
                fail: t.complexityFail,
            },
            suggestion: this.optimizationHint(cc),
        });
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        if (this.loopSites.size > 0) {
            const toRegExps = (globs: unknown): RegExp[] =>
                ((globs ?? []) as string[]).map((glob) => globToRegExp(glob));
            const ampIssues = detectComplexityAmplification(
                this.loopSites,
                toRegExps(ctx.options?.blockingIoAllowPatterns),
                toRegExps(ctx.options?.allocationAllowPatterns),
            );
            this.issues.push(...ampIssues);
        }
        return this.issues;
    }

    getLoopSites(): Map<string, LoopSite[]> {
        return this.loopSites;
    }

    private optimizationHint(cc: number): string {
        const tips = [
            'Extract deeply nested branches into small, well-named helper functions.',
            'Replace nested conditionals with early returns / guard clauses.',
            'Replace long switch/if-else chains with a lookup table (map/object/strategy).',
            'Decompose boolean expressions and repeated conditionals into named predicates.',
        ];
        if (cc >= CRITICAL_COMPLEXITY_THRESHOLD) return `Critical complexity. ${tips.join(' ')}`;
        if (cc >= HIGH_COMPLEXITY_THRESHOLD) {
            return `High complexity. ${tips.slice(0, HIGH_COMPLEXITY_TIP_COUNT).join(' ')}`;
        }
        return `Moderate complexity. ${tips.slice(0, 2).join(' ')}`;
    }
}

/**
 * Loop headers the engine treats as iteration sites.
 */
const LOOP_HEADER_RE = /\b(?:for\s*\(|for\s+[a-zA-Z0-9_$]+\s+in|while\s*\(|do\s*\{)\b/;

/**
 * Per-iteration allocation the hoist advice actually applies to.
 *
 * Only reusable containers qualify: `new Worker`, `new Error` or `new IncrementalFileState`
 * are created per item by necessity, and reporting them as hoistable told users to cache
 * things that cannot be cached.
 */
const TRANSIENT_CONTAINER_RE =
    /\b(?:new\s+(?:Array|Object|Map|Set|WeakMap|WeakSet|Int8Array|Uint8Array|Int16Array|Uint16Array|Int32Array|Uint32Array|Float32Array|Float64Array)|\/duplicate\(true\)|\.clone\()/;

/** Synchronous I/O calls that amplify its cost when run once per iteration. */
const BLOCKING_IO_RE =
    /\b(?:fs\.readFileSync|fs\.writeFileSync|execSync|spawnSync|socket\.send|db\.query)\b/;

/**
 * Resolve the variable or expression a loop is bounded by.
 *
 * @param lineText - Raw loop header line.
 * @returns The iterated expression, or the generic fallback when the header is unusual.
 */
function resolveLoopScaleVariable(lineText: string): string {
    const ofInMatch = lineText.match(
        /\bfor\s*(?:\([^;]+?(?:of|in)\s+([^);{]+)|[A-Za-z0-9_$,\s]+\s+in\s+([^:#\n]+))/,
    );
    if (ofInMatch) return (ofInMatch[1] || ofInMatch[2] || DEFAULT_SCALE_VAR).trim();
    const cStyleMatch = lineText.match(/;\s*[^<>=!]+[<>=!]+\s*([^;]+);/);
    return cStyleMatch ? cStyleMatch[1].trim() : DEFAULT_SCALE_VAR;
}

/**
 * Find the line where a brace-delimited loop body closes.
 *
 * @param masked - Masked lines, so a brace inside a string cannot unbalance the match.
 * @param headerLine - 1-based line of the loop header.
 * @param cap - Last line the search may reach.
 * @returns 1-based closing line, or the cap when the body never closes inside it.
 */
function braceMatchedEnd(masked: string[], headerLine: number, cap: number): number {
    let depth = 0;
    for (let l = headerLine; l <= cap; l++) {
        for (const ch of masked[l - 1] ?? '') {
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth <= 0) return l;
            }
        }
    }
    return cap;
}

/**
 * Locate the first and last line of a loop body.
 *
 * The allocation and blocking-I/O scan must stay inside the body: a fixed line window used to
 * reach past the closing brace and attribute unrelated code below the loop to it. A brace-less
 * body is the statement on the header line or the next non-empty line.
 *
 * @param masked - Masked lines of the file, so braces inside strings never unbalance the match.
 * @param headerLine - 1-based line of the loop header.
 * @param endLine - Last line that may belong to the body (function end).
 * @returns Inclusive 1-based line range of the body.
 */
function loopBodyRange(
    masked: string[],
    headerLine: number,
    endLine: number,
): { from: number; to: number } {
    // Without a masked view the brace match cannot be trusted; fall back to the bounded window.
    if (masked.length === 0) {
        return {
            from: headerLine,
            to: Math.min(endLine, headerLine + MAX_LOOP_INSPECTION_WINDOW_LINES),
        };
    }
    const header = masked[headerLine - 1] ?? '';
    const afterParen = header.slice(header.lastIndexOf(')') + 1);
    if (header.indexOf('{', header.lastIndexOf(')') + 1) >= 0) {
        const cap = Math.min(endLine, headerLine + MAX_LOOP_INSPECTION_WINDOW_LINES);
        return { from: headerLine, to: braceMatchedEnd(masked, headerLine, cap) };
    }
    if (afterParen.trim().length > 0) return { from: headerLine, to: headerLine };
    for (let l = headerLine + 1; l <= endLine; l++) {
        if ((masked[l - 1] ?? '').trim().length > 0) return { from: headerLine, to: l };
    }
    return { from: headerLine, to: headerLine };
}

/**
 * Scan a loop body for per-iteration allocation and blocking I/O.
 *
 * @param lines - Raw file lines.
 * @param from - First body line (inclusive, 1-based).
 * @param to - Last body line (inclusive, 1-based).
 * @returns Flags the complexity rules report on.
 */
function inspectLoopBody(
    lines: string[],
    from: number,
    to: number,
): { hasTransientAllocation: boolean; hasBlockingIo: boolean } {
    let hasTransientAllocation = false;
    let hasBlockingIo = false;
    for (let l = from; l <= to && l <= lines.length; l++) {
        const txt = lines[l - 1] ?? '';
        if (!hasTransientAllocation && TRANSIENT_CONTAINER_RE.test(txt)) {
            hasTransientAllocation = true;
        }
        if (!hasBlockingIo && BLOCKING_IO_RE.test(txt)) hasBlockingIo = true;
        if (hasTransientAllocation && hasBlockingIo) break;
    }
    return { hasTransientAllocation, hasBlockingIo };
}

/**
 * Collect the loop sites declared inside one function.
 *
 * @param fnNode - Function node being visited.
 * @param fnSymbol - Display name of the function.
 * @param filePath - File the function belongs to.
 * @param content - Raw file content.
 * @param masked - Masked lines of the same file.
 * @returns One site per detected loop header.
 */
function findLoopSitesInFunction(
    fnNode: NormalizedNode,
    fnSymbol: string,
    filePath: string,
    content: string,
    masked: string[],
): LoopSite[] {
    const lines = content.split('\n');
    const sites: LoopSite[] = [];
    const startLine = fnNode.start?.line ?? 1;
    const endLine = fnNode.end?.line ?? lines.length;

    for (let l = startLine; l <= endLine && l <= lines.length; l++) {
        const lineText = lines[l - 1] ?? '';
        const trimmed = lineText.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
        if (!LOOP_HEADER_RE.test(lineText)) continue;

        const scaleVariable = resolveLoopScaleVariable(lineText);
        const body = loopBodyRange(masked, l, endLine);
        sites.push({
            file: filePath,
            line: l,
            symbol: fnSymbol,
            isBounded: isBoundedCollection(scaleVariable),
            scaleVariable,
            ...inspectLoopBody(lines, body.from, body.to),
        });
    }

    return sites;
}
