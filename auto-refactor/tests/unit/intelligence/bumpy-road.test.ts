/**
 * Module: Unit Tests — CodeScene Bumpy Road Complexity Analyzer
 * File Path: tests/unit/intelligence/bumpy-road.test.ts
 * Architecture Role: Verifies line-by-line structural depth profiling, spatial variance,
 *   alternating spikes quantification, Bumpy Road Index (BRI), and Campbell Cognitive Complexity.
 * Dependencies & Triggers: Imports measureLineIndentLevel, evaluateBumpyRoad, extractIndentationPeaks,
 *   computeBumpyRoadIndex, and calculateCognitiveComplexity from bumpy-road-analyzer;
 *   executed under vitest test runner (`npm run test:unit` or `npm test`).
 * Responsibilities:
 *   1. Assert single-line indentation measurement for space, tab, and mixed patterns.
 *   2. Assert graceful zero-score degradation on short spans or boundary violations.
 *   3. Assert flat functions with guard clauses produce near-zero variance and isBumpy=false.
 *   4. Assert deeply interleaved, zigzagging control flow triggers isBumpy=true, BRI, and recommendation.
 *   5. Assert extraction of discrete indentation peaks and span calculation.
 *   6. Assert Campbell Cognitive Complexity accumulation across branching layers.
 * Exit Semantics & Design Rationale: Deterministic in-memory unit tests; ensures mathematical
 *   invariants of spatial variance, peak detection, and cognitive load hold across platforms.
 */

import { describe, it, expect } from 'vitest';
import {
    measureLineIndentLevel,
    evaluateBumpyRoad,
    extractIndentationPeaks,
    computeBumpyRoadIndex,
    calculateCognitiveComplexity,
} from '../../../src/core/intelligence/bumpy-road-analyzer';

describe('measureLineIndentLevel', () => {
    it('computes indentation level accurately across tabs and spaces', () => {
        expect(measureLineIndentLevel('const a = 1;')).toBe(0);
        expect(measureLineIndentLevel('    const a = 1;')).toBe(1);
        expect(measureLineIndentLevel('        const a = 1;')).toBe(2);
        expect(measureLineIndentLevel('\tconst a = 1;')).toBe(1);
        expect(measureLineIndentLevel('\t    const a = 1;')).toBe(2);
    });
});

describe('evaluateBumpyRoad', () => {
    it('degrades gracefully to zero score on short functions (< 20 lines)', () => {
        const shortLines = ['function shortFn() {', '    const x = 1;', '    return x;', '}'];
        const result = evaluateBumpyRoad(shortLines, 1, 4);
        expect(result.bumpyScore).toBe(0.0);
        expect(result.isBumpy).toBe(false);
        expect(result.spikesCount).toBe(0);
    });

    it('handles boundary violations safely without throwing', () => {
        const lines = ['function fn() {', '    return 1;', '}'];
        expect(evaluateBumpyRoad([], 1, 5).isBumpy).toBe(false);
        expect(evaluateBumpyRoad(lines, -1, 2).isBumpy).toBe(false);
        expect(evaluateBumpyRoad(lines, 1, 100).isBumpy).toBe(false);
    });

    it('classifies flat guard-clause function as non-bumpy', () => {
        const flatLines: string[] = ['function flatProcessor(items: number[]) {'];
        for (let i = 0; i < 25; i++) {
            flatLines.push(`    if (!items[${i}]) return;`);
        }
        flatLines.push('    return items.length;');
        flatLines.push('}');

        const result = evaluateBumpyRoad(flatLines, 1, flatLines.length);
        expect(result.isBumpy).toBe(false);
        expect(result.spikesCount).toBe(0);
        expect(result.varianceDepth).toBeLessThan(1.0);
        expect(result.recommendation).toBeUndefined();
    });

    it('detects bumpy road pattern on deeply interleaved nested control flow', () => {
        const bumpyLines: string[] = ['function bumpyProcessor(data: any[][]) {'];
        // Zigzag between depth 1 and depth 3/4 repeatedly
        for (let i = 0; i < 6; i++) {
            bumpyLines.push('    for (const row of data) {');
            bumpyLines.push('            if (row.length > 0) {');
            bumpyLines.push('                while (row.pop()) {');
            bumpyLines.push('                    processCell();');
            bumpyLines.push('                }');
            bumpyLines.push('            }');
            bumpyLines.push('    }');
            bumpyLines.push('    resetCursor();');
        }
        bumpyLines.push('}');

        const result = evaluateBumpyRoad(bumpyLines, 1, bumpyLines.length);
        expect(result.isBumpy).toBe(true);
        expect(result.bumpyScore).toBeGreaterThanOrEqual(12.0);
        expect(result.spikesCount).toBeGreaterThanOrEqual(3);
        expect(result.varianceDepth).toBeGreaterThan(0.5);
        expect(result.bumpyRoadIndex).toBeGreaterThan(0);
        expect(result.recommendation).toContain('Bumpy Road detected');
    });
});

describe('extractIndentationPeaks and computeBumpyRoadIndex', () => {
    it('extracts discrete structural peaks and computes Tornhill BRI', () => {
        const lines = [
            'function processMatrix() {',
            '    const x = 1;',
            '    for (let i = 0; i < 10; i++) {',
            '        if (i % 2 === 0) {',
            '            while (x > 0) {',
            '                doSomething();',
            '            }',
            '        }',
            '    }',
            '    return x;',
            '}',
        ];
        const peaks = extractIndentationPeaks(lines, 1, lines.length);
        expect(peaks.length).toBeGreaterThan(0);
        expect(peaks[0].depth).toBeGreaterThanOrEqual(2);
        expect(peaks[0].span).toBeGreaterThanOrEqual(1);

        const bri = computeBumpyRoadIndex(peaks);
        expect(bri).toBeGreaterThan(0);
    });
});

describe('calculateCognitiveComplexity', () => {
    it('accumulates cognitive complexity with progressive nesting penalty', () => {
        const code = [
            'function evaluate(a: number, b: number): number {',
            '    if (a > 0) {',
            '        if (b > 0) {',
            '            for (let i = 0; i < 10; i++) {',
            '                if (i === 5) return i;',
            '            }',
            '        }',
            '    }',
            '    return 0;',
            '}',
        ];
        const cognitive = calculateCognitiveComplexity(code, 1, code.length);
        // Level 0 if: 1
        // Level 1 if: 1 + 1 = 2
        // Level 2 for: 1 + 2 = 3
        // Level 3 if: 1 + 3 = 4
        // Total = 10
        expect(cognitive).toBeGreaterThanOrEqual(8);
    });

    it('returns zero on flat linear execution without branching', () => {
        const flatCode = [
            'function add(a: number, b: number): number {',
            '    const sum = a + b;',
            '    const doubled = sum * 2;',
            '    return doubled;',
            '}',
        ];
        expect(calculateCognitiveComplexity(flatCode, 1, flatCode.length)).toBe(0);
    });
});
