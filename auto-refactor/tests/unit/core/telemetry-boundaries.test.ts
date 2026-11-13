import { describe, expect, it } from 'vitest';
import {
    ContinuousRuleSamplingSidecar,
    LcovIngester,
    aggregateLcovCoverageSummary,
    assertValidCoverageDampingResult,
    assertValidFileCoverageProfile,
    computeBinaryEntropy,
    computeFrequencyJaccardSimilarity,
    computeJeffreysPosterior,
    createTelemetrySnapshot,
    type FileCoverageProfile,
} from '../../../src/core/telemetry';
import type { Issue } from '../../../src/core/contracts';

function makeValidProfile(overrides: Partial<FileCoverageProfile> = {}): FileCoverageProfile {
    return {
        filePath: 'src/core/sample.ts',
        linesFound: 10,
        linesHit: 8,
        lineCoverageRatio: 0.8,
        branchesFound: 4,
        branchesHit: 3,
        branchCoverageRatio: 0.75,
        lineHits: new Map([[1, 1]]),
        ...overrides,
    };
}

describe('telemetry boundary guards', () => {
    it('validates coverage profiles, damping contracts, and deterministic snapshots', () => {
        const valid = makeValidProfile();
        expect(() => assertValidFileCoverageProfile(valid)).not.toThrow();
        expect(() => assertValidFileCoverageProfile(makeValidProfile({ filePath: '   ' }))).toThrow(
            TypeError,
        );
        expect(() =>
            assertValidFileCoverageProfile(makeValidProfile({ filePath: 'src/\0bad.ts' })),
        ).toThrow(TypeError);
        expect(() =>
            assertValidFileCoverageProfile(makeValidProfile({ lineCoverageRatio: 1.5 })),
        ).toThrow(TypeError);
        expect(() =>
            assertValidFileCoverageProfile(makeValidProfile({ branchCoverageRatio: Infinity })),
        ).toThrow(TypeError);
        expect(() => assertValidFileCoverageProfile(makeValidProfile({ linesFound: -1 }))).toThrow(
            TypeError,
        );

        expect(() =>
            assertValidCoverageDampingResult({
                filePath: 'src/a.ts',
                dampingMultiplier: 1.2,
                status: 'well_covered',
                rationale: 'ok',
            }),
        ).not.toThrow();
        expect(() =>
            assertValidCoverageDampingResult({
                filePath: 'src/a.ts',
                dampingMultiplier: 1.0,
                status: 'unknown_status',
                rationale: 'bad',
            }),
        ).toThrow(TypeError);
        expect(() =>
            assertValidCoverageDampingResult({
                filePath: 'src/a.ts',
                dampingMultiplier: -0.5,
                status: 'unmonitored',
                rationale: 'bad',
            }),
        ).toThrow(TypeError);

        const profiles = new Map([[valid.filePath, valid]]);
        const snap = createTelemetrySnapshot(profiles, 1_700_000_000_000);
        expect(snap.timestamp).toBe(1_700_000_000_000);
        expect(Object.isFrozen(snap)).toBe(true);
        expect(() => createTelemetrySnapshot(profiles, -10)).toThrow(TypeError);
    });

    it('parses partial LCOV streams, ignores malformed DA lines, and clamps overflow ratios', () => {
        const ingester = new LcovIngester();
        const lcov = [
            'SF:src/bad\0path.ts',
            'DA:1,2',
            'end_of_record',
            'SF:src/clamped.ts',
            'DA:-5,1',
            'DA:0,2',
            'DA:abc,3',
            'DA:10,4,deadbeef',
            'LF:2',
            'LH:99',
            'BRF:2',
            'BRH:50',
            // Intentional omission of end_of_record to test EOF flush
        ].join('\n');

        const profiles = ingester.parse(lcov);
        expect(profiles.has('src/bad\0path.ts')).toBe(false);
        const clamped = profiles.get('src/clamped.ts');
        expect(clamped).toBeDefined();
        expect(clamped?.lineHits.size).toBe(1);
        expect(clamped?.lineHits.get(10)).toBe(4);
        expect(clamped?.lineCoverageRatio).toBe(1);
        expect(clamped?.branchCoverageRatio).toBe(1);

        const summary = aggregateLcovCoverageSummary(lcov);
        expect(summary.lineCoveragePct).toBeLessThanOrEqual(100);
        expect(summary.branchCoveragePct).toBeLessThanOrEqual(100);
    });

    it('guards posterior, entropy, Jaccard math, and missing issue locations against NaN', () => {
        expect(computeBinaryEntropy(Number.NaN)).toBe(0);
        expect(computeFrequencyJaccardSimilarity(Number.NaN, 1, 1)).toBe(0);
        expect(computeFrequencyJaccardSimilarity(1, -2, 3)).toBe(0);

        const posterior = computeJeffreysPosterior(-5, Number.NaN);
        expect(Number.isFinite(posterior.mean)).toBe(true);
        expect(posterior.mean).toBeGreaterThanOrEqual(0);
        expect(posterior.mean).toBeLessThanOrEqual(1);

        const sidecar = new ContinuousRuleSamplingSidecar();
        const malformedIssue = {
            rule: 'R1',
            severity: 'warning',
            message: 'test',
            location: { file: '', line: 1, column: 1 },
        } as unknown as Issue;
        expect(() =>
            sidecar.recordScan({ filesScanned: -3, issues: [malformedIssue], timestamp: 42 }),
        ).not.toThrow();
    });
});
