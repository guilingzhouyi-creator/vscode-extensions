/**
 * Module: Core Engine — Rule Registry (volume-density entries)
 * File Path: src/core/rules/entries/volume-density.ts
 * Architecture Role: Declarative metadata for the token-density band and the plumbing-ratio
 *   budget, kept in its own entry module so the volume family's layout rules have one owner.
 * Dependencies & Triggers: core rule types plus defineRule(); consumed by ./registry.ts.
 * Responsibilities: List { id, family, analyzer, canonical flag, languages, severity, summary,
 *   remediation, docs anchor } for the three rules that judge layout against a measured ratio.
 * Exit Semantics & Design Rationale: Pure data, no behaviour. These three rules share one trait
 *   that justifies grouping them: each compares two measured quantities and reports a band, so a
 *   reader can tell which side of the budget a module fell on without reading the analyzer.
 */
import type { RuleDefinition } from '../types';
import { ALL_LANGUAGES, defineRule, SEVERITY_WARNING, RULE_FAMILY_VOLUME } from '../types';
import { ANALYZER_ARCHITECTURE, ANALYZER_LARGE_FILE } from '../../scoring/dimensionLiterals';

/** volume-density rules. */
export const VOLUME_DENSITY_RULES: readonly RuleDefinition[] = [
    defineRule({
        id: 'VOL-TAU-001',
        family: RULE_FAMILY_VOLUME,
        analyzer: ANALYZER_LARGE_FILE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Token density floor: semantic tokens per effective line must not fall below 2.5, so a module cannot be fragmented into lone arguments, isolated brackets, or single-token lines.',
        remediation:
            'Collapse vertically fragmented calls and declarations onto cohesive statements, and pass four or more parameters as a single parameter object.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#vol-tau-001',
    }),
    defineRule({
        id: 'VOL-TAU-002',
        family: RULE_FAMILY_VOLUME,
        analyzer: ANALYZER_LARGE_FILE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Token density ceiling: semantic tokens per effective line must not exceed 22, so a single line cannot pack more concepts than a reader can hold at once.',
        remediation:
            'Extract intermediate variables from monolithic chained expressions and spread nested logic across dedicated lines.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#vol-tau-002',
    }),
    defineRule({
        id: 'VOL-POR-001',
        family: RULE_FAMILY_VOLUME,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Plumbing overhead ratio budget: wiring lines (imports, re-exports, forwarding glue) must not exceed 60% of a module whose role does not make wiring its job.',
        remediation:
            'Collapse forwarding wrappers into their callers, or move the wiring into a dedicated composition root so the module carries logic rather than connections.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#vol-por-001',
    }),
];
