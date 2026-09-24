/**
 * Module: Core Engine - Governance Rules - Type System Helpers
 * File Path: src/core/governance/rules/type-system-helpers.ts
 * Architecture Role: Shared helper routines and AST regex scanners for strong typing,
 *   function return type completeness, and escape hatch elimination across languages.
 * Dependencies & Triggers: Consumes GovernanceViolation from ../types; called exclusively
 *   by rules in ./typeSystem.ts.
 * Responsibilities: Parse multi-line parameter signatures, verify Python/GDScript typing,
 *   evaluate GDScript weak variables, and check TypeScript exported return types.
 * Exit Semantics & Design Rationale: Pure, stateless functions; never throw or leak state.
 */

import type { GovernanceViolation } from '../types';
import { isToolOrTestScript } from '../pathScope';

/** Shared category token for all type system governance rules. */
export const TYPE_SYSTEM_CATEGORY = 'type_system';

/** Default risk severity tier for type system governance rules. */
export const RISK_MEDIUM = 'medium';

const RULE_ID_GOV_TYP_001 = 'GOV-TYP-001';
const RULE_ID_GOV_TYP_002 = 'GOV-TYP-002';
const RULE_ID_GOV_TYP_003 = 'GOV-TYP-003';
const RULE_ID_GOV_TYP_006 = 'GOV-TYP-006';

const MSG_EXPLICIT_TYPING =
    'Variable uses implicit loose assignment (`var =`). Use explicit declaration or static inference (`:=`).';
const SUGG_EXPLICIT_TYPING = 'Change to `var name := ...` or provide an explicit type annotation.';

