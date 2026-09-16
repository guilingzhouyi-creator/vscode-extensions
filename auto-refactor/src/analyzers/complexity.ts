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
 *
 * `visit` is invoked for every node; when it lands on a function-like node it computes that
 * node's CC by summing adapter-precomputed `branchWeight`s (skipping nested functions) and,
 * if at/above the warn threshold, emits a finding. The enclosing class name and binding scope
 * arrive pre-threaded in `className` / `binding`, which the engine derives with the same rules
 * the previous recursive `collect` used — so names are identical.
 */
export class ComplexityAnalyzer implements Analyzer {
    name = 'complexity' as const;

    private issues: Issue[] = [];

    analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
        this.issues = [];
        // Lazy: the TypeScript adapter (and the `typescript` module) is only needed for the
        // standalone `analyze()` contract — never on the worker streaming path.

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
        // T03 memo: the cc VALUE is a pure function of the function's source text. When the
        // subtree was reused (byte-identical + position-stable), read the value written by the
        // previous scan instead of re-walking `branchWeight` over every subtree node. The name /
        // position / startNode are STILL derived from this fresh function node below — only the
        // numeric cc is memoized. Any key mismatch (e.g. an export-position shift in oxc) falls
        // back to a recompute + write, so the value stays byte-identical.
        const fnKey = `${node.start!.line}:${node.start!.column}`;
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
        const name = nameFor(node, className, binding);

        // Mirror the original startNode rule: when the function's first child is the bare
        // `function` keyword (no async/export modifiers), point the finding at the keyword itself.
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

    finalize(_ctx: AnalyzerContext): Issue[] {
        return this.issues;
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
