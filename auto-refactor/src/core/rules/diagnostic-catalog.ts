/**
 * Module: Core Rules — Unified Diagnostic Catalog & Asset Library
 * File Path: src/core/rules/diagnostic-catalog.ts
 * Architecture Role: Central repository for structured diagnostic issue messages,
 *   actionable machine codes (AR:<DOMAIN>:<ID>), default severities, and repair suggestions.
 * Dependencies & Triggers: Consumes rule-catalog.generated constants; consumed by analyzers
 *   and Praxis presentation layer.
 * Responsibilities:
 *   1. Define DiagnosticTemplate interface for structured violation reporting;
 *   2. Map canonical SSOT rule identifiers to standardized diagnostic templates;
 *   3. Provide strongly-typed message formatting helper avoiding scattered template literals.
 * Exit Semantics & Design Rationale: Immutable frozen dictionary and pure format functions;
 *   ensures 100% bilingual presentation parity and deterministic error payload synthesis.
 */

import {
    RULE_VOL_ELOC_001,
    RULE_VOL_LOC_001,
    RULE_VOL_RATIO_001,
    RULE_VOL_DIL_001,
    RULE_VOL_DOC_001,
    RULE_CPX_BUD_001,
    RULE_HIGH_COMPLEXITY,
    RULE_CPX_NEST_001,
    RULE_SIM_LONG_001,
    RULE_SIM_ARGS_001,
    RULE_CMT_HDR_001,
    RULE_NAM_DEC_001,
    RULE_SEC_EXP_001,
    RULE_PRF_IO_001,
    RULE_TSM_VAR_001,
    RULE_TSM_CTOR_001,
    RULE_TST_TOP_001,
    RULE_STDLIB_PANIC_001,
} from '../constants/rule-catalog.generated';
import {
    RULE_NAM_VAG_001,
    RULE_NAM_ABR_001,
    RULE_NAM_LEN_001,
    RULE_NAM_LEN_002,
    RULE_NAM_SGL_001,
    RULE_NAM_TYP_001,
    RULE_NAM_GLB_001,
    RULE_NAM_MBR_001,
} from '../constants/rules-quality.generated';
import type { AgentActionablePayload, Issue, Severity } from '../types';

/** Structured diagnostic template for a rule violation. */
export interface DiagnosticTemplate {
    readonly ruleId: string;
    readonly defaultSeverity: Severity;
    readonly actionCode: string;
    readonly suggestion: string;
    readonly defaultMessage: string;
}

