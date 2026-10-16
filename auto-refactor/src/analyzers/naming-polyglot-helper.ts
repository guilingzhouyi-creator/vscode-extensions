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
const RUST_FN_RE =
    /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern(?:\s*"[^"]*")?\s+)?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)/;
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
                message: `Function name '${fnName}' is too short (< ${minLen} characters); lacks description.`,
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
                message: `Function name '${fnName}' is too long (> ${maxLen} characters); decompose responsibilities.`,
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
        return (line, i) => {
            const trimmed = line.trim();
            if (
                trimmed.startsWith('#[test]') ||
                trimmed.startsWith('#[tokio::test]') ||
                trimmed.startsWith('#[rstest]')
            ) {
                isNextFnTest = true;
                return;
            }
            const match = RUST_FN_RE.exec(line);
            if (match) {
                const isTest = isNextFnTest || isRustFunctionExempt(match[1]);
                isNextFnTest = false;
                if (!isTest) {
                    auditExtractedFunction({ fnName: match[1], lineIdx: i, isSnake: true }, pCtx);
                }
            } else if (
                trimmed.length > 0 &&
                !trimmed.startsWith('//') &&
                !trimmed.startsWith('#[')
            ) {
                isNextFnTest = false;
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
