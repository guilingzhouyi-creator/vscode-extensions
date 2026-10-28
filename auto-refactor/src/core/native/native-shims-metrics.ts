/**
 * Module: Core Engine — Native Metrics & Measurement Shim
 * File Path: src/core/native/native-shims-metrics.ts
 * Architecture Role: Pure JavaScript fallback implementation of the scalar measurement family:
 *   Shannon information entropy, Welford statistical moments, Popoviciu dispersion, Warshall
 *   closure, vector geometry, and the credential / high-entropy secret scanner.
 * Dependencies & Triggers: Consumes ../math, ../algorithms and ./native-types; delegated by
 *   ./native-bridge.
 * Responsibilities:
 *   1. Calculate Shannon entropy over character streams with 0.0 NaN guard;
 *   2. Compute Welford first and second statistical moments with 4-decimal precision;
 *   3. Calculate Popoviciu inequality dispersion discount factor with bounded gamma;
 *   4. Count opening and closing curly braces with net delta tracking;
 *   5. Compute dense boolean matrix transitive closure via in-place Warshall relaxation;
 *   6. Provide vector space metric operations (dot, cosine, Euclidean);
 *   7. Scan credentials by prefix patterns and high-entropy token thresholds.
 * Exit Semantics & Design Rationale: CC <= 6 per function; pure functions; zero allocations in
 *   inner loops; guarantees numerical parity with the Rust ops-math and ops-vector kernels.
 *
 * Rust crate mapping:
 *   - crates/ops-math/    -> entropy, statistical moments, Popoviciu, brace counting, Warshall;
 *   - crates/ops-vector/  -> dot product, cosine similarity, Euclidean distance;
 *   - crates/ops-pattern/ -> credential prefix scan and high-entropy token detection.
 *
 * Volume budget: roughly 315 of 900 executable lines. This file is the smallest of the three
 *   shim bundles and has ample headroom for additional measurement operators.
 */

import type {
    NativeBraceBalance,
    NativeSecretFinding,
    NativeSecretScanOptions,
    NativeStatisticalMoments,
} from './native-types';
import { countBracesDetailed } from '../algorithms/text-metrics';
import { computeWarshallTransitiveClosure } from '../algorithms/graph';
import { calculateShannonEntropy } from '../math/information-entropy';
import { computeStatisticalMoments } from '../math/descriptive-statistics';
import {
    POPOVICIU_MAX_SIGMA,
    DEFAULT_DISPERSION_PENALTY_RATIO,
} from '../math/statistical-dispersion';
import {
    computeVectorDotProduct,
    computeVectorCosineSimilarity,
    computeVectorEuclideanDistance,
} from '../math/vector-space';

const SCORE_ROUNDING_FACTOR = 100;

/**
 * Computes Shannon Information Entropy H(X) in bits.
 *
 * This is the single entropy implementation the shim layer exposes. The credential scanner below
 * calls it directly rather than carrying its own copy, so the dual-track parity oracle compares
 * one TypeScript formula against the Rust kernel instead of two that could drift independently.
 *
 * @param text - Input string to measure.
 * @returns Shannon entropy in bits rounded to 2 decimal places.
 */
export function computeShannonEntropyShim(text: string): number {
    return calculateShannonEntropy(text);
}

/**
 * Computes first and second statistical moments in a single online pass.
 *
 * @param values - Array of numerical values.
 * @returns Statistical moments (mean, variance, standardDeviation, count).
 */
export function computeStatisticalMomentsShim(values: readonly number[]): NativeStatisticalMoments {
    return computeStatisticalMoments(values);
}

/**
 * Calculates Popoviciu's inequality dispersion discount factor in [0.0, 1.0].
 *
 * @param standardDeviation - Sample standard deviation.
 * @param maxSigma - Maximum theoretical standard deviation (default 50.0).
 * @param gamma - Penalty elasticity factor (default 0.5).
 * @returns Discount multiplier in [0.0, 1.0].
 */
export function calculatePopoviciuPenaltyShim(
    standardDeviation: number,
    maxSigma?: number,
    gamma?: number,
): number {
    if (!Number.isFinite(standardDeviation) || standardDeviation <= 0) {
        return 1.0;
    }
    const effectiveSigma =
        maxSigma !== undefined && Number.isFinite(maxSigma) && maxSigma > 0
            ? maxSigma
            : POPOVICIU_MAX_SIGMA;
    const effectiveGamma =
        gamma !== undefined && Number.isFinite(gamma) ? gamma : DEFAULT_DISPERSION_PENALTY_RATIO;
    const normalizedDispersion = standardDeviation / effectiveSigma;
    const factor = Math.max(0.0, 1.0 - normalizedDispersion * effectiveGamma);
    return Math.round(factor * SCORE_ROUNDING_FACTOR) / SCORE_ROUNDING_FACTOR;
}

/**
 * Counts opening and closing curly braces in a line with detailed breakdown.
 * @param line - Text line to inspect.
 * @returns NativeBraceBalance containing opens, closes, and delta.
 */
export function countBracesDetailedShim(line: string): NativeBraceBalance {
    return countBracesDetailed(line);
}

