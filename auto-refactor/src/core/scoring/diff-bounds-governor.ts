/**
 * Module: Core Scoring — Differential Semantic Bounds & Admission Governor
 * File Path: src/core/scoring/diff-bounds-governor.ts
 * Architecture Role: Evaluates differential semantic bounding envelopes ([L_add_min, L_add_max]
 *   and [L_del_min, L_del_max]), computes empirical Net Semantic Turnover (Δ_net), derives
 *   dynamic non-hardcoded admission thresholds (Θ_admission), and maintains ledger persistence.
 * Dependencies & Triggers: Consumes semantic-delta-classifier, payload-density, token-entropy,
 *   descriptive-statistics, and numerical-corridor; invoked by anti-gaming engines and runners.
 * Responsibilities:
 *   1. Enforce differential bounds preventing addition inflation and defensive capability erosion;
 *   2. Compute objective Net Semantic Turnover subtracting cosmetic and relocated churn;
 *   3. Derive empirical admission thresholds via trajectory sliding-window moments & Jeffreys Beta;
 *   4. Persist admission audit ledger to .auto-refactor-cache/admission-turnover-ledger.ndjson.
 * Exit Semantics & Design Rationale: CC <= 15; deterministic calculations; fail-safe ledger I/O;
 *   zero arbitrary magic thresholds.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isCosmeticDiffLine, isBoilerplateDiffLine } from '../diff/semantic-delta-classifier';
import { calculateWeightedTokenPayload } from '../intelligence/payload-density';
import { tokenizeCode } from '../intelligence/token-entropy';
import { computeStatisticalMoments, type StatisticalMoments } from '../math/descriptive-statistics';
import { clampRange, safeDivide } from '../math/numerical-corridor';
import { DIFF_BOUNDS_CONTRACT, type DiffBoundsContractShape } from './diff-bounds-contract';

export { DIFF_BOUNDS_CONTRACT, type DiffBoundsContractShape };

const readUtf8Sync = fs['readFileSync'];

/** Minimum token semantic payload ratio required for substantive code additions. */
export const MIN_TSPR_ADDED_THRESHOLD = DIFF_BOUNDS_CONTRACT.densityBands.tspr.target;

/** Minimum ratio of useful semantic lines to total additions before inflation is flagged. */
export const MIN_SEMANTIC_LINE_DENSITY = DIFF_BOUNDS_CONTRACT.densityBands.substantiveRatio.target;

/** Substantive line ratio floor enforced even when high TSPR vouches for headers. */
export const MIN_SEMANTIC_LINE_FLOOR = DIFF_BOUNDS_CONTRACT.densityBands.substantiveRatio.floor;

/** TSPR threshold above which dense payloads vouch for substantive density down to floor. */
export const TSPR_VOUCH_FOR_DENSITY = DIFF_BOUNDS_CONTRACT.densityBands.tsprVouchForDensity;

/** Minimum additions count before inflation heuristics begin strictly enforcing density. */
export const INFLATION_SAMPLE_LINE_THRESHOLD =
    DIFF_BOUNDS_CONTRACT.densityBands.minPhysAddSampleWidth;

/** Weight applied to deleted weighted ELOC in net commit batch turnover. */
export const DELETION_TURNOVER_WEIGHT = DIFF_BOUNDS_CONTRACT.batchBands.deletionTurnoverWeight;

/** Weight applied to test-file additions when checking macro batch addition ceiling. */
export const TEST_BATCH_WEIGHT = DIFF_BOUNDS_CONTRACT.batchBands.testBatchWeight;

/** Max fraction of an existing file's LOC deletable without equivalent compensation. */
export const MAX_DELETION_FRACTION_EROSION =
    DIFF_BOUNDS_CONTRACT.expansionPolicy.maxDeletionFractionErosion;

/** Minimum deletion line floor below which small deletions skip erosion checks. */
export const MIN_DELETION_ALLOWANCE_LOC =
    DIFF_BOUNDS_CONTRACT.expansionPolicy.minDeletionAllowanceLoc;

/** Deleted weighted ELOC threshold above which existing files get refactor headroom. */
export const REFACTOR_WITNESS_MIN_DEL_ELOC =
    DIFF_BOUNDS_CONTRACT.expansionPolicy.refactorWitnessMinDelEloc;

/** Minimum batch deleted weighted ELOC required for cross-file refactor conservation witness. */
export const CROSS_FILE_REFACTOR_MIN_DEL_ELOC =
    DIFF_BOUNDS_CONTRACT.expansionPolicy.crossFileRefactorMinDelEloc;

/** Minimum deletion-to-addition ratio required for cross-file refactor conservation witness. */
export const CROSS_FILE_REFACTOR_DEL_RATIO =
    DIFF_BOUNDS_CONTRACT.expansionPolicy.crossFileRefactorDelRatio;

/** Minimum coverage fraction required from replacement additions to witness large deletions. */
export const WITNESS_COVERAGE_RATIO = DIFF_BOUNDS_CONTRACT.expansionPolicy.witnessCoverageRatio;

