/**
 * Module: Static Analysis Engine — Simplification Line-Check Helpers
 * File Path: src/analyzers/simplify-linecheck.ts
 * Architecture Role: Extracted line-based heuristic rules for the simplify analyzer;
 *   lives in a separate file to keep the main analyzer under the large-file threshold
 *   and to keep each rule's cyclomatic complexity manageable
 * Dependencies & Triggers: Called from SimplifyAnalyzer.scanContent(); needs the
 *   shared Issue type, analyzer id constant, and severity level from core types
 * Responsibilities: Detect redundant `else` after terminating statements (SIM-ELSE-001);
 *   detect simplifiable boolean return patterns (SIM-BOOL-001); detect consecutive
 *   if-return guard-clause patterns at function start (SIM-GUARD-001)
 * Exit Semantics & Design Rationale: Pure functions that mutate the issues array
 *   in-place; every rule defaults to "on" but respects the per-rule opt-out flag.
 *   False negatives are preferred over false positives — patterns are only reported
 *   when the heuristic is highly confident.
 */
import type { Issue } from '../core/types';
import { SEVERITY_INFO } from '../core/types';
import { ANALYZER_SIMPLIFY } from '../core/scoring/dimensionLiterals';
import type { SimplifyOptions } from './simplify';

const DEFAULT_MAX_GUARD_CLAUSE_PATTERN_NESTING = 3;

const PREFIX_SLASH_SLASH = '//';
const PREFIX_HASH = '#';
const PREFIX_STAR = '*';
const PREFIX_BLOCK_COMMENT_START = '/*';
const COMMENT_MARKERS = [PREFIX_SLASH_SLASH, PREFIX_HASH, PREFIX_STAR];

