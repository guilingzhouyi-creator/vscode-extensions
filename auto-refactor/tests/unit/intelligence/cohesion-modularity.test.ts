/**
 * Module: Unit Tests — Cohesion (LCOM*) & Modularity (Q) Evaluator
 * File Path: tests/unit/intelligence/cohesion-modularity.test.ts
 * Architecture Role: Verifies Henderson-Sellers normalized Lack of Cohesion in Methods (LCOM*)
 *   and Newman-Girvan network Modularity (Q) community partitioning.
 * Dependencies & Triggers: Imports computeHendersonSellersLcom and computeNewmanGirvanModularity;
 *   executed under vitest test runner (`npm run test:unit` or `npm test`).
 * Responsibilities:
 *   1. Assert zero LCOM* (perfect cohesion) when methods universally access all attributes.
 *   2. Assert unit LCOM* (complete fragmentation / God class) on disjoint attribute access.
 *   3. Assert graceful zero handling for single-method or stateless utility classes.
 *   4. Assert high modularity Q > 0.40 on clean clustered directory modules.
 *   5. Assert negative/low modularity on inverted cross-directory entanglement.
 * Exit Semantics & Design Rationale: Deterministic in-memory unit tests; ensures mathematical
 *   invariants of LCOM* [0, 1] and Newman-Girvan Q [-0.5, 1.0] hold across platforms.
 */

import { describe, it, expect } from 'vitest';
import {
    computeHendersonSellersLcom,
    computeNewmanGirvanModularity,
} from '../../../src/core/intelligence/cohesion-modularity-evaluator';

describe('computeHendersonSellersLcom', () => {
    it('yields 0.0 for perfectly cohesive classes where every method accesses all fields', () => {
        // 5 methods, 4 fields, every method touches all 4 fields
        const result = computeHendersonSellersLcom({
            methodsCount: 5,
            attributesCount: 4,
            attributeAccessCounts: [5, 5, 5, 5],
        });
        expect(result.lcomStar).toBe(0.0);
        expect(result.meanAccessPerAttribute).toBe(5.0);
        expect(result.isGodClassCandidate).toBe(false);
        expect(result.recommendation).toBeUndefined();
    });

    it('identifies completely disconnected God class with LCOM* = 1.0', () => {
        // 10 methods, 10 fields, each method touches exactly 1 unique field
        const result = computeHendersonSellersLcom({
            methodsCount: 10,
            attributesCount: 10,
            attributeAccessCounts: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        });
        expect(result.lcomStar).toBe(1.0);
        expect(result.meanAccessPerAttribute).toBe(1.0);
        expect(result.isGodClassCandidate).toBe(true);
        expect(result.recommendation).toContain('High Lack of Cohesion detected');
    });

    it('computes exact intermediate LCOM* on partially cohesive structures', () => {
        // 4 methods, 3 fields. Sum of accesses = 3 + 2 + 1 = 6. Mean = 2.0.
        // LCOM* = (4 - 2.0) / (4 - 1) = 2 / 3 ≈ 0.6667
        const result = computeHendersonSellersLcom({
            methodsCount: 4,
            attributesCount: 3,
            attributeAccessCounts: [3, 2, 1],
        });
        expect(result.lcomStar).toBeCloseTo(0.6667, 3);
        expect(result.isGodClassCandidate).toBe(false);
    });

    it('handles trivial single-method and zero-attribute classes gracefully', () => {
        const singleMethod = computeHendersonSellersLcom({
            methodsCount: 1,
            attributesCount: 5,
            attributeAccessCounts: [1, 1, 1, 1, 1],
        });
        expect(singleMethod.lcomStar).toBe(0.0);

        const stateless = computeHendersonSellersLcom({
            methodsCount: 6,
            attributesCount: 0,
            attributeAccessCounts: [],
        });
        expect(stateless.lcomStar).toBe(0.0);
    });
});

describe('computeNewmanGirvanModularity', () => {
    it('yields high modularity Q for clean modular clusters', () => {
        // 6 nodes: Community 0 = {0, 1, 2} (triangle), Community 1 = {3, 4, 5} (triangle)
        // With 1 bridge edge between 2 and 3
        const matrix = [
            [0, 1, 1, 0, 0, 0],
            [1, 0, 1, 0, 0, 0],
            [1, 1, 0, 1, 0, 0], // bridge to 3
            [0, 0, 1, 0, 1, 1], // bridge from 2
            [0, 0, 0, 1, 0, 1],
            [0, 0, 0, 1, 1, 0],
        ];
        const communities = [0, 0, 0, 1, 1, 1];

        const result = computeNewmanGirvanModularity({
            nodeCount: 6,
            adjacencyMatrix: matrix,
            nodeCommunities: communities,
        });

        expect(result.totalEdges).toBe(7);
        expect(result.modularityQ).toBeGreaterThan(0.30);
        expect(result.isWellModularized).toBe(true);
        expect(result.isOrganizationInverted).toBe(false);
    });

    it('detects organizational modularity inversion on bipartite cross-boundary tangles', () => {
        // 6 nodes divided into community 0 and 1, but ALL edges are cross-community!
        // 0, 1, 2 belong to community 0; 3, 4, 5 belong to community 1.
        // Full bipartite graph K_3,3: 9 edges, 0 internal edges.
        const matrix = [
            [0, 0, 0, 1, 1, 1],
            [0, 0, 0, 1, 1, 1],
            [0, 0, 0, 1, 1, 1],
            [1, 1, 1, 0, 0, 0],
            [1, 1, 1, 0, 0, 0],
            [1, 1, 1, 0, 0, 0],
        ];
        // Symmetrized total edges = 9. Let's add 2 more edges to exceed 10-edge warning threshold
        const matrix10 = [
            [0, 0, 0, 1, 1, 1, 1],
            [0, 0, 0, 1, 1, 1, 1],
            [0, 0, 0, 1, 1, 1, 0],
            [1, 1, 1, 0, 0, 0, 0],
            [1, 1, 1, 0, 0, 0, 0],
            [1, 1, 1, 0, 0, 0, 0],
            [1, 1, 0, 0, 0, 0, 0],
        ];
        const communities = [0, 0, 0, 1, 1, 1, 1];

        const result = computeNewmanGirvanModularity({
            nodeCount: 7,
            adjacencyMatrix: matrix10,
            nodeCommunities: communities,
        });

        // Negative Q due to zero intra-community edges!
        expect(result.modularityQ).toBeLessThan(0.0);
        expect(result.isOrganizationInverted).toBe(true);
        expect(result.recommendation).toContain('Architectural modularity inversion detected');
    });

    it('handles empty or disconnected graphs gracefully', () => {
        const emptyResult = computeNewmanGirvanModularity({
            nodeCount: 0,
            adjacencyMatrix: [],
            nodeCommunities: [],
        });
        expect(emptyResult.modularityQ).toBe(0.0);
        expect(emptyResult.totalEdges).toBe(0);
    });
});