/** Absolute default ceiling for effective LOC budget per single file. */
export const DEFAULT_FILE_LOC_BUDGET = DIFF_BOUNDS_CONTRACT.expansionPolicy.defaultFileLocBudget;

/** Minimum LOC allowance below which expansion upper bounds are relaxed for small modules. */
export const MIN_EXPANSION_ALLOWANCE_LOC =
    DIFF_BOUNDS_CONTRACT.expansionPolicy.minExpansionAllowanceLoc;

/** Maximum expansion fraction of current LOC allowed in a single un-decoupled atomic change. */
export const MAX_EXPANSION_LOC_RATIO = DIFF_BOUNDS_CONTRACT.expansionPolicy.maxExpansionLocRatio;

/** Maximum single-file added weighted ELOC allowed in a single commit for a brand new file. */
export const MAX_COMMIT_FILE_ADD_NEW_5D_ELOC = DIFF_BOUNDS_CONTRACT.fileAddBands.newFile.ceiling;

/** Maximum single-file added weighted ELOC allowed in a single commit for an existing file. */
export const MAX_COMMIT_FILE_ADD_EXISTING_5D_ELOC =
    DIFF_BOUNDS_CONTRACT.fileAddBands.existingFile.ceiling;

/** Maximum single-file added weighted ELOC allowed when refactoring witness headroom applies. */
export const MAX_COMMIT_FILE_ADD_REFACTOR_5D_ELOC =
    DIFF_BOUNDS_CONTRACT.fileAddBands.refactorWitness.ceiling;

/** Maximum single-file added weighted ELOC allowed for a brand new test file. */
export const MAX_COMMIT_TEST_FILE_ADD_NEW_ELOC =
    DIFF_BOUNDS_CONTRACT.testFileAddBands.newFile.ceiling;

/** Maximum single-file added weighted ELOC allowed for an existing test file. */
export const MAX_COMMIT_TEST_FILE_ADD_EXISTING_ELOC =
    DIFF_BOUNDS_CONTRACT.testFileAddBands.existingFile.ceiling;

/** Maximum single-file added weighted ELOC allowed for a refactor-witnessed test file. */
export const MAX_COMMIT_TEST_FILE_ADD_REFACTOR_ELOC =
    DIFF_BOUNDS_CONTRACT.testFileAddBands.refactorWitness.ceiling;

/** Maximum single-file deleted weighted ELOC allowed in a commit without formal retirement. */
export const MAX_COMMIT_FILE_DEL_5D_ELOC = DIFF_BOUNDS_CONTRACT.fileDelBands.plain.ceiling;

/** Maximum single-file deleted weighted ELOC allowed in one commit with a refactor witness. */
export const MAX_COMMIT_FILE_DEL_WITNESSED_5D_ELOC =
    DIFF_BOUNDS_CONTRACT.fileDelBands.witnessed.ceiling;

/** Minimum substantive useful weighted turnover required for admission. */
export const MIN_SUBSTANTIVE_TURNOVER_FLOOR = 1.0;

/** Mathematical floor for minimum admission turnover (based on AST block minimum depth). */
export const ADMISSION_TURNOVER_FLOOR = DIFF_BOUNDS_CONTRACT.empiricalAdmission.turnoverFloor;

/** Hard cap on adaptive empirical admission turnover to prevent permanent lockout. */
export const ADMISSION_TURNOVER_CAP = DIFF_BOUNDS_CONTRACT.empiricalAdmission.turnoverCap;

/** Minimum number of trajectory runs required before adaptive thresholding leaves floor. */
export const MIN_TRAJECTORY_SAMPLES = DIFF_BOUNDS_CONTRACT.empiricalAdmission.minTrajectorySamples;

/** Maximum acceptable noise index (CC / ELOC) before full noise damping is applied. */
export const MAX_NOISE_CEILING = DIFF_BOUNDS_CONTRACT.empiricalAdmission.maxNoiseCeiling;

/** Default sliding window size for historical trajectory sampling. */
export const DEFAULT_TRAJECTORY_WINDOW_SIZE =
    DIFF_BOUNDS_CONTRACT.empiricalAdmission.trajectoryWindowSize;

/** Default language identifier for differential code analysis. */
export const DEFAULT_DIFF_LANGUAGE = 'typescript';

/** Bayesian prior alpha parameter for Jeffreys Beta(0.5, 0.5) distribution. */
export const JEFFREYS_PRIOR_ALPHA = DIFF_BOUNDS_CONTRACT.empiricalAdmission.jeffreysPriorAlpha;

/** Bayesian prior beta parameter for Jeffreys Beta(0.5, 0.5) distribution. */
export const JEFFREYS_PRIOR_BETA = DIFF_BOUNDS_CONTRACT.empiricalAdmission.jeffreysPriorBeta;

/** Fallback posterior confidence value when sample size is zero. */
export const JEFFREYS_DEFAULT_POSTERIOR =
    DIFF_BOUNDS_CONTRACT.empiricalAdmission.jeffreysDefaultPosterior;

