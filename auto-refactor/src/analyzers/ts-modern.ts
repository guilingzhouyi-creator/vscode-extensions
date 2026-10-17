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
import { ANALYZER_TYPESCRIPT_MODERN } from '../core/scoring/dimensionLiterals';
import type { SourceMaskConfig } from '../core/policy/source-mask';
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

/** `var` declaration: function-scoped and hoisted where `const` or `let` expresses the intent. */
const VAR_DECL_RE = /\bvar\s+[A-Za-z_$]/;

/** CommonJS `require(...)` call; reported only inside modules that already use ESM syntax. */
const REQUIRE_CALL_RE = /\brequire\s*\(/;

/** ESM marker that turns a `require` call into a legacy leftover instead of the module style. */
const ESM_SYNTAX_RE = /^\s*(?:import|export)\b/m;

/** Wrapper constructors whose literal or primitive form is shorter and behaves better. */
const WRAPPER_CTOR_RE = /\bnew\s+(?:Array|Object|String|Number|Boolean)\s*\(/;

/** The `arguments` object, which rest parameters replace in modern code. */
const ARGUMENTS_USE_RE = /\barguments\s*(?:\[|\.|\))/;

/** `Object.assign({}, …)` used as a shallow merge where object spread reads better. */
const OBJECT_ASSIGN_RE = /\bObject\s*\.\s*assign\s*\(\s*\{\s*\}/;

/** `indexOf` compared against -1/0: exactly the shape `includes` was introduced to replace. */
const INDEX_OF_BOUNDARY_RE = /\.\s*indexOf\s*\([^)]*\)\s*(?:!==?\s*-1|===?\s*-1|>=?\s*0|>\s*-1)/;

/** Deprecated `String.prototype.substr`, superseded by `slice` (and by `substring`). */
const SUBSTR_RE = /\.\s*substr\s*\(/;

/** `replace('literal', …)`: a string pattern rewrites only the first occurrence. */
const REPLACE_LITERAL_RE = /\.\s*replace\s*\(\s*(['"`])/;

/** Fast guard pattern matching `.replace(` before applying detailed literal extraction. */
const REPLACE_CALL_RE = /\.replace\(/;

/** Explicit `any` in a type position, where `unknown` keeps the same call sites type-safe. */
const ANY_TYPE_RE = /(?::\s*any\b)|(?:\bas\s+any\b)|(?:<\s*any\s*>)|(?:\bany\s*\[\s*\])/;

/** Named import clause without the `type` modifier; the specifier is masked out beforehand. */
const NAMED_IMPORT_RE = /^\s*import\s+\{([^}]*)\}\s+from\s/;

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

/** Declarative line-level rules for TypeScript/JavaScript modernization. */
const TS_LINE_RULES: readonly DeclarativeLineRule[] = [
    {
        rule: 'TSM-VAR-001',
        severity: SEVERITY_WARNING,
        pattern: VAR_DECL_RE,
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
        pattern: WRAPPER_CTOR_RE,
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
        pattern: ARGUMENTS_USE_RE,
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
        pattern: OBJECT_ASSIGN_RE,
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
        pattern: INDEX_OF_BOUNDARY_RE,
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
        pattern: SUBSTR_RE,
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
        pattern: REQUIRE_CALL_RE,
        condition: (ctx: LineScanContext) => ESM_SYNTAX_RE.test(ctx.allMaskedLines.join('\n')),
        message: 'CommonJS `require` in a module that already uses ESM syntax.',
        suggestion:
            'Import the binding (`import x from "m"` / `import { y } from "m"`) instead.',
        actionable: {
            action: 'replace_token',
            codeId: '010',
            templateSnippet: SNIPPET_REQUIRE,
        },
    },
    {
        rule: 'TSM-ANY-001',
        severity: SEVERITY_WARNING,
        pattern: ANY_TYPE_RE,
        condition: (ctx: LineScanContext) => isTypedPath(ctx.file),
        message: 'Explicit `any` disables checking for every value it touches.',
        suggestion:
            'Prefer `unknown` plus a narrowing check, or a precise generic/union type.',
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
            if (!REPLACE_CALL_RE.test(masked[index])) continue;
            const match = REPLACE_LITERAL_RE.exec(raw[index]);
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
            if (NAMED_IMPORT_RE.test(masked[index])) importLines.add(index);
        }
        if (importLines.size === 0) return;

        const clauses = collectImportClauses(masked, importLines);
        const lineIndexByWord = buildCandidateLineIndex(masked, importLines, clauses);
        const isTypeByNameMap = new Map<string, boolean>();

        for (let c = 0; c < clauses.length; c++) {
            const { lineIndex, names } = clauses[c];
            const typeOnly: string[] = [];
            for (let n = 0; n < names.length; n++) {
                const name = names[n];
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
        for (let p = 0; p < patterns.typePatterns.length; p++) {
            lineTyped += countMatches(code, patterns.typePatterns[p]);
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

const REGEX_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
const REGEX_MATCH_SUBSTITUTION = '\\$&';

function escapeRegExp(text: string): string {
    return text.replace(REGEX_ESCAPE_RE, REGEX_MATCH_SUBSTITUTION);
}

const CHAR_CODE_SPACE = 32;
const CHAR_CODE_TAB = 9;
const CHAR_CODE_CR = 13;
const CHAR_CODE_LF = 10;

function findFirstNonWhitespaceColumn(line: string): number {
    for (let c = 0; c < line.length; c++) {
        const code = line.charCodeAt(c);
        if (
            code !== CHAR_CODE_SPACE &&
            code !== CHAR_CODE_TAB &&
            code !== CHAR_CODE_CR &&
            code !== CHAR_CODE_LF
        ) {
            return c + 1;
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
        const clause = NAMED_IMPORT_RE.exec(masked[index]);
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
const REGEXP_GLOBAL_FLAG = 'g';

function getCompiledWordPattern(word: string): RegExp {
    let re = wordPatternByWordMap.get(word);
    if (!re) {
        re = new RegExp(`\\b${escapeRegExp(word)}\\b`);
        wordPatternByWordMap.set(word, re);
    }
    return re;
}

function getCompiledTypePatterns(name: string): CompiledTypePatterns {
    let cached = typePatternsByNameMap.get(name);
    if (cached) return cached;

    const escaped = escapeRegExp(name);
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
    for (let r = 0; r < records.length; r++) {
        const names = records[r].names;
        for (let n = 0; n < names.length; n++) {
            initializeWordSetEntry(lineIndexByWord, names[n]);
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
    for (let c = 0; c < line.length; c++) {
        if (line[c] === '(') depth++;
        else if (line[c] === ')' && depth > 0) depth--;
    }
    return depth;
}
