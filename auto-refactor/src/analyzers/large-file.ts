/**
 * Module: Static Analysis — Large File & Decomposition Analyzer
 * File Path: src/analyzers/large-file.ts
 * Architecture Role: Analyzer adapter serving both the single-pass streaming path
 *   (visit/finalize) and the standalone analyze() contract.
 * Dependencies & Triggers: Core types, NodeKind/NormalizedNode, runStreaming, plus a lazy
 *   require('../core/ast/typescript-adapter') used only by analyze(); triggered by engine passes.
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

import * as path from 'path';
import type * as ts from 'typescript';
import type { Analyzer, AnalyzerContext, Issue, FileMetric, Severity } from '../core/types';
import type { NormalizedNode } from '../core/ast/multilang';
import { NodeKind } from '../core/ast/multilang';
import { runStreaming } from '../core/ast/traverse';
import { analyzeCodeDensity } from '../core/intelligence/code-density-analyzer';
import { inferFineGrainedFileRole } from '../core/intelligence/file-role-inference';
import { evaluateRoleElasticBudget } from '../core/intelligence/elastic-budget-matrix';
import { partitionFileZones } from '../core/intelligence/zone-partitioner';
import { isConstantDefinitionFile } from '../core/intelligence/constant-identity';

/** Architectural token representing benign constant library classification. */
export const ARCH_BENIGN_CONSTANT_LIBRARY = 'ARCH_BENIGN_CONSTANT_LIBRARY';

function firstWord(name: string): string {
    const m = name.match(/^[a-z]+|^[A-Z]+/) || ['misc'];
    return m[0].toLowerCase();
}

/**
 * Determines whether a file qualifies as a benign large constant library.
 *
 * @param filePath - Source file path.
 * @param content - Source file full content.
 * @param m - Accumulated file metrics.
 * @returns True if file is a pure constant catalog with minimal logic.
 */