/** Discount factor applied to trajectory standard deviation in empirical threshold derivation. */
export const STANDARD_DEVIATION_DISCOUNT_FACTOR =
    DIFF_BOUNDS_CONTRACT.empiricalAdmission.stdDevDiscountFactor;

/** Percentage calculation scaling multiplier. */
export const PERCENTAGE_SCALE_FACTOR = 100;

/** Decimal rounding scaling factor for tenth precision (1 decimal place). */
export const DECIMAL_ROUNDING_FACTOR_TENTH = 10;

/** Decimal rounding scaling factor for hundredth precision (2 decimal places). */
export const DECIMAL_ROUNDING_FACTOR_HUNDREDTH = 100;

/** Decimal rounding scaling factor for thousandth precision (3 decimal places). */
export const DECIMAL_ROUNDING_FACTOR_THOUSANDTH = 1000;

/** Relative directory name for local auto-refactor cache. */
export const CACHE_DIRECTORY_NAME = '.auto-refactor-cache';

/** Default filename for admission turnover audit ledger. */
export const ADMISSION_LEDGER_FILENAME = 'admission-turnover-ledger.ndjson';

/** Verdict code when change is admitted by turnover and envelope checks. */
export const VERDICT_ADMITTED = 'ADMITTED';

/** Verdict code when net turnover is below the empirical admission threshold. */
export const VERDICT_BLOCKED_INSUFFICIENT_TURNOVER = 'BLOCKED_INSUFFICIENT_TURNOVER';

/** Verdict code when added lines exhibit hollow inflation or trampoline padding. */
export const VERDICT_BLOCK_GAMING_INFLATION = 'BLOCK_GAMING_INFLATION';

/** Verdict code when deletions erode defensive capability or integrity checks. */
export const VERDICT_BLOCK_CAPABILITY_EROSION = 'CAPABILITY_EROSION_GUARD';

/** Verdict code when single-file addition volume exceeds the atomic commit batch ceiling. */
export const VERDICT_BLOCK_FILE_ADD_OVERFLOW = 'BLOCK_FILE_ADD_OVERFLOW';

/** Verdict code when single-file deletion volume exceeds the atomic commit batch ceiling. */
export const VERDICT_BLOCK_FILE_DEL_OVERFLOW = 'BLOCK_FILE_DEL_OVERFLOW';

/** Verdict code when aggregated commit batch additions exceed the atomic batch ceiling. */
export const VERDICT_BLOCK_BATCH_ADD_OVERFLOW = 'BLOCK_BATCH_ADD_OVERFLOW';

/** Verdict code when aggregated commit batch deletions exceed the atomic batch ceiling. */
export const VERDICT_BLOCK_BATCH_DEL_OVERFLOW = 'BLOCK_BATCH_DEL_OVERFLOW';

/** Canonical verdict status for differential bounds checks. */
export type DifferentialVerdictCode =
    | typeof VERDICT_ADMITTED
    | typeof VERDICT_BLOCKED_INSUFFICIENT_TURNOVER
    | typeof VERDICT_BLOCK_GAMING_INFLATION
    | typeof VERDICT_BLOCK_CAPABILITY_EROSION
    | typeof VERDICT_BLOCK_FILE_ADD_OVERFLOW
    | typeof VERDICT_BLOCK_FILE_DEL_OVERFLOW
    | typeof VERDICT_BLOCK_BATCH_ADD_OVERFLOW
    | typeof VERDICT_BLOCK_BATCH_DEL_OVERFLOW;

/**
 * Parameters for evaluating differential bounds on a single file change.
 */
export interface DifferentialBoundsParams {
    readonly filePath: string;
    readonly oldContent: string;
    readonly newContent: string;
    readonly addedLines: readonly string[];
    readonly deletedLines: readonly string[];
    readonly language?: string;
    readonly fileLocBudget?: number;
    readonly hasEquivalentExtraction?: boolean;
    readonly isFormalRetirement?: boolean;
    readonly hasBatchRefactorWitness?: boolean;
}

/**
 * Evaluated bounds for addition and deletion envelopes.
 */
export interface DifferentialEnvelopeBounds {
    readonly addMin: number;
    readonly addMax: number;
    readonly delMin: number;
    readonly delMax: number;
    readonly usefulAddedLines: number;
    readonly usefulDeletedLines: number;
    readonly eloc5dAdd: number;
    readonly eloc5dDel: number;
    readonly tsprAdded: number;
    readonly semanticDensity: number;
}

/**
 * Verdict resulting from differential bounds evaluation.
 */
export interface DifferentialBoundsVerdict {
    readonly isAllowed: boolean;
    readonly verdictCode: DifferentialVerdictCode;
    readonly bounds: DifferentialEnvelopeBounds;
    readonly reason?: string;
}

/**
 * Decomposed weighted ELOC differential metrics for a single file.
 */
