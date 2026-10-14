/**
 * Module: Core Telemetry — LCOV Coverage Ingestion & Dynamic Feedback
 * File Path: src/core/telemetry/lcov-ingester.ts
 * Architecture Role: Ingests CI/test coverage reports (LCOV format), calculates line- and
 *   branch-level coverage profiles, and provides dynamic dampening/amplification factors K_cov
 *   for the risk fusion engine and complexity analyzers.
 * Dependencies & Triggers: Consumed by risk-fusion-engine and scan orchestration pipelines.
 * Responsibilities:
 *   1. Parse standard LCOV coverage strings into structured per-file coverage profiles.
 *   2. Support resilient path matching across POSIX, Windows, and relative repository structures.
 *   3. Compute test coverage damping multiplier K_cov:
 *      - K_cov = 0.5 for well-tested modules (line >= 90%, branch >= 80%).
 *      - K_cov = 1.0 for moderate coverage (40% - 90%).
 *      - K_cov = 1.8 for uncovered naked complexity (< 20% or un-executed target line).
 *   4. Convert coverage telemetry into DynamicIssueRisk for cross-plane dual-confirmation.
 * Exit Semantics & Design Rationale: Non-throwing parse; resilient empty profile on invalid input.
 */

import type { DynamicIssueRisk } from '../dynamic/dynamic-types';

const ASCII_LF = 10;
const ASCII_CR = 13;
const ASCII_SPACE = 32;
const ASCII_COMMA = 44;
const ASCII_SLASH = 47;
const ASCII_ZERO = 48;
const ASCII_NINE = 57;
const ASCII_UPPER_B = 66;
const ASCII_UPPER_D = 68;
const ASCII_UPPER_F = 70;
const ASCII_UPPER_H = 72;
const ASCII_UPPER_L = 76;
const ASCII_UPPER_S = 83;
const ASCII_BACKSLASH = 92;
const ASCII_LOWER_E = 101;

const DECIMAL_BASE = 10;
const PERCENT_FACTOR = 100;
const RATIO_PRECISION_DIGITS = 3;

const LCOV_PREFIX_LEN_DA = 3;
const LCOV_PREFIX_LEN_SF = 3;
const LCOV_PREFIX_LEN_LINE = 3;
const LCOV_PREFIX_LEN_BRANCH = 4;

const MULTIPLIER_NEUTRAL = 1.0;
const MULTIPLIER_HIGH_RISK = 1.8;
const MULTIPLIER_WELL_COVERED = 0.5;

const COVERAGE_LOW_THRESHOLD = 0.2;
const COVERAGE_LINE_HIGH_THRESHOLD = 0.9;
const COVERAGE_BRANCH_HIGH_THRESHOLD = 0.8;

const STATUS_WELL_COVERED: CoverageStatus = 'well_covered';
const STATUS_MODERATE_COVERAGE: CoverageStatus = 'moderate_coverage';
const STATUS_UNCOVERED_HIGH_RISK: CoverageStatus = 'uncovered_high_risk';
const STATUS_UNMONITORED: CoverageStatus = 'unmonitored';

const RISK_RAW_HIGH = 7.5;
const RISK_NORMALIZED_HIGH = 6.5;
const RISK_RAW_LOW = 0.5;
const RISK_NORMALIZED_LOW = 0.3;
const RISK_RAW_NEUTRAL = 1.0;
const RISK_NORMALIZED_NEUTRAL = 1.0;

const CONFIDENCE_HIGH_RISK = 0.9;
const CONFIDENCE_WELL_COVERED = 0.95;
const CONFIDENCE_NEUTRAL = 0.5;

/**
 * Normalized line and branch test coverage profile for an individual source file.
 */
export interface FileCoverageProfile {
    filePath: string;
    linesFound: number;
    linesHit: number;
    lineCoverageRatio: number; // [0.0, 1.0]
    branchesFound: number;
    branchesHit: number;
    branchCoverageRatio: number; // [0.0, 1.0]
    lineHits: Map<number, number>;
}

/** Qualitative evaluation status of test coverage health for an inspected location. */
export type CoverageStatus =
    'well_covered' | 'moderate_coverage' | 'uncovered_high_risk' | 'unmonitored';

