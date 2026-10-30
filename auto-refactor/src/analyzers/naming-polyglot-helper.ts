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
import { camelToSnake, REGEX } from '../core/constants';
import { auditFunctionSemantics, hasTransientJargon } from './naming-path-helper';
import { DEFAULT_VAGUE_BLACKLIST } from './naming-ast-helper';
import { scanRustLine, type RustLineScanState } from './naming-rust-helper';
import {
    ALLOWED_SHORT_NAMES,
    MAX_VARIABLE_NAME_LENGTH,
    MAX_FUNCTION_NAME_LENGTH,
    COMMON_ABBREVIATIONS,
    ACTION_REPLACE_TOKEN,
    TAXONOMY_GOV_NORM,
    type NamingActionablePayload,
} from './naming-candidate-helper';
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
    readonly actionable?: NamingActionablePayload;
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
const MIN_POLYGLOT_VARIABLE_LENGTH = 3;

const BENCHMARK_PREFIX = 'Benchmark';
const FUZZ_PREFIX = 'Fuzz';
const EXAMPLE_PREFIX = 'Example';

export function toPascalCase(ident: string): string {
    return ident
        .split(/[_-]/)
        .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : ''))
        .join('');
}

export function toUpperSnakeCase(ident: string): string {
    return camelToSnake(ident).toUpperCase();
}

export function buildPolyglotActionable(
    name: string,
    rule: string,
    line: number,
    column: number,
    suggestedName?: string,
    safeToAutomate = false,
): NamingActionablePayload {
    const candidate = suggestedName ?? COMMON_ABBREVIATIONS[name];
    return {
        action: ACTION_REPLACE_TOKEN,
        code: rule,
        taxonomy: TAXONOMY_GOV_NORM,
        safeToAutomate,
        targetSymbol: candidate ?? name,
        patch: candidate
            ? {
                  range: {
                      startLine: line,
                      startCol: column,
                      endLine: line,
                      endCol: column + name.length,
                  },
                  replacementText: candidate,
              }
            : undefined,
        templateSnippet: candidate,
        targetArguments: {
            originalName: name,
            ...(candidate ? { suggestedName: candidate } : {}),
        },
    };
}

function extractCommaSeparatedNames(raw: string): string[] {
    const segments = raw.split(',');
    const names: string[] = [];
    for (let i = 0; i < segments.length; i++) {
        const cleaned = segments[i].trim();
        if (cleaned.length > 0) {
            names.push(cleaned);
        }
    }
    return names;
}

const GO_KEYWORDS = new Set([
    'break',
    'default',
    'func',
    'interface',
    'select',
    'case',
    'defer',
    'go',
    'map',
    'struct',
    'chan',
    'else',
    'goto',
    'package',
    'switch',
    'const',
    'fallthrough',
    'if',
    'range',
    'type',
    'continue',
    'for',
    'import',
    'return',
    'var',
]);

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
    return camelToSnake(name).split('_').filter(Boolean);
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
    const maxLen = pCtx.opts.maxFunctionLength ?? MAX_FUNCTION_NAME_LENGTH;

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
                actionable: buildPolyglotActionable(fnName, 'NAM-LEN-002', lineIdx + 1, 1),
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
                actionable: buildPolyglotActionable(fnName, 'NAM-LEN-002', lineIdx + 1, 1),
            }),
        );
        return true;
    }

    return false;
}

export function auditExtractedFunction(
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
                actionable: buildPolyglotActionable(fnName, 'NAM-JRG-002', lineIdx + 1, 1),
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
            actionable: buildPolyglotActionable(fnName, 'NAM-LEN-002', lineIdx + 1, 1),
        }),
    );
}

/** Single-letter identifiers that carry conventional loop or discard meaning. */
const TOLERATED_SINGLE_LETTERS: ReadonlySet<string> = new Set(['_', 'i', 'j', 'k']);

/**
 * Resolve whether a one-character name is an untolerated single letter.
 *
 * @param varName - Candidate identifier.
 * @returns `true` only for single ASCII letters outside the `_`/`i`/`j`/`k` allowlist.
 */
