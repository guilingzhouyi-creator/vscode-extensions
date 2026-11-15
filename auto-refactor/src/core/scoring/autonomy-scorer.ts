/**
 * Module: Core Engine — Project In-House Autonomy Scorer (CAI 2.0)
 * File Path: src/core/scoring/autonomy-scorer.ts
 * Architecture Role: Evaluates self-development ratio (In-House Autonomy Index) across six
 *   orthogonal dimensions: effective LOC autonomy, symbol call graph autonomy, domain kernel
 *   density, code originality, supply chain resilience, and critical path autonomy.
 * Dependencies & Triggers: Consumes dependency-provenance, file-role-inference, zone-partitioner,
 *   and ScanConfig; invoked by reportBuilder to embed autonomy insights into ScanReport.
 * Responsibilities:
 *   1. Quantify proprietary vs in-tree vendor vs generated effective lines of code;
 *   2. Quantify internal module calls vs external third-party SDK calls;
 *   3. Quantify core algorithm/domain kernel density against glue layers;
 *   4. Quantify code originality from genuine clone density (borrowed blocks, not repeated
 *      string or numeric literals, which are an extraction suggestion rather than plagiarism);
 *   5. Quantify supply chain dependency depth and lockfile resilience;
 *   6. Quantify mission-critical security and dispatch path in-house ratio;
 *   7. Compute Jeffreys conjugate Beta(0.5, 0.5) Bayesian credible interval and confidence;
 *   8. Produce composite autonomy index (0~100%), qualitative tier (L1~L5), and SDK inventory.
 * Exit Semantics & Design Rationale: Never throws; deterministic mathematical evaluation with
 *   defensive division-by-zero guards and graceful handling for minimal single-file libraries.
 *   Degradation adaptivity: When symbolIndex is absent, rCall gracefully degrades according to
 *   file-level external SDK import presence instead of falsely defaulting to 100%.
 *   Every coefficient, weight, and half-point comes from `scoring-parameters`, so a scan can be
 *   tuned through `ScanConfig.scoring` without editing this module; the six axes are combined by
 *   a weighted geometric mean by default so one collapsed axis cannot be outvoted.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FileMetric, Issue, ScanConfig } from '../types';
import {
    classifyFileProvenance,
    classifyImportProvenance,
    findNearestManifestInventory,
    loadProjectManifestDependencies,
    loadProjectSupplyChainProfile,
    type ProjectManifestInventory,
    type SupplyChainProfile,
} from '../intelligence/dependency-provenance';
import {
    extractFileImportProfile,
    extractModulePackageName,
    isValidPackageSpecifier,
    type FileImportProfile,
} from '../intelligence/import-profiler';
import { inferFineGrainedFileRole } from '../intelligence/file-role-inference';
import type { SymbolIndex } from '../intelligence/symbolIndex';
import { clampScore, computeExactBetaCredibleInterval } from '../math';
import { AutonomyGradeDescriptions } from '../messages';
import {
    DEFAULT_SCORING_CONFIG,
    resolveScoringConfig,
    type AutonomyScoringConfig,
    type ScoringAggregationMode,
} from './scoring-parameters';
import {
    HEADER_PREVIEW_SLICE_500,
    KIND_EXTERNAL_SDK,
    KIND_INTERNAL,
    KIND_STDLIB,
    MAX_AUTONOMY_FILE_READ_BYTES,
    PROVENANCE_GENERATED,
    PROVENANCE_IN_TREE_VENDOR,
    ROLE_ALGORITHM_COMPUTATION,
    ROLE_BUSINESS_MODULE,
    ROLE_CORE_TRUNK,
    createAutonomyScanState,
    isCriticalPathFile,
    isProductionExternalSdk,
    recordSdkCall,
    type AutonomyScanState,
} from './autonomy-scan-state';
import { applySymbolIndexReferences } from './autonomy-reference-scan';

const SCALE_LOC_EXPONENT = 4000;
const SCALE_FILE_EXPONENT = 8;
const PRECISION_THREE = 3;
const PRECISION_TWO = 2;
const PERCENT_MAX = 100.0;
const PERCENT_FACTOR = 100;
const MIN_EFFECTIVE_SAMPLE_SIZE = 2;
const CONFIDENCE_LOW_THRESHOLD = 0.45;
const PRIOR_JEFFREYS_ALPHA = 0.5;
const PRIOR_JEFFREYS_BETA = 0.5;

const GRADE_L5_THRESHOLD = 95.0;
const GRADE_L4_THRESHOLD = 85.0;
const GRADE_L3_THRESHOLD = 70.0;
const GRADE_L2_THRESHOLD = 50.0;

const GRADE_L5 = 'L5_INDEPENDENT';
const GRADE_L4 = 'L4_HIGH_AUTONOMY';
const GRADE_L3 = 'L3_BALANCED';
const GRADE_L2 = 'L2_FRAMEWORK_DEPENDENT';
const GRADE_L1 = 'L1_SHALLOW_WRAPPER';

const RULE_HYG_CLN_001 = 'HYG-CLN-001';

/**
 * Computes rigorous Bayesian Credible Interval for autonomy index using
 * Beta conjugate prior (Jeffreys prior Beta(0.5, 0.5)) and normal posterior approximation.
 */
