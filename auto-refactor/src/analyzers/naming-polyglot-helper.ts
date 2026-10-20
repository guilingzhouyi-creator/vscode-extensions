/**
 * Module: Static Analysis — Polyglot Naming Source Auditor
 * File Path: src/analyzers/naming-polyglot-helper.ts
 * Architecture Role: Modular line scanner auditing function naming, verb-noun contract,
 *   length boundaries, and morpheme phonetic constraints across Go, Rust, and GDScript.
 * Dependencies & Triggers: Consumed by NamingAnalyzer when processing .go, .rs, or .gd files.
 * Responsibilities:
 *   1. Extract function declarations from Go, Rust, and GDScript files;
 *   2. Tokenize function names and evaluate verb-noun contract and word segment envelopes;
 *   3. Enforce length constraints, phonetic morpheme rules, and anti-jargon discipline;
 *   4. Honor domain-specific conventions (e.g. Go exported methods, Rust traits, Godot hooks).
 * Exit Semantics & Design Rationale: Pure functional helper returning Issue[]; zero side effects.
 */

import type { AnalyzerContext, Issue, Severity } from '../core/types';
import { SEVERITY_WARNING } from '../core/types';
import { auditFunctionSemantics, hasTransientJargon } from './naming-path-helper';
import { DEFAULT_VAGUE_BLACKLIST } from './naming-ast-helper';
import type { NamingOptions } from './naming';

/**
 * Diagnostic record payload for polyglot language naming findings.
 */
export interface PolyglotFindingInput {
    readonly line: number;
    readonly column: number;
    readonly rule: string;
    readonly message: string;
    readonly severity: Severity;
    readonly detail: Record<string, unknown>;
    readonly suggestion?: string;
}

/**
 * Factory callback converting a structured polyglot finding into a standardized issue record.
 */
export type IssueFactory = (finding: PolyglotFindingInput) => Issue;

/**
 * Execution context carrying options, context, and issue accumulator for polyglot audits.
 */
export interface PolyglotNamingContext {
    readonly opts: NamingOptions;
    readonly ctx: AnalyzerContext;
    readonly mkIssue: IssueFactory;
    readonly issues: Issue[];
}

/**
 * Target descriptor for an extracted polyglot function declaration.
 */
export interface ExtractedFunctionTarget {
    readonly fnName: string;
    readonly lineIdx: number;
    readonly isSnake: boolean;
}

const MIN_POLYGLOT_FUNCTION_LENGTH = 3;
const MAX_POLYGLOT_FUNCTION_LENGTH = 50;

const BENCHMARK_PREFIX = 'Benchmark';
const FUZZ_PREFIX = 'Fuzz';
const EXAMPLE_PREFIX = 'Example';
const CAMEL_TO_SNAKE_PATTERN = '$1_$2';

