/**
 * Module: Unit Tests — Main Sequence Distance & Propagation Cost Evaluator
 * File Path: tests/unit/intelligence/main-sequence.test.ts
 * Architecture Role: Verifies Uncle Bob's Abstractness-Instability Main Sequence formulas,
 *   zone classifications, and MacCormack's architectural Propagation Cost (Warshall closure).
 * Dependencies & Triggers: Imports evaluateModuleMainSequence and computePropagationCost;
 *   executed under vitest test runner (`npm run test:unit` or `npm test`).
 * Responsibilities:
 *   1. Assert Main Sequence metric computation for balanced interfaces and services.
 *   2. Assert Zone of Pain identification for concrete, heavily depended upon modules.
 *   3. Assert Zone of Uselessness identification for speculative unconsumed interfaces.
 *   4. Assert MacCormack Propagation Cost on isolated, linear, and clique topologies.
 *   5. Assert local blast radius accuracy per node.
 * Exit Semantics & Design Rationale: Deterministic in-memory unit tests; ensures mathematical
 *   invariants of graph reachability and distance metrics hold across platforms.
 */

import { describe, it, expect } from 'vitest';
import {
    evaluateModuleMainSequence,
    classifyMainSequenceZone,
    computePropagationCost,
} from '../../../src/core/intelligence/main-sequence-evaluator';

describe('evaluateModuleMainSequence', () => {
    it('identifies balanced architecture along the Main Sequence', () => {
        // Ideal stable abstraction: Ca=10, Ce=0 (I=0), Na=10, Nc=10 (A=1) -> A+I-1 = 0
        const stableAbstraction = evaluateModuleMainSequence({
            afferentCoupling: 10,
            efferentCoupling: 0,
            abstractTypesCount: 10,
            concreteTypesCount: 0,
        });
        expect(stableAbstraction.instability).toBe(0.0);
        expect(stableAbstraction.abstractness).toBe(1.0);
        expect(stableAbstraction.distance).toBe(0.0);
        expect(stableAbstraction.zone).toBe('balanced');
        expect(stableAbstraction.recommendation).toBeUndefined();

        // Ideal flexible implementation: Ca=0, Ce=10 (I=1), Na=0, Nc=10 (A=0) -> A+I-1 = 0
        const flexibleModule = evaluateModuleMainSequence({
            afferentCoupling: 0,
            efferentCoupling: 10,
            abstractTypesCount: 0,
            concreteTypesCount: 10,
        });
        expect(flexibleModule.instability).toBe(1.0);
        expect(flexibleModule.abstractness).toBe(0.0);
        expect(flexibleModule.distance).toBe(0.0);
        expect(flexibleModule.zone).toBe('balanced');
    });

    it('identifies Zone of Pain for concrete heavily depended upon modules', () => {
        // Concrete foundation: Ca=25, Ce=2 (I=0.074), Na=0, Nc=20 (A=0) -> D = |0 + 0.074 - 1| = 0.926
        const rigidFoundation = evaluateModuleMainSequence({
            afferentCoupling: 25,
            efferentCoupling: 2,
            abstractTypesCount: 0,
            concreteTypesCount: 20,
        });
        expect(rigidFoundation.zone).toBe('zone_of_pain');
        expect(rigidFoundation.distance).toBeGreaterThan(0.5);
        expect(rigidFoundation.recommendation).toContain('Zone of Pain');
    });

    it('identifies Zone of Uselessness for speculative unused abstractions', () => {
        // Abstract but unconsumed: Ca=0, Ce=8 (I=1.0), Na=15, Nc=15 (A=1.0) -> D = |1 + 1 - 1| = 1.0
        const speculativeModule = evaluateModuleMainSequence({
            afferentCoupling: 0,
            efferentCoupling: 8,
            abstractTypesCount: 15,
            concreteTypesCount: 0,
        });
        expect(speculativeModule.zone).toBe('zone_of_uselessness');
        expect(speculativeModule.distance).toBe(1.0);
        expect(speculativeModule.recommendation).toContain('Zone of Uselessness');
    });

    it('handles zero denominators gracefully without throwing or producing NaN', () => {
        const emptyModule = evaluateModuleMainSequence({
            afferentCoupling: 0,
            efferentCoupling: 0,
            abstractTypesCount: 0,
            concreteTypesCount: 0,
        });
        expect(emptyModule.instability).toBe(0.0);
        expect(emptyModule.abstractness).toBe(0.0);
        expect(emptyModule.distance).toBe(1.0);
        expect(Number.isNaN(emptyModule.distance)).toBe(false);
    });
});

describe('computePropagationCost', () => {
    it('computes minimal propagation cost on disconnected components', () => {
        // 4 nodes with 0 edges: each node can only reach itself
        const matrix = [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ];
        const result = computePropagationCost(matrix, 4);
        expect(result.nodeCount).toBe(4);
        // Reachable pairs = 4 (diagonal only). PC = 4 / 16 = 0.25
        expect(result.propagationCost).toBe(0.25);
        expect(result.isHyperCoupled).toBe(false);
        expect(result.nodeBlastRadii).toEqual([0.25, 0.25, 0.25, 0.25]);
    });

    it('computes maximal propagation cost on fully connected clique', () => {
        // 4 nodes where all nodes depend on all other nodes
        const matrix = [
            [0, 1, 1, 1],
            [1, 0, 1, 1],
            [1, 1, 0, 1],
            [1, 1, 1, 0],
        ];
        const result = computePropagationCost(matrix, 4);
        // All 16 pairs reachable
        expect(result.propagationCost).toBe(1.0);
        expect(result.isHyperCoupled).toBe(true);
        expect(result.nodeBlastRadii).toEqual([1.0, 1.0, 1.0, 1.0]);
    });

    it('computes exact transitive closure propagation cost on linear pipeline', () => {
        // 0 -> 1 -> 2 -> 3
        const matrix = [
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
            [0, 0, 0, 0],
        ];
        const result = computePropagationCost(matrix, 4);
        // Reachable:
        // 0 -> 0, 1, 2, 3 (4)
        // 1 -> 1, 2, 3 (3)
        // 2 -> 2, 3 (2)
        // 3 -> 3 (1)
        // Total = 10 / 16 = 0.625
        expect(result.propagationCost).toBe(0.625);
        // Blast radius for target 3: reached by 0, 1, 2, 3 -> 4/4 = 1.0
        expect(result.nodeBlastRadii[3]).toBe(1.0);
        // Blast radius for target 0: only reached by 0 -> 1/4 = 0.25
        expect(result.nodeBlastRadii[0]).toBe(0.25);
    });

    it('handles empty matrices gracefully', () => {
        const result = computePropagationCost([], 0);
        expect(result.nodeCount).toBe(0);
        expect(result.propagationCost).toBe(0.0);
        expect(result.nodeBlastRadii).toHaveLength(0);
    });
});