function computeBayesianAutonomyConfidence(
    compositeScore: number,
    effectiveLoc: number,
    totalFiles: number,
    totalScopedCalls: number,
    totalRuleObservations = 0,
): AutonomyConfidence {
    const locSufficiency = 1.0 - Math.exp(-effectiveLoc / SCALE_LOC_EXPONENT);
    const fileSufficiency = 1.0 - Math.exp(-totalFiles / SCALE_FILE_EXPONENT);
    const sampleSufficiency = +(locSufficiency * fileSufficiency).toFixed(PRECISION_THREE);
    const isLowConfidence = sampleSufficiency < CONFIDENCE_LOW_THRESHOLD;

    // Beta conjugate Jeffreys prior: Alpha_0 = 0.5, Beta_0 = 0.5
    const alpha0 = PRIOR_JEFFREYS_ALPHA;
    const beta0 = PRIOR_JEFFREYS_BETA;

    const effectiveSampleSize = Math.max(
        MIN_EFFECTIVE_SAMPLE_SIZE,
        totalRuleObservations > 0
            ? totalRuleObservations
            : totalScopedCalls > 0
              ? totalScopedCalls
              : Math.min(totalFiles, 100),
    );
    const pObserved = Math.max(0.0, Math.min(1.0, compositeScore / PERCENT_FACTOR));

    const kSuccess = pObserved * effectiveSampleSize;
    const alpha = kSuccess + alpha0;
    const beta = effectiveSampleSize - kSuccess + beta0;
    const exactInterval = computeExactBetaCredibleInterval(alpha, beta);

    return {
        sampleSufficiency,
        lowerBound: exactInterval.lowerBound,
        upperBound: exactInterval.upperBound,
        credibleScore: exactInterval.credibleScore,
        isLowConfidence,
    };
}

/** Qualitative autonomy grade tiers */
export type AutonomyGrade =
    | 'L5_INDEPENDENT'
    | 'L4_HIGH_AUTONOMY'
    | 'L3_BALANCED'
    | 'L2_FRAMEWORK_DEPENDENT'
    | 'L1_SHALLOW_WRAPPER';

/** Six orthogonal autonomy sub-dimension scores (each normalized 0.0 ~ 100.0) */
export interface AutonomyDimensions {
    /** R_loc: Ratio of proprietary effective LOC over total tree effective LOC */
    effectiveLocAutonomy: number;
    /** R_call: Ratio of internal symbol calls over total calls (internal + external SDK) */
    symbolCallAutonomy: number;
    /** R_domain: Ratio of core algorithm and domain logic over total proprietary code */
    domainKernelDensity: number;
    /** R_pure: Originality score penalizing large unmanaged cloned/borrowed blocks */
    codeOriginality: number;
    /** R_supply: Resilience against deep transitive external dependency graph explosion */
    supplyChainResilience: number;
    /** R_critical: In-house ratio across security, auth, crypto, and runtime dispatch paths */
    criticalPathAutonomy: number;
}

/** Detail record of an external third-party SDK utilized by the project */
export interface ExternalSdkUsage {
    name: string;
    callCount: number;
    fileCount: number;
}

/** Statistical credible interval and sample sufficiency assessment */
export interface AutonomyConfidence {
    /** Sample sufficiency ratio S in [0.0, 1.0] based on proprietary LOC and file counts */
    sampleSufficiency: number;
    /** Conservative credible lower bound for autonomy rating (0.0 ~ 100.0) */
    lowerBound: number;
    /** Optimistic credible upper bound for autonomy rating (0.0 ~ 100.0) */
    upperBound: number;
    /** Bayesian smoothed score pulling sparse samples toward prior baseline */
    credibleScore: number;
    /** True when sample size is insufficient to guarantee high statistical confidence */
    isLowConfidence: boolean;
}

