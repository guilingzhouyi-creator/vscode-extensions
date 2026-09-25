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

/** 英文通用短语表 */
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

/** 英文核心规则条目字典 */
export const EN_RULES: Record<string, PraxisRuleI18nEntry> = {
    'SEC-CST-001': {
        name: 'Hardcoded Secret Prohibited',
        summary: 'High-entropy secret, password, or API token detected in source slice.',
        remediation: 'Move sensitive credentials to environment variables or secret vaults.',
        rationale: 'Hardcoded secrets easily leak into source control and external distributions.',
    },
    'ADV-PRF-001': {
        name: 'Hoist Invariant Expression Out of Loop',
        summary: 'Repeated expensive calculation or un-cached deep property access inside loop.',
        remediation:
            'Hoist loop-invariant expressions outside the loop and cache in a local variable.',
        rationale: 'Avoid redundant CPU cycles on hot code paths to maximize throughput.',
    },
    'ADV-PRF-002': {
        name: 'Transient Heap Allocation Guard in Loop',
        summary:
            'High-frequency temporary object allocation inside tight loop causing GC pressure.',
        remediation:
            'Pre-allocate reusable object or pool outside the loop and invoke reset_state().',
        rationale:
            'Short-lived objects trigger frequent garbage collection pauses, hurting latency.',
    },
    'ARC-COH-001': {
        name: 'File Line Count Exceeds Limit',
        summary:
            'File physical line count exceeds architecture threshold (standard limit: 400 lines).',
        remediation:
            'Split responsibilities according to Single Responsibility Principle into cohesive submodules.',
        rationale: 'Oversized files increase cognitive load and trigger frequent merge collisions.',
    },
    'ARC-COH-002': {
        name: 'File Function Count Exceeds Limit',
        summary:
            'Total number of top-level functions and methods exceeds budget (standard limit: 20).',
        remediation:
            'Group related helper functions and extract them to dedicated utility or domain classes.',
        rationale:
            'High function counts dilute architectural clarity and risk creating God Objects.',
    },
    'CMP-LOC-001': {
        name: 'High Cyclomatic Complexity in Function',
        summary: 'Too many independent control paths in function, exceeding complexity budget.',
        remediation:
            'Use guard clauses with early returns or table-driven dispatch to flatten branching.',
        rationale:
            'High branching complexity exponentially expands test matrix and obscures edge bugs.',
    },
    'CMP-LOC-002': {
        name: 'Excessive Block Nesting Depth',
        summary:
            'Control flow nesting level exceeds maximum allowable budget (standard limit: 4 levels).',
        remediation:
            'Extract deep nested blocks into private functions and adopt early return style.',
        rationale: 'Deep indentation impairs local reasoning and hurts code readability.',
    },
    'TYP-ANY-001': {
        name: 'Avoid Naked Any Type Escape',
        summary: 'Unconstrained any type or cast detected, violating static typing guarantees.',
        remediation:
            'Replace any with specific interfaces, generics, union types, or unknown + Type Guards.',
        rationale:
            'Escaped any disables TypeScript compiler safety checks and defers errors to runtime.',
    },
    'RES-LAK-001': {
        name: 'Resource Not Guaranteed Released',
        summary: 'Open streams, handles, timers, or locks not guaranteed freed in finally block.',
        remediation:
            'Wrap resource lifecycle in try...finally and call dispose/close, or use Disposable pattern.',
        rationale: 'Unreleased handles lead to descriptor exhaustion, memory leaks, and deadlocks.',
    },
    'ASY-AWT-001': {
        name: 'Missing Await on Asynchronous Promise',
        summary: 'Promise-returning function called without await or explicit error handling.',
        remediation:
            'Add await at call site or handle rejection with .then().catch() promise chains.',
        rationale: 'Floating promises create race conditions and unhandled rejection exceptions.',
    },
    'MOD-EXP-001': {
        name: 'Avoid Unbounded Wildcard Export',
        summary: 'Unconstrained export * detected, risking symbol leakage and broken tree-shaking.',
        remediation: 'Switch to explicit named exports to clearly define public API boundaries.',
        rationale:
            'Wildcard re-exports increase name collisions and enlarge final distribution bundles.',
    },
};