const GO_FUNC_RE = /^func\s+(?:\([^)]+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*\(/;
const RUST_FN_PREFIX = '^\\s*(?:pub(?:\\s*\\([^)]*\\))?\\s+)?(?:const\\s+)?';
const RUST_FN_SUFFIX =
    '(?:async\\s+)?(?:unsafe\\s+)?(?:extern(?:\\s*"[^"]*")?\\s+)?fn\\s+([a-zA-Z_][a-zA-Z0-9_]*)';
const RUST_FN_RE = new RegExp(RUST_FN_PREFIX + RUST_FN_SUFFIX);
const RUST_TYPE_RE =
    /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([a-zA-Z_][a-zA-Z0-9_]*)/;
const RUST_CONST_RE =
    /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:const|static)\s+(?:mut\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*:/;
const RUST_LET_RE =
    /^\s*let\s+(?:mut\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::[^=]+)?\s*=/;
const RUST_FOR_RE = /^\s*for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\b/;
const RUST_TUPLE_LET_RE =
    /^\s*let\s+(?:mut\s+)?\(([a-zA-Z0-9_,\s]+)\)\s*(?::[^=]+)?\s*=/;
const GDSCRIPT_FUNC_RE = /^\s*(?:static\s+)?func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;

const GO_EXEMPT_NAMES = new Set([
    'init',
    'main',
    'String',
    'Error',
    'Read',
    'Write',
    'Close',
    'ServeHTTP',
    'MarshalJSON',
    'UnmarshalJSON',
]);

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

const GDSCRIPT_LIFECYCLE_NAMES = new Set([
    '_ready',
    '_process',
    '_physics_process',
    '_input',
    '_unhandled_input',
    '_draw',
    '_enter_tree',
    '_exit_tree',
    '_init',
    '_gui_input',
]);

function isGoFunctionExempt(name: string): boolean {
    if (GO_EXEMPT_NAMES.has(name)) return true;
    return (
        name.startsWith('Test') ||
        name.startsWith(BENCHMARK_PREFIX) ||
        name.startsWith(FUZZ_PREFIX) ||
        name.startsWith(EXAMPLE_PREFIX)
    );
}

function isRustFunctionExempt(name: string): boolean {
    return RUST_EXEMPT_NAMES.has(name) ? true : name.startsWith('test_');
}

function isGDScriptFunctionExempt(name: string): boolean {
    return GDSCRIPT_LIFECYCLE_NAMES.has(name) ? true : name.startsWith('test_');
}

/**
 * Splits an identifier name into discrete word morphemes for polyglot functions.
 */
function splitPolyglotNameTokens(name: string, isSnake: boolean): string[] {
    if (isSnake) {
        return name.split('_').filter(Boolean);
    }
    return name
        .replace(/([a-z0-9])([A-Z])/g, CAMEL_TO_SNAKE_PATTERN)
        .split('_')
        .filter(Boolean);
}

/**
 * Validates identifier character length against minimum and maximum thresholds.
 *
 * @returns True if length bounds were violated and reported.
 */
function auditFunctionLengthBounds(
    fnName: string,
    lineIdx: number,
    pCtx: PolyglotNamingContext,
): boolean {
    if (pCtx.opts.checkLengths === false) return false;

    const minLen = pCtx.opts.minFunctionLength ?? MIN_POLYGLOT_FUNCTION_LENGTH;
    const maxLen = pCtx.opts.maxFunctionLength ?? MAX_POLYGLOT_FUNCTION_LENGTH;

    if (fnName.length < minLen) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-LEN-002',
                message:
                    `Function name '${fnName}' is too short (< ${minLen} characters); ` +
                    'lacks description.',
                severity: SEVERITY_WARNING,
                detail: { name: fnName, length: fnName.length, minLen },
                suggestion: `Rename '${fnName}' to a descriptive phrase with >= ${minLen} characters.`,
            }),
        );
        return true;
    }

    if (fnName.length > maxLen) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-LEN-002',
                message:
                    `Function name '${fnName}' is too long (> ${maxLen} characters); ` +
                    'decompose responsibilities.',
                severity: SEVERITY_WARNING,
                detail: { name: fnName, length: fnName.length, maxLen },
                suggestion: `Refactor '${fnName}' into a concise identifier with <= ${maxLen} characters.`,
            }),
        );
        return true;
    }

    return false;
}

function auditExtractedFunction(
    target: ExtractedFunctionTarget,
    pCtx: PolyglotNamingContext,
): void {
    const { fnName, lineIdx, isSnake } = target;

    if (pCtx.opts.checkJargon !== false && hasTransientJargon(fnName)) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-JRG-002',
                message: `Function name '${fnName}' contains transient construction jargon.`,
                severity: SEVERITY_WARNING,
                detail: { name: fnName },
                suggestion: 'Replace transient process markers with semantic domain naming.',
            }),
        );
    }

    if (auditFunctionLengthBounds(fnName, lineIdx, pCtx)) {
        return;
    }

    const tokens = splitPolyglotNameTokens(fnName, isSnake);
    const finding = auditFunctionSemantics(fnName, tokens, pCtx.opts);
    if (!finding) return;

    pCtx.issues.push(
        pCtx.mkIssue({
            line: lineIdx + 1,
            column: 1,
            rule: 'NAM-LEN-002',
            message: finding.message,
            severity: SEVERITY_WARNING,
            detail: { name: fnName, findingType: finding.type },
            suggestion: `Align function name '${fnName}' with semantic word and morpheme conventions.`,
        }),
    );
}

