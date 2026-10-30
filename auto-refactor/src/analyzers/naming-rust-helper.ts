/**
 * Module: Static Analysis — Polyglot Rust Naming Line Auditor
 * File Path: src/analyzers/naming-rust-helper.ts
 * Architecture Role: Modular line scanner auditing Rust functions, types, constants,
 *   and let/for binding declarations for naming conventions, test exemptions, and AAS payloads.
 * Dependencies & Triggers: Consumed by NamingPolyglotHelper when scanning .rs source files.
 * Responsibilities:
 *   1. Track Rust test attributes (#[test], #[tokio::test], #[cfg(test)]) and module brace depths;
 *   2. Audit Rust struct, enum, and trait names for PascalCase (NAM-TYP-001) and anti-jargon;
 *   3. Audit Rust const and static items for UPPER_SNAKE_CASE (NAM-GLB-001) and anti-jargon;
 *   4. Audit Rust let, tuple, and for bindings for single-letter guards, lengths, and vague tokens;
 *   5. Attach structured AAS v1.0 actionable replacement proposals to all findings.
 * Exit Semantics & Design Rationale: Pure functional helper that pushes findings into the
 *   PolyglotNamingContext; no I/O, no module state.
 */

import { SEVERITY_WARNING } from '../core/types';
import { hasTransientJargon } from './naming-path-helper';
import type { PolyglotNamingContext } from './naming-polyglot-helper';
import { REGEX } from '../core/constants';
import { calculateBraceDelta } from '../core/ast/block-scope-utils';
import {
    auditExtractedFunction,
    auditPolyglotVariable,
    buildPolyglotActionable,
    toPascalCase,
    toUpperSnakeCase,
} from './naming-polyglot-helper';

const RUST_FN_RE = REGEX.RUST.FN;
const RUST_TYPE_RE = REGEX.RUST.TYPE;
const RUST_CONST_RE = REGEX.RUST.CONST;
const RUST_LET_RE = REGEX.RUST.LET;
const RUST_FOR_RE = REGEX.RUST.FOR;
const RUST_TUPLE_LET_RE = REGEX.RUST.TUPLE_LET;

const RUST_EXEMPT_NAMES = new Set([
    'main',
    'new',
    'default',
    'from',
    'into',
    'fmt',
    'drop',
    'clone',
    'eq',
    'cmp',
    'hash',
]);

const RUST_TEST_MODULE_ATTR = '#[cfg(test)]';
const RUST_TEST_FN_ATTRS: readonly string[] = Object.freeze([
    '#[test]',
    '#[tokio::test]',
    '#[rstest]',
]);
const RUST_ATTR_PREFIX = '#[';
const RUST_LINE_COMMENT = '//';

/**
 * Mutable brace/test-scope state threaded across Rust source lines.
 */
export interface RustLineScanState {
    isNextFnTest: boolean;
    braceDepth: number;
    testFunctionDepth: number;
    testModuleDepth: number;
}

function isRustFunctionExempt(name: string): boolean {
    return RUST_EXEMPT_NAMES.has(name) ? true : name.startsWith('test_');
}

function auditRustType(typeName: string, lineIdx: number, pCtx: PolyglotNamingContext): void {
    if (pCtx.opts.checkTypes !== false && !/^[A-Z][a-zA-Z0-9]*$/.test(typeName)) {
        const suggested = toPascalCase(typeName);
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-TYP-001',
                message: `Type or struct definition '${typeName}' should follow PascalCase.`,
                severity: SEVERITY_WARNING,
                detail: { name: typeName },
                suggestion: `Rename '${typeName}' to PascalCase naming convention.`,
                actionable: buildPolyglotActionable(
                    typeName,
                    'NAM-TYP-001',
                    lineIdx + 1,
                    1,
                    suggested,
                ),
            }),
        );
    }
    if (pCtx.opts.checkJargon !== false && hasTransientJargon(typeName)) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-JRG-002',
                message: `Type identifier '${typeName}' contains transient construction jargon.`,
                severity: SEVERITY_WARNING,
                detail: { name: typeName },
                suggestion: 'Replace transient process markers with semantic domain naming.',
                actionable: buildPolyglotActionable(typeName, 'NAM-JRG-002', lineIdx + 1, 1),
            }),
        );
    }
}

function auditRustConstant(constName: string, lineIdx: number, pCtx: PolyglotNamingContext): void {
    if (pCtx.opts.checkGlobals !== false && !/^[A-Z][A-Z0-9_]*$/.test(constName)) {
        const suggested = toUpperSnakeCase(constName);
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-GLB-001',
                message:
                    `Top-level constant or static '${constName}' ` +
                    'should follow UPPER_SNAKE_CASE.',
                severity: SEVERITY_WARNING,
                detail: { name: constName },
                suggestion: `Rename '${constName}' to an uppercase snake_case constant.`,
                actionable: buildPolyglotActionable(
                    constName,
                    'NAM-GLB-001',
                    lineIdx + 1,
                    1,
                    suggested,
                ),
            }),
        );
    }
    if (pCtx.opts.checkJargon !== false && hasTransientJargon(constName)) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-JRG-002',
                message:
                    `Constant identifier '${constName}' contains ` +
                    'transient construction jargon.',
                severity: SEVERITY_WARNING,
                detail: { name: constName },
                suggestion: 'Replace transient process markers with semantic domain naming.',
                actionable: buildPolyglotActionable(constName, 'NAM-JRG-002', lineIdx + 1, 1),
            }),
        );
    }
}

