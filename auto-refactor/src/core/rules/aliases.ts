/**
 * Module: Core Engine — Legacy Rule-id Alias Window
 * File Path: src/core/rules/aliases.ts
 * Architecture Role: Resolution layer between the historical rule ids (no canonical shape, but
 *     already part of frozen baselines and consumer configs) and the canonical ids those rules
 *     will be emitted under
 * Dependencies & Triggers: ./registry for the definition set, ./types for RULE_ID_PATTERN;
 *     consumed by the suppression matcher, by consumers migrating a baseline, and by
 *     scripts/validate-rule-aliases.js in `npm test`
 * Responsibilities: Publish `LEGACY_RULE_ALIASES` (legacy id -> canonical id) plus
 *     `canonicalRuleId()` / `areAliasForms()`; keep the mapping complete (every `canonical: false`
 *     registry entry), one-to-one and shape-valid, so flipping the emitted id later cannot orphan
 *     a baseline row or a `matchRule` suppression
 * Exit Semantics & Design Rationale: Pure data plus pure lookups; an unknown id resolves to itself,
 *     which lets matching code call `canonicalRuleId()` unconditionally and keep working with ids
 *     the engine does not know (custom analyzers). A rename without an alias window would break
 *     every frozen baseline and every suppression that names the old id, so both spellings keep
 *     matching until a major version retires the legacy form.
 */
import { getRule, RULE_REGISTRY } from './registry';
import { RULE_ID_PATTERN } from './types';

/**
 * Canonical replacement for each legacy id.
 *
 * Families follow the owning analyzer's existing canonical family (`ARCH`, `DEP`, `SEC`, …) so a
 * renamed rule stays grouped with its siblings in reports and documentation.
 */
export const LEGACY_RULE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
    'analyzer-error': 'ENG-RUN-001',
    'clean-layer-violation': 'ARCH-CLN-001',
    'disallowed-import': 'DEP-IMP-001',
    'duplicate-literal': 'CST-DUP-001',
    'expensive-loop-operation': 'PRF-CLON-001',
    'high-algorithmic-complexity': 'PRF-NEST-001',
    'high-complexity': 'CPX-CYC-001',
    'high-entropy-token': 'SEC-ENT-001',
    'import-cycle': 'DEP-CYC-001',
    'large-file': 'BIG-SIZE-001',
    'loop-transient-allocation': 'PRF-TRAN-001',
    'nested-constant': 'CST-NST-001',
    'secret-detected': 'SEC-TOK-001',
    'unused-export': 'DEP-UNX-001',
    'unused-module': 'DEP-UNM-001',
});

/**
 * Resolve any rule id to the canonical id that decides its identity.
 *
 * @param id - Rule id as emitted or written in a config/baseline.
 * @returns The canonical id for a legacy alias, otherwise the id itself.
 */
export function canonicalRuleId(id: string): string {
    return LEGACY_RULE_ALIASES[id] ?? id;
}

/**
 * Report whether two spellings name the same rule.
 *
 * Used by suppression and baseline matching so a config written against the legacy id keeps
 * working with a canonical report (and the other way round) during the alias window.
 *
 * @param left - First rule id, legacy or canonical.
 * @param right - Second rule id, legacy or canonical.
 * @returns True when both resolve to the same canonical id.
 */
export function areAliasForms(left: string, right: string): boolean {
    return canonicalRuleId(left) === canonicalRuleId(right);
}

/**
 * List every registered id that still needs the alias window.
 *
 * @returns Registered ids whose shape predates the canonical convention.
 */
export function legacyRuleIds(): string[] {
    return RULE_REGISTRY.filter((rule) => !rule.canonical).map((rule) => rule.id);
}

/**
 * Report whether the alias table covers the registry exactly once.
 *
 * @returns Ids missing an alias, aliases without a registry entry, targets that are not
 *   canonical-shaped, and target collisions; empty arrays mean the window is consistent.
 */
export function auditAliasWindow(): {
    missingAlias: string[];
    unknownAlias: string[];
    malformedTarget: string[];
    duplicateTargets: string[];
} {
    const legacy = legacyRuleIds();
    const keys = Object.keys(LEGACY_RULE_ALIASES);
    const targets = keys.map((key) => LEGACY_RULE_ALIASES[key]);
    const seen = new Set<string>();
    const duplicateTargets: string[] = [];
    for (const target of targets) {
        if (seen.has(target)) duplicateTargets.push(target);
        seen.add(target);
    }
    return {
        missingAlias: legacy.filter((id) => !(id in LEGACY_RULE_ALIASES)),
        unknownAlias: keys.filter((id) => !getRule(id)),
        malformedTarget: keys.filter((id) => !RULE_ID_PATTERN.test(LEGACY_RULE_ALIASES[id])),
        duplicateTargets,
    };
}
