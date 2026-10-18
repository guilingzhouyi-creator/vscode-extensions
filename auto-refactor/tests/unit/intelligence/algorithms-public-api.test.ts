/**
 * Module: Unit Tests — Code Intelligence Public API Export Verification
 * File Path: tests/unit/intelligence/algorithms-public-api.test.ts
 * Architecture Role: Verifies that all newly internalized mathematical models and algorithms
 *   are cleanly exported and fully callable via the auto-refactor root library surface.
 * Dependencies & Triggers: Imports public API exports from ../../../src/api;
 *   executed under vitest test runner (`npm run test:unit` or `npm test`).
 * Responsibilities:
 *   1. Assert export of Bumpy Road and Campbell Cognitive Complexity helpers;
 *   2. Assert export of Uncle Bob Main Sequence and MacCormack Propagation Cost evaluators;
 *   3. Assert export of Cilibrasi-Vitanyi Normalized Compression Distance (NCD) evaluators;
 *   4. Assert export of Henderson-Sellers LCOM* and Newman-Girvan Modularity Q evaluators;
 *   5. Assert export of Kaplan-Meier Code Survival functions.
 * Exit Semantics & Design Rationale: Deterministic in-memory unit tests; ensures public API
 *   contract stability and zero broken export links across releases.
 */

import { describe, it, expect } from 'vitest';
import {
    evaluateBumpyRoad,
    measureLineIndentLevel,
    extractIndentationPeaks,
    computeBumpyRoadIndex,
    calculateCognitiveComplexity,
    evaluateModuleMainSequence,
    classifyMainSequenceZone,
    computePropagationCost,
    computeNormalizedCompressionDistance,
    normalizeCodeForCompression,
    computeHendersonSellersLcom,
    computeNewmanGirvanModularity,
    computeCodeSurvival,
    computeChangeEntropy,
    evaluateChangeEntropy,
    parseNumstatOutput,
} from '../../../src/api';

describe('Code Intelligence Public API Exports', () => {
    it('exports all 12 key mathematical algorithm operators cleanly', () => {
        expect(typeof evaluateBumpyRoad).toBe('function');
        expect(typeof measureLineIndentLevel).toBe('function');
        expect(typeof extractIndentationPeaks).toBe('function');
        expect(typeof computeBumpyRoadIndex).toBe('function');
        expect(typeof calculateCognitiveComplexity).toBe('function');
        expect(typeof evaluateModuleMainSequence).toBe('function');
        expect(typeof classifyMainSequenceZone).toBe('function');
        expect(typeof computePropagationCost).toBe('function');
        expect(typeof computeNormalizedCompressionDistance).toBe('function');
        expect(typeof normalizeCodeForCompression).toBe('function');
        expect(typeof computeHendersonSellersLcom).toBe('function');
        expect(typeof computeNewmanGirvanModularity).toBe('function');
        expect(typeof computeCodeSurvival).toBe('function');
        expect(typeof computeChangeEntropy).toBe('function');
        expect(typeof evaluateChangeEntropy).toBe('function');
        expect(typeof parseNumstatOutput).toBe('function');
    });

    it('executes end-to-end smoke test through public API', () => {
        const ms = evaluateModuleMainSequence({
            afferentCoupling: 4,
            efferentCoupling: 4,
            abstractTypesCount: 2,
            concreteTypesCount: 2,
        });
        expect(ms.zone).toBe('balanced');

        const ncd = computeNormalizedCompressionDistance('const a = 1;', 'const b = 1;');
        expect(ncd.isNearClone).toBe(true);

        const lcom = computeHendersonSellersLcom({
            methodsCount: 3,
            attributesCount: 2,
            attributeAccessCounts: [3, 3],
        });
        expect(lcom.lcomStar).toBe(0.0);

        const survival = computeCodeSurvival([
            { timeStep: 1, atRiskCount: 10, eventCount: 1 },
        ]);
        expect(survival.survivalProbability).toBe(0.9);

        const entropy = evaluateChangeEntropy('10\t5\tauto-refactor/src/api.ts\n');
        expect(entropy.fileCount).toBe(1);
        expect(entropy.totalChangedLoc).toBe(15);
    });
});