export interface File5dElocDelta {
    readonly filePath: string;
    readonly eloc5dAdd: number;
    readonly eloc5dDel: number;
    readonly net5dTurnover: number;
    readonly rawAdd: number;
    readonly rawDel: number;
    readonly usefulAdded: number;
    readonly usefulDeleted: number;
    readonly tsprAdded: number;
    readonly semanticDensity: number;
}

/**
 * Parameters for calculating Net Semantic Turnover (Δ_net).
 */
export interface NetTurnoverParams {
    readonly semanticAddedEloc: number;
    readonly semanticDeletedEloc: number;
    readonly relocatedEloc: number;
    readonly cosmeticEloc: number;
    readonly physicalAddedLines: number;
    readonly physicalDeletedLines: number;
}

/**
 * Computed Net Semantic Turnover metrics.
 */
export interface NetTurnoverResult {
    readonly netSemanticTurnover: number;
    readonly turnoverRatio: number;
    readonly effectiveTurnoverScore: number;
}

/**
 * Historical trajectory run summary for dynamic admission threshold derivation.
 */
export interface TrajectoryRunPoint {
    readonly timestamp: number;
    readonly netSemanticTurnover: number;
    readonly gatePassed: boolean;
    readonly cyclomaticComplexity?: number;
    readonly effectiveLoc?: number;
}

/**
 * Parameters for computing dynamic empirical admission threshold.
 */
export interface EmpiricalAdmissionThresholdParams {
    readonly recentRuns: readonly TrajectoryRunPoint[];
    readonly currentComplexity: number;
    readonly currentEloc: number;
    readonly windowSize?: number;
}

/**
 * Result of dynamic empirical admission threshold calculation.
 */
export interface DynamicAdmissionThresholdResult {
    readonly threshold: number;
    readonly rollingMean: number;
    readonly rollingStdDev: number;
    readonly noiseFactor: number;
    readonly posteriorConfidence: number;
    readonly sampleCount: number;
}

/**
 * Audit record serialized to the admission ledger.
 */
export interface AdmissionAuditRecord {
    readonly timestamp: number;
    readonly commitStagingDigest: string;
    readonly lAdd: number;
    readonly lDel: number;
    readonly netSemanticTurnover: number;
    readonly admissionThreshold: number;
    readonly turnoverRatio: number;
    readonly verdict: DifferentialVerdictCode;
    readonly factors: {
        readonly rollingMean: number;
        readonly rollingStdDev: number;
        readonly noisePenalty: number;
        readonly confidence: number;
    };
}

/**
 * Evaluates semantic payload ratio (TSPR) for a stream of added lines.
 *
 * @param addedLines - Array of newly added line strings.
 * @param language - Optional language identifier.
 * @returns TSPR in [0.0, 1.0].
 */
export function computeAddedLinesTspr(
    addedLines: readonly string[],
    language: string = DEFAULT_DIFF_LANGUAGE,
): number {
    if (!addedLines || addedLines.length === 0) {
        return 1.0;
    }
    const combinedContent = addedLines.join('\n');
    const tokenStream = tokenizeCode(combinedContent, language);
    if (tokenStream.tokens.length === 0) {
        return 0.0;
    }
    const payload = calculateWeightedTokenPayload(tokenStream.tokens);
    return payload.tspr;
}

/**
 * Counts substantive lines among additions by excluding cosmetic comments, blanks, and boilerplate.
 *
 * @param addedLines - Newly added line strings.
 * @returns Count of substantive useful lines.
 */
export function countUsefulAddedLines(addedLines: readonly string[]): number {
    let substantiveLineCount = 0;
    for (let lineIndex = 0; lineIndex < addedLines.length; lineIndex++) {
        const lineContent = addedLines[lineIndex];
        if (isCosmeticDiffLine(lineContent) || isBoilerplateDiffLine(lineContent)) {
            continue;
        }
        substantiveLineCount++;
    }
    return substantiveLineCount;
}

const DIFF_TEST_FILE_PATTERNS: readonly RegExp[] = [
    /(^|\/)(tests?|__tests__)\//,
    /\.(test|spec)\.[cm]?[jt]sx?$/,
    /(^|\/)test_[^/]+\.(rs|gd|py)$/,
    /^scripts\/common\/test-[^/]+\.js$/,
    /^auto-refactor\/scripts\/validate-[^/]+\.js$/,
];

/**
 * Classifies whether a file path belongs to the dedicated test-file track across JS/TS/Rust.
 *
 * @param filePath - Repository-relative or POSIX/Windows file path.
 * @returns True when the file matches test-track conventions.
 */
