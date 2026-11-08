/**
 * Module: Core Scoring — Effective Code Density & Noise Index Calculation
 * File Path: src/core/scoring/effectiveDensity.ts
 * Architecture Role: Quantifies true semantic contribution versus maintained boilerplate,
 *   penalizing artificial function splitting, empty forwarding wrappers, and trivial getters.
 *   Calculates effective code density ratio, non-ELOC noise index, and Gaussian health score.
 * Dependencies & Triggers: Pure function over source code string and language tag. Consumes
 *   tokenizeCode, calculateTokenShannonEntropy, calculateGoldilocksEntropyFactor,
 *   calculateColumnDensity from ../intelligence/token-entropy, and calculateWeightedTokenPayload,
 *   calculateFunctionReuseMetrics, calculateCompositeEffectiveDensity
 *   from ../intelligence/payload-density.
 * Responsibilities: Count total LOC, detect forwarding methods and trivial boilerplate,
 *   compute effective code density ratio (rho_eff), noise index (kappa_noise),
 *   continuous Gaussian density health (eta_health), token semantic payload ratio (TSPR),
 *   plumbing overhead ratio (POR), single-use function rate (SUFR), and composite density tensor.
 * Exit Semantics & Design Rationale: Bounded 0.0-1.0 ratios, deterministic line analysis,
 *   and zero transient heap allocation in high-frequency calculation loops.
 */

import {
    tokenizeCode,
    calculateTokenShannonEntropy,
    calculateGoldilocksEntropyFactor,
    calculateColumnDensity,
} from '../intelligence/token-entropy';
import {
    calculateWeightedTokenPayload,
    calculateFunctionReuseMetrics,
    calculateCompositeEffectiveDensity,
    evaluateSpatialDensityManifold,
} from '../intelligence/payload-density';
import type { DensityAxis } from '../intelligence/density-vector-space';

/**
 * Result of effective code density evaluation.
 */
export interface EffectiveDensityResult {
    totalLoc: number;
    usefulLoc: number;
    boilerplateLoc: number;
    forwardingCount: number;
    effectiveDensity: number;
    noiseIndex: number;
    gaussianHealth: number;
    isLowDensity: boolean;
    physicalLineCount?: number;
    tokenEntropy?: number;
    vocabularySize?: number;
    tokenCount?: number;
    tokensPerEloc?: number;
    columnDensity?: number;
    tspr?: number;
    por?: number;
    sufr?: number;
    compositeDensity?: number;
    spatialDensity?: number;
    mahalanobisDistance?: number;
    dominantDeficitAxis?: DensityAxis;
    fisherSimplexDistance?: number;
}

/**
 * Patterns matching trivial forwarding or getter/setter methods.
 */
const TRIVIAL_FORWARD_PATTERNS: RegExp[] = [
    /^\s*(?:public|private|protected)?\s*(?:get|set)?\s*\w+\s*\([^)]*\)\s*:\s*[^;{]+\s*\{\s*return\s+(?:this\.)?[\w.]+(?:\([^)]*\))?;\s*\}\s*$/,
    /^\s*(?:public|private|protected)?\s*\w+\s*\([^)]*\)\s*\{\s*return\s+(?:this\.)?[\w.]+(?:\([^)]*\))?;\s*\}\s*$/,
    /^\s*def\s+\w+\([^)]*\):\s*(?:return\s+(?:self\.)?[\w.]+(?:\([^)]*\))?|pass)\s*$/,
    /^\s*func\s+\w+\([^)]*\)\s*->\s*\w+:\s*return\s+[\w.]+\s*$/,
];

const THOUSANDTHS_ROUNDING_FACTOR = 1000;
const HUNDREDTHS_ROUNDING_FACTOR = 100;
const MIN_EVALUATION_LOC_THRESHOLD = 15;

/**
 * Checks if a trimmed line is empty or purely a comment.
 *
 * @param line - Text line to check.
 * @returns True when line is whitespace-only or a comment.
 */
function isCommentOrBlank(line: string): boolean {
    const trimmed = line.trim();
    return (
        trimmed.length === 0 ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('#')
    );
}

/**
 * Checks if a code statement is a trivial forwarder or stub.
 *
 * @param line - Code statement line to inspect.
 * @returns True when the line matches trivial forwarder pattern.
 */
function isTrivialForwarder(line: string): boolean {
    for (const pattern of TRIVIAL_FORWARD_PATTERNS) {
        if (pattern.test(line)) {
            return true;
        }
    }
    return false;
}