function isBenignConstantLibrary(filePath: string, content: string, m: FileMetric): boolean {
    if (!isConstantDefinitionFile(filePath, content)) {
        return false;
    }
    if (m.functions > 2 || m.maxNestingDepth > 3) {
        return false;
    }
    const stripped = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    const cfMatches =
        stripped.match(/\b(?:if\s*\(|for\s*\(|while\s*\(|switch\s*\(|catch\s*\()/g) || [];
    return cfMatches.length <= 2;
}

function shouldExemptElastic(
    t: Record<string, any>,
    density: any,
    elasticEvaluation: any,
    zoneProfile: any,
    functionsCount: number,
    isBenignConstant = false,
    lines = 0,
): boolean {
    if (isBenignConstant && lines <= 3000) {
        return true;
    }
    if (!t.enableElasticBudget && !density.isLowDensityDocumented) {
        return false;
    }
    if (
        density.effectiveCodeLines >= 1500 &&
        zoneProfile.isDecoupled &&
        functionsCount < t.fileFunctionsWarn * 4
    ) {
        return true;
    }
    return !elasticEvaluation.shouldFlagLargeFile && functionsCount < t.fileFunctionsWarn;
}

function getEvaluatedEffectiveLoc(density: any, zoneProfile: any): number {
    if (zoneProfile && typeof zoneProfile.productionEffectiveLoc === 'number') {
        return zoneProfile.productionEffectiveLoc;
    }
    return density ? density.effectiveCodeLines : 0;
}

function checkFailThreshold(
    m: FileMetric,
    t: Record<string, any>,
    density: any,
    zoneProfile?: any,
): string | null {
    const effectiveLoc = getEvaluatedEffectiveLoc(density, zoneProfile);
    if (t.effectiveLocFail && effectiveLoc >= t.effectiveLocFail) {
        return `effective LOC ${effectiveLoc} >= fail threshold ${t.effectiveLocFail} (lines: ${m.lines})`;
    }
    if (m.lines >= t.fileLinesFail) {
        const testWarn = t.fileLinesWarn || 400;
        if (zoneProfile && zoneProfile.embeddedTestLines > 0 && effectiveLoc < testWarn) {
            return null;
        }
        return `lines ${m.lines} >= fail threshold ${t.fileLinesFail}`;
    }
    return null;
}

function evaluateLinesOrLocWarn(
    m: FileMetric,
    t: Record<string, any>,
    density: any,
    zoneProfile: any,
): string | null {
    const effectiveLoc = getEvaluatedEffectiveLoc(density, zoneProfile);
    if (t.effectiveLocWarn && effectiveLoc >= t.effectiveLocWarn) {
        return `effective LOC ${effectiveLoc} >= warn threshold ${t.effectiveLocWarn} (raw lines: ${m.lines})`;
    }
    if (m.lines >= t.fileLinesWarn) {
        const effWarn = t.effectiveLocWarn || 400;
        const skipWarn = zoneProfile && zoneProfile.embeddedTestLines > 0 && effectiveLoc < effWarn;
        if (!skipWarn) {
            return `lines ${m.lines} >= warn threshold ${t.fileLinesWarn}`;
        }
    }
    return null;
}

function evaluateFunctionsWarn(m: FileMetric, t: Record<string, any>): string | null {
    if (m.functions >= t.fileFunctionsWarn) {
        return `functions ${m.functions} >= warn threshold ${t.fileFunctionsWarn}`;
    }
    return null;
}

function evaluateEntanglementWarn(
    hasReasons: boolean,
    zoneProfile: any,
    t: Record<string, any>,
): string | null {
    const elasticActive = t.enableElasticBudget || t.flagZonePartitioner;
    if (hasReasons && !zoneProfile.isDecoupled && elasticActive) {
        return `high intra-file entanglement (EI: ${zoneProfile.entanglementIndex})`;
    }
    return null;
}

function collectWarnReasons(
    m: FileMetric,
    t: Record<string, any>,
    density: any,
    zoneProfile: any,
): string[] {
    const reasons: string[] = [];
    const locReason = evaluateLinesOrLocWarn(m, t, density, zoneProfile);
    if (locReason) {
        reasons.push(locReason);
    }
    const fnReason = evaluateFunctionsWarn(m, t);
    if (fnReason) {
        reasons.push(fnReason);
    }
    const entanglementReason = evaluateEntanglementWarn(reasons.length > 0, zoneProfile, t);
    if (entanglementReason) {
        reasons.push(entanglementReason);
    }
    return reasons;
}


function evaluateThresholdSeverity(
    m: FileMetric,
    t: Record<string, any>,
    density: any,
    zoneProfile: any,
    isBenignConstant = false,
): { severity: Severity | null; reasons: string[] } {
    if (isBenignConstant) {
        if (m.lines <= 3000) {
            return { severity: null, reasons: [] };
        }
        return {
            severity: 'error',
            reasons: [
                `constant library lines ${m.lines} >= relaxed limit 3000 (${ARCH_BENIGN_CONSTANT_LIBRARY})`,
            ],
        };
    }

    const failReason = checkFailThreshold(m, t, density, zoneProfile);
    if (failReason) {
        return { severity: 'error', reasons: [failReason] };
    }

    const reasons = collectWarnReasons(m, t, density, zoneProfile);
    if (reasons.length > 0) {
        return { severity: 'warning', reasons };
    }

    return { severity: null, reasons: [] };
}

function buildSplitSuggestions(
    m: FileMetric,
    density: any,
    modules: string[],
    zoneProfile: any,
    t: Record<string, any>,
): string[] {
    const suggestions: string[] = [
        `Split into smaller modules by responsibility (current: ${m.lines} lines, ${density.effectiveCodeLines} effective LOC, ` +
            `${m.functions} functions, ${m.topLevelDeclarations} top-level declarations, ${m.exportedSymbols} exports, max nesting ${m.maxNestingDepth}).`,
    ];
    if (modules.length > 1) {
        suggestions.push(
            `Detected potential modules by name prefix: ${modules.join(', ')}. ` +
                `Consider extracting each into its own file under a dedicated directory.`,
        );
    }
    if (!zoneProfile.isDecoupled && (t.enableElasticBudget || t.flagZonePartitioner)) {
        suggestions.push(
            `Zone partitioner detected ${zoneProfile.segments.length} interleaved transitions between compute and gateway zones. ` +
                `Extract compute kernels into a dedicated internal submodule to reduce entanglement.`,
        );
    }
    return suggestions;
}

/**
 * Analyzer checking file size, line counts, function density, and modular breakdown boundaries.
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

    analyze(sf: ts.SourceFile | undefined, ctx: AnalyzerContext): Issue[] {
        this.reset();
        const content = sf && typeof sf.text === 'string' ? sf.text : ctx.content || '';
        const { TypeScriptAdapter } =
            require('../core/ast/typescript-adapter') as typeof import('../core/ast/typescript-adapter');
        const adapter = new TypeScriptAdapter();
        const ast = adapter.parse(content, ctx.filePath);
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
        const ext = path.extname(ctx.filePath);
        const elasticEvaluation = evaluateRoleElasticBudget(
            roleInference.role,
            density,
            ext,
            t.effectiveLocWarn,
        );
        const zoneProfile = partitionFileZones(ctx.content, ctx.filePath, density, ctx.root);
        const isBenignConstant = isBenignConstantLibrary(ctx.filePath, ctx.content || '', m);

        if (
            shouldExemptElastic(
                t,
                density,
                elasticEvaluation,
                zoneProfile,
                m.functions,
                isBenignConstant,
                m.lines,
            )
        ) {
            return [];
        }

        if (isStdlibExempt(ctx.config.archetype, roleInference.role, m.lines)) {
            return [];
        }

        const { severity, reasons } = evaluateThresholdSeverity(
            m,
            t,
            density,
            zoneProfile,
            isBenignConstant,
        );
        if (!severity) return [];

        const modules = [...this.modules];
        const suggestions = buildSplitSuggestions(m, density, modules, zoneProfile, t);

        const detailPayload: Record<string, unknown> = {
            ...m,
            reasons,
            inferredModules: modules,
        };
        if (isBenignConstant) {
            detailPayload.ARCH_BENIGN_CONSTANT_LIBRARY = true;
            detailPayload.architecturalCategory = ARCH_BENIGN_CONSTANT_LIBRARY;
        }
        if (t.enableElasticBudget === true || t.flagZonePartitioner === true) {
            detailPayload.densityMetrics = density;
            detailPayload.fileRole = roleInference.role;
            detailPayload.elasticEvaluation = elasticEvaluation;
            detailPayload.zoneProfile = zoneProfile;
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

const STDLIB_EXEMPT_ROLES = new Set([
    'algorithm_computation',
    'config_constant',
    'rules_registry',
    'shared_library',
]);

function isStdlibExempt(archetype: string | undefined, role: string, lines: number): boolean {
    const isStdlib = archetype === 'stdlib' || archetype === 'systems_runtime';
    return isStdlib && lines <= 3000 && STDLIB_EXEMPT_ROLES.has(role);
}