/**
 * Result of coverage risk damping computation indicating multiplier and rationale.
 */
export interface CoverageDampingResult {
    filePath: string;
    line?: number;
    dampingMultiplier: number; // K_cov
    status: CoverageStatus;
    lineHitCount?: number;
    rationale: string;
}

/** Internal parser state tracking an in-flight file record. */
interface LcovParserState {
    currentPath: string | null;
    linesFound: number;
    linesHit: number;
    branchesFound: number;
    branchesHit: number;
    lineHits: Map<number, number>;
}

/**
 * Fast zero-allocation DA record parser using integer cursor traversal.
 * Parses 'DA:<lineNo>,<hitCount>' without creating any substring allocations.
 */
function parseDaCursor(
    text: string,
    start: number,
    end: number,
    lineHits: Map<number, number>,
): void {
    let cursor = start + LCOV_PREFIX_LEN_DA;
    let lineNo = 0;
    while (cursor < end) {
        const charCode = text.charCodeAt(cursor);
        if (charCode === ASCII_COMMA) {
            break;
        }
        if (charCode >= ASCII_ZERO && charCode <= ASCII_NINE) {
            lineNo = lineNo * DECIMAL_BASE + (charCode - ASCII_ZERO);
        }
        cursor++;
    }
    if (cursor >= end || text.charCodeAt(cursor) !== ASCII_COMMA) {
        return;
    }
    cursor++;
    let hitCount = 0;
    while (cursor < end) {
        const charCode = text.charCodeAt(cursor);
        if (charCode >= ASCII_ZERO && charCode <= ASCII_NINE) {
            hitCount = hitCount * DECIMAL_BASE + (charCode - ASCII_ZERO);
        }
        cursor++;
    }
    lineHits.set(lineNo, hitCount);
}

/**
 * Fast zero-allocation integer parser from an integer cursor slice [start, end).
 */
function parseIntegerCursor(text: string, start: number, end: number): number {
    let parsedValue = 0;
    for (let cursor = start; cursor < end; cursor++) {
        const charCode = text.charCodeAt(cursor);
        if (charCode >= ASCII_ZERO && charCode <= ASCII_NINE) {
            parsedValue = parsedValue * DECIMAL_BASE + (charCode - ASCII_ZERO);
        }
    }
    return parsedValue;
}

function handleSfRecord(
    lcovText: string,
    start: number,
    end: number,
    state: LcovParserState,
): void {
    let sfStart = start + LCOV_PREFIX_LEN_SF;
    while (sfStart < end && lcovText.charCodeAt(sfStart) <= ASCII_SPACE) {
        sfStart++;
    }
    state.currentPath = lcovText.slice(sfStart, end);
    state.linesFound = 0;
    state.linesHit = 0;
    state.branchesFound = 0;
    state.branchesHit = 0;
    state.lineHits = new Map<number, number>();
}

function handleLineRecord(
    lcovText: string,
    start: number,
    end: number,
    state: LcovParserState,
): void {
    const subTypeChar = lcovText.charCodeAt(start + 1);
    if (subTypeChar === ASCII_UPPER_F) {
        state.linesFound = parseIntegerCursor(lcovText, start + LCOV_PREFIX_LEN_LINE, end);
    } else if (subTypeChar === ASCII_UPPER_H) {
        state.linesHit = parseIntegerCursor(lcovText, start + LCOV_PREFIX_LEN_LINE, end);
    }
}

function handleBranchRecord(
    lcovText: string,
    start: number,
    end: number,
    state: LcovParserState,
): void {
    const branchSubTypeChar = lcovText.charCodeAt(start + 2);
    if (branchSubTypeChar === ASCII_UPPER_F) {
        state.branchesFound = parseIntegerCursor(lcovText, start + LCOV_PREFIX_LEN_BRANCH, end);
    } else if (branchSubTypeChar === ASCII_UPPER_H) {
        state.branchesHit = parseIntegerCursor(lcovText, start + LCOV_PREFIX_LEN_BRANCH, end);
    }
}

