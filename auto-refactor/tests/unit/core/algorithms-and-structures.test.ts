/**
 * Module: Unit Test — Core Algorithms & Standard Data Structures Suite
 * File Path: tests/unit/core/algorithms-and-structures.test.ts
 * Architecture Role: Comprehensive unit test suite for newly unified graph algorithms,
 *   hashing primitives, text metrics, set algebra, and generic data structure containers.
 * Dependencies & Triggers: vitest, src/core/algorithms, src/core/data-structures, src/core/math.
 * Responsibilities:
 *   1. Assert mathematical accuracy of descriptive statistics (mean, variance, stddev, quantiles);
 *   2. Assert hashing algorithm outputs and invariants (FNV-1a 32/64, DJB2, JavaHash);
 *   3. Assert text metric scans (indentation levels, brace balance deltas, stream lines);
 *   4. Assert set theory algebra (Jaccard similarity, intersection, union, difference);
 *   5. Assert directed graph algorithms (Kahn topo sort, 3-color DFS cycle detection, Warshall);
 *   6. Assert data structures (O(1) LruCache eviction, bitwise RingBuffer, IdInterner).
 * Exit Semantics & Design Rationale: Standard vitest suite; 100% deterministic assertion coverage.
 */

import { describe, it, expect } from 'vitest';
import {
    computeMean,
    computeVariance,
    computeStandardDeviation,
    computeStatisticalMoments,
    computeQuantile,
    computeMedian,
    computeInterquartileRange,
} from '../../../src/core/math/descriptive-statistics';
import {
    fnv1a32,
    fnv1a32Signed,
    fnv1a64,
    djb2,
    javaHash,
    hashLines,
    FNV1A_32_OFFSET_BASIS,
} from '../../../src/core/algorithms/hash';
import {
    measureIndentationDepth,
    countBraceDelta,
    countBracesDetailed,
    countStreamLines,
} from '../../../src/core/algorithms/text-metrics';
import {
    computeJaccardSimilarity,
    computeSetIntersection,
    computeSetUnion,
    computeSetDifference,
    areSetsEqual,
} from '../../../src/core/algorithms/set-algebra';
import {
    detectGraphCycles,
    computeTopologicalOrder,
    bfsTransitiveClosure,
    computeWarshallTransitiveClosure,
} from '../../../src/core/algorithms/graph';
import { LruCache } from '../../../src/core/data-structures/lru-cache';
import { RingBuffer } from '../../../src/core/data-structures/ring-buffer';
import { IdInterner } from '../../../src/core/data-structures/id-interner';

describe('Core Math — Descriptive Statistics', () => {
    it('computes mean, variance, and standard deviation accurately', () => {
        const sample = [10, 20, 30, 40, 50];
        expect(computeMean(sample)).toBe(30);
        expect(computeVariance(sample)).toBe(200);
        expect(computeStandardDeviation(sample)).toBeCloseTo(14.1421, 3);

        const moments = computeStatisticalMoments(sample);
        expect(moments.mean).toBe(30);
        expect(moments.variance).toBe(200);
        expect(moments.standardDeviation).toBeCloseTo(14.1421, 3);
        expect(moments.count).toBe(5);
    });

    it('handles empty and degenerate statistical inputs safely', () => {
        expect(computeMean([])).toBe(0);
        expect(computeVariance([])).toBe(0);
        expect(computeStandardDeviation([])).toBe(0);

        const moments = computeStatisticalMoments([]);
        expect(moments.count).toBe(0);
        expect(moments.mean).toBe(0);
    });

    it('computes empirical quantiles, median, and IQR', () => {
        const sample = [1, 2, 3, 4, 5, 6, 7, 8, 9];
        expect(computeMedian(sample)).toBe(5);
        expect(computeQuantile(sample, 0.25)).toBe(3);
        expect(computeQuantile(sample, 0.75)).toBe(7);
        expect(computeInterquartileRange(sample)).toBe(4);
    });
});

