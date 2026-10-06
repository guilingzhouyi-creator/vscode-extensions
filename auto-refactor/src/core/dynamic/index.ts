/**
 * Module: Dynamic Analysis Plane — Unified Export Index & Substantive Facade
 * File Path: src/core/dynamic/index.ts
 * Architecture Role: Unified facade and runtime contract gate for the Dynamic Analysis Plane (DAP);
 *   re-exports telemetry models, provides evidence payload validation, and guarantees immutability.
 * Dependencies & Triggers: Consumes internal dynamic modules; exported through src/api.ts.
 * Responsibilities:
 *   1. Re-export dynamic contracts, telemetry ingestor, and dynamic quality scorers;
 *   2. Enforce runtime type validation for dynamic evidence payloads;
 *   3. Enforce immutability guarantees on dynamic evidence objects via Object.freeze.
 * Exit Semantics & Design Rationale: Bounded defensive validation throwing TypeError
 *   on invalid input; re-exports provide a stable architectural boundary.
 */

import type { DynamicEvidenceDTO } from './dynamic-types';

export * from './dynamic-types';
export * from './telemetry-ingestor';
export * from './dynamic-quality-scorer';

/**
 * Asserts that the supplied candidate object satisfies the minimal DynamicEvidenceDTO contract.
 *
 * @param dto - Candidate telemetry evidence object to validate.
 * @throws TypeError if dto is null, not an object, or lacks a valid numeric timestamp.
 */
export function assertValidDynamicEvidence(dto: unknown): asserts dto is DynamicEvidenceDTO {
    if (!dto || typeof dto !== 'object') {
        throw new TypeError('DynamicEvidenceDTO must be a non-null object');
    }
    const candidate = dto as Record<string, unknown>;
    if (typeof candidate.timestamp !== 'number' || Number.isNaN(candidate.timestamp)) {
        throw new TypeError('DynamicEvidenceDTO.timestamp must be a valid number');
    }
}

/**
 * Freezes a dynamic evidence payload to prevent unauthorized mutation.
 *
 * @param evidence - Dynamic evidence payload.
 * @returns Frozen DynamicEvidenceDTO snapshot.
 */
export function freezeDynamicEvidence(evidence: DynamicEvidenceDTO): Readonly<DynamicEvidenceDTO> {
    assertValidDynamicEvidence(evidence);
    if (evidence.latency) Object.freeze(evidence.latency);
    if (evidence.throughput) Object.freeze(evidence.throughput);
    if (evidence.memory) Object.freeze(evidence.memory);
    if (evidence.concurrency) Object.freeze(evidence.concurrency);
    if (evidence.execution) Object.freeze(evidence.execution);
    if (evidence.hotspots) {
        for (const hotspot of evidence.hotspots) {
            Object.freeze(hotspot);
        }
        Object.freeze(evidence.hotspots);
    }
    return Object.freeze({ ...evidence });
}
