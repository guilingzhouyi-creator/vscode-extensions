/**
 * Module: Core Engine — Source Masking for Content-Oriented Analyzers
 * File Path: src/core/sourceMask.ts
 * Architecture Role: Shared lexical helper for every analyzer that scans file CONTENT instead of a
 *     parsed AST (the language modernization packs and the governance rule families); it knows just
 *     enough syntax to blank out comments and literals without moving a single character, and it is
 *     the single place that maps a language or a file extension to that syntax.
 * Dependencies & Triggers: core types only; imported by `src/analyzers/*Modern.ts`, by the
 *     governance analyzer, and by content heuristics such as `core/intelligence/dataFlow.ts`.
 * Responsibilities: Split file content into raw lines and a same-length masked copy where comment,
 *     string/template and (opt-in) regular-expression bodies are spaces; carry block-comment/quote
 *     state across lines so multi-line constructs stay masked; publish the per-language comment,
 *     quote and regex syntax as data plus the extension-to-language mapping, so no caller invents
 *     its own lexical stripping.
 * Exit Semantics & Design Rationale: Pure and total — it never throws and never reorders or drops a
 *     character, so reported columns keep pointing at the real source. Masking is deliberately
 *     lexical, not a parser. Regular-expression literals are modelled only when a preset opts in
 *     (`regexLiterals`), because `/` is ambiguous with division: the opt-in presets buy accuracy
 *     for the C family, while the default keeps the helper small enough to trust. A `#` or `//`
 *     inside a literal can only be seen once strings are masked, so callers must read the masked
 *     view rather than re-deriving a cleaned line from the raw text.
 */

/** Comment and literal syntax of one language family. */
export interface SourceMaskConfig {
    /** Line-comment prefix (`//` for the C family, `#` for Python/GDScript). */
    lineComment: string;
    /** Block-comment open/close pair, when the language has block comments. */
    blockComment?: { open: string; close: string };
    /** Characters that open a string or template literal; each is closed by itself. */
    quoteChars: string;
    /** True when a template literal (backtick) may span lines, keeping the quote open. */
    multilineTemplates?: boolean;
    /**
     * True to also blank regular-expression literals (`/.../flags`).
     *
     * Off by default: `/` is ambiguous with division, so the disambiguation is a heuristic and
     * opt-in. Enable it for languages whose source routinely embeds regexes, or a rule that counts
     * operators/braces will read a regex body as code.
     */
    regexLiterals?: boolean;
}

/** Raw lines plus the masked view used by the keyword rules. */
export interface MaskedSource {
    /** Source lines with the trailing carriage return removed. */
    raw: string[];
    /** Same-length copy of each line with comment/literal bodies replaced by spaces. */
    masked: string[];
}

/** Canonical language id for TypeScript sources. */
export const MASK_LANGUAGE_TYPESCRIPT = 'typescript';
/** Canonical language id for JavaScript sources. */
export const MASK_LANGUAGE_JAVASCRIPT = 'javascript';
/** Canonical language id for Python sources. */
export const MASK_LANGUAGE_PYTHON = 'python';
/** Canonical language id for GDScript sources. */
export const MASK_LANGUAGE_GDSCRIPT = 'gdscript';
/** Canonical language id for Rust sources. */
export const MASK_LANGUAGE_RUST = 'rust';
/** Canonical language id for POSIX shell sources. */
export const MASK_LANGUAGE_SHELL = 'shell';
/** Canonical language id for PowerShell sources. */
export const MASK_LANGUAGE_POWERSHELL = 'powershell';

/** The C-family syntax shared by TypeScript and JavaScript. */
const C_FAMILY_MASK: SourceMaskConfig = {
    lineComment: '//',
    blockComment: { open: '/*', close: '*/' },
    quoteChars: '\'"`',
    multilineTemplates: true,
    regexLiterals: true,
};

/**
 * Comment, quote and regex syntax per canonical language id.
 *
 * Quote sets deliberately mirror each language pack's own choice so one language never gets two
 * different masking policies: Rust omits `'` because char literals and lifetimes would otherwise
 * swallow the rest of the line, and only the C family opts into regex literals.
 */
