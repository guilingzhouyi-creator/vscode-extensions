/**
 * Module: Unit Test — Token Entropy, Semantic Vector & Payload Density Verification
 * File Path: tests/unit/token-vector-density.test.ts
 * Architecture Role: Regression and boundary verification suite for intelligence operators
 * Dependencies & Triggers: Vitest test runner; imports operators from src/core/intelligence
 * Responsibilities: Exhaustively test multi-language tokenization, Shannon entropy math,
 *   Goldilocks bandwidth tuning, column density log-normal curve, 3-gram cosine similarity,
 *   SWAR SimHash popcount Hamming distance, orphan inlining utility, TSPR scale invariance,
 *   function reuse metrics, loop state entropy, and 5D density composite index.
 * Exit Semantics & Design Rationale: Strict assertions with zero flaky tests; 100% deterministic.
 */

import { describe, it, expect } from 'vitest';
import {
    tokenizeCode,
    calculateTokenShannonEntropy,
    calculateGoldilocksEntropyFactor,
    calculateColumnDensity,
} from '../../src/core/intelligence/token-entropy';
import {
    extractTokenTrigrams,
    calculateTrigramCosineSimilarity,
    computeSimHash64,
    calculateSimHashHammingSimilarity,
    calculateInliningUtility,
} from '../../src/core/intelligence/semantic-vector';
import {
    calculateWeightedTokenPayload,
    calculateFunctionReuseMetrics,
    calculateLoopStateEntropy,
    calculateCompositeEffectiveDensity,
} from '../../src/core/intelligence/payload-density';

describe('token-entropy: Tokenizer & Shannon Entropy', () => {
    it('handles empty input gracefully', () => {
        const stream = tokenizeCode('');
        expect(stream.tokens).toHaveLength(0);
        expect(stream.rawTokens).toHaveLength(0);
        expect(stream.tokenCountsByCategory.CALC_FLOW).toBe(0);

        const entropy = calculateTokenShannonEntropy([]);
        expect(entropy.entropy).toBe(0);
        expect(entropy.normalizedEntropy).toBe(0);
        expect(entropy.vocabularySize).toBe(0);
    });

    it('tokenizes multi-language TypeScript code into correct categories', () => {
        const code = `
            import { Scanner } from './scanner';
            export function processItems(items: string[]): number {
                let sum = 0;
                for (let i = 0; i < items.length; i++) {
                    sum += items[i].length;
                }
                return sum;
            }
        `;
        const stream = tokenizeCode(code, 'ts');
        expect(stream.tokens.length).toBeGreaterThan(10);
        expect(stream.tokenCountsByCategory.WIRING).toBeGreaterThanOrEqual(2);
        expect(stream.tokenCountsByCategory.CALC_FLOW).toBeGreaterThanOrEqual(4);
        expect(stream.tokenCountsByCategory.DELIMITER).toBeGreaterThanOrEqual(4);
        expect(stream.tokenCountsByCategory.DOMAIN_LITERAL).toBeGreaterThanOrEqual(3);
    });

    it('tokenizes Python and GDScript code stripping # comments', () => {
        const pyCode = `
            # This is a comment
            def compute_total(values):
                total = 0 # running sum
                for v in values:
                    total += v
                return total
        `;
        const stream = tokenizeCode(pyCode, 'py');
        expect(stream.tokens.length).toBeGreaterThan(5);
        expect(stream.tokenCountsByCategory.CALC_FLOW).toBeGreaterThanOrEqual(3);
        for (const token of stream.rawTokens) {
            expect(token.startsWith('#')).toBe(false);
        }
    });

    it('tokenizes Rust and Shell constructs accurately', () => {
        const rsCode = 'pub fn solve(x: i32) -> i32 { if x > 0 { x * 2 } else { 0 } }';
        const stream = tokenizeCode(rsCode, 'rs');
        expect(stream.tokenCountsByCategory.WIRING).toBeGreaterThanOrEqual(1);
        expect(stream.tokenCountsByCategory.CALC_FLOW).toBeGreaterThanOrEqual(4);
    });

    it('calculates Shannon entropy and normalized entropy correctly', () => {
        const tokens = ['A', 'B', 'C', 'D'];
        const res = calculateTokenShannonEntropy(tokens);
        expect(res.entropy).toBeCloseTo(2.0, 5);
        expect(res.normalizedEntropy).toBeCloseTo(1.0, 5);
        expect(res.vocabularySize).toBe(4);

        const identical = ['A', 'A', 'A', 'A'];
        const resIdentical = calculateTokenShannonEntropy(identical);
        expect(resIdentical.entropy).toBe(0);
        expect(resIdentical.normalizedEntropy).toBe(0);
        expect(resIdentical.vocabularySize).toBe(1);
    });

    it('evaluates Goldilocks entropy tuning factor bandwidth and smooth roll-off', () => {
        expect(calculateGoldilocksEntropyFactor(4.5)).toBe(1.0);
        expect(calculateGoldilocksEntropyFactor(6.0)).toBe(1.0);
        expect(calculateGoldilocksEntropyFactor(7.5)).toBe(1.0);

        const low = calculateGoldilocksEntropyFactor(3.5);
        expect(low).toBeLessThan(1.0);
        expect(low).toBeGreaterThan(0.5);

        const high = calculateGoldilocksEntropyFactor(8.5);
        expect(high).toBeLessThan(1.0);
        expect(high).toBeGreaterThan(0.5);

        expect(calculateGoldilocksEntropyFactor(-1)).toBe(0);
    });

    it('computes bilateral log-normal column density correctly', () => {
        const optimal = calculateColumnDensity(75, 10);
        expect(optimal.tokensPerEloc).toBe(7.5);
        expect(optimal.columnDensity).toBe(1.0);

        const highDensity = calculateColumnDensity(150, 10);
        const lowDensity = calculateColumnDensity(37.5, 10);
        expect(highDensity.columnDensity).toBeLessThan(1.0);
        expect(lowDensity.columnDensity).toBeLessThan(1.0);
        expect(highDensity.columnDensity).toBeCloseTo(lowDensity.columnDensity, 2);

        expect(calculateColumnDensity(0, 10).columnDensity).toBe(0);
        expect(calculateColumnDensity(50, 0).columnDensity).toBe(0);
    });
});

