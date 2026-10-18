/**
 * Module: Core Intelligence — CodeScene Bumpy Road Complexity Analyzer
 * File Path: src/core/intelligence/bumpy-road-analyzer.ts
 * Architecture Role: Measures structural irregularity and spatial variance of indentation/nesting
 *   along a function body, diagnosing "Bumpy Road" cognitive debt where control-flow branches
 *   are interleaved throughout rather than flattened into entrance guard clauses.
 * Dependencies & Triggers: Consumed by ComplexityAnalyzer, CodeQualityScorer,
 *   and refactoring gates.
 * Responsibilities:
 *   1. Measure line-by-line structural depth profile across a target function range;
 *   2. Compute depth mean, spatial variance, alternating spikes, and Tornhill's BRI;
 *   3. Extract local nesting peaks and spans satisfying local depth maxima conditions;
 *   4. Provide Campbell Cognitive Complexity accumulation across branching layers.
 * Exit Semantics & Design Rationale: Completely pure function; zero transient heap allocation
 *   within hot loops; graceful no-op on short or single-line routines.
 */

import { nativeCore } from '../native/native-bridge';

/**
 * Structural nesting peak within a function body.
 */
export interface IndentationPeak {
    /** 1-indexed line number of the peak */
    readonly line: number;
    /** Relative indentation/nesting depth at peak */
    readonly depth: number;
    /** Consecutive span of non-blank lines covered by this nesting peak */
    readonly span: number;
}

/**
 * Detailed outcome of a Bumpy Road structural analysis.
 */
export interface BumpyRoadEvaluation {
    /** Composite Bumpy Road index normalized to [0, 100] */
    readonly bumpyScore: number;
    /** Whether structural complexity variance exceeds safe cognitive limits */
    readonly isBumpy: boolean;
    /** Average nesting/indentation depth across non-blank lines */
    readonly meanDepth: number;
    /** Spatial variance of nesting depth across the function span */
    readonly varianceDepth: number;
    /** Number of alternating deep structural jumps (|depth[i] - depth[i-1]| >= 2) */
    readonly spikesCount: number;
    /** Tornhill's Bumpy Road Index (BRI = sum(depth * log2(1 + span))) */
    readonly bumpyRoadIndex?: number;
    /** Detected local indentation peaks */
    readonly peaks?: readonly IndentationPeak[];
    /** Campbell Cognitive Complexity accumulation score */
    readonly cognitiveComplexity?: number;
    /** Actionable refactoring advice */
    readonly recommendation?: string;
}

const SPACE_INDENT_SIZE = 4;
const MIN_BUMPY_LINE_SPAN = 20;

/**
 * Calculates effective indentation level of a single source line.
 *
 * @param line - Raw source code line.
 * @returns Indentation level (1 unit = 4 spaces or 1 tab).
 */
export function measureLineIndentLevel(line: string): number {
    let spaces = 0;
    for (let i = 0; i < line.length; i++) {
        const ch = line.charCodeAt(i);
        if (ch === 32) {
            spaces++;
        } else if (ch === 9) {
            spaces += SPACE_INDENT_SIZE;
        } else {
            break;
        }
    }
    return Math.floor(spaces / SPACE_INDENT_SIZE);
}

/**
 * Extracts indentation peaks along a function line span.
 * Peak condition: d[i] >= 2 and d[i] > d[i-1] and d[i] >= d[i+1].
 *
 * @param lines - All source lines.
 * @param startLine - 1-indexed starting line.
 * @param endLine - 1-indexed ending line.
 * @returns Array of detected structural peaks.
 */
function collectRelativeDepths(
    lines: readonly string[],
    startLine: number,
    endLine: number,
): { readonly depths: number[]; readonly lineIndices: number[] } {
    const depths: number[] = [];
    const lineIndices: number[] = [];
    let baseIndent = -1;

    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
        const line = lines[lineNum - 1];
        if (!line || line.trim().length === 0) {
            continue;
        }
        const depth = measureLineIndentLevel(line);
        if (baseIndent === -1) {
            baseIndent = depth;
        }
        depths.push(Math.max(0, depth - baseIndent));
        lineIndices.push(lineNum);
    }
    return { depths, lineIndices };
}

function computePeakSpan(depths: readonly number[], startIndex: number, peakDepth: number): number {
    let span = 1;
    const minThreshold = Math.max(1, peakDepth - 1);
    while (startIndex + span < depths.length && depths[startIndex + span] >= minThreshold) {
        span++;
    }
    return span;
}

/**
 * Extracts indentation peaks along a function line span.
 * Peak condition: d[i] >= 2 and d[i] > d[i-1] and d[i] >= d[i+1].
 *
 * @param lines - All source lines.
 * @param startLine - 1-indexed starting line.
 * @param endLine - 1-indexed ending line.
 * @returns Array of detected structural peaks.
 */