export const SOURCE_MASK_PRESETS: Record<string, SourceMaskConfig> = {
    [MASK_LANGUAGE_TYPESCRIPT]: C_FAMILY_MASK,
    [MASK_LANGUAGE_JAVASCRIPT]: C_FAMILY_MASK,
    [MASK_LANGUAGE_PYTHON]: { lineComment: '#', quoteChars: '\'"' },
    [MASK_LANGUAGE_GDSCRIPT]: { lineComment: '#', quoteChars: '\'"`' },
    [MASK_LANGUAGE_RUST]: {
        lineComment: '//',
        blockComment: { open: '/*', close: '*/' },
        quoteChars: '"',
    },
    [MASK_LANGUAGE_SHELL]: { lineComment: '#', quoteChars: '\'"' },
    [MASK_LANGUAGE_POWERSHELL]: {
        lineComment: '#',
        blockComment: { open: '<#', close: '#>' },
        quoteChars: '\'"',
    },
};

/** Fallback syntax for a language this module does not know: the C family without regex support. */
const DEFAULT_MASK: SourceMaskConfig = {
    lineComment: '//',
    blockComment: { open: '/*', close: '*/' },
    quoteChars: '\'"`',
    multilineTemplates: true,
};

/** File extension to canonical language id, for callers that only have a path. */
const EXTENSION_LANGUAGE: Record<string, string> = {
    '.ts': MASK_LANGUAGE_TYPESCRIPT,
    '.tsx': MASK_LANGUAGE_TYPESCRIPT,
    '.mts': MASK_LANGUAGE_TYPESCRIPT,
    '.cts': MASK_LANGUAGE_TYPESCRIPT,
    '.js': MASK_LANGUAGE_JAVASCRIPT,
    '.jsx': MASK_LANGUAGE_JAVASCRIPT,
    '.mjs': MASK_LANGUAGE_JAVASCRIPT,
    '.cjs': MASK_LANGUAGE_JAVASCRIPT,
    '.py': MASK_LANGUAGE_PYTHON,
    '.gd': MASK_LANGUAGE_GDSCRIPT,
    '.rs': MASK_LANGUAGE_RUST,
    '.sh': MASK_LANGUAGE_SHELL,
    '.bash': MASK_LANGUAGE_SHELL,
    '.ps1': MASK_LANGUAGE_POWERSHELL,
};

/** Characters that, immediately before a `/`, mean the slash opens a regex literal. */
const REGEX_PREFIX_CHARS = '([{,=:!&|?;+-*%<>';

/** Flag characters consumed after a regex literal's closing slash. */
const REGEX_FLAG_RE = /[a-z]/i;

/**
 * Split content into raw lines and a masked copy, keeping every index in place.
 *
 * @param content - Full file content as read from disk.
 * @param config - Comment and quote syntax of the language being scanned.
 * @returns Both views; `raw` feeds evidence text, `masked` feeds the rule patterns.
 */
export function maskSourceText(content: string, config: SourceMaskConfig): MaskedSource {
    const raw = content.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
    const state: MaskState = { inBlockComment: false, quote: null };
    return { raw, masked: raw.map((line) => maskLine(line, state, config)) };
}

/**
 * Resolve a file path to a canonical language id.
 *
 * @param filePath - Path of the source file, in any separator style.
 * @returns The canonical language id, or null when the extension is not mapped.
 */
export function languageIdFromPath(filePath: string): string | null {
    const lower = filePath.replace(/\\/g, '/').toLowerCase();
    const slash = lower.lastIndexOf('/');
    const dot = lower.lastIndexOf('.');
    if (dot <= slash) return null;
    return EXTENSION_LANGUAGE[lower.slice(dot)] ?? null;
}

/**
 * Resolve the masking syntax for a language id.
 *
 * @param languageId - Canonical language id, or null/undefined when it is unknown.
 * @returns The preset for that language, or the C-family default.
 */
export function maskPresetForLanguage(languageId: string | null | undefined): SourceMaskConfig {
    if (!languageId) return DEFAULT_MASK;
    return SOURCE_MASK_PRESETS[languageId] ?? DEFAULT_MASK;
}

/**
 * Build the masked view of a file, resolving the syntax from a language id when one is known.
 *
 * This is the single entry point content-oriented rules should use: it guarantees that comments,
 * string literals and (for the C family) regex literals are blanked before any rule pattern runs,
 * and that the mask is resolved from one shared table instead of per-rule heuristics.
 *
 * @param content - Full file content as read from disk.
 * @param languageId - Canonical language id, or null to fall back to extension/preset inference.
 * @returns One masked string per line, each the same length as its raw line.
 */
