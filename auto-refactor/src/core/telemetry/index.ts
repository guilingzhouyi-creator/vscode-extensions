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

import type { CoverageDampingResult, FileCoverageProfile } from './lcov-ingester';

export * from './lcov-ingester';

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
    if (typeof candidate.filePath !== 'string' || candidate.filePath.length === 0) {
        throw new TypeError('FileCoverageProfile.filePath must be a non-empty string');
    }
    if (typeof candidate.lineCoverageRatio !== 'number' || isNaN(candidate.lineCoverageRatio)) {
        throw new TypeError('FileCoverageProfile.lineCoverageRatio must be a valid number');
    }
    if (typeof candidate.branchCoverageRatio !== 'number' || isNaN(candidate.branchCoverageRatio)) {
        throw new TypeError('FileCoverageProfile.branchCoverageRatio must be a valid number');
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
    if (typeof candidate.filePath !== 'string' || candidate.filePath.length === 0) {
        throw new TypeError('CoverageDampingResult.filePath must be a non-empty string');
    }
    if (typeof candidate.dampingMultiplier !== 'number' || isNaN(candidate.dampingMultiplier)) {
        throw new TypeError('CoverageDampingResult.dampingMultiplier must be a valid number');
    }
    if (typeof candidate.status !== 'string') {
        throw new TypeError('CoverageDampingResult.status must be a string');
    }
}

/**
 * Creates an immutable repository-level coverage telemetry snapshot.
 *
 * @param profiles - Map of normalized file paths to coverage profiles.
 * @returns Frozen TelemetrySnapshot instance.
 */
export function createTelemetrySnapshot(
    profiles: Map<string, FileCoverageProfile>,
): Readonly<TelemetrySnapshot> {
    let totalLineRatio = 0;
    let totalBranchRatio = 0;
    let count = 0;

    for (const profile of profiles.values()) {
        assertValidFileCoverageProfile(profile);
        totalLineRatio += profile.lineCoverageRatio;
        totalBranchRatio += profile.branchCoverageRatio;
        count++;
    }

    const avgLine = count > 0 ? +(totalLineRatio / count).toFixed(3) : 1.0;
    const avgBranch = count > 0 ? +(totalBranchRatio / count).toFixed(3) : 1.0;

    const snapshot: TelemetrySnapshot = {
        timestamp: Date.now(),
        fileCount: count,
        profiles: Object.freeze(new Map(profiles)),
        averageLineCoverage: avgLine,
        averageBranchCoverage: avgBranch,
    };

    return Object.freeze(snapshot);
}