/**
 * Calculates the Noise Index: kappa_noise = NonELOC / max(1, ELOC).
 * Measures the dilution ratio of boilerplate, trivial lines, and noise relative to logic.
 *
 * @param totalLoc - Physical line count excluding blanks and comments.
 * @param usefulLoc - Effective semantic code line count.
 * @returns Computed noise index.
 */
export function calculateNoiseIndex(totalLoc: number, usefulLoc: number): number {
    const nonEloc = Math.max(0, totalLoc - usefulLoc);
    const denominator = Math.max(1, usefulLoc);
    return (
        Math.round((nonEloc / denominator) * THOUSANDTHS_ROUNDING_FACTOR) /
        THOUSANDTHS_ROUNDING_FACTOR
    );
}

/**
 * Calculates continuous Gaussian Density Health:
 * eta_health = exp( - (kappa_noise - kappa_target)^2 / (2 * sigma^2) )
 * Default target kappa = 0.35 (optimal density with structure), sigma = 0.45.
 *
 * @param noiseIndex - Calculated noise index kappa_noise.
 * @param kappaTarget - Target optimal noise ratio (default 0.35).
 * @param sigma - Standard deviation scaling factor (default 0.45).
 * @returns Continuous Gaussian health ratio in [0, 1].
 */
export function calculateGaussianDensityHealth(
    noiseIndex: number,
    kappaTarget: number = 0.35,
    sigma: number = 0.45,
): number {
    const delta = noiseIndex - kappaTarget;
    const variance = 2 * sigma * sigma;
    const health = Math.exp(-(delta * delta) / variance);
    return Math.round(health * THOUSANDTHS_ROUNDING_FACTOR) / THOUSANDTHS_ROUNDING_FACTOR;
}

const FUNCTION_KEYWORD_SET = new Set(['function', 'def', 'func', 'fn']);
const IDENTIFIER_PATTERN = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const STANDALONE_BOILERPLATE = new Set(['{', '}', 'return;', 'pass']);

function collectDeclaredFunctionNames(rawTokens: readonly string[]): Set<string> {
    const declaredNames = new Set<string>();
    const maxIdx = rawTokens.length - 1;
    for (let i = 0; i < maxIdx; i++) {
        if (!FUNCTION_KEYWORD_SET.has(rawTokens[i])) continue;
        const next = rawTokens[i + 1];
        if (next && IDENTIFIER_PATTERN.test(next)) {
            declaredNames.add(next);
        }
    }
    return declaredNames;
}

function countTokenFrequencies(
    tokens: readonly string[],
    targets: Set<string>,
): Map<string, number> {
    const freqMap = new Map<string, number>();
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (targets.has(token)) {
            const cur = freqMap.get(token) || 0;
            freqMap.set(token, cur + 1);
        }
    }
    return freqMap;
}

/**
 * Extracts fan-in invocation count approximation for declared functions from token stream.
 *
 * @param rawTokens - Flat array of code tokens.
 * @returns Array of invocation counts per declared function symbol.
 */
function extractDeclaredFunctionFanIns(rawTokens: readonly string[]): number[] {
    if (rawTokens.length < 2) return [];

    const declaredNames = collectDeclaredFunctionNames(rawTokens);
    if (declaredNames.size === 0) return [];

    const freqMap = countTokenFrequencies(rawTokens, declaredNames);
    const fanIns: number[] = [];
    for (const name of declaredNames) {
        const count = freqMap.get(name) || 0;
        fanIns.push(Math.max(0, count - 1));
    }
    return fanIns;
}

function evaluateLineBoilerplateWeight(trimmed: string): { weight: number; isForwarding: boolean } {
    if (isTrivialForwarder(trimmed)) {
        return { weight: 1.0, isForwarding: true };
    }
    if (
        STANDALONE_BOILERPLATE.has(trimmed) ||
        trimmed.includes('throw new Error("Not implemented")')
    ) {
        return { weight: 0.5, isForwarding: false };
    }
    return { weight: 0.0, isForwarding: false };
}

function countInteriorMultilineLiteralLines(tokens: readonly { text: string }[]): number {
    let interiorLines = 0;
    for (let i = 0; i < tokens.length; i++) {
        const text = tokens[i].text;
        if (text.length < 3) continue;
        const firstChar = text.charCodeAt(0);
        if (firstChar !== 96 && firstChar !== 34 && firstChar !== 39) continue;
        for (let j = 1; j < text.length - 1; j++) {
            if (text.charCodeAt(j) === 10) {
                interiorLines++;
            }
        }
    }
    return interiorLines;
}