export function isDiffTestFilePath(filePath: string): boolean {
    if (!filePath) return false;
    const normalized = filePath.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
    return DIFF_TEST_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Reports whether batch-level deletions witness cross-file refactor conservation.
 *
 * @param totalElocAdd - Total added weighted ELOC across the batch.
 * @param totalElocDel - Total deleted weighted ELOC across the batch.
 * @returns True when deletions satisfy both the absolute floor and conservation ratio.
 */
export function hasCrossFileRefactorWitness(totalElocAdd: number, totalElocDel: number): boolean {
    if (!Number.isFinite(totalElocAdd) || !Number.isFinite(totalElocDel)) return false;
    return (
        totalElocDel >= CROSS_FILE_REFACTOR_MIN_DEL_ELOC &&
        totalElocDel >= totalElocAdd * CROSS_FILE_REFACTOR_DEL_RATIO
    );
}

/**
 * Computes upper and lower bounding envelopes for file modification.
 *
 * @param params - Differential bounds evaluation parameters.
 * @returns Derived envelope limits and measured payload attributes.
 */
export function computeEnvelopeBounds(
    params: DifferentialBoundsParams,
): DifferentialEnvelopeBounds {
    const originalLineCount = params.oldContent
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0).length;
    const fileLocBudget = params.fileLocBudget ?? DEFAULT_FILE_LOC_BUDGET;
    const isNewFile = originalLineCount === 0;
    const addBands = isDiffTestFilePath(params.filePath)
        ? DIFF_BOUNDS_CONTRACT.testFileAddBands
        : DIFF_BOUNDS_CONTRACT.fileAddBands;

    // 1. Measure addition payload density first so deletions can calibrate refactor headroom
    const usefulAddedLines = countUsefulAddedLines(params.addedLines);
    const usefulDeletedLines = countUsefulAddedLines(params.deletedLines);
    const tsprAdded = computeAddedLinesTspr(params.addedLines, params.language);
    const semanticDensity =
        params.addedLines.length > 0 ? safeDivide(usefulAddedLines, params.addedLines.length) : 1.0;
    const raw5dAdd = usefulAddedLines * tsprAdded;
    const eloc5dAdd =
        Math.round(raw5dAdd * DECIMAL_ROUNDING_FACTOR_HUNDREDTH) /
        DECIMAL_ROUNDING_FACTOR_HUNDREDTH;
    const eloc5dDel = usefulDeletedLines;

    const hasRefactorWitness = Boolean(
        params.hasEquivalentExtraction ||
        params.isFormalRetirement ||
        params.hasBatchRefactorWitness ||
        usefulDeletedLines > REFACTOR_WITNESS_MIN_DEL_ELOC,
    );
    const addCommitCeiling = hasRefactorWitness
        ? addBands.refactorWitness.ceiling
        : addBands.existingFile.ceiling;
    const newFileCeiling =
        params.hasBatchRefactorWitness || params.hasEquivalentExtraction
            ? addBands.refactorWitness.ceiling
            : addBands.newFile.ceiling;

    // 2. Addition envelope bounds (decoupled from static budget, clamped to atomic batch ceiling)
    const maxExpansionByRatio = Math.max(
        MIN_EXPANSION_ALLOWANCE_LOC,
        Math.floor(originalLineCount * MAX_EXPANSION_LOC_RATIO),
    );
    const remainingBudget = Math.max(0, fileLocBudget - originalLineCount);
    const additionUpperBound = isNewFile
        ? Math.min(fileLocBudget, newFileCeiling)
        : hasRefactorWitness
          ? Math.min(remainingBudget, addCommitCeiling)
          : Math.min(addCommitCeiling, Math.min(remainingBudget, maxExpansionByRatio));
    const additionLowerBound = 0;

    // 3. Deletion envelope bounds (clamped to witnessed refactor or plain single-file ceiling)
    const deletionLowerBound = 0;
    const isWitnessedDeletion = Boolean(
        params.hasEquivalentExtraction || params.isFormalRetirement,
    );
    const deletionUpperBound = isNewFile
        ? 0
        : isWitnessedDeletion
          ? MAX_COMMIT_FILE_DEL_WITNESSED_5D_ELOC
          : Math.min(
                MAX_COMMIT_FILE_DEL_5D_ELOC,
                Math.max(
                    MIN_DELETION_ALLOWANCE_LOC,
                    Math.floor(originalLineCount * MAX_DELETION_FRACTION_EROSION),
                ),
            );

    return {
        addMin: additionLowerBound,
        addMax: additionUpperBound,
        delMin: deletionLowerBound,
        delMax: deletionUpperBound,
        usefulAddedLines,
        usefulDeletedLines,
        eloc5dAdd,
        eloc5dDel,
        tsprAdded,
        semanticDensity,
    };
}

/**
 * Computes pure weighted ELOC additions, deletions, and net turnover for a file change.
 *
 * Excludes cosmetic comments, blanks, boilerplate passes, and relocated lines,
 * scaling additions by token semantic payload ratio (TSPR).
 *
 * @param params - File differential parameters.
 * @returns Decomposed weighted ELOC delta metrics.
 */
export function compute5dElocDelta(params: DifferentialBoundsParams): File5dElocDelta {
    const bounds = computeEnvelopeBounds(params);
    const rawTurnover = bounds.eloc5dAdd + bounds.eloc5dDel * DELETION_TURNOVER_WEIGHT;
    const net5dTurnover =
        Math.round(rawTurnover * DECIMAL_ROUNDING_FACTOR_HUNDREDTH) /
        DECIMAL_ROUNDING_FACTOR_HUNDREDTH;

    return {
        filePath: params.filePath,
        eloc5dAdd: bounds.eloc5dAdd,
        eloc5dDel: bounds.eloc5dDel,
        net5dTurnover,
        rawAdd: params.addedLines.length,
        rawDel: params.deletedLines.length,
        usefulAdded: bounds.usefulAddedLines,
        usefulDeleted: bounds.usefulDeletedLines,
        tsprAdded: bounds.tsprAdded,
        semanticDensity: bounds.semanticDensity,
    };
}