function isUntoleratedSingleLetter(varName: string): boolean {
    if (varName.length !== 1 || !REGEX.NAMING.SINGLE_LETTER.test(varName)) return false;
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

function auditVariableSingleLetterAndLength(
    varName: string,
    lineIdx: number,
    pCtx: PolyglotNamingContext,
    lang: 'rust' | 'go' | 'gdscript',
): void {
    if (pCtx.opts.checkSingleLetters !== false && isUntoleratedSingleLetter(varName)) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-SGL-001',
                message: `Single-letter variable name '${varName}' hurts code readability.`,
                severity: SEVERITY_WARNING,
                detail: { name: varName, lang },
                suggestion: `Rename '${varName}' to descriptive identifier; only 'i','j','k','_' tolerated.`,
                actionable: buildPolyglotActionable(varName, 'NAM-SGL-001', lineIdx + 1, 1),
            }),
        );
        return;
    }

    if (pCtx.opts.checkLengths === false) return;

    if (varName.length < MIN_POLYGLOT_VARIABLE_LENGTH) {
        const isAllowedShort =
            ALLOWED_SHORT_NAMES.has(varName) ||
            (pCtx.opts.allowedShortNames && pCtx.opts.allowedShortNames.includes(varName));
        if (!isAllowedShort) {
            pCtx.issues.push(
                pCtx.mkIssue({
                    line: lineIdx + 1,
                    column: 1,
                    rule: 'NAM-LEN-001',
                    message: `Variable name '${varName}' is too short (< ${MIN_POLYGLOT_VARIABLE_LENGTH} characters); lacks semantic clarity.`,
                    severity: SEVERITY_WARNING,
                    detail: {
                        name: varName,
                        length: varName.length,
                        minLen: MIN_POLYGLOT_VARIABLE_LENGTH,
                        lang,
                    },
                    suggestion: `Rename '${varName}' to a descriptive identifier with >= ${MIN_POLYGLOT_VARIABLE_LENGTH} characters.`,
                    actionable: buildPolyglotActionable(varName, 'NAM-LEN-001', lineIdx + 1, 1),
                }),
            );
        }
    } else if (varName.length > MAX_VARIABLE_NAME_LENGTH) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-LEN-001',
                message: `Variable name '${varName}' is excessively long (> ${MAX_VARIABLE_NAME_LENGTH} characters); decompose or simplify.`,
                severity: SEVERITY_WARNING,
                detail: {
                    name: varName,
                    length: varName.length,
                    maxLen: MAX_VARIABLE_NAME_LENGTH,
                    lang,
                },
                suggestion: `Refactor '${varName}' into a concise identifier with <= ${MAX_VARIABLE_NAME_LENGTH} characters.`,
                actionable: buildPolyglotActionable(varName, 'NAM-LEN-001', lineIdx + 1, 1),
            }),
        );
    }
}

function auditVariableVaguenessAndJargon(
    varName: string,
    lineIdx: number,
    pCtx: PolyglotNamingContext,
    lang: 'rust' | 'go' | 'gdscript',
): void {
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
                detail: { name: varName, lang },
                suggestion: `Replace '${varName}' with a domain-qualified identifier.`,
                actionable: buildPolyglotActionable(varName, 'NAM-VAG-001', lineIdx + 1, 1),
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
                detail: { name: varName, lang },
                suggestion: 'Replace transient process markers with semantic domain naming.',
                actionable: buildPolyglotActionable(varName, 'NAM-JRG-002', lineIdx + 1, 1),
            }),
        );
    }
}

export function auditPolyglotVariable(
    varName: string,
    lineIdx: number,
    inTest: boolean,
    inLoop: boolean,
    pCtx: PolyglotNamingContext,
    lang: 'rust' | 'go' | 'gdscript',
): void {
    if (inTest) return;
    auditVariableSingleLetterAndLength(varName, lineIdx, pCtx, lang);
    auditVariableVaguenessAndJargon(varName, lineIdx, pCtx, lang);
}

