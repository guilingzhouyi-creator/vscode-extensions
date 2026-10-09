/**
 * Module: Core Engine — Rule Registry (naming governance entries)
 * File Path: src/core/rules/entries/naming.ts
 * Architecture Role: Declarative rule metadata for the naming governance domain; index in
 *   ./registry.ts concatenates this list into the single RULE_REGISTRY source of truth.
 * Dependencies & Triggers: core rule types plus defineRule(); consumed by ./registry.ts
 * Responsibilities: Declare RuleDefinition entries for NAM-FIL-001, NAM-DIR-001, NAM-GLB-001,
 *   NAM-GLB-002, NAM-TYP-001, NAM-MBR-001, NAM-VAG-001, NAM-SGL-001, and NAM-COL-001.
 * Exit Semantics & Design Rationale: Pure data, no behaviour. Provides a unified identity and
 *   documentation anchor for all naming governance and hygiene rules across languages.
 */
import type { RuleDefinition } from '../types';
import {
    ALL_LANGUAGES,
    defineRule,
    SEVERITY_WARNING,
    SEVERITY_INFO,
    RULE_FAMILY_NAMING,
} from '../types';
import {
    ANALYZER_NAMING,
    RULE_NAM_LEN_001,
    RULE_NAM_LEN_002,
    RULE_NAM_ABR_001,
} from '../../scoring/dimensionLiterals';

/**
 * Naming governance rule table: every rule whose owner is the naming analyzer.
 */
