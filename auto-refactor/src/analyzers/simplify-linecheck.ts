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
import { SEVERITY_INFO, type Issue, type AgentActionType } from '../core/types';
import { ANALYZER_SIMPLIFY } from '../core/scoring/dimensionLiterals';
import type { SimplifyOptions } from './simplify';

const DEFAULT_MAX_GUARD_NESTING = 3;
const MAX_HEADER_SEARCH_LINES = 5;

const RULE_SIM_ELSE_001 = 'SIM-ELSE-001';
const RULE_SIM_BOOL_001 = 'SIM-BOOL-001';
const RULE_SIM_GUARD_001 = 'SIM-GUARD-001';

const ACTION_SIMPLIFY_CONTROL_FLOW: AgentActionType = 'simplify_control_flow';
const ACTION_CODE_SIM_011 = 'AR:SIM:011';
const ACTION_CODE_SIM_012 = 'AR:SIM:012';
const ACTION_CODE_SIM_013 = 'AR:SIM:013';

const PATTERNS = {
    braceElse: 'brace-if-terminating-else',
    pythonElse: 'python-if-terminating-else',
    ternaryBool: 'ternary-boolean-return',
    singleLineIfBool: 'single-line-if-boolean-return',
    blockIfNoElse: 'block-if-boolean-return-no-else',
    ifElseBlocks: 'if-else-boolean-return-blocks',
    pyIfElseBool: 'python-if-else-boolean-return',
    pyIfBoolNoElse: 'python-if-boolean-return-no-else',
} as const;

const PREFIX_SLASH_SLASH = '//';
const PREFIX_HASH = '#';
const PREFIX_STAR = '*';
const PREFIX_BLOCK_COMMENT_START = '/*';

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

function computeIndentWidth(line: string): number {
    const match = /^\s*/.exec(line);
    return match ? match[0].length : 0;
}

function findMatchingBrace(lines: string[], startIndex: number): number {
    let depth = 0;
    let started = false;
    for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        for (let charIndex = 0; charIndex < line.length; charIndex++) {
            if (line[charIndex] === '{') {
                depth++;
                started = true;
            } else if (line[charIndex] === '}' && started) {
                depth--;
                if (depth === 0) return lineIndex;
            }
        }
    }
    return -1;
}

const BRACE_ONLY_LINE_RE = /^[{}]+$/;

function findLastMeaningfulLine(lines: string[], start: number, end: number): number {
    for (let lineIndex = end; lineIndex >= start; lineIndex--) {
        const trimmed = lines[lineIndex].trim();
        if (isCommentOrBlankLine(trimmed) || BRACE_ONLY_LINE_RE.test(trimmed)) continue;
        return lineIndex;
    }
    return -1;
}

function countMeaningfulStatements(lines: string[], start: number, end: number): number {
    let count = 0;
    for (let lineIndex = start; lineIndex < end; lineIndex++) {
        const trimmed = lines[lineIndex].trim();
        if (isCommentOrBlankLine(trimmed) || BRACE_ONLY_LINE_RE.test(trimmed)) continue;
        count++;
    }
    return count;
}

function advancePastBlanksAndComments(lines: string[], start: number): number {
    let lineIndex = start;
    while (lineIndex < lines.length && isCommentOrBlankLine(lines[lineIndex].trim())) lineIndex++;
    return lineIndex;
}

const SIMPLIFY_ACTIONABLE_MAP: Record<
    string,
    { action: AgentActionType; code: string; safeToAutomate: boolean }
> = {
    [RULE_SIM_ELSE_001]: {
        action: ACTION_SIMPLIFY_CONTROL_FLOW,
        code: ACTION_CODE_SIM_011,
        safeToAutomate: false,
    },
    [RULE_SIM_BOOL_001]: {
        action: ACTION_SIMPLIFY_CONTROL_FLOW,
        code: ACTION_CODE_SIM_012,
        safeToAutomate: false,
    },
    [RULE_SIM_GUARD_001]: {
        action: ACTION_SIMPLIFY_CONTROL_FLOW,
        code: ACTION_CODE_SIM_013,
        safeToAutomate: false,
    },
};

/**
 * Specification contract defining a simplification defect occurrence,
 * including rule ID, target source span, descriptive explanation, and diagnostic payload.
 */