function auditGoType(typeName: string, lineIdx: number, pCtx: PolyglotNamingContext): void {
    if (
        pCtx.opts.checkTypes !== false &&
        (typeName.includes('_') || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(typeName))
    ) {
        const suggested = toPascalCase(typeName);
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-TYP-001',
                message: `Go type identifier '${typeName}' should follow PascalCase (or camelCase) without snake_case underscores.`,
                severity: SEVERITY_WARNING,
                detail: { name: typeName, lang: 'go' },
                suggestion: `Rename '${typeName}' to follow Go type naming conventions without underscores.`,
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
                detail: { name: typeName, lang: 'go' },
                suggestion: 'Replace transient process markers with semantic domain naming.',
                actionable: buildPolyglotActionable(typeName, 'NAM-JRG-002', lineIdx + 1, 1),
            }),
        );
    }
}

function auditGoConstant(constName: string, lineIdx: number, pCtx: PolyglotNamingContext): void {
    if (pCtx.opts.checkJargon !== false && hasTransientJargon(constName)) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-JRG-002',
                message: `Constant identifier '${constName}' contains transient construction jargon.`,
                severity: SEVERITY_WARNING,
                detail: { name: constName, lang: 'go' },
                suggestion: 'Replace transient process markers with semantic domain naming.',
                actionable: buildPolyglotActionable(constName, 'NAM-JRG-002', lineIdx + 1, 1),
            }),
        );
    }
    if (pCtx.opts.checkLengths !== false) {
        if (
            constName.length < MIN_POLYGLOT_VARIABLE_LENGTH &&
            !ALLOWED_SHORT_NAMES.has(constName)
        ) {
            pCtx.issues.push(
                pCtx.mkIssue({
                    line: lineIdx + 1,
                    column: 1,
                    rule: 'NAM-LEN-001',
                    message: `Constant identifier '${constName}' is too short (< ${MIN_POLYGLOT_VARIABLE_LENGTH} characters); lacks semantic clarity.`,
                    severity: SEVERITY_WARNING,
                    detail: {
                        name: constName,
                        length: constName.length,
                        minLen: MIN_POLYGLOT_VARIABLE_LENGTH,
                        lang: 'go',
                    },
                    suggestion: `Rename '${constName}' to a descriptive identifier with >= ${MIN_POLYGLOT_VARIABLE_LENGTH} characters.`,
                    actionable: buildPolyglotActionable(constName, 'NAM-LEN-001', lineIdx + 1, 1),
                }),
            );
        } else if (constName.length > MAX_VARIABLE_NAME_LENGTH) {
            pCtx.issues.push(
                pCtx.mkIssue({
                    line: lineIdx + 1,
                    column: 1,
                    rule: 'NAM-LEN-001',
                    message: `Constant identifier '${constName}' is excessively long (> ${MAX_VARIABLE_NAME_LENGTH} characters); decompose or simplify.`,
                    severity: SEVERITY_WARNING,
                    detail: {
                        name: constName,
                        length: constName.length,
                        maxLen: MAX_VARIABLE_NAME_LENGTH,
                        lang: 'go',
                    },
                    suggestion: `Refactor '${constName}' into a concise identifier with <= ${MAX_VARIABLE_NAME_LENGTH} characters.`,
                    actionable: buildPolyglotActionable(constName, 'NAM-LEN-001', lineIdx + 1, 1),
                }),
            );
        }
    }
}

interface GoLineScanState {
    braceDepth: number;
    testFunctionDepth: number;
}

function extractGoVariableBindings(line: string): { names: string[]; isLoop: boolean } | null {
    const forMatch = REGEX.SYNTAX.GO_FOR_DECL_LINE.exec(line);
    if (forMatch) {
        return { names: extractCommaSeparatedNames(forMatch[1]), isLoop: true };
    }
    const ifMatch = REGEX.SYNTAX.GO_IF_SHORT_DECL.exec(line);
    if (ifMatch) {
        return { names: extractCommaSeparatedNames(ifMatch[1]), isLoop: false };
    }
    const shortVarMatch = REGEX.SYNTAX.GO_SHORT_VAR_DECL.exec(line);
    if (shortVarMatch) {
        return { names: extractCommaSeparatedNames(shortVarMatch[1]), isLoop: false };
    }
    const varMatch = REGEX.SYNTAX.GO_VAR_DECL_LINE.exec(line);
    if (varMatch) {
        return { names: extractCommaSeparatedNames(varMatch[1]), isLoop: false };
    }
    return null;
}

