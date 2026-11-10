/**
 * Module: Review — Configuration Identity
 * File Path: src/core/review/review-configuration.ts
 * Architecture Role: Bind snapshot review facts to actual resolved configuration values.
 * Dependencies & Triggers: Node crypto, scanner cache engine identity and resolved ScanConfig.
 * Responsibilities: Preserve exact primitive values and reject uncaptured executable dependencies.
 * Exit Semantics & Design Rationale: Unknown configuration remains unavailable, never an invented
 *     generation; this process identity conveys neither authority nor a signed policy claim.
 */
import { createHash } from 'node:crypto';
import { buildPoolFingerprint } from '../cache-key';
import type { ScanConfig } from '../types';

/** Actual local configuration binding, distinct from a trusted policy identity. */
export type ReviewConfigurationIdentity =
    | { readonly status: 'bound'; readonly algorithm: 'sha256'; readonly value: string }
    | { readonly status: 'unavailable'; readonly reason: string };

/**
 * Encode supported JS values with type tags; object keys are sorted and arrays retain order.
 * @param value - Configuration value; functions and opaque native objects are unsupported.
 * @param ancestors - Active object ancestors, detecting cycles without rejecting shared values.
 * @returns JSON-safe typed representation distinguishing undefined, absent and array values.
 */
function encodeValue(value: unknown, ancestors: Set<object>): unknown {
    if (value === null) return ['null'];
    if (typeof value === 'undefined') return ['undefined'];
    if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return ['number', Object.is(value, -0) ? '-0' : String(value)];
    }
    if (typeof value !== 'object' || ancestors.has(value) || ancestors.size >= 64) {
        throw new Error('Configuration contains uncaptured or cyclic dependencies');
    }
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        throw new Error('Configuration contains an opaque object');
    }
    ancestors.add(value);
    try {
        if (Array.isArray(value)) return ['array', value.map(item => encodeValue(item, ancestors))];
        const record = value as Record<string, unknown>;
        return ['object', Object.keys(record).sort().map(key => [key, encodeValue(record[key], ancestors)])];
    } finally {
        ancestors.delete(value);
    }
}

/**
 * Capture the scanner's actual settings and execution options before any asynchronous work.
 * Signal state is execution lifecycle, not configuration; custom closure dependencies stay unknown.
 * @param config - Resolved configuration actually consumed by the scanner.
 * @param options - Actual dual-track options captured for this request.
 * @returns Detached configuration digest, or an explicit unavailable observation.
 */
export function captureReviewConfiguration(
    config: ScanConfig, options: unknown,
): ReviewConfigurationIdentity {
    try {
        if (config.customAnalyzers?.some(analyzer => analyzer.enabled !== false)) {
            throw new Error('Custom analyzer dependencies are not fully declared');
        }
        const { signal, ...settings } = config;
        void signal;
        const encoded = encodeValue({ settings, options }, new Set());
        const value = createHash('sha256').update(buildPoolFingerprint(config))
            .update(JSON.stringify(encoded)).digest('hex');
        return Object.freeze({ status: 'bound', algorithm: 'sha256', value });
    } catch (error) {
        return Object.freeze({ status: 'unavailable',
            reason: error instanceof Error ? error.message : String(error) });
    }
}
