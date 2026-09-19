/**
 * Module: Core Rules — Evolution: Silent Exception Pseudo-Catch Rule
 * File Path: src/core/rules/evolution/silentExceptionRule.ts
 * Architecture Role: Implements detection for GOV-EXC-003 across exception-handling languages
 *   (TypeScript/JavaScript, Python, GDScript), catching pseudo-catch blocks that silently swallow
 *   exceptions using dummy statements.
 * Dependencies & Triggers: Consumes GovernanceViolation from governance/types and helper functions
 *   from patternNormalizer; integrated into exceptionSafety governance checks.
 * Responsibilities: Inspect non-empty catch bodies for pseudo-catch statements and absent
 *   rationale markers, emitting GOV-EXC-003.
 * Exit Semantics & Design Rationale: Pure analysis with linear line inspection.
 */

import type { GovernanceViolation } from '../../governance/types';
import { hasDocumentedRationale, isPseudoCatchStatement } from './patternNormalizer';

/** Rule ID emitted for pseudo-catch silent swallows. */
export const GOV_EXC_SILENT_RULE_ID = 'GOV-EXC-003';

/** Regular expression identifying catch headers in JS/TS. */
const JS_CATCH_HEAD_RE = /catch\s*(?:\([^)]*\))?\s*\{/;

/** Regular expression identifying Python except headers. */
const PY_EXCEPT_HEAD_RE = /^\s*except(?:\s+[^:]*)?:/;

/**
 * Checks a JS/TS catch block body starting after the opening brace.
 *
 * @param lines - File lines.
 * @param startIndex - Line index immediately after the line containing `catch {`.
 * @returns Object indicating if the block was closed with only pseudo-catch statements.
 */
function inspectJsPseudoCatch(
    lines: readonly string[],
    startIndex: number,
): { isPseudoCatch: boolean; hasRationale: boolean; lastIndex: number } {
    let hasRationale = false;
    let statementCount = 0;
    let dummyCount = 0;
    let j = startIndex;

    while (j < lines.length) {
        const line = lines[j];
        const trimmed = line.trim();

        if (trimmed === '}') {
            break;
        }

        if (hasDocumentedRationale(trimmed)) {
            hasRationale = true;
        }

        // Skip pure comments and empty lines
        if (
            !trimmed ||
            trimmed.startsWith('//') ||
            trimmed.startsWith('/*') ||
            trimmed.startsWith('*')
        ) {
            j++;
            continue;
        }

        statementCount++;
        if (isPseudoCatchStatement(trimmed)) {
            dummyCount++;
        }

        j++;
    }

    const isClosed = j < lines.length && lines[j].trim() === '}';
    const isPseudoCatch = isClosed && statementCount > 0 && statementCount === dummyCount;

    return { isPseudoCatch, hasRationale, lastIndex: j };
}

/**
 * Audits JavaScript and TypeScript lines for GOV-EXC-003 violations.
 *
 * @param lines - Array of source lines.
 * @returns Array of governance violations.
 */
export function checkJsTsSilentExceptions(lines: readonly string[]): GovernanceViolation[] {
    const violations: GovernanceViolation[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
            continue;
        }

        if (JS_CATCH_HEAD_RE.test(trimmed)) {
            const block = inspectJsPseudoCatch(lines, i + 1);
            if (block.isPseudoCatch && !block.hasRationale) {
                violations.push({
                    ruleId: GOV_EXC_SILENT_RULE_ID,
                    message:
                        'Pseudo-catch block silently swallows exceptions with dummy statements ' +
                        'and no documented rationale.',
                    line: i + 1,
                    column: line.indexOf('catch') + 1,
                    suggestion:
                        'Add structured error logging, re-throw the error, or document the rationale ' +
                        'with an explicit keyword (e.g. /* best-effort */ or /* expected */).',
                    fixable: false,
                });
                i = block.lastIndex;
            }
        }
    }

    return violations;
}

/**
 * Audits Python lines for GOV-EXC-003 violations.
 *
 * @param lines - Array of source lines.
 * @returns Array of governance violations.
 */
export function checkPythonSilentExceptions(lines: readonly string[]): GovernanceViolation[] {
    const violations: GovernanceViolation[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('#')) {
            continue;
        }

        if (PY_EXCEPT_HEAD_RE.test(trimmed) && trimmed.endsWith(':')) {
            const indent = line.search(/\S/);
            let hasRationale = hasDocumentedRationale(trimmed);
            let statementCount = 0;
            let dummyCount = 0;
            let j = i + 1;

            while (j < lines.length) {
                const nextLine = lines[j];
                const nextTrimmed = nextLine.trim();

                if (!nextTrimmed || nextTrimmed.startsWith('#')) {
                    if (hasDocumentedRationale(nextTrimmed)) {
                        hasRationale = true;
                    }
                    j++;
                    continue;
                }

                const nextIndent = nextLine.search(/\S/);
                if (nextIndent <= indent) {
                    break;
                }

                statementCount++;
                if (isPseudoCatchStatement(nextTrimmed)) {
                    dummyCount++;
                }
                j++;
            }

            if (statementCount > 0 && statementCount === dummyCount && !hasRationale) {
                violations.push({
                    ruleId: GOV_EXC_SILENT_RULE_ID,
                    message:
                        'Pseudo-catch except block silently swallows exceptions with dummy ' +
                        'statements and no documented rationale.',
                    line: i + 1,
                    column: line.indexOf('except') + 1,
                    suggestion:
                        'Log the caught exception, re-raise it, or document why silent handling ' +
                        'is intentional (e.g. # best-effort or # expected).',
                    fixable: false,
                });
                i = j - 1;
            }
        }
    }

    return violations;
}
