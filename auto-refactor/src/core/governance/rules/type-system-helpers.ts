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
import { REGEX } from '../../constants';

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

/** Opening parenthesis character set for function signature scanning. */
const OPEN_PAREN_CHARS: ReadonlySet<string> = new Set(['(']);

/** Export keywords targeted by exported declaration return-type enforcement. */
const EXPORT_KEYWORDS: ReadonlySet<string> = new Set(['export']);

/**
 * Evaluates whether a string contains an opening parenthesis character using Set lookup.
 */
function containsOpenParen(part: string): boolean {
    for (let k = 0; k < part.length; k++) {
        if (OPEN_PAREN_CHARS.has(part[k])) return true;
    }
    return false;
}

/**
 * Evaluates whether a line contains an export keyword token using Set lookup.
 */
function lineHasExportKeyword(line: string): boolean {
    if (!line.includes('export')) return false;
    const tokens = line.split(/[^a-zA-Z0-9_$]+/);
    for (let i = 0; i < tokens.length; i++) {
        if (EXPORT_KEYWORDS.has(tokens[i])) return true;
    }
    return false;
}

const MAX_SIGNATURE_SCAN_LINES = 40;

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
    const matchResult = line.match(REGEX.SYNTAX.GDSCRIPT_WEAK_VAR);
    if (!matchResult) return;

    const rhs = line.slice((matchResult.index ?? 0) + matchResult[0].length).trim();
    const isVariantAmbiguous =
        REGEX.SYNTAX.GDSCRIPT_VARIANT_RHS.test(rhs) ||
        REGEX.SYNTAX.GDSCRIPT_DICT_GET.test(rhs) ||
        REGEX.SYNTAX.GDSCRIPT_VARIANT_CALL.test(rhs) ||
        (REGEX.SYNTAX.GDSCRIPT_COLLECTION_ACCESS.test(rhs) &&
            !REGEX.SYNTAX.GDSCRIPT_NON_VARIANT_SINGLETONS.test(rhs));
    if (isVariantAmbiguous) return;

    violations.push({
        ruleId: RULE_ID_GOV_TYP_001,
        message: `Variable \`${matchResult[1]}\`: ${MSG_EXPLICIT_TYPING}`,
        line: lineIndex + 1,
        column: (matchResult.index ?? 0) + 1,
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
    for (let charIndex = 0; charIndex < codePart.length; charIndex++) {
        const char = codePart[charIndex];
        if (char === '(' || char === '[' || char === '{') delta++;
        else if (char === ')' || char === ']' || char === '}') delta--;
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
        const currentLine = lines[j];
        const hashIdx = currentLine.search(/#/);
        const codePart = hashIdx >= 0 ? currentLine.slice(0, hashIdx) : currentLine;

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
        const match = REGEX.SYNTAX.PYTHON_FUNC_START.exec(line);
        if (!match) continue;

        const funcName = match[1];
        const { sigText, matchedEnd, endLine } = parsePythonFunctionSignature(lines, i);
        if (!matchedEnd) continue;

        i = endLine;
        if (!REGEX.SYNTAX.PYTHON_RETURN_TYPE.test(sigText)) {
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
    const matchResult = signatureLine.match(REGEX.SYNTAX.GDSCRIPT_FUNC_NO_RETURN);
    if (matchResult && !matchResult[1].startsWith('_')) {
        return {
            ruleId: RULE_ID_GOV_TYP_002,
            message: `Function \`${matchResult[1]}\` lacks explicit return type annotation (\`-> Type\`).`,
            line: startLine,
            column: matchResult.index != null ? matchResult.index + 1 : 1,
            suggestion: `Add explicit return type: \`func ${matchResult[1]}(...) -> void:\` or appropriate type.`,
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
        if (!line.includes('any') || !REGEX.SYNTAX.TS_ANY_KEYWORD.test(line)) continue;
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (REGEX.SYNTAX.TS_ANY_TYPE.test(line) && !REGEX.COMMENT.ESLINT_DISABLE.test(line)) {
            violations.push({
                ruleId: RULE_ID_GOV_TYP_003,
                message:
                    'Avoid naked `any` type annotations; prefer `unknown` or specific union types.',
                line: i + 1,
                column: line.search(REGEX.SYNTAX.TS_ANY_TYPE) + 1,
                suggestion:
                    'Replace with a strongly-typed interface, generic parameter, or `unknown`.',
                fixable: false,
            });
        }
    }
}

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
        if (containsOpenParen(part)) foundParen = true;
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
        if (!lineHasExportKeyword(line)) continue;
        const hasFn = line.includes('function');
        const hasConst = line.includes('const');
        if (!hasFn && !hasConst) continue;
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (REGEX.COMMENT.ESLINT_DISABLE.test(line)) continue;

        if (hasFn) {
            inspectExportedDeclaration(
                line,
                i,
                masked,
                violations,
                REGEX.SYNTAX.TS_EXPORT_FN,
                REGEX.SYNTAX.BLOCK_OR_SEMI,
                REGEX.SYNTAX.TS_FN_RETURN_TYPE_SUFFIX,
                false,
            );
        }
        if (hasConst) {
            inspectExportedDeclaration(
                line,
                i,
                masked,
                violations,
                REGEX.SYNTAX.TS_EXPORT_CONST_ARROW,
                REGEX.SYNTAX.ARROW_BODY,
                REGEX.SYNTAX.TS_ARROW_RETURN_TYPE_SUFFIX,
                true,
            );
        }
    }
}
