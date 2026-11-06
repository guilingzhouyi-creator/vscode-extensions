/**
 * Module: Static Analysis Engine — TypeScript/JavaScript Modernization Rules
 * File Path: src/analyzers/ts-modern.ts
 * Architecture Role: TS/JS-only style analyzer (a language pack bound to the language family,
 *     never to a project) — the TypeScript counterpart of the Python modernization pack
 * Dependencies & Triggers: DeclarativeModernAnalyzer metapack, core types, dimensionLiterals;
 *     enabled when a config declares `analyzers.ts-modern`.
 * Responsibilities: Report ten modernization findings on `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`
 *     files: TSM-VAR-001 (`var`), TSM-REQUIRE-001 (CommonJS `require` inside an ESM module),
 *     TSM-CTOR-001 (wrapper constructors), TSM-ARGS-001 (`arguments`), TSM-SPREAD-001
 *     (`Object.assign({}, …)`), TSM-INCLUDES-001 (`indexOf` compared against -1/0),
 *     TSM-SUBSTR-001 (deprecated `substr`), TSM-REPLACE-001 (string-pattern `replace`, which only
 *     rewrites the first hit), TSM-ANY-001 (explicit `any`) and TSM-TYPE-001 (a named import that
 *     is only ever used in type positions)
 * Exit Semantics & Design Rationale: Built upon DeclarativeModernAnalyzer; never throws and returns
 *     [] for non-matching extensions or declaration files (.d.ts). Preserves 100% oracle parity.
 */

import type { Issue } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_INFO } from '../core/types';
import { REGEX } from '../core/constants';
import { ANALYZER_TYPESCRIPT_MODERN } from '../core/scoring/dimensionLiterals';
import type { SourceMaskConfig } from '../core/policy/source-mask';
import { sharedMemoryGovernor, CacheEvictionTier } from '../core/memory/memory-governor';
import {
    DeclarativeModernAnalyzer,
    type DeclarativeLineRule,
    type LineScanContext,
} from './declarative-modern-pack';

/** Extensions the pack accepts: the content-only path sees every language, so gate on the path. */
const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** Declaration files carry no runtime code, so no modernization rule applies to them. */
const DECLARATION_SUFFIX = '.d.ts';

/** Extensions that may carry type annotations; the type-position rules skip plain JavaScript. */
const TYPED_EXTENSIONS = ['.ts', '.tsx'];

const TS_QUOTE_CHARS = '"\'`';

/** Comment/literal syntax of the TS/JS family, handed to the shared source masker. */
const TS_MASK: SourceMaskConfig = {
    lineComment: '//',
    blockComment: { open: '/*', close: '*/' },
    quoteChars: TS_QUOTE_CHARS,
    multilineTemplates: true,
};

const RULE_TSM_INCLUDES = 'TSM-INCLUDES-001';
const RULE_TSM_REQUIRE = 'TSM-REQUIRE-001';
const RULE_TSM_REPLACE = 'TSM-REPLACE-001';
const LABEL_IMPORTS = 'imports';
const LABEL_IMPORT = 'import';

const SNIPPET_VAR = 'const $1 = $2;';
const SNIPPET_CTOR = '[]';
const SNIPPET_ARGS = '(...args: unknown[]) => { ... }';
const SNIPPET_SPREAD = '{ ...target, ...source }';
const SNIPPET_INCLUDES = '$1.includes($2)';
const SNIPPET_SUBSTR = '$1.slice($2, $2 + $3)';
const SNIPPET_REPLACE = '$1.replaceAll($2, $3)';
const SNIPPET_ANY = 'unknown';
const SNIPPET_TYPE = 'import type { $1 } from $2;';
const SNIPPET_REQUIRE = 'import $1 from $2;';
const SNIPPET_DISP = 'context.subscriptions.push($1);';

