/**
 * Module: Core Math — Information Entropy & Diversity Indices
 * File Path: src/core/math/information-entropy.ts
 * Architecture Role: Foundation information-theoretic metrics including Shannon entropy
 *   and Simpson diversity index for token analysis, compression estimation, and anti-gaming.
 * Dependencies & Triggers: Zero external dependencies; consumes standard IEEE 754 math.
 * Responsibilities:
 *   1. Calculate Shannon Information Entropy H(X) = -sum(p_i * log2(p_i))
 *      over character/token streams.
 *   2. Calculate Simpson Diversity Index D = 1 - sum(p_i^2) for distribution evenness.
 *   3. Defend against NaN and empty string edge cases with clean 0.0 fallbacks.
 * Exit Semantics & Design Rationale: Pure math functions; O(N) single-pass frequency count;
 *   zero side-effects; deterministic float rounded to 2 decimal places.
 */

const PRECISION_ROUNDING = 100;

/**
 * Computes Shannon Information Entropy of text or token sequences in bits:
 * H(X) = - sum_{i=1}^n p(x_i) * log_2(p(x_i))
 *
 * @param text - Input string or character stream.
 * @returns Shannon entropy in bits rounded to two decimal places (0.00 if empty).
 */
export function calculateShannonEntropy(text: string): number {
    if (!text || text.length === 0) return 0.0;
    const freqMap = new Map<string, number>();
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        freqMap.set(char, (freqMap.get(char) ?? 0) + 1);
    }
    const len = text.length;
    let entropy = 0.0;
    for (const count of freqMap.values()) {
        const probability = count / len;
        entropy -= probability * Math.log2(probability);
    }
    return Math.round(entropy * PRECISION_ROUNDING) / PRECISION_ROUNDING;
}

/**
 * Computes Simpson Diversity Index D:
 * D = 1 - sum_{i=1}^k (n_i / N)^2
 *
 * Values close to 1 represent high diversity / equilibrium; values close to 0 represent dominance.
 *
 * @param counts - Array of occurrence counts for each category.
 * @returns Diversity index bounded in [0.0, 1.0].
 */
export function calculateSimpsonDiversityIndex(counts: readonly number[]): number {
    if (!counts || counts.length === 0) return 0.0;
    let total = 0;
    for (const countItem of counts) {
        if (Number.isFinite(countItem) && countItem > 0) {
            total += countItem;
        }
    }
    if (total <= 1) return 0.0;

    let sumSquaredP = 0.0;
    for (const countItem of counts) {
        if (Number.isFinite(countItem) && countItem > 0) {
            const probability = countItem / total;
            sumSquaredP += probability * probability;
        }
    }
    const diversity = Math.max(0.0, Math.min(1.0, 1.0 - sumSquaredP));
    return Math.round(diversity * PRECISION_ROUNDING) / PRECISION_ROUNDING;
}
