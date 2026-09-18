/**
 * Module: Core Engine - Governance Rules - Exception Safety
 * File Path: src/core/governance/rules/exceptionSafety.ts
 * Architecture Role: File-level rule module exporting SwallowedExceptionRule and NakedUnwrapRule;
 *     GovernanceAnalyzer invokes each checkFile once per parsed file in finalize().
 * Dependencies & Triggers: Imports shared governance types; registry language gates select the
 *     Python/TS/JS rule or the Rust rule, so it runs during any governance-enabled scan or CI pass.
 * Responsibilities: regexes detect bare and swallowed Python except blocks, including multi-line
 *     pass/ellipsis bodies; empty TS/JS catch blocks are reported; Rust .unwrap() calls are flagged
 *     outside tests; comment lines are ignored and clean files produce no violations.
 * Exit Semantics & Design Rationale: checkFile returns null when nothing matches and otherwise a
 *     violation list; it never throws. The swallowed rule is an error and unwrap is a warning, both
 *     non-fixable, because silent catch/except hides corruption and naked unwrap panics in prod.
 */
import { fileNameEndsWith, pathHasSegment } from '../pathScope';
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';

const PY_BARE_EXCEPT_RE = /^\s*except\s*:/;
const PY_EXCEPT_LINE_RE = /^\s*except(?:\s+[^:]*)?:/;
const SINGLE_LINE_SWALLOW = /^\s*except(?:\s+[^:]*)?:\s*(?:pass|\.\.\.)\s*(?:#.*)?$/;
const EMPTY_CATCH_SINGLE_RE = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/;
const CATCH_HEAD_RE = /catch\s*(?:\([^)]*\))?\s*\{$/;
/**
 * Rationale markers that turn a comment-only catch body into a documented decision. The rule's
 * concern is *silence*, not the absence of statements: an explicitly reasoned best-effort catch
 * is auditable, while an unexplained empty one still fails. Python `except: pass` never gets this
 * escape hatch because a swallowed exception there is a real correctness hazard.
 */
const DOCUMENTED_CATCH_RE =
    /\b(?:best-?effort|ignore[sd]?|intentional(?:ly)?|deliberate(?:ly)?|expected)\b/i;

/** Governance rule id for the swallowed-exception check, shared by its violations. */
const SWALLOWED_EXCEPTION_RULE_ID = 'GOV-EXC-001';

/** Remediation text for swallowed exceptions, byte-identical across all report paths. */
const SWALLOWED_EXCEPTION_SUGGESTION = 'Handle, log, or explicitly re-throw the caught exception.';

/**
 * Inspects a multi-line Python except block to detect if all contained statements are swallowed.
 */
function inspectPythonExceptBlock(
    lines: string[],
    startIndex: number,
    indent: number,
): { hasStatements: boolean; allSwallowed: boolean; lastIndex: number } {
    let allSwallowed = true;
    let hasStatements = false;
    let j = startIndex;

    while (j < lines.length) {
        const nextLine = lines[j];
        const nextTrimmed = nextLine.trim();
        if (!nextTrimmed || nextTrimmed.startsWith('#')) {
            j++;
            continue;
        }

        const nextIndent = nextLine.search(/\S/);
        if (nextIndent <= indent) {
            // Exited the except block
            break;
        }

        hasStatements = true;
        if (nextTrimmed !== 'pass' && nextTrimmed !== '...') {
            allSwallowed = false;
            break;
        }
        j++;
    }

    return { hasStatements, allSwallowed, lastIndex: j };
}

/**
 * Checks Python lines for bare excepts and single- or multi-line swallowed exceptions.
 */
function checkPythonExceptions(lines: string[]): GovernanceViolation[] {
    const violations: GovernanceViolation[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('#')) continue;

        // 1. Bare except:
        if (PY_BARE_EXCEPT_RE.test(trimmed)) {
            violations.push({
                ruleId: SWALLOWED_EXCEPTION_RULE_ID,
                message:
                    'Bare `except:` clause catches all exceptions including SystemExit; specify explicit exception types.',
                line: i + 1,
                column: line.indexOf('except') + 1,
                suggestion:
                    'Catch specific exceptions like `except Exception as e:` or specific error types.',
                fixable: false,
            });
        }

        // 2. Swallowed exception (single-line or multi-line pass/...)
        if (SINGLE_LINE_SWALLOW.test(trimmed)) {
            violations.push({
                ruleId: SWALLOWED_EXCEPTION_RULE_ID,
                message:
                    'Empty or swallowed `except` block with no active handling statements.',
                line: i + 1,
                column: line.indexOf('except') + 1,
                suggestion: SWALLOWED_EXCEPTION_SUGGESTION,
                fixable: false,
            });
            continue;
        }

        // Multi-line swallowed:
        if (PY_EXCEPT_LINE_RE.test(trimmed) && trimmed.endsWith(':')) {
            const indent = line.search(/\S/);
            const block = inspectPythonExceptBlock(lines, i + 1, indent);

            if (block.hasStatements && block.allSwallowed) {
                violations.push({
                    ruleId: SWALLOWED_EXCEPTION_RULE_ID,
                    message:
                        'Empty or swallowed `except` block with no active handling statements.',
                    line: i + 1,
                    column: line.indexOf('except') + 1,
                    suggestion: SWALLOWED_EXCEPTION_SUGGESTION,
                    fixable: false,
                });
                i = block.lastIndex - 1; // Jump cursor over swallowed statements
            }
        }
    }
    return violations;
}