interface ViolationCheckResult {
    readonly verdictCode: DifferentialVerdictCode;
    readonly reason: string;
}

/**
 * Checks for addition inflation violations.
 *
 * @param addedLineCount - Count of added lines.
 * @param bounds - Computed envelope bounds.
 * @returns Violation detail if inflation detected, undefined otherwise.
 */
function checkAdditionInflation(
    addedLineCount: number,
    bounds: DifferentialEnvelopeBounds,
): ViolationCheckResult | undefined {
    if (addedLineCount < INFLATION_SAMPLE_LINE_THRESHOLD) {
        return undefined;
    }
    if (bounds.tsprAdded < MIN_TSPR_ADDED_THRESHOLD) {
        return {
            verdictCode: VERDICT_BLOCK_GAMING_INFLATION,
            reason:
                `Addition token semantic payload ratio TSPR (${bounds.tsprAdded.toFixed(3)}) is below ` +
                `the required minimum threshold (${MIN_TSPR_ADDED_THRESHOLD.toFixed(3)}) across ${addedLineCount} added lines.`,
        };
    }
    const substantiveTarget =
        bounds.tsprAdded >= TSPR_VOUCH_FOR_DENSITY
            ? MIN_SEMANTIC_LINE_FLOOR
            : MIN_SEMANTIC_LINE_DENSITY;
    if (bounds.semanticDensity < substantiveTarget) {
        return {
            verdictCode: VERDICT_BLOCK_GAMING_INFLATION,
            reason:
                `Addition substantive line density (${bounds.semanticDensity.toFixed(3)}) is below ` +
                `the required minimum threshold (${substantiveTarget.toFixed(3)}) with ${bounds.usefulAddedLines}/${addedLineCount} substantive lines.`,
        };
    }
    if (bounds.eloc5dAdd > bounds.addMax) {
        return {
            verdictCode: VERDICT_BLOCK_FILE_ADD_OVERFLOW,
            reason:
                `Addition weighted ELOC volume (${bounds.eloc5dAdd.toFixed(1)} lines) exceeds the single-file expansion envelope ` +
                `(${bounds.addMax} lines). Modularize into smaller decoupled components before integrating.`,
        };
    }
    return undefined;
}

/**
 * Checks for capability erosion deletion violations.
 *
 * @param deletedLineCount - Count of deleted lines.
 * @param bounds - Computed envelope bounds.
 * @param params - Differential bounds evaluation parameters.
 * @returns Violation detail if erosion detected, undefined otherwise.
 */
function checkCapabilityErosion(
    deletedLineCount: number,
    bounds: DifferentialEnvelopeBounds,
    params: DifferentialBoundsParams,
): ViolationCheckResult | undefined {
    if (bounds.eloc5dDel <= bounds.delMax) {
        return undefined;
    }
    const isWitnessed = Boolean(params.hasEquivalentExtraction || params.isFormalRetirement);
    if (isWitnessed && bounds.eloc5dDel <= MAX_COMMIT_FILE_DEL_WITNESSED_5D_ELOC) {
        return undefined;
    }
    return {
        verdictCode: VERDICT_BLOCK_FILE_DEL_OVERFLOW,
        reason:
            `Deletion weighted ELOC volume (${bounds.eloc5dDel} lines) exceeds safe single-file erosion ceiling ` +
            `(${bounds.delMax} lines)${isWitnessed ? '' : ' without verified equivalent module extraction or formal retirement'}.`,
    };
}

/**
 * Evaluates full differential semantic bounds for a single file change.
 *
 * @param params - Change parameters including old/new content and diff lines.
 * @returns Verdict indicating whether change satisfies bounds envelopes.
 */
export function evaluateDifferentialBounds(
    params: DifferentialBoundsParams,
): DifferentialBoundsVerdict {
    const bounds = computeEnvelopeBounds(params);
    const addedLineCount = params.addedLines.length;
    const deletedLineCount = params.deletedLines.length;

    const inflationViolation = checkAdditionInflation(addedLineCount, bounds);
    if (inflationViolation) {
        return {
            isAllowed: false,
            verdictCode: inflationViolation.verdictCode,
            bounds,
            reason: inflationViolation.reason,
        };
    }

    const erosionViolation = checkCapabilityErosion(deletedLineCount, bounds, params);
    if (erosionViolation) {
        return {
            isAllowed: false,
            verdictCode: erosionViolation.verdictCode,
            bounds,
            reason: erosionViolation.reason,
        };
    }

    return {
        isAllowed: true,
        verdictCode: VERDICT_ADMITTED,
        bounds,
    };
}

