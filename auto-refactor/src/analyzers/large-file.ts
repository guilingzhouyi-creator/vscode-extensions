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
import { evaluateTokenDensityBand } from '../core/intelligence/token-density-band';

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

/** Rule id: effective code volume budget (ELOC ceiling). */
const RULE_VOL_ELOC = 'VOL-ELOC-001';
/** Rule id: physical line count budget (raw LOC ceiling). */
const RULE_VOL_LOC = 'VOL-LOC-001';
/** Rule id: dynamic dilution envelope (physical LOC against the 1:N ratio target). */
const RULE_VOL_RATIO = 'VOL-RATIO-001';
/** Rule id: effective logic density floor. */
const RULE_VOL_DIL = 'VOL-DIL-001';
/** Rule id: architecture contract documentation floor for high-load modules. */
const RULE_VOL_DOC = 'VOL-DOC-001';

/** Effective-LOC ceiling applied when the caller supplies no explicit budget. */
const DEFAULT_VOLUME_MAX_ELOC = 900;
/** Raw-LOC ceiling applied when the caller supplies no explicit budget. */
const DEFAULT_VOLUME_MAX_LOC = 1400;
/** Default target ratio between physical lines and effective code lines. */
const DEFAULT_DENSITY_RATIO_TARGET = 3.0;
/** Relaxed effective-LOC ceiling for a benign constant catalog. */
const CONSTANT_CATALOG_MAX_ELOC = 1800;
/** Relaxed raw-LOC ceiling for a benign constant catalog. */
const CONSTANT_CATALOG_MAX_LOC = 2500;
/** Smallest physical line count at which the density floor is meaningful. */
const DYNAMIC_MIN_PHYSICAL_LOC = 150;
/** Effective-LOC level at which the documentation floor starts to apply. */
const HIGH_LOAD_ELOC_THRESHOLD = 600;
/** Minimum comment ratio for a high-load module. */
const MIN_CONTRACT_COMMENT_RATIO = 0.08;
/** Physical lines below which a file is too small for the density floor to mean anything. */
const MIN_REPRESENTATIVE_LOC = 250;

const VOLUME_SUGGESTION_DECOMPOSE =
    'Decompose the module into cohesive submodules following the Single Responsibility Principle.';
const VOLUME_SUGGESTION_SPLIT =
    'Split the file into smaller focused units to reduce cognitive load and formatting bloat.';
const VOLUME_SUGGESTION_COMPACT =
    'Remove redundant blank lines, drop trivial stubs, or move extended prose into a Markdown spec.';
const VOLUME_SUGGESTION_DOCUMENT =
    'Add type contracts, state-machine invariants, or a JSDoc header describing the module responsibilities.';

/** Strongly typed thresholds for the large-file analyzer. */
export interface LargeFileThresholds {
    effectiveLocFail?: number;
    effectiveLocWarn?: number;
    fileLinesFail?: number;
    fileLinesWarn?: number;
    /** Target physical-to-effective ratio for the dilution envelope (defaults to 3.0). */
    densityRatioTarget?: number;
    /** Absolute effective-LOC ceiling for VOL-ELOC-001 (defaults to 900). */
    maxEloc?: number;
    /** Absolute raw-LOC ceiling for VOL-LOC-001 (defaults to 1400). */
    maxLoc?: number;
    fileFunctionsWarn?: number;
    enableElasticBudget?: boolean;
    flagZonePartitioner?: boolean;
    [key: string]: unknown;
}

