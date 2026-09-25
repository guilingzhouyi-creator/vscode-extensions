import type * as ts from 'typescript';
import type { Analyzer, AnalyzerContext, Issue, FileMetric, Severity } from '../core/types';
import type { NormalizedNode } from '../core/multilang';
import { NodeKind } from '../core/multilang';
import { runStreaming } from '../core/traverse';
import { analyzeCodeDensity } from '../core/intelligence/code-density-analyzer';
import { inferFineGrainedFileRole } from '../core/intelligence/file-role-inference';
import { evaluateRoleElasticBudget } from '../core/intelligence/elastic-budget-matrix';

function firstWord(name: string): string {
    const m = name.match(/^[a-z]+|^[A-Z]+/) || ['misc'];
    return m[0].toLowerCase();
}

/**
 * Module: Static Analysis — Large File & Decomposition Analyzer
 * File Path: src/analyzers/large-file.ts
 * Architecture Role: Analyzer adapter serving both the single-pass streaming path
 *   (visit/finalize) and the standalone analyze() contract.
 * Dependencies & Triggers: Core types, NodeKind/NormalizedNode, runStreaming, plus a lazy
 *   require('../core/typescript-adapter') used only by analyze(); triggered by engine passes.
 * Responsibilities: Accumulate lines, non-blank lines, functions, max nesting depth,
 *   top-level declarations and exported symbols; infer module prefixes from the first word of
 *   function names; emit at most one large-file finding with split suggestions when the
 *   configured line/function thresholds are crossed.
 * Exit Semantics & Design Rationale: Returns [] when metrics are within thresholds; severity
 *   is error at lines >= fileLinesFail, otherwise warning at lines >= fileLinesWarn or
 *   functions >= fileFunctionsWarn. Metrics are gathered in one visit pass so streaming stays
 *   O(n) and the same values feed both the gate and the emitted split guidance.
 *
 * Large-file splitting analyzer (language-agnostic).
 *
 * In the single-pass model, `visit` accumulates the structural metrics AND the inferred module
 * prefixes using the adapter-precomputed `node.topLevel` / `node.exported` / `node.functionLike`
 * flags (previously four+ separate `ts.forEachChild` walks). `finalize` consults the
 * (per-analyzer) thresholds and emits at most one issue when the file is too large.
 * `analyze` delegates to `runStreaming` via the TypeScript adapter.
 *
 * Judgment conditions (configurable thresholds):
 *   - lines >= fileLinesFail                        -> error   (must split)
 *   - lines >= fileLinesWarn OR functions >= fileFunctionsWarn -> warning (should split)
 */
export class LargeFileAnalyzer implements Analyzer {
    name = 'large-file' as const;

    private lines = 0;
    private nonBlankLines = 0;
    private functions = 0;
    private maxNesting = 0;
    private topLevelDeclarations = 0;
    private exportedSymbols = 0;
    private modules = new Set<string>();

    analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
        this.reset();
        // Lazy: the TypeScript adapter (and the `typescript` module) is only needed for the
        // standalone `analyze()` contract — never on the worker streaming path.