function auditGoDeclarations(line: string, lineIdx: number, pCtx: PolyglotNamingContext): void {
    const typeMatch = REGEX.SYNTAX.GO_STRUCT_OR_INTERFACE.exec(line);
    if (typeMatch) {
        auditGoType(typeMatch[1], lineIdx, pCtx);
        return;
    }

    const constMatch = REGEX.SYNTAX.GO_CONST_DECL_LINE.exec(line);
    if (constMatch) {
        const names = extractCommaSeparatedNames(constMatch[1]);
        for (let i = 0; i < names.length; i++) {
            if (!GO_KEYWORDS.has(names[i])) {
                auditGoConstant(names[i], lineIdx, pCtx);
            }
        }
    }
}

function advanceGoBraceDepth(trimmed: string, state: GoLineScanState): void {
    const codeOnly = trimmed.split('//')[0];
    const openBraces = (codeOnly.match(/\{/g) || []).length;
    const closeBraces = (codeOnly.match(/\}/g) || []).length;
    state.braceDepth += openBraces - closeBraces;
    if (state.braceDepth < 0) state.braceDepth = 0;
    if (state.testFunctionDepth >= 0 && state.braceDepth <= state.testFunctionDepth) {
        state.testFunctionDepth = -1;
    }
}

function scanGoLine(
    line: string,
    lineIdx: number,
    state: GoLineScanState,
    pCtx: PolyglotNamingContext,
): void {
    const fnMatch = REGEX.SYNTAX.GO_FUNC_DECL_LINE.exec(line);
    if (fnMatch) {
        const isTest = isGoFunctionExempt(fnMatch[1]);
        if (isTest) {
            state.testFunctionDepth = state.braceDepth;
        } else {
            auditExtractedFunction({ fnName: fnMatch[1], lineIdx, isSnake: false }, pCtx);
        }
    }

    const inTestScope = state.testFunctionDepth >= 0;
    const trimmed = line.trim();

    if (!inTestScope) {
        auditGoDeclarations(line, lineIdx, pCtx);
    }

    const binding = extractGoVariableBindings(line);
    if (binding) {
        for (let i = 0; i < binding.names.length; i++) {
            const name = binding.names[i];
            if (!GO_KEYWORDS.has(name)) {
                auditPolyglotVariable(name, lineIdx, inTestScope, binding.isLoop, pCtx, 'go');
            }
        }
    }

    advanceGoBraceDepth(trimmed, state);
}

function auditGDScriptClass(className: string, lineIdx: number, pCtx: PolyglotNamingContext): void {
    if (pCtx.opts.checkTypes !== false && !/^[A-Z][a-zA-Z0-9]*$/.test(className)) {
        const suggested = toPascalCase(className);
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-TYP-001',
                message: `GDScript class_name '${className}' should follow PascalCase convention.`,
                severity: SEVERITY_WARNING,
                detail: { name: className, lang: 'gdscript' },
                suggestion: `Rename class '${className}' to PascalCase convention.`,
                actionable: buildPolyglotActionable(
                    className,
                    'NAM-TYP-001',
                    lineIdx + 1,
                    1,
                    suggested,
                ),
            }),
        );
    }
    if (pCtx.opts.checkJargon !== false && hasTransientJargon(className)) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-JRG-002',
                message: `Class identifier '${className}' contains transient construction jargon.`,
                severity: SEVERITY_WARNING,
                detail: { name: className, lang: 'gdscript' },
                suggestion: 'Replace transient process markers with semantic domain naming.',
                actionable: buildPolyglotActionable(className, 'NAM-JRG-002', lineIdx + 1, 1),
            }),
        );
    }
}