interface SimplifyIssueSpec {
    readonly rule: string;
    readonly file: string;
    readonly startLine: number;
    readonly endLine: number;
    readonly message: string;
    readonly suggestion: string;
    readonly detail: Record<string, unknown>;
}

/**
 * Line-level inspection context aggregating source lines, normalized file path,
 * and target output issue collection.
 */
interface LineAuditContext {
    readonly lines: string[];
    readonly file: string;
    readonly issues: Issue[];
}

/**
 * Factory creating canonical Issue entities enriched with actionable refactoring metadata
 * and physical source coordinates.
 */
function makeIssue(spec: SimplifyIssueSpec): Issue {
    const mapped = SIMPLIFY_ACTIONABLE_MAP[spec.rule];
    const actionable = mapped
        ? {
              action: mapped.action,
              code: mapped.code,
              safeToAutomate: mapped.safeToAutomate,
          }
        : undefined;

    return {
        id: `simplify:${spec.rule}:${spec.file}:${spec.startLine}`,
        analyzer: ANALYZER_SIMPLIFY,
        rule: spec.rule,
        severity: SEVERITY_INFO,
        message: spec.message,
        location: {
            file: spec.file,
            start: { line: spec.startLine, column: 1 },
            end: { line: spec.endLine, column: 1 },
        },
        detail: spec.detail,
        suggestion: spec.suggestion,
        ...(actionable ? { actionable } : {}),
    };
}

// ─── SIM-ELSE-001 ───────────────────────────────────────────────────────────

const ELSE_MSG =
    'Redundant `else` after terminating statement — the `if` block always returns/exits, so `else` can be flattened.';
const ELSE_SUGGESTION = 'Remove the `else` keyword and de-indent its body to reduce nesting.';

/**
 * Scans brace-delimited languages (TypeScript, JavaScript, C#, etc.) to detect redundant
 * `else` blocks following guaranteed terminating branches (return, throw, break, continue).
 */
function auditRedundantElseBrace(lines: string[], file: string, issues: Issue[]): void {
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        if (!IF_OPEN_RE.test(lines[lineIndex])) continue;

        const closeIdx = findMatchingBrace(lines, lineIndex);
        if (closeIdx === -1 || closeIdx <= lineIndex) continue;

        const closeLine = lines[closeIdx];
        const afterClose = closeLine.replace(/^\s*\}\s*/, '');
        const hasElseSameLine = /^else\b/.test(afterClose);

        let elseLineIdx = closeIdx;
        if (!hasElseSameLine) {
            const nextIdx = advancePastBlanksAndComments(lines, closeIdx + 1);
            if (nextIdx >= lines.length) continue;
            if (!ELSE_RE.test(lines[nextIdx])) continue;
            elseLineIdx = nextIdx;
        }

        const lastStmtIdx = findLastMeaningfulLine(lines, lineIndex + 1, closeIdx - 1);
        if (lastStmtIdx === -1) continue;
        if (!TERMINATING_STMT_RE.test(lines[lastStmtIdx].trim())) continue;

        issues.push(
            makeIssue({
                rule: RULE_SIM_ELSE_001,
                file,
                startLine: lineIndex + 1,
                endLine: elseLineIdx + 1,
                message: ELSE_MSG,
                suggestion: ELSE_SUGGESTION,
                detail: { pattern: PATTERNS.braceElse },
            }),
        );
    }
}

function findPythonIfBodyEnd(lines: string[], start: number, ifIndent: number): number {
    let lastStmtIdx = -1;
    let bodyLineIndex = start;
    while (bodyLineIndex < lines.length) {
        const trimmed = lines[bodyLineIndex].trim();
        if (trimmed === '' || trimmed.startsWith(PREFIX_HASH)) {
            bodyLineIndex++;
            continue;
        }
        if (computeIndentWidth(lines[bodyLineIndex]) <= ifIndent) break;
        lastStmtIdx = bodyLineIndex;
        bodyLineIndex++;
    }
    return lastStmtIdx;
}

function findPythonTerminatingElse(lines: string[], lastStmtIdx: number, ifIndent: number): number {
    const lastStmt = lines[lastStmtIdx].trim();
    if (!/^(?:return|raise|break|continue)\b/.test(lastStmt)) return -1;
    const searchLineIndex = advancePastBlanksAndComments(lines, lastStmtIdx + 1);
    if (searchLineIndex >= lines.length || computeIndentWidth(lines[searchLineIndex]) !== ifIndent)
        return -1;
    return /^(else|elif)\b/.test(lines[searchLineIndex].trim()) ? searchLineIndex : -1;
}

