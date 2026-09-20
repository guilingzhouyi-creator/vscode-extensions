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
import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_INFO } from '../core/types';
import { ANALYZER_TYPESCRIPT_MODERN } from '../core/scoring/dimensionLiterals';
import { maskSourceText, type SourceMaskConfig } from '../core/source-mask';

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

/** Explicit `any` in a type position, where `unknown` keeps the same call sites type-safe. */
const ANY_TYPE_RE = /(?::\s*any\b)|(?:\bas\s+any\b)|(?:<\s*any\s*>)|(?:\bany\s*\[\s*\])/;

/** Named import clause without the `type` modifier; the specifier is masked out beforehand. */
const NAMED_IMPORT_RE = /^\s*import\s+(?:type\s+)?\{([^}]*)\}\s+from\s/;

/** Comment/literal syntax of the TS/JS family, handed to the shared source masker. */
const TS_MASK: SourceMaskConfig = {
    lineComment: '//',
    blockComment: { open: '/*', close: '*/' },
    quoteChars: '"\'`',
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
        rule: 'TSM-INCLUDES-001',
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
function makeIssue(
    file: string,
    lineIndex: number,
    rule: string,
    severity: Severity,
    message: string,
    suggestion: string,
    detail: Record<string, unknown>,
    column: number,
): Issue {
    const line = lineIndex + 1;
    return {
        id: `${ANALYZER_TYPESCRIPT_MODERN}:${rule}:${file}:${line}`,
        analyzer: ANALYZER_TYPESCRIPT_MODERN,
        rule,
        severity,
        message,
        location: { file, start: { line, column }, end: { line, column } },
        detail,
        suggestion,
    };
}

/**
 * Count the non-overlapping matches of a pattern in one masked line.
 *
 * @param code - Masked line to search.
 * @param pattern - Global or non-global pattern; a copy with the `g` flag is used internally.
 * @returns Number of matches.
 */
function countMatches(code: string, pattern: RegExp): number {
    const global = new RegExp(
        pattern.source,
        pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
    );
    return code.match(global)?.length ?? 0;
}

/**
 * Escape the characters that are special to a regular expression.
 *
 * @param text - Literal text (an imported identifier).
 * @returns Text safe to interpolate into a pattern.
 */
function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        if (!this.accepts(file)) return [];
        const content = ctx.content || '';
        if (content.length === 0) return [];
        const { raw, masked } = maskSourceText(content, TS_MASK);
        const out: Issue[] = [];

        this.reportLineRules(masked, file, out);
        this.reportRequireCalls(masked, file, out);
        this.reportStringPatternReplace(masked, raw, file, out);
        if (this.isTyped(file)) {
            this.reportExplicitAny(masked, file, out);
            this.reportTypeOnlyImports(masked, raw, file, out);
        }
        return out;
    }

    /**
     * Report whether the pack accepts this path.
     *
     * @param file - Normalized repository-relative path.
     * @returns True for a supported extension that is not a declaration file.
     */
    private accepts(file: string): boolean {
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
            for (const rule of LINE_RULES) {
                if (!rule.pattern.test(code)) continue;
                out.push(
                    makeIssue(
                        file,
                        index,
                        rule.rule,
                        rule.severity,
                        rule.message,
                        rule.suggestion,
                        {
                            line: code.trim(),
                        },
                        1,
                    ),
                );
            }
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
                makeIssue(
                    file,
                    index,
                    'TSM-REQUIRE-001',
                    SEVERITY_WARNING,
                    'CommonJS `require` in a module that already uses ESM syntax.',
                    'Import the binding (`import x from "m"` / `import { y } from "m"`) instead.',
                    { line: code.trim() },
                    1,
                ),
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
            if (!masked[index].includes('.replace(')) continue;
            const match = REPLACE_LITERAL_RE.exec(raw[index]);
            if (!match) continue;
            out.push(
                makeIssue(
                    file,
                    index,
                    'TSM-REPLACE-001',
                    SEVERITY_INFO,
                    '`replace` with a string pattern rewrites only the first occurrence.',
                    'Use `replaceAll(pattern, value)` when every occurrence should change.',
                    { line: masked[index].trim(), quote: match[1] },
                    match.index + 1,
                ),
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
                makeIssue(
                    file,
                    index,
                    'TSM-ANY-001',
                    SEVERITY_WARNING,
                    'Explicit `any` disables checking for every value it touches.',
                    'Prefer `unknown` plus a narrowing check, or a precise generic/union type.',
                    { line: code.trim() },
                    1,
                ),
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
        for (const index of importLines) {
            const clause = NAMED_IMPORT_RE.exec(masked[index]);
            if (!clause) continue;
            const names = clause[1]
                .split(',')
                .map(
                    (binding) =>
                        binding
                            .trim()
                            .split(/\s+as\s+/)
                            .pop() ?? '',
                )
                .map((name) => name.trim())
                .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
            const typeOnly = names.filter((name) => this.isTypeOnlyName(name, masked, importLines));
            if (typeOnly.length === 0) continue;
            const label = typeOnly.length > 1 ? 'imports' : 'import';
            out.push(
                makeIssue(
                    file,
                    index,
                    'TSM-TYPE-001',
                    SEVERITY_INFO,
                    `Named ${label} used only as a type: ${typeOnly.join(', ')}.`,
                    'Mark the clause `import type { … }` so the binding is erased at compile time.',
                    { line: raw[index].trim(), names: typeOnly },
                    1,
                ),
            );
        }
    }

    /**
     * Decide whether one imported identifier is used exclusively in type positions.
     *
     * @param name - Imported local identifier.
     * @param masked - Masked lines.
     * @param importLines - Line indexes holding import clauses, excluded from the usage scan.
     * @returns True when the identifier appears at least once and never in a value position.
     */
    private isTypeOnlyName(name: string, masked: string[], importLines: Set<number>): boolean {
        const escaped = escapeRegExp(name);
        const word = new RegExp(`\\b${escaped}\\b`);
        const typePatterns = [
            new RegExp(`:\\s*${escaped}\\b`),
            new RegExp(`\\bas\\s+${escaped}\\b`),
            new RegExp(`<\\s*${escaped}\\s*[,>]`),
            new RegExp(`\\bextends\\s+${escaped}\\b`),
            new RegExp(`\\bimplements\\s+${escaped}\\b`),
            new RegExp(`[|&]\\s*${escaped}\\b`),
            new RegExp(`\\b${escaped}\\s*[|&]`),
            new RegExp(`\\b${escaped}\\s*\\[\\s*\\]`),
        ];
        let total = 0;
        let typed = 0;
        for (let index = 0; index < masked.length; index += 1) {
            if (importLines.has(index)) continue;
            const code = masked[index];
            total += countMatches(code, word);
            for (const pattern of typePatterns) typed += countMatches(code, pattern);
        }
        return total > 0 && typed >= total;
    }
}
