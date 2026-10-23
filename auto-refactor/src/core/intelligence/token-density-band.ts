/**
 * Module: Core Intelligence — Token Density Band Evaluator
 * File Path: src/core/intelligence/token-density-band.ts
 * Architecture Role: Pure band evaluator for the tau axis (semantic tokens per effective line),
 *   kept out of the large-file analyzer so the two vertical-layout signals stay separable.
 * Dependencies & Triggers: Consumes the Severity union from ../types; called by the large-file
 *   analyzer while it assembles its volume findings for one file.
 * Responsibilities: Decide whether a measured tau sits inside, below, or above the band; name the
 *   rule that fired and explain the measurement in the finding message.
 * Exit Semantics & Design Rationale: Pure, non-throwing, and allocation-free on the in-band path.
 *   Returns null rather than a finding when the measurement cannot support a verdict, so callers
 *   never have to distinguish "healthy" from "unmeasurable" themselves.
 */

import type { Severity } from '../types';

/** Rule id: token density floor — lines fragmented until each carries almost no payload. */
export const RULE_VOL_TAU_FLOOR = 'VOL-TAU-001';
/** Rule id: token density ceiling — one line packed with more concepts than a reader can hold. */
export const RULE_VOL_TAU_CEILING = 'VOL-TAU-002';

/**
 * Lowest semantic tokens per effective line a module may carry.
 *
 * Below this floor the vertical layout has been fragmented until each line holds a fragment rather
 * than a statement: a lone argument, a single closing bracket, a chained call split across five
 * lines. The threshold is not a style preference — it is the point where line count stops
 * predicting how much a reader has to understand.
 */
export const MIN_TOKENS_PER_ELOC = 2.5;

/** Highest semantic tokens per effective line a module may carry before a line is congested. */
export const MAX_TOKENS_PER_ELOC = 22.0;

/**
 * Effective lines below which the band carries no signal.
 *
 * A short module can legitimately average three tokens per line — a file that only declares a
 * discriminated union and one factory is not fragmented, it is small. The floor matches the one the
 * workspace density gate already applies, so the engine and the gate never disagree about which
 * files the band speaks for.
 */
export const MIN_TAU_SAMPLE_ELOC = 10;

/** One band verdict: which rule fired, at what severity, and how to explain it. */
export interface TokenDensityFinding {
    readonly rule: string;
    readonly severity: Severity;
    readonly message: string;
    readonly suggestion: string;
}

const SEVERITY_WARNING: Severity = 'warning';

const SUGGESTION_COMPACT =
    'Collapse vertically fragmented calls and declarations onto cohesive statements, and pass four or more parameters as a single parameter object.';
const SUGGESTION_SPLIT =
    'Extract intermediate variables from monolithic chained expressions and spread nested logic across dedicated lines.';

/**
 * Evaluate the token-density band for one module.
 *
 * This is a different signal from the dilution envelope even though both describe vertical layout:
 * dilution compares effective lines against physical lines, while this band compares semantic
 * tokens against effective lines. A module can pass dilution (most of its physical lines are code)
 * and still fail the floor here, because each of those lines carries a lone bracket or a single
 * argument.
 *
 * Missing data is not a measurement: when the tokenizer produced no tokens the ratio is unknown,
 * not zero, so the band declines to judge instead of reporting the worst possible score.
 *
 * @param tokensPerEloc - Measured semantic tokens per effective line, or undefined when unmeasured.
 * @param eloc - Effective lines of code the ratio was computed over.
 * @returns The band finding, or null when the module sits inside the band or cannot be judged.
 */
export function evaluateTokenDensityBand(
    tokensPerEloc: number | undefined,
    eloc: number,
): TokenDensityFinding | null {
    if (eloc < MIN_TAU_SAMPLE_ELOC) return null;
    if (tokensPerEloc === undefined || tokensPerEloc <= 0) return null;
    if (tokensPerEloc < MIN_TOKENS_PER_ELOC) {
        return {
            rule: RULE_VOL_TAU_FLOOR,
            severity: SEVERITY_WARNING,
            message:
                `Token density floor breached: tau = ${tokensPerEloc.toFixed(2)} tokens per effective line, ` +
                `below the ${MIN_TOKENS_PER_ELOC} floor across ${eloc} ELOC.`,
            suggestion: SUGGESTION_COMPACT,
        };
    }
    if (tokensPerEloc > MAX_TOKENS_PER_ELOC) {
        return {
            rule: RULE_VOL_TAU_CEILING,
            severity: SEVERITY_WARNING,
            message:
                `Token density ceiling breached: tau = ${tokensPerEloc.toFixed(2)} tokens per effective line, ` +
                `above the ${MAX_TOKENS_PER_ELOC} ceiling across ${eloc} ELOC.`,
            suggestion: SUGGESTION_SPLIT,
        };
    }
    return null;
}