/**
 * Computes Net Semantic Turnover (Δ_net) from decomposed ELOC components.
 *
 * @param params - Turnover parameters.
 * @returns Computed net turnover and ratio.
 */
export function computeNetSemanticTurnover(params: NetTurnoverParams): NetTurnoverResult {
    const {
        semanticAddedEloc,
        semanticDeletedEloc,
        relocatedEloc,
        cosmeticEloc,
        physicalAddedLines,
        physicalDeletedLines,
    } = params;

    const rawNetTurnover = semanticAddedEloc + semanticDeletedEloc - relocatedEloc - cosmeticEloc;
    const netSemanticTurnover = Math.max(
        0,
        Math.round(rawNetTurnover * DECIMAL_ROUNDING_FACTOR_HUNDREDTH) /
            DECIMAL_ROUNDING_FACTOR_HUNDREDTH,
    );

    const totalPhysicalLines = physicalAddedLines + physicalDeletedLines;
    const turnoverRatio =
        totalPhysicalLines > 0
            ? Math.round(
                  safeDivide(netSemanticTurnover, totalPhysicalLines) *
                      DECIMAL_ROUNDING_FACTOR_THOUSANDTH,
              ) / DECIMAL_ROUNDING_FACTOR_THOUSANDTH
            : 1.0;

    const effectiveTurnoverScore =
        Math.round(netSemanticTurnover * turnoverRatio * DECIMAL_ROUNDING_FACTOR_HUNDREDTH) /
        DECIMAL_ROUNDING_FACTOR_HUNDREDTH;

    return {
        netSemanticTurnover,
        turnoverRatio,
        effectiveTurnoverScore,
    };
}

/**
 * Derives dynamic empirical admission threshold without arbitrary hardcoded values.
 *
 * Formula:
 * Θ_admission = max(Θ_floor, (μ_W - 0.5 * σ_W) * (1 - Noise / Noise_max) * P_succ)
 *
 * @param params - Historical run points and current slice complexity metrics.
 * @returns Computed admission threshold and constituent statistical factors.
 */
export function calculateEmpiricalAdmissionThreshold(
    params: EmpiricalAdmissionThresholdParams,
): DynamicAdmissionThresholdResult {
    const windowSize = params.windowSize ?? DEFAULT_TRAJECTORY_WINDOW_SIZE;
    const sliceRuns = params.recentRuns.slice(-windowSize);

    if (sliceRuns.length === 0) {
        return {
            threshold: ADMISSION_TURNOVER_FLOOR,
            rollingMean: ADMISSION_TURNOVER_FLOOR,
            rollingStdDev: 0,
            noiseFactor: 0,
            posteriorConfidence: 1.0,
            sampleCount: 0,
        };
    }

    const turnoverValues = sliceRuns.map((runPoint) => runPoint.netSemanticTurnover);
    const moments: StatisticalMoments = computeStatisticalMoments(turnoverValues);

    let passCount = 0;
    for (let runIndex = 0; runIndex < sliceRuns.length; runIndex++) {
        if (sliceRuns[runIndex].gatePassed) {
            passCount++;
        }
    }

    // Bayesian Jeffreys Beta(0.5, 0.5) posterior success rate
    const posteriorConfidence = safeDivide(
        passCount + JEFFREYS_PRIOR_ALPHA,
        sliceRuns.length + JEFFREYS_PRIOR_ALPHA + JEFFREYS_PRIOR_BETA,
        JEFFREYS_DEFAULT_POSTERIOR,
    );

    // Code noise penalty: Noise = CC / max(1, ELOC)
    const measuredNoise = safeDivide(params.currentComplexity, Math.max(1, params.currentEloc));
    const boundedNoise = clampRange(measuredNoise, 0, MAX_NOISE_CEILING);
    const noiseFactor = safeDivide(boundedNoise, MAX_NOISE_CEILING);

    // Derive threshold clamped to SSOT [floor, cap], holding cold-start floor under 3 samples
    const discountStandardDeviation =
        STANDARD_DEVIATION_DISCOUNT_FACTOR * moments.standardDeviation;
    const statisticalCenter = Math.max(0, moments.mean - discountStandardDeviation);
    const calibratedThreshold = statisticalCenter * (1.0 - noiseFactor) * posteriorConfidence;
    const boundedThreshold =
        sliceRuns.length < MIN_TRAJECTORY_SAMPLES
            ? ADMISSION_TURNOVER_FLOOR
            : clampRange(calibratedThreshold, ADMISSION_TURNOVER_FLOOR, ADMISSION_TURNOVER_CAP);
    const threshold =
        Math.round(boundedThreshold * DECIMAL_ROUNDING_FACTOR_HUNDREDTH) /
        DECIMAL_ROUNDING_FACTOR_HUNDREDTH;

    return {
        threshold,
        rollingMean: moments.mean,
        rollingStdDev: moments.standardDeviation,
        noiseFactor:
            Math.round(noiseFactor * DECIMAL_ROUNDING_FACTOR_THOUSANDTH) /
            DECIMAL_ROUNDING_FACTOR_THOUSANDTH,
        posteriorConfidence:
            Math.round(posteriorConfidence * DECIMAL_ROUNDING_FACTOR_THOUSANDTH) /
            DECIMAL_ROUNDING_FACTOR_THOUSANDTH,
        sampleCount: sliceRuns.length,
    };
}

