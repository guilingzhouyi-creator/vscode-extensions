/**
 * Module: Core Engine — Rule Registry Types
 * File Path: src/core/rules/types.ts
 * Architecture Role: Shared shape for every rule entry: canonical id pattern, family and
 *   severity unions, the RuleDefinition contract, and the defineRule identity helper.
 * Dependencies & Triggers: core types only; imported by every entries/* module and by the index.
 * Responsibilities: Define RULE_ID_PATTERN (FAMILY-TOPIC-NNN), RuleFamily, RuleSeverity,
 *   RuleDefinition and defineRule().
 * Exit Semantics & Design Rationale: Types plus one identity function; no side effects and no
 *   dependency on the entry modules, so entries can import it without a cycle.
 */

/** Canonical rule-id shape: FAMILY-TOPIC-NNN (upper-case family, short topic, 3 digits). */
export const RULE_ID_PATTERN = /^[A-Z][A-Z0-9]{1,5}(?:-[A-Z0-9]{2,10}){1,3}-\d{3}$/;

/** Rule families the engine recognises (canonical prefixes). */
export type RuleFamily =
    | 'LANG'
    | 'CMT'
    | 'SIM'
    | 'HYG'
    | 'GOV'
    | 'PRF'
    | 'SEC'
    | 'ARCH'
    | 'PYM'
    | 'DOC'
    | 'CONST'
    | 'DEP'
    | 'CPX'
    | 'BIG'
    | 'ERR'
    | 'CMP'
    | 'LEGACY';

/** Severity a rule carries by default; per-context escalation is described in `summary`. */
export type RuleSeverity = 'info' | 'warning' | 'error';

/** Metadata for one rule id: identity, ownership, language scope, intent and remediation. */
export interface RuleDefinition {
    /** Stable rule id as it appears on every emitted issue. */
    id: string;
    /** Canonical family prefix; legacy ids carry the family they conceptually belong to. */
    family: RuleFamily | string;
    /** Analyzer id that emits the rule. */
    analyzer: string;
    /** True when the id matches RULE_ID_PATTERN. */
    canonical: boolean;
    /** Why a non-canonical id is still in use (rename requires an alias window). */
    legacyReason?: string;
    /** Languages the rule applies to, or ALL_LANGUAGES for every supported language. */
    languages: readonly string[];
    /** Base severity; rules that escalate per context say so in the summary. */
    defaultSeverity: RuleSeverity;
    /** One-line intent (what the rule is about). */
    summary: string;
    /** One-line remediation hint. */
    remediation: string;
    /** Documentation anchor, or 'TODO' when the rule still needs a docs row. */
    docsAnchor: string;
}

/** Language scope used by rules that are not language-specific. */
export const ALL_LANGUAGES: readonly string[] = ['all'];

/**
 * Identity helper that keeps entries type-checked without extra imports.
 *
 * @param definition - Rule metadata to register.
 * @returns The same definition, typed.
 */
export function defineRule(definition: RuleDefinition): RuleDefinition {
    return definition;
}