/**
 * Calculates effective code density and noise metrics across source content.
 *
 * @param content - Source code text to analyze.
 * @param language - Optional programming language tag.
 * @returns Breakdown of useful LOC, boilerplate LOC, density ratio,
 *   noise index, and tensor metrics.
 */
export function computeEffectiveCodeDensity(
    content: string,
    language: string = 'typescript',
): EffectiveDensityResult {
    const lines = content.split(/\r?\n/);
    let totalLoc = 0;
    let boilerplateLoc = 0;
    let forwardingCount = 0;

    for (const line of lines) {
        if (isCommentOrBlank(line)) {
            continue;
        }
        totalLoc++;

        const evalResult = evaluateLineBoilerplateWeight(line.trim());
        boilerplateLoc += evalResult.weight;
        if (evalResult.isForwarding) {
            forwardingCount++;
        }
    }

    const usefulLoc = Math.max(0, totalLoc - Math.floor(boilerplateLoc));
    const effectiveDensity =
        totalLoc > 0
            ? Math.round((usefulLoc / totalLoc) * HUNDREDTHS_ROUNDING_FACTOR) /
              HUNDREDTHS_ROUNDING_FACTOR
            : 1.0;
    const noiseIndex = calculateNoiseIndex(totalLoc, usefulLoc);
    const gaussianHealth = calculateGaussianDensityHealth(noiseIndex);
    const isLowDensity = totalLoc >= MIN_EVALUATION_LOC_THRESHOLD && effectiveDensity < 0.55;

    // Advanced token density and payload tensor integration
    const tokenStream = tokenizeCode(content, language);
    const tokenCount = tokenStream.tokens.length;

    let tokensPerEloc = 0;
    let columnDensity = 0;
    let tspr = 0;
    let por = 0;
    let sufr = 0;
    let compositeDensity = 0;
    let tokenEntropy: number | undefined;
    let vocabularySize: number | undefined;
    let spatialDensity: number | undefined;
    let mahalanobisDistance: number | undefined;
    let dominantDeficitAxis: DensityAxis | undefined;
    let fisherSimplexDistance: number | undefined;

    if (tokenCount > 0) {
        const interiorLiteralLines = countInteriorMultilineLiteralLines(tokenStream.tokens);
        const eloc = Math.max(1, usefulLoc - interiorLiteralLines);
        const colMetrics = calculateColumnDensity(tokenCount, eloc);
        tokensPerEloc = colMetrics.tokensPerEloc;
        columnDensity = colMetrics.columnDensity;

        const payloadMetrics = calculateWeightedTokenPayload(tokenStream.tokens);
        tspr = payloadMetrics.tspr;
        por = payloadMetrics.por;

        const fanIns = extractDeclaredFunctionFanIns(tokenStream.rawTokens);
        const reuseMetrics = calculateFunctionReuseMetrics(fanIns);
        sufr = reuseMetrics.sufr;

        const entropyResult = calculateTokenShannonEntropy(tokenStream.rawTokens);
        tokenEntropy = entropyResult.entropy;
        vocabularySize = entropyResult.vocabularySize;
        const entropyFactor = calculateGoldilocksEntropyFactor(entropyResult.entropy);

        const compositeInputs = {
            lineDensity: effectiveDensity,
            columnDensity,
            reuseDensity: fanIns.length > 0 ? reuseMetrics.reuseDensity : effectiveDensity,
            sharedDensity: effectiveDensity,
            payloadDensity: tspr,
            entropyFactor,
        };

        compositeDensity = calculateCompositeEffectiveDensity(compositeInputs);

        const spatialEval = evaluateSpatialDensityManifold(compositeInputs);
        spatialDensity = spatialEval.spatialCompositeDensity;
        mahalanobisDistance = spatialEval.mahalanobisDistance;
        dominantDeficitAxis = spatialEval.dominantDeficitAxis;
        fisherSimplexDistance = spatialEval.fisherSimplexDistance;
    }

    return {
        totalLoc,
        usefulLoc,
        boilerplateLoc: Math.floor(boilerplateLoc),
        forwardingCount,
        effectiveDensity,
        noiseIndex,
        gaussianHealth,
        isLowDensity,
        physicalLineCount: lines.length,
        tokenEntropy,
        vocabularySize,
        tokenCount,
        tokensPerEloc,
        columnDensity,
        tspr,
        por,
        sufr,
        compositeDensity,
        spatialDensity,
        mahalanobisDistance,
        dominantDeficitAxis,
        fisherSimplexDistance,
    };
}
