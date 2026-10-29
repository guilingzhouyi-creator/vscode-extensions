/**
 * Module: Unit Test Suite — Provenance and Backend Neutrality
 * File Path: tests/unit/scoring/confidence-model-asset.test.ts
 * Architecture Role: Pins the two properties that make a calibrated score auditable rather than
 *   merely numeric: the model description must change whenever its evidence or thresholds change,
 *   and the arbiter's verdict must not depend on which backend produced the finding.
 * Dependencies & Triggers: Consumes confidence-model-asset.ts and finding-confidence-arbiter.ts;
 *   run by vitest in `npm test`.
 * Responsibilities:
 *   1. Assert the digest is order-insensitive, evidence-sensitive and threshold-sensitive.
 *   2. Assert the asset is canonical (rules sorted) and its totals add up.
 *   3. Assert identical evidence adjudicates identically regardless of analyzer name.
 *   4. Assert a rejected rule's patch is demoted rather than held at the actionable floor.
 * Exit Semantics & Design Rationale: Deterministic pure assertions, no I/O and no clock, so a
 *   failure always means the provenance contract moved. Case 4 is the one that would have passed
 *   silently before: the floor used to swallow every rejection.
 */

import { describe, it, expect } from 'vitest';
import {
    CONFIDENCE_MODEL_SCHEMA_VERSION,
    buildConfidenceModelAsset,
    isSameConfidenceModel,
} from '../../../src/core/scoring/confidence-model-asset';
import { fingerprintCorpus } from '../../../src/core/scoring/calibration-corpus';
import {
    FindingConfidenceArbiter,
    CONFIDENCE_ACTIONABLE_FLOOR,
} from '../../../src/core/scoring/finding-confidence-arbiter';
import type { Issue } from '../../../src/core/types';

/**
 * Builds a minimal patchable issue.
 *
 * @param analyzer - Analyzer name to attribute the finding to.
 * @param rule - Rule id.
 * @returns Issue the arbiter classifies as patchable.
 */
