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
import type { Severity } from '../types';

export {
    SEVERITY_INFO,
    SEVERITY_WARNING,
    SEVERITY_ERROR,
    LANGUAGE_TYPESCRIPT,
    LANGUAGE_JAVASCRIPT,
    LANGUAGE_PYTHON,
    LANGUAGE_RUST,
    LANGUAGE_GDSCRIPT,
} from '../types';

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
    | 'ARC'
    | 'PYM'
    | 'DOC'
    | 'CONST'
    | 'DEP'
    | 'CPX'
    | 'BIG'
    | 'ERR'
    | 'CMP'
    | 'DAT'
    | 'TST'
    | 'TSM'
    | 'RSM'
    | 'GDM'
    | 'NAM'
    | 'LEGACY';

/** Canonical rule-family prefix for naming governance and hygiene rules. */
export const RULE_FAMILY_NAMING = 'NAM';
/** Canonical rule-family prefix for general language rules. */
export const RULE_FAMILY_LANG = 'LANG';
/** Canonical rule-family prefix for comments and header rules. */
export const RULE_FAMILY_COMMENTS = 'CMT';
/** Canonical rule-family prefix for simplification rules. */
export const RULE_FAMILY_SIMPLIFY = 'SIM';
/** Canonical rule-family prefix for code hygiene rules. */
export const RULE_FAMILY_HYGIENE = 'HYG';
/** Canonical rule-family prefix for architecture governance rules. */
export const RULE_FAMILY_GOVERNANCE = 'GOV';
/** Canonical rule-family prefix for performance efficiency rules. */
export const RULE_FAMILY_PERFORMANCE = 'PRF';
/** Canonical rule-family prefix for code security rules. */
export const RULE_FAMILY_SECURITY = 'SEC';
/** Canonical rule-family prefix for architecture consistency rules. */
export const RULE_FAMILY_ARCHITECTURE = 'ARCH';
/** Canonical rule-family prefix for ARC architectural rules. */
export const RULE_FAMILY_ARC = 'ARC';
/** Canonical rule-family prefix for Python modernization rules. */
export const RULE_FAMILY_PYTHON_MODERN = 'PYM';
/** Canonical rule-family prefix for documentation rules. */
export const RULE_FAMILY_DOCS = 'DOC';
/** Canonical rule-family prefix for constant extraction rules. */
export const RULE_FAMILY_CONSTANTS = 'CONST';
/** Canonical rule-family prefix for dependency layout rules. */
export const RULE_FAMILY_DEPENDENCY = 'DEP';
/** Canonical rule-family prefix for cyclomatic and cognitive complexity rules. */
export const RULE_FAMILY_COMPLEXITY = 'CPX';
/** Canonical rule-family prefix for large file size rules. */
export const RULE_FAMILY_LARGE_FILE = 'BIG';
/** Canonical rule-family prefix for static error rules. */
export const RULE_FAMILY_ERROR = 'ERR';
/** Canonical rule-family prefix for compression bounds rules. */
export const RULE_FAMILY_CMP = 'CMP';
/** Canonical rule-family prefix for data architecture rules. */
export const RULE_FAMILY_DATA_ARCHITECTURE = 'DAT';
/** Canonical rule-family prefix for test modernity rules. */
export const RULE_FAMILY_TEST_MODERNITY = 'TST';
/** Canonical rule-family prefix for TypeScript modernization rules. */
export const RULE_FAMILY_TYPESCRIPT_MODERN = 'TSM';
/** Canonical rule-family prefix for Rust modernization rules. */
export const RULE_FAMILY_RUST_MODERN = 'RSM';
/** Canonical rule-family prefix for GDScript modernization rules. */
export const RULE_FAMILY_GDSCRIPT_MODERN = 'GDM';
/** Canonical rule-family prefix for backward-compatible legacy rules. */
export const RULE_FAMILY_LEGACY = 'LEGACY';

/** Canonical legacy reason string for backward-compatible non-canonical ids. */
export const LEGACY_REASON_ID_NOT_CANONICAL = 'id-not-canonical';

/** Severity a rule carries by default; per-context escalation is described in `summary`. */
export type RuleSeverity = Severity;

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
