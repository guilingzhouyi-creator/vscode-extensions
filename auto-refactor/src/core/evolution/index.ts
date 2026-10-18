/**
 * Module: Core Evolution — Barrel Export & Substantive Facade
 * File Path: src/core/evolution/index.ts
 * Architecture Role: Central facade for git history mining, code evolution analysis,
 *   behavioral hotspot evaluation, and temporal coupling detection;
 *   re-exports miner/evaluators, validates evolution metric records, and enforces immutability.
 * Dependencies & Triggers: Consumed by QualityScorer, test pipelines, and CLI reporters.
 * Responsibilities:
 *   1. Re-export GitHistoryMiner, CodeEvolutionAnalyzer, BehavioralHotspotEvaluator,
 *      and TemporalCouplingDetector;
 *   2. Validate runtime shapes of CodeEvolutionMetrics;
 *   3. Provide frozen default metrics for fallback or unversioned files.
 * Exit Semantics & Design Rationale: Clean defensive validation throwing TypeError
 *   on invalid input; immutability guarantees via Object.freeze.
 */

import type { CodeEvolutionMetrics } from './code-evolution-analyzer';

export * from './git-history-miner';
export * from './code-evolution-analyzer';
export * from './behavioral-hotspot-evaluator';
export * from './temporal-coupling-detector';
export * from './code-survival-model';
export * from './git-changeset-miner';

/**
 * Asserts that the supplied candidate object satisfies the CodeEvolutionMetrics contract.
 *
 * @param metrics - Candidate metrics object to validate.
 * @throws TypeError if metrics is not an object or lacks required attributes.
 */
export function assertValidEvolutionMetrics(
    metrics: unknown,
): asserts metrics is CodeEvolutionMetrics {
    if (!metrics || typeof metrics !== 'object') {
        throw new TypeError('CodeEvolutionMetrics must be a non-null object');
    }
    const candidate = metrics as Record<string, unknown>;
    if (typeof candidate.filePath !== 'string' || candidate.filePath.length === 0) {
        throw new TypeError('CodeEvolutionMetrics.filePath must be a non-empty string');
    }
    if (
        typeof candidate.vulnerabilityMultiplier !== 'number' ||
        Number.isNaN(candidate.vulnerabilityMultiplier)
    ) {
        throw new TypeError('CodeEvolutionMetrics.vulnerabilityMultiplier must be a valid number');
    }
}

/**
 * Freezes a CodeEvolutionMetrics record to prevent post-analysis mutations.
 *
 * @param metrics - Mutable code evolution metrics.
 * @returns Frozen CodeEvolutionMetrics record.
 */
export function freezeEvolutionMetrics(
    metrics: CodeEvolutionMetrics,
): Readonly<CodeEvolutionMetrics> {
    assertValidEvolutionMetrics(metrics);
    if (metrics.actionableProposal) {
        Object.freeze(metrics.actionableProposal);
    }
    return Object.freeze({ ...metrics });
}

/**
 * Creates an immutable baseline CodeEvolutionMetrics record for unversioned environments.
 *
 * @param filePath - Target file path.
 * @returns Frozen default CodeEvolutionMetrics instance.
 */
export function createDefaultEvolutionMetrics(filePath: string): Readonly<CodeEvolutionMetrics> {
    const defaultMetrics: CodeEvolutionMetrics = {
        filePath,
        vulnerabilityMultiplier: 1.0,
        bugProneScore: 0.0,
        authorEntropyScore: 0.0,
        decayScore: 0.0,
        debtVelocityScore: 0.0,
        isGitAvailable: false,
        totalCommitsEvaluated: 0,
    };
    return Object.freeze(defaultMetrics);
}