/**
 * Scans Python source code using indentation heuristics to locate redundant `else` / `elif`
 * blocks following guaranteed terminating return or raise statements.
 */
function auditRedundantElsePython(lines: string[], file: string, issues: Issue[]): void {
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const ifMatch = PY_IF_RE.exec(lines[lineIndex]);
        if (!ifMatch) continue;
        const ifIndent = ifMatch[1].length;

        const lastStmtIdx = findPythonIfBodyEnd(lines, lineIndex + 1, ifIndent);
        if (lastStmtIdx === -1) continue;

        const elseLineIndex = findPythonTerminatingElse(lines, lastStmtIdx, ifIndent);
        if (elseLineIndex === -1) continue;

        issues.push(
            makeIssue({
                rule: RULE_SIM_ELSE_001,
                file,
                startLine: lineIndex + 1,
                endLine: elseLineIndex + 1,
                message: ELSE_MSG,
                suggestion: ELSE_SUGGESTION,
                detail: { pattern: PATTERNS.pythonElse },
            }),
        );
    }
}

/**
 * Audits source code lines for redundant else blocks after terminating statements.
 *
 * @param lines - Source lines collection to inspect for terminating else constructs.
 * @param file - Target source file path.
 * @param opts - Simplification options governing redundant else rule activation.
 * @param issues - Output collector for emitted redundant else issues.
 */
export function auditRedundantElse(
    lines: string[],
    file: string,
    opts: SimplifyOptions,
    issues: Issue[],
): void {
    if (opts.checkRedundantElse === false) return;
    if (file.endsWith('.py')) {
        auditRedundantElsePython(lines, file, issues);
        return;
    }
    auditRedundantElseBrace(lines, file, issues);
}

// ─── SIM-BOOL-001 ───────────────────────────────────────────────────────────

const BOOL_MSG_IFELSE =
    'Boolean return can be simplified — return the condition directly instead of `if/else`.';
const BOOL_MSG_IF =
    'Boolean return can be simplified — return the condition directly instead of `if`.';
const BOOL_MSG_TERNARY =
    'Boolean return can be simplified — return the condition directly instead of ternary.';
const BOOL_SUGGESTION = 'Replace with `return <condition>;` for cleaner code.';

/**
 * Records a SIM-BOOL-001 violation indicating that a conditional branch returns boolean literals
 * and can be reduced directly to the governing predicate.
 */
function emitBooleanIssue(
    context: LineAuditContext,
    span: readonly [number, number],
    message: string,
    pattern: string,
): void {
    context.issues.push(
        makeIssue({
            rule: RULE_SIM_BOOL_001,
            file: context.file,
            startLine: span[0],
            endLine: span[1],
            message,
            suggestion: BOOL_SUGGESTION,
            detail: { pattern },
        }),
    );
}

/**
 * Inspects source lines for ternary expressions returning literal booleans
 * (e.g. `return cond ? true : false`).
 */
function auditTernaryBoolReturn(context: LineAuditContext): void {
    for (let lineIndex = 0; lineIndex < context.lines.length; lineIndex++) {
        if (!TERNARY_BOOL_RETURN_RE.test(context.lines[lineIndex])) continue;
        const match = context.lines[lineIndex].match(
            /return\s+(.+?)\?\s*(true|false)\s*:\s*(true|false)/,
        );
        if (!match || match[2] === match[3]) continue;
        emitBooleanIssue(
            context,
            [lineIndex + 1, lineIndex + 1],
            BOOL_MSG_TERNARY,
            PATTERNS.ternaryBool,
        );
    }
}

/**
 * Inspects single-line inline if constructs returning boolean literals.
 */
