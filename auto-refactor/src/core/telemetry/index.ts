/**
 * Module: Core Telemetry — Ingestion & Dynamic Feedback Facade
 * File Path: src/core/telemetry/index.ts
 * Architecture Role: Unified facade and contract validation entry point for code coverage
 *   telemetry ingestion and dynamic risk feedback.
 * Dependencies & Triggers: Consumed by RiskFusionEngine, test pipelines, and CLI reporters.
 * Responsibilities:
 *   1. Re-export LcovIngester and all associated telemetry models;
 *   2. Provide runtime contract assertions for coverage profiles and damping results;
 *   3. Enforce immutability guarantees on telemetry snapshots via Object.freeze.
 * Exit Semantics & Design Rationale: Never mutates incoming records; returns deeply frozen
 *   or defensively validated views.
 */

import type { CoverageDampingResult, CoverageStatus, FileCoverageProfile } from './lcov-ingester';

export * from './lcov-ingester';
export * from './continuous-rule-sampler';

const RATIO_DECIMAL_PLACES = 3;
const VALID_COVERAGE_STATUSES: ReadonlySet<CoverageStatus> = new Set<CoverageStatus>([
    'well_covered',
    'moderate_coverage',
    'uncovered_high_risk',
    'unmonitored',
]);

function assertSafePathField(value: unknown, fieldName: string): void {
    if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
        throw new TypeError(`${fieldName} must be a non-empty valid file path`);
    }
}

function assertUnitRatioField(value: unknown, fieldName: string): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new TypeError(`${fieldName} must be a finite ratio in [0, 1]`);
    }
}

/**
 * Aggregated telemetry snapshot representation across inspected repository files.
 */
export interface TelemetrySnapshot {
    timestamp: number;
    fileCount: number;
    profiles: ReadonlyMap<string, FileCoverageProfile>;
    averageLineCoverage: number;
    averageBranchCoverage: number;
}

/**
 * Runtime type guard asserting that an object satisfies FileCoverageProfile contract.
 *
 * @param value - Candidate profile object.
 * @throws TypeError if value does not satisfy required contract properties.
 */
export function assertValidFileCoverageProfile(
    value: unknown,
): asserts value is FileCoverageProfile {
    if (!value || typeof value !== 'object') {
        throw new TypeError('FileCoverageProfile must be a non-null object');
    }
    const candidate = value as Record<string, unknown>;
    assertSafePathField(candidate.filePath, 'FileCoverageProfile.filePath');
    assertUnitRatioField(candidate.lineCoverageRatio, 'FileCoverageProfile.lineCoverageRatio');
    assertUnitRatioField(candidate.branchCoverageRatio, 'FileCoverageProfile.branchCoverageRatio');
    for (const countKey of ['linesFound', 'linesHit', 'branchesFound', 'branchesHit']) {
        const rawCount = candidate[countKey];
        if (
            rawCount !== undefined &&
            (typeof rawCount !== 'number' || !Number.isFinite(rawCount) || rawCount < 0)
        ) {
            throw new TypeError(
                `FileCoverageProfile.${countKey} must be a non-negative finite number`,
            );
        }
    }
}

/**
 * Runtime type guard asserting that an object satisfies CoverageDampingResult contract.
 *
 * @param value - Candidate damping result object.
 * @throws TypeError if value does not satisfy required contract properties.
 */
export function assertValidCoverageDampingResult(
    value: unknown,
): asserts value is CoverageDampingResult {
    if (!value || typeof value !== 'object') {
        throw new TypeError('CoverageDampingResult must be a non-null object');
    }
    const candidate = value as Record<string, unknown>;
    assertSafePathField(candidate.filePath, 'CoverageDampingResult.filePath');
    if (
        typeof candidate.dampingMultiplier !== 'number' ||
        !Number.isFinite(candidate.dampingMultiplier) ||
        candidate.dampingMultiplier < 0
    ) {
        throw new TypeError(
            'CoverageDampingResult.dampingMultiplier must be a non-negative finite number',
        );
    }
    if (
        typeof candidate.status !== 'string' ||
        !VALID_COVERAGE_STATUSES.has(candidate.status as CoverageStatus)
    ) {
        throw new TypeError('CoverageDampingResult.status must be a recognized CoverageStatus');
    }
}

/**
 * Creates an immutable repository-level coverage telemetry snapshot.
 *
 * @param profiles - Map of normalized file paths to coverage profiles.
 * @param nowMs - Optional deterministic timestamp in epoch milliseconds.
 * @returns Frozen TelemetrySnapshot instance.
 */
export function createTelemetrySnapshot(
    profiles: ReadonlyMap<string, FileCoverageProfile>,
    nowMs: number = Date.now(),
): Readonly<TelemetrySnapshot> {
    if (!profiles || typeof profiles.values !== 'function') {
        throw new TypeError('profiles must be a valid Map instance');
    }
    if (!Number.isFinite(nowMs) || nowMs < 0) {
        throw new TypeError('nowMs must be a non-negative finite timestamp');
    }
    let totalLineRatio = 0;
    let totalBranchRatio = 0;
    let count = 0;

    for (const profile of profiles.values()) {
        assertValidFileCoverageProfile(profile);
        totalLineRatio += profile.lineCoverageRatio;
        totalBranchRatio += profile.branchCoverageRatio;
        count++;
    }

    const avgLine = count > 0 ? +(totalLineRatio / count).toFixed(RATIO_DECIMAL_PLACES) : 1.0;
    const avgBranch = count > 0 ? +(totalBranchRatio / count).toFixed(RATIO_DECIMAL_PLACES) : 1.0;

    const snapshot: TelemetrySnapshot = {
        timestamp: nowMs,
        fileCount: count,
        profiles: Object.freeze(new Map(profiles)),
        averageLineCoverage: avgLine,
        averageBranchCoverage: avgBranch,
    };

    return Object.freeze(snapshot);
}