/**
 * Resolves dual ledger paths compatible with both auto-refactor and Taxis git telemetry stores.
 *
 * @param workspaceRoot - Workspace root directory override.
 * @returns Ordered list of candidate NDJSON ledger file paths.
 */
export function resolveAdmissionLedgerPaths(workspaceRoot?: string): readonly string[] {
    const root = workspaceRoot ?? process.cwd();
    return [
        path.join(root, DIFF_BOUNDS_CONTRACT.ledgers.autoRefactorRelative),
        path.join(root, DIFF_BOUNDS_CONTRACT.ledgers.taxisRelative),
        path.join(root, DIFF_BOUNDS_CONTRACT.ledgers.taxisLegacyRelative),
    ];
}

interface AdmissionLedgerPoint {
    timestamp?: number;
    netSemanticTurnover?: number;
    turnover?: number;
    gatePassed?: boolean;
    passed?: boolean;
    verdict?: string;
}

/** Resolves explicit admission results before deriving a result from the contract floor. */
function resolveTrajectoryGatePassed(parsed: AdmissionLedgerPoint, turnover: number): boolean {
    if (typeof parsed.gatePassed === 'boolean') return parsed.gatePassed;
    if (typeof parsed.passed === 'boolean') return parsed.passed;
    if (typeof parsed.verdict === 'string') return parsed.verdict === VERDICT_ADMITTED;
    return turnover >= ADMISSION_TURNOVER_FLOOR;
}

/** Normalizes one ledger row; malformed or nonnumeric observations cannot enter calibration. */
function parseAdmissionTrajectoryPoint(line: string): TrajectoryRunPoint | null {
    try {
        const parsed = JSON.parse(line) as AdmissionLedgerPoint | null;
        if (parsed === null || typeof parsed !== 'object') return null;
        const turnover =
            typeof parsed.netSemanticTurnover === 'number'
                ? parsed.netSemanticTurnover
                : parsed.turnover;
        if (typeof turnover !== 'number' || !Number.isFinite(turnover)) return null;
        return {
            timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : 0,
            netSemanticTurnover: turnover,
            gatePassed: resolveTrajectoryGatePassed(parsed, turnover),
        };
    } catch {
        return null;
    }
}

function readAdmissionLedgerPointsFromFile(ledgerPath: string, points: TrajectoryRunPoint[]): void {
    if (!fs.existsSync(ledgerPath)) return;
    try {
        const raw = readUtf8Sync(ledgerPath, 'utf8');
        const lines = raw.split(/\r?\n/);
        for (let lIdx = 0; lIdx < lines.length; lIdx++) {
            const trimmed = lines[lIdx].trim();
            if (!trimmed) continue;
            const point = parseAdmissionTrajectoryPoint(trimmed);
            if (point !== null) points.push(point);
        }
    } catch {
        // Ignore unreadable ledger file
    }
}

/**
 * Synchronously reads historical trajectory samples across dual admission ledgers.
 *
 * @param workspaceRoot - Workspace root directory override.
 * @param windowSize - Maximum trailing records to retain.
 * @returns Normalized trajectory points ready for Jeffreys admission calibration.
 */
export function loadAdmissionTrajectoryPoints(
    workspaceRoot?: string,
    windowSize: number = DEFAULT_TRAJECTORY_WINDOW_SIZE,
): TrajectoryRunPoint[] {
    const ledgerPaths = resolveAdmissionLedgerPaths(workspaceRoot);
    const points: TrajectoryRunPoint[] = [];
    for (let pIdx = 0; pIdx < ledgerPaths.length; pIdx++) {
        readAdmissionLedgerPointsFromFile(ledgerPaths[pIdx], points);
    }
    return points.slice(-windowSize);
}

/**
 * Asynchronously appends an admission audit record to the local NDJSON ledger.
 *
 * @param record - Structured audit record to append.
 * @param workspaceRoot - Optional workspace root path override.
 */
export async function appendAdmissionAuditRecord(
    record: AdmissionAuditRecord,
    workspaceRoot?: string,
): Promise<void> {
    try {
        const root = workspaceRoot ?? process.cwd();
        const cacheDir = path.join(root, CACHE_DIRECTORY_NAME);
        await fs.promises.mkdir(cacheDir, { recursive: true });

        const ledgerPath = path.join(cacheDir, ADMISSION_LEDGER_FILENAME);
        const line = `${JSON.stringify(record)}\n`;
        await fs.promises.appendFile(ledgerPath, line, 'utf8');
    } catch (appendError) {
        // Fail-safe: do not crash gate evaluation if audit log write fails
        void appendError;
    }
}

export * from './diff-bounds-batch';