const TERMINATING_STMT_RE = /^\s*(?:return|throw|break|continue)\b/;
const IF_OPEN_RE = /\bif\s*\([^)]*\)\s*\{/;
const ELSE_RE = /^\s*\}\s*else\b/;
const RETURN_BOOL_RE = /^\s*return\s+(true|false)\s*[;}]?\s*$/;
const TERNARY_BOOL_RETURN_RE = /return\s+[^;]+\?\s*(?:true|false)\s*:\s*(?:true|false)\s*[;}]/;
const PY_IF_RE = /^(\s*)if\s+.*:\s*$/;
const PY_DEF_RE = /^(\s*)(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(/;

function isCommentOrBlankLine(trimmed: string): boolean {
    if (!trimmed) return true;
    return (
        trimmed.startsWith(PREFIX_SLASH_SLASH) ||
        trimmed.startsWith(PREFIX_HASH) ||
        trimmed.startsWith(PREFIX_STAR) ||
        trimmed.startsWith(PREFIX_BLOCK_COMMENT_START)
    );
}

function indentWidth(line: string): number {
    const match = /^\s*/.exec(line);
    return match ? match[0].length : 0;
}

/**
 * Find the matching closing brace for the first `{` at or after startIndex.
 * Leading `}` characters on the starting line are ignored until the first `{`
 * is seen, so patterns like `} else {` work correctly.
 */
function findMatchingBrace(lines: string[], startIndex: number): number {
    let depth = 0;
    let started = false;
    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        for (let j = 0; j < line.length; j++) {
            if (line[j] === '{') {
                depth++;
                started = true;
            } else if (line[j] === '}' && started) {
                depth--;
                if (depth === 0) return i;
            }
        }
    }
    return -1;
}

/** Find the last non-blank, non-comment, non-brace-only line index in [start, end]. */
function findLastMeaningfulLine(lines: string[], start: number, end: number): number {
    for (let i = end; i >= start; i--) {
        const trimmed = lines[i].trim();
        if (isCommentOrBlankLine(trimmed)) continue;
        if (/^[{}]+$/.test(trimmed)) continue;
        return i;
    }
    return -1;
}

/** Count meaningful (non-blank, non-comment, non-brace-only) lines in (start, end). */
function countMeaningfulStmts(lines: string[], start: number, end: number): number {
    let count = 0;
    for (let i = start; i < end; i++) {
        const trimmed = lines[i].trim();
        if (isCommentOrBlankLine(trimmed)) continue;
        if (/^[{}]+$/.test(trimmed)) continue;
        count++;
    }
    return count;
}

/** Skip forward past blank lines and line comments. */
function skipBlanksAndComments(lines: string[], start: number): number {
    let i = start;
    while (i < lines.length && isCommentOrBlankLine(lines[i].trim())) i++;
    return i;
}

/** Build a standard issue object for simplify line-level rules. */
function makeIssue(
    rule: string,
    file: string,
    startLine: number,
    endLine: number,
    message: string,
    suggestion: string,
    detail: Record<string, unknown>,
): Issue {
    return {
        id: `simplify:${rule}:${file}:${startLine}`,
        analyzer: ANALYZER_SIMPLIFY,
        rule,
        severity: SEVERITY_INFO,
        message,
        location: {
            file,
            start: { line: startLine, column: 1 },
            end: { line: endLine, column: 1 },
        },
        detail,
        suggestion,
    };
}

// ─── SIM-ELSE-001 ───────────────────────────────────────────────────────────

const ELSE_MSG =
    'Redundant `else` after terminating statement — the `if` block always returns/exits, so `else` can be flattened.';
const ELSE_SUGGESTION = 'Remove the `else` keyword and de-indent its body to reduce nesting.';

function auditRedundantElseBrace(
    lines: string[],
    file: string,
    issues: Issue[],
): void {
    for (let i = 0; i < lines.length; i++) {
        if (!IF_OPEN_RE.test(lines[i])) continue;

        const closeIdx = findMatchingBrace(lines, i);
        if (closeIdx === -1 || closeIdx <= i) continue;

        const closeLine = lines[closeIdx];
        const afterClose = closeLine.replace(/^\s*\}\s*/, '');
        const hasElseSameLine = /^else\b/.test(afterClose);

        let elseLineIdx = closeIdx;
        if (!hasElseSameLine) {
            const nextIdx = skipBlanksAndComments(lines, closeIdx + 1);
            if (nextIdx >= lines.length) continue;
            if (!ELSE_RE.test(lines[nextIdx])) continue;
            elseLineIdx = nextIdx;
        }

        const lastStmtIdx = findLastMeaningfulLine(lines, i + 1, closeIdx - 1);
        if (lastStmtIdx === -1) continue;
        if (!TERMINATING_STMT_RE.test(lines[lastStmtIdx].trim())) continue;

        issues.push(
            makeIssue(
                'SIM-ELSE-001',
                file,
                i + 1,
                elseLineIdx + 1,
                ELSE_MSG,
                ELSE_SUGGESTION,
                { pattern: 'brace-if-terminating-else' },
            ),
        );
    }
}

function findPythonIfBodyLastStmt(lines: string[], start: number, ifIndent: number): number {
    let lastStmtIdx = -1;
    let j = start;
    while (j < lines.length) {
        const trimmed = lines[j].trim();
        if (trimmed === '' || trimmed.startsWith('#')) {
            j++;
            continue;
        }
        if (indentWidth(lines[j]) <= ifIndent) break;
        lastStmtIdx = j;
        j++;
    }
    return lastStmtIdx;
}

function isPythonTerminatingElse(lines: string[], lastStmtIdx: number, ifIndent: number): number {
    const lastStmt = lines[lastStmtIdx].trim();
    if (!/^(?:return|raise|break|continue)\b/.test(lastStmt)) return -1;
    const k = skipBlanksAndComments(lines, lastStmtIdx + 1);
    if (k >= lines.length || indentWidth(lines[k]) !== ifIndent) return -1;
    return /^(else|elif)\b/.test(lines[k].trim()) ? k : -1;
}

function auditRedundantElsePython(
    lines: string[],
    file: string,
    issues: Issue[],
): void {
    for (let i = 0; i < lines.length; i++) {
        const ifMatch = PY_IF_RE.exec(lines[i]);
        if (!ifMatch) continue;
        const ifIndent = ifMatch[1].length;

        const lastStmtIdx = findPythonIfBodyLastStmt(lines, i + 1, ifIndent);
        if (lastStmtIdx === -1) continue;

        const k = isPythonTerminatingElse(lines, lastStmtIdx, ifIndent);
        if (k === -1) continue;

        issues.push(
            makeIssue(
                'SIM-ELSE-001',
                file,
                i + 1,
                k + 1,
                ELSE_MSG,
                ELSE_SUGGESTION,
                { pattern: 'python-if-terminating-else' },
            ),
        );
    }
}