function auditRustType(
    typeName: string,
    lineIdx: number,
    pCtx: PolyglotNamingContext,
): void {
    if (pCtx.opts.checkTypes !== false && !/^[A-Z][a-zA-Z0-9]*$/.test(typeName)) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-TYP-001',
                message: `Type or struct definition '${typeName}' should follow PascalCase.`,
                severity: SEVERITY_WARNING,
                detail: { name: typeName },
                suggestion: `Rename '${typeName}' to PascalCase naming convention.`,
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
            }),
        );
    }
}

function auditRustConstant(
    constName: string,
    lineIdx: number,
    pCtx: PolyglotNamingContext,
): void {
    if (pCtx.opts.checkGlobals !== false && !/^[A-Z][A-Z0-9_]*$/.test(constName)) {
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
            }),
        );
    }
}

function auditRustVariable(
    varName: string,
    lineIdx: number,
    inTest: boolean,
    pCtx: PolyglotNamingContext,
): void {
    if (inTest) return;

    if (pCtx.opts.checkSingleLetters !== false) {
        if (
            varName.length === 1 &&
            /^[a-zA-Z]$/.test(varName) &&
            varName !== '_' &&
            varName !== 'i' &&
            varName !== 'j' &&
            varName !== 'k'
        ) {
            pCtx.issues.push(
                pCtx.mkIssue({
                    line: lineIdx + 1,
                    column: 1,
                    rule: 'NAM-SGL-001',
                    message: `Single-letter variable name '${varName}' hurts code readability.`,
                    severity: SEVERITY_WARNING,
                    detail: { name: varName },
                    suggestion:
                        `Rename '${varName}' to descriptive identifier; only 'i','j','k','_' tolerated.`,
                }),
            );
        }
    }

    if (pCtx.opts.checkVagueNames !== false) {
        const vagueSet = pCtx.opts.vagueBlacklist
            ? new Set(pCtx.opts.vagueBlacklist)
            : DEFAULT_VAGUE_BLACKLIST;
        if (vagueSet.has(varName.toLowerCase())) {
            pCtx.issues.push(
                pCtx.mkIssue({
                    line: lineIdx + 1,
                    column: 1,
                    rule: 'NAM-VAG-001',
                    message:
                        `Identifier '${varName}' is vague and uninformative; ` +
                        'lacks domain context.',
                    severity: SEVERITY_WARNING,
                    detail: { name: varName },
                    suggestion: `Replace '${varName}' with a domain-qualified identifier.`,
                }),
            );
        }
    }

    if (pCtx.opts.checkJargon !== false && hasTransientJargon(varName)) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-JRG-002',
                message:
                    `Variable identifier '${varName}' contains ` +
                    'transient construction jargon.',
                severity: SEVERITY_WARNING,
                detail: { name: varName },
                suggestion: 'Replace transient process markers with semantic domain naming.',
            }),
        );
    }
}