const GD_WEAK_VAR_RE = /^\s*(?:@\w+\s+)?(?:static\s+)?var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=(?!=)/;
const VARIANT_RHS_RE = /^\s*(null|\[\]|\{\}|Variant)/;
const VARIANT_CALL_RE = /\.get\(|\bget\(.*Variant|Variant.*get\(/;
const VARIANT_COLLECTION_ACCESS_RE = /^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*[\[.]/;
const NON_VARIANT_SINGLETONS_RE = /(?:GameConfig|DeterministicRNG|UniqueIdGenerator)\./;
const DICT_GET_PREFIX_RE = /^d\.get\(/;
const ANY_KEYWORD_RE = /\bany\b/;
const ESLINT_DISABLE_RE = /eslint-disable/;
const GD_FUNC_RE = /^\s*(?:static\s+)?func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*(?!->)\s*:/;
const PY_FUNC_START_RE = /^\s*(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;
const PY_RETURN_TYPE_RE = /\)\s*->\s*[^:]+:/;
const ANY_RE = /:\s*\bany\b|\bas\s+any\b/;

const EXPORT_KEYWORD = 'export';
const MAX_SIGNATURE_SCAN_LINES = 40;
const BLOCK_OR_SEMI_RE = /[{;]/;
const ARROW_BODY_RE = /=>/;
const FN_RETURN_TYPE_SUFFIX_RE = /\)\s*:\s*[^{;]+(?:\{|;)/;
const ARROW_RETURN_TYPE_SUFFIX_RE = /\)\s*:\s*[^=]+=>/;

const EXPORT_FN_RE = /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/;
const EXPORT_CONST_ARROW_RE = /^\s*export\s+const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(/;

/**
 * Evaluates a single line for GDScript weak variable assignment.
 *
 * @param line - Line text.
 * @param lineIndex - Zero-based line number.
 * @param violations - Accumulator for governance violations.
 */
export function checkGdWeakVarLine(
    line: string,
    lineIndex: number,
    violations: GovernanceViolation[],
): void {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) return;
    const m = line.match(GD_WEAK_VAR_RE);
    if (!m) return;

    const rhs = line.slice((m.index ?? 0) + m[0].length).trim();
    const isVariantAmbiguous =
        VARIANT_RHS_RE.test(rhs) ||
        DICT_GET_PREFIX_RE.test(rhs) ||
        VARIANT_CALL_RE.test(rhs) ||
        (VARIANT_COLLECTION_ACCESS_RE.test(rhs) && !NON_VARIANT_SINGLETONS_RE.test(rhs));
    if (isVariantAmbiguous) return;

    violations.push({
        ruleId: RULE_ID_GOV_TYP_001,
        message: `Variable \`${m[1]}\`: ${MSG_EXPLICIT_TYPING}`,
        line: lineIndex + 1,
        column: (m.index ?? 0) + 1,
        suggestion: SUGG_EXPLICIT_TYPING,
        fixable: true,
        suggestedPatch: line.replace(/var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/, 'var $1 :='),
    });
}

/**
 * Computes the paren/bracket balance delta for a code segment.
 *
 * @param codePart - Segment of source code.
 * @returns Net balance of opening vs closing delimiters.
 */
export function computeParenDelta(codePart: string): number {
    let delta = 0;
    for (let c = 0; c < codePart.length; c++) {
        const ch = codePart[c];
        if (ch === '(' || ch === '[' || ch === '{') delta++;
        else if (ch === ')' || ch === ']' || ch === '}') delta--;
    }
    return delta;
}

/**
 * Extracts and parses a Python function signature across multiple lines.
 *
 * @param lines - All lines of the source file.
 * @param startIndex - Line index where the function declaration begins.
 * @returns Parsed signature text, completion flag, and ending line index.
 */
export function parsePythonFunctionSignature(
    lines: string[],
    startIndex: number,
): { sigText: string; matchedEnd: boolean; endLine: number } {
    let sigText = '';
    let depth = 0;
    let matchedEnd = false;
    let endLine = startIndex;

    for (let j = startIndex; j < lines.length; j++) {
        const l = lines[j];
        const hashIdx = l.search(/#/);
        const codePart = hashIdx >= 0 ? l.slice(0, hashIdx) : l;

        depth += computeParenDelta(codePart);
        sigText += ' ' + codePart.trim();
        if (depth <= 0 && /:/.test(codePart)) {
            matchedEnd = true;
            endLine = j;
            break;
        }
    }
    return { sigText, matchedEnd, endLine };
}

/**
 * Scans Python code lines for unannotated function return types.
 *
 * @param lines - All lines of the source file.
 * @param violations - Accumulator for governance violations.
 */
export function checkPythonFunctionReturnTypes(
    lines: string[],
    violations: GovernanceViolation[],
): void {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('#')) continue;
        const match = PY_FUNC_START_RE.exec(line);
        if (!match) continue;

        const funcName = match[1];
        const { sigText, matchedEnd, endLine } = parsePythonFunctionSignature(lines, i);
        if (!matchedEnd) continue;

        i = endLine;
        if (!PY_RETURN_TYPE_RE.test(sigText)) {
            violations.push({
                ruleId: RULE_ID_GOV_TYP_002,
                message: `Function \`${funcName}\` lacks explicit return type annotation (\`-> Type\`).`,
                line: i + 1,
                column: match.index != null ? match.index + 1 : 1,
                suggestion: `Add explicit return type: \`def ${funcName}(...) -> None:\` or appropriate type.`,
                fixable: false,
            });
        }
    }
}

/**
 * Evaluates a single GDScript AST node signature for missing return type.
 *
 * @param signatureLine - Text of function signature line.
 * @param startLine - Line number in source.
 * @returns Violation if return type is missing, else null.
 */
export function checkGdFunctionSignature(
    signatureLine: string,
    startLine: number,
): GovernanceViolation | null {
    const m = signatureLine.match(GD_FUNC_RE);
    if (m && !m[1].startsWith('_')) {
        return {
            ruleId: RULE_ID_GOV_TYP_002,
            message: `Function \`${m[1]}\` lacks explicit return type annotation (\`-> Type\`).`,
            line: startLine,
            column: m.index != null ? m.index + 1 : 1,
            suggestion: `Add explicit return type: \`func ${m[1]}(...) -> void:\` or appropriate type.`,
            fixable: false,
        };
    }
    return null;
}

/**
 * Scans masked lines for naked any annotations.
 *
 * @param masked - Masked lines.
 * @param violations - Accumulator for violations.
 */
export function checkUnsafeAny(masked: string[], violations: GovernanceViolation[]): void {
    for (let i = 0; i < masked.length; i++) {
        const line = masked[i];
        if (!ANY_KEYWORD_RE.test(line)) continue;
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (ANY_RE.test(line) && !ESLINT_DISABLE_RE.test(line)) {
            violations.push({
                ruleId: RULE_ID_GOV_TYP_003,
                message:
                    'Avoid naked `any` type annotations; prefer `unknown` or specific union types.',
                line: i + 1,
                column: line.search(ANY_RE) + 1,
                suggestion:
                    'Replace with a strongly-typed interface, generic parameter, or `unknown`.',
                fixable: false,
            });
        }
    }
}

/**
/**
 * Scans forward from the declaration line to accumulate the signature text.
 *
 * @param masked - Masked lines.
 * @param startIdx - Starting line index.
 * @param terminatorRe - Regex identifying termination delimiter.
 * @returns Accumulated signature string.
 */
function extractDeclarationSignature(
    masked: string[],
    startIdx: number,
    terminatorRe: RegExp,
): string {
    let sig = '';
    let depth = 0;
    let foundParen = false;
    const maxIdx = Math.min(masked.length, startIdx + MAX_SIGNATURE_SCAN_LINES);

    for (let j = startIdx; j < maxIdx; j++) {
        const part = masked[j];
        depth += computeParenDelta(part);
        sig += ' ' + part.trim();
        if (part.includes('(')) foundParen = true;
        if (foundParen && depth <= 0 && terminatorRe.test(part)) {
            break;
        }
    }
    return sig;
}

/**
 * Emits a GOV-TYP-006 violation for an unannotated exported function or arrow.
 *
 * @param violations - Accumulator.
 * @param symbol - Function or variable identifier.
 * @param line - 1-based line number.
 * @param column - 1-based column number.
 * @param isArrow - True if declaration is an arrow function.
 */
function reportMissingReturnType(
    violations: GovernanceViolation[],
    symbol: string,
    line: number,
    column: number,
    isArrow: boolean,
): void {
    const kind = isArrow ? 'arrow function' : 'function';
    const message = `Exported ${kind} \`${symbol}\` lacks explicit return type annotation.`;
    const suggestion = isArrow
        ? `Add an explicit return type: \`export const ${symbol} = (...): ReturnType => ...\`.`
        : `Add an explicit return type: \`export function ${symbol}(...): ReturnType\`.`;

    violations.push({
        ruleId: RULE_ID_GOV_TYP_006,
        message,
        line,
        column,
        suggestion,
        fixable: false,
    });
}

/**
 * Inspects an exported declaration (function or arrow const) for missing return type.
 *
 * @param line - Line text.
 * @param idx - Current line index.
 * @param masked - Masked lines.
 * @param violations - Accumulator.
 * @param declRe - Matcher for the declaration header.
 * @param terminatorRe - Delimiter matcher for signature end.
 * @param returnTypeSuffixRe - Pattern asserting presence of return type.
 * @param isArrow - True if evaluating an arrow function.
 */
function inspectExportedDeclaration(
    line: string,
    idx: number,
    masked: string[],
    violations: GovernanceViolation[],
    declRe: RegExp,
    terminatorRe: RegExp,
    returnTypeSuffixRe: RegExp,
    isArrow: boolean,
): void {
    const match = declRe.exec(line);
    if (!match) return;

    const symbol = match[1];
    const sig = extractDeclarationSignature(masked, idx, terminatorRe);

    if (!returnTypeSuffixRe.test(sig)) {
        reportMissingReturnType(violations, symbol, idx + 1, match.index + 1, isArrow);
    }
}

/**
 * Checks TypeScript source lines for exported functions lacking explicit return types.
 *
 * @param masked - Masked source lines.
 * @param filePath - Path to source file.
 * @param violations - Accumulator for governance violations.
 */
export function checkExportedFunctionReturnTypes(
    masked: string[],
    filePath: string,
    violations: GovernanceViolation[],
): void {
    if (
        isToolOrTestScript(filePath) ||
        /\.(d\.ts)$/.test(filePath) ||
        /\.(test|spec)\.[jt]sx?$/.test(filePath)
    ) {
        return;
    }

    for (let i = 0; i < masked.length; i++) {
        const line = masked[i];
        if (!line.includes(EXPORT_KEYWORD)) continue;
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (ESLINT_DISABLE_RE.test(line)) continue;

        inspectExportedDeclaration(
            line,
            i,
            masked,
            violations,
            EXPORT_FN_RE,
            BLOCK_OR_SEMI_RE,
            FN_RETURN_TYPE_SUFFIX_RE,
            false,
        );
        inspectExportedDeclaration(
            line,
            i,
            masked,
            violations,
            EXPORT_CONST_ARROW_RE,
            ARROW_BODY_RE,
            ARROW_RETURN_TYPE_SUFFIX_RE,
            true,
        );
    }
}
