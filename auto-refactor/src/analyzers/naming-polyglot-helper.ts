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
const RUST_LET_RE = /^\s*let\s+(?:mut\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::[^=]+)?\s*=/;
const RUST_FOR_RE = /^\s*for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\b/;
const RUST_TUPLE_LET_RE = /^\s*let\s+(?:mut\s+)?\(([a-zA-Z0-9_,\s]+)\)\s*(?::[^=]+)?\s*=/;
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

function auditRustType(typeName: string, lineIdx: number, pCtx: PolyglotNamingContext): void {
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

function auditRustConstant(constName: string, lineIdx: number, pCtx: PolyglotNamingContext): void {
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

/** Single-letter identifiers that carry conventional loop or discard meaning. */
const TOLERATED_SINGLE_LETTERS: ReadonlySet<string> = new Set(['_', 'i', 'j', 'k']);
/** Pattern matching exactly one ASCII letter. */
const SINGLE_LETTER_RE = /^[a-zA-Z]$/;

/**
 * Resolve whether a one-character name is an untolerated single letter.
 *
 * @param varName - Candidate identifier.
 * @returns `true` only for single ASCII letters outside the `_`/`i`/`j`/`k` allowlist.
 */
function isUntoleratedSingleLetter(varName: string): boolean {
    if (varName.length !== 1 || !SINGLE_LETTER_RE.test(varName)) return false;
    return !TOLERATED_SINGLE_LETTERS.has(varName);
}

/**
 * Resolve the vague-name blacklist for the current run, preferring the caller override.
 *
 * @param pCtx - Polyglot naming execution context.
 * @returns The configured blacklist, or the shared default when unset.
 */
function resolveVagueBlacklist(pCtx: PolyglotNamingContext): ReadonlySet<string> {
    return pCtx.opts.vagueBlacklist ? new Set(pCtx.opts.vagueBlacklist) : DEFAULT_VAGUE_BLACKLIST;
}

function auditRustVariable(
    varName: string,
    lineIdx: number,
    inTest: boolean,
    pCtx: PolyglotNamingContext,
): void {
    if (inTest) return;

    if (pCtx.opts.checkSingleLetters !== false && isUntoleratedSingleLetter(varName)) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-SGL-001',
                message: `Single-letter variable name '${varName}' hurts code readability.`,
                severity: SEVERITY_WARNING,
                detail: { name: varName },
                suggestion: `Rename '${varName}' to descriptive identifier; only 'i','j','k','_' tolerated.`,
            }),
        );
    }

    const vagueCheckEnabled = pCtx.opts.checkVagueNames !== false;
    const isVague = vagueCheckEnabled && resolveVagueBlacklist(pCtx).has(varName.toLowerCase());
    if (isVague) {
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

    if (pCtx.opts.checkJargon !== false && hasTransientJargon(varName)) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-JRG-002',
                message:
                    `Variable identifier '${varName}' contains ` + 'transient construction jargon.',
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

/** Rust attribute marking an entire inline test module. */
const RUST_TEST_MODULE_ATTR = '#[cfg(test)]';
/** Rust attributes marking the next `fn` as a test function. */
const RUST_TEST_FN_ATTRS: readonly string[] = Object.freeze([
    '#[test]',
    '#[tokio::test]',
    '#[rstest]',
]);
/** Attribute prefix excluded from "real code line" detection so markers survive. */
const RUST_ATTR_PREFIX = '#[';
/** Line comment marker stripped before counting braces. */
const RUST_LINE_COMMENT = '//';
/** Brace counters; `String#match` with a global regex ignores `lastIndex`. */
const RUST_OPEN_BRACE_RE = /\{/g;
const RUST_CLOSE_BRACE_RE = /\}/g;

/**
 * Mutable brace/test-scope state threaded across Rust source lines.
 */
interface RustLineScanState {
    isNextFnTest: boolean;
    braceDepth: number;
    testFunctionDepth: number;
    testModuleDepth: number;
}

/**
 * Tests whether a line starts with any prefix from a frozen list.
 *
 * @param line - Trimmed source line.
 * @param prefixes - Frozen prefix table.
 * @returns `true` on the first matching prefix.
 */
function startsWithAnyPrefix(line: string, prefixes: readonly string[]): boolean {
    for (let i = 0; i < prefixes.length; i++) {
        if (line.startsWith(prefixes[i])) return true;
    }
    return false;
}

/**
 * Apply a test-scope attribute line to the scan state.
 *
 * @param trimmed - Trimmed source line.
 * @param state - Rust scan state to mutate.
 * @returns `true` when the line is an attribute and must not be audited as code.
 */
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

/**
 * Audit or classify a Rust function declaration line.
 *
 * @param line - Raw source line, used for the anchored `fn` pattern.
 * @param lineIndex - Zero-based line index for diagnostics.
 * @param trimmed - Trimmed source line, used for the "real code" reset heuristic.
 * @param state - Rust scan state to mutate.
 * @param pCtx - Polyglot naming execution context.
 */
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

/**
 * Advance brace depth and close any test scopes that the line ended.
 *
 * @param trimmed - Trimmed source line.
 * @param state - Rust scan state to mutate.
 */
function advanceRustBraceDepth(trimmed: string, state: RustLineScanState): void {
    const codeOnly = trimmed.split(RUST_LINE_COMMENT)[0];
    const openBraces = (codeOnly.match(RUST_OPEN_BRACE_RE) || []).length;
    const closeBraces = (codeOnly.match(RUST_CLOSE_BRACE_RE) || []).length;

    state.braceDepth += openBraces - closeBraces;
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
function scanRustLine(
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
        const state: RustLineScanState = {
            isNextFnTest: false,
            braceDepth: 0,
            testFunctionDepth: -1,
            testModuleDepth: -1,
        };
        return (line, i) => scanRustLine(line, i, state, pCtx);
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
