/**
 * Module: Static Analysis Engine — TypeScript/JavaScript Modernization Rules
 * File Path: src/analyzers/ts-modern.ts
 * Architecture Role: TS/JS-only style analyzer (a language pack bound to the language family,
 *     never to a project) — the TypeScript counterpart of the Python modernization pack
 * Dependencies & Triggers: core types only; enabled when a config declares `analyzers.ts-modern`;
 *     specialized packs are default-off, so registering it cannot change an existing gate result
 * Responsibilities: Report ten modernization findings on `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`
 *     files: TSM-VAR-001 (`var`), TSM-REQUIRE-001 (CommonJS `require` inside an ESM module),
 *     TSM-CTOR-001 (wrapper constructors), TSM-ARGS-001 (`arguments`), TSM-SPREAD-001
 *     (`Object.assign({}, …)`), TSM-INCLUDES-001 (`indexOf` compared against -1/0),
 *     TSM-SUBSTR-001 (deprecated `substr`), TSM-REPLACE-001 (string-pattern `replace`, which only
 *     rewrites the first hit), TSM-ANY-001 (explicit `any`) and TSM-TYPE-001 (a named import that
 *     is only ever used in type positions)
 * Exit Semantics & Design Rationale: Pure line scanner over a string/comment-masked copy of the
 *     file; never throws and returns [] for every other language. Masking first keeps `var` inside
 *     a string, a `require(` in a template or a commented-out statement from being reported, while
 *     the heuristics stay keyword-anchored: a missed modernization is preferred over a wrong
 *     rewrite suggestion, and the two judgement-heavy rules (global `replace`, type-only imports)
 *     report at info severity instead of demanding a mechanical rewrite.
 */
import type { Analyzer, AnalyzerContext, Issue, Severity, AgentActionType } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_INFO } from '../core/types';
import { ANALYZER_TYPESCRIPT_MODERN } from '../core/scoring/dimensionLiterals';
import { maskSourceText, type SourceMaskConfig } from '../core/policy/source-mask';
import { buildCanonicalIssue } from '../core/reporting/canonical-issue-builder';

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

/** One keyword-anchored rule: pattern to match on the masked line plus its report text. */
interface LineRule {
    /** Canonical rule id (`TSM-TOPIC-NNN`). */
    rule: string;
    /** Finding severity. */
    severity: Severity;
    /** Pattern run against the masked line. */
    pattern: RegExp;
    /** Why the modern form is preferable. */
    message: string;
    /** One-line rewrite guidance. */
    suggestion: string;
}

const RULE_TSM_INCLUDES = 'TSM-INCLUDES-001';
const RULE_TSM_REQUIRE = 'TSM-REQUIRE-001';
const RULE_TSM_REPLACE = 'TSM-REPLACE-001';
const LABEL_IMPORTS = 'imports';
const LABEL_IMPORT = 'import';

/** Keyword rules shared by every supported extension. */
const LINE_RULES: LineRule[] = [
    {
        rule: 'TSM-VAR-001',
        severity: SEVERITY_WARNING,
        pattern: VAR_DECL_RE,
        message:
            '`var` is function-scoped and hoisted; block-scoped `const` (or `let`) states intent.',
        suggestion: 'Declare with `const`, or `let` when the binding is reassigned.',
    },
    {
        rule: 'TSM-CTOR-001',
        severity: SEVERITY_WARNING,
        pattern: WRAPPER_CTOR_RE,
        message: 'Wrapper constructor called with `new`; a literal or the primitive is equivalent.',
        suggestion: 'Use `[]`, `{}`, `String(x)`, `Number(x)` or `Boolean(x)` instead of `new`.',
    },
    {
        rule: 'TSM-ARGS-001',
        severity: SEVERITY_WARNING,
        pattern: ARGUMENTS_USE_RE,
        message: '`arguments` is array-like, untyped and unavailable in arrow functions.',
        suggestion: 'Take a rest parameter (`(...args: T[])`) and use it directly.',
    },
    {
        rule: 'TSM-SPREAD-001',
        severity: SEVERITY_WARNING,
        pattern: OBJECT_ASSIGN_RE,
        message: '`Object.assign({}, …)` shallow-merges where object spread says the same thing.',
        suggestion:
            'Merge with `{ ...source }`, which is typed and avoids the empty-object argument.',
    },
    {
        rule: RULE_TSM_INCLUDES,
        severity: SEVERITY_WARNING,
        pattern: INDEX_OF_BOUNDARY_RE,
        message: '`indexOf` compared against -1/0 is less direct than the boolean the check wants.',
        suggestion:
            'Use `includes(value)` (or `indexOf(...) >= 0` when the index itself is needed).',
    },
    {
        rule: 'TSM-SUBSTR-001',
        severity: SEVERITY_WARNING,
        pattern: SUBSTR_RE,
        message: '`String.prototype.substr` is deprecated and absent from the language standard.',
        suggestion: 'Use `slice(start, start + length)`, which has identical semantics here.',
    },
];