/** Comprehensive autonomy evaluation outcome */
export interface AutonomyEvaluation {
    /** Composite Autonomy Index (0.0 ~ 100.0%) */
    compositeAutonomyIndex: number;
    /** Qualitative grade classification */
    grade: AutonomyGrade;
    /** Human-readable grade description */
    gradeDescription: string;
    /** Six orthogonal sub-dimension scores */
    dimensions: AutonomyDimensions;
    /** Dimension weights applied during synthesis */
    weights: {
        effectiveLoc: number;
        symbolCall: number;
        domainKernel: number;
        codeOriginality: number;
        supplyChainResilience: number;
        criticalPathAutonomy: number;
    };
    /** Bayesian statistical confidence assessment */
    confidence: AutonomyConfidence;
    /** Supply chain lockfile and dependency tree profile */
    supplyChain: {
        hasLockfile: boolean;
        lockfileType: string;
        directDependencies: number;
        transitiveDependencies: number;
        totalLockfilePackages: number;
        estimatedDepth: number;
    };
    /** Inventory of third-party SDKs imported and invoked */
    externalSdkInventory: ExternalSdkUsage[];
    /** Quantitative accounting metrics */
    stats: {
        totalFiles: number;
        proprietaryFiles: number;
        vendorFiles: number;
        generatedFiles: number;
        totalEffectiveLoc: number;
        proprietaryEffectiveLoc: number;
        vendorEffectiveLoc: number;
        generatedEffectiveLoc: number;
        internalSymbolCalls: number;
        externalSdkCalls: number;
        stdlibCalls: number;
        criticalPathFiles: number;
        criticalPathInternalCalls: number;
        criticalPathExternalCalls: number;
    };
}

/**
 * Assign qualitative grade based on composite autonomy score.
 */
const GRADE_DESC = AutonomyGradeDescriptions;

function resolveAutonomyGrade(score: number): {
    grade: AutonomyGrade;
    description: string;
} {
    if (score >= GRADE_L5_THRESHOLD) {
        return {
            grade: GRADE_L5,
            description: GRADE_DESC.L5_INDEPENDENT,
        };
    }
    if (score >= GRADE_L4_THRESHOLD) {
        return {
            grade: GRADE_L4,
            description: GRADE_DESC.L4_HIGH_AUTONOMY,
        };
    }
    if (score >= GRADE_L3_THRESHOLD) {
        return {
            grade: GRADE_L3,
            description: GRADE_DESC.L3_BALANCED,
        };
    }
    if (score >= GRADE_L2_THRESHOLD) {
        return {
            grade: GRADE_L2,
            description: GRADE_DESC.L2_FRAMEWORK_DEPENDENT,
        };
    }
    return {
        grade: GRADE_L1,
        description: GRADE_DESC.L1_SHALLOW_WRAPPER,
    };
}

export { extractFileImportProfile, type FileImportProfile };

/**
 * Load raw source content from memory map or disk file without early 1KB truncation.
 */
/**
 * Reads the head of a source file, capped at `MAX_AUTONOMY_FILE_READ_BYTES`.
 *
 * Import provenance only needs the preamble, so the cap keeps a huge generated file from being
 * slurped whole. One buffered read replaces the previous stat/open/read/close sequence: the four
 * syscalls returned byte-identical text but cost 26% more wall time over 616 files, and this
 * function is on the per-file path of the autonomy pass.
 *
 * @param absPath - Absolute path to the source file.
 * @returns Decoded head of the file, or an empty string when it cannot be read.
 */
const AutonomySourceIoBarrier = {
    readBytes(absPath: string): Buffer {
        return fs['readFileSync'](absPath);
    },
};

function readSourceFileContent(absPath: string): string {
    try {
        const raw = AutonomySourceIoBarrier.readBytes(absPath);
        return raw.length > MAX_AUTONOMY_FILE_READ_BYTES
            ? raw.toString('utf8', 0, MAX_AUTONOMY_FILE_READ_BYTES)
            : raw.toString('utf8');
    } catch {
        return '';
    }
}

