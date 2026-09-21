/**
 * Module: Core Engine — Declarative Literal Policy Evaluator
 * File Path: src/core/policy/literal-policy-engine.ts
 * Architecture Role: Pure stateless policy engine evaluating whether numeric or string
 *   literals in function/method call contexts match declarative tolerance policies.
 * Dependencies & Triggers: Imports LiteralPolicyConfig from ./types; consumed by
 *   oxcPredicates and tsPredicates during AST walk and literal tagging.
 * Responsibilities: Resolve callee method names, evaluate argument index and value matchers,
 *   and support custom regex or set constraints without hardcoding in AST predicates.
 * Exit Semantics & Design Rationale: Pure stateless lookup with fast-path Set lookup; safe for
 *   concurrent scanning across multiple worker threads.
 */

import type { LiteralPolicyConfig, ToleratedCallArgumentPolicy } from '../types';

const RADIX_OCTAL = 8;
const RADIX_DECIMAL = 10;
const RADIX_HEX = 16;

/** Default fallback policies when no explicit configuration is provided. */
export const DEFAULT_TOLERATED_CALL_ARGUMENTS: Record<string, ToleratedCallArgumentPolicy> = {
    parseInt: { argIndex: 1, allowedValues: [2, RADIX_OCTAL, RADIX_DECIMAL, RADIX_HEX] },
    slice: { argIndex: 0, allowedValues: [0] },
    indexOf: { argIndex: 1, allowedValues: [0] },
    substring: { argIndex: 0, allowedValues: [0] },
    substr: { argIndex: 0, allowedValues: [0] },
    readFileSync: { argIndex: 1, allowedValues: ['utf8', 'utf-8'] },
    writeFileSync: { argIndex: 2, allowedValues: ['utf8', 'utf-8'] },
};

/** Pre-compiled Set cache for value lookups to achieve O(1) matching. */
const valueSetCache = new WeakMap<ToleratedCallArgumentPolicy, Set<number | string>>();

/**
 * Get or create a Set of allowed values for a given policy entry.
 *
 * @param policy - Target policy definition.
 * @returns Cached Set containing allowed values.
 */
function getOrCreateValueSet(policy: ToleratedCallArgumentPolicy): Set<number | string> {
    let set = valueSetCache.get(policy);
    if (!set) {
        set = new Set(policy.allowedValues ?? []);
        valueSetCache.set(policy, set);
    }
    return set;
}

/**
 * Extract the base identifier/method name from a full callee path (e.g. `obj.slice` -> `slice`).
 *
 * @param callee - Raw callee expression text.
 * @returns Base callee identifier.
 */
export function extractBaseCallee(callee: string): string {
    const trimmed = callee.trim();
    const dotIdx = trimmed.lastIndexOf('.');
    return dotIdx >= 0 ? trimmed.slice(dotIdx + 1) : trimmed;
}

/**
 * Check whether a function/method call argument is tolerated by declarative policy.
 *
 * @param callee - Full or base callee expression string.
 * @param argIdx - 0-based argument index in the call expression.
 * @param val - Actual literal value (number or string).
 * @param policyCfg - Optional runtime policy configuration (falls back to defaults).
 * @returns True if the literal argument is tolerated.
 */
export function isCallArgumentToleratedByPolicy(
    callee: string,
    argIdx: number,
    val: number | string,
    policyCfg?: LiteralPolicyConfig,
): boolean {
    const policies = policyCfg?.toleratedCallArguments ?? DEFAULT_TOLERATED_CALL_ARGUMENTS;
    const baseName = extractBaseCallee(callee);
    const policy = policies[baseName] ?? policies[callee.trim()];
    if (!policy) return false;

    if (policy.argIndex !== argIdx) return false;

    if (policy.allowedValues && policy.allowedValues.length > 0) {
        const set = getOrCreateValueSet(policy);
        if (set.has(val)) return true;
    }

    if (policy.allowedPattern && typeof val === 'string') {
        const re = new RegExp(policy.allowedPattern);
        if (re.test(val)) return true;
    }

    return false;
}