const ISOLATED_DISPOSABLE_RE =
    /^\s*(?:vscode\.(?:window|workspace|languages|commands)\.(?:onDidChange[A-Za-z0-9_]+|onDidOpen[A-Za-z0-9_]+|onDidClose[A-Za-z0-9_]+|onDidSave[A-Za-z0-9_]+|registerCommand|registerTextEditorCommand)|setInterval)\s*\(/;

function isTypedPath(file: string): boolean {
    return TYPED_EXTENSIONS.some((extension) => file.endsWith(extension));
}

const esmSyntaxByLinesCache = new WeakMap<readonly string[], boolean>();

function hasEsmSyntaxInMaskedLines(maskedLines: readonly string[]): boolean {
    let cached = esmSyntaxByLinesCache.get(maskedLines);
    if (cached === undefined) {
        cached = REGEX.SYNTAX.TS_ESM_SYNTAX.test(maskedLines.join('\n'));
        esmSyntaxByLinesCache.set(maskedLines, cached);
    }
    return cached;
}

/** Declarative line-level rules for TypeScript/JavaScript modernization. */
const TS_LINE_RULES: readonly DeclarativeLineRule[] = [
    {
        rule: 'TSM-VAR-001',
        severity: SEVERITY_WARNING,
        fastTrigger: 'var',
        pattern: REGEX.SYNTAX.TS_VAR_DECL,
        message:
            '`var` is function-scoped and hoisted; block-scoped `const` (or `let`) states intent.',
        suggestion: 'Declare with `const`, or `let` when the binding is reassigned.',
        actionable: {
            action: 'replace_token',
            codeId: '001',
            templateSnippet: SNIPPET_VAR,
        },
    },
    {
        rule: 'TSM-CTOR-001',
        severity: SEVERITY_WARNING,
        fastTrigger: 'new',
        pattern: REGEX.SYNTAX.TS_WRAPPER_CTOR,
        message: 'Wrapper constructor called with `new`; a literal or the primitive is equivalent.',
        suggestion: 'Use `[]`, `{}`, `String(x)`, `Number(x)` or `Boolean(x)` instead of `new`.',
        actionable: {
            action: 'replace_token',
            codeId: '002',
            templateSnippet: SNIPPET_CTOR,
        },
    },
    {
        rule: 'TSM-ARGS-001',
        severity: SEVERITY_WARNING,
        fastTrigger: 'arguments',
        pattern: REGEX.SYNTAX.TS_ARGUMENTS_USE,
        message: '`arguments` is array-like, untyped and unavailable in arrow functions.',
        suggestion: 'Take a rest parameter (`(...args: T[])`) and use it directly.',
        actionable: {
            action: 'split_function',
            codeId: '003',
            templateSnippet: SNIPPET_ARGS,
        },
    },
    {
        rule: 'TSM-SPREAD-001',
        severity: SEVERITY_WARNING,
        fastTrigger: 'Object.assign',
        pattern: REGEX.SYNTAX.TS_OBJECT_ASSIGN,
        message: '`Object.assign({}, …)` shallow-merges where object spread says the same thing.',
        suggestion:
            'Merge with `{ ...source }`, which is typed and avoids the empty-object argument.',
        actionable: {
            action: 'replace_token',
            codeId: '004',
            templateSnippet: SNIPPET_SPREAD,
        },
    },
    {
        rule: RULE_TSM_INCLUDES,
        severity: SEVERITY_WARNING,
        fastTrigger: 'indexOf',
        pattern: REGEX.SYNTAX.TS_INDEX_OF_BOUNDARY,
        message: '`indexOf` compared against -1/0 is less direct than the boolean the check wants.',
        suggestion:
            'Use `includes(value)` (or `indexOf(...) >= 0` when the index itself is needed).',
        actionable: {
            action: 'replace_token',
            codeId: '005',
            templateSnippet: SNIPPET_INCLUDES,
        },
    },
    {
        rule: 'TSM-SUBSTR-001',
        severity: SEVERITY_WARNING,
        fastTrigger: '.substr',
        pattern: REGEX.SYNTAX.TS_SUBSTR,
        message: '`String.prototype.substr` is deprecated and absent from the language standard.',
        suggestion: 'Use `slice(start, start + length)`, which has identical semantics here.',
        actionable: {
            action: 'replace_token',
            codeId: '006',
            templateSnippet: SNIPPET_SUBSTR,
        },
    },
    {
        rule: RULE_TSM_REQUIRE,
        severity: SEVERITY_WARNING,
        fastTrigger: 'require',
        pattern: REGEX.SYNTAX.TS_REQUIRE_CALL,
        condition: (ctx: LineScanContext) => hasEsmSyntaxInMaskedLines(ctx.allMaskedLines),
        message: 'CommonJS `require` in a module that already uses ESM syntax.',
        suggestion: 'Import the binding (`import x from "m"` / `import { y } from "m"`) instead.',
        actionable: {
            action: 'replace_token',
            codeId: '010',
            templateSnippet: SNIPPET_REQUIRE,
        },
    },
    {
        rule: 'TSM-ANY-001',
        severity: SEVERITY_WARNING,
        fastTrigger: 'any',
        pattern: REGEX.SYNTAX.TS_ANY_TYPE,
        condition: (ctx: LineScanContext) => isTypedPath(ctx.file),
        message: 'Explicit `any` disables checking for every value it touches.',
        suggestion: 'Prefer `unknown` plus a narrowing check, or a precise generic/union type.',
        actionable: {
            action: 'replace_token',
            codeId: '008',
            templateSnippet: SNIPPET_ANY,
        },
    },
];

const DISP_RULE_DEF: DeclarativeLineRule = {
    rule: 'TSM-DISP-001',
    severity: SEVERITY_WARNING,
    message:
        'Disposable resource/listener created in isolated statement without tracking in subscriptions.',
    suggestion:
        'Pass to `context.subscriptions.push(...)` or store in a Disposable collection to prevent memory leaks.',
    actionable: {
        action: 'apply_guard_clause',
        codeId: '011',
        templateSnippet: SNIPPET_DISP,
    },
};

const REPLACE_RULE_DEF: DeclarativeLineRule = {
    rule: RULE_TSM_REPLACE,
    severity: SEVERITY_INFO,
    message: '`replace` with a string pattern rewrites only the first occurrence.',
    suggestion: 'Use `replaceAll(pattern, value)` when every occurrence should change.',
    actionable: {
        action: 'replace_token',
        codeId: '007',
        templateSnippet: SNIPPET_REPLACE,
    },
};

const TYPE_IMPORT_RULE_DEF: DeclarativeLineRule = {
    rule: 'TSM-TYPE-001',
    severity: SEVERITY_INFO,
    message: 'Named import used only as a type.',
    suggestion: 'Mark the clause `import type { … }` so the binding is erased at compile time.',
    actionable: {
        action: 'replace_token',
        codeId: '009',
        templateSnippet: SNIPPET_TYPE,
    },
};

/** TypeScript/JavaScript modernization pack: ten rules over a masked view of the file. */
export class TsModernAnalyzer extends DeclarativeModernAnalyzer {
    constructor() {
        super({
            analyzerId: ANALYZER_TYPESCRIPT_MODERN,
            fileExtensions: SUPPORTED_EXTENSIONS,
            maskConfig: TS_MASK,
            pathFilter: (filePath: string) => !filePath.endsWith(DECLARATION_SUFFIX),
            rules: [...TS_LINE_RULES, DISP_RULE_DEF, REPLACE_RULE_DEF, TYPE_IMPORT_RULE_DEF],
            multiLineScanner: (raw, masked, file, issues) => {
                this.scanMultiLine(raw, masked, file, issues);
            },
        });
    }

    private scanMultiLine(
        raw: readonly string[],
        masked: readonly string[],
        file: string,
        out: Issue[],
    ): void {
        this.reportDisposableLeaks(masked, file, out);
        this.reportStringPatternReplace(masked, raw, file, out);
        if (isTypedPath(file)) {
            this.reportTypeOnlyImports(masked, raw, file, out);
        }
    }

    private reportDisposableLeaks(masked: readonly string[], file: string, out: Issue[]): void {
        let openParenDepth = 0;
        for (let i = 0; i < masked.length; i++) {
            const line = masked[i];
            const trimmed = line.trim();
            if (trimmed.length === 0) continue;

            const isStartOfDisposable = ISOLATED_DISPOSABLE_RE.test(line);
            const notPassedAsArg = !isArgOnPreviousLine(masked, i);
            if (isStartOfDisposable && openParenDepth === 0 && notPassedAsArg) {
                const matchResult = line.match(ISOLATED_DISPOSABLE_RE)!;
                const col = findFirstNonWhitespaceColumn(line);
                out.push(
                    this.emitIssue(
                        DISP_RULE_DEF,
                        file,
                        i + 1,
                        { matched: matchResult[0].trim() },
                        col,
                    ),
                );
            }

            openParenDepth = updateOpenParenDepth(line, openParenDepth);
        }
    }

    private reportStringPatternReplace(
        masked: readonly string[],
        raw: readonly string[],
        file: string,
        out: Issue[],
    ): void {
        for (let index = 0; index < masked.length; index += 1) {
            if (!REGEX.SYNTAX.TS_REPLACE_CALL.test(masked[index])) continue;
            const match = REGEX.SYNTAX.TS_REPLACE_LITERAL.exec(raw[index]);
            if (!match) continue;
            out.push(
                this.emitIssue(
                    REPLACE_RULE_DEF,
                    file,
                    index + 1,
                    { line: masked[index].trim(), quote: match[1] },
                    match.index + 1,
                ),
            );
        }
    }

    private reportTypeOnlyImports(
        masked: readonly string[],
        raw: readonly string[],
        file: string,
        out: Issue[],
    ): void {
        const importLines = new Set<number>();
        for (let index = 0; index < masked.length; index += 1) {
            if (REGEX.SYNTAX.TS_NAMED_IMPORT.test(masked[index])) importLines.add(index);
        }
        if (importLines.size === 0) return;

        const clauses = collectImportClauses(masked, importLines);
        const lineIndexByWord = buildCandidateLineIndex(masked, importLines, clauses);
        const isTypeByNameMap = new Map<string, boolean>();

        for (let clauseIdx = 0; clauseIdx < clauses.length; clauseIdx++) {
            const { lineIndex, names } = clauses[clauseIdx];
            const typeOnly: string[] = [];
            for (let nameIdx = 0; nameIdx < names.length; nameIdx++) {
                const name = names[nameIdx];
                let isType = isTypeByNameMap.get(name);
                if (isType === undefined) {
                    isType = this.isTypeOnlyName(name, masked, importLines, lineIndexByWord);
                    isTypeByNameMap.set(name, isType);
                }
                if (isType) {
                    typeOnly.push(name);
                }
            }
            if (typeOnly.length === 0) continue;
            const label = typeOnly.length > 1 ? LABEL_IMPORTS : LABEL_IMPORT;
            const dynamicRule: DeclarativeLineRule = {
                ...TYPE_IMPORT_RULE_DEF,
                message: `Named ${label} used only as a type: ${typeOnly.join(', ')}.`,
            };
            out.push(
                this.emitIssue(
                    dynamicRule,
                    file,
                    lineIndex + 1,
                    { line: raw[lineIndex].trim(), names: typeOnly },
                    1,
                ),
            );
        }
    }

    private countLineUsage(
        code: string,
        patterns: CompiledTypePatterns,
    ): { lineTotal: number; lineTyped: number } {
        let lineTyped = 0;
        const lineTotal = countMatches(code, patterns.word);
        for (let patternIdx = 0; patternIdx < patterns.typePatterns.length; patternIdx++) {
            lineTyped += countMatches(code, patterns.typePatterns[patternIdx]);
        }
        return { lineTotal, lineTyped };
    }

    private computeUsageAcrossLines(
        candidateIndices: Iterable<number>,
        scope: UsageScanScope,
        mustTestFallbackWord: boolean,
    ): { total: number; typed: number } {
        let total = 0;
        let typed = 0;
        const { masked, importLines, patterns } = scope;
        for (const index of candidateIndices) {
            if (importLines.has(index)) continue;
            if (mustTestFallbackWord && !patterns.fallbackWord.test(masked[index])) continue;
            const { lineTotal, lineTyped } = this.countLineUsage(masked[index], patterns);
            total += lineTotal;
            typed += lineTyped;
        }
        return { total, typed };
    }

    private isTypeOnlyName(
        name: string,
        masked: readonly string[],
        importLines: Set<number>,
        lineIndexByWord?: Map<string, Set<number>>,
    ): boolean {
        const matchingLines = lineIndexByWord?.get(name);
        if (matchingLines && matchingLines.size === 0) return false;

        const patterns = getCompiledTypePatterns(name);
        const candidateIndices = matchingLines ?? masked.keys();
        const scope: UsageScanScope = { masked, importLines, patterns };
        const { total, typed } = this.computeUsageAcrossLines(
            candidateIndices,
            scope,
            !matchingLines,
        );

        return total > 0 && typed >= total;
    }
}

function countMatches(code: string, pattern: RegExp): number {
    pattern.lastIndex = 0;
    return code.match(pattern)?.length ?? 0;
}

const CHAR_CODE_SPACE = 32;
const CHAR_CODE_TAB = 9;
const CHAR_CODE_CR = 13;
const CHAR_CODE_LF = 10;

function findFirstNonWhitespaceColumn(line: string): number {
    for (let charIdx = 0; charIdx < line.length; charIdx++) {
        const code = line.charCodeAt(charIdx);
        if (
            code !== CHAR_CODE_SPACE &&
            code !== CHAR_CODE_TAB &&
            code !== CHAR_CODE_CR &&
            code !== CHAR_CODE_LF
        ) {
            return charIdx + 1;
        }
    }
    return 1;
}

const IDENT_NAME_RE = /^[A-Za-z_$][\w$]*$/;

function parseClauseImportNames(clauseText: string): string[] {
    const rawTokens = clauseText.split(',');
    const names: string[] = [];
    for (let i = 0; i < rawTokens.length; i++) {
        const parts = rawTokens[i].trim().split(/\s+as\s+/);
        const name = (parts.pop() ?? '').trim();
        if (IDENT_NAME_RE.test(name)) {
            names.push(name);
        }
    }
    return names;
}

interface ImportClauseRecord {
    lineIndex: number;
    names: string[];
}

function collectImportClauses(
    masked: readonly string[],
    importLines: Set<number>,
): ImportClauseRecord[] {
    const records: ImportClauseRecord[] = [];
    for (const index of importLines) {
        const clause = REGEX.SYNTAX.TS_NAMED_IMPORT.exec(masked[index]);
        if (!clause) continue;
        const names = parseClauseImportNames(clause[1]);
        if (names.length > 0) {
            records.push({ lineIndex: index, names });
        }
    }
    return records;
}

interface UsageScanScope {
    readonly masked: readonly string[];
    readonly importLines: Set<number>;
    readonly patterns: CompiledTypePatterns;
}

interface CompiledTypePatterns {
    word: RegExp;
    fallbackWord: RegExp;
    typePatterns: RegExp[];
}

const typePatternsByNameMap = new Map<string, CompiledTypePatterns>();
const wordPatternByWordMap = new Map<string, RegExp>();

sharedMemoryGovernor.register({
    name: 'ts-modern.typePatternsByNameMap',
    tier: CacheEvictionTier.Intermediate,
    clear: () => {
        typePatternsByNameMap.clear();
    },
    getSize: () => typePatternsByNameMap.size,
});

sharedMemoryGovernor.register({
    name: 'ts-modern.wordPatternByWordMap',
    tier: CacheEvictionTier.Intermediate,
    clear: () => {
        wordPatternByWordMap.clear();
    },
    getSize: () => wordPatternByWordMap.size,
});
const REGEXP_GLOBAL_FLAG = 'g';

function getCompiledWordPattern(word: string): RegExp {
    let wordRegex = wordPatternByWordMap.get(word);
    if (!wordRegex) {
        wordRegex = new RegExp(`\\b${REGEX.escape(word)}\\b`);
        wordPatternByWordMap.set(word, wordRegex);
    }
    return wordRegex;
}

function getCompiledTypePatterns(name: string): CompiledTypePatterns {
    let cached = typePatternsByNameMap.get(name);
    if (cached) return cached;

    const escaped = REGEX.escape(name);
    cached = {
        word: new RegExp(`\\b${escaped}\\b`, REGEXP_GLOBAL_FLAG),
        fallbackWord: new RegExp(`\\b${escaped}\\b`),
        typePatterns: [
            new RegExp(`:\\s*${escaped}\\b`, REGEXP_GLOBAL_FLAG),
            new RegExp(`\\bas\\s+${escaped}\\b`, REGEXP_GLOBAL_FLAG),
            new RegExp(`<\\s*${escaped}\\s*[,>]`, REGEXP_GLOBAL_FLAG),
            new RegExp(`\\bextends\\s+${escaped}\\b`, REGEXP_GLOBAL_FLAG),
            new RegExp(`\\bimplements\\s+${escaped}\\b`, REGEXP_GLOBAL_FLAG),
            new RegExp(`(?<![|&])[|&](?![|&])\\s*${escaped}\\b`, REGEXP_GLOBAL_FLAG),
            new RegExp(`\\b${escaped}\\s*(?<![|&])[|&](?![|&])`, REGEXP_GLOBAL_FLAG),
            new RegExp(`\\b${escaped}\\s*\\[\\s*\\]`, REGEXP_GLOBAL_FLAG),
        ],
    };
    typePatternsByNameMap.set(name, cached);
    return cached;
}

function initializeWordSetEntry(map: Map<string, Set<number>>, word: string): void {
    if (!map.has(word)) {
        map.set(word, new Set<number>());
    }
}

function buildCandidateLineIndex(
    masked: readonly string[],
    importLines: Set<number>,
    records: ImportClauseRecord[],
): Map<string, Set<number>> {
    const lineIndexByWord = new Map<string, Set<number>>();
    for (let recordIdx = 0; recordIdx < records.length; recordIdx++) {
        const names = records[recordIdx].names;
        for (let nameIdx = 0; nameIdx < names.length; nameIdx++) {
            initializeWordSetEntry(lineIndexByWord, names[nameIdx]);
        }
    }
    if (lineIndexByWord.size === 0) return lineIndexByWord;

    const matcherByWordMap = new Map<string, RegExp>();
    for (const word of lineIndexByWord.keys()) {
        matcherByWordMap.set(word, getCompiledWordPattern(word));
    }

    for (let index = 0; index < masked.length; index += 1) {
        if (importLines.has(index)) continue;
        const line = masked[index];
        for (const [word, matcher] of matcherByWordMap) {
            if (matcher.test(line)) {
                lineIndexByWord.get(word)!.add(index);
            }
        }
    }
    return lineIndexByWord;
}

const PREV_LINE_ARG_TERMINATOR_RE = /[(=,[]$/;

function isArgOnPreviousLine(masked: readonly string[], start: number): boolean {
    for (let prev = start - 1; prev >= 0; prev--) {
        const prevTrim = masked[prev].trim();
        if (prevTrim.length === 0) continue;
        return PREV_LINE_ARG_TERMINATOR_RE.test(prevTrim);
    }
    return false;
}

function updateOpenParenDepth(line: string, currentDepth: number): number {
    let depth = currentDepth;
    for (let charIdx = 0; charIdx < line.length; charIdx++) {
        if (line[charIdx] === '(') depth++;
        else if (line[charIdx] === ')' && depth > 0) depth--;
    }
    return depth;
}
