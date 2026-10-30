/**
 * Module: Core Reporting — AAS Remediation Recipe Generator
 * File Path: src/core/reporting/aas-remediation.ts
 * Architecture Role: Builds actionable remediation recipes and concise suggestion templates.
 * Dependencies & Triggers: Consumes ../types and ./aas-types; imported by aas-reporter.ts.
 * Responsibilities:
 *   1. Resolve semantic action verb from canonical rule identifier.
 *   2. Sanitize and bound suggestion templates (<= 80 chars) to prevent prose bloat.
 *   3. Assemble AasFixRecipe with actionable patch, template snippet, and safety flags.
 * Exit Semantics & Design Rationale: Pure, non-throwing transformation; CC <= 10, Depth <= 3.
 */

import type { Issue } from '../types';
import type { AasFixRecipe } from './aas-types';

export const ACTION_RENAME_IDENTIFIER = 'rename_identifier';
export const ACTION_EXTRACT_CONSTANT = 'extract_constant';
export const ACTION_SPLIT_FILE = 'split_file';
export const ACTION_DECOMPOSE_COMPLEXITY = 'decompose_complexity';
export const ACTION_SIMPLIFY_CODE = 'simplify_code';
export const ACTION_OPTIMIZE_PERFORMANCE = 'optimize_performance';
export const ACTION_DECOUPLE_ARCHITECTURE = 'decouple_architecture';
export const ACTION_RESOLVE_DEPENDENCY = 'resolve_dependency';
export const ACTION_HARDEN_SECURITY = 'harden_security';
export const ACTION_SANITIZE_HYGIENE = 'sanitize_hygiene';
export const ACTION_REFACTOR = 'refactor';

export const RULE_HARDCODED_STRING = 'hardcoded-string';
export const RULE_MAGIC_NUMBER = 'magic-number';
export const RULE_LARGE_FILE = 'large-file';
export const RULE_HIGH_COMPLEXITY = 'high-complexity';

const MAX_SUGGESTION_CHARS = 80;
const ELLIPSIS_TRUNCATE_CHARS = 77;
const ELLIPSIS = '…';

/**
 * Resolves concise semantic action verb from canonical rule identifier.
 */
export function resolveActionFromRule(rule: string): string {
    if (rule.startsWith('NAM-')) return ACTION_RENAME_IDENTIFIER;
    if (rule.startsWith('CST-') || rule === RULE_HARDCODED_STRING || rule === RULE_MAGIC_NUMBER) {
        return ACTION_EXTRACT_CONSTANT;
    }
    if (rule.startsWith('BIG-') || rule === RULE_LARGE_FILE) return ACTION_SPLIT_FILE;
    if (rule.startsWith('CPX-') || rule === RULE_HIGH_COMPLEXITY) return ACTION_DECOMPOSE_COMPLEXITY;
    if (rule.startsWith('SIM-')) return ACTION_SIMPLIFY_CODE;
    if (rule.startsWith('PRF-')) return ACTION_OPTIMIZE_PERFORMANCE;
    if (rule.startsWith('ARCH-')) return ACTION_DECOUPLE_ARCHITECTURE;
    if (rule.startsWith('DEP-')) return ACTION_RESOLVE_DEPENDENCY;
    if (rule.startsWith('SEC-')) return ACTION_HARDEN_SECURITY;
    if (rule.startsWith('HYG-')) return ACTION_SANITIZE_HYGIENE;
    return ACTION_REFACTOR;
}

/**
 * Extracts concise, single-clause suggestion template (<= 80 chars) to prevent prose bloat.
 */
export function cleanSuggestion(rawContent: string): string | undefined {
    if (!rawContent) return undefined;
    let trimmed = rawContent.trim();
    trimmed = trimmed.replace(
        /^(?:Please\s+|Consider\s+|It\s+is\s+(?:recommended|required)\s+to\s+|You\s+should\s+|Ensure\s+that\s+|Try\s+to\s+)/i,
        '',
    );
    if (trimmed.length <= MAX_SUGGESTION_CHARS) return trimmed;
    const match = trimmed.match(/^([^.!?\n]+[.!?]?)/);
    const firstClause = match
        ? match[1].trim()
        : trimmed.slice(0, ELLIPSIS_TRUNCATE_CHARS) + ELLIPSIS;
    return firstClause.length <= MAX_SUGGESTION_CHARS
        ? firstClause
        : firstClause.slice(0, ELLIPSIS_TRUNCATE_CHARS) + ELLIPSIS;
}

/**
 * Builds actionable remediation recipe from issue metadata.
 */
export function buildFixRecipe(issue: Issue): AasFixRecipe | undefined {
    const actionable = issue.actionable;
    if (actionable?.action) {
        const conciseTemplate = actionable.templateSnippet
            ? cleanSuggestion(actionable.templateSnippet)
            : undefined;
        return {
            action: actionable.action,
            ...(actionable.patch ? { patch: actionable.patch } : {}),
            ...(conciseTemplate ? { template: conciseTemplate } : {}),
            ...(actionable.safeToAutomate !== undefined ? { safeToAutomate: actionable.safeToAutomate } : {}),
        };
    }
    if (issue.suggestion) {
        const concise = cleanSuggestion(issue.suggestion);
        return {
            action: resolveActionFromRule(issue.rule),
            ...(concise ? { template: concise } : {}),
        };
    }
    return undefined;
}