/**
 * Compute ratios and insert coverage profile into destination map.
 */
function recordProfile(state: LcovParserState, resultMap: Map<string, FileCoverageProfile>): void {
    if (!state.currentPath) return;
    const normalizedPath = state.currentPath.replace(/\\/g, '/');
    let activeHits = 0;
    for (const count of state.lineHits.values()) {
        if (count > 0) activeHits++;
    }

    const effectiveFound = Math.max(state.linesFound, state.lineHits.size);
    const effectiveHit = state.linesHit > 0 ? state.linesHit : activeHits;
    const lineRatio =
        effectiveFound > 0 ? +(effectiveHit / effectiveFound).toFixed(RATIO_PRECISION_DIGITS) : 0.0;
    const branchRatio =
        state.branchesFound > 0
            ? +(state.branchesHit / state.branchesFound).toFixed(RATIO_PRECISION_DIGITS)
            : 1.0;

    resultMap.set(normalizedPath, {
        filePath: normalizedPath,
        linesFound: effectiveFound,
        linesHit: effectiveHit,
        lineCoverageRatio: lineRatio,
        branchesFound: state.branchesFound,
        branchesHit: state.branchesHit,
        branchCoverageRatio: branchRatio,
        lineHits: state.lineHits,
    });
}

function handleEndOfRecord(
    state: LcovParserState,
    resultMap: Map<string, FileCoverageProfile>,
): void {
    if (state.currentPath) {
        recordProfile(state, resultMap);
    }
    state.currentPath = null;
}

/**
 * Fast zero-allocation line break search using integer cursor traversal.
 */
function findNextLineBreak(text: string, pos: number, textLen: number): number {
    for (let i = pos; i < textLen; i++) {
        if (text.charCodeAt(i) === ASCII_LF) {
            return i;
        }
    }
    return textLen;
}

/**
 * Fast zero-allocation path basename extractor without lastIndexOf.
 */
function fastBasename(filePath: string): string {
    for (let i = filePath.length - 1; i >= 0; i--) {
        const charCode = filePath.charCodeAt(i);
        if (charCode === ASCII_SLASH || charCode === ASCII_BACKSLASH) {
            return filePath.slice(i + 1);
        }
    }
    return filePath;
}

interface RecordProcessingContext {
    state: LcovParserState;
    resultMap: Map<string, FileCoverageProfile>;
}

/**
 * Dispatches an in-flight LCOV record delimited by [start, end) into parser state.
 */
function processRecordCursor(
    lcovText: string,
    start: number,
    end: number,
    ctx: RecordProcessingContext,
): void {
    switch (lcovText.charCodeAt(start)) {
        case ASCII_UPPER_D:
            parseDaCursor(lcovText, start, end, ctx.state.lineHits);
            break;
        case ASCII_UPPER_S:
            handleSfRecord(lcovText, start, end, ctx.state);
            break;
        case ASCII_UPPER_L:
            handleLineRecord(lcovText, start, end, ctx.state);
            break;
        case ASCII_UPPER_B:
            handleBranchRecord(lcovText, start, end, ctx.state);
            break;
        case ASCII_LOWER_E:
            handleEndOfRecord(ctx.state, ctx.resultMap);
            break;
    }
}

/**
 * Stream-oriented parser and evaluator for LCOV code coverage telemetry reports.
 */
export class LcovIngester {
    private readonly basenameCache = new WeakMap<
        Map<string, FileCoverageProfile>,
        Map<string, FileCoverageProfile>
    >();

    /**
     * Parse raw LCOV text stream into a normalized map of FileCoverageProfile.
     * Uses zero-allocation streaming line cursors to prevent large memory spikes.
     *
     * @param lcovText - Raw string content of LCOV report.
     * @returns Map of normalized file paths to their FileCoverageProfile.
     */
    public parse(lcovText: string): Map<string, FileCoverageProfile> {
        return this.parseLcov(lcovText);
    }

