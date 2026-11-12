/**
 * Module: Core Engine - Praxis Presentation English Dictionary
 * File Path: src/core/praxis/presentation/dictionaries/en.ts
 * Architecture Role: Provide built-in English (en) localization dictionary
 *   for Praxis frontend cards, diagnostics badges, and core governance rules.
 * Dependencies & Triggers: Implements definitions from ../i18n-types; consumed by i18nProvider.
 * Responsibilities: Export localized common UI strings and rule descriptions in English.
 * Exit Semantics & Design Rationale: Static dictionary constant; guarantees complete coverage
 *   for high-frequency security, performance, architecture, and complexity rules.
 */

import type { PraxisCommonI18nStrings, PraxisRuleI18nEntry } from '../i18n-types';

/** English common phrases dictionary */
export const EN_COMMON: PraxisCommonI18nStrings = {
    verdictPass: 'All compliance checks passed with zero violations',
    verdictWarn: 'Non-blocking governance warnings detected',
    verdictBlock: 'Critical blocking violations found; resolution required',
    badgePass: 'PASS',
    badgeWarn: 'WARN',
    badgeBlock: 'BLOCK',
    badgeInfo: 'INFO',
    linePrefix: 'Line {0}',
    quickFixLabel: 'Suggested Fix',
    docsLabel: 'View Documentation',
    tokenSavingsLabel: 'Agent Prompt Token Compression: {0}%',
    defaultCategoryTitle: 'Code Governance',
};

/** English core rule dictionary */
export const EN_RULES: Record<string, PraxisRuleI18nEntry> = {
    'NUM-PREC-001': {
        name: 'Lossy Precision Truncation Governance',
        summary:
            'Low-precision rounding (* 10 / 10 or toFixed(1)) or mismatched scaling detected, introducing IEEE 754 truncation drift.',
        remediation:
            'Align numeric rounding to standard 0.01 precision (e.g. SCORE_ROUNDING = 100) and normalize -0 differences.',
        rationale:
            'Lossy 0.1 truncation leads to false equivalence and corrupted multi-axis score arbitration.',
    },
    'TST-FLT-001': {
        name: 'Fragile Floating-Point Assertion',
        summary:
            'Test case performs direct strict equality assertion against naked float literal without tolerance.',
        remediation:
            'Replace with tolerance matcher (e.g. toBeCloseTo(expected, 2)) or shared formula derivation.',
        rationale:
            'Subtle cross-platform floating-point epsilon variations cause intermittent test suite failures.',
    },
    'GOV-SAN-002': {
        name: 'Objective Technical Prose Sanitization',
        summary:
            'Comments or documentation contain promotional slogans, hyperbole, or casual markers.',
        remediation:
            'Replace with objective, verifiable technical statements specifying exact boundaries and mechanisms.',
        rationale:
            'Documentation and source comments must remain purely factual and avoid subjective claims.',
    },
    'GOV-LOG-001': {
        name: 'Control Flow Nesting Depth Constraint',
        summary:
            'Deeply nested control flows (> 5 levels) create high cognitive load and defect risk.',
        remediation:
            'Refactor with guard clauses (early returns) or extract nested logic into sub-functions.',
        rationale: 'Flat control flows improve readability and isolate failure domains.',
    },
    'GOV-LOG-002': {
        name: 'Vacuous Pass-through Wrapper Governance',
        summary:
            'Function or facade layer merely forwards calls without translation, validation, or contract checks.',
        remediation:
            'Inline call sites and remove trampoline module, or add substantive validation logic.',
        rationale:
            'Vacuous wrapper files introduce indirection without delivering architectural value.',
    },
};
