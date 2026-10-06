/**
 * Module: Core Engine — Generalized Pattern Matching Kernel & Substantive Facade
 * File Path: src/core/patterns/index.ts
 * Architecture Role: Central facade for generalized semantic pattern archetypes;
 *   re-exports pattern types and matchers, validates pattern configurations, and provides immutability.
 * Dependencies & Triggers: Consumed across analyzers, presets, and architectural gates.
 * Responsibilities:
 *   1. Re-export pattern types and pure matching functions;
 *   2. Validate runtime shapes of ResourceLifecyclePattern;
 *   3. Enforce immutability guarantees via Object.freeze.
 * Exit Semantics & Design Rationale: Clean defensive validation throwing TypeError on invalid input;
 *   Object.freeze immutability prevents runtime tamper.
 */

import type { ResourceLifecyclePattern } from './types';

export * from './types';
export * from './pattern-matcher';

/**
 * Asserts that the supplied candidate object satisfies the ResourceLifecyclePattern contract.
 *
 * @param pattern - Candidate pattern configuration to validate.
 * @throws TypeError if pattern is not an object or lacks required attributes.
 */
export function assertValidResourcePattern(pattern: unknown): asserts pattern is ResourceLifecyclePattern {
    if (!pattern || typeof pattern !== 'object') {
        throw new TypeError('ResourceLifecyclePattern must be a non-null object');
    }
    const candidate = pattern as Record<string, unknown>;
    if (typeof candidate.name !== 'string' || candidate.name.length === 0) {
        throw new TypeError('ResourceLifecyclePattern.name must be a non-empty string');
    }
    if (!Array.isArray(candidate.acquisitionPatterns) || !Array.isArray(candidate.containerPatterns)) {
        throw new TypeError('ResourceLifecyclePattern requires acquisitionPatterns and containerPatterns arrays');
    }
}

/**
 * Freezes a ResourceLifecyclePattern and its pattern arrays to guarantee immutability.
 *
 * @param pattern - Mutable pattern configuration.
 * @returns Frozen ResourceLifecyclePattern instance.
 */
export function freezeResourcePattern(pattern: ResourceLifecyclePattern): Readonly<ResourceLifecyclePattern> {
    assertValidResourcePattern(pattern);
    Object.freeze(pattern.acquisitionPatterns);
    Object.freeze(pattern.containerPatterns);
    if (pattern.releasePatterns) Object.freeze(pattern.releasePatterns);
    return Object.freeze({ ...pattern });
}

/**
 * Creates an immutable default resource lifecycle pattern descriptor.
 *
 * @param name - Descriptive pattern archetype name.
 * @returns Frozen empty ResourceLifecyclePattern.
 */
export function createDefaultResourcePattern(name: string): Readonly<ResourceLifecyclePattern> {
    return Object.freeze({
        name,
        acquisitionPatterns: Object.freeze([]),
        containerPatterns: Object.freeze([]),
    });
}