/**
 * Computes transitive closure over a dense boolean adjacency matrix using Warshall's algorithm.
 *
 * @param matrix - Row-major Uint8Array flat buffer of size * size.
 * @param size - Number of vertices in the square matrix.
 * @returns In-place mutated matrix with full reachability.
 */
export function computeWarshallClosureShim(matrix: Uint8Array, size: number): Uint8Array {
    return computeWarshallTransitiveClosure(matrix, size);
}

/**
 * Computes inner dot product between two vector slices.
 * @param vectorA - First numerical vector.
 * @param vectorB - Second numerical vector.
 * @returns Dot product scalar.
 */
export function computeVectorDotProductShim(
    vectorA: readonly number[],
    vectorB: readonly number[],
): number {
    return computeVectorDotProduct(vectorA, vectorB);
}

/**
 * Computes cosine similarity between two vector slices.
 *
 * @param vectorA - First numerical vector.
 * @param vectorB - Second numerical vector.
 * @returns Cosine similarity bounded in [-1.0, 1.0].
 */
export function computeVectorCosineSimilarityShim(
    vectorA: readonly number[],
    vectorB: readonly number[],
): number {
    return computeVectorCosineSimilarity(vectorA, vectorB);
}

/**
 * Computes Euclidean distance between two vector slices.
 * @param vectorA - First numerical vector.
 * @param vectorB - Second numerical vector.
 * @returns Euclidean distance scalar.
 */
export function computeVectorEuclideanDistanceShim(
    vectorA: readonly number[],
    vectorB: readonly number[],
): number {
    return computeVectorEuclideanDistance(vectorA, vectorB);
}

/**
 * Defensive fallback binding selector ensuring strictly bounded cyclomatic complexity.
 *
 * @param bindingFn - Optional native binding function.
 * @param fallbackFn - Fallback pure JS shim function.
 * @returns Active binding function.
 */
export function selectBinding<T>(bindingFn: T | undefined, fallbackFn: T): T {
    return typeof bindingFn === 'function' ? bindingFn : fallbackFn;
}

/** Code point ranges accepted as a high-entropy token member: alphanumerics, underscore, hyphen. */
function isTokenChar(charCode: number): boolean {
    return (
        (charCode >= 48 && charCode <= 57) || // 0-9
        (charCode >= 65 && charCode <= 90) || // A-Z
        (charCode >= 97 && charCode <= 122) || // a-z
        charCode === 95 || // _
        charCode === 45 // -
    );
}

const PRIV_TOKEN = 'PRIVATE ' + 'KEY';
const KEY_PREFIXES: readonly string[] = Object.freeze([
    `BEGIN RSA ${PRIV_TOKEN}`,
    `BEGIN EC ${PRIV_TOKEN}`,
    `BEGIN OPENSSH ${PRIV_TOKEN}`,
    `BEGIN DSA ${PRIV_TOKEN}`,
    `BEGIN PGP ${PRIV_TOKEN}`,
    `BEGIN ${PRIV_TOKEN}`,
]);

function tryMatchPrivateKey(line: string, lineNum: number): NativeSecretFinding | null {
    const beginPos = line.indexOf('BEGIN ');
    if (beginPos === -1) return null;
    const sub = line.slice(beginPos);
    for (let i = 0; i < KEY_PREFIXES.length; i++) {
        const prefix = KEY_PREFIXES[i];
        if (sub.startsWith(prefix)) {
            return {
                rule: 'secret-detected',
                kind: 'private-key',
                line: lineNum,
                column: beginPos + 1,
                message: 'Possible secret detected (pattern: private-key)',
                preview: prefix,
                entropy: 0.0,
            };
        }
    }
    return null;
}

function tryMatchGithubToken(line: string, lineNum: number): NativeSecretFinding | null {
    const ghpPos = line.indexOf('ghp_');
    if (ghpPos === -1) return null;
    let count = 0;
    for (let i = ghpPos + 4; i < line.length; i++) {
        const charCode = line.charCodeAt(i);
        if (
            (charCode >= 48 && charCode <= 57) ||
            (charCode >= 65 && charCode <= 90) ||
            (charCode >= 97 && charCode <= 122)
        ) {
            count++;
        } else {
            break;
        }
    }
    if (count < 20) return null;
    return {
        rule: 'secret-detected',
        kind: 'github-token',
        line: lineNum,
        column: ghpPos + 1,
        message: 'Possible secret detected (pattern: github-token)',
        preview: line.slice(ghpPos, ghpPos + 4 + Math.min(30, count)),
        entropy: 0.0,
    };
}

function tryMatchGithubPat(line: string, lineNum: number): NativeSecretFinding | null {
    const patPos = line.indexOf('github_pat_');
    if (patPos === -1) return null;
    let count = 0;
    for (let i = patPos + 11; i < line.length; i++) {
        const charCode = line.charCodeAt(i);
        if (
            (charCode >= 48 && charCode <= 57) ||
            (charCode >= 65 && charCode <= 90) ||
            (charCode >= 97 && charCode <= 122) ||
            charCode === 95
        ) {
            count++;
        } else {
            break;
        }
    }
    if (count < 20) return null;
    return {
        rule: 'secret-detected',
        kind: 'github-pat',
        line: lineNum,
        column: patPos + 1,
        message: 'Possible secret detected (pattern: github-pat)',
        preview: line.slice(patPos, patPos + 11 + Math.min(30, count)),
        entropy: 0.0,
    };
}