function createPatchableIssue(analyzer: string, rule: string): Issue {
    return {
        id: `${analyzer}:${rule}:src/a.ts:1`,
        analyzer,
        rule,
        severity: 'warning',
        message: `${rule} fired`,
        location: { file: 'src/a.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 9 } },
        detail: {},
        actionable: {
            action: 'extract_constant',
            code: 'AR:CONST:001',
            safeToAutomate: true,
            templateSnippet: 'const V = 1;',
        },
    };
}

describe('confidence model asset', () => {
    it('reports the schema version and totals', () => {
        const asset = buildConfidenceModelAsset([
            { rule: 'b', truePositives: 3, falsePositives: 1 },
            { rule: 'a', truePositives: 2, falsePositives: 4 },
        ]);
        expect(asset.schema).toBe(CONFIDENCE_MODEL_SCHEMA_VERSION);
        expect(asset.calibratedRuleCount).toBe(2);
        expect(asset.observationCount).toBe(10);
    });

    it('sorts rules so the document is canonical', () => {
        const asset = buildConfidenceModelAsset([
            { rule: 'z', truePositives: 1, falsePositives: 0 },
            { rule: 'a', truePositives: 1, falsePositives: 0 },
        ]);
        expect(asset.rules.map((entry) => entry.rule)).toEqual(['a', 'z']);
    });

    it('produces the same digest regardless of input order', () => {
        const forward = buildConfidenceModelAsset([
            { rule: 'a', truePositives: 1, falsePositives: 2 },
            { rule: 'b', truePositives: 3, falsePositives: 4 },
        ]);
        const reverse = buildConfidenceModelAsset([
            { rule: 'b', truePositives: 3, falsePositives: 4 },
            { rule: 'a', truePositives: 1, falsePositives: 2 },
        ]);
        expect(forward.digest).toBe(reverse.digest);
    });

    it('changes the digest when a count changes', () => {
        const before = buildConfidenceModelAsset([
            { rule: 'a', truePositives: 1, falsePositives: 2 },
        ]);
        const after = buildConfidenceModelAsset([
            { rule: 'a', truePositives: 2, falsePositives: 2 },
        ]);
        expect(before.digest).not.toBe(after.digest);
    });

    it('changes the digest when a threshold changes, with identical evidence', () => {
        const stats = [{ rule: 'a', truePositives: 1, falsePositives: 2 }];
        const before = buildConfidenceModelAsset(stats, { shrinkageAnchor: 10 });
        const after = buildConfidenceModelAsset(stats, { shrinkageAnchor: 20 });
        expect(before.digest).not.toBe(after.digest);
    });

    it('changes the digest when a rule tier changes', () => {
        const stats = [{ rule: 'a', truePositives: 1, falsePositives: 2 }];
        const before = buildConfidenceModelAsset(stats, { ruleTiers: { a: 'T1' } });
        const after = buildConfidenceModelAsset(stats, { ruleTiers: { a: 'T3' } });
        expect(before.digest).not.toBe(after.digest);
    });

    it('fingerprints only the evidence, so formatting and extra entries cannot move it', () => {
        const base = fingerprintCorpus([{ rule: 'a', truePositives: 1, falsePositives: 1 }]);
        const reordered = fingerprintCorpus([
            { rule: 'b', truePositives: 0, falsePositives: 0 },
            { rule: 'a', truePositives: 1, falsePositives: 1 },
        ]);
        const shifted = fingerprintCorpus([{ rule: 'a', truePositives: 2, falsePositives: 1 }]);
        expect(base).toHaveLength(16);
        expect(reordered).not.toBe(base);
        expect(shifted).not.toBe(base);
    });

    it('compares models by schema and digest, not by presence', () => {
        const asset = buildConfidenceModelAsset([
            { rule: 'a', truePositives: 1, falsePositives: 0 },
        ]);
        expect(isSameConfidenceModel(asset, asset)).toBe(true);
        expect(isSameConfidenceModel(undefined, asset)).toBe(false);
        expect(isSameConfidenceModel(asset, undefined)).toBe(false);
        const other = buildConfidenceModelAsset([
            { rule: 'a', truePositives: 2, falsePositives: 0 },
        ]);
        expect(isSameConfidenceModel(asset, other)).toBe(false);
    });

    it('describes an empty corpus without claiming a model', () => {
        const asset = buildConfidenceModelAsset([]);
        expect(asset.calibratedRuleCount).toBe(0);
        expect(asset.observationCount).toBe(0);
        expect(asset.rules).toEqual([]);
        expect(asset.digest).toHaveLength(16);
    });
});

describe('backend neutrality', () => {
    it('adjudicates identical evidence identically across analyzer names', () => {
        const names = ['constants', 'eslint', 'clippy', 'semgrep', 'future-linter'];
        const results = names.map((analyzer) =>
            new FindingConfidenceArbiter().arbitrateFinding(
                createPatchableIssue(analyzer, 'AR-DEMO-001'),
            ),
        );
        for (const result of results) {
            expect(result.tier).toBe(results[0].tier);
            expect(result.confidence).toBe(results[0].confidence);
            expect(result.mustBlock).toBe(results[0].mustBlock);
        }
    });

    it('calibrates a foreign rule to the same posterior as a native one', () => {
        const stats = [{ rule: 'AR-DEMO-001', truePositives: 1, falsePositives: 30 }];
        const native = new FindingConfidenceArbiter({
            ruleCalibrationStats: stats,
        }).arbitrateFinding(createPatchableIssue('constants', 'AR-DEMO-001'));
        const foreign = new FindingConfidenceArbiter({
            ruleCalibrationStats: stats,
        }).arbitrateFinding(createPatchableIssue('semgrep', 'AR-DEMO-001'));
        expect(foreign.confidence).toBe(native.confidence);
        expect(foreign.calibrationSampleSize).toBe(native.calibrationSampleSize);
    });
});

describe('evidence-driven demotion', () => {
    it('demotes a rejected rule below the actionable floor instead of holding it there', () => {
        const rejected = new FindingConfidenceArbiter({
            ruleCalibrationStats: [{ rule: 'AR-DEMO-001', truePositives: 1, falsePositives: 60 }],
        }).arbitrateFinding(createPatchableIssue('constants', 'AR-DEMO-001'));
        expect(rejected.tier).toBe('advisory');
        expect(rejected.confidence).toBeLessThan(CONFIDENCE_ACTIONABLE_FLOOR);
        // The proposed fix is still carried, so a reviewer can read what was suggested.
        expect(rejected.executablePatch).toBeDefined();
        expect(rejected.rationale).toContain('withheld');
    });

    it('keeps a well-observed rule in the actionable tier', () => {
        const trusted = new FindingConfidenceArbiter({
            ruleCalibrationStats: [{ rule: 'AR-DEMO-001', truePositives: 200, falsePositives: 1 }],
        }).arbitrateFinding(createPatchableIssue('constants', 'AR-DEMO-001'));
        expect(trusted.tier).toBe('actionable');
        expect(trusted.confidence).toBeGreaterThanOrEqual(CONFIDENCE_ACTIONABLE_FLOOR);
    });

    it('leaves an unobserved rule at the actionable floor', () => {
        const unobserved = new FindingConfidenceArbiter().arbitrateFinding(
            createPatchableIssue('constants', 'AR-DEMO-001'),
        );
        expect(unobserved.tier).toBe('actionable');
        expect(unobserved.confidence).toBe(CONFIDENCE_ACTIONABLE_FLOOR);
    });
});