describe('Core Algorithms — Hashing Primitives', () => {
    it('computes FNV-1a 32-bit hashes matching known invariants', () => {
        expect(fnv1a32('')).toBe(FNV1A_32_OFFSET_BASIS >>> 0);
        const hashFoo = fnv1a32('foo');
        const hashBar = fnv1a32('bar');
        expect(typeof hashFoo).toBe('number');
        expect(hashFoo).not.toBe(hashBar);
        expect(fnv1a32Signed('foo')).toBe(hashFoo | 0);

        const lines = ['const a = 1;', 'const b = 2;'];
        const lineHashes = hashLines(lines);
        expect(lineHashes.length).toBe(2);
        expect(lineHashes[0]).toBe(fnv1a32(lines[0]));
        expect(lineHashes[1]).toBe(fnv1a32(lines[1]));
    });

    it('computes FNV-1a 64-bit BigInt hashes', () => {
        const h64 = fnv1a64('semantic_token');
        expect(typeof h64).toBe('bigint');
        expect(h64 > 0n).toBe(true);
    });

    it('computes DJB2 and Java polynomial hashes deterministically', () => {
        expect(djb2('hello')).toBe(djb2('hello'));
        expect(javaHash('hello')).toBe(javaHash('hello'));
        expect(javaHash('')).toBe(0);
    });
});

describe('Core Algorithms — Text Metrics', () => {
    it('measures indentation depth with spaces and tabs', () => {
        expect(measureIndentationDepth('    const x = 1;')).toBe(1);
        expect(measureIndentationDepth('        const x = 1;')).toBe(2);
        expect(measureIndentationDepth('\tconst x = 1;', 4)).toBe(1);
        expect(measureIndentationDepth('  \tconst x = 1;', 4)).toBe(1); // 2 spaces + 4 = 6 -> floor(6/4) = 1
        expect(measureIndentationDepth('const x = 1;')).toBe(0);
    });

    it('counts curly brace deltas and detailed balance', () => {
        expect(countBraceDelta('{ a: 1 }')).toBe(0);
        expect(countBraceDelta('function() { if (true) {')).toBe(2);
        expect(countBraceDelta('}}')).toBe(-2);

        const detailed = countBracesDetailed('function() { return { x: 1 }; }');
        expect(detailed.opens).toBe(2);
        expect(detailed.closes).toBe(2);
        expect(detailed.delta).toBe(0);
    });

    it('counts stream lines without intermediate splits', () => {
        expect(countStreamLines('')).toBe(0);
        expect(countStreamLines('one line')).toBe(1);
        expect(countStreamLines('line 1\nline 2\nline 3')).toBe(3);
    });
});

describe('Core Algorithms — Set Algebra', () => {
    it('computes exact Jaccard similarity', () => {
        const setA = new Set(['a', 'b', 'c']);
        const setB = new Set(['b', 'c', 'd']);
        // intersection: 2 ('b','c'), union: 4 ('a','b','c','d') -> 2/4 = 0.5
        expect(computeJaccardSimilarity(setA, setB)).toBe(0.5);
        expect(computeJaccardSimilarity(new Set(), new Set())).toBe(1.0);
        expect(computeJaccardSimilarity(setA, new Set())).toBe(0.0);
    });

    it('computes set intersection, union, and difference', () => {
        const setA = new Set([1, 2, 3]);
        const setB = new Set([2, 3, 4]);

        expect(Array.from(computeSetIntersection(setA, setB)).sort()).toEqual([2, 3]);
        expect(Array.from(computeSetUnion(setA, setB)).sort()).toEqual([1, 2, 3, 4]);
        expect(Array.from(computeSetDifference(setA, setB)).sort()).toEqual([1]);
        expect(areSetsEqual(setA, new Set([1, 2, 3]))).toBe(true);
        expect(areSetsEqual(setA, setB)).toBe(false);
    });
});