function auditInlineBoolReturn(context: LineAuditContext): void {
    for (let lineIndex = 0; lineIndex < context.lines.length; lineIndex++) {
        const trimmed = context.lines[lineIndex].trim();
        const match = /^if\s*\((.+)\)\s*return\s+(true|false)\s*[;}]?\s*$/.exec(trimmed);
        if (!match) continue;
        const ifBool = match[2] === 'true';
        const searchLineIndex = advancePastBlanksAndComments(context.lines, lineIndex + 1);
        if (searchLineIndex >= context.lines.length) continue;
        const nextBool = /^return\s+(true|false)\s*[;}]?\s*$/.exec(
            context.lines[searchLineIndex].trim(),
        );
        if (!nextBool) continue;
        if (ifBool === (nextBool[1] === 'true')) continue;

        emitBooleanIssue(
            context,
            [lineIndex + 1, searchLineIndex + 1],
            BOOL_MSG_IF,
            PATTERNS.singleLineIfBool,
        );
    }
}

function findElseBodyStart(lines: string[], closeIdx: number): number {
    const closeLine = lines[closeIdx];
    const afterClose = closeLine.replace(/^\s*\}\s*/, '');
    if (/^else\b/.test(afterClose)) return closeIdx;
    const nextIdx = advancePastBlanksAndComments(lines, closeIdx + 1);
    return nextIdx < lines.length && ELSE_RE.test(lines[nextIdx]) ? nextIdx : -1;
}

interface BlockIfCheckSpec {
    readonly context: LineAuditContext;
    readonly lineIndex: number;
    readonly closeIdx: number;
    readonly ifBool: boolean;
}

function checkBlockIfNoElse(spec: BlockIfCheckSpec): void {
    const searchLineIndex = advancePastBlanksAndComments(spec.context.lines, spec.closeIdx + 1);
    if (searchLineIndex >= spec.context.lines.length) return;
    const nextBool = RETURN_BOOL_RE.exec(spec.context.lines[searchLineIndex].trim());
    if (!nextBool || spec.ifBool === (nextBool[1] === 'true')) return;

    emitBooleanIssue(
        spec.context,
        [spec.lineIndex + 1, searchLineIndex + 1],
        BOOL_MSG_IF,
        PATTERNS.blockIfNoElse,
    );
}

interface BlockIfElseSpec {
    readonly context: LineAuditContext;
    readonly lineIndex: number;
    readonly elseBodyStart: number;
    readonly ifBool: boolean;
}

function checkBlockIfElse(spec: BlockIfElseSpec): void {
    const elseCloseIdx = findMatchingBrace(spec.context.lines, spec.elseBodyStart);
    if (elseCloseIdx === -1) return;

    const elseLastIdx = findLastMeaningfulLine(
        spec.context.lines,
        spec.elseBodyStart + 1,
        elseCloseIdx - 1,
    );
    if (elseLastIdx === -1) return;
    const elseBoolMatch = RETURN_BOOL_RE.exec(spec.context.lines[elseLastIdx].trim());
    if (!elseBoolMatch) return;
    const elseBool = elseBoolMatch[1] === 'true';
    if (spec.ifBool === elseBool) return;

    if (countMeaningfulStatements(spec.context.lines, spec.elseBodyStart + 1, elseCloseIdx) !== 1)
        return;

    emitBooleanIssue(
        spec.context,
        [spec.lineIndex + 1, elseCloseIdx + 1],
        BOOL_MSG_IFELSE,
        PATTERNS.ifElseBlocks,
    );
}

