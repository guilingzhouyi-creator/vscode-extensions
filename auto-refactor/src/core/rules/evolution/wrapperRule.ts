/**
 * Module: Core Rules — Evolution: Unnecessary Forwarding Wrapper Rule
 * File Path: src/core/rules/evolution/wrapperRule.ts
 * Architecture Role: Implements detection for HYG-WRAP-001 across multiple languages,
 *   identifying transparent forwarding wrappers that merely pass arguments through.
 * Dependencies & Triggers: Consumes Issue and AnalyzerContext; called by HygieneAnalyzer
 *   and the rule generalization pipeline.
 * Responsibilities: Detect 1:1 argument forwarding wrappers, respect exemption markers,
 *   and emit canonical HYG-WRAP-001 issues.
 * Exit Semantics & Design Rationale: Pure, stateless, low-overhead scan.
 */

import type { AnalyzerContext, Issue } from '../../types';
import { SEVERITY_WARNING } from '../../types';
import { isTransparentForwarding, normalizeParameterNames } from './patternNormalizer';

/** Rule ID emitted by this checker. */
export const HYG_WRAP_RULE_ID = 'HYG-WRAP-001';

/** Maximum line count for a function to be considered a candidate trivial wrapper. */
const MAX_WRAPPER_LINE_COUNT = 4;

/** Exemption keywords in comments or decorators indicating legitimate delegation. */
const EXEMPTION_MARKERS = [
    '@deprecated',
    '@override',
    'adapter',
    'facade',
    'shim',
    'backward compat',
    'forward compat',
    'interface implementation',
    'delegate',
];

const RESERVED_CONTROL_KEYWORDS = new Set([
    'catch',
    'if',
    'while',
    'for',
    'switch',
    'with',
    'except',
    'finally',
]);

/**
 * Checks if a comment block preceding or inside the function contains an exemption marker.
 *
 * @param lines - Array of source lines.
 * @param startLineIdx - Zero-based index of the function declaration.
 * @returns True if the function has an explicit rationale for delegation.
 */