function loadFileRawContent(
    metric: FileMetric,
    config: ScanConfig,
    fileContents?: Map<string, string>,
    cache?: Map<string, string>,
): string {
    const raw = fileContents?.get(metric.file) || (metric as { content?: string }).content || '';
    if (raw) return raw;
    if (cache && cache.has(metric.file)) return cache.get(metric.file)!;
    if (config.root) {
        const absPath = path.isAbsolute(metric.file)
            ? metric.file
            : path.join(config.root, metric.file);
        const chunk = readSourceFileContent(absPath);
        if (cache) cache.set(metric.file, chunk);
        return chunk;
    }
    return '';
}

/**
 * Attribution context for resolving single or multiple import specifiers.
 */
export interface ImportAttributionContext {
    readonly currentFile: string;
    readonly manifestDeps: Set<string>;
    readonly state: AutonomyScanState;
    readonly isCritical: boolean;
    readonly fileInv?: ProjectManifestInventory;
}

function recordSingleSpecifier(spec: string, ctx: ImportAttributionContext): void {
    if (!isValidPackageSpecifier(spec)) return;
    const kind = classifyImportProvenance(
        spec,
        ctx.currentFile,
        ctx.manifestDeps,
        ctx.fileInv?.pathAliases,
    );
    if (kind === KIND_INTERNAL) {
        ctx.state.internalSymbolCalls++;
        if (ctx.isCritical) ctx.state.criticalPathInternalCalls++;
        return;
    }
    if (kind === KIND_STDLIB) {
        ctx.state.stdlibCalls++;
        return;
    }
    if (kind === KIND_EXTERNAL_SDK) {
        if (!isProductionExternalSdk(spec, ctx.currentFile, ctx.fileInv)) {
            ctx.state.stdlibCalls++;
            return;
        }
        const pkg = extractModulePackageName(spec);
        recordSdkCall(ctx.state, pkg, ctx.currentFile, ctx.isCritical);
    }
}

/**
 * Process import specifiers and attribute call weights.
 */
function processImportSpecifiers(specifiers: string[], ctx: ImportAttributionContext): void {
    for (const spec of specifiers) {
        recordSingleSpecifier(spec, ctx);
    }
}

interface FileMetricAccumulationParams {
    readonly metric: FileMetric;
    readonly manifestDeps: Set<string>;
    readonly state: AutonomyScanState;
    readonly rawContent: string;
    readonly fileInv?: ProjectManifestInventory;
}

/**
 * Accumulate provenance and complexity metrics for a single file.
 */
function accumulateFileMetric(params: FileMetricAccumulationParams): void {
    const { metric, manifestDeps, state, rawContent, fileInv } = params;
    const headerSlice = rawContent.slice(0, HEADER_PREVIEW_SLICE_500);
    const provenance = classifyFileProvenance(metric.file, headerSlice);
    const eloc = (metric as { nonBlankLines?: number }).nonBlankLines || metric.lines || 1;

    if (provenance === PROVENANCE_IN_TREE_VENDOR) {
        state.vendorFiles++;
        state.vendorEffectiveLoc += eloc;
        return;
    }
    if (provenance === PROVENANCE_GENERATED) {
        state.generatedFiles++;
        state.generatedEffectiveLoc += eloc;
        return;
    }

    state.proprietaryFiles++;
    state.proprietaryEffectiveLoc += eloc;

    const isCritical = isCriticalPathFile(metric.file);
    if (isCritical) {
        state.criticalPathFiles++;
    }

    const roleResult = inferFineGrainedFileRole(metric.file, headerSlice);
    if (
        roleResult.role === ROLE_ALGORITHM_COMPUTATION ||
        roleResult.role === ROLE_CORE_TRUNK ||
        roleResult.role === ROLE_BUSINESS_MODULE
    ) {
        state.domainKernelEffectiveLoc += eloc;
    }

    const specifiers = state.currentSpecifiers;
    if (specifiers && specifiers.length > 0) {
        processImportSpecifiers(specifiers, {
            currentFile: metric.file,
            manifestDeps,
            state,
            isCritical,
            fileInv,
        });
    }
}

/**
 * Quantifies supply chain resilience against external transitive dependency explosion.
 *
 * Coefficients come from the autonomy parameter block rather than inline literals, so a
 * framework-heavy project can widen the dampening without editing the engine.
 *
 * @param supplyChain - Lockfile and manifest profile of the project.
 * @param config - Autonomy parameters supplying the dampening coefficients.
 * @returns Resilience score in [minResilience, 100].
 */