function auditGDScriptConstant(
    constName: string,
    lineIdx: number,
    pCtx: PolyglotNamingContext,
): void {
    if (pCtx.opts.checkGlobals !== false && !/^[A-Z][A-Z0-9_]*$/.test(constName)) {
        const suggested = toUpperSnakeCase(constName);
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                column: 1,
                rule: 'NAM-GLB-001',
                message: `GDScript constant '${constName}' should follow UPPER_SNAKE_CASE convention.`,
                severity: SEVERITY_WARNING,
                detail: { name: constName, lang: 'gdscript' },
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
                message: `Constant identifier '${constName}' contains transient construction jargon.`,
                severity: SEVERITY_WARNING,
                detail: { name: constName, lang: 'gdscript' },
                suggestion: 'Replace transient process markers with semantic domain naming.',
                actionable: buildPolyglotActionable(constName, 'NAM-JRG-002', lineIdx + 1, 1),
            }),
        );
    }
    if (pCtx.opts.checkLengths !== false) {
        if (
            constName.length < MIN_POLYGLOT_VARIABLE_LENGTH &&
            !ALLOWED_SHORT_NAMES.has(constName)
        ) {
            pCtx.issues.push(
                pCtx.mkIssue({
                    line: lineIdx + 1,
                    column: 1,
                    rule: 'NAM-LEN-001',
                    message: `Constant identifier '${constName}' is too short (< ${MIN_POLYGLOT_VARIABLE_LENGTH} characters); lacks semantic clarity.`,
                    severity: SEVERITY_WARNING,
                    detail: {
                        name: constName,
                        length: constName.length,
                        minLen: MIN_POLYGLOT_VARIABLE_LENGTH,
                        lang: 'gdscript',
                    },
                    suggestion: `Rename '${constName}' to a descriptive identifier with >= ${MIN_POLYGLOT_VARIABLE_LENGTH} characters.`,
                    actionable: buildPolyglotActionable(constName, 'NAM-LEN-001', lineIdx + 1, 1),
                }),
            );
        } else if (constName.length > MAX_VARIABLE_NAME_LENGTH) {
            pCtx.issues.push(
                pCtx.mkIssue({
                    line: lineIdx + 1,
                    column: 1,
                    rule: 'NAM-LEN-001',
                    message: `Constant identifier '${constName}' is excessively long (> ${MAX_VARIABLE_NAME_LENGTH} characters); decompose or simplify.`,
                    severity: SEVERITY_WARNING,
                    detail: {
                        name: constName,
                        length: constName.length,
                        maxLen: MAX_VARIABLE_NAME_LENGTH,
                        lang: 'gdscript',
                    },
                    suggestion: `Refactor '${constName}' into a concise identifier with <= ${MAX_VARIABLE_NAME_LENGTH} characters.`,
                    actionable: buildPolyglotActionable(constName, 'NAM-LEN-001', lineIdx + 1, 1),
                }),
            );
        }
    }
}

function auditGDScriptLine(line: string, lineIdx: number, pCtx: PolyglotNamingContext): void {
    const fnMatch = REGEX.SYNTAX.GDSCRIPT_FUNC.exec(line);
    if (fnMatch) {
        if (!isGDScriptFunctionExempt(fnMatch[1])) {
            auditExtractedFunction({ fnName: fnMatch[1], lineIdx, isSnake: true }, pCtx);
        }
        return;
    }

    const classMatch = REGEX.SYNTAX.GDSCRIPT_CLASS_NAME.exec(line);
    if (classMatch) {
        auditGDScriptClass(classMatch[1], lineIdx, pCtx);
        return;
    }

    const constMatch = REGEX.SYNTAX.GDSCRIPT_CONST.exec(line);
    if (constMatch) {
        auditGDScriptConstant(constMatch[1], lineIdx, pCtx);
        return;
    }

    const forMatch = REGEX.SYNTAX.GDSCRIPT_FOR_DECL.exec(line);
    if (forMatch) {
        auditPolyglotVariable(forMatch[1], lineIdx, false, true, pCtx, 'gdscript');
        return;
    }

    const varMatch = REGEX.SYNTAX.GDSCRIPT_VAR.exec(line);
    if (varMatch) {
        auditPolyglotVariable(varMatch[1], lineIdx, false, false, pCtx, 'gdscript');
        return;
    }
}

type PolyglotLineAuditor = (line: string, lineIndex: number) => void;

function createPolyglotLineAuditor(
    ext: string,
    pCtx: PolyglotNamingContext,
): PolyglotLineAuditor | null {
    if (ext === '.go') {
        const state: GoLineScanState = {
            braceDepth: 0,
            testFunctionDepth: -1,
        };
        return (line, i) => scanGoLine(line, i, state, pCtx);
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
        return (line, i) => auditGDScriptLine(line, i, pCtx);
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
