/**
 * Module: Core Engine — Human-Readable Metric Parser
 * File Path: src/core/config/metric-parser.ts
 * Architecture Role: Dimension and metric parsing utility converting raw string/numeric arguments
 *   into normalized integer budgets across CLI flags and configuration thresholds.
 * Dependencies & Triggers: Consumed by cli-parser, config resolution, and threshold matrix.
 * Responsibilities:
 *   1. Parse metric values supporting metric suffixes (e.g., '800', '1k', '2.5k', '50k', '1M');
 *   2. Enforce non-negative integer normalisation with safe fallback on invalid inputs;
 *   3. Deliver deterministic, zero-allocation pure functional evaluation.
 * Exit Semantics & Design Rationale: Never throws; returns normalized integer or fallback.
 */

/** Metric suffix multiplier lookup table. */
export const MULTIPLIER_LOOKUP: Readonly<Record<string, number>> = {
    k: 1_000,
    K: 1_000,
    m: 1_000_000,
    M: 1_000_000,
};

/** Backward-compatible alias for metric multiplier table. */
export const SUFFIX_MULTIPLIERS = MULTIPLIER_LOOKUP;

/** Metric pattern with optional decimal point and case-insensitive suffix. */
const METRIC_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*([kKmM])?\s*$/;

/** Default fallback for line budget when parsing fails. */
export const DEFAULT_METRIC_FALLBACK = 800;

/**
 * Sanitizes and normalizes an arbitrary numeric input into a non-negative safe integer.
 *
 * @param val - Numeric value to sanitize.
 * @param fallback - Safe fallback integer when value is invalid, negative, or infinite.
 * @returns Rounded safe positive integer, or fallback.
 */
export function sanitizePositiveInt(val: number, fallback: number): number {
    if (!Number.isFinite(val) || val < 0) {
        return fallback;
    }
    const rounded = Math.round(val);
    return Number.isSafeInteger(rounded) ? rounded : fallback;
}

/**
 * Parses a string input with optional metric suffix into a positive integer.
 *
 * @param input - Metric string candidate.
 * @param fallback - Fallback value used when input is unparseable or negative.
 * @returns Normalized integer budget value.
 */
function parseStringMetric(input: string, fallback: number): number {
    const trimmed = input.trim();
    if (!trimmed) {
        return fallback;
    }

    const match = trimmed.match(METRIC_PATTERN);
    if (!match) {
        return fallback;
    }

    const rawNum = parseFloat(match[1]);
    const multiplier = match[2] ? (MULTIPLIER_LOOKUP[match[2]] ?? 1) : 1;
    return sanitizePositiveInt(rawNum * multiplier, fallback);
}

/**
 * Parses a human-readable metric string or raw number into a positive integer.
 *
 * Examples:
 *   parseHumanMetric(800)      => 800
 *   parseHumanMetric('800')    => 800
 *   parseHumanMetric('1k')     => 1000
 *   parseHumanMetric('2.5k')   => 2500
 *   parseHumanMetric('50k')    => 50000
 *   parseHumanMetric('0.5M')   => 500000
 *   parseHumanMetric('invalid', 800) => 800
 *
 * @param input - Numeric value or metric string with optional suffix (k, K, m, M).
 * @param fallback - Fallback value used when input is unparseable or negative.
 * @returns Normalized integer budget value.
 */
export function parseHumanMetric(
    input: string | number | undefined | null,
    fallback: number = DEFAULT_METRIC_FALLBACK,
): number {
    if (typeof input === 'number') {
        return sanitizePositiveInt(input, fallback);
    }
    if (typeof input === 'string') {
        return parseStringMetric(input, fallback);
    }
    return fallback;
}