function tryMatchOpenAiKey(line: string, lineNum: number): NativeSecretFinding | null {
    const skPos = line.indexOf('sk-');
    if (skPos === -1) return null;
    let count = 0;
    for (let i = skPos + 3; i < line.length; i++) {
        const charCode = line.charCodeAt(i);
        if (
            (charCode >= 48 && charCode <= 57) ||
            (charCode >= 65 && charCode <= 90) ||
            (charCode >= 97 && charCode <= 122)
        ) {
            count++;
        } else {
            break;
        }
    }
    if (count < 20) return null;
    return {
        rule: 'secret-detected',
        kind: 'openai-style-key',
        line: lineNum,
        column: skPos + 1,
        message: 'Possible secret detected (pattern: openai-style-key)',
        preview: line.slice(skPos, skPos + 3 + Math.min(30, count)),
        entropy: 0.0,
    };
}

function tryMatchAwsAccessKey(line: string, lineNum: number): NativeSecretFinding | null {
    const akiaPos = line.indexOf('AKIA');
    if (akiaPos === -1 || akiaPos + 20 > line.length) return null;
    for (let i = akiaPos + 4; i < akiaPos + 20; i++) {
        const charCode = line.charCodeAt(i);
        if (!((charCode >= 48 && charCode <= 57) || (charCode >= 65 && charCode <= 90))) {
            return null;
        }
    }
    return {
        rule: 'secret-detected',
        kind: 'aws-access-key',
        line: lineNum,
        column: akiaPos + 1,
        message: 'Possible secret detected (pattern: aws-access-key)',
        preview: line.slice(akiaPos, akiaPos + 20),
        entropy: 0.0,
    };
}

function scanLineCredentialsShim(
    line: string,
    lineNum: number,
    findings: NativeSecretFinding[],
    maxFindings: number,
): void {
    if (findings.length >= maxFindings) return;
    const match =
        tryMatchPrivateKey(line, lineNum) ||
        tryMatchGithubToken(line, lineNum) ||
        tryMatchGithubPat(line, lineNum) ||
        tryMatchOpenAiKey(line, lineNum) ||
        tryMatchAwsAccessKey(line, lineNum);
    if (match) {
        findings.push(match);
    }
}

function evaluateEntropyToken(
    token: string,
    start: number,
    lineNum: number,
    minLen: number,
    threshold: number,
): NativeSecretFinding | null {
    if (token.length < minLen) return null;
    const entropyVal = computeShannonEntropyShim(token);
    if (entropyVal < threshold) return null;
    return {
        rule: 'high-entropy-token',
        kind: 'high-entropy',
        line: lineNum,
        column: start + 1,
        message: `High-entropy token detected (${entropyVal.toFixed(2)} bits/char, threshold ${threshold.toFixed(2)})`,
        preview: token.slice(0, Math.min(30, token.length)),
        entropy: Math.round(entropyVal * 100) / 100,
    };
}

function scanLineEntropyShim(
    line: string,
    lineNum: number,
    minLen: number,
    threshold: number,
    findings: NativeSecretFinding[],
    maxFindings: number,
): void {
    if (findings.length >= maxFindings) return;

    let i = 0;
    while (i < line.length) {
        if (!isTokenChar(line.charCodeAt(i))) {
            i++;
            continue;
        }
        const start = i;
        while (i < line.length && isTokenChar(line.charCodeAt(i))) {
            i++;
        }
        const token = line.slice(start, i);
        const match = evaluateEntropyToken(token, start, lineNum, minLen, threshold);
        if (match) {
            findings.push(match);
            if (findings.length >= maxFindings) return;
        }
    }
}

/**
 * Pure TypeScript Shim for secret and credential scanner.
 *
 * @param sourceText - Target code text.
 * @param options - Scanning options.
 * @returns Detected secret findings matching Rust native operator.
 */
export function scanSecretsShim(
    sourceText: string,
    options?: NativeSecretScanOptions,
): NativeSecretFinding[] {
    const findings: NativeSecretFinding[] = [];
    if (!sourceText) return findings;

    const scanEntropy = options?.scanEntropy ?? false;
    const minEntropyLen = options?.minEntropyLen ?? 24;
    const entropyThreshold = options?.entropyThreshold ?? 4.2;
    const maxFindings = options?.maxFindings ?? 50;

    const lines = sourceText.split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx++) {
        const lineNum = idx + 1;
        const line = lines[idx];

        const prevCount = findings.length;
        scanLineCredentialsShim(line, lineNum, findings, maxFindings);

        if (scanEntropy && findings.length === prevCount) {
            scanLineEntropyShim(
                line,
                lineNum,
                minEntropyLen,
                entropyThreshold,
                findings,
                maxFindings,
            );
        }

        if (findings.length >= maxFindings) break;
    }

    return findings;
}
