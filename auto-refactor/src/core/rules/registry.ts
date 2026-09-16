/**
 * Module: Core Engine — Rule Registry (single source of rule identity, shadow mode)
 * File Path: src/core/rules/registry.ts
 * Architecture Role: Index over the per-domain rule entry modules. Nothing reads the registry
 *   for behaviour yet — it exists so naming conventions, the emitted-id set and the
 *   documentation table are validated against ONE source instead of drifting apart.
 * Dependencies & Triggers: ./types plus ./entries/*; consumed by scripts/validate-rules-registry.js
 *   (npm test) and, in later batches, by docs/SARIF generators.
 * Responsibilities: Concatenate the domain entry lists into RULE_REGISTRY and expose getRule(),
 *   rulesForAnalyzer() and canonicalRuleIds(); re-export the shared types for consumers.
 * Exit Semantics & Design Rationale: Pure data plus pure lookups. Ids that predate the canonical
 *   naming convention stay listed with canonical:false and a legacyReason instead of being
 *   renamed, because rule ids are part of baselines and consumer configs — renames must go
 *   through an alias window, not a silent rewrite.
 */
import { ANALYZER_RULES } from './entries/analyzers';
import { GOVERNANCE_RULES } from './entries/governance';
import { PLATFORM_RULES } from './entries/platform';
import type { RuleDefinition } from './types';

export type { RuleDefinition, RuleFamily, RuleSeverity } from './types';
export { RULE_ID_PATTERN, defineRule } from './types';

/** Every rule id the engine can emit, sorted by id for stable output. */
export const RULE_REGISTRY: readonly RuleDefinition[] = [
    ...ANALYZER_RULES,
    ...GOVERNANCE_RULES,
    ...PLATFORM_RULES,
].sort((a, b) => a.id.localeCompare(b.id));

/**
 * Look up one rule definition.
 *
 * @param id - Rule id to resolve.
 * @returns The definition, or undefined when the id is not registered.
 */
export function getRule(id: string): RuleDefinition | undefined {
    return RULE_REGISTRY.find((rule) => rule.id === id);
}

/**
 * List the rules owned by one analyzer.
 *
 * @param analyzer - Analyzer id (e.g. 'hygiene', 'governance').
 * @returns Registered definitions for that analyzer.
 */
export function rulesForAnalyzer(analyzer: string): RuleDefinition[] {
    return RULE_REGISTRY.filter((rule) => rule.analyzer === analyzer);
}

/**
 * List canonical ids only, for naming and documentation-coverage checks.
 *
 * @returns Ids whose shape matches RULE_ID_PATTERN.
 */
export function canonicalRuleIds(): string[] {
    return RULE_REGISTRY.filter((rule) => rule.canonical).map((rule) => rule.id);
}