/** Registry of structured diagnostic templates for prominent auto-refactor rules. */
export const DIAGNOSTIC_CATALOG: Readonly<Record<string, DiagnosticTemplate>> = Object.freeze({
    [RULE_VOL_ELOC_001]: {
        ruleId: RULE_VOL_ELOC_001,
        defaultSeverity: 'error',
        actionCode: 'AR:VOL:001',
        defaultMessage: 'Effective code volume budget exceeded.',
        suggestion:
            'Decompose the module into cohesive submodules following the Single Responsibility Principle.',
    },
    [RULE_VOL_LOC_001]: {
        ruleId: RULE_VOL_LOC_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:VOL:002',
        defaultMessage: 'Physical line count ceiling exceeded.',
        suggestion:
            'Split the file into smaller focused units to reduce cognitive load and formatting bloat.',
    },
    [RULE_VOL_RATIO_001]: {
        ruleId: RULE_VOL_RATIO_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:VOL:003',
        defaultMessage: 'Dynamic dilution envelope exceeded.',
        suggestion:
            'Remove redundant blank lines, drop trivial stubs, or move extended prose into a Markdown spec.',
    },
    [RULE_VOL_DIL_001]: {
        ruleId: RULE_VOL_DIL_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:VOL:004',
        defaultMessage: 'Effective logic density below floor threshold.',
        suggestion:
            'Inline thin boilerplate or consolidate fragmented stubs to raise logical token density.',
    },
    [RULE_VOL_DOC_001]: {
        ruleId: RULE_VOL_DOC_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:VOL:005',
        defaultMessage: 'High-load module lacks architecture contract documentation.',
        suggestion:
            'Add architecture contract comments explaining concurrency, state boundaries, and failure modes.',
    },
    [RULE_CPX_BUD_001]: {
        ruleId: RULE_CPX_BUD_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:CPX:001',
        defaultMessage: 'Cyclomatic complexity exceeds maximum baseline threshold.',
        suggestion:
            'Flatten branching logic with guard clauses, table-driven lookups, or polymorphic dispatch.',
    },
    [RULE_HIGH_COMPLEXITY]: {
        ruleId: RULE_HIGH_COMPLEXITY,
        defaultSeverity: 'warning',
        actionCode: 'AR:CPX:001',
        defaultMessage: 'Cyclomatic complexity exceeds maximum baseline threshold.',
        suggestion:
            'Flatten branching logic with guard clauses, table-driven lookups, or polymorphic dispatch.',
    },
    [RULE_CPX_NEST_001]: {
        ruleId: RULE_CPX_NEST_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:CPX:002',
        defaultMessage: 'Nesting depth exceeds maximum structural budget.',
        suggestion:
            'Invert conditions with early returns or extract nested blocks into standalone helper functions.',
    },
    [RULE_SIM_LONG_001]: {
        ruleId: RULE_SIM_LONG_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:SIM:001',
        defaultMessage: 'Function body length exceeds single responsibility budget.',
        suggestion: 'Decompose the function into focused, cohesive helper functions.',
    },
    [RULE_SIM_ARGS_001]: {
        ruleId: RULE_SIM_ARGS_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:SIM:003',
        defaultMessage:
            'Function parameter count exceeds maximum threshold (4 or more parameters).',
        suggestion:
            'Group related parameters into a dedicated options object or configuration struct.',
    },
    [RULE_CMT_HDR_001]: {
        ruleId: RULE_CMT_HDR_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:CMT:001',
        defaultMessage: 'Module lacks standard 6-field JSDoc architecture contract header.',
        suggestion:
            'Add Module, File Path, Architecture Role, Dependencies, Responsibilities, and Exit Semantics.',
    },
    [RULE_NAM_DEC_001]: {
        ruleId: RULE_NAM_DEC_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:NAM:001',
        defaultMessage:
            'Identifier naming violates domain-specific convention or contains misleading abbreviations.',
        suggestion:
            'Rename symbol to reflect contract semantics using canonical domain dictionary vocabulary.',
    },
    [RULE_NAM_VAG_001]: {
        ruleId: RULE_NAM_VAG_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:NAM:002',
        defaultMessage: 'Vague identifier lacks domain context.',
        suggestion:
            'Rename to domain-qualified identifier (e.g. parseResult, tokenPayload).',
    },
    [RULE_NAM_ABR_001]: {
        ruleId: RULE_NAM_ABR_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:NAM:003',
        defaultMessage: 'Identifier has unapproved truncated abbreviation.',
        suggestion:
            'Expand unapproved abbreviation into standard domain term.',
    },
    [RULE_NAM_LEN_001]: {
        ruleId: RULE_NAM_LEN_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:NAM:004',
        defaultMessage: 'Variable identifier length outside acceptable bounds.',
        suggestion:
            'Rename to expressive identifier between 3 and 40 characters.',
    },
    [RULE_NAM_LEN_002]: {
        ruleId: RULE_NAM_LEN_002,
        defaultSeverity: 'warning',
        actionCode: 'AR:NAM:005',
        defaultMessage: 'Function identifier lacks semantic verb-noun action.',
        suggestion: 'Rename to descriptive verb-noun phrase.',
    },
    [RULE_NAM_SGL_001]: {
        ruleId: RULE_NAM_SGL_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:NAM:006',
        defaultMessage: 'Single-letter variable name in business logic scope.',
        suggestion:
            'Rename to descriptive variable; reserve single letters for loop indices.',
    },
    [RULE_NAM_TYP_001]: {
        ruleId: RULE_NAM_TYP_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:NAM:007',
        defaultMessage: 'Type definition violates PascalCase naming convention.',
        suggestion: 'Rename type or interface using PascalCase.',
    },
    [RULE_NAM_GLB_001]: {
        ruleId: RULE_NAM_GLB_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:NAM:008',
        defaultMessage: 'Module constant violates UPPER_SNAKE_CASE naming convention.',
        suggestion: 'Rename module-level constant to UPPER_SNAKE_CASE.',
    },
    [RULE_NAM_MBR_001]: {
        ruleId: RULE_NAM_MBR_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:NAM:009',
        defaultMessage: 'Member or method violates camelCase naming convention.',
        suggestion: 'Rename property or method using camelCase.',
    },
    [RULE_SEC_EXP_001]: {
        ruleId: RULE_SEC_EXP_001,
        defaultSeverity: 'error',
        actionCode: 'AR:SEC:001',
        defaultMessage:
            'Internal implementation detail or privileged token exposed across client boundary.',
        suggestion:
            'Isolate sensitive symbols behind explicit domain facades and anti-corruption layers.',
    },
    [RULE_PRF_IO_001]: {
        ruleId: RULE_PRF_IO_001,
        defaultSeverity: 'error',
        actionCode: 'AR:PRF:001',
        defaultMessage: 'Synchronous I/O operation detected in critical event loop or worker path.',
        suggestion:
            'Replace synchronous file/socket call with non-blocking asynchronous or streaming equivalent.',
    },
    [RULE_TSM_VAR_001]: {
        ruleId: RULE_TSM_VAR_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:TSM:001',
        defaultMessage: 'Legacy var declaration detected.',
        suggestion: 'Replace var with let or const for block scoping.',
    },
    [RULE_TSM_CTOR_001]: {
        ruleId: RULE_TSM_CTOR_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:TSM:002',
        defaultMessage: 'Primitive wrapper object constructor invocation detected.',
        suggestion:
            'Use literal syntax or primitive cast function instead of new Object/Number/String/Boolean.',
    },
    [RULE_TST_TOP_001]: {
        ruleId: RULE_TST_TOP_001,
        defaultSeverity: 'warning',
        actionCode: 'AR:TST:001',
        defaultMessage: 'Test file structure or assertion density violates test discipline.',
        suggestion:
            'Organize tests into deterministic Given-When-Then blocks with precise assertions.',
    },
    [RULE_STDLIB_PANIC_001]: {
        ruleId: RULE_STDLIB_PANIC_001,
        defaultSeverity: 'error',
        actionCode: 'AR:STB:001',
        defaultMessage: 'Uncontrolled panic or unwrapped exception in standard library boundary.',
        suggestion: 'Handle errors explicitly with Result/Option or typed exception recovery.',
    },
});