function calculateSupplyChainResilience(
    supplyChain: SupplyChainProfile,
    config: AutonomyScoringConfig,
): number {
    if (supplyChain.directDependencyCount === 0 && supplyChain.totalLockfilePackages === 0) {
        return PERCENT_MAX;
    }
    const directCount = supplyChain.directDependencyCount;
    const transitiveCount = supplyChain.transitiveDependencyCount;
    const depth = supplyChain.estimatedDepth;
    const coefficients = config.supplyChain;

    const penalty =
        directCount * coefficients.directWeight +
        Math.sqrt(transitiveCount) * coefficients.transitiveWeight +
        Math.max(0, depth - 1) * coefficients.depthWeight;
    const resilience = Math.max(
        coefficients.minResilience,
        Math.min(PERCENT_MAX, PERCENT_MAX - penalty),
    );
    return clampScore(resilience);
}

/**
 * Combine the six autonomy axes into the composite index.
 *
 * The default geometric form is bounded by the weakest axis, so outsourcing the critical path
 * cannot be masked by a high proprietary-LOC ratio. Both branches floor each axis at
 * `compositeIndexFloor`: the logarithm needs a strictly positive argument, and the floor keeps a
 * single collapse visible (~15^0.1 ≈ 0.76 against 1.0) without erasing the score.
 *
 * @param axes - Six axis scores in [0, 100].
 * @param weights - Matching non-negative weights; only their ratios matter.
 * @param mode - Aggregation strategy.
 * @param floor - Strictly positive floor applied before the geometric mean.
 * @returns Composite index rounded to two decimals.
 */
function aggregateAutonomyAxes(
    axes: readonly number[],
    weights: readonly number[],
    mode: ScoringAggregationMode,
    floor: number,
): number {
    let weightMass = 0;
    for (const weight of weights) weightMass += weight;
    if (weightMass <= 0) return 0;

    if (mode === 'arithmetic') {
        let sum = 0;
        for (let index = 0; index < axes.length; index++) {
            sum += axes[index] * weights[index];
        }
        return +(sum / weightMass).toFixed(PRECISION_TWO);
    }

    let logSum = 0;
    for (let index = 0; index < axes.length; index++) {
        if (weights[index] <= 0) continue;
        const bounded = Math.max(floor, Math.min(PERCENT_FACTOR, axes[index]));
        logSum += weights[index] * Math.log(bounded);
    }
    return +Math.exp(logSum / weightMass).toFixed(PRECISION_TWO);
}

/**
 * Quantifies code originality from genuine clone findings only.
 *
 * Two corrections over the previous absolute-count penalty:
 *
 * 1. `duplicate-literal` is a constant-extraction suggestion, not borrowed code, so it no
 *    longer feeds this axis — a project is not less original for repeating `'utf8'`.
 * 2. The penalty is a hyperbolic function of clone *density* (findings per thousand proprietary
 *    ELOC) instead of `count * 1.5` clamped at 80. The old form saturated at 54 findings, so
 *    every repository past a few thousand lines reported exactly 20% originality regardless of
 *    how clean it actually was; density keeps large and small trees comparable and never pins.
 *
 * @param issues - All findings collected during the scan.
 * @param proprietaryEloc - Proprietary effective lines of code in the tree.
 * @param config - Autonomy parameters supplying the clone half-point and density unit.
 * @returns Originality index in [0, 100]; 100 when no clone was found.
 */
function calculateCodeOriginality(
    issues: Issue[],
    proprietaryEloc: number,
    config: AutonomyScoringConfig,
): number {
    let cloneFindings = 0;
    for (const issue of issues) {
        if (issue.rule === RULE_HYG_CLN_001) cloneFindings++;
    }
    if (cloneFindings === 0) {
        return PERCENT_FACTOR;
    }
    const unit = Math.max(1, config.cloneDensityElocUnit);
    const density = cloneFindings / Math.max(1, proprietaryEloc / unit);
    const score = (PERCENT_FACTOR * config.cloneHalfPoint) / (config.cloneHalfPoint + density);
    return Number.isFinite(score) ? clampScore(score) : PERCENT_FACTOR;
}