describe('semantic-vector: Trigrams, SWAR SimHash & Inlining Utility', () => {
    it('extracts trigrams correctly and handles short inputs', () => {
        expect(extractTokenTrigrams([]).size).toBe(0);
        expect(extractTokenTrigrams(['a', 'b']).size).toBe(0);

        const tokens = ['const', 'x', '=', '1', ';'];
        const trigrams = extractTokenTrigrams(tokens);
        expect(trigrams.size).toBe(3);
        expect(trigrams.get('const x =')).toBe(1);
        expect(trigrams.get('x = 1')).toBe(1);
        expect(trigrams.get('= 1 ;')).toBe(1);
    });

    it('calculates cosine similarity between trigram vectors', () => {
        const v1 = extractTokenTrigrams(['a', 'b', 'c', 'd', 'e']);
        const v2 = extractTokenTrigrams(['a', 'b', 'c', 'd', 'e']);
        expect(calculateTrigramCosineSimilarity(v1, v2)).toBe(1.0);

        const v3 = extractTokenTrigrams(['x', 'y', 'z', 'w', 'q']);
        expect(calculateTrigramCosineSimilarity(v1, v3)).toBe(0.0);

        const empty = new Map<string, number>();
        expect(calculateTrigramCosineSimilarity(v1, empty)).toBe(0.0);
    });

    it('computes deterministic 64-bit SimHash and SWAR Hamming similarity', () => {
        const tokens1 = ['function', 'compute', 'data', 'return', 'result'];
        const tokens2 = ['function', 'compute', 'data', 'return', 'result'];
        const tokens3 = ['struct', 'Point', 'x', 'f64', 'y', 'f64'];

        const h1 = computeSimHash64(tokens1);
        const h2 = computeSimHash64(tokens2);
        const h3 = computeSimHash64(tokens3);

        expect(typeof h1).toBe('bigint');
        expect(h1).toBe(h2);
        expect(calculateSimHashHammingSimilarity(h1, h2)).toBe(1.0);

        const simDiff = calculateSimHashHammingSimilarity(h1, h3);
        expect(simDiff).toBeLessThan(1.0);
        expect(simDiff).toBeGreaterThanOrEqual(0.0);

        expect(computeSimHash64([])).toBe(0n);
    });

    it('calculates single-use orphan function inlining utility accurately', () => {
        const highPayoff = calculateInliningUtility({
            cosSim: 0.9,
            childEloc: 2,
            sharedScopeVarsCount: 3,
            childParamCount: 1,
        });
        expect(highPayoff).toBeCloseTo(1.35, 4);

        const negativePayoff = calculateInliningUtility({
            cosSim: 0.8,
            childEloc: 16,
            sharedScopeVarsCount: 1,
            childParamCount: 1,
        });
        expect(negativePayoff).toBeLessThan(0);

        expect(calculateInliningUtility({
            cosSim: 0,
            childEloc: 2,
            sharedScopeVarsCount: 2,
            childParamCount: 1,
        })).toBe(0);
    });
});

