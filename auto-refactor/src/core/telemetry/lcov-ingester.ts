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
    let p = start + 3;
    let lineNo = 0;
    while (p < end) {
        const c = text.charCodeAt(p);
        if (c === 44) {
            break;
        }
        if (c >= 48 && c <= 57) {
            lineNo = lineNo * 10 + (c - 48);
        }
        p++;
    }
    if (p >= end || text.charCodeAt(p) !== 44) {
        return;
    }
    p++;
    let hitCount = 0;
    while (p < end) {
        const c = text.charCodeAt(p);
        if (c >= 48 && c <= 57) {
            hitCount = hitCount * 10 + (c - 48);
        }
        p++;
    }
    lineHits.set(lineNo, hitCount);
}

/**
 * Fast zero-allocation integer parser from an integer cursor slice [start, end).
 */
function parseIntegerCursor(text: string, start: number, end: number): number {
    let val = 0;
    for (let p = start; p < end; p++) {
        const c = text.charCodeAt(p);
        if (c >= 48 && c <= 57) {
            val = val * 10 + (c - 48);
        }
    }
    return val;
}

function handleSfRecord(
    lcovText: string,
    start: number,
    end: number,
    state: LcovParserState,
): void {
    let sfStart = start + 3;
    while (sfStart < end && lcovText.charCodeAt(sfStart) <= 32) {
        sfStart++;
    }
    state.currentPath = lcovText.slice(sfStart, end);
    state.linesFound = 0;
    state.linesHit = 0;
    state.branchesFound = 0;
    state.branchesHit = 0;
    state.lineHits = new Map<number, number>();
}

function handleLRecord(lcovText: string, start: number, end: number, state: LcovParserState): void {
    const c1 = lcovText.charCodeAt(start + 1);
    if (c1 === 70 /* 'F' */) {
        state.linesFound = parseIntegerCursor(lcovText, start + 3, end);
    } else if (c1 === 72 /* 'H' */) {
        state.linesHit = parseIntegerCursor(lcovText, start + 3, end);
    }
}

function handleBrRecord(
    lcovText: string,
    start: number,
    end: number,
    state: LcovParserState,
): void {
    const c2 = lcovText.charCodeAt(start + 2);
    if (c2 === 70 /* 'F' */) {
        state.branchesFound = parseIntegerCursor(lcovText, start + 4, end);
    } else if (c2 === 72 /* 'H' */) {
        state.branchesHit = parseIntegerCursor(lcovText, start + 4, end);
    }
}

function handleEndOfRecord(
    state: LcovParserState,
    resultMap: Map<string, FileCoverageProfile>,
): void {
    if (state.currentPath) {
        recordProfile(
            state.currentPath,
            state.linesFound,
            state.linesHit,
            state.branchesFound,
            state.branchesHit,
            state.lineHits,
            resultMap,
        );
    }
    state.currentPath = null;
}

/**
 * Fast zero-allocation line break search using integer cursor traversal.
 */