/**
 * Structured finding factory shared by every rule, so ids and locations stay uniform.
 *
 * @param file - Normalized repository-relative path.
 * @param lineIndex - Zero-based index of the reported line.
 * @param rule - Canonical rule id.
 * @param severity - Finding severity.
 * @param message - Why the modern form is preferable.
 * @param suggestion - One-line rewrite guidance.
 * @param detail - Structured evidence for machines (masked line, candidates, …).
 * @param column - 1-based column of the evidence on that line.
 * @returns The finding, ready to be pushed onto the result list.
 */
const ACTION_REPLACE_TOKEN: AgentActionType = 'replace_token';
const ACTION_SPLIT_FUNCTION: AgentActionType = 'split_function';
const ACTION_APPLY_GUARD: AgentActionType = 'apply_guard_clause';

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

const CODE_TSM_001 = 'AR:TSM:001';
const CODE_TSM_002 = 'AR:TSM:002';
const CODE_TSM_003 = 'AR:TSM:003';
const CODE_TSM_004 = 'AR:TSM:004';
const CODE_TSM_005 = 'AR:TSM:005';
const CODE_TSM_006 = 'AR:TSM:006';
const CODE_TSM_007 = 'AR:TSM:007';
const CODE_TSM_008 = 'AR:TSM:008';
const CODE_TSM_009 = 'AR:TSM:009';
const CODE_TSM_010 = 'AR:TSM:010';
const CODE_TSM_011 = 'AR:TSM:011';

type TsmActionTuple = readonly [action: AgentActionType, code: string, snippet: string];

const TSM_ACTION_TUPLES: Record<string, TsmActionTuple> = {
    'TSM-VAR-001': [ACTION_REPLACE_TOKEN, CODE_TSM_001, SNIPPET_VAR],
    'TSM-CTOR-001': [ACTION_REPLACE_TOKEN, CODE_TSM_002, SNIPPET_CTOR],
    'TSM-ARGS-001': [ACTION_SPLIT_FUNCTION, CODE_TSM_003, SNIPPET_ARGS],
    'TSM-SPREAD-001': [ACTION_REPLACE_TOKEN, CODE_TSM_004, SNIPPET_SPREAD],
    'TSM-INCLUDES-001': [ACTION_REPLACE_TOKEN, CODE_TSM_005, SNIPPET_INCLUDES],
    'TSM-SUBSTR-001': [ACTION_REPLACE_TOKEN, CODE_TSM_006, SNIPPET_SUBSTR],
    'TSM-REPLACE-001': [ACTION_REPLACE_TOKEN, CODE_TSM_007, SNIPPET_REPLACE],
    'TSM-ANY-001': [ACTION_REPLACE_TOKEN, CODE_TSM_008, SNIPPET_ANY],
    'TSM-TYPE-001': [ACTION_REPLACE_TOKEN, CODE_TSM_009, SNIPPET_TYPE],
    'TSM-REQUIRE-001': [ACTION_REPLACE_TOKEN, CODE_TSM_010, SNIPPET_REQUIRE],
    'TSM-DISP-001': [ACTION_APPLY_GUARD, CODE_TSM_011, SNIPPET_DISP],
};

const TSM_ACTIONABLE_MAP: Record<
    string,
    { action: AgentActionType; code: string; safeToAutomate: boolean; templateSnippet: string }