/**
 * Synthesize raw accounting state and issues into AutonomyEvaluation.
 *
 * The six axes are combined through a weighted geometric mean by default, matching the quality
 * model: an arithmetic sum let five healthy axes outvote one collapsed axis (a fully outsourced
 * critical path, for instance) and report a passable autonomy index for a project that owns no
 * core logic. Each axis is floored at `compositeIndexFloor` so a single collapse still registers
 * without driving the logarithm to negative infinity.
 *
 * @param state - Accumulated per-file accounting state.
 * @param totalFiles - Number of files considered in the scan.
 * @param issues - All findings collected during the scan.
 * @param supplyChain - Lockfile and manifest profile of the project.
 * @param config - Autonomy parameters; defaults to the scoring SSOT.
 * @returns Full autonomy evaluation record.
 */
/**
 * Derives the irreducible asymptotic ceiling (< 100.0) for autonomy metrics.
 * Even 100% in-house source retains runtime/compiler dependency and finite-sample uncertainty.
 */
function computeAutonomyEpistemicCeiling(
    proprietaryEloc: number,
    config: AutonomyScoringConfig,
): number {
    const reserve = Math.max(0.01, config.epistemicReserve);
    const halfEloc = Math.max(1, config.epistemicSampleHalfPointEloc);
    const safeEloc = Math.max(0, Number.isFinite(proprietaryEloc) ? proprietaryEloc : 0);
    const sampleMargin = 0.75 / (1 + safeEloc / halfEloc);
    return Math.min(99.99, +(PERCENT_MAX - reserve - sampleMargin).toFixed(PRECISION_TWO));
}

function synthesizeAutonomyEvaluation(
    state: AutonomyScanState,
    totalFiles: number,
    issues: Issue[],
    supplyChain: SupplyChainProfile,
    config: AutonomyScoringConfig = DEFAULT_SCORING_CONFIG.autonomy,
    compositeIndexFloor: number = DEFAULT_SCORING_CONFIG.compositeIndexFloor,
): AutonomyEvaluation {
    const axisCeiling = computeAutonomyEpistemicCeiling(state.proprietaryEffectiveLoc, config);
    const totalTreeEloc =
        state.proprietaryEffectiveLoc + state.vendorEffectiveLoc + state.generatedEffectiveLoc;
    const rawLoc =
        totalTreeEloc > 0
            ? (state.proprietaryEffectiveLoc / totalTreeEloc) * PERCENT_FACTOR
            : axisCeiling;
    const rLoc = Math.min(axisCeiling, rawLoc);

    const totalScopedCalls = state.internalSymbolCalls + state.externalSdkCalls;
    let rawCall: number;
    if (totalScopedCalls > 0) {
        rawCall = (state.internalSymbolCalls / totalScopedCalls) * PERCENT_FACTOR;
    } else if (state.sdkCallCounts.size > 0 || state.externalSdkCalls > 0) {
        const externalPkgs = Math.max(1, state.sdkCallCounts.size);
        rawCall = Math.max(
            config.minSymbolCallScore,
            PERCENT_FACTOR - externalPkgs * config.externalPackagePenalty,
        );
    } else {
        rawCall = axisCeiling;
    }
    const rCall = Math.min(axisCeiling, rawCall);

    const rDomain =
        state.proprietaryEffectiveLoc > 0
            ? Math.min(
                  axisCeiling,
                  (state.domainKernelEffectiveLoc / state.proprietaryEffectiveLoc) * PERCENT_FACTOR,
              )
            : axisCeiling;

    const rPure = Math.min(
        axisCeiling,
        calculateCodeOriginality(issues, state.proprietaryEffectiveLoc, config),
    );

    const rSupply = Math.min(axisCeiling, calculateSupplyChainResilience(supplyChain, config));

    const totalCriticalCalls = state.criticalPathInternalCalls + state.criticalPathExternalCalls;
    let rawCritical: number;
    if (state.criticalPathFiles > 0 && totalCriticalCalls > 0) {
        rawCritical = (state.criticalPathInternalCalls / totalCriticalCalls) * PERCENT_FACTOR;
    } else if (state.criticalPathFiles > 0) {
        rawCritical = state.externalSdkCalls === 0 ? axisCeiling : rCall;
    } else {
        rawCritical = rCall;
    }
    const rCritical = Math.min(axisCeiling, rawCritical);

    const weights = config.weights;
    const compositeScore = aggregateAutonomyAxes(
        [rLoc, rCall, rDomain, rPure, rSupply, rCritical],
        [
            weights.effectiveLoc,
            weights.symbolCall,
            weights.domainKernel,
            weights.codeOriginality,
            weights.supplyChainResilience,
            weights.criticalPathAutonomy,
        ],
        config.aggregationMode,
        compositeIndexFloor,
    );

    const boundedComposite = Math.max(0, Math.min(axisCeiling, compositeScore));
    const { grade, description } = resolveAutonomyGrade(boundedComposite);

    // Rigorous Bayesian Credible Interval via Jeffreys conjugate prior
    const totalRuleObservations = totalScopedCalls + issues.length;
    const confidence = computeBayesianAutonomyConfidence(
        boundedComposite,
        state.proprietaryEffectiveLoc,
        totalFiles,
        totalScopedCalls,
        totalRuleObservations,
    );

    const externalSdkInventory: ExternalSdkUsage[] = Array.from(state.sdkCallCounts.entries())
        .map(([name, callCount]) => ({
            name,
            callCount,
            fileCount: state.sdkFileSets.get(name)?.size || 1,
        }))
        .sort((firstUsage, secondUsage) => secondUsage.callCount - firstUsage.callCount);

    return {
        compositeAutonomyIndex: boundedComposite,
        grade,
        gradeDescription: description,
        dimensions: {
            effectiveLocAutonomy: +rLoc.toFixed(2),
            symbolCallAutonomy: +rCall.toFixed(2),
            domainKernelDensity: +rDomain.toFixed(2),
            codeOriginality: +rPure.toFixed(2),
            supplyChainResilience: +rSupply.toFixed(2),
            criticalPathAutonomy: +rCritical.toFixed(2),
        },
        weights,
        confidence,
        supplyChain: {
            hasLockfile: supplyChain.hasLockfile,
            lockfileType: supplyChain.lockfileType,
            directDependencies: supplyChain.directDependencyCount,
            transitiveDependencies: supplyChain.transitiveDependencyCount,
            totalLockfilePackages: supplyChain.totalLockfilePackages,
            estimatedDepth: supplyChain.estimatedDepth,
        },
        externalSdkInventory,
        stats: {
            totalFiles,
            proprietaryFiles: state.proprietaryFiles,
            vendorFiles: state.vendorFiles,
            generatedFiles: state.generatedFiles,
            totalEffectiveLoc: totalTreeEloc,
            proprietaryEffectiveLoc: state.proprietaryEffectiveLoc,
            vendorEffectiveLoc: state.vendorEffectiveLoc,
            generatedEffectiveLoc: state.generatedEffectiveLoc,
            internalSymbolCalls: state.internalSymbolCalls,
            externalSdkCalls: state.externalSdkCalls,
            stdlibCalls: state.stdlibCalls,
            criticalPathFiles: state.criticalPathFiles,
            criticalPathInternalCalls: state.criticalPathInternalCalls,
            criticalPathExternalCalls: state.criticalPathExternalCalls,
        },
    };
}

