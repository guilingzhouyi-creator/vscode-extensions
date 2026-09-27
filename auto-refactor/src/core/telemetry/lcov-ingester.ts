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
 * Parses a DA record line: 'DA:<lineNo>,<hitCount>' and writes into lineHits map.
 */
function parseDaLine(line: string, lineHits: Map<number, number>): void {
    const commaIdx = line.indexOf(',', 3);
    if (commaIdx === -1) return;
    const lineNo = parseInt(line.slice(3, commaIdx), 10);
    const hitCount = parseInt(line.slice(commaIdx + 1), 10);
    if (!isNaN(lineNo) && !isNaN(hitCount)) {
        lineHits.set(lineNo, hitCount);
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
 * Processes a single trimmed LCOV line and updates the parser state.
 */
function processLcovLine(
    line: string,
    state: LcovParserState,
    resultMap: Map<string, FileCoverageProfile>,
): void {
    if (line.startsWith('DA:')) {
        parseDaLine(line, state.lineHits);
        return;
    }
    if (line.startsWith('SF:')) {
        state.currentPath = line.slice(3).trim();
        state.linesFound = 0;
        state.linesHit = 0;
        state.branchesFound = 0;
        state.branchesHit = 0;
        state.lineHits = new Map<number, number>();
        return;
    }
    if (line.startsWith('LF:')) {
        state.linesFound = parseInt(line.slice(3), 10) || 0;
        return;
    }
    if (line.startsWith('LH:')) {
        state.linesHit = parseInt(line.slice(3), 10) || 0;
        return;
    }
    if (line.startsWith('BRF:')) {
        state.branchesFound = parseInt(line.slice(4), 10) || 0;
        return;
    }
    if (line.startsWith('BRH:')) {
        state.branchesHit = parseInt(line.slice(4), 10) || 0;
        return;
    }
    if (line === 'end_of_record') {
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
}

/**
 * Stream-oriented parser and evaluator for LCOV code coverage telemetry reports.
 */
export class LcovIngester {
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
            let nextNewline = lcovText.indexOf('\n', pos);
            if (nextNewline === -1) {
                nextNewline = textLen;
            }
            let endPos = nextNewline;
            if (endPos > pos && lcovText.charCodeAt(endPos - 1) === 13) {
                endPos--;
            }

            const line = lcovText.slice(pos, endPos).trim();
            pos = nextNewline + 1;
            if (!line) {
                continue;
            }

            processLcovLine(line, state, resultMap);
        }

        return resultMap;
    }

    /**
     * Compute ratios and insert coverage profile into destination map.
     */
    private recordProfile(
        currentPath: string,
        linesFound: number,
        linesHit: number,
        branchesFound: number,
        branchesHit: number,
        lineHits: Map<number, number>,
        resultMap: Map<string, FileCoverageProfile>,
    ): void {
        recordProfile(
            currentPath,
            linesFound,
            linesHit,
            branchesFound,
            branchesHit,
            lineHits,
            resultMap,
        );
    }

    /**
     * Resilient path lookup matching relative, absolute, or basename matches.
     */
    public findProfile(
        targetPath: string,
        profiles: Map<string, FileCoverageProfile>,
    ): FileCoverageProfile | undefined {
        const normalized = targetPath.replace(/\\/g, '/');

        // 1. Direct exact match
        if (profiles.has(normalized)) {
            return profiles.get(normalized);
        }

        // 2. Suffix / Subpath match
        for (const [key, profile] of profiles) {
            if (key.endsWith(normalized) || normalized.endsWith(key)) {
                return profile;
            }
        }

        return undefined;
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
