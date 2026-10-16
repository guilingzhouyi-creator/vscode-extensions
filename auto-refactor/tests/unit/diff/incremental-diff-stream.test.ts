import { describe, it, expect } from 'vitest';
import {
    IncrementalDiffStream,
    gridRow,
    computeGridRowSpan,
    countStreamLines,
} from '../../../src/diff/incremental-diff-stream';

describe('IncrementalDiffStream (Streaming Diff Pipeline & Layout)', () => {
    describe('CSS Grid Row Span Helper (gridRow)', () => {
        it('formats grid row span strings correctly', () => {
            expect(gridRow(1)).toBe('span 1');
            expect(gridRow(3)).toBe('span 3');
            expect(gridRow(12)).toBe('span 12');
        });

        it('clamps non-positive or invalid line counts to minimum span 1', () => {
            expect(gridRow(0)).toBe('span 1');
            expect(gridRow(-5)).toBe('span 1');
            expect(computeGridRowSpan(0)).toBe('span 1');
        });
    });

    describe('Single-pass line counter (countStreamLines)', () => {
        it('counts physical lines accurately without memory allocations', () => {
            expect(countStreamLines('')).toBe(0);
            expect(countStreamLines('single line')).toBe(1);
            expect(countStreamLines('line 1\nline 2\nline 3')).toBe(3);
            expect(countStreamLines('trailing newline\n')).toBe(2);
        });
    });

    describe('Prefix Coherence & Incremental Delta Slicing', () => {
        it('detects prefix coherence e.startsWith(lastChunk) and slices e.slice(lastChunk.length)', () => {
            const stream = new IncrementalDiffStream();

            const res1 = stream.processChunk('function hello() {');
            expect(res1.isPrefixCoherent).toBe(false);
            expect(res1.delta).toBe('function hello() {');
            expect(res1.deltaLength).toBe(18);

            const cumulativeChunk2 = 'function hello() {\n  return 42;\n}';
            const res2 = stream.processChunk(cumulativeChunk2);
            expect(res2.isPrefixCoherent).toBe(true);
            expect(res2.delta).toBe('\n  return 42;\n}');
            expect(res2.gridRowSpan).toBe('span 3');
            expect(stream.getAccumulatedContent()).toBe(cumulativeChunk2);
        });

        it('handles incremental disjoint chunk streaming', () => {
            const stream = new IncrementalDiffStream();

            const res1 = stream.write('const a = 1;\n');
            expect(res1.delta).toBe('const a = 1;\n');

            const res2 = stream.write('const b = 2;\n');
            expect(res2.delta).toBe('const b = 2;\n');
            expect(res2.isPrefixCoherent).toBe(false);

            expect(stream.getAccumulatedContent()).toBe('const a = 1;\nconst b = 2;\n');
            expect(stream.getTotalLines()).toBe(4);
        });

        it('tracks stream lifetime metrics and supports reset', () => {
            const stream = new IncrementalDiffStream();
            stream.write('alpha\n');
            stream.write('beta\n');
            expect(stream.getChunkCount()).toBe(2);
            expect(stream.getTotalLines()).toBe(4);

            stream.reset();
            expect(stream.getChunkCount()).toBe(0);
            expect(stream.getTotalLines()).toBe(0);
            expect(stream.getAccumulatedContent()).toBe('');
            expect(stream.getLastChunk()).toBe('');
        });
    });
});