/**
 * Format a diagnostic message using the catalog template or fallback.
 *
 * @param ruleId - Rule identifier.
 * @param customMessage - Optional customized message.
 * @returns Final diagnostic message.
 */
export function formatDiagnosticMessage(ruleId: string, customMessage?: string): string {
    if (customMessage) return customMessage;
    const template = DIAGNOSTIC_CATALOG[ruleId];
    return template ? template.defaultMessage : `Violation of rule ${ruleId}`;
}

/**
 * Resolve the repair suggestion for a rule violation.
 *
 * @param ruleId - Rule identifier.
 * @param customSuggestion - Optional customized suggestion.
 * @returns Final repair suggestion.
 */
export function resolveDiagnosticSuggestion(ruleId: string, customSuggestion?: string): string {
    if (customSuggestion) return customSuggestion;
    const template = DIAGNOSTIC_CATALOG[ruleId];
    return template
        ? template.suggestion
        : 'Review and refactor code to adhere to workspace standards.';
}

/** Draft payload for line-oriented issue factory. */
export interface LineIssueDraft {
    lineIdx: number;
    rule: string;
    message: string;
    severity?: Severity;
    detail?: Record<string, any>;
    suggestion?: string;
}

/**
 * Construct a canonical Issue record enriched with actionable remediation directives
 * and standardized 1-based source location coordinates.
 *
 * @param analyzerName - Analyzer emitting the issue.
 * @param filePath - Target file path (normalized to forward slashes).
 * @param draft - Issue draft parameters.
 * @param actionableMap - Optional actionable metadata lookup table.
 * @returns Standardized Issue object.
 */
export function createLineIssue(
    analyzerName: string,
    filePath: string,
    draft: LineIssueDraft,
    actionableMap?: Record<string, AgentActionablePayload>,
): Issue {
    const line = draft.lineIdx + 1;
    const file = filePath.replace(/\\/g, '/');
    const mapped = actionableMap ? actionableMap[draft.rule] : undefined;
    const actionable = mapped
        ? {
            action: mapped.action,
            code: mapped.code,
            safeToAutomate: mapped.safeToAutomate,
            templateSnippet: mapped.templateSnippet,
        }
        : undefined;
    const issue: Issue = {
        id: `${analyzerName}:${draft.rule}:${file}:${line}`,
        analyzer: analyzerName,
        rule: draft.rule,
        severity: draft.severity || 'error',
        message: draft.message,
        location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
        detail: draft.detail || {},
    };
    if (draft.suggestion !== undefined) {
        issue.suggestion = draft.suggestion;
    }
    if (actionable !== undefined) {
        issue.actionable = actionable;
    }
    return issue;
}

/**
 * In-place batch enrichment of existing issues with actionable remediation payloads.
 *
 * @param issues - Target array of issues to enrich.
 * @param actionableMap - Rule to actionable mapping lookup table.
 */
export function attachActionableMetadata(
    issues: Issue[],
    actionableMap: Record<string, AgentActionablePayload>,
): void {
    for (const iss of issues) {
        if (!iss.actionable && actionableMap[iss.rule]) {
            const mapped = actionableMap[iss.rule];
            iss.actionable = {
                action: mapped.action,
                code: mapped.code,
                safeToAutomate: mapped.safeToAutomate,
                templateSnippet: mapped.templateSnippet,
            };
        }
    }
}