function hasExemptionMarker(lines: readonly string[], startLineIdx: number): boolean {
    const lookback = Math.max(0, startLineIdx - 5);
    for (let i = lookback; i <= startLineIdx; i++) {
        const line = lines[i]?.toLowerCase() || '';
        for (const marker of EXEMPTION_MARKERS) {
            if (line.includes(marker)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Inspects a short function body across TS, JS, Python, Rust, GDScript for transparent passthrough.
 *
 * @param params - Formal parameter names.
 * @param bodyLines - Lines containing the function body.
 * @returns Details of the target call if transparent forwarding is detected, else null.
 */
function inspectBodyForForwarding(
    params: string[],
    bodyLines: readonly string[],
): { target: string; args: string } | null {
    if (bodyLines.length > MAX_WRAPPER_LINE_COUNT || bodyLines.length === 0) {
        return null;
    }

    const joinedBody = bodyLines.map((l) => l.trim()).join(' ');

    // Match patterns strictly requiring the entire body to be only the return/call:
    // `return this.target(a, b);` or `return target(a, b);` or `target(a, b)` (Rust)
    const callMatch = joinedBody.match(
        /^(?:return\s+)?(?:this\.|self\.)?([a-zA-Z0-9_$]+(?:\.[a-zA-Z0-9_$]+)?)\s*\(([^)]*)\)\s*;?$/,
    );

    if (!callMatch) {
        return null;
    }

    const target = callMatch[1];
    const callArgs = callMatch[2];

    if (isTransparentForwarding(params, callArgs)) {
        return { target, args: callArgs };
    }

    return null;
}

const FN_HEAD_PY_RE = /(?:async\s+)?def\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*:/;
const FN_HEAD_BRACED_RE =
    /(?:async\s+)?(?:def|fn|func|function)\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)|(?:public|private|protected)?\s*([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\{/;

/**
 * Extracts function name and parameter string if the line is a declaration head.
 *
 * @param line - Line text.
 * @param isPyOrGd - Whether file is an indentation-scoped language.
 * @returns Function name and raw parameters, or null.
 */
function extractFunctionHead(
    line: string,
    isPyOrGd: boolean,
): { fnName: string; rawParams: string } | null {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
        return null;
    }
    const match = line.match(isPyOrGd ? FN_HEAD_PY_RE : FN_HEAD_BRACED_RE);
    if (!match) return null;
    const fnName = match[1] || match[3];
    const rawParams = match[2] !== undefined ? match[2] : match[4];
    if (
        !fnName ||
        fnName === 'constructor' ||
        fnName.startsWith('_init') ||
        RESERVED_CONTROL_KEYWORDS.has(fnName)
    ) {
        return null;
    }
    return { fnName, rawParams: rawParams || '' };
}

/**
 * Collects indented body statements for Python or GDScript functions.
 *
 * @param lines - All file lines.
 * @param startIdx - Line index immediately after the def header.
 * @param defIndent - Column index of the def keyword.
 * @returns Array of non-comment trimmed body lines.
 */
function collectIndentedBody(
    lines: readonly string[],
    startIdx: number,
    defIndent: number,
): string[] {
    const body: string[] = [];
    for (let j = startIdx; j < lines.length; j++) {
        const bLine = lines[j];
        const bTrim = bLine.trim();
        if (!bTrim || bTrim.startsWith('#')) continue;
        const bIndent = bLine.search(/\S/);
        if (bIndent <= defIndent) break;
        body.push(bTrim);
    }
    return body;
}

/**
 * Collects body statements for braced languages (TS, JS, Rust).
 *
 * @param lines - All file lines.
 * @param startIdx - Line index immediately after the opening brace.
 * @returns Array of non-comment trimmed body lines up to closing brace.
 */
function collectBracedBody(lines: readonly string[], startIdx: number): string[] {
    const body: string[] = [];
    for (let j = startIdx; j < Math.min(lines.length, startIdx + MAX_WRAPPER_LINE_COUNT); j++) {
        const bodyLine = lines[j].trim();
        if (bodyLine.startsWith('//') || bodyLine.startsWith('#')) continue;
        if (bodyLine === '}' || bodyLine.endsWith('}')) {
            const preBrace = bodyLine.replace(/\}$/, '').trim();
            if (preBrace) body.push(preBrace);
            break;
        }
        body.push(bodyLine);
    }
    return body;
}

/**
 * Checks a single line for a vacuous wrapper function definition.
 *
 * @param lines - All file lines.
 * @param idx - Current line index.
 * @param file - File path.
 * @param isPyOrGd - Whether language uses indent scopes.
 * @returns Issue record if violation found, else null.
 */
function checkFunctionAtLine(
    lines: readonly string[],
    idx: number,
    file: string,
    isPyOrGd: boolean,
): Issue | null {
    const head = extractFunctionHead(lines[idx], isPyOrGd);
    if (!head || hasExemptionMarker(lines, idx)) return null;

    const params = normalizeParameterNames(head.rawParams);
    const bodyLines = isPyOrGd
        ? collectIndentedBody(lines, idx + 1, lines[idx].search(/\S/))
        : collectBracedBody(lines, idx + 1);

    if (bodyLines.length === 0) return null;

    const forwardInfo = inspectBodyForForwarding(params, bodyLines);
    if (!forwardInfo || forwardInfo.target === head.fnName) return null;

    const lineNum = idx + 1;
    return {
        id: `hygiene:${HYG_WRAP_RULE_ID}:${file}:${lineNum}`,
        analyzer: 'hygiene',
        rule: HYG_WRAP_RULE_ID,
        severity: SEVERITY_WARNING,
        message:
            `Function \`${head.fnName}\` is a vacuous passthrough wrapper directly ` +
            `forwarding arguments to \`${forwardInfo.target}\`.`,
        location: {
            file,
            start: { line: lineNum, column: lines[idx].indexOf(head.fnName) + 1 },
            end: {
                line: lineNum,
                column: lines[idx].indexOf(head.fnName) + head.fnName.length + 1,
            },
        },
        detail: { fnName: head.fnName, target: forwardInfo.target, paramCount: params.length },
        suggestion:
            'Directly invoke the underlying target or introduce necessary validation, ' +
            'transformation, or context logging to the wrapper.',
    };
}

/**
 * Audits source text for unnecessary forwarding wrappers across supported languages.
 *
 * @param content - Source file content.
 * @param file - Normalized file path.
 * @param _ctx - Analyzer context.
 * @returns Array of emitted HYG-WRAP-001 issues.
 */
export function auditVacuousWrappers(
    content: string,
    file: string,
    _ctx?: AnalyzerContext,
): Issue[] {
    const issues: Issue[] = [];
    const lines = content.split(/\r?\n/);
    const isPyOrGd = file.endsWith('.py') || file.endsWith('.gd');

    for (let i = 0; i < lines.length; i++) {
        const issue = checkFunctionAtLine(lines, i, file, isPyOrGd);
        if (issue) {
            issues.push(issue);
        }
    }

    return issues;
}