export function maskedLinesOf(content: string, languageId: string | null | undefined): string[] {
    return maskSourceText(content, maskPresetForLanguage(languageId)).masked;
}

/**
 * Build the masked view of a file from its path alone.
 *
 * Convenience wrapper for callers that receive a path and content but no resolved language id.
 *
 * @param filePath - Path of the source file, used to infer the language.
 * @param content - Full file content as read from disk.
 * @returns One masked string per line, each the same length as its raw line.
 */
export function maskedLinesOfPath(filePath: string, content: string): string[] {
    return maskedLinesOf(content, languageIdFromPath(filePath));
}

/** Masking state carried across lines: block comments and template literals span lines. */
interface MaskState {
    /** True while inside an unterminated block comment. */
    inBlockComment: boolean;
    /** Active quote character, or null when scanning ordinary code. */
    quote: string | null;
}

/** Trigger-character matcher per config, built once because presets are module constants. */
const TRIGGER_CACHE = new WeakMap<SourceMaskConfig, RegExp>();

/**
 * Build the matcher for every character that could OPEN a comment, a literal or a regex.
 *
 * The set is derived from the config rather than hardcoded: a `#` line comment must count for
 * Python and GDScript, and `<#` for PowerShell, or those languages would take the fast path on a
 * line whose comment was never blanked.
 *
 * @param config - Comment and quote syntax of the language.
 * @returns A single-character-class matcher, tested once per line.
 */