export function auditRedundantElse(
    lines: string[],
    file: string,
    opts: SimplifyOptions,
    issues: Issue[],
): void {
    if (opts.checkRedundantElse === false) return;
    if (file.endsWith('.py')) {
        auditRedundantElsePython(lines, file, issues);
    } else {
        auditRedundantElseBrace(lines, file, issues);
    }
}

// ─── SIM-BOOL-001 ───────────────────────────────────────────────────────────

const BOOL_MSG_IFELSE =
    'Boolean return can be simplified — return the condition directly instead of `if/else`.';
const BOOL_MSG_IF =
    'Boolean return can be simplified — return the condition directly instead of `if`.';
const BOOL_MSG_TERNARY =
    'Boolean return can be simplified — return the condition directly instead of ternary.';
const BOOL_SUGGESTION = 'Replace with `return <condition>;` for cleaner code.';

function auditBooleanReturnTernary(
    lines: string[],
    file: string,
    issues: Issue[],
): void {
    for (let i = 0; i < lines.length; i++) {
        if (!TERNARY_BOOL_RETURN_RE.test(lines[i])) continue;
        const match = lines[i].match(/return\s+(.+?)\?\s*(true|false)\s*:\s*(true|false)/);
        if (!match || match[2] === match[3]) continue;
        issues.push(
            makeIssue(
                'SIM-BOOL-001',
                file,
                i + 1,
                i + 1,
                BOOL_MSG_TERNARY,
                BOOL_SUGGESTION,
                { pattern: 'ternary-boolean-return' },
            ),
        );
    }
}

function auditBooleanReturnSingleLineIf(
    lines: string[],
    file: string,
    issues: Issue[],
): void {
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        const m = /^if\s*\((.+)\)\s*return\s+(true|false)\s*[;}]?\s*$/.exec(trimmed);
        if (!m) continue;
        const ifBool = m[2] === 'true';
        const j = skipBlanksAndComments(lines, i + 1);
        if (j >= lines.length) continue;
        const nextBool = /^return\s+(true|false)\s*[;}]?\s*$/.exec(lines[j].trim());
        if (!nextBool) continue;
        if (ifBool === (nextBool[1] === 'true')) continue;

        issues.push(
            makeIssue(
                'SIM-BOOL-001',
                file,
                i + 1,
                j + 1,
                BOOL_MSG_IF,
                BOOL_SUGGESTION,
                { pattern: 'single-line-if-boolean-return' },
            ),
        );
    }
}

function findElseBodyStart(lines: string[], closeIdx: number): number {
    const closeLine = lines[closeIdx];
    const afterClose = closeLine.replace(/^\s*\}\s*/, '');
    if (/^else\b/.test(afterClose)) return closeIdx;
    const nextIdx = skipBlanksAndComments(lines, closeIdx + 1);
    if (nextIdx < lines.length && ELSE_RE.test(lines[nextIdx])) return nextIdx;
    return -1;
}

function checkBlockIfNoElse(
    lines: string[],
    file: string,
    i: number,
    closeIdx: number,
    ifBool: boolean,
    issues: Issue[],
): void {
    const j = skipBlanksAndComments(lines, closeIdx + 1);
    if (j >= lines.length) return;
    const nextBool = RETURN_BOOL_RE.exec(lines[j].trim());
    if (!nextBool || ifBool === (nextBool[1] === 'true')) return;

    issues.push(
        makeIssue(
            'SIM-BOOL-001',
            file,
            i + 1,
            j + 1,
            BOOL_MSG_IF,
            BOOL_SUGGESTION,
            { pattern: 'block-if-boolean-return-no-else' },
        ),
    );
}

