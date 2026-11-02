/**
 * Module: Core Scoring — Differential Semantic Bounds & Admission Governor
 * File Path: src/core/scoring/diff-bounds-governor.ts
 * Architecture Role: Evaluates differential semantic bounding envelopes ([L_add_min, L_add_max]
 *   and [L_del_min, L_del_max]), computes empirical Net Semantic Turnover (Δ_net), derives
 *   dynamic non-hardcoded admission thresholds (Θ_admission), and maintains audit ledger persistence.
 * Dependencies & Triggers: Consumes semantic-delta-classifier, payload-density, token-entropy,
 *   descriptive-statistics, and numerical-corridor; invoked by anti-gaming engines and gate runners.
 * Responsibilities:
 *   1. Enforce differential bounds preventing addition inflation and defensive capability erosion;
 *   2. Compute objective Net Semantic Turnover subtracting cosmetic and relocated churn;
 *   3. Calculate empirical admission thresholds via trajectory sliding-window moments and Jeffreys Beta;
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

/** Minimum token semantic payload ratio required for substantive code additions. */
export const MIN_TSPR_ADDED_THRESHOLD = 0.40;

/** Minimum ratio of useful semantic lines to total additions before inflation is flagged. */
export const MIN_SEMANTIC_LINE_DENSITY = 0.60;

/** Minimum additions count before inflation heuristics begin strictly enforcing density. */
export const INFLATION_SAMPLE_LINE_THRESHOLD = 15;

/** Maximum fraction of an existing file's LOC that may be deleted without equivalent compensation. */
export const MAX_DELETION_FRACTION_EROSION = 0.40;

/** Absolute default ceiling for effective LOC budget per single file. */
export const DEFAULT_FILE_LOC_BUDGET = 900;

/** Minimum LOC allowance below which expansion upper bounds are relaxed for small modules. */
export const MIN_EXPANSION_ALLOWANCE_LOC = 60;

/** Maximum expansion fraction of current LOC allowed in a single un-decoupled atomic change. */
export const MAX_EXPANSION_LOC_RATIO = 0.35;

/** Mathematical floor for minimum admission turnover (based on AST block minimum depth). */
export const ADMISSION_TURNOVER_FLOOR = 3.0;

/** Maximum acceptable noise index (CC / ELOC) before full noise damping is applied. */
export const MAX_NOISE_CEILING = 4.0;

/** Default sliding window size for historical trajectory sampling. */
export const DEFAULT_TRAJECTORY_WINDOW_SIZE = 20;

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