function auditBlockBoolReturn(context: LineAuditContext): void {
    for (let lineIndex = 0; lineIndex < context.lines.length; lineIndex++) {
        const trimmed = context.lines[lineIndex].trim();
        if (!/^if\s*\((.+)\)\s*\{\s*$/.test(trimmed)) continue;

        const closeIdx = findMatchingBrace(context.lines, lineIndex);
        if (closeIdx === -1) continue;

        const lastStmtIdx = findLastMeaningfulLine(context.lines, lineIndex + 1, closeIdx - 1);
        if (lastStmtIdx === -1) continue;
        const ifBoolMatch = RETURN_BOOL_RE.exec(context.lines[lastStmtIdx].trim());
        if (!ifBoolMatch) continue;
        const ifBool = ifBoolMatch[1] === 'true';

        if (countMeaningfulStatements(context.lines, lineIndex + 1, closeIdx) !== 1) continue;

        const elseBodyStart = findElseBodyStart(context.lines, closeIdx);
        if (elseBodyStart === -1) {
            checkBlockIfNoElse({ context, lineIndex, closeIdx, ifBool });
        } else {
            checkBlockIfElse({ context, lineIndex, elseBodyStart, ifBool });
        }
    }
}

function findPythonBlockEnd(lines: string[], start: number, ifIndent: number): number {
    let searchIndex = start;
    while (searchIndex < lines.length) {
        const trimmed = lines[searchIndex].trim();
        if (trimmed === '' || trimmed.startsWith(PREFIX_HASH)) {
            searchIndex++;
            continue;
        }
        if (computeIndentWidth(lines[searchIndex]) <= ifIndent) break;
        searchIndex++;
    }
    return searchIndex;
}

interface PythonBoolCheckSpec {
    readonly context: LineAuditContext;
    readonly lineIndex: number;
    readonly blockEndIndex: number;
    readonly ifIndent: number;
    readonly ifBool: boolean;
}

function auditPyBoolWithElse(spec: PythonBoolCheckSpec): void {
    const searchLineIndex = advancePastBlanksAndComments(
        spec.context.lines,
        spec.blockEndIndex + 1,
    );
    if (
        searchLineIndex >= spec.context.lines.length ||
        computeIndentWidth(spec.context.lines[searchLineIndex]) <= spec.ifIndent
    )
        return;
    const elseBoolMatch = /^return\s+(True|False)\s*$/.exec(
        spec.context.lines[searchLineIndex].trim(),
    );
    if (!elseBoolMatch || spec.ifBool === (elseBoolMatch[1] === 'True')) return;

    emitBooleanIssue(
        spec.context,
        [spec.lineIndex + 1, spec.blockEndIndex + 1],
        BOOL_MSG_IFELSE,
        PATTERNS.pyIfElseBool,
    );
}

interface PyNoElseSpec {
    readonly context: LineAuditContext;
    readonly lineIndex: number;
    readonly blockEndIndex: number;
    readonly afterTrimmed: string;
    readonly ifBool: boolean;
}

function auditPyBoolNoElse(spec: PyNoElseSpec): void {
    const afterBool = /^return\s+(True|False)\s*$/.exec(spec.afterTrimmed);
    if (!afterBool || spec.ifBool === (afterBool[1] === 'True')) return;

    emitBooleanIssue(
        spec.context,
        [spec.lineIndex + 1, spec.blockEndIndex + 1],
        BOOL_MSG_IF,
        PATTERNS.pyIfBoolNoElse,
    );
}

function auditPythonBoolReturn(context: LineAuditContext): void {
    for (let lineIndex = 0; lineIndex < context.lines.length; lineIndex++) {
        const trimmed = context.lines[lineIndex].trim();
        if (!/^if\s+(.+):\s*$/.test(trimmed)) continue;

        const ifIndent = computeIndentWidth(context.lines[lineIndex]);
        const bodyLineIndex = advancePastBlanksAndComments(context.lines, lineIndex + 1);
        if (
            bodyLineIndex >= context.lines.length ||
            computeIndentWidth(context.lines[bodyLineIndex]) <= ifIndent
        )
            continue;

        const bodyTrimmed = context.lines[bodyLineIndex].trim();
        const boolMatch = /^return\s+(True|False)\s*$/.exec(bodyTrimmed);
        if (!boolMatch) continue;
        const ifBool = boolMatch[1] === 'True';

        const blockEndIndex = findPythonBlockEnd(context.lines, bodyLineIndex + 1, ifIndent);
        if (
            blockEndIndex >= context.lines.length ||
            computeIndentWidth(context.lines[blockEndIndex]) !== ifIndent
        )
            continue;

        const afterTrimmed = context.lines[blockEndIndex].trim();
        if (/^else\s*:/.test(afterTrimmed)) {
            auditPyBoolWithElse({ context, lineIndex, blockEndIndex, ifIndent, ifBool });
        } else if (/^return\s+(True|False)\s*$/.test(afterTrimmed)) {
            auditPyBoolNoElse({ context, lineIndex, blockEndIndex, afterTrimmed, ifBool });
        }
    }
}

/**
 * Audits source code lines for verbose boolean return patterns that can be simplified.
 *
 * @param lines - Source text decomposed into discrete lines for inspection.
 * @param file - Relative path of the target code artifact.
 * @param opts - Configuration options governing boolean return checks.
 * @param issues - Mutable collection accumulating detected issues.
 */
export function auditBooleanReturn(
    lines: string[],
    file: string,
    opts: SimplifyOptions,
    issues: Issue[],
): void {
    if (opts.checkBooleanReturn === false) return;
    const context: LineAuditContext = { lines, file, issues };
    if (file.endsWith('.py')) {
        auditPythonBoolReturn(context);
        return;
    }
    auditTernaryBoolReturn(context);
    auditInlineBoolReturn(context);
    auditBlockBoolReturn(context);
}

// ─── SIM-GUARD-001 ──────────────────────────────────────────────────────────

const GUARD_SUGGESTION = 'Invert the condition and return early to reduce nesting depth.';

function emitGuardClauseIssue(
    issues: Issue[],
    spec: { file: string; startLine: number; endLine: number; count: number; threshold: number },
): void {
    issues.push(
        makeIssue({
            rule: RULE_SIM_GUARD_001,
            file: spec.file,
            startLine: spec.startLine,
            endLine: spec.endLine,
            message: `Deep conditional nesting at function start — ${spec.count} consecutive if-return patterns. Consider using guard clauses with early returns.`,
            suggestion: GUARD_SUGGESTION,
            detail: { count: spec.count, threshold: spec.threshold },
        }),
    );
}

function resolveGuardIfSpan(lines: string[], lineIndex: number): number {
    const trimmed = lines[lineIndex].trim();
    if (/^if\s*\([^)]*\)\s*(?:return|throw)\b/.test(trimmed)) return lineIndex;
    if (/^if\s*\([^)]*\)\s*\{\s*$/.test(trimmed)) {
        const closeIdx = findMatchingBrace(lines, lineIndex);
        if (closeIdx === -1) return -1;
        const stmts = countMeaningfulStatements(lines, lineIndex + 1, closeIdx);
        if (stmts !== 1) return -1;
        const lastIdx = findLastMeaningfulLine(lines, lineIndex + 1, closeIdx - 1);
        if (lastIdx === -1) return -1;
        if (/^(?:return|throw)\b/.test(lines[lastIdx].trim())) {
            return closeIdx;
        }
    }
    return -1;
}