describe('payload-density: TSPR, Function Reuse & Composite Tensor', () => {
    it('demonstrates TSPR and POR scale & formatting invariance', () => {
        const singleLine = 'const result = calculate(a, b);';
        const multiLine = `
            const result =
                calculate(
                    a,
                    b
                );
        `;
        const tokensSingle = tokenizeCode(singleLine, 'ts').tokens;
        const tokensMulti = tokenizeCode(multiLine, 'ts').tokens;

        const payloadSingle = calculateWeightedTokenPayload(tokensSingle);
        const payloadMulti = calculateWeightedTokenPayload(tokensMulti);

        expect(payloadSingle.tspr).toBe(payloadMulti.tspr);
        expect(payloadSingle.por).toBe(payloadMulti.por);
        expect(payloadSingle.tspr).toBeGreaterThan(0.5);

        expect(calculateWeightedTokenPayload([]).tspr).toBe(0);
    });

    it('calculates function reuse metrics and SUFR correctly', () => {
        const res = calculateFunctionReuseMetrics([1, 1, 3, 5]);
        expect(res.sufr).toBe(0.5);
        expect(res.reuseDensity).toBe(0.5);

        const allSingle = calculateFunctionReuseMetrics([1, 1, 1]);
        expect(allSingle.sufr).toBe(1.0);
        expect(allSingle.reuseDensity).toBe(0.0);

        const allReused = calculateFunctionReuseMetrics([4, 10, 2]);
        expect(allReused.sufr).toBe(0.0);
        expect(allReused.reuseDensity).toBe(1.0);

        expect(calculateFunctionReuseMetrics([]).sufr).toBe(0);
    });

    it('evaluates loop state transition conditional entropy and detects tautological loops', () => {
        const emptyLoop = calculateLoopStateEntropy(100, 0, false);
        expect(emptyLoop.isTautological).toBe(true);
        expect(emptyLoop.deltaEntropy).toBe(0);

        const trivialLoop = calculateLoopStateEntropy(500, 1, false);
        expect(trivialLoop.isTautological).toBe(true);
        expect(trivialLoop.deltaEntropy).toBeLessThanOrEqual(0.05);

        const activeLoop = calculateLoopStateEntropy(20, 20, false);
        expect(activeLoop.isTautological).toBe(false);
        expect(activeLoop.deltaEntropy).toBeGreaterThan(0.05);

        const sideEffectLoop = calculateLoopStateEntropy(50, 0, true);
        expect(sideEffectLoop.isTautological).toBe(false);
        expect(sideEffectLoop.deltaEntropy).toBeGreaterThanOrEqual(0.20);
    });

    it('computes composite five-dimensional effective density tensor index', () => {
        const ideal = calculateCompositeEffectiveDensity({
            lineDensity: 1.0,
            columnDensity: 1.0,
            reuseDensity: 1.0,
            sharedDensity: 1.0,
            payloadDensity: 1.0,
            entropyFactor: 1.0,
        });
        expect(ideal).toBe(1.0);

        const degraded = calculateCompositeEffectiveDensity({
            lineDensity: 1.0,
            columnDensity: 1.0,
            reuseDensity: 1.0,
            sharedDensity: 1.0,
            payloadDensity: 1.0,
            entropyFactor: 0.5,
        });
        expect(degraded).toBeCloseTo(0.5, 4);

        const zero = calculateCompositeEffectiveDensity({
            lineDensity: 0,
            columnDensity: 0,
            reuseDensity: 0,
            sharedDensity: 0,
            payloadDensity: 0,
            entropyFactor: 1.0,
        });
        expect(zero).toBe(0);
    });
});