    public parseLcov(lcovText: string): Map<string, FileCoverageProfile> {
        const resultMap = new Map<string, FileCoverageProfile>();
        if (!lcovText || typeof lcovText !== 'string') {
            return resultMap;
        }

        const state: LcovParserState = {
            currentPath: null,
            linesFound: 0,
            linesHit: 0,
            branchesFound: 0,
            branchesHit: 0,
            lineHits: new Map<number, number>(),
        };

        const processingCtx: RecordProcessingContext = { state, resultMap };
        let pos = 0;
        const textLen = lcovText.length;

        while (pos < textLen) {
            const nextNewline = findNextLineBreak(lcovText, pos, textLen);
            let endPos = nextNewline;
            if (endPos > pos && lcovText.charCodeAt(endPos - 1) === ASCII_CR) {
                endPos--;
            }

            let start = pos;
            while (start < endPos && lcovText.charCodeAt(start) <= ASCII_SPACE) {
                start++;
            }
            let end = endPos;
            while (end > start && lcovText.charCodeAt(end - 1) <= ASCII_SPACE) {
                end--;
            }

            pos = nextNewline + 1;
            if (start >= end) {
                continue;
            }

            processRecordCursor(lcovText, start, end, processingCtx);
        }

        return resultMap;
    }

    /**
     * Builds an O(1) basename lookup index for a given profile map.
     */
    public buildBasenameIndex(
        profiles: Map<string, FileCoverageProfile>,
    ): Map<string, FileCoverageProfile> {
        const basenameMap = new Map<string, FileCoverageProfile>();
        for (const [key, profile] of profiles) {
            basenameMap.set(fastBasename(key), profile);
        }
        return basenameMap;
    }

    private getOrBuildBasenameIndex(
        profiles: Map<string, FileCoverageProfile>,
    ): Map<string, FileCoverageProfile> {
        let cachedIndex = this.basenameCache.get(profiles);
        if (!cachedIndex) {
            cachedIndex = this.buildBasenameIndex(profiles);
            this.basenameCache.set(profiles, cachedIndex);
        }
        return cachedIndex;
    }

    /**
     * Fast O(1) profile lookup utilizing basename indexing with fallback to
     * exact and suffix matches.
     *
     * @param targetPath - Path to locate in profiles.
     * @param profiles - Coverage profiles map.
     * @param basenameIndex - Optional prebuilt basename index map.
     * @returns Matched FileCoverageProfile or undefined.
     */
    public findProfileFast(
        targetPath: string,
        profiles: Map<string, FileCoverageProfile>,
        basenameIndex?: Map<string, FileCoverageProfile>,
    ): FileCoverageProfile | undefined {
        const normalized = targetPath.replace(/\\/g, '/');

        // 1. Direct exact match (O(1))
        const exact = profiles.get(normalized);
        if (exact) {
            return exact;
        }

        // 2. Basename index match (O(1))
        const basename = fastBasename(normalized);

        const activeIndex = basenameIndex ?? this.getOrBuildBasenameIndex(profiles);
        const indexedMatch = activeIndex.get(basename);
        if (indexedMatch) {
            return indexedMatch;
        }

        // 3. Fallback suffix / subpath match
        for (const [key, profile] of profiles) {
            if (key.endsWith(normalized) || normalized.endsWith(key)) {
                return profile;
            }
        }

        return undefined;
    }

    /**
     * Resilient path lookup matching relative, absolute, or basename matches.
     * Delegates to findProfileFast for O(1) accelerated retrieval.
     */
    public findProfile(
        targetPath: string,
        profiles: Map<string, FileCoverageProfile>,
    ): FileCoverageProfile | undefined {
        return this.findProfileFast(targetPath, profiles);
    }