/** Canonical verdict status for differential bounds checks. */
export type DifferentialVerdictCode =
    | typeof VERDICT_ADMITTED
    | typeof VERDICT_BLOCKED_INSUFFICIENT_TURNOVER
    | typeof VERDICT_BLOCK_GAMING_INFLATION
    | typeof VERDICT_BLOCK_CAPABILITY_EROSION;

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
export function computeAddedLinesTspr(addedLines: readonly string[], language = 'typescript'): number {
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
 * Counts useful lines among additions by excluding cosmetic comments, blanks, and boilerplate.
 *
 * @param addedLines - Newly added line strings.
 * @returns Count of useful substantive lines.
 */
export function countUsefulAddedLines(addedLines: readonly string[]): number {
    let useful = 0;
    for (let i = 0; i < addedLines.length; i++) {
        const line = addedLines[i];
        if (isCosmeticDiffLine(line) || isBoilerplateDiffLine(line)) {
            continue;
        }
        useful++;
    }
    return useful;
}

/**
 * Computes upper and lower bounding envelopes for file modification.
 *
 * @param params - Differential bounds evaluation parameters.
 * @returns Derived envelope limits and measured payload attributes.
 */
export function computeEnvelopeBounds(params: DifferentialBoundsParams): DifferentialEnvelopeBounds {
    const oldLoc = params.oldContent.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
    const locBudget = params.fileLocBudget ?? DEFAULT_FILE_LOC_BUDGET;

    // 1. Addition envelope bounds
    const maxExpansionByRatio = Math.max(MIN_EXPANSION_ALLOWANCE_LOC, Math.floor(oldLoc * MAX_EXPANSION_LOC_RATIO));
    const maxExpansionByBudget = Math.max(0, locBudget - oldLoc);
    const addMax = Math.max(MIN_EXPANSION_ALLOWANCE_LOC, Math.min(maxExpansionByBudget, maxExpansionByRatio));
    const addMin = 0;

    // 2. Addition payload density measurements
    const usefulAdded = countUsefulAddedLines(params.addedLines);
    const tsprAdded = computeAddedLinesTspr(params.addedLines, params.language);
    const semanticDensity = params.addedLines.length > 0
        ? safeDivide(usefulAdded, params.addedLines.length)
        : 1.0;

    // 3. Deletion envelope bounds
    const delMin = 0;
    const delMax = Math.max(10, Math.floor(oldLoc * MAX_DELETION_FRACTION_EROSION));

    return {
        addMin,
        addMax,
        delMin,
        delMax,
        usefulAddedLines: usefulAdded,
        tsprAdded,
        semanticDensity,
    };
}

/**
 * Checks for addition inflation violations.
 *
 * @param lAdd - Count of added lines.
 * @param bounds - Computed envelope bounds.
 * @returns Violation reason if inflation detected, undefined otherwise.
 */
function checkAdditionInflation(lAdd: number, bounds: DifferentialEnvelopeBounds): string | undefined {
    if (lAdd <= INFLATION_SAMPLE_LINE_THRESHOLD) {
        return undefined;
    }
    if (bounds.tsprAdded < MIN_TSPR_ADDED_THRESHOLD) {
        return (
            `Addition semantic payload ratio TSPR (${bounds.tsprAdded.toFixed(3)}) is below ` +
            `required minimum (${MIN_TSPR_ADDED_THRESHOLD}) across ${lAdd} added lines.`
        );
    }
    if (bounds.semanticDensity < MIN_SEMANTIC_LINE_DENSITY) {
        return (
            `Addition semantic line density (${bounds.semanticDensity.toFixed(3)}) is below ` +
            `required minimum (${MIN_SEMANTIC_LINE_DENSITY}) with ${bounds.usefulAddedLines}/${lAdd} useful lines.`
        );
    }
    if (lAdd > bounds.addMax) {
        return (
            `Addition volume (${lAdd} lines) exceeds maximum single-module expansion envelope ` +
            `(${bounds.addMax} lines). Extract independent sub-modules first.`
        );
    }
    return undefined;
}

/**
 * Checks for capability erosion deletion violations.
 *
 * @param lDel - Count of deleted lines.
 * @param bounds - Computed envelope bounds.
 * @param params - Differential bounds evaluation parameters.
 * @returns Violation reason if erosion detected, undefined otherwise.
 */
function checkCapabilityErosion(
    lDel: number,
    bounds: DifferentialEnvelopeBounds,
    params: DifferentialBoundsParams,
): string | undefined {
    if (lDel <= bounds.delMax) {
        return undefined;
    }
    if (params.hasEquivalentExtraction || params.isFormalRetirement) {
        return undefined;
    }
    return (
        `Deletion volume (${lDel} lines) exceeds safe single-file erosion ceiling ` +
        `(${bounds.delMax} lines) without verified equivalent module extraction or formal retirement.`
    );
}

/**
 * Evaluates full differential semantic bounds for a single file change.
 *
 * @param params - Change parameters including old/new content and diff lines.
 * @returns Verdict indicating whether change satisfies bounds envelopes.
 */
export function evaluateDifferentialBounds(params: DifferentialBoundsParams): DifferentialBoundsVerdict {
    const bounds = computeEnvelopeBounds(params);
    const lAdd = params.addedLines.length;
    const lDel = params.deletedLines.length;

    const inflationReason = checkAdditionInflation(lAdd, bounds);
    if (inflationReason) {
        return {
            isAllowed: false,
            verdictCode: VERDICT_BLOCK_GAMING_INFLATION,
            bounds,
            reason: inflationReason,
        };
    }

    const erosionReason = checkCapabilityErosion(lDel, bounds, params);
    if (erosionReason) {
        return {
            isAllowed: false,
            verdictCode: VERDICT_BLOCK_CAPABILITY_EROSION,
            bounds,
            reason: erosionReason,
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

    const rawNet = semanticAddedEloc + semanticDeletedEloc - relocatedEloc - cosmeticEloc;
    const netSemanticTurnover = Math.max(0, Math.round(rawNet * 100) / 100);

    const totalPhysical = physicalAddedLines + physicalDeletedLines;
    const turnoverRatio = totalPhysical > 0
        ? Math.round(safeDivide(netSemanticTurnover, totalPhysical) * 1000) / 1000
        : 1.0;

    const effectiveTurnoverScore = Math.round(netSemanticTurnover * turnoverRatio * 100) / 100;

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

    const turnoverValues = sliceRuns.map((r) => r.netSemanticTurnover);
    const moments: StatisticalMoments = computeStatisticalMoments(turnoverValues);

    let passCount = 0;
    for (let i = 0; i < sliceRuns.length; i++) {
        if (sliceRuns[i].gatePassed) {
            passCount++;
        }
    }

    // Bayesian Jeffreys Beta(0.5, 0.5) posterior success rate
    const alpha0 = 0.5;
    const beta0 = 0.5;
    const posteriorConfidence = safeDivide(
        passCount + alpha0,
        sliceRuns.length + alpha0 + beta0,
        0.5,
    );

    // Code noise penalty: Noise = CC / max(1, ELOC)
    const measuredNoise = safeDivide(params.currentComplexity, Math.max(1, params.currentEloc));
    const boundedNoise = clampRange(measuredNoise, 0, MAX_NOISE_CEILING);
    const noiseFactor = safeDivide(boundedNoise, MAX_NOISE_CEILING);

    // Dynamic threshold derivation
    const statisticalCenter = Math.max(0, moments.mean - 0.5 * moments.standardDeviation);
    const calibratedValue = statisticalCenter * (1.0 - noiseFactor) * posteriorConfidence;
    const threshold = Math.round(Math.max(ADMISSION_TURNOVER_FLOOR, calibratedValue) * 100) / 100;

    return {
        threshold,
        rollingMean: moments.mean,
        rollingStdDev: moments.standardDeviation,
        noiseFactor: Math.round(noiseFactor * 1000) / 1000,
        posteriorConfidence: Math.round(posteriorConfidence * 1000) / 1000,
        sampleCount: sliceRuns.length,
    };
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
