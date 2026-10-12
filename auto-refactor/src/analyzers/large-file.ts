/**
 * Module: Static Analysis — Large File & Decomposition Analyzer
 * File Path: src/analyzers/large-file.ts
 * Architecture Role: Analyzer adapter serving streaming and standalone analysis contracts.
 * Dependencies & Triggers: Core types, NodeKind/NormalizedNode, runStreaming, TypeScriptAdapter.
 * Responsibilities: Accumulate metrics and module prefixes; emit large-file split findings.
 * Exit Semantics & Design Rationale: Returns [] within thresholds; severity is error at
 *   lines >= fileLinesFail, warning at lines >= fileLinesWarn or functions >= fileFunctionsWarn.
 */

import * as path from 'path';
import type * as ts from 'typescript';
import {
    type Analyzer,
    type AnalyzerContext,
    type Issue,
    type FileMetric,
    type Severity,
} from '../core/types';
import { NodeKind, type NormalizedNode } from '../core/ast/multilang';
import { runStreaming } from '../core/ast/traverse';
import { TypeScriptAdapter } from '../core/ast/typescript-adapter';
import {
    analyzeCodeDensity,
    type CodeDensityMetrics,
} from '../core/intelligence/code-density-analyzer';
import {
    inferFineGrainedFileRole,
    type FileRoleInferenceResult,
} from '../core/intelligence/file-role-inference';
import {
    evaluateRoleElasticBudget,
    type ElasticBudgetEvaluation,
} from '../core/intelligence/elastic-budget-matrix';
import {
    partitionFileZones,
    type IntraFileZoneProfile,
} from '../core/intelligence/zone-partitioner';
import { isConstantDefinitionFile } from '../core/intelligence/constant-identity';

/** Architectural token representing benign constant library classification. */
export const ARCH_BENIGN_CONSTANT_LIBRARY = 'ARCH_BENIGN_CONSTANT_LIBRARY';

const ANALYZER_NAME = 'large-file';
const DEFAULT_MODULE_PREFIX = 'misc';
const SEVERITY_ERROR: Severity = 'error';
const SEVERITY_WARNING: Severity = 'warning';
const EXT_MARKDOWN = '.md',
    EXT_MARKDOWN_ALT = '.markdown';
const ARCHETYPE_STDLIB = 'stdlib',
    ARCHETYPE_SYSTEMS_RUNTIME = 'systems_runtime';

const MAX_BENIGN_CONSTANT_LINES = 3000,
    MAX_BENIGN_CONSTANT_FUNCTIONS = 2,
    MAX_BENIGN_CONSTANT_NESTING = 3;
const MAX_BENIGN_BRANCHES = 2,
    DENSE_COMPUTATION_LOC_THRESHOLD = 1500,
    DEFAULT_FILE_LINES_WARN = 400;
const DECOUPLED_FUNCTION_MULTIPLIER = 4,
    ROLE_SAMPLE_CHAR_LIMIT = 500,
    STDLIB_MAX_LINE_LIMIT = 3000;

/** Strongly typed thresholds for the large-file analyzer. */
export interface LargeFileThresholds {
    effectiveLocFail?: number;
    effectiveLocWarn?: number;
    fileLinesFail?: number;
    fileLinesWarn?: number;
    fileFunctionsWarn?: number;
    enableElasticBudget?: boolean;
    flagZonePartitioner?: boolean;
    [key: string]: unknown;
}

/** Comprehensive context packaging state required during large-file evaluation. */
export interface AnalysisEvaluationContext {
    metrics: FileMetric;
    thresholds: LargeFileThresholds;
    density: CodeDensityMetrics;
    zoneProfile: IntraFileZoneProfile;
    elasticEvaluation: ElasticBudgetEvaluation;
    roleInference: FileRoleInferenceResult;
    isBenignConstant: boolean;
}

function extractFirstWord(identifierName: string): string {
    const matchedTokens = identifierName.match(/^[a-z]+|^[A-Z]+/) || [DEFAULT_MODULE_PREFIX];
    return matchedTokens[0].toLowerCase();
}