export function extractIndentationPeaks(
    lines: readonly string[],
    startLine: number,
    endLine: number,
): readonly IndentationPeak[] {
    const totalLines = endLine - startLine + 1;
    if (!lines || totalLines < 3 || startLine < 1 || endLine > lines.length) {
        return Object.freeze([]);
    }

    const { depths, lineIndices } = collectRelativeDepths(lines, startLine, endLine);
    if (depths.length < 3) {
        return Object.freeze([]);
    }

    const peaks: IndentationPeak[] = [];
    for (let i = 1; i < depths.length - 1; i++) {
        const d = depths[i];
        if (d >= 2 && d > depths[i - 1] && d >= depths[i + 1]) {
            const span = computePeakSpan(depths, i, d);
            peaks.push(Object.freeze({
                line: lineIndices[i],
                depth: d,
                span,
            }));
        }
    }

    return Object.freeze(peaks);
}

/**
 * Computes Tornhill's Bumpy Road Index (BRI) from structural peaks.
 * Formula: BRI = sum(depth_k * log2(1 + span_k))
 *
 * @param peaks - Extracted nesting peaks.
 * @returns Bumpy Road Index.
 */
export function computeBumpyRoadIndex(peaks: readonly IndentationPeak[]): number {
    let bri = 0;
    for (let i = 0; i < peaks.length; i++) {
        const peak = peaks[i];
        bri += peak.depth * Math.log2(1 + peak.span);
    }
    return +bri.toFixed(2);
}

const CONTROL_FLOW_BRANCH_RE = /\b(if|for|while|catch|switch)\b|\?\s*[^:]+\s*:/;
const LOGICAL_OP_RE = /&&|\|\|/;

/**
 * Calculates Campbell Cognitive Complexity for a function span using single-pass accumulation.
 * Branching structures receive (1 + nestingLevel) cost; logical operators receive 1 cost.
 *
 * @param lines - Complete file lines.
 * @param startLine - Function starting line.
 * @param endLine - Function ending line.
 * @returns Total cognitive complexity score.
 */
export function calculateCognitiveComplexity(
    lines: readonly string[],
    startLine: number,
    endLine: number,
): number {
    if (!lines || startLine < 1 || endLine > lines.length || startLine > endLine) {
        return 0;
    }

    let score = 0;
    let nestingLevel = 0;

    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
        const rawLine = lines[lineNum - 1];
        if (!rawLine || rawLine.trim().length === 0) {
            continue;
        }

        const trimmed = rawLine.trim();
        // Track block nesting changes via brace counters
        let opens = 0;
        let closes = 0;
        for (let j = 0; j < trimmed.length; j++) {
            const code = trimmed.charCodeAt(j);
            if (code === 123) {
                opens++;
            } else if (code === 125) {
                closes++;
            }
        }

        if (CONTROL_FLOW_BRANCH_RE.test(trimmed)) {
            score += 1 + nestingLevel;
        }

        const logicalMatches = trimmed.match(LOGICAL_OP_RE);
        if (logicalMatches) {
            score += logicalMatches.length;
        }

        nestingLevel = Math.max(0, nestingLevel + opens - closes);
    }

    return score;
}

/**
 * Evaluates the Bumpy Road complexity metric for a function's line span.
 * Accelerated by native Rust operator with pure JS shim parity.
 *
 * @param lines - Complete array of source lines from the target file.
 * @param startLine - 1-indexed starting line number of the function.
 * @param endLine - 1-indexed ending line number of the function.
 * @returns Evaluated Bumpy Road outcome.
 */
export function evaluateBumpyRoad(
    lines: readonly string[],
    startLine: number,
    endLine: number,
): BumpyRoadEvaluation {
    const res = nativeCore.evaluateBumpyRoad(lines, startLine, endLine);
    const peaks = extractIndentationPeaks(lines, startLine, endLine);
    const bumpyRoadIndex = computeBumpyRoadIndex(peaks);
    const cognitiveComplexity = calculateCognitiveComplexity(lines, startLine, endLine);

    let recommendation: string | undefined;
    if (res.isBumpy) {
        recommendation =
            `Bumpy Road detected (score: ${res.bumpyScore}, spikes: ${res.spikesCount}, variance: ${res.varianceDepth}). ` +
            `Control-flow is deeply interleaved throughout the function. Flatten into entrance guard clauses ` +
            `or extract nested loops into focused pure helper functions.`;
    }

    return Object.freeze({
        bumpyScore: res.bumpyScore,
        isBumpy: res.isBumpy,
        meanDepth: res.meanDepth,
        varianceDepth: res.varianceDepth,
        spikesCount: res.spikesCount,
        bumpyRoadIndex,
        peaks,
        cognitiveComplexity,
        recommendation,
    });
}