> = Object.fromEntries(
    Object.entries(TSM_ACTION_TUPLES).map(([rule, [action, code, templateSnippet]]) => [
        rule,
        { action, code, safeToAutomate: false, templateSnippet },
    ]),
);

interface TsModernIssueOptions {
    readonly file: string;
    readonly lineIndex: number;
    readonly rule: string;
    readonly severity: Severity;
    readonly message: string;
    readonly suggestion: string;
    readonly detail: Record<string, unknown>;
    readonly column: number;
}

function makeIssue(options: TsModernIssueOptions): Issue {
    const { file, lineIndex, rule, severity, message, suggestion, detail, column } = options;
    const line = lineIndex + 1;
    const mapped = TSM_ACTIONABLE_MAP[rule];
    const actionable = mapped
        ? {
              action: mapped.action,
              code: mapped.code,
              safeToAutomate: mapped.safeToAutomate,
              templateSnippet: mapped.templateSnippet,
          }
        : undefined;

    return buildCanonicalIssue({
        analyzer: ANALYZER_TYPESCRIPT_MODERN,
        rule,
        file,
        line,
        column,
        severity,
        message,
        suggestion,
        detail,
        actionable,
    });
}

/**
 * Count the non-overlapping matches of a pattern in one masked line.
 *
 * @param code - Masked line to search.
 * @param pattern - Global or non-global pattern; a copy with the `g` flag is used internally.
 * @returns Number of matches.
 */
function countMatches(code: string, pattern: RegExp): number {
    pattern.lastIndex = 0;
    return code.match(pattern)?.length ?? 0;
}

const REGEX_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
const REGEX_MATCH_SUBSTITUTION = '\\$&';

/**
 * Escape the characters that are special to a regular expression.
 *
 * @param text - Literal text (an imported identifier).
 * @returns Text safe to interpolate into a pattern.
 */
function escapeRegExp(text: string): string {
    return text.replace(REGEX_ESCAPE_RE, REGEX_MATCH_SUBSTITUTION);
}

/** TypeScript/JavaScript modernization pack: ten rules over a masked view of the file. */
export class TsModernAnalyzer implements Analyzer {
    name = ANALYZER_TYPESCRIPT_MODERN;

    /**
     * Streaming-path entry point: the engine invokes this once per file. Content-only analyzers
     * must expose it, because the legacy `analyze` path exists for the TS-family adapters only.
     *
     * @param ctx - Analyzer context carrying the file content and path.
     * @returns All findings for the file.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    /**
     * Scan one TypeScript/JavaScript file for modernization findings.
     *
     * @param _sf - Unused TypeScript source file (kept for the analyzer contract).
     * @param ctx - Analyzer context carrying the file content and path.
     * @returns All findings for the file.
     */
    analyze(_sf: unknown, ctx: AnalyzerContext): Issue[] {
        const file = ctx.filePath.replace(/\\/g, '/');
        if (!this.checkAcceptance(file)) return [];
        const content = ctx.content || '';
        if (content.length === 0) return [];
        const { raw, masked } = maskSourceText(content, TS_MASK);
        const out: Issue[] = [];

        this.reportLineRules(masked, file, out);
        this.reportRequireCalls(masked, file, out);
        this.reportStringPatternReplace(masked, raw, file, out);
        this.reportDisposableLeaks(masked, file, out);
        if (this.isTyped(file)) {
            this.reportExplicitAny(masked, file, out);
            this.reportTypeOnlyImports(masked, raw, file, out);
        }
        return out;
    }