function auditRustVariable(
    varName: string,
    lineIdx: number,
    inTest: boolean,
    inLoop: boolean,
    pCtx: PolyglotNamingContext,
): void {
    auditPolyglotVariable(varName, lineIdx, inTest, inLoop, pCtx, 'rust');
}

function auditRustLineVariables(
    line: string,
    lineIdx: number,
    inTestScope: boolean,
    pCtx: PolyglotNamingContext,
): void {
    const letMatch = RUST_LET_RE.exec(line);
    if (letMatch) {
        auditRustVariable(letMatch[1], lineIdx, inTestScope, false, pCtx);
    }

    const forMatch = RUST_FOR_RE.exec(line);
    if (forMatch) {
        auditRustVariable(forMatch[1], lineIdx, inTestScope, true, pCtx);
    }

    const tupleMatch = RUST_TUPLE_LET_RE.exec(line);
    if (tupleMatch) {
        const tupleMembers = tupleMatch[1].split(',');
        for (const member of tupleMembers) {
            const cleaned = member.trim().replace(/^mut\s+/, '');
            if (cleaned) {
                auditRustVariable(cleaned, lineIdx, inTestScope, false, pCtx);
            }
        }
    }
}

function auditRustLineDeclarations(
    line: string,
    lineIdx: number,
    pCtx: PolyglotNamingContext,
): void {
    const typeMatch = RUST_TYPE_RE.exec(line);
    if (typeMatch) {
        auditRustType(typeMatch[1], lineIdx, pCtx);
    }

    const constMatch = RUST_CONST_RE.exec(line);
    if (constMatch) {
        auditRustConstant(constMatch[1], lineIdx, pCtx);
    }
}

function startsWithAnyPrefix(line: string, prefixes: readonly string[]): boolean {
    for (let i = 0; i < prefixes.length; i++) {
        if (line.startsWith(prefixes[i])) return true;
    }
    return false;
}

function applyRustTestAttribute(trimmed: string, state: RustLineScanState): boolean {
    if (trimmed.startsWith(RUST_TEST_MODULE_ATTR)) {
        state.testModuleDepth = state.braceDepth;
        return true;
    }
    if (startsWithAnyPrefix(trimmed, RUST_TEST_FN_ATTRS)) {
        state.isNextFnTest = true;
        return true;
    }
    return false;
}

function handleRustFunctionLine(
    line: string,
    lineIndex: number,
    trimmed: string,
    state: RustLineScanState,
    pCtx: PolyglotNamingContext,
): void {
    const fnMatch = RUST_FN_RE.exec(line);
    if (!fnMatch) {
        const isCodeLine =
            trimmed.length > 0 &&
            !trimmed.startsWith(RUST_LINE_COMMENT) &&
            !trimmed.startsWith(RUST_ATTR_PREFIX);
        if (isCodeLine) state.isNextFnTest = false;
        return;
    }

    const isTest =
        state.testModuleDepth >= 0 || state.isNextFnTest || isRustFunctionExempt(fnMatch[1]);
    state.isNextFnTest = false;
    if (isTest) {
        state.testFunctionDepth = state.braceDepth;
        return;
    }
    auditExtractedFunction({ fnName: fnMatch[1], lineIdx: lineIndex, isSnake: true }, pCtx);
}

function advanceRustBraceDepth(trimmed: string, state: RustLineScanState): void {
    const codeOnly = trimmed.split(RUST_LINE_COMMENT)[0];
    state.braceDepth += calculateBraceDelta(codeOnly);
    if (state.braceDepth < 0) state.braceDepth = 0;
    if (state.testFunctionDepth >= 0 && state.braceDepth <= state.testFunctionDepth) {
        state.testFunctionDepth = -1;
    }
    if (state.testModuleDepth >= 0 && state.braceDepth <= state.testModuleDepth) {
        state.testModuleDepth = -1;
    }
}

/**
 * Audit one Rust source line: attributes first, then declarations and variables.
 *
 * @param line - Raw source line.
 * @param lineIndex - Zero-based line index for diagnostics.
 * @param state - Rust scan state to mutate.
 * @param pCtx - Polyglot naming execution context.
 */
export function scanRustLine(
    line: string,
    lineIndex: number,
    state: RustLineScanState,
    pCtx: PolyglotNamingContext,
): void {
    const trimmed = line.trim();
    if (applyRustTestAttribute(trimmed, state)) return;

    handleRustFunctionLine(line, lineIndex, trimmed, state, pCtx);

    const inTestScope = state.testFunctionDepth >= 0 || state.testModuleDepth >= 0;
    if (!inTestScope) {
        auditRustLineDeclarations(line, lineIndex, pCtx);
    }
    auditRustLineVariables(line, lineIndex, inTestScope, pCtx);

    advanceRustBraceDepth(trimmed, state);
}