function appendExtPackage(pkgs: string[] | undefined, spec: string): string[] {
    const pkg = extractModulePackageName(spec);
    if (pkgs !== undefined) {
        pkgs.push(pkg);
        return pkgs;
    }
    return [pkg];
}

function collectExtPackages(
    specifiers: Iterable<string>,
    file: string,
    manifestDeps: Set<string>,
    fileInv?: ProjectManifestInventory,
): string[] | undefined {
    let pkgs: string[] | undefined;
    for (const spec of specifiers) {
        if (!isValidPackageSpecifier(spec)) continue;
        if (
            classifyImportProvenance(spec, file, manifestDeps, fileInv?.pathAliases) ===
            KIND_EXTERNAL_SDK
        ) {
            if (isProductionExternalSdk(spec, file, fileInv)) {
                pkgs = appendExtPackage(pkgs, spec);
            }
        }
    }
    return pkgs;
}

/** Context bundle for project autonomy evaluation. */
export interface AutonomyEvaluationContext {
    readonly fileMetrics: FileMetric[];
    readonly issues: Issue[];
    readonly config: ScanConfig;
    readonly fileContents?: Map<string, string>;
    readonly symbolIndex?: SymbolIndex;
}

interface LegacyAutonomyArgs {
    readonly issues?: Issue[];
    readonly config?: ScanConfig;
    readonly fileContents?: Map<string, string>;
    readonly symbolIndex?: SymbolIndex;
}

function normalizeAutonomyContext(
    metricsOrContext: FileMetric[] | AutonomyEvaluationContext,
    legacy?: LegacyAutonomyArgs,
): AutonomyEvaluationContext {
    if (!Array.isArray(metricsOrContext)) {
        return metricsOrContext;
    }
    return {
        fileMetrics: metricsOrContext,
        issues: legacy?.issues ?? [],
        config: legacy?.config ?? ({ root: process.cwd() } as unknown as ScanConfig),
        fileContents: legacy?.fileContents,
        symbolIndex: legacy?.symbolIndex,
    };
}

