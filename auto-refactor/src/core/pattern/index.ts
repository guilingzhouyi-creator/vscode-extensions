/**
 * Module: Core Engine — Declarative Structural Pattern Facade
 * File Path: src/core/pattern/index.ts
 * Architecture Role: Central substantive facade for declarative AST pattern matching,
 *   metavariable capture, and template rewrite synthesis inspired by GritQL/ast-grep.
 * Dependencies & Triggers: Consumed by pattern analyzers, refactoring pipelines, and CLI.
 * Responsibilities:
 *   1. Re-export pattern contracts and pure structural pattern engine routines;
 *   2. Enforce runtime validation of declarative PatternSpec schemas;
 *   3. Enforce structural immutability guarantees via Object.freeze.
 * Exit Semantics & Design Rationale: Throws defensive TypeError on schema violations;
 *   deeply freezes rule configurations to protect AST patterns against runtime mutations.
 */

import type { PatternSpec } from './types';
import {
    StructuralPatternEngine,
    compilePattern,
    generateUnifiedDiff,
    matchAndRewrite,
    rewriteUntilFixpoint,
    matchPattern,
} from './structural-pattern-engine';

export * from './types';
export * from './structural-pattern-engine';

/**
 * Asserts that candidate input adheres to the PatternSpec interface contract.
 *
 * @param candidate - Unknown candidate value to validate.
 * @throws TypeError if candidate is nullish or misses mandatory pattern fields.
 */
export function assertValidPatternSpec(candidate: unknown): asserts candidate is PatternSpec {
    if (!candidate || typeof candidate !== 'object') {
        throw new TypeError('PatternSpec must be a non-null object');
    }

    const spec = candidate as Record<string, unknown>;
    if (typeof spec.id !== 'string' || spec.id.trim().length === 0) {
        throw new TypeError('PatternSpec.id must be a non-empty string');
    }

    if (typeof spec.pattern !== 'string' || spec.pattern.trim().length === 0) {
        throw new TypeError('PatternSpec.pattern must be a non-empty string');
    }

    if (typeof spec.rewrite !== 'string') {
        throw new TypeError('PatternSpec.rewrite must be a string');
    }

    if (spec.kind !== undefined) {
        const validKinds = ['auto', 'expression', 'statement'];
        if (!validKinds.includes(spec.kind as string)) {
            throw new TypeError(`PatternSpec.kind must be one of: ${validKinds.join(', ')}`);
        }
    }
}

/**
 * Deeply freezes a PatternSpec definition ensuring immutable runtime properties.
 *
 * @param spec - Mutable or partially frozen pattern configuration.
 * @returns Fully frozen PatternSpec object.
 */
export function freezePatternSpec(spec: PatternSpec): Readonly<PatternSpec> {
    assertValidPatternSpec(spec);
    if (spec.where) {
        for (const constraint of Object.values(spec.where)) {
            Object.freeze(constraint);
        }
        Object.freeze(spec.where);
    }
    return Object.freeze({ ...spec });
}

/**
 * Validates and pre-compiles a list of pattern specifications into frozen rules.
 *
 * @param specs - Sequence of pattern specifications.
 * @returns Frozen array of frozen PatternSpec objects.
 */
export function createPatternSuite(
    specs: readonly PatternSpec[],
): readonly Readonly<PatternSpec>[] {
    const frozenSuite: Readonly<PatternSpec>[] = [];
    for (let i = 0; i < specs.length; i++) {
        const frozen = freezePatternSpec(specs[i]);
        compilePattern(frozen);
        frozenSuite.push(frozen);
    }
    return Object.freeze(frozenSuite);
}

/**
 * Unified substantive facade for structural pattern rewriting.
 */
export const PatternFacade = Object.freeze({
    engine: StructuralPatternEngine,
    matchAndRewrite,
    rewriteUntilFixpoint,
    matchPattern,
    compilePattern,
    generateUnifiedDiff,
    assertValidPatternSpec,
    freezePatternSpec,
    createPatternSuite,
});
