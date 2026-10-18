/**
 * Module: Unit Tests — Normalized Compression Distance (NCD)
 * File Path: tests/unit/intelligence/compression-distance.test.ts
 * Architecture Role: Verifies universal information distance, code normalization,
 *   deflate byte sizing, and structural clone classification under Cilibrasi-Vitányi's NCD metric.
 * Dependencies & Triggers: Imports normalizeCodeForCompression and computeNormalizedCompressionDistance;
 *   executed under vitest test runner (`npm run test:unit` or `npm test`).
 * Responsibilities:
 *   1. Assert comment and whitespace stripping across multi-language syntax.
 *   2. Assert near-zero self-similarity NCD(A, A) <= 0.05.
 *   3. Assert near-clone detection on structural duplicates with altered variable names.
 *   4. Assert high distance NCD(A, B) > 0.45 on structurally orthogonal implementations.
 *   5. Assert graceful zero-length and empty edge cases.
 * Exit Semantics & Design Rationale: Deterministic in-memory unit tests; verifies that universal
 *   compression distance detects Type-3/Type-4 clones without requiring language-specific ASTs.
 */

import { describe, it, expect } from 'vitest';
import {
    normalizeCodeForCompression,
    getCompressedByteLength,
    computeNormalizedCompressionDistance,
} from '../../../src/core/intelligence/compression-distance';

describe('normalizeCodeForCompression', () => {
    it('strips block comments, line comments, and python hash comments', () => {
        const raw = `
        /* Block comment header */
        function compute(a: number): number {
            // Line comment explanation
            const x = a * 2; # python style comment
            return x + 1;
        }
        `;
        const normalized = normalizeCodeForCompression(raw, false);
        expect(normalized).not.toContain('Block comment header');
        expect(normalized).not.toContain('Line comment explanation');
        expect(normalized).not.toContain('python style comment');
        expect(normalized).toContain('function compute(a: number): number');
        expect(normalized).not.toMatch(/\s{2,}/);

        const abstracted = normalizeCodeForCompression(raw, true);
        expect(abstracted).toContain('function $v($v: number): number');
    });

    it('handles empty or whitespace-only code strings gracefully', () => {
        expect(normalizeCodeForCompression('')).toBe('');
        expect(normalizeCodeForCompression('   \n\t  ')).toBe('');
    });
});

describe('computeNormalizedCompressionDistance', () => {
    const codeSnippetA = `
        function calculateFibonacci(n: number): number {
            if (n <= 1) return n;
            let a = 0;
            let b = 1;
            for (let i = 2; i <= n; i++) {
                const c = a + b;
                a = b;
                b = c;
            }
            return b;
        }
    `;

    // Structurally identical with renamed identifiers and minor constant differences
    const codeSnippetNearClone = `
        function computeFib(count: number): number {
            if (count <= 1) return count;
            let first = 0;
            let second = 1;
            for (let idx = 2; idx <= count; idx++) {
                const temp = first + second;
                first = second;
                second = temp;
            }
            return second;
        }
    `;

    // Completely unrelated code (matrix transpose)
    const codeSnippetUnrelated = `
        export function transposeMatrix(matrix: number[][]): number[][] {
            const rows = matrix.length;
            const cols = matrix[0].length;
            const result: number[][] = [];
            for (let j = 0; j < cols; j++) {
                const newRow: number[] = [];
                for (let i = 0; i < rows; i++) {
                    newRow.push(matrix[i][j]);
                }
                result.push(newRow);
            }
            return result;
        }
    `;

    it('demonstrates identity and reflexivity: NCD(A, A) is zero', () => {
        const result = computeNormalizedCompressionDistance(codeSnippetA, codeSnippetA);
        expect(result.ncd).toBe(0.0);
        expect(result.isNearClone).toBe(true);
        expect(result.similarityCategory).toBe('exact');
    });

    it('detects structural near-clone across renamed identifiers (NCD <= 0.28)', () => {
        const result = computeNormalizedCompressionDistance(codeSnippetA, codeSnippetNearClone);
        expect(result.ncd).toBeLessThanOrEqual(0.28);
        expect(result.isNearClone).toBe(true);
        expect(['exact', 'near_clone']).toContain(result.similarityCategory);
    });

    it('assigns high distance to structurally orthogonal algorithms (NCD > 0.45)', () => {
        const result = computeNormalizedCompressionDistance(codeSnippetA, codeSnippetUnrelated);
        expect(result.ncd).toBeGreaterThan(0.45);
        expect(result.isNearClone).toBe(false);
        expect(['related', 'distinct']).toContain(result.similarityCategory);
    });

    it('handles empty and boundary snippets without throwing or NaN', () => {
        const emptyResult = computeNormalizedCompressionDistance('', '');
        expect(emptyResult.ncd).toBe(0.0);
        expect(emptyResult.isNearClone).toBe(true);

        const oneEmptyResult = computeNormalizedCompressionDistance(codeSnippetA, '');
        expect(oneEmptyResult.ncd).toBe(1.0);
        expect(oneEmptyResult.isNearClone).toBe(false);
    });
});