function auditRustLineVariables(
    line: string,
    lineIdx: number,
    inTestScope: boolean,
    pCtx: PolyglotNamingContext,
): void {
    const letMatch = RUST_LET_RE.exec(line);
    if (letMatch) {
        auditRustVariable(letMatch[1], lineIdx, inTestScope, pCtx);
    }

    const forMatch = RUST_FOR_RE.exec(line);
    if (forMatch) {
        auditRustVariable(forMatch[1], lineIdx, inTestScope, pCtx);
    }

    const tupleMatch = RUST_TUPLE_LET_RE.exec(line);
    if (tupleMatch) {
        const tupleMembers = tupleMatch[1].split(',');
        for (const member of tupleMembers) {
            const cleaned = member.trim().replace(/^mut\s+/, '');
            if (cleaned) {
                auditRustVariable(cleaned, lineIdx, inTestScope, pCtx);
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

type PolyglotLineAuditor = (line: string, lineIndex: number) => void;

function createPolyglotLineAuditor(
    ext: string,
    pCtx: PolyglotNamingContext,
): PolyglotLineAuditor | null {
    if (ext === '.go') {
        return (line, i) => {
            const match = GO_FUNC_RE.exec(line);
            if (match && !isGoFunctionExempt(match[1])) {
                auditExtractedFunction({ fnName: match[1], lineIdx: i, isSnake: false }, pCtx);
            }
        };
    }
    if (ext === '.rs') {
        let isNextFnTest = false;
        let braceDepth = 0;
        let testFunctionDepth = -1;
        let testModuleDepth = -1;

        return (line, i) => {
            const trimmed = line.trim();
            const codeOnly = trimmed.split('//')[0];
            const openBraces = (codeOnly.match(/\{/g) || []).length;
            const closeBraces = (codeOnly.match(/\}/g) || []).length;

            if (trimmed.startsWith('#[cfg(test)]')) {
                testModuleDepth = braceDepth;
                return;
            }
            if (
                trimmed.startsWith('#[test]') ||
                trimmed.startsWith('#[tokio::test]') ||
                trimmed.startsWith('#[rstest]')
            ) {
                isNextFnTest = true;
                return;
            }

            const fnMatch = RUST_FN_RE.exec(line);
            if (fnMatch) {
                const isTest =
                    testModuleDepth >= 0 ||
                    isNextFnTest ||
                    isRustFunctionExempt(fnMatch[1]);
                isNextFnTest = false;
                if (isTest) {
                    testFunctionDepth = braceDepth;
                } else {
                    auditExtractedFunction(
                        { fnName: fnMatch[1], lineIdx: i, isSnake: true },
                        pCtx,
                    );
                }
            } else if (
                trimmed.length > 0 &&
                !trimmed.startsWith('//') &&
                !trimmed.startsWith('#[')
            ) {
                isNextFnTest = false;
            }

            const inTestScope = testFunctionDepth >= 0 || testModuleDepth >= 0;

            if (!inTestScope) {
                auditRustLineDeclarations(line, i, pCtx);
            }

            auditRustLineVariables(line, i, inTestScope, pCtx);

            braceDepth += openBraces - closeBraces;
            if (braceDepth < 0) braceDepth = 0;
            if (testFunctionDepth >= 0 && braceDepth <= testFunctionDepth) {
                testFunctionDepth = -1;
            }
            if (testModuleDepth >= 0 && braceDepth <= testModuleDepth) {
                testModuleDepth = -1;
            }
        };
    }
    if (ext === '.gd') {
        return (line, i) => {
            const match = GDSCRIPT_FUNC_RE.exec(line);
            if (match && !isGDScriptFunctionExempt(match[1])) {
                auditExtractedFunction({ fnName: match[1], lineIdx: i, isSnake: true }, pCtx);
            }
        };
    }
    return null;
}

/**
 * Audit Go, Rust, or GDScript source lines for naming conventions and semantic contracts.
 *
 * @param content - Raw source file content.
 * @param ext - Normalized file extension (.go, .rs, .gd).
 * @param pCtx - Polyglot naming execution context.
 */
export function auditPolyglotSource(
    content: string,
    ext: string,
    pCtx: PolyglotNamingContext,
): void {
    const auditor = createPolyglotLineAuditor(ext, pCtx);
    if (!auditor) return;

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line) {
            auditor(line, i);
        }
    }
}
