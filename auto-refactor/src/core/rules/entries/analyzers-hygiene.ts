/**
 * Module: Core Engine — Rule Registry (hygiene and extension entries)
 * File Path: src/core/rules/entries/analyzers-hygiene.ts
 * Architecture Role: Declarative rule metadata for physical hygiene and extension contracts;
 *   re-exported into the single ANALYZER_RULES registry.
 * Dependencies & Triggers: core rule types, defineRule(); consumed by ./analyzers.ts.
 * Responsibilities: Declare identity, severity, summary, remediation, and doc anchors for
 *   all hygiene (HYG-*) and directory extension (EXT-*) rules.
 * Exit Semantics & Design Rationale: Pure metadata; zero runtime execution logic. Keeps analyzers.ts
 *   well within the 900 ELOC volume budget limit.
 */
import type { RuleDefinition } from '../types';
import {
    ALL_LANGUAGES,
    defineRule,
    SEVERITY_INFO,
    SEVERITY_WARNING,
    SEVERITY_ERROR,
    RULE_FAMILY_HYGIENE,
    RULE_FAMILY_EXTENSION,
    LANGUAGE_PYTHON,
} from '../types';
import { ANALYZER_HYGIENE } from '../../scoring/dimensionLiterals';

/**
 * Hygiene and extension analyzer rule definitions cataloging physical hygiene,
 * file conventions, encoding contracts, and workspace directory standards.
 */
export const ANALYZER_HYGIENE_RULES: readonly RuleDefinition[] = [
    defineRule({
        id: 'HYG-BLT-001',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: [LANGUAGE_PYTHON],
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Local variable or parameter shadows Python built-in name.',
        remediation:
            'Rename variable with domain qualifiers to avoid obscuring built-in semantics.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-blt-001',
    }),
    defineRule({
        id: 'HYG-CLN-001',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Duplicated code clone detected across multiple lines based on rolling polynomial hash.',
        remediation: 'Extract duplicate code into shared helper functions or utilities.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-cln-001',
    }),
    defineRule({
        id: 'HYG-DED-001',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Unreachable dead code detected after terminating control flow (return, throw, break, raise).',
        remediation: 'Remove dead code and clean up redundant branches.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-ded-001',
    }),
    defineRule({
        id: 'HYG-EMP-001',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Zero-byte empty file, blank comment-only file, or hollow shell file lacking AST semantic payload.',
        remediation:
            'Implement full business logic and exports for the file, or delete the empty file.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-emp-001',
    }),
    defineRule({
        id: 'HYG-EOL-001',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Physical line endings contract violation (PowerShell scripts must be CRLF, other source files must be LF).',
        remediation:
            'Convert file line endings to match the workspace physical hygiene contract (.ps1 CRLF, others LF).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-eol-001',
    }),
    defineRule({
        id: 'HYG-EXC-001',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: [LANGUAGE_PYTHON],
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Exception variable in except clause is not named exc.',
        remediation: 'Standardize exception variable name to exc.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-exc-001',
    }),
    defineRule({
        id: 'HYG-NAM-001',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'File naming convention distortion (kebab-case for TS/JS, snake_case for GDScript/Python/Rust).',
        remediation: 'Rename file to align with target language engineering conventions.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-nam-001',
    }),
    defineRule({
        id: 'HYG-SGL-001',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: [LANGUAGE_PYTHON],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Single-letter variable name in business logic (only loop indices i/j/k and discard _ allowed).',
        remediation: 'Use descriptive identifier communicating variable purpose.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-sgl-001',
    }),
    defineRule({
        id: 'HYG-STB-001',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Temporary stub markers (`TODO`, `FIXME`, `XXX`, `HACK`) lingering in code or comments.',
        remediation: 'Resolve pending task and remove temporary stub markers.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-stb-001',
    }),
    defineRule({
        id: 'HYG-STB-002',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Temporary construction phase jargon (`pXX`, `phaseXX`, `stXX`, `wip`) leaking into code or comments.',
        remediation: 'Replace temporary construction jargon with enduring domain terms.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-stb-002',
    }),
    defineRule({
        id: 'HYG-SUP-001',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Unannotated compiler or linter suppression directive (@ts-ignore, @ts-nocheck, eslint-disable, # noqa) without approved exemption.',
        remediation:
            'Address the underlying type or lint error directly instead of silencing it with suppression comments, or register an approved exemption.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-sup-001',
    }),
    defineRule({
        id: 'HYG-WRAP-001',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Vacuous passthrough wrapper functions forwarding arguments directly without added value degrade effective code density.',
        remediation:
            'Call the target directly, or add validation, transformations, or logging to the wrapper.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-wrap-001',
    }),
    defineRule({
        id: 'HYG-WRAP-002',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'Redundant zero-argument forwarding wrappers trivially delegating to inner targets without validation, transformation, or abstraction.',
        remediation:
            'Expose delegate directly if polymorphism is not required, or add guard logic and transformation.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-wrap-002',
    }),
    defineRule({
        id: 'HYG-EMP-002',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Comment-only hollow file lacking executable implementation logic after stripping comments.',
        remediation:
            'Provide substantive domain implementation or delete hollow shell placeholder files.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-emp-002',
    }),
    defineRule({
        id: 'HYG-BOM-001',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'UTF-8 Byte Order Mark (BOM) header prefix presence (files must strictly be UTF-8 NO-BOM).',
        remediation:
            'Re-encode file as UTF-8 NO-BOM without 0xEF, 0xBB, 0xBF byte prefix.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-bom-001',
    }),
    defineRule({
        id: 'HYG-TRL-001',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'POSIX EOF newline contract violation (missing terminal newline or trailing blank line accumulation).',
        remediation:
            'Ensure file ends with exactly one newline character without trailing blank line buildup.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-trl-001',
    }),
    defineRule({
        id: 'HYG-IND-001',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Tab character indentation detected in non-tab language file (pure space indentation contract).',
        remediation:
            'Replace tab characters with standard space indentation (4 spaces for TS/JS, 2 spaces for JSON/configs).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-ind-001',
    }),
    defineRule({
        id: 'HYG-CLT-001',
        family: RULE_FAMILY_HYGIENE,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Uncontrolled transient clutter, log dumps, backup, or OS metadata files lingering in workspace.',
        remediation:
            'Remove temporary clutter file and ensure matching ignore rules are configured in .gitignore.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#hyg-clt-001',
    }),
    defineRule({
        id: 'EXT-DIR-001',
        family: RULE_FAMILY_EXTENSION,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'File extension and directory classification guard: scripts must reside in dedicated domain subdirectories and never litter workspace root.',
        remediation:
            'Move executable script into dedicated domain subdirectory matching its extension and domain role.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#ext-dir-001',
    }),
];
