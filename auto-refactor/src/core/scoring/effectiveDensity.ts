/**
 * Module: Core Scoring — Effective Code Density Calculation
 * File Path: src/core/scoring/effectiveDensity.ts
 * Architecture Role: Quantifies true semantic contribution versus maintained boilerplate,
 *   penalizing artificial function splitting, empty forwarding wrappers, and trivial getters.
 * Dependencies & Triggers: Pure function over source code string and language tag.
 * Responsibilities: Count total LOC, detect forwarding methods and trivial boilerplate,
 *   and compute effective code density ratio.
 * Exit Semantics & Design Rationale: Bounded 0.0-1.0 ratio, deterministic line analysis.
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
 * Calculates effective code density across source content.
 *
 * @param content - Source code text to analyze.
 * @param _language - Optional programming language tag.
 * @returns Breakdown of useful LOC, boilerplate LOC, and density ratio.
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

    return {
        totalLoc,
        usefulLoc,
        boilerplateLoc: Math.floor(boilerplateLoc),
        forwardingCount,
        effectiveDensity,
        isLowDensity: totalLoc >= 15 && effectiveDensity < 0.55,
    };
}