describe('Core Algorithms — Directed Graph', () => {
    it('detects cycles using iterative 3-color DFS', () => {
        const graph: Record<string, string[]> = {
            a: ['b'],
            b: ['c'],
            c: ['a', 'd'],
            d: [],
        };
        const cycles = detectGraphCycles(['a'], (node) => graph[node] || []);
        expect(cycles.length).toBeGreaterThan(0);
        expect(cycles[0][0]).toBe(cycles[0][cycles[0].length - 1]);
    });

    it('computes Kahn topological order on DAG', () => {
        const graph: Record<string, string[]> = {
            a: ['b', 'c'],
            b: ['d'],
            c: ['d'],
            d: [],
        };
        const order = computeTopologicalOrder(['a', 'b', 'c', 'd'], (node) => graph[node] || []);
        expect(order).not.toBeNull();
        expect(order!.indexOf('a')).toBeLessThan(order!.indexOf('b'));
        expect(order!.indexOf('b')).toBeLessThan(order!.indexOf('d'));
        expect(order!.indexOf('c')).toBeLessThan(order!.indexOf('d'));
    });

    it('returns null for topological order when graph contains cycle', () => {
        const cyclicGraph: Record<string, string[]> = {
            a: ['b'],
            b: ['a'],
        };
        const order = computeTopologicalOrder(['a', 'b'], (node) => cyclicGraph[node] || []);
        expect(order).toBeNull();
    });

    it('computes reachable BFS transitive closure with depth bounds', () => {
        const graph: Record<string, string[]> = {
            a: ['b'],
            b: ['c'],
            c: ['d'],
            d: [],
        };
        const closureDepth1 = bfsTransitiveClosure(['a'], (n) => graph[n] || [], 1);
        expect(Array.from(closureDepth1).sort()).toEqual(['a', 'b']);

        const fullClosure = bfsTransitiveClosure(['a'], (n) => graph[n] || []);
        expect(Array.from(fullClosure).sort()).toEqual(['a', 'b', 'c', 'd']);
    });

    it('computes Warshall matrix transitive closure', () => {
        // 3 nodes: 0 -> 1, 1 -> 2 (should infer 0 -> 2)
        const matrix = new Uint8Array([
            0, 1, 0,
            0, 0, 1,
            0, 0, 0,
        ]);
        computeWarshallTransitiveClosure(matrix, 3);
        expect(matrix[0 * 3 + 2]).toBe(1); // 0 -> 2 is reachable
    });
});

describe('Core Data Structures — LRU Cache, RingBuffer, IdInterner', () => {
    it('LruCache enforces strict O(1) eviction and access refresh', () => {
        const evicted: string[] = [];
        const cache = new LruCache<string, number>({
            capacity: 3,
            onEvict: (k) => evicted.push(k),
        });

        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);

        // Access 'a' to refresh recency
        expect(cache.get('a')).toBe(1);

        // Insert 'd', should evict oldest un-accessed: 'b'
        cache.set('d', 4);
        expect(evicted).toEqual(['b']);
        expect(cache.has('b')).toBe(false);
        expect(cache.has('a')).toBe(true);
        expect(cache.has('c')).toBe(true);
        expect(cache.has('d')).toBe(true);
    });

    it('RingBuffer enforces power-of-two capacity, FIFO order, and overflow policies', () => {
        const ring = new RingBuffer<number>({ capacity: 5, policy: 'drop_oldest' });
        expect(ring.capacity).toBe(8); // Normalized to next power of 2

        for (let i = 1; i <= 8; i++) {
            ring.push(i);
        }
        expect(ring.isFull).toBe(true);

        // Push 9th item -> drops 1, oldest is now 2
        ring.push(9);
        expect(ring.size).toBe(8);
        expect(ring.pop()).toBe(2);
        expect(ring.peek()).toBe(3);

        const drained: number[] = [];
        ring.drainInto(drained);
        expect(drained).toEqual([3, 4, 5, 6, 7, 8, 9]);
        expect(ring.isEmpty).toBe(true);
    });

    it('IdInterner assigns contiguous 0-based indices and supports O(1) reverse lookup', () => {
        const interner = new IdInterner<string>();
        const idA = interner.intern('alpha');
        const idB = interner.intern('beta');
        const idA2 = interner.intern('alpha');

        expect(idA).toBe(0);
        expect(idB).toBe(1);
        expect(idA2).toBe(0);
        expect(interner.size).toBe(2);

        expect(interner.getItem(0)).toBe('alpha');
        expect(interner.getItem(1)).toBe('beta');
        expect(interner.getItem(2)).toBeUndefined();
    });
});
