/**
 * Module: Unit Test — Native Binding Admission Contract
 * File Path: tests/unit/core/native-binding-admission.test.ts
 * Architecture Role: Verifies the loader refuses a partially-implemented compiled addon instead of
 *   accepting it and failing later on a specific operator.
 * Dependencies & Triggers: Consumes vitest and the admitted-member predicate exported by the bridge.
 * Responsibilities:
 *   1. Assert a candidate that implements only the histogram diff is refused;
 *   2. Assert a candidate implementing every unconditionally-dereferenced member is admitted;
 *   3. Assert a non-object candidate is refused rather than throwing.
 * Exit Semantics & Design Rationale: Pure predicate assertions with no filesystem or process access,
 *   so the suite reports the same verdict whether or not a compiled addon exists on the host.
 */

import { describe, it, expect } from 'vitest';
import { findUnsatisfiedBindingFields } from '../../../src/core/native/native-bridge';

/** Members the assembly layer calls without a shim fallback; mirrored here to pin the contract. */
const ADMITTED_CONTRACT = [
    'computeHistogramDiff',
    'analyzeDependencyGraph',
    'fastPatternMatch',
    'countDuplicateLines',
    'detectCloneBlocks',
    'findClonePairs',
    'computeDominatorTree',
    'solveDataflow',
] as const;

type Candidate = Record<string, unknown>;

function candidateWith(members: readonly string[]): Candidate {
    const candidate: Candidate = {};
    for (const member of members) {
        candidate[member] = () => undefined;
    }
    return candidate;
}

describe('Native binding admission contract', () => {
    it('refuses a candidate that implements only the histogram diff', () => {
        const missing = findUnsatisfiedBindingFields(candidateWith(['computeHistogramDiff']));
        expect(missing.length).toBeGreaterThan(0);
        expect(missing).not.toContain('computeHistogramDiff');
        expect(missing).toContain('findClonePairs');
        expect(missing).toContain('solveDataflow');
    });

    it('admits a candidate implementing every unconditionally-dereferenced member', () => {
        expect(findUnsatisfiedBindingFields(candidateWith(ADMITTED_CONTRACT))).toEqual([]);
    });

    it('refuses a non-object candidate without throwing', () => {
        expect(findUnsatisfiedBindingFields(null)).toEqual([...ADMITTED_CONTRACT]);
        expect(findUnsatisfiedBindingFields('native-core')).toEqual([...ADMITTED_CONTRACT]);
        expect(findUnsatisfiedBindingFields(undefined)).toEqual([...ADMITTED_CONTRACT]);
    });

    it('refuses a candidate whose member is present but not callable', () => {
        const candidate = candidateWith(ADMITTED_CONTRACT);
        candidate.findClonePairs = 'not-a-function';
        expect(findUnsatisfiedBindingFields(candidate)).toEqual(['findClonePairs']);
    });
});