function checkBlockIfWithElse(
    lines: string[],
    file: string,
    i: number,
    elseBodyStart: number,
    ifBool: boolean,
    issues: Issue[],
): void {
    const elseCloseIdx = findMatchingBrace(lines, elseBodyStart);
    if (elseCloseIdx === -1) return;

    const elseLastIdx = findLastMeaningfulLine(lines, elseBodyStart + 1, elseCloseIdx - 1);
    if (elseLastIdx === -1) return;
    const elseBoolMatch = RETURN_BOOL_RE.exec(lines[elseLastIdx].trim());
    if (!elseBoolMatch) return;
    const elseBool = elseBoolMatch[1] === 'true';
    if (ifBool === elseBool) return;

    if (countMeaningfulStmts(lines, elseBodyStart + 1, elseCloseIdx) !== 1) return;

    issues.push(
        makeIssue(
            'SIM-BOOL-001',
            file,
            i + 1,
            elseCloseIdx + 1,
            BOOL_MSG_IFELSE,
            BOOL_SUGGESTION,
            { pattern: 'if-else-boolean-return-blocks' },
        ),
    );
}

function auditBooleanReturnBlockIf(
    lines: string[],
    file: string,
    issues: Issue[],
): void {
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!/^if\s*\((.+)\)\s*\{\s*$/.test(trimmed)) continue;

        const closeIdx = findMatchingBrace(lines, i);
        if (closeIdx === -1) continue;

        const lastStmtIdx = findLastMeaningfulLine(lines, i + 1, closeIdx - 1);
        if (lastStmtIdx === -1) continue;
        const ifBoolMatch = RETURN_BOOL_RE.exec(lines[lastStmtIdx].trim());
        if (!ifBoolMatch) continue;
        const ifBool = ifBoolMatch[1] === 'true';

        if (countMeaningfulStmts(lines, i + 1, closeIdx) !== 1) continue;

        const elseBodyStart = findElseBodyStart(lines, closeIdx);
        if (elseBodyStart === -1) {
            checkBlockIfNoElse(lines, file, i, closeIdx, ifBool, issues);
        } else {
            checkBlockIfWithElse(lines, file, i, elseBodyStart, ifBool, issues);
        }
    }
}

function findPythonBlockEnd(lines: string[], start: number, ifIndent: number): number {
    let k = start;
    while (k < lines.length) {
        const t = lines[k].trim();
        if (t === '' || t.startsWith('#')) {
            k++;
            continue;
        }
        if (indentWidth(lines[k]) <= ifIndent) break;
        k++;
    }
    return k;
}

function checkPythonBoolReturnWithElse(
    lines: string[],
    file: string,
    i: number,
    k: number,
    ifIndent: number,
    ifBool: boolean,
    issues: Issue[],
): void {
    const m = skipBlanksAndComments(lines, k + 1);
    if (m >= lines.length || indentWidth(lines[m]) <= ifIndent) return;
    const elseBoolMatch = /^return\s+(True|False)\s*$/.exec(lines[m].trim());
    if (!elseBoolMatch || ifBool === (elseBoolMatch[1] === 'True')) return;

    issues.push(
        makeIssue(
            'SIM-BOOL-001',
            file,
            i + 1,
            k + 1,
            BOOL_MSG_IFELSE,
            BOOL_SUGGESTION,
            { pattern: 'python-if-else-boolean-return' },
        ),
    );
}

function checkPythonBoolReturnNoElse(
    file: string,
    i: number,
    k: number,
    afterTrimmed: string,
    ifBool: boolean,
    issues: Issue[],
): void {
    const afterBool = /^return\s+(True|False)\s*$/.exec(afterTrimmed);
    if (!afterBool || ifBool === (afterBool[1] === 'True')) return;

    issues.push(
        makeIssue(
            'SIM-BOOL-001',
            file,
            i + 1,
            k + 1,
            BOOL_MSG_IF,
            BOOL_SUGGESTION,
            { pattern: 'python-if-boolean-return-no-else' },
        ),
    );
}