function buildBraceLineIndexSet(lines: string[]): Set<number> {
    const set = new Set<number>();
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        if (/\{/.test(lines[lineIndex])) {
            set.add(lineIndex);
        }
    }
    return set;
}

function findFunctionOpeningBraceIndexed(
    braceSet: Set<number>,
    start: number,
    maxLines: number,
): number {
    const limit = Math.min(maxLines, start + MAX_HEADER_SEARCH_LINES);
    for (let braceIdx = start; braceIdx < limit; braceIdx++) {
        if (braceSet.has(braceIdx)) return braceIdx;
    }
    return -1;
}

/**
 * Locate the opening brace index for a function starting at or after the start index.
 *
 * @param lines - Array of source code lines.
 * @param start - Starting line index to begin searching for opening brace.
 * @returns 0-based line index of the opening brace, or -1 if not found.
 */
export function findFunctionOpeningBrace(lines: string[], start: number): number {
    const braceSet = buildBraceLineIndexSet(lines);
    return findFunctionOpeningBraceIndexed(braceSet, start, lines.length);
}

function countConsecutiveGuardClauses(
    lines: string[],
    start: number,
): { count: number; firstIfLine: number } {
    let count = 0;
    let firstIfLine = -1;
    let currentLineIndex = start;
    while (currentLineIndex < lines.length) {
        const trimmedLine = lines[currentLineIndex].trim();
        if (isCommentOrBlankLine(trimmedLine)) {
            currentLineIndex++;
            continue;
        }
        const guardEnd = resolveGuardIfSpan(lines, currentLineIndex);
        if (guardEnd !== -1) {
            if (firstIfLine === -1) firstIfLine = currentLineIndex;
            count++;
            currentLineIndex = guardEnd + 1;
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
    const braceSet = buildBraceLineIndexSet(lines);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const trimmed = lines[lineIndex].trim();
        if (!/\b(?:function|fn|func)\s+[A-Za-z_]\w*/.test(trimmed) || trimmed.endsWith(';')) {
            continue;
        }

        const braceIdx = findFunctionOpeningBraceIndexed(braceSet, lineIndex, lines.length);
        if (braceIdx === -1) continue;

        const { count, firstIfLine } = countConsecutiveGuardClauses(lines, braceIdx + 1);

        if (count >= threshold) {
            emitGuardClauseIssue(issues, {
                file,
                startLine: braceIdx + 1,
                endLine: firstIfLine + count + 1,
                count,
                threshold,
            });
        }
    }
}

function advancePastPythonDocstrings(lines: string[], startIndex: number): number {
    let lineIndex = startIndex;
    while (lineIndex < lines.length) {
        const trimmed = lines[lineIndex].trim();
        if (trimmed === '' || trimmed.startsWith(PREFIX_HASH)) {
            lineIndex++;
            continue;
        }
        if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
            const marker = trimmed.startsWith('"""') ? '"""' : "'''";
            if (trimmed.split(marker).length - 1 < 2) {
                lineIndex++;
                while (lineIndex < lines.length && !lines[lineIndex].includes(marker)) lineIndex++;
                lineIndex++;
            } else {
                lineIndex++;
            }
            continue;
        }
        break;
    }
    return lineIndex;
}