        const { TypeScriptAdapter } =
            require('../core/typescript-adapter') as typeof import('../core/typescript-adapter');
        const adapter = new TypeScriptAdapter();
        const ast = adapter.parse(sf.text, ctx.filePath);
        return runStreaming(adapter, ast.root, [
            { analyzer: this, ctx: { ...ctx, sourceFile: sf, root: ast.root, adapter } },
        ]);
    }

    private reset(): void {
        this.lines = 0;
        this.nonBlankLines = 0;
        this.functions = 0;
        this.maxNesting = 0;
        this.topLevelDeclarations = 0;
        this.exportedSymbols = 0;
        this.modules.clear();
    }

    visit(
        node: NormalizedNode,
        _ctx: AnalyzerContext,
        parent: NormalizedNode | undefined,
        _grandparent: NormalizedNode | undefined,
        depth: number,
        _className: string | null,
        _binding: string | null,
    ): void {
        if (parent && parent.kind === NodeKind.SourceFile) {
            if (node.topLevel) {
                this.topLevelDeclarations++;
                if (node.exported) this.exportedSymbols++;
            }
            if (node.functionLike) {
                const name = node.name;
                if (name) this.modules.add(firstWord(name));
            }
        }
        if (node.functionLike) this.functions++;
        if (depth > this.maxNesting) this.maxNesting = depth;
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        // Read the engine-precomputed line stats when present so every analyzer shares one
        // pass per file; fall back to split-based counting for direct `analyze()` calls so
        // the produced values stay byte-identical.
        let lines: number;
        let nonBlankLines: number;
        if (ctx.lineStats) {
            lines = ctx.lineStats.lines;
            nonBlankLines = ctx.lineStats.nonBlankLines;
        } else {
            const content = ctx.content;
            lines = content.split(/\r\n|\n/).length;
            nonBlankLines = content.split(/\r\n|\n/).filter((l) => l.trim().length > 0).length;
        }
        this.lines = lines;
        this.nonBlankLines = nonBlankLines;

        const m: FileMetric = {
            file: ctx.filePath,
            lines: this.lines,
            nonBlankLines: this.nonBlankLines,
            functions: this.functions,
            maxNestingDepth: this.maxNesting,
            topLevelDeclarations: this.topLevelDeclarations,
            exportedSymbols: this.exportedSymbols,
        };

        const t = ctx.options;
        const density = analyzeCodeDensity(ctx.content, ctx.filePath);
        const roleInference = inferFineGrainedFileRole(ctx.filePath, ctx.content.slice(0, 500));
        const elasticEvaluation = evaluateRoleElasticBudget(roleInference.role, density);

        // When elastic budget is enabled or module is documented/low-density,
        // base verdict on real effective code load rather than raw line count.
        if (
            t.enableElasticBudget === true ||
            (density.isLowDensityDocumented && !elasticEvaluation.shouldFlagLargeFile)
        ) {
            if (!elasticEvaluation.shouldFlagLargeFile && m.functions < t.fileFunctionsWarn) {
                return [];
            }
        }

        let severity: Severity | null = null;
        const reasons: string[] = [];

        if (m.lines >= t.fileLinesFail) {
            severity = 'error';
            reasons.push(`lines ${m.lines} >= fail threshold ${t.fileLinesFail}`);
        } else if (m.lines >= t.fileLinesWarn || m.functions >= t.fileFunctionsWarn) {
            severity = 'warning';
            if (m.lines >= t.fileLinesWarn)
                reasons.push(`lines ${m.lines} >= warn threshold ${t.fileLinesWarn}`);
            if (m.functions >= t.fileFunctionsWarn)
                reasons.push(`functions ${m.functions} >= warn threshold ${t.fileFunctionsWarn}`);
        }

        if (!severity) return [];

        const modules = [...this.modules];
        const suggestions: string[] = [];
        suggestions.push(
            `Split into smaller modules by responsibility (current: ${m.lines} lines, ${m.functions} functions, ` +
                `${m.topLevelDeclarations} top-level declarations, ${m.exportedSymbols} exports, max nesting ${m.maxNestingDepth}).`,
        );
        if (modules.length > 1) {
            suggestions.push(
                `Detected potential modules by name prefix: ${modules.join(', ')}. ` +
                    `Consider extracting each into its own file under a dedicated directory.`,
            );
        }

        const detailPayload: Record<string, unknown> = {
            ...m,
            reasons,
            inferredModules: modules,
        };
        if (t.enableElasticBudget === true) {
            detailPayload.densityMetrics = density;
            detailPayload.fileRole = roleInference.role;
            detailPayload.elasticEvaluation = elasticEvaluation;
        }

        return [
            {
                id: `large-file:large-file:${ctx.filePath}:1`,
                analyzer: 'large-file',
                rule: 'large-file',
                severity,
                message:
                    severity === 'error'
                        ? `File is too large and should be split (${reasons.join('; ')}).`
                        : `File is large; consider splitting (${reasons.join('; ')}).`,
                location: {
                    file: ctx.filePath,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 1 },
                },
                detail: detailPayload,
                suggestion: suggestions.join(' '),
            },
        ];
    }
}