function auditBooleanReturnPython(
    lines: string[],
    file: string,
    issues: Issue[],
): void {
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!/^if\s+(.+):\s*$/.test(trimmed)) continue;

        const ifIndent = indentWidth(lines[i]);
        const j = skipBlanksAndComments(lines, i + 1);
        if (j >= lines.length || indentWidth(lines[j]) <= ifIndent) continue;

        const bodyTrimmed = lines[j].trim();
        const boolMatch = /^return\s+(True|False)\s*$/.exec(bodyTrimmed);
        if (!boolMatch) continue;
        const ifBool = boolMatch[1] === 'True';

        const k = findPythonBlockEnd(lines, j + 1, ifIndent);
        if (k >= lines.length || indentWidth(lines[k]) !== ifIndent) continue;

        const afterTrimmed = lines[k].trim();
        if (/^else\s*:/.test(afterTrimmed)) {
            checkPythonBoolReturnWithElse(lines, file, i, k, ifIndent, ifBool, issues);
        } else if (/^return\s+(True|False)\s*$/.test(afterTrimmed)) {
            checkPythonBoolReturnNoElse(file, i, k, afterTrimmed, ifBool, issues);
        }
    }
}

export function auditBooleanReturn(
    lines: string[],
    file: string,
    opts: SimplifyOptions,
    issues: Issue[],
): void {
    if (opts.checkBooleanReturn === false) return;
    if (file.endsWith('.py')) {
        auditBooleanReturnPython(lines, file, issues);
    } else {
        auditBooleanReturnTernary(lines, file, issues);
        auditBooleanReturnSingleLineIf(lines, file, issues);
        auditBooleanReturnBlockIf(lines, file, issues);
    }
}

// ─── SIM-GUARD-001 ──────────────────────────────────────────────────────────

const GUARD_SUGGESTION = 'Invert the condition and return early to reduce nesting depth.';

function isGuardIfBlock(lines: string[], idx: number): boolean {
    const trimmed = lines[idx].trim();
    // Single line: `if (cond) return/throw ...;`
    if (/^if\s*\([^)]*\)\s*(?:return|throw)\b/.test(trimmed)) return true;
    // Multi-line block: `if (cond) {` with a single return/throw inside
    if (/^if\s*\([^)]*\)\s*\{\s*$/.test(trimmed)) {
        const closeIdx = findMatchingBrace(lines, idx);
        if (closeIdx === -1) return false;
        const stmts = countMeaningfulStmts(lines, idx + 1, closeIdx);
        if (stmts !== 1) return false;
        const lastIdx = findLastMeaningfulLine(lines, idx + 1, closeIdx - 1);
        if (lastIdx === -1) return false;
        return /^(?:return|throw)\b/.test(lines[lastIdx].trim());
    }
    return false;
}

function getGuardIfEndLine(lines: string[], idx: number): number {
    const trimmed = lines[idx].trim();
    if (/^if\s*\([^)]*\)\s*(?:return|throw)\b/.test(trimmed)) {
        return idx;
    }
    if (/^if\s*\([^)]*\)\s*\{\s*$/.test(trimmed)) {
        return findMatchingBrace(lines, idx);
    }
    return idx;
}

function findFunctionOpeningBrace(lines: string[], start: number): number {
    for (let braceIdx = start; braceIdx < lines.length && braceIdx < start + 5; braceIdx++) {
        if (lines[braceIdx].includes('{')) return braceIdx;
    }
    return -1;
}

function countConsecutiveGuardClauses(
    lines: string[],
    start: number,
): { count: number; firstIfLine: number } {
    let count = 0;
    let firstIfLine = -1;
    let cur = start;
    while (cur < lines.length) {
        const curTrimmed = lines[cur].trim();
        if (isCommentOrBlankLine(curTrimmed)) {
            cur++;
            continue;
        }
        if (isGuardIfBlock(lines, cur)) {
            if (firstIfLine === -1) firstIfLine = cur;
            count++;
            cur = getGuardIfEndLine(lines, cur) + 1;
            continue;
        }
        break;
    }
    return { count, firstIfLine };
}

function auditGuardClausePatternsBrace(
    lines: string[],
    file: string,
    threshold: number,
    issues: Issue[],
): void {
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!/\b(?:function|fn|func)\s+[A-Za-z_]\w*/.test(trimmed) || trimmed.endsWith(';')) continue;

        const braceIdx = findFunctionOpeningBrace(lines, i);
        if (braceIdx === -1) continue;

        const { count, firstIfLine } = countConsecutiveGuardClauses(lines, braceIdx + 1);

        if (count >= threshold) {
            issues.push(
                makeIssue(
                    'SIM-GUARD-001',
                    file,
                    braceIdx + 1,
                    firstIfLine + count + 1,
                    `Deep conditional nesting at function start — ${count} consecutive if-return patterns. Consider using guard clauses with early returns.`,
                    GUARD_SUGGESTION,
                    { count, threshold },
                ),
            );
        }
    }
}