function resolvePythonGuardIfEnd(lines: string[], lineIndex: number, ifIndent: number): number {
    const bodyIdx = advancePastBlanksAndComments(lines, lineIndex + 1);
    if (bodyIdx >= lines.length) return -1;
    if (computeIndentWidth(lines[bodyIdx]) <= ifIndent) return -1;
    if (!/^(?:return|raise)\b/.test(lines[bodyIdx].trim())) return -1;

    let nextIdx = bodyIdx + 1;
    while (
        nextIdx < lines.length &&
        (lines[nextIdx].trim() === '' || lines[nextIdx].trim().startsWith(PREFIX_HASH))
    ) {
        nextIdx++;
    }
    if (nextIdx < lines.length && computeIndentWidth(lines[nextIdx]) > ifIndent) return -1;
    return nextIdx;
}

function countPythonGuardClauses(
    lines: string[],
    startIdx: number,
    funcIndent: number,
): { count: number; firstIfLine: number } {
    let count = 0;
    let firstIfLine = -1;
    let currentLineIndex = startIdx;

    while (currentLineIndex < lines.length) {
        const trimmedLine = lines[currentLineIndex].trim();
        if (trimmedLine === '' || trimmedLine.startsWith(PREFIX_HASH)) {
            currentLineIndex++;
            continue;
        }
        if (computeIndentWidth(lines[currentLineIndex]) <= funcIndent) break;

        const ifMatch = PY_IF_RE.exec(lines[currentLineIndex]);
        if (!ifMatch) break;
        const ifIndent = ifMatch[1].length;

        const nextIdx = resolvePythonGuardIfEnd(lines, currentLineIndex, ifIndent);
        if (nextIdx === -1) break;

        if (firstIfLine === -1) firstIfLine = currentLineIndex;
        count++;
        currentLineIndex = nextIdx;
    }

    return { count, firstIfLine };
}

function auditGuardClausePatternsPython(
    lines: string[],
    file: string,
    threshold: number,
    issues: Issue[],
): void {
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const defMatch = PY_DEF_RE.exec(lines[lineIndex]);
        if (!defMatch) continue;
        const funcIndent = defMatch[1].length;

        const startIdx = advancePastPythonDocstrings(lines, lineIndex + 1);
        const { count, firstIfLine } = countPythonGuardClauses(lines, startIdx, funcIndent);

        if (count >= threshold) {
            emitGuardClauseIssue(issues, {
                file,
                startLine: lineIndex + 1,
                endLine: firstIfLine + count + 1,
                count,
                threshold,
            });
        }
    }
}

/**
 * Audits excessive nesting patterns that can be flattened with early guard clauses.
 *
 * @param lines - Source code lines evaluated for guard-clause nesting opportunities.
 * @param file - Target repository file path being inspected.
 * @param opts - Options tuning the guard-clause detection threshold.
 * @param issues - Output issue sink receiving detected guard-clause violations.
 */
export function auditGuardClausePatterns(
    lines: string[],
    file: string,
    opts: SimplifyOptions,
    issues: Issue[],
): void {
    if (opts.checkGuardClausePatterns === false) return;
    const threshold = opts.maxGuardClausePatternNesting ?? DEFAULT_MAX_GUARD_NESTING;
    const isPython = file.endsWith('.py');
    const dispatchAudit = isPython ? auditGuardClausePatternsPython : auditGuardClausePatternsBrace;
    dispatchAudit(lines, file, threshold, issues);
}