/**
 * Inspects a multi-line JS/TS catch block for active statements and documented rationale markers.
 */
function inspectJsCatchBlock(
    lines: string[],
    startIndex: number,
): { empty: boolean; documented: boolean; isClosed: boolean } {
    let j = startIndex;
    let empty = true;
    let documented = false;
    while (j < lines.length) {
        const next = lines[j].trim();
        if (next === '}') break;
        if (
            next &&
            !next.startsWith('//') &&
            !next.startsWith('/*') &&
            !next.startsWith('*')
        ) {
            empty = false;
            break;
        }
        if (next && DOCUMENTED_CATCH_RE.test(next)) documented = true;
        j++;
    }
    const isClosed = j < lines.length && lines[j].trim() === '}';
    return { empty, documented, isClosed };
}

/**
 * Checks JS/TS lines for empty catch blocks lacking documented rationale markers.
 */
function checkJsTsExceptions(lines: string[]): GovernanceViolation[] {
    const violations: GovernanceViolation[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

        if (EMPTY_CATCH_SINGLE_RE.test(line)) {
            violations.push({
                ruleId: SWALLOWED_EXCEPTION_RULE_ID,
                message: 'Empty `catch` block silently swallows exceptions.',
                line: i + 1,
                column: line.indexOf('catch') + 1,
                suggestion: SWALLOWED_EXCEPTION_SUGGESTION,
                fixable: false,
            });
            continue;
        }

        if (CATCH_HEAD_RE.test(line.trim()) && i + 1 < lines.length) {
            const block = inspectJsCatchBlock(lines, i + 1);
            if (block.empty && !block.documented && block.isClosed) {
                violations.push({
                    ruleId: SWALLOWED_EXCEPTION_RULE_ID,
                    message: 'Empty `catch` block with no active handling statements.',
                    line: i + 1,
                    column: lines[i].indexOf('catch') + 1,
                    suggestion: SWALLOWED_EXCEPTION_SUGGESTION,
                    fixable: false,
                });
            }
        }
    }
    return violations;
}

/**
 * GOV-EXC-001: Swallowed Exception Governance.
 * Flags empty `catch` blocks in TypeScript/JavaScript and bare/swallowed except in Python.
 */
export const SwallowedExceptionRule: GovernanceRule = {
    id: SWALLOWED_EXCEPTION_RULE_ID,
    name: 'Swallowed Exception & Empty Catch Block Governance',
    category: 'exception_safety',
    severity: 'error',
    risk: 'critical',
    rationale:
        'Empty catch blocks silently swallow exceptions, causing silent data corruption or masking critical failures. A catch whose body carries an explicit rationale marker (best-effort / ignore / intentional / expected) is treated as a documented decision instead of a silent swallow.',
    isFixable: false,
    languages: ['typescript', 'javascript', 'python'],
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        // RAW view on purpose: this rule exempts a catch whose handling is DOCUMENTED by a
        // rationale marker in the comment, so the comment is evidence rather than noise. Masking
        // it removed the exemption and multiplied the findings (1 -> 45 on this repository).
        const lines = ctx.lines;
        const lang = ctx.capabilities.languageId;

        const violations =
            lang === 'python' ? checkPythonExceptions(lines) : checkJsTsExceptions(lines);

        return violations.length > 0 ? violations : null;
    },
};

/**
 * GOV-EXC-002: Naked Unwrap in Production Code.
 * Flags `.unwrap()` in Rust production code.
 */
export const NakedUnwrapRule: GovernanceRule = {
    id: 'GOV-EXC-002',
    name: 'Naked Unwrap & Panic Prevention',
    category: 'exception_safety',
    severity: 'warning',
    risk: 'high',
    rationale:
        'Naked `.unwrap()` causes unrecoverable process panics in production upon Err or None.',
    isFixable: false,
    languages: ['rust'],
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        // Skip test files / test modules
        if (pathHasSegment(ctx.filePath, 'tests') || fileNameEndsWith(ctx.filePath, ['_test.rs'])) {
            return null;
        }

        const violations: GovernanceViolation[] = [];
        // RAW view on purpose: this rule exempts a catch whose handling is DOCUMENTED by a
        // rationale marker in the comment, so the comment is evidence rather than noise. Masking
        // it removed the exemption and multiplied the findings (1 -> 45 on this repository).
        const lines = ctx.lines;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim().startsWith('//')) continue;
            if (line.includes('.unwrap()')) {
                violations.push({
                    ruleId: 'GOV-EXC-002',
                    message:
                        'Naked `.unwrap()` invocation in production code may trigger unhandled panics.',
                    line: i + 1,
                    column: line.indexOf('.unwrap()') + 1,
                    suggestion:
                        'Handle with `?` error propagation, `.expect("reason")`, or `match` / `if let`.',
                    fixable: false,
                });
            }
        }

        return violations.length > 0 ? violations : null;
    },
};