export const NAMING_RULES: readonly RuleDefinition[] = [
    defineRule({
        id: RULE_NAM_ABR_001,
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Identifier contains cryptic, incomplete, or non-standard abbreviations harming code readability.',
        remediation:
            'Expand cryptic abbreviations to standard unabbreviated domain terms or approved domain acronyms.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-abr-001',
    }),
    defineRule({
        id: 'NAM-COL-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'Collections (Array/Set) should use plural nouns or List suffixes; mappings (Map/Dict) should express key-to-value relationships.',
        remediation:
            'Pluralize array collections and name mappings using *To* or *By* to clarify associations.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-col-001',
    }),
    defineRule({
        id: 'NAM-DEC-001',
        canonical: true,
        defaultSeverity: SEVERITY_WARNING,
        family: RULE_FAMILY_NAMING,
        languages: ALL_LANGUAGES,
        analyzer: ANALYZER_NAMING,
        summary:
            'Identifier length inflation (30-40+ characters) or multiple symbols sharing long prefixes indicates insufficient modular decomposition.',
        remediation:
            'Extract shared domain modules or subdirectories, turning redundant prefixes into module namespaces and reducing individual symbol length.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-dec-001',
    }),
    defineRule({
        id: 'NAM-DIR-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Source directory names must be lowercase kebab-case or single words; CamelCase, spaces, and temporary phase words are prohibited.',
        remediation: 'Rename directory to lowercase hyphenated style (e.g., ast-utils, pipeline).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-dir-001',
    }),
    defineRule({
        id: 'NAM-FIL-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'File names must follow target language conventions (kebab-case for TS/JS, snake_case for Python/Rust/GDScript) and contain no temporary construction jargon.',
        remediation:
            'Rename file to follow standard language conventions (e.g., foo-bar.ts or foo_bar.py) without temporary phase tags.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-fil-001',
    }),
    defineRule({
        id: 'NAM-GLB-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Module-level immutable constants must adhere to UPPER_SNAKE_CASE naming conventions.',
        remediation:
            'Rename module-level primitive constants to uppercase snake_case (e.g., MAX_RETRIES, DEFAULT_TIMEOUT).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-glb-001',
    }),
    defineRule({
        id: 'NAM-GLB-002',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Mutable let or var declarations at module scope are prohibited (avoid implicit global shared mutable state).',
        remediation:
            'Refactor top-level mutable state into function-scoped variables, class properties, or explicit singleton state holders.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-glb-002',
    }),
    defineRule({
        id: 'NAM-JRG-002',
        canonical: true,
        defaultSeverity: SEVERITY_WARNING,
        family: RULE_FAMILY_NAMING,
        languages: ALL_LANGUAGES,
        analyzer: ANALYZER_NAMING,
        summary:
            'Engineering assets and test suites must not contain construction phase or temporary jargon markers (phase numbers, temporary tokens, `wip` markers).',
        remediation:
            'Replace phase markers with semantic names representing actual domain capabilities and architecture features.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-jrg-002',
    }),
    defineRule({
        id: RULE_NAM_LEN_001,
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Variable identifier length is outside acceptable bounds (excessively short or excessively long).',
        remediation:
            'Choose a descriptive, balanced variable name communicating clear semantic intent without extreme brevity or verbosity.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-len-001',
    }),
    defineRule({
        id: RULE_NAM_LEN_002,
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Function or method identifier length is too short to communicate its operational responsibility.',
        remediation:
            'Rename function with an expressive verb-noun phrase clearly describing its operation and side effects.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-len-002',
    }),
    defineRule({
        id: 'NAM-MBR-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Class properties, object fields, and methods must follow camelCase naming conventions.',
        remediation: 'Adjust property and method names to clear, descriptive camelCase.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-mbr-001',
    }),
    defineRule({
        id: 'NAM-RES-001',
        canonical: true,
        defaultSeverity: SEVERITY_WARNING,
        family: RULE_FAMILY_NAMING,
        languages: ALL_LANGUAGES,
        analyzer: ANALYZER_NAMING,
        summary:
            'Structured resource repositories (constants, strings, rules, configs) are overly broad and bloated, requiring decomposition by domain.',
        remediation:
            'Decompose monolithic files into secondary topology modules (e.g., constants-network.ts, constants-ui.ts) based on functional domains.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-res-001',
    }),
    defineRule({
        id: 'NAM-RES-002',
        canonical: true,
        defaultSeverity: SEVERITY_INFO,
        family: RULE_FAMILY_NAMING,
        languages: ALL_LANGUAGES,
        analyzer: ANALYZER_NAMING,
        summary:
            'Over-fragmentation in structured resource repositories where tiny files use 3-level deep names; consolidate into parent domain.',
        remediation:
            'Merge low-volume, highly cohesive sub-repositories into secondary domain modules to minimize cognitive overhead.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-res-002',
    }),
    defineRule({
        id: 'NAM-RES-003',
        canonical: true,
        defaultSeverity: SEVERITY_WARNING,
        family: RULE_FAMILY_NAMING,
        languages: ALL_LANGUAGES,
        analyzer: ANALYZER_NAMING,
        summary:
            'Resource repository naming depth exceeds limit (maximum 3 tiers: base type + functional domain + optional subdomain).',
        remediation:
            'Flatten naming topology to at most three tiers (base type + domain + optional subdomain) to eliminate excessive nesting.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-res-003',
    }),
    defineRule({
        id: 'NAM-RES-004',
        canonical: true,
        defaultSeverity: SEVERITY_WARNING,
        family: RULE_FAMILY_NAMING,
        languages: ALL_LANGUAGES,
        analyzer: ANALYZER_NAMING,
        summary:
            'Resource repository file name has excessive descriptive word stacking, creating maintenance burden.',
        remediation:
            'Remove redundant descriptor stacking and use concise domain terminology reflecting architectural responsibilities.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-res-004',
    }),
    defineRule({
        id: 'NAM-RES-005',
        canonical: true,
        defaultSeverity: SEVERITY_WARNING,
        family: RULE_FAMILY_NAMING,
        languages: ALL_LANGUAGES,
        analyzer: ANALYZER_NAMING,
        summary:
            'Resource repository file responsibility mismatch (declared as pure constant library but contains substantial executable functions/classes).',
        remediation:
            'Move executable logic into domain services or utility modules, preserving purity of structured resource repositories.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-res-005',
    }),
    defineRule({
        id: 'NAM-SGL-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Single-letter variable names in business logic are prohibited (exemptions: loop counters and discard symbols).',
        remediation:
            'Use descriptive identifiers communicating intent; reserve single letters strictly for loop indices (i, j) or discard (_).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-sgl-001',
    }),
    defineRule({
        id: 'NAM-TYP-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Type definitions, interfaces, and class declarations must follow PascalCase naming conventions.',
        remediation:
            'Rename classes, interfaces, type aliases, and enums to PascalCase (e.g., Scanner, RuleDefinition).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-typ-001',
    }),
    defineRule({
        id: 'NAM-VAG-001',
        family: RULE_FAMILY_NAMING,
        analyzer: ANALYZER_NAMING,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Vague or meaningless generic variable names (such as bare data, res, ret, tmp, item) are prohibited.',
        remediation:
            'Append domain-specific prefixes or suffixes reflecting semantic intent (e.g., parseResult, tokenPayload, ruleEntry).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nam-vag-001',
    }),
];