/** Comprehensive context packaging state required during large-file evaluation. */
export interface AnalysisEvaluationContext {
    metrics: FileMetric;
    thresholds: LargeFileThresholds;
    /** Resolved (never undefined) target ratio between physical lines and effective code lines. */
    densityRatioTarget: number;
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

/**
 * Collect every volume-family finding for one file.
 *
 * The aggregate `large-file` rule keeps the warn/fail band semantics it has always carried, and the
 * five `VOL-*` rules add the absolute budgets on top. They are additive rather than exclusive
 * because the aggregate reports elastic pressure (band crossing, function count, entanglement) while
 * the `VOL-*` family reports absolute ceilings; a file can cross a band without breaching a ceiling,
 * and it can breach a ceiling while its band stays put if the band was widened by options.
 *
 * @param evalCtx - Assembled evaluation context.
 * @returns Findings in reporting order (aggregate first, then the first breached volume budget).
 */
function collectVolumeFindings(evalCtx: AnalysisEvaluationContext): VolumeFinding[] {
    const findings: VolumeFinding[] = [];
    const aggregate = evaluateAggregateSeverity(evalCtx);
    if (aggregate !== null) findings.push(aggregate);
    for (const finding of collectBudgetFindings(evalCtx)) findings.push(finding);
    return findings;
}

/**
 * Collect every breached absolute budget.
 *
 * The two absolute ceilings are independent red lines, so both can fire together. The tau band is a
 * separate axis — it measures tokens per effective line rather than effective lines per physical
 * line — so it is evaluated before the shape rules rather than as one of them, and it survives the
 * elasticity exemption: a file whose vertical layout is fragmented is exactly the file elasticity
 * would otherwise excuse. Only the constant-catalog exemption, where the data itself dictates the
 * layout, silences the band. The shape rules remain mutually exclusive by precedence, so at most
 * one of them is ever added.
 *
 * @param evalCtx - Assembled evaluation context.
 * @returns Breached budget findings in precedence order.
 */
function collectBudgetFindings(evalCtx: AnalysisEvaluationContext): VolumeFinding[] {
    const findings: VolumeFinding[] = [];
    const eloc = getEvaluatedEffectiveLoc(evalCtx.density, evalCtx.zoneProfile);
    const totalLoc = evalCtx.metrics.lines;
    const { maxEloc, maxLoc } = resolveVolumeCaps(evalCtx);
    if (eloc > maxEloc) {
        findings.push({
            rule: RULE_VOL_ELOC,
            severity: SEVERITY_ERROR,
            message: `Effective code volume budget exceeded: ${eloc} ELOC > maximum limit ${maxEloc} ELOC (raw LOC: ${totalLoc}).`,
            suggestion: VOLUME_SUGGESTION_DECOMPOSE,
        });
    }
    if (totalLoc > maxLoc) {
        findings.push({
            rule: RULE_VOL_LOC,
            severity: SEVERITY_ERROR,
            message: `Physical line count budget exceeded: ${totalLoc} LOC > maximum limit ${maxLoc} LOC (effective: ${eloc} ELOC).`,
            suggestion: VOLUME_SUGGESTION_SPLIT,
        });
    }
    if (isVolumeEnvelopeExempt(evalCtx)) return findings;
    const tau = evaluateTokenDensityBand(evalCtx.metrics.tokensPerEloc, eloc);
    if (tau !== null) findings.push(tau);
    if (shouldExemptElastic(evalCtx)) return findings;
    const shape = evaluateShapeFindings(evalCtx, eloc, totalLoc);
    if (shape !== null) findings.push(shape);
    return findings;
}

/**
 * Report whether the file breaches a fail-level band.
 *
 * A file whose physical length is dominated by an embedded test zone is measured on its production
 * effective LOC instead, so moving tests inline cannot by itself fail the band.
 *
 * @param evalCtx - Assembled evaluation context.
 * @returns The breach description, or null when no fail band is crossed.
 */
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

/**
 * Report whether the effective-LOC or raw-LOC warning band was crossed.
 *
 * @param evalCtx - Assembled evaluation context.
 * @returns The band description, or null when no warning band was crossed.
 */
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

/**
 * Report whether the declared-function warning band was crossed.
 *
 * @param metrics - File metrics accumulated during the visit.
 * @param thresholds - Configured bands.
 * @returns The band description, or null when the count stays under the band.
 */
function evaluateFunctionWarnReason(
    metrics: FileMetric,
    thresholds: LargeFileThresholds,
): string | null {
    if (thresholds.fileFunctionsWarn && metrics.functions >= thresholds.fileFunctionsWarn) {
        return `functions ${metrics.functions} >= warn threshold ${thresholds.fileFunctionsWarn}`;
    }
    return null;
}

/**
 * Accumulate the reasons the file crossed a warning band.
 *
 * @param evalCtx - Assembled evaluation context.
 * @returns Human-readable band reasons, empty when no band was crossed.
 */
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

/**
 * Evaluate the legacy warn/fail bands of the analyzer.
 *
 * @param evalCtx - Assembled evaluation context.
 * @returns Severity to report (null when inside every band) plus the reasons behind it.
 */
function evaluateThresholdSeverity(evalCtx: AnalysisEvaluationContext): {
    severity: Severity | null;
    reasons: string[];
    bandReasons: string[];
} {
    const { metrics, isBenignConstant } = evalCtx;
    if (isBenignConstant) {
        if (metrics.lines <= MAX_BENIGN_CONSTANT_LINES) {
            return { severity: null, reasons: [], bandReasons: [] };
        }
        const reason = `constant library lines ${metrics.lines} >= relaxed limit ${MAX_BENIGN_CONSTANT_LINES} (${ARCH_BENIGN_CONSTANT_LIBRARY})`;
        return { severity: SEVERITY_ERROR, reasons: [reason], bandReasons: [reason] };
    }
    const failReason = checkFailThreshold(evalCtx);
    if (failReason) return { severity: SEVERITY_ERROR, reasons: [failReason], bandReasons: [failReason] };
    const warnReasons = collectWarnReasons(evalCtx);
    if (warnReasons.length > 0) {
        return { severity: SEVERITY_WARNING, reasons: warnReasons, bandReasons: warnReasons };
    }
    return { severity: null, reasons: [], bandReasons: [] };
}

/**
 * Evaluate the legacy aggregate `large-file` rule against the warn/fail bands.
 *
 * @param evalCtx - Assembled evaluation context.
 * @returns The aggregate finding, or null when the file is inside its bands.
 */
function evaluateAggregateSeverity(evalCtx: AnalysisEvaluationContext): VolumeFinding | null {
    const { severity, reasons, bandReasons } = evaluateThresholdSeverity(evalCtx);
    if (severity === null) return null;
    return {
        rule: 'large-file',
        severity,
        message:
            severity === SEVERITY_ERROR
                ? `File is too large and should be split (${reasons.join('; ')}).`
                : `File is large; consider splitting (${reasons.join('; ')}).`,
        suggestion: VOLUME_SUGGESTION_SPLIT,
        reasons: bandReasons,
    };
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
    const ratioTarget = thresholds.densityRatioTarget ?? DEFAULT_DENSITY_RATIO_TARGET;
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
        densityRatioTarget: ratioTarget,
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
 * Report whether the file may bypass the dynamic volume envelope checks.
 *
 * A constant catalog is one dense declaration table whose vertical layout is dictated by the data
 * it carries, so ratio and documentation floor rules do not apply to it.
 *
 * @param evalCtx - Assembled evaluation context.
 * @returns True for a benign constant library.
 */
function isVolumeEnvelopeExempt(evalCtx: AnalysisEvaluationContext): boolean {
    return evalCtx.isBenignConstant;
}

/**
 * Resolve the maximum effective-LOC and raw-LOC budgets for this file.
 *
 * These are the absolute architectural red lines, so they are independent of the analyzer's
 * warn/fail bands: a file can sit inside its warning band and still blow the absolute ceiling. A
 * constant catalog gets the relaxed cap it is allowed instead of the general budget.
 *
 * @param evalCtx - Assembled evaluation context.
 * @returns Effective-LOC cap and raw-LOC cap.
 */
function resolveVolumeCaps(evalCtx: AnalysisEvaluationContext): { maxEloc: number; maxLoc: number } {
    const configuredEloc = evalCtx.thresholds.maxEloc ?? DEFAULT_VOLUME_MAX_ELOC;
    const configuredLoc = evalCtx.thresholds.maxLoc ?? DEFAULT_VOLUME_MAX_LOC;
    if (evalCtx.isBenignConstant) {
        return {
            maxEloc: Math.max(configuredEloc, CONSTANT_CATALOG_MAX_ELOC),
            maxLoc: Math.max(configuredLoc, CONSTANT_CATALOG_MAX_LOC),
        };
    }
    return { maxEloc: configuredEloc, maxLoc: configuredLoc };
}

/** One volume finding: the rule that fired, its severity, and the explanation to report. */
interface VolumeFinding {
    readonly rule: string;
    readonly severity: Severity;
    readonly message: string;
    readonly suggestion: string;
    /** Per-signal band reasons for the aggregate rule; the detail payload reports these verbatim. */
    readonly reasons?: readonly string[];
}

/**
 * Evaluate the dilution-envelope and documentation-floor rules.
 *
 * @param evalCtx - Assembled evaluation context.
 * @param eloc - Effective lines of code.
 * @param totalLoc - Physical line count.
 * @returns The first violated shape rule, or null when the file sits inside its envelope.
 */
function evaluateShapeFindings(
    evalCtx: AnalysisEvaluationContext,
    eloc: number,
    totalLoc: number,
): VolumeFinding | null {
    const dynamicMaxLoc = Math.max(
        DYNAMIC_MIN_PHYSICAL_LOC,
        Math.ceil(eloc * evalCtx.densityRatioTarget),
    );
    if (totalLoc > dynamicMaxLoc) {
        const ratio = (totalLoc / Math.max(1, eloc)).toFixed(2);
        return {
            rule: RULE_VOL_RATIO,
            severity: SEVERITY_WARNING,
            message:
                `Dynamic dilution imbalance (ratio 1:${ratio} > 1:${evalCtx.densityRatioTarget}): ` +
                `dynamic physical envelope for ${eloc} ELOC is ${dynamicMaxLoc} LOC, actual is ${totalLoc} LOC.`,
            suggestion: VOLUME_SUGGESTION_COMPACT,
        };
    }
    if (totalLoc >= MIN_REPRESENTATIVE_LOC && eloc < Math.floor(totalLoc / evalCtx.densityRatioTarget)) {
        return {
            rule: RULE_VOL_DIL,
            severity: SEVERITY_WARNING,
            message:
                `Effective logic density too low: ${eloc} ELOC is below the dynamic floor of ` +
                `${Math.floor(totalLoc / evalCtx.densityRatioTarget)} ELOC across ${totalLoc} lines.`,
            suggestion: VOLUME_SUGGESTION_COMPACT,
        };
    }
    return evaluateDocumentationFloor(evalCtx, eloc, totalLoc);
}

/**
 * Evaluate the documentation-floor rule for a high-load module.
 *
 * @param evalCtx - Assembled evaluation context.
 * @param eloc - Effective lines of code.
 * @param totalLoc - Physical line count.
 * @returns The documentation finding, or null when the contract density is sufficient.
 */
function evaluateDocumentationFloor(
    evalCtx: AnalysisEvaluationContext,
    eloc: number,
    totalLoc: number,
): VolumeFinding | null {
    if (eloc < HIGH_LOAD_ELOC_THRESHOLD || totalLoc === 0) return null;
    const commentRatio = evalCtx.density.commentRatio;
    if (commentRatio >= MIN_CONTRACT_COMMENT_RATIO) return null;
    return {
        rule: RULE_VOL_DOC,
        severity: SEVERITY_WARNING,
        message:
            `High-load logic lacks architecture contracts: ${eloc} ELOC carries a comment ratio of ` +
            `${(commentRatio * 100).toFixed(1)}%, below the ${(MIN_CONTRACT_COMMENT_RATIO * 100).toFixed(0)}% floor.`,
        suggestion: VOLUME_SUGGESTION_DOCUMENT,
    };
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

        const fileExt = path.extname(ctx.filePath);
        if (fileExt === EXT_MARKDOWN || fileExt === EXT_MARKDOWN_ALT) return [];
        if (isStdlibExempt(ctx.config?.archetype, evalCtx.roleInference.role, metrics.lines)) {
            return [];
        }

        const findings = collectVolumeFindings(evalCtx);
        if (findings.length === 0) return [];

        const moduleNames = [...this.modules];
        return findings.map((finding: VolumeFinding): Issue => ({
            id: `large-file:${finding.rule}:${ctx.filePath}:1`,
            analyzer: 'large-file',
            rule: finding.rule,
            severity: finding.severity,
            message: finding.message,
            location: {
                file: ctx.filePath,
                start: { line: 1, column: 1 },
                end: { line: 1, column: 1 },
            },
            detail: buildDetailPayload(evalCtx, [...(finding.reasons ?? [finding.message])], moduleNames),
            suggestion: `${finding.suggestion} ${buildSplitSuggestions(evalCtx, moduleNames).join(' ')}`,
        }));
    }
}