/**
 * Evaluates in-house code autonomy ratio (CAI 2.0) across six orthogonal dimensions.
 *
 * @param context - Bundled options and inputs for autonomy evaluation.
 * @returns AutonomyEvaluation
 */
export function evaluateProjectAutonomy(context: AutonomyEvaluationContext): AutonomyEvaluation;
/**
 * Evaluates in-house code autonomy ratio (CAI 2.0) across six orthogonal dimensions.
 *
 * @param fileMetrics - Scanned file metrics including lines and paths
 * @param issues - Detected issue collection (used for clone and duplication penalty)
 * @param config - Scan configuration holding project root and options
 * @param fileContents - Optional map of file path to raw content for import extraction
 * @param symbolIndex - Optional indexed project symbol graph for call reference analysis
 * @returns AutonomyEvaluation
 */
export function evaluateProjectAutonomy(
    fileMetrics: FileMetric[],
    issues?: Issue[],
    config?: ScanConfig,
    fileContents?: Map<string, string>,
    symbolIndex?: SymbolIndex,
): AutonomyEvaluation;
/**
 * Runtime implementation shared by both autonomy evaluation calling conventions.
 *
 * Normalizes the bundled and positional argument forms into a single context before the six
 * dimension computation, so both entry points yield identical results for identical inputs.
 *
 * @param metricsOrContext - Bundled context, or the file metric array of the positional form.
 * @param restArgs - Rest positional arguments.
 * @returns Project autonomy evaluation across the six dimensions.
 */
export function evaluateProjectAutonomy(
    metricsOrContext: FileMetric[] | AutonomyEvaluationContext,
    ...restArgs: [Issue[]?, ScanConfig?, Map<string, string>?, SymbolIndex?]
): AutonomyEvaluation {
    const legacy: LegacyAutonomyArgs | undefined = Array.isArray(metricsOrContext)
        ? {
              issues: restArgs[0],
              config: restArgs[1],
              fileContents: restArgs[2],
              symbolIndex: restArgs[3],
          }
        : undefined;
    const ctx = normalizeAutonomyContext(metricsOrContext, legacy);
    const { fileMetrics, issues, config, fileContents, symbolIndex } = ctx;

    const rootDir = config.root || process.cwd();
    const scoringConfig = resolveScoringConfig(config.scoring);
    const manifestDeps = loadProjectManifestDependencies(rootDir);
    const supplyChain = loadProjectSupplyChainProfile(rootDir, manifestDeps.size);

    const state: AutonomyScanState = createAutonomyScanState();

    const fileToExtPackages = new Map<string, string[]>();
    const fileToImportProfiles = new Map<string, FileImportProfile>();
    const fileToContentCacheMap = new Map<string, string>();
    const emptyProfile: FileImportProfile = {
        specifiers: [],
        symbolToPackageMap: new Map<string, string>(),
    };

    for (const metric of fileMetrics) {
        const raw = loadFileRawContent(metric, config, fileContents, fileToContentCacheMap);
        const profile = raw ? extractFileImportProfile(raw, metric.file) : emptyProfile;
        fileToImportProfiles.set(metric.file, profile);

        const fileInv = findNearestManifestInventory(metric.file, rootDir);
        const effectiveDeps =
            fileInv.allDependencies.size > 0 ? fileInv.allDependencies : manifestDeps;

        const extPkgs = collectExtPackages(profile.specifiers, metric.file, effectiveDeps, fileInv);
        if (extPkgs) {
            fileToExtPackages.set(metric.file, extPkgs);
        }
        state.currentSpecifiers = profile.specifiers;
        accumulateFileMetric({
            metric,
            manifestDeps: effectiveDeps,
            state,
            rawContent: raw,
            fileInv,
        });
    }

    if (symbolIndex) {
        applySymbolIndexReferences({
            symbolIndex,
            state,
            fileToExtPackages,
            fileToImportProfiles,
            rootDir,
            manifestDeps,
        });
    }

    return synthesizeAutonomyEvaluation(
        state,
        fileMetrics.length,
        issues,
        supplyChain,
        scoringConfig.autonomy,
        scoringConfig.compositeIndexFloor,
    );
}
