/**
 * Module: Core Scoring — Effective Code Density & Noise Index Calculation
 * File Path: src/core/scoring/effectiveDensity.ts
 * Architecture Role: Quantifies true semantic contribution versus maintained boilerplate,
 *   penalizing artificial function splitting, empty forwarding wrappers, and trivial getters.
 *   Calculates effective code density ratio, non-ELOC noise index, and Gaussian health score.
 * Dependencies & Triggers: Pure function over source code string and language tag.
 * Responsibilities: Count total LOC, detect forwarding methods and trivial boilerplate,
 *   compute effective code density ratio (rho_eff), noise index (kappa_noise),
 *   and continuous Gaussian density health (eta_health).
 * Exit Semantics & Design Rationale: Bounded 0.0-1.0 ratios, deterministic line analysis.
 */

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
    return Math.round((nonEloc / denominator) * 1000) / 1000;
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
    return Math.round(health * 1000) / 1000;
}

/**
 * Calculates effective code density and noise metrics across source content.
 *
 * @param content - Source code text to analyze.
 * @param _language - Optional programming language tag.
 * @returns Breakdown of useful LOC, boilerplate LOC, density ratio, noise index, and health.
 */
export function computeEffectiveCodeDensity(
    content: string,
    _language: string = 'typescript',
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

        const trimmed = line.trim();
        // Check single-line stubs or forwarding calls
        if (isTrivialForwarder(trimmed)) {
            boilerplateLoc += 1;
            forwardingCount++;
        } else if (
            trimmed === '{' ||
            trimmed === '}' ||
            trimmed === 'return;' ||
            trimmed === 'pass' ||
            trimmed.includes('throw new Error("Not implemented")')
        ) {
            boilerplateLoc += 0.5;
        }
    }

    const usefulLoc = Math.max(0, totalLoc - Math.floor(boilerplateLoc));
    const effectiveDensity = totalLoc > 0 ? Math.round((usefulLoc / totalLoc) * 100) / 100 : 1.0;
    const noiseIndex = calculateNoiseIndex(totalLoc, usefulLoc);
    const gaussianHealth = calculateGaussianDensityHealth(noiseIndex);

    return {
        totalLoc,
        usefulLoc,
        boilerplateLoc: Math.floor(boilerplateLoc),
        forwardingCount,
        effectiveDensity,
        noiseIndex,
        gaussianHealth,
        isLowDensity: totalLoc >= 15 && effectiveDensity < 0.55,
    };
}