    /**
     * Compute dynamic damping multiplier K_cov for a file or specific line.
     */
    public evaluateCoverageDamping(
        profile: FileCoverageProfile | undefined,
        targetLine?: number,
    ): CoverageDampingResult {
        if (!profile) {
            return {
                filePath: '',
                line: targetLine,
                dampingMultiplier: MULTIPLIER_NEUTRAL,
                status: STATUS_UNMONITORED,
                rationale:
                    'No CI coverage telemetry available for this file. Neutral multiplier 1.0x applied.',
            };
        }

        const lineHit = targetLine !== undefined ? profile.lineHits.get(targetLine) : undefined;

        // Condition 1: Naked Uncovered Line or Critical Low Coverage (<20%)
        if (
            (targetLine !== undefined && lineHit === 0) ||
            profile.lineCoverageRatio < COVERAGE_LOW_THRESHOLD
        ) {
            return {
                filePath: profile.filePath,
                line: targetLine,
                dampingMultiplier: MULTIPLIER_HIGH_RISK,
                status: STATUS_UNCOVERED_HIGH_RISK,
                lineHitCount: lineHit,
                rationale:
                    `Uncovered high-risk code region detected by CI telemetry ` +
                    `(line hit: ${lineHit ?? 0}, file coverage: ${(profile.lineCoverageRatio * PERCENT_FACTOR).toFixed(0)}%). ` +
                    `Complexity penalty amplified 1.8x.`,
            };
        }

        // Condition 2: Thoroughly Tested Module (line >= 90% and branch >= 80%)
        if (
            (lineHit === undefined || lineHit > 0) &&
            profile.lineCoverageRatio >= COVERAGE_LINE_HIGH_THRESHOLD &&
            profile.branchCoverageRatio >= COVERAGE_BRANCH_HIGH_THRESHOLD
        ) {
            return {
                filePath: profile.filePath,
                line: targetLine,
                dampingMultiplier: MULTIPLIER_WELL_COVERED,
                status: STATUS_WELL_COVERED,
                lineHitCount: lineHit,
                rationale:
                    `Comprehensive CI test coverage verified (line: ${(profile.lineCoverageRatio * PERCENT_FACTOR).toFixed(0)}%, ` +
                    `branch: ${(profile.branchCoverageRatio * PERCENT_FACTOR).toFixed(0)}%). Complexity risk halved to 0.5x.`,
            };
        }

        // Condition 3: Moderate Coverage (40% - 90%)
        return {
            filePath: profile.filePath,
            line: targetLine,
            dampingMultiplier: MULTIPLIER_NEUTRAL,
            status: STATUS_MODERATE_COVERAGE,
            lineHitCount: lineHit,
            rationale:
                `Moderate coverage telemetry (line: ${(profile.lineCoverageRatio * PERCENT_FACTOR).toFixed(0)}%). ` +
                `Standard baseline multiplier applied.`,
        };
    }

    /**
     * Map coverage profile to DynamicIssueRisk for resonance in RiskFusionEngine.
     */
    public asDynamicEvidence(
        profile: FileCoverageProfile | undefined,
        line: number,
        rule: string,
    ): DynamicIssueRisk {
        const evalResult = this.evaluateCoverageDamping(profile, line);

        if (evalResult.status === STATUS_UNCOVERED_HIGH_RISK) {
            return {
                hotspotId: `${rule}:${profile?.filePath ?? 'unknown'}:${line}`,
                filePath: profile?.filePath,
                line,
                B: 2.5,
                F: 2.0,
                R: 1.5,
                V: 1.0,
                rawRisk: RISK_RAW_HIGH,
                normalizedRisk: RISK_NORMALIZED_HIGH,
                evidenceConfidence: CONFIDENCE_HIGH_RISK,
            };
        }

        if (evalResult.status === STATUS_WELL_COVERED) {
            return {
                hotspotId: `${rule}:${profile?.filePath ?? 'unknown'}:${line}`,
                filePath: profile?.filePath,
                line,
                B: 1.0,
                F: 0.5,
                R: 1.0,
                V: 1.0,
                rawRisk: RISK_RAW_LOW,
                normalizedRisk: RISK_NORMALIZED_LOW,
                evidenceConfidence: CONFIDENCE_WELL_COVERED,
            };
        }

        return {
            hotspotId: `${rule}:${profile?.filePath ?? 'unknown'}:${line}`,
            filePath: profile?.filePath,
            line,
            B: 1.0,
            F: 1.0,
            R: 1.0,
            V: 1.0,
            rawRisk: RISK_RAW_NEUTRAL,
            normalizedRisk: RISK_NORMALIZED_NEUTRAL,
            evidenceConfidence: CONFIDENCE_NEUTRAL,
        };
    }
}
