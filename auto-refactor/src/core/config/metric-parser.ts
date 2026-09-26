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

/** Metric suffix multiplier mapping table. */
const SUFFIX_MULTIPLIERS: Readonly<Record<string, number>> = {
    k: 1_000,
    K: 1_000,
    m: 1_000_000,
    M: 1_000_000,
};

/** Metric pattern with optional decimal point and case-insensitive suffix. */
const METRIC_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*([kKmM])?\s*$/;

/** Default fallback for line budget when parsing fails. */
export const DEFAULT_METRIC_FALLBACK = 800;

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
        if (!Number.isFinite(input) || input < 0) {
            return fallback;
        }
        return Math.round(input);
    }

    if (typeof input !== 'string') {
        return fallback;
    }

    const trimmed = input.trim();
    if (!trimmed) {
        return fallback;
    }

    const match = trimmed.match(METRIC_PATTERN);
    if (!match) {
        return fallback;
    }

    const rawNum = parseFloat(match[1]);
    if (!Number.isFinite(rawNum) || rawNum < 0) {
        return fallback;
    }

    const suffix = match[2];
    const multiplier = suffix ? (SUFFIX_MULTIPLIERS[suffix] ?? 1) : 1;
    const computed = Math.round(rawNum * multiplier);

    return Number.isSafeInteger(computed) ? computed : fallback;
}