function findNextLineBreak(text: string, pos: number, textLen: number): number {
    for (let i = pos; i < textLen; i++) {
        if (text.charCodeAt(i) === 10 /* '\n' */) {
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
        const c = filePath.charCodeAt(i);
        if (c === 47 /* '/' */ || c === 92 /* '\\' */) {
            return filePath.slice(i + 1);
        }
    }
    return filePath;
}

/**
 * Dispatches an in-flight LCOV record delimited by [start, end) into parser state.
 */
function processRecordCursor(
    lcovText: string,
    start: number,
    end: number,
    state: LcovParserState,
    resultMap: Map<string, FileCoverageProfile>,
): void {
    switch (lcovText.charCodeAt(start)) {
        case 68 /* 'D' */:
            parseDaCursor(lcovText, start, end, state.lineHits);
            break;
        case 83 /* 'S' */:
            handleSfRecord(lcovText, start, end, state);
            break;
        case 76 /* 'L' */:
            handleLRecord(lcovText, start, end, state);
            break;
        case 66 /* 'B' */:
            handleBrRecord(lcovText, start, end, state);
            break;
        case 101 /* 'e' */:
            handleEndOfRecord(state, resultMap);
            break;
    }
}

/**
 * Compute ratios and insert coverage profile into destination map.
 */
function recordProfile(
    currentPath: string,
    linesFound: number,
    linesHit: number,
    branchesFound: number,
    branchesHit: number,
    lineHits: Map<number, number>,
    resultMap: Map<string, FileCoverageProfile>,
): void {
    const normalizedPath = currentPath.replace(/\\/g, '/');
    let activeHits = 0;
    for (const count of lineHits.values()) {
        if (count > 0) activeHits++;
    }

    const effectiveFound = Math.max(linesFound, lineHits.size);
    const effectiveHit = linesHit > 0 ? linesHit : activeHits;
    const lineRatio = effectiveFound > 0 ? +(effectiveHit / effectiveFound).toFixed(3) : 0.0;
    const branchRatio = branchesFound > 0 ? +(branchesHit / branchesFound).toFixed(3) : 1.0;

    resultMap.set(normalizedPath, {
        filePath: normalizedPath,
        linesFound: effectiveFound,
        linesHit: effectiveHit,
        lineCoverageRatio: lineRatio,
        branchesFound,
        branchesHit,
        branchCoverageRatio: branchRatio,
        lineHits,
    });
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

        let pos = 0;
        const textLen = lcovText.length;

        while (pos < textLen) {
            const nextNewline = findNextLineBreak(lcovText, pos, textLen);
            let endPos = nextNewline;
            if (endPos > pos && lcovText.charCodeAt(endPos - 1) === 13) {
                endPos--;
            }

            let start = pos;
            while (start < endPos && lcovText.charCodeAt(start) <= 32) {
                start++;
            }
            let end = endPos;
            while (end > start && lcovText.charCodeAt(end - 1) <= 32) {
                end--;
            }

            pos = nextNewline + 1;
            if (start >= end) {
                continue;
            }

            processRecordCursor(lcovText, start, end, state, resultMap);
        }

        return resultMap;
    }

    /**
     * Builds an O(1) basename lookup index for a given profile map.
     */
    public buildBasenameIndex(
        profiles: Map<string, FileCoverageProfile>,
    ): Map<string, FileCoverageProfile> {
        const index = new Map<string, FileCoverageProfile>();
        for (const [key, profile] of profiles) {
            index.set(fastBasename(key), profile);
        }
        return index;
    }

    private getOrBuildBasenameIndex(
        profiles: Map<string, FileCoverageProfile>,
    ): Map<string, FileCoverageProfile> {
        let index = this.basenameCache.get(profiles);
        if (!index) {
            index = this.buildBasenameIndex(profiles);
            this.basenameCache.set(profiles, index);
        }
        return index;
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
                dampingMultiplier: 1.0,
                status: 'unmonitored',
                rationale:
                    'No CI coverage telemetry available for this file. Neutral multiplier 1.0x applied.',
            };
        }

        const lineHit = targetLine !== undefined ? profile.lineHits.get(targetLine) : undefined;

        // Condition 1: Naked Uncovered Line or Critical Low Coverage (<20%)
        if ((targetLine !== undefined && lineHit === 0) || profile.lineCoverageRatio < 0.2) {
            return {
                filePath: profile.filePath,
                line: targetLine,
                dampingMultiplier: 1.8,
                status: 'uncovered_high_risk',
                lineHitCount: lineHit,
                rationale:
                    `Uncovered high-risk code region detected by CI telemetry ` +
                    `(line hit: ${lineHit ?? 0}, file coverage: ${(profile.lineCoverageRatio * 100).toFixed(0)}%). ` +
                    `Complexity penalty amplified 1.8x.`,
            };
        }

        // Condition 2: Thoroughly Tested Module (line >= 90% and branch >= 80%)
        if (
            (lineHit === undefined || lineHit > 0) &&
            profile.lineCoverageRatio >= 0.9 &&
            profile.branchCoverageRatio >= 0.8
        ) {
            return {
                filePath: profile.filePath,
                line: targetLine,
                dampingMultiplier: 0.5,
                status: 'well_covered',
                lineHitCount: lineHit,
                rationale:
                    `Comprehensive CI test coverage verified (line: ${(profile.lineCoverageRatio * 100).toFixed(0)}%, ` +
                    `branch: ${(profile.branchCoverageRatio * 100).toFixed(0)}%). Complexity risk halved to 0.5x.`,
            };
        }

        // Condition 3: Moderate Coverage (40% - 90%)
        return {
            filePath: profile.filePath,
            line: targetLine,
            dampingMultiplier: 1.0,
            status: 'moderate_coverage',
            lineHitCount: lineHit,
            rationale:
                `Moderate coverage telemetry (line: ${(profile.lineCoverageRatio * 100).toFixed(0)}%). ` +
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

        if (evalResult.status === 'uncovered_high_risk') {
            return {
                hotspotId: `${rule}:${profile?.filePath ?? 'unknown'}:${line}`,
                filePath: profile?.filePath,
                line,
                B: 2.5,
                F: 2.0,
                R: 1.5,
                V: 1.0,
                rawRisk: 7.5,
                normalizedRisk: 6.5,
                evidenceConfidence: 0.9,
            };
        }

        if (evalResult.status === 'well_covered') {
            return {
                hotspotId: `${rule}:${profile?.filePath ?? 'unknown'}:${line}`,
                filePath: profile?.filePath,
                line,
                B: 1.0,
                F: 0.5,
                R: 1.0,
                V: 1.0,
                rawRisk: 0.5,
                normalizedRisk: 0.3,
                evidenceConfidence: 0.95,
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
            rawRisk: 1.0,
            normalizedRisk: 1.0,
            evidenceConfidence: 0.5,
        };
    }
}