function skipPythonDocstrings(lines: string[], startIndex: number): number {
    let i = startIndex;
    while (i < lines.length) {
        const t = lines[i].trim();
        if (t === '' || t.startsWith('#')) { i++; continue; }
        if (t.startsWith('"""') || t.startsWith("'''")) {
            const marker = t.startsWith('"""') ? '"""' : "'''";
            if (t.split(marker).length - 1 < 2) {
                i++;
                while (i < lines.length && !lines[i].includes(marker)) i++;
                i++;
            } else {
                i++;
            }
            continue;
        }
        break;
    }
    return i;
}

/**
 * Check if a Python if statement at `idx` is a single-statement guard clause
 * (body contains only a return/raise). Returns the index of the line after the
 * if body, or -1 if it's not a guard-clause if.
 */
function pythonGuardIfEnd(lines: string[], idx: number, ifIndent: number): number {
    const bodyIdx = skipBlanksAndComments(lines, idx + 1);
    if (bodyIdx >= lines.length) return -1;
    if (indentWidth(lines[bodyIdx]) <= ifIndent) return -1;
    if (!/^(?:return|raise)\b/.test(lines[bodyIdx].trim())) return -1;

    let nextIdx = bodyIdx + 1;
    while (nextIdx < lines.length && (lines[nextIdx].trim() === '' || lines[nextIdx].trim().startsWith('#'))) {
        nextIdx++;
    }
    if (nextIdx < lines.length && indentWidth(lines[nextIdx]) > ifIndent) return -1;
    return nextIdx;
}

function countPythonGuardClauses(
    lines: string[],
    startIdx: number,
    funcIndent: number,
): { count: number; firstIfLine: number } {
    let count = 0;
    let firstIfLine = -1;
    let cur = startIdx;

    while (cur < lines.length) {
        const curTrimmed = lines[cur].trim();
        if (curTrimmed === '' || curTrimmed.startsWith('#')) { cur++; continue; }
        if (indentWidth(lines[cur]) <= funcIndent) break;

        const ifMatch = PY_IF_RE.exec(lines[cur]);
        if (!ifMatch) break;
        const ifIndent = ifMatch[1].length;

        const nextIdx = pythonGuardIfEnd(lines, cur, ifIndent);
        if (nextIdx === -1) break;

        if (firstIfLine === -1) firstIfLine = cur;
        count++;
        cur = nextIdx;
    }

    return { count, firstIfLine };
}

function auditGuardClausePatternsPython(
    lines: string[],
    file: string,
    threshold: number,
    issues: Issue[],
): void {
    for (let i = 0; i < lines.length; i++) {
        const defMatch = PY_DEF_RE.exec(lines[i]);
        if (!defMatch) continue;
        const funcIndent = defMatch[1].length;

        const startIdx = skipPythonDocstrings(lines, i + 1);
        const { count, firstIfLine } = countPythonGuardClauses(lines, startIdx, funcIndent);

        if (count >= threshold) {
            issues.push(
                makeIssue(
                    'SIM-GUARD-001',
                    file,
                    i + 1,
                    firstIfLine + count + 1,
                    `Deep conditional nesting at function start — ${count} consecutive if-return patterns. Consider using guard clauses with early returns.`,
                    GUARD_SUGGESTION,
                    { count, threshold },
                ),
            );
        }
    }
}

export function auditGuardClausePatterns(
    lines: string[],
    file: string,
    opts: SimplifyOptions,
    issues: Issue[],
): void {
    if (opts.checkGuardClausePatterns === false) return;
    const threshold = opts.maxGuardClausePatternNesting ?? DEFAULT_MAX_GUARD_CLAUSE_PATTERN_NESTING;
    if (file.endsWith('.py')) {
        auditGuardClausePatternsPython(lines, file, threshold, issues);
    } else {
        auditGuardClausePatternsBrace(lines, file, threshold, issues);
    }
}