function isBenignConstantLibrary(filePath: string, content: string, metrics: FileMetric): boolean {
    if (!isConstantDefinitionFile(filePath, content)) return false;
    if (
        metrics.functions > MAX_BENIGN_CONSTANT_FUNCTIONS ||
        metrics.maxNestingDepth > MAX_BENIGN_CONSTANT_NESTING
    ) {
        return false;
    }
    const strippedContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    const controlFlowMatches =
        strippedContent.match(/\b(?:if\s*\(|for\s*\(|while\s*\(|switch\s*\(|catch\s*\()/g) || [];
    return controlFlowMatches.length <= MAX_BENIGN_BRANCHES;
}

function shouldExemptElastic(evalCtx: AnalysisEvaluationContext): boolean {
    const { thresholds, density, zoneProfile, elasticEvaluation, metrics, isBenignConstant } =
        evalCtx;
    if (isBenignConstant && metrics.lines <= MAX_BENIGN_CONSTANT_LINES) return true;
    if (!thresholds.enableElasticBudget && !density.isLowDensityDocumented) return false;
    const functionsWarnLimit = thresholds.fileFunctionsWarn || DEFAULT_FILE_LINES_WARN;
    if (
        density.effectiveCodeLines >= DENSE_COMPUTATION_LOC_THRESHOLD &&
        zoneProfile.isDecoupled &&
        metrics.functions < functionsWarnLimit * DECOUPLED_FUNCTION_MULTIPLIER
    ) {
        return true;
    }
    return !elasticEvaluation.shouldFlagLargeFile && metrics.functions < functionsWarnLimit;
}

function getEvaluatedEffectiveLoc(
    density: CodeDensityMetrics,
    zoneProfile?: IntraFileZoneProfile,
): number {
    if (zoneProfile && typeof zoneProfile.productionEffectiveLoc === 'number') {
        return zoneProfile.productionEffectiveLoc;
    }
    return density ? density.effectiveCodeLines : 0;
}

function checkFailThreshold(evalCtx: AnalysisEvaluationContext): string | null {
    const { metrics, thresholds, density, zoneProfile } = evalCtx;
    const effectiveLoc = getEvaluatedEffectiveLoc(density, zoneProfile);
    if (thresholds.effectiveLocFail && effectiveLoc >= thresholds.effectiveLocFail) {
        return `effective LOC ${effectiveLoc} >= fail threshold ${thresholds.effectiveLocFail} (lines: ${metrics.lines})`;
    }
    if (thresholds.fileLinesFail && metrics.lines >= thresholds.fileLinesFail) {
        const testWarn = thresholds.fileLinesWarn || DEFAULT_FILE_LINES_WARN;
        if (zoneProfile && zoneProfile.embeddedTestLines > 0 && effectiveLoc < testWarn) {
            return null;
        }
        return `lines ${metrics.lines} >= fail threshold ${thresholds.fileLinesFail}`;
    }
    return null;
}

function evaluateLocWarnReason(evalCtx: AnalysisEvaluationContext): string | null {
    const { metrics, thresholds, density, zoneProfile } = evalCtx;
    const effectiveLoc = getEvaluatedEffectiveLoc(density, zoneProfile);
    if (thresholds.effectiveLocWarn && effectiveLoc >= thresholds.effectiveLocWarn) {
        return `effective LOC ${effectiveLoc} >= warn threshold ${thresholds.effectiveLocWarn} (raw lines: ${metrics.lines})`;
    }
    if (thresholds.fileLinesWarn && metrics.lines >= thresholds.fileLinesWarn) {
        const effWarn = thresholds.effectiveLocWarn || DEFAULT_FILE_LINES_WARN;
        const skip = zoneProfile && zoneProfile.embeddedTestLines > 0 && effectiveLoc < effWarn;
        if (!skip) return `lines ${metrics.lines} >= warn threshold ${thresholds.fileLinesWarn}`;
    }
    return null;
}

function evaluateFunctionWarnReason(
    metrics: FileMetric,
    thresholds: LargeFileThresholds,
): string | null {
    if (thresholds.fileFunctionsWarn && metrics.functions >= thresholds.fileFunctionsWarn) {
        return `functions ${metrics.functions} >= warn threshold ${thresholds.fileFunctionsWarn}`;
    }
    return null;
}

function collectWarnReasons(evalCtx: AnalysisEvaluationContext): string[] {
    const reasons: string[] = [];
    const locReason = evaluateLocWarnReason(evalCtx);
    if (locReason) reasons.push(locReason);
    const fnReason = evaluateFunctionWarnReason(evalCtx.metrics, evalCtx.thresholds);
    if (fnReason) reasons.push(fnReason);
    const { zoneProfile, thresholds } = evalCtx;
    const elasticActive = thresholds.enableElasticBudget || thresholds.flagZonePartitioner;
    if (reasons.length > 0 && !zoneProfile.isDecoupled && elasticActive) {
        reasons.push(`high intra-file entanglement (EI: ${zoneProfile.entanglementIndex})`);
    }
    return reasons;
}

function evaluateThresholdSeverity(evalCtx: AnalysisEvaluationContext): {
    severity: Severity | null;
    reasons: string[];
} {
    const { metrics, isBenignConstant } = evalCtx;
    if (isBenignConstant) {
        if (metrics.lines <= MAX_BENIGN_CONSTANT_LINES) return { severity: null, reasons: [] };
        return {
            severity: SEVERITY_ERROR,
            reasons: [
                `constant library lines ${metrics.lines} >= relaxed limit ${MAX_BENIGN_CONSTANT_LINES} (${ARCH_BENIGN_CONSTANT_LIBRARY})`,
            ],
        };
    }
    const failReason = checkFailThreshold(evalCtx);
    if (failReason) return { severity: SEVERITY_ERROR, reasons: [failReason] };
    const warnReasons = collectWarnReasons(evalCtx);
    if (warnReasons.length > 0) return { severity: SEVERITY_WARNING, reasons: warnReasons };
    return { severity: null, reasons: [] };
}

function buildSplitSuggestions(
    evalCtx: AnalysisEvaluationContext,
    moduleNames: string[],
): string[] {
    const { metrics, density, zoneProfile, thresholds } = evalCtx;
    const suggestions: string[] = [
        `Split into smaller modules by responsibility (current: ${metrics.lines} lines, ${density.effectiveCodeLines} effective LOC, ` +
            `${metrics.functions} functions, ${metrics.topLevelDeclarations} top-level declarations, ${metrics.exportedSymbols} exports, max nesting ${metrics.maxNestingDepth}).`,
    ];
    if (moduleNames.length > 1) {
        suggestions.push(
            `Detected potential modules by name prefix: ${moduleNames.join(', ')}. ` +
                `Consider extracting each into its own file under a dedicated directory.`,
        );
    }
    if (
        !zoneProfile.isDecoupled &&
        (thresholds.enableElasticBudget || thresholds.flagZonePartitioner)
    ) {
        suggestions.push(
            `Zone partitioner detected ${zoneProfile.segments.length} interleaved transitions between compute and gateway zones. ` +
                `Extract compute kernels into a dedicated internal submodule to reduce entanglement.`,
        );
    }
    return suggestions;
}

const STDLIB_EXEMPT_ROLES = new Set([
    'algorithm_computation',
    'config_constant',
    'rules_registry',
    'shared_library',
]);

function isStdlibExempt(archetype: string | undefined, role: string, lines: number): boolean {
    const isStdlib = archetype === ARCHETYPE_STDLIB || archetype === ARCHETYPE_SYSTEMS_RUNTIME;
    return isStdlib && lines <= STDLIB_MAX_LINE_LIMIT && STDLIB_EXEMPT_ROLES.has(role);
}

function resolveLineCounts(ctx: AnalyzerContext): { lines: number; nonBlankLines: number } {
    if (ctx.lineStats) return ctx.lineStats;
    const rawLines = (ctx.content || '').split(/\r\n|\n/);
    return {
        lines: rawLines.length,
        nonBlankLines: rawLines.filter((line) => line.trim().length > 0).length,
    };
}

function buildEvaluationContext(
    ctx: AnalyzerContext,
    metrics: FileMetric,
): AnalysisEvaluationContext {
    const thresholds = (ctx.options || {}) as LargeFileThresholds;
    const content = ctx.content || '';
    const density = analyzeCodeDensity(content, ctx.filePath);
    const roleInference = inferFineGrainedFileRole(
        ctx.filePath,
        content.slice(0, ROLE_SAMPLE_CHAR_LIMIT),
    );
    const elasticEvaluation = evaluateRoleElasticBudget(
        roleInference.role,
        density,
        path.extname(ctx.filePath),
        thresholds.effectiveLocWarn,
    );
    const zoneProfile = partitionFileZones(content, ctx.filePath, density, ctx.root);
    const isBenignConstant = isBenignConstantLibrary(ctx.filePath, content, metrics);
    return {
        metrics,
        thresholds,
        density,
        zoneProfile,
        elasticEvaluation,
        roleInference,
        isBenignConstant,
    };
}

function buildDetailPayload(
    evalCtx: AnalysisEvaluationContext,
    reasons: string[],
    moduleNames: string[],
): Record<string, unknown> {
    const {
        metrics,
        isBenignConstant,
        thresholds,
        density,
        roleInference,
        elasticEvaluation,
        zoneProfile,
    } = evalCtx;
    const detailPayload: Record<string, unknown> = {
        ...metrics,
        reasons,
        inferredModules: moduleNames,
    };
    if (isBenignConstant) {
        detailPayload.ARCH_BENIGN_CONSTANT_LIBRARY = true;
        detailPayload.architecturalCategory = ARCH_BENIGN_CONSTANT_LIBRARY;
    }
    if (thresholds.enableElasticBudget === true || thresholds.flagZonePartitioner === true) {
        detailPayload.densityMetrics = density;
        detailPayload.fileRole = roleInference.role;
        detailPayload.elasticEvaluation = elasticEvaluation;
        detailPayload.zoneProfile = zoneProfile;
    }
    return detailPayload;
}

/**
 * Analyzer checking file size, line counts, function density, and modular breakdown boundaries.
 */
export class LargeFileAnalyzer implements Analyzer {
    readonly name = ANALYZER_NAME;

    private lines = 0;
    private nonBlankLines = 0;
    private functions = 0;
    private maxNesting = 0;
    private topLevelDeclarations = 0;
    private exportedSymbols = 0;
    private modules = new Set<string>();

    analyze(sourceFile: ts.SourceFile | undefined, ctx: AnalyzerContext): Issue[] {
        this.reset();
        const content =
            sourceFile && typeof sourceFile.text === 'string' ? sourceFile.text : ctx.content || '';
        const adapter = new TypeScriptAdapter();
        const ast = adapter.parse(content, ctx.filePath);
        return runStreaming(adapter, ast.root, [
            { analyzer: this, ctx: { ...ctx, sourceFile, root: ast.root, adapter } },
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
            if (node.functionLike && node.name) {
                this.modules.add(extractFirstWord(node.name));
            }
        }
        if (node.functionLike) this.functions++;
        if (depth > this.maxNesting) this.maxNesting = depth;
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        const { lines, nonBlankLines } = resolveLineCounts(ctx);
        this.lines = lines;
        this.nonBlankLines = nonBlankLines;

        const metrics: FileMetric = {
            file: ctx.filePath,
            lines: this.lines,
            nonBlankLines: this.nonBlankLines,
            functions: this.functions,
            maxNestingDepth: this.maxNesting,
            topLevelDeclarations: this.topLevelDeclarations,
            exportedSymbols: this.exportedSymbols,
        };

        const evalCtx = buildEvaluationContext(ctx, metrics);
        if (shouldExemptElastic(evalCtx)) return [];

        const fileExt = path.extname(ctx.filePath);
        if (fileExt === EXT_MARKDOWN || fileExt === EXT_MARKDOWN_ALT) return [];
        if (isStdlibExempt(ctx.config?.archetype, evalCtx.roleInference.role, metrics.lines)) {
            return [];
        }

        const { severity, reasons } = evaluateThresholdSeverity(evalCtx);
        if (!severity) return [];

        const moduleNames = [...this.modules];
        return [
            {
                id: `large-file:large-file:${ctx.filePath}:1`,
                analyzer: 'large-file',
                rule: 'large-file',
                severity,
                message:
                    severity === SEVERITY_ERROR
                        ? `File is too large and should be split (${reasons.join('; ')}).`
                        : `File is large; consider splitting (${reasons.join('; ')}).`,
                location: {
                    file: ctx.filePath,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 1 },
                },
                detail: buildDetailPayload(evalCtx, reasons, moduleNames),
                suggestion: buildSplitSuggestions(evalCtx, moduleNames).join(' '),
            },
        ];
    }
}