    /**
     * Report isolated Disposable creations / event registrations that are not
     * tracked in subscriptions.
     */
    private reportDisposableLeaks(masked: string[], file: string, out: Issue[]): void {
        const ISOLATED_DISPOSABLE_RE =
            /^\s*(?:vscode\.(?:window|workspace|languages|commands)\.(?:onDidChange[A-Za-z0-9_]+|onDidOpen[A-Za-z0-9_]+|onDidClose[A-Za-z0-9_]+|onDidSave[A-Za-z0-9_]+|registerCommand|registerTextEditorCommand)|setInterval)\s*\(/;

        let openParenDepth = 0;
        for (let i = 0; i < masked.length; i++) {
            const line = masked[i];
            const trimmed = line.trim();
            if (trimmed.length === 0) continue;

            const isStartOfDisposable = ISOLATED_DISPOSABLE_RE.test(line);
            const notPassedAsArg = !isArgOnPreviousLine(masked, i);
            if (isStartOfDisposable && openParenDepth === 0 && notPassedAsArg) {
                const m = line.match(ISOLATED_DISPOSABLE_RE)!;
                const col = findFirstNonWhitespaceColumn(line);
                out.push(
                    makeIssue({
                        file,
                        lineIndex: i,
                        rule: 'TSM-DISP-001',
                        severity: SEVERITY_WARNING,
                        message:
                            'Disposable resource/listener created in isolated statement without tracking in subscriptions.',
                        suggestion:
                            'Pass to `context.subscriptions.push(...)` or store in a Disposable collection to prevent memory leaks.',
                        detail: { matched: m[0].trim() },
                        column: col,
                    }),
                );
            }

            openParenDepth = updateOpenParenDepth(line, openParenDepth);
        }
    }

    /**
     * Report whether the pack accepts this path.
     *
     * @param file - Normalized repository-relative path.
     * @returns True for a supported extension that is not a declaration file.
     */
    private checkAcceptance(file: string): boolean {
        if (file.endsWith(DECLARATION_SUFFIX)) return false;
        return SUPPORTED_EXTENSIONS.some((extension) => file.endsWith(extension));
    }

    /**
     * Report whether the file can carry type annotations.
     *
     * @param file - Normalized repository-relative path.
     * @returns True for TypeScript sources (declaration files are already filtered out).
     */
    private isTyped(file: string): boolean {
        return TYPED_EXTENSIONS.some((extension) => file.endsWith(extension));
    }

    private applyLineRulesToCode(code: string, file: string, index: number, out: Issue[]): void {
        for (const rule of LINE_RULES) {
            if (!rule.pattern.test(code)) continue;
            out.push(
                makeIssue({
                    file,
                    lineIndex: index,
                    rule: rule.rule,
                    severity: rule.severity,
                    message: rule.message,
                    suggestion: rule.suggestion,
                    detail: { line: code.trim() },
                    column: 1,
                }),
            );
        }
    }

    /**
     * Run the keyword rules over every masked line.
     *
     * @param masked - Masked lines.
     * @param file - Normalized repository-relative path.
     * @param out - Finding sink.
     */
    private reportLineRules(masked: string[], file: string, out: Issue[]): void {
        for (let index = 0; index < masked.length; index += 1) {
            const code = masked[index];
            if (code.trim().length === 0) continue;
            this.applyLineRulesToCode(code, file, index, out);
        }
    }

    /**
     * Report CommonJS `require` calls inside a module that already uses ESM syntax.
     *
     * A module that is deliberately CommonJS keeps its `require` calls: only the mixed style is a
     * modernization finding, which is what makes this rule quiet on legacy scripts.
     *
     * @param masked - Masked lines.
     * @param file - Normalized repository-relative path.
     * @param out - Finding sink.
     */
    private reportRequireCalls(masked: string[], file: string, out: Issue[]): void {
        if (!ESM_SYNTAX_RE.test(masked.join('\n'))) return;
        for (let index = 0; index < masked.length; index += 1) {
            const code = masked[index];
            if (!REQUIRE_CALL_RE.test(code)) continue;
            out.push(
                makeIssue({
                    file,
                    lineIndex: index,
                    rule: RULE_TSM_REQUIRE,
                    severity: SEVERITY_WARNING,
                    message: 'CommonJS `require` in a module that already uses ESM syntax.',
                    suggestion:
                        'Import the binding (`import x from "m"` / `import { y } from "m"`) instead.',
                    detail: { line: code.trim() },
                    column: 1,
                }),
            );
        }
    }

    /**
     * Report `replace('literal', …)` calls, which rewrite only the first occurrence.
     *
     * The masked line proves the call is real code, the raw line proves the first argument is a
     * string literal; together they distinguish `text.replace('a', 'b')` from a call whose
     * pattern is a variable or a regular expression.
     *
     * @param masked - Masked lines.
     * @param raw - Raw lines (quotes intact).
     * @param file - Normalized repository-relative path.
     * @param out - Finding sink.
     */
    private reportStringPatternReplace(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        for (let index = 0; index < masked.length; index += 1) {
            if (!REPLACE_CALL_RE.test(masked[index])) continue;
            const match = REPLACE_LITERAL_RE.exec(raw[index]);
            if (!match) continue;
            out.push(
                makeIssue({
                    file,
                    lineIndex: index,
                    rule: RULE_TSM_REPLACE,
                    severity: SEVERITY_INFO,
                    message: '`replace` with a string pattern rewrites only the first occurrence.',
                    suggestion:
                        'Use `replaceAll(pattern, value)` when every occurrence should change.',
                    detail: { line: masked[index].trim(), quote: match[1] },
                    column: match.index + 1,
                }),
            );
        }
    }

    /**
     * Report explicit `any` used in a type position.
     *
     * @param masked - Masked lines.
     * @param file - Normalized repository-relative path.
     * @param out - Finding sink.
     */
    private reportExplicitAny(masked: string[], file: string, out: Issue[]): void {
        for (let index = 0; index < masked.length; index += 1) {
            const code = masked[index];
            if (code.trim().length === 0 || !ANY_TYPE_RE.test(code)) continue;
            out.push(
                makeIssue({
                    file,
                    lineIndex: index,
                    rule: 'TSM-ANY-001',
                    severity: SEVERITY_WARNING,
                    message: 'Explicit `any` disables checking for every value it touches.',
                    suggestion:
                        'Prefer `unknown` plus a narrowing check, or a precise generic/union type.',
                    detail: { line: code.trim() },
                    column: 1,
                }),
            );
        }
    }

    /**
     * Report named imports whose identifiers only ever appear in type positions.
     *
     * The check is deliberately conservative: a single value-position occurrence (a call, a
     * `new`, a member access or a plain reference) clears the import, so the rule proposes
     * `import type` only when the evidence is unambiguous.
     *
     * @param masked - Masked lines.
     * @param raw - Raw lines (quotes intact), used for the reported evidence text.
     * @param file - Normalized repository-relative path.
     * @param out - Finding sink.
     */
    private reportTypeOnlyImports(
        masked: string[],
        raw: string[],
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
            out.push(
                makeIssue({
                    file,
                    lineIndex,
                    rule: 'TSM-TYPE-001',
                    severity: SEVERITY_INFO,
                    message: `Named ${label} used only as a type: ${typeOnly.join(', ')}.`,
                    suggestion:
                        'Mark the clause `import type { … }` so the binding is erased at compile time.',
                    detail: { line: raw[lineIndex].trim(), names: typeOnly },
                    column: 1,
                }),
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

    /**
     * Accumulate type usage occurrences across candidate lines.
     *
     * @param candidateIndices - Iterable of line indexes to scan.
     * @param scope - Bundled file masking, import index, and compiled pattern scope.
     * @param mustTestFallbackWord - Whether to pre-test fallback word before full pattern matching.
     * @returns Total matches and type-position matches across the candidate lines.
     */
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

    /**
     * Decide whether one imported identifier is used exclusively in type positions.
     *
     * @param name - Imported local identifier.
     * @param masked - Masked lines.
     * @param importLines - Line indexes holding import clauses, excluded from the usage scan.
     * @param lineIndexByWord - Pre-indexed line occurrences per candidate identifier.
     * @returns True when the identifier appears at least once and never in a value position.
     */
    private isTypeOnlyName(
        name: string,
        masked: string[],
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

function collectImportClauses(masked: string[], importLines: Set<number>): ImportClauseRecord[] {
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
    readonly masked: string[];
    readonly importLines: Set<number>;
    readonly patterns: CompiledTypePatterns;
}

interface CompiledTypePatterns {
    word: RegExp;
    fallbackWord: RegExp;
    typePatterns: RegExp[];
}

interface UsageScanScope {
    readonly masked: string[];
    readonly importLines: Set<number>;
    readonly patterns: CompiledTypePatterns;
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
    masked: string[],
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

function isArgOnPreviousLine(masked: string[], start: number): boolean {
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