function triggerRegex(config: SourceMaskConfig): RegExp {
    const cached = TRIGGER_CACHE.get(config);
    if (cached) return cached;

    // A degenerate config with no line-comment prefix would blank whole lines, so it must never
    // take the fast path: an always-matching pattern keeps it on the general path.
    if (!config.lineComment) {
        const never = /(?:)/;
        TRIGGER_CACHE.set(config, never);
        return never;
    }

    const chars = new Set<string>();
    for (const char of config.quoteChars) chars.add(char);
    chars.add(config.lineComment[0]);
    if (config.blockComment) chars.add(config.blockComment.open[0]);
    if (config.regexLiterals) chars.add('/');

    const escaped = [...chars]
        .map((char) => char.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'))
        .join('');
    const built = new RegExp(`[${escaped}]`);
    TRIGGER_CACHE.set(config, built);
    return built;
}

/**
 * Mask one raw line in place.
 *
 * @param line - Raw source line without its trailing carriage return.
 * @param state - Masking state, mutated so multi-line constructs continue on later lines.
 * @param config - Comment and quote syntax of the language.
 * @returns A same-length copy whose comment and literal characters are spaces.
 */
function maskLine(line: string, state: MaskState, config: SourceMaskConfig): string {
    // Fast path: with no multi-line construct active and nothing on the line able to open one,
    // masking is the identity.
    if (!state.quote && !state.inBlockComment && !triggerRegex(config).test(line)) return line;

    // Fast path: line is wholly inside a block comment and contains no closing delimiter.
    const close = config.blockComment?.close ?? '';
    if (state.inBlockComment && !state.quote && close.length > 0 && !line.includes(close)) {
        return ' '.repeat(line.length);
    }

    const out = line.split('');
    let index = 0;
    while (index < line.length) {
        if (state.quote) {
            index = maskQuoted(line, index, state, out);
            continue;
        }
        if (state.inBlockComment) {
            index = maskBlockComment(line, index, state, out, config);
            continue;
        }
        index = maskCode(line, index, state, out, config);
    }
    return out.join('');
}

/**
 * Blank one string/template step and return the next index.
 *
 * @param line - Raw source line.
 * @param index - Index of the current character, known to be inside a quoted run.
 * @param state - Masking state; the quote is cleared when the closing quote is reached.
 * @param out - Character buffer being masked in place.
 * @returns Index of the next unprocessed character.
 */
function maskQuoted(line: string, index: number, state: MaskState, out: string[]): number {
    out[index] = ' ';
    const char = line[index];
    if (char === '\\') {
        if (index + 1 < line.length) out[index + 1] = ' ';
        return index + 2;
    }
    if (char === state.quote) state.quote = null;
    return index + 1;
}

/**
 * Blank one block-comment step and return the next index.
 *
 * @param line - Raw source line.
 * @param index - Index of the current character, known to be inside a block comment.
 * @param state - Masking state; cleared when the terminator is reached.
 * @param out - Character buffer being masked in place.
 * @param config - Comment syntax supplying the terminator.
 * @returns Index of the next unprocessed character.
 */
function maskBlockComment(
    line: string,
    index: number,
    state: MaskState,
    out: string[],
    config: SourceMaskConfig,
): number {
    const close = config.blockComment?.close ?? '';
    out[index] = ' ';
    if (close.length > 0 && line.startsWith(close, index)) {
        for (let offset = 0; offset < close.length; offset += 1) out[index + offset] = ' ';
        state.inBlockComment = false;
        return index + close.length;
    }
    return index + 1;
}

/**
 * Decide whether a slash opens a regex literal rather than dividing.
 *
 * Only consulted when `config.regexLiterals` is set. A slash can open a literal when the previous
 * non-blank character cannot end a complete operand; anything else (`identifier`, `)`, `]`, `}`,
 * digit) means division, and the slash is left as written.
 *
 * @param line - Raw source line.
 * @param index - Index of the slash.
 * @returns True when the slash opens a regex literal.
 */
function opensRegexLiteral(line: string, index: number): boolean {
    for (let back = index - 1; back >= 0; back -= 1) {
        const char = line[back];
        if (char === ' ' || char === '\t') continue;
        return REGEX_PREFIX_CHARS.includes(char);
    }
    return true;
}

/**
 * Blank one regex literal and return the next index.
 *
 * The body ends at the first unescaped slash outside a `[...]` character class; trailing flags are
 * consumed too. An unterminated literal blanks the remainder of the line, so regex text can never
 * leak operators into a counting rule. Regex literals cannot span lines, so no state is returned.
 *
 * @param line - Raw source line.
 * @param index - Index of the opening slash.
 * @param out - Character buffer being masked in place.
 * @returns Index of the next unprocessed character.
 */
function maskRegexBody(line: string, index: number, out: string[]): number {
    out[index] = ' ';
    let cursor = index + 1;
    let inClass = false;
    while (cursor < line.length) {
        const char = line[cursor];
        out[cursor] = ' ';
        if (char === '\\') {
            if (cursor + 1 < line.length) out[cursor + 1] = ' ';
            cursor += 2;
            continue;
        }
        if (char === '[') inClass = true;
        else if (char === ']') inClass = false;
        else if (char === '/' && !inClass) {
            cursor += 1;
            while (cursor < line.length && REGEX_FLAG_RE.test(line[cursor])) {
                out[cursor] = ' ';
                cursor += 1;
            }
            return cursor;
        }
        cursor += 1;
    }
    return cursor;
}

/**
 * Attempts to open a line comment or block comment at index.
 * Returns the new index if a comment opened, or -1 otherwise.
 */
function tryOpenComment(
    line: string,
    index: number,
    state: MaskState,
    out: string[],
    config: SourceMaskConfig,
): number {
    if (line.startsWith(config.lineComment, index)) {
        for (let rest = index; rest < line.length; rest += 1) out[rest] = ' ';
        return line.length;
    }
    const block = config.blockComment;
    if (block && line.startsWith(block.open, index)) {
        for (let offset = 0; offset < block.open.length; offset += 1) out[index + offset] = ' ';
        state.inBlockComment = true;
        return index + block.open.length;
    }
    return -1;
}

/**
 * Consume one step of ordinary code: comments and literals open a masked run, everything else is
 * left as written.
 *
 * @param line - Raw source line.
 * @param index - Index of the current character, known to be outside strings and comments.
 * @param state - Masking state, updated when a comment or literal starts.
 * @param out - Character buffer being masked in place.
 * @param config - Comment and quote syntax of the language.
 * @returns Index of the next unprocessed character.
 */
function maskCode(
    line: string,
    index: number,
    state: MaskState,
    out: string[],
    config: SourceMaskConfig,
): number {
    const commentEnd = tryOpenComment(line, index, state, out, config);
    if (commentEnd !== -1) return commentEnd;

    const char = line[index];
    if (config.regexLiterals && char === '/' && opensRegexLiteral(line, index)) {
        return maskRegexBody(line, index, out);
    }
    if (config.quoteChars.includes(char)) {
        state.quote = char === '`' && !config.multilineTemplates ? null : char;
        out[index] = ' ';
        return index + 1;
    }
    return index + 1;
}
