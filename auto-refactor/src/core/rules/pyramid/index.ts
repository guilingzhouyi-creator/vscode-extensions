/**
 * Module: Core Engine — Rule Pyramid Subsystem Index & Substantive Facade
 * File Path: src/core/rules/pyramid/index.ts
 * Architecture Role: Central facade for the three-tier rule pyramid subsystem;
 *   re-exports rule hierarchy models and evaluators, validates rule layers, and guarantees immutability.
 * Dependencies & Triggers: Re-exports ./types, ./layer1Evaluator, and ./performanceRules.
 * Responsibilities:
 *   1. Single point of export for the universal rule pyramid;
 *   2. Validate runtime RuleLayer discriminator values;
 *   3. Enforce immutability on UniversalEvaluationContext via Object.freeze.
 * Exit Semantics & Design Rationale: Bounded defensive validation throwing TypeError on invalid input;
 *   Object.freeze immutability prevents evaluation context mutation.
 */

import {
    RULE_LAYER_UNIVERSAL,
    RULE_LAYER_FAMILY,
    RULE_LAYER_DIALECT,
    type RuleLayer,
    type UniversalEvaluationContext,
} from './types';

export * from './types';
export * from './layer1Evaluator';
export * from './performanceRules';

/**
 * Asserts that the supplied candidate value is a valid RuleLayer tier identifier.
 *
 * @param layer - Candidate layer identifier to validate.
 * @throws TypeError if layer is not one of the canonical tier constants.
 */
export function assertValidRuleLayer(layer: unknown): asserts layer is RuleLayer {
    if (
        layer !== RULE_LAYER_UNIVERSAL &&
        layer !== RULE_LAYER_FAMILY &&
        layer !== RULE_LAYER_DIALECT
    ) {
        throw new TypeError(
            `Invalid RuleLayer: expected '${RULE_LAYER_UNIVERSAL}', '${RULE_LAYER_FAMILY}', or '${RULE_LAYER_DIALECT}'`,
        );
    }
}

/**
 * Freezes a UniversalEvaluationContext to ensure deterministic evaluation without runtime mutation.
 *
 * @param context - Mutable evaluation context.
 * @returns Frozen UniversalEvaluationContext instance.
 */
export function freezeRuleContext(
    context: UniversalEvaluationContext,
): Readonly<UniversalEvaluationContext> {
    if (!context || typeof context !== 'object') {
        throw new TypeError('UniversalEvaluationContext must be a non-null object');
    }
    return Object.freeze({ ...context });
}

/**
 * Creates an immutable default evaluation context for the universal rule pyramid.
 *
 * @param rootDir - Optional target workspace root directory.
 * @returns Frozen UniversalEvaluationContext instance.
 */
export function createDefaultEvaluationContext(
    rootDir?: string,
): Readonly<UniversalEvaluationContext> {
    return Object.freeze({
        rootDir,
        baselineIssueIds: Object.freeze(new Set<string>()),
    });
}
