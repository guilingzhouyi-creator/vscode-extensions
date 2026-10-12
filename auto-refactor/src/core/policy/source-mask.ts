/**
 * Module: Core Engine — Source Masking for Content-Oriented Analyzers
 * File Path: src/core/policy/source-mask.ts
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
    /** True to also blank HTML comments (<!-- ... -->). */
    htmlComment?: boolean;
    /** True to recognize Rust raw string literals (r"...", r#"..."#). */
    rawStrings?: boolean;
}

import { nativeCore } from '../native/native-bridge';

/** Raw lines plus the masked view used by the keyword rules. */
export interface MaskedSource {
    /** Source lines with the trailing carriage return removed. */
    raw: string[];
    /** Same-length copy of each line with comment/literal bodies replaced by spaces. */
    masked: string[];
    /** Optional total line count computed during masking pass. */
    lines?: number;
    /** Optional non-blank line count computed during masking pass. */
    nonBlankLines?: number;
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
/** Canonical language id for Go sources. */
export const MASK_LANGUAGE_GO = 'go';
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
    htmlComment: true,
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
        rawStrings: true,
    },
    [MASK_LANGUAGE_GO]: {
        lineComment: '//',
        blockComment: { open: '/*', close: '*/' },
        quoteChars: '"`',
        multilineTemplates: true, // backtick raw strings can span lines
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
    '.go': MASK_LANGUAGE_GO,
    '.sh': MASK_LANGUAGE_SHELL,
    '.bash': MASK_LANGUAGE_SHELL,
    '.zsh': MASK_LANGUAGE_SHELL,
    '.ps1': MASK_LANGUAGE_POWERSHELL,
    '.psm1': MASK_LANGUAGE_POWERSHELL,
    '.psd1': MASK_LANGUAGE_POWERSHELL,
    '.html': MASK_LANGUAGE_JAVASCRIPT,
    '.htm': MASK_LANGUAGE_JAVASCRIPT,
    '.vue': MASK_LANGUAGE_TYPESCRIPT,
    '.svelte': MASK_LANGUAGE_TYPESCRIPT,
};

const ASCII_TABLE_SIZE = 128;
const CHAR_TAB = 9;
const CHAR_CR = 13;
const CHAR_SPACE = 32;
const CHAR_DOUBLE_QUOTE = 34;
const CHAR_HASH = 35;
const CHAR_SINGLE_QUOTE = 39;
const CHAR_ASTERISK = 42;
const CHAR_SLASH = 47;
const CHAR_DIGIT_0 = 48;
const CHAR_DIGIT_9 = 57;
const CHAR_LESS_THAN = 60;
const CHAR_UPPER_A = 65;
const CHAR_UPPER_Z = 90;
const CHAR_OPEN_BRACKET = 91;
const CHAR_BACKSLASH = 92;
const CHAR_CLOSE_BRACKET = 93;
const CHAR_UNDERSCORE = 95;
const CHAR_BACKTICK = 96;
const CHAR_LOWER_A = 97;
const CHAR_LOWER_B = 98;
const CHAR_LOWER_C = 99;
const CHAR_LOWER_R = 114;
const CHAR_LOWER_Z = 122;
const TRIGGER_DIRECT = 1;
const TRIGGER_RAW_PREFIX = 2;
const NATIVE_DISPATCH_MIN_LEN = 50000;
const HTML_COMMENT_OPEN = '<!--';
const HTML_COMMENT_CLOSE = '-->';
const DOUBLE_QUOTE_STR = '"';

/** Characters that, immediately before a `/`, mean the slash opens a regex literal. */
const REGEX_PREFIX_TABLE = (() => {
    const table = new Uint8Array(ASCII_TABLE_SIZE);
    const chars = '([{,=:!&|?;+-*%<>';
    for (let i = 0; i < chars.length; i++) {
        table[chars.charCodeAt(i)] = TRIGGER_DIRECT;
    }
    return table;
})();

/**
 * Pure JavaScript implementation of source masking.
 *
 * Preserved as deterministic fallback when native operators are unavailable.
 *
 * @param content - Full file content as read from disk.
 * @param config - Comment and quote syntax of the language being scanned.
 * @returns Both views; `raw` feeds evidence text, `masked` feeds the rule patterns.
 */
export function maskSourceTextJs(content: string, config: SourceMaskConfig): MaskedSource {
    const lines = content.split('\n');
    const len = lines.length;
    const raw: string[] = [];
    raw.length = len;
    const masked: string[] = [];
    masked.length = len;
    const state: MaskState = {
        inBlockComment: false,
        quote: null,
        rawString: null,
        triggerTable: getTriggerTable(config),
        close: config.blockComment?.close ?? '',
    };
    for (let i = 0; i < len; i++) {
        let line = lines[i];
        if (line.length > 0 && line.charCodeAt(line.length - 1) === CHAR_CR) {
            line = line.slice(0, -1);
        }
        raw[i] = line;
        masked[i] = maskLine(line, state, config);
    }
    return { raw, masked };
}

/**
 * Split content into raw lines and a masked copy, keeping every index in place.
 *
 * Automatically dispatches to high-performance native SIMD operator when available,
 * falling back seamlessly to deterministic pure JS execution.
 *
 * @param content - Full file content as read from disk.
 * @param config - Comment and quote syntax of the language being scanned.
 * @returns Both views; `raw` feeds evidence text, `masked` feeds the rule patterns.
 */
export function maskSourceText(content: string, config: SourceMaskConfig): MaskedSource {
    if (content.length > NATIVE_DISPATCH_MIN_LEN) {
        try {
            return nativeCore.maskSourceCode(content, {
                lineComment: config.lineComment,
                blockCommentOpen: config.blockComment?.open,
                blockCommentClose: config.blockComment?.close,
                quoteChars: config.quoteChars,
                multilineTemplates: config.multilineTemplates,
                regexLiterals: config.regexLiterals,
            });
        } catch (_err) {
            return maskSourceTextJs(content, config);
        }
    }
    return maskSourceTextJs(content, config);
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
    return languageId ? (SOURCE_MASK_PRESETS[languageId] ?? DEFAULT_MASK) : DEFAULT_MASK;
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
    /** True while inside an unterminated HTML comment. */
    inHtmlComment?: boolean;
    /** Active quote character, or null when scanning ordinary code. */
    quote: string | null;
    /** Active raw string hash count, or null when scanning ordinary code. */
    rawString?: number | null;
    /** Precomputed 128-entry ASCII trigger table for the active config. */
    triggerTable: Uint8Array;
    /** Block-comment closing delimiter, or empty string if none. */
    close: string;
}

/** Trigger-character lookup table per config, built once per config instance. */
const TRIGGER_TABLE_CACHE = new WeakMap<SourceMaskConfig, Uint8Array>();

/**
 * Populate quote and raw-string trigger entries in the lookup table.
 */
function populateQuoteTriggers(table: Uint8Array, config: SourceMaskConfig): void {
    if (config.quoteChars.includes(DOUBLE_QUOTE_STR) || config.rawStrings) {
        table[CHAR_DOUBLE_QUOTE] = TRIGGER_DIRECT;
        table[CHAR_LOWER_B] = TRIGGER_RAW_PREFIX;
        table[CHAR_LOWER_C] = TRIGGER_RAW_PREFIX;
        table[CHAR_LOWER_R] = TRIGGER_RAW_PREFIX;
    }
    for (let i = 0; i < config.quoteChars.length; i++) {
        const code = config.quoteChars.charCodeAt(i);
        if (code < ASCII_TABLE_SIZE) table[code] = TRIGGER_DIRECT;
    }
}

/**
 * Build the 128-entry ASCII lookup table for characters that can open a comment, literal or regex.
 *
 * Entry value `1` marks direct trigger characters; `2` marks raw-string
 * prefix letters (`r`, `b`, `c`) that require an immediately following
 * `"` or `#` (or `r"`/`r#`).
 *
 * @param config - Comment and quote syntax of the language.
 * @returns A 128-byte lookup table cached by config identity.
 */
function getTriggerTable(config: SourceMaskConfig): Uint8Array {
    const cached = TRIGGER_TABLE_CACHE.get(config);
    if (cached) return cached;

    const table = new Uint8Array(ASCII_TABLE_SIZE);
    if (!config.lineComment) {
        table.fill(TRIGGER_DIRECT);
        TRIGGER_TABLE_CACHE.set(config, table);
        return table;
    }

    populateQuoteTriggers(table, config);
    const lineChar = config.lineComment.charCodeAt(0);
    if (lineChar < ASCII_TABLE_SIZE) table[lineChar] = TRIGGER_DIRECT;
    if (config.blockComment && config.blockComment.open.length > 0) {
        const blockChar = config.blockComment.open.charCodeAt(0);
        if (blockChar < ASCII_TABLE_SIZE) table[blockChar] = TRIGGER_DIRECT;
    }
    if (config.regexLiterals) table[CHAR_SLASH] = TRIGGER_DIRECT;
    if (config.htmlComment) table[CHAR_LESS_THAN] = TRIGGER_DIRECT;

    TRIGGER_TABLE_CACHE.set(config, table);
    return table;
}

/**
 * Decide whether a slash opens a regex literal rather than dividing.
 */
function opensRegexLiteral(line: string, index: number): boolean {
    for (let back = index - 1; back >= 0; back -= 1) {
        const code = line.charCodeAt(back);
        if (code === CHAR_SPACE || code === CHAR_TAB) continue;
        return code < ASCII_TABLE_SIZE && REGEX_PREFIX_TABLE[code] === TRIGGER_DIRECT;
    }
    return true;
}

/**
 * Scan forward inside a quoted literal, updating quote state when terminated.
 */
function scanQuotedSpan(
    line: string,
    startIndex: number,
    quoteChar: string,
    state: MaskState,
): number {
    const quoteCode = quoteChar.charCodeAt(0);
    const len = line.length;
    let index = startIndex;
    while (index < len) {
        const code = line.charCodeAt(index);
        if (code === CHAR_BACKSLASH) {
            index += 2;
            continue;
        }
        if (code === quoteCode) {
            state.quote = null;
            return index + 1;
        }
        index++;
    }
    return index;
}

/**
 * Advance past regex trailing flags starting at the character immediately after closing slash.
 */
function consumeRegexFlags(line: string, startIndex: number): number {
    let cursor = startIndex;
    const len = line.length;
    while (cursor < len) {
        const lowerCode = line.charCodeAt(cursor) | CHAR_SPACE;
        if (lowerCode < CHAR_LOWER_A || lowerCode > CHAR_LOWER_Z) break;
        cursor++;
    }
    return cursor;
}

/**
 * Scan forward through a regular expression literal body and trailing flags.
 */
function scanRegexSpan(line: string, startIndex: number): number {
    let cursor = startIndex + 1;
    let inClass = false;
    const len = line.length;
    while (cursor < len) {
        const regexChar = line.charCodeAt(cursor);
        if (regexChar === CHAR_BACKSLASH) {
            cursor += 2;
            continue;
        }
        if (regexChar === CHAR_OPEN_BRACKET) {
            inClass = true;
        } else if (regexChar === CHAR_CLOSE_BRACKET) {
            inClass = false;
        } else if (regexChar === CHAR_SLASH && !inClass) {
            return consumeRegexFlags(line, cursor + 1);
        }
        cursor++;
    }
    return cursor;
}

/**
 * Advance past continuing block comment content.
 */
function scanBlockCommentContinuation(line: string, index: number, state: MaskState): number {
    const close = state.close;
    const cIdx = close ? line.indexOf(close, index) : -1;
    if (cIdx !== -1) {
        state.inBlockComment = false;
        return cIdx + close.length;
    }
    return line.length;
}

/**
 * Check and advance past an opening block comment if present.
 */
function scanOpeningBlockComment(
    line: string,
    index: number,
    config: SourceMaskConfig,
    state: MaskState,
): number {
    const block = config.blockComment;
    if (!block || !line.startsWith(block.open, index)) return -1;
    state.inBlockComment = true;
    const close = block.close;
    const cIdx = close ? line.indexOf(close, index + block.open.length) : -1;
    if (cIdx !== -1) {
        state.inBlockComment = false;
        return cIdx + close.length;
    }
    return line.length;
}

/**
 * Check and advance past a quote literal or regex literal if present.
 */
function scanQuoteOrRegex(
    line: string,
    index: number,
    config: SourceMaskConfig,
    state: MaskState,
): number {
    const char = line[index];
    if (config.quoteChars.includes(char)) {
        if (char === '`' && !config.multilineTemplates) {
            return index + 1;
        }
        state.quote = char;
        return scanQuotedSpan(line, index + 1, char, state);
    }
    if (config.regexLiterals && char === '/' && opensRegexLiteral(line, index)) {
        return scanRegexSpan(line, index);
    }
    return -1;
}

/**
 * Check whether closing hashes match the expected count after a quote.
 */
function matchesClosingHashes(line: string, start: number, count: number): boolean {
    if (start + count > line.length) return false;
    for (let k = 0; k < count; k++) {
        if (line.charCodeAt(start + k) !== CHAR_HASH) return false;
    }
    return true;
}

/**
 * Scan forward through a raw string body looking for the closing quote and hashes.
 */
function scanRawStringBody(
    line: string,
    startIndex: number,
    hashes: number,
    state: MaskState,
): number {
    let cursor = startIndex;
    const len = line.length;
    while (cursor < len) {
        if (
            line.charCodeAt(cursor) === CHAR_DOUBLE_QUOTE &&
            matchesClosingHashes(line, cursor + 1, hashes)
        ) {
            state.rawString = null;
            return cursor + 1 + hashes;
        }
        cursor++;
    }
    state.rawString = hashes;
    return len;
}

/**
 * Check whether character at index is preceded by an identifier character.
 */
function isPrecededByIdentChar(line: string, index: number): boolean {
    if (index === 0) return false;
    const prev = line.charCodeAt(index - 1);
    return (
        (prev >= CHAR_DIGIT_0 && prev <= CHAR_DIGIT_9) ||
        (prev >= CHAR_UPPER_A && prev <= CHAR_UPPER_Z) ||
        (prev >= CHAR_LOWER_A && prev <= CHAR_LOWER_Z) ||
        prev === CHAR_UNDERSCORE
    );
}

/**
 * Check and advance past an opening raw string literal if present.
 */
function scanOpeningRawString(
    line: string,
    index: number,
    config: SourceMaskConfig,
    state: MaskState,
): number {
    if (!config.quoteChars.includes(DOUBLE_QUOTE_STR) && !config.rawStrings) {
        return -1;
    }

    const code = line.charCodeAt(index);
    let rPos = index;
    if (
        (code === CHAR_LOWER_B || code === CHAR_LOWER_C) &&
        line.charCodeAt(index + 1) === CHAR_LOWER_R
    ) {
        rPos = index + 1;
    } else if (code !== CHAR_LOWER_R) {
        return -1;
    }

    if (isPrecededByIdentChar(line, index)) {
        return -1;
    }

    let pos = rPos + 1;
    let hashes = 0;
    while (pos < line.length && line.charCodeAt(pos) === CHAR_HASH) {
        hashes++;
        pos++;
    }

    if (pos >= line.length || line.charCodeAt(pos) !== CHAR_DOUBLE_QUOTE) {
        return -1;
    }

    return scanRawStringBody(line, pos + 1, hashes, state);
}

/**
 * Scans continuing multi-line construct (quote, raw string, block comment, or HTML comment).
 */
function scanMultiLineState(
    line: string,
    index: number,
    state: MaskState,
    config: SourceMaskConfig,
): number {
    if (state.quote) {
        return scanQuotedSpan(line, index, state.quote, state);
    }
    if (state.rawString != null) {
        return scanRawStringBody(line, index, state.rawString, state);
    }
    if (state.inBlockComment) {
        return scanBlockCommentContinuation(line, index, state);
    }
    if (config.htmlComment && state.inHtmlComment) {
        const cIdx = line.indexOf(HTML_COMMENT_CLOSE, index);
        if (cIdx !== -1) {
            state.inHtmlComment = false;
            return cIdx + HTML_COMMENT_CLOSE.length;
        }
        return line.length;
    }
    return -1;
}

/**
 * Fast-path check and scan for quote tokens (', ", `).
 */
function scanQuoteFast(
    line: string,
    index: number,
    code: number,
    state: MaskState,
    config: SourceMaskConfig,
): number {
    if (code !== CHAR_SINGLE_QUOTE && code !== CHAR_DOUBLE_QUOTE && code !== CHAR_BACKTICK) {
        return -1;
    }
    const char = line[index];
    if (!config.quoteChars.includes(char)) {
        return -1;
    }
    if (code === CHAR_BACKTICK && !config.multilineTemplates) {
        return index + 1;
    }
    state.quote = char;
    return scanQuotedSpan(line, index + 1, char, state);
}

/**
 * Fast-path check and scan for slash tokens (line comment, block comment, or regex literal).
 */
function scanSlashFast(
    line: string,
    index: number,
    state: MaskState,
    config: SourceMaskConfig,
): number {
    const nextCode = line.charCodeAt(index + 1);
    if (nextCode === CHAR_SLASH && config.lineComment === '//') {
        return line.length;
    }
    if (nextCode === CHAR_ASTERISK && config.blockComment?.open === '/*') {
        state.inBlockComment = true;
        const close = state.close || '*/';
        const cIdx = line.indexOf(close, index + 2);
        if (cIdx !== -1) {
            state.inBlockComment = false;
            return cIdx + close.length;
        }
        return line.length;
    }
    if (config.regexLiterals && opensRegexLiteral(line, index)) {
        return scanRegexSpan(line, index);
    }
    return -1;
}

/**
 * Fast-path check and scan for hash comments, HTML comments, or raw strings.
 */
function scanOtherPrefixFast(
    line: string,
    index: number,
    code: number,
    state: MaskState,
    config: SourceMaskConfig,
): number {
    if (code === CHAR_HASH && config.lineComment === '#') {
        return line.length;
    }
    if (code === CHAR_LESS_THAN) {
        if (config.htmlComment && line.startsWith(HTML_COMMENT_OPEN, index)) {
            state.inHtmlComment = true;
            const cIdx = line.indexOf(HTML_COMMENT_CLOSE, index + HTML_COMMENT_OPEN.length);
            if (cIdx !== -1) {
                state.inHtmlComment = false;
                return cIdx + HTML_COMMENT_CLOSE.length;
            }
            return line.length;
        }
        return -1;
    }
    if (code === CHAR_LOWER_R || code === CHAR_LOWER_B || code === CHAR_LOWER_C) {
        return scanOpeningRawString(line, index, config, state);
    }
    return -1;
}

/**
 * Fallback scanner for custom language syntax configurations.
 */
function scanFallback(
    line: string,
    index: number,
    state: MaskState,
    config: SourceMaskConfig,
): number {
    if (line.startsWith(config.lineComment, index)) {
        return line.length;
    }
    const bcEnd = scanOpeningBlockComment(line, index, config, state);
    if (bcEnd !== -1) {
        return bcEnd;
    }
    return scanQuoteOrRegex(line, index, config, state);
}

/**
 * Scans the next masked span starting at `index`.
 * Returns the end index of the span, or -1 if the current character is unmasked.
 */
function scanNextMaskSpan(
    line: string,
    index: number,
    state: MaskState,
    config: SourceMaskConfig,
): number {
    if (!isNormalMaskState(state)) {
        return scanMultiLineState(line, index, state, config);
    }

    const code = line.charCodeAt(index);
    const qEnd = scanQuoteFast(line, index, code, state, config);
    if (qEnd !== -1) return qEnd;

    if (code === CHAR_SLASH) {
        return scanSlashFast(line, index, state, config);
    }

    const pEnd = scanOtherPrefixFast(line, index, code, state, config);
    if (pEnd !== -1) return pEnd;

    return scanFallback(line, index, state, config);
}

/**
 * Checks whether the masker is in normal top-level code state (no open multi-line construct).
 */
function isNormalMaskState(state: MaskState): boolean {
    return (
        state.quote === null &&
        !state.inBlockComment &&
        !state.inHtmlComment &&
        state.rawString == null
    );
}

/**
 * Fast pre-check for whether `'r'`, `'b'`, or `'c'` is immediately followed by `"` or `#`.
 */
function isRawStringCandidate(line: string, index: number, code: number): boolean {
    const rIdx =
        code === CHAR_LOWER_R
            ? index
            : line.charCodeAt(index + 1) === CHAR_LOWER_R
              ? index + 1
              : -1;
    if (rIdx === -1) return false;
    const next = line.charCodeAt(rIdx + 1);
    return next === CHAR_DOUBLE_QUOTE || next === CHAR_HASH;
}

/**
 * Advance `startIndex` to the next character that can trigger a comment, quote, or regex span.
 */
function advanceToNextTrigger(line: string, startIndex: number, triggerTable: Uint8Array): number {
    const len = line.length;
    let index = startIndex;
    while (index < len) {
        const code = line.charCodeAt(index);
        if (code < ASCII_TABLE_SIZE) {
            const trig = triggerTable[code];
            if (
                trig === TRIGGER_DIRECT ||
                (trig === TRIGGER_RAW_PREFIX && isRawStringCandidate(line, index, code))
            ) {
                break;
            }
        }
        index++;
    }
    return index;
}

/**
 * Advance cursor position to next trigger when in normal code state, or to `nextPos` otherwise.
 */
function advanceMaskIndex(line: string, nextPos: number, state: MaskState): number {
    if (!isNormalMaskState(state)) return nextPos;
    return advanceToNextTrigger(line, nextPos, state.triggerTable);
}

/**
 * Checks if a line is completely enclosed inside a multi-line comment block.
 */
function isFullyCommentedLine(line: string, state: MaskState): boolean {
    if (state.quote) return false;
    const close = state.close;
    if (state.inBlockComment && close.length > 0 && !line.includes(close)) {
        return true;
    }
    if (state.rawString != null && !line.includes(DOUBLE_QUOTE_STR)) {
        return true;
    }
    return Boolean(state.inHtmlComment && !line.includes(HTML_COMMENT_CLOSE));
}

const PREALLOC_SPACES_LEN = 512;
const PREALLOC_SPACES = ' '.repeat(PREALLOC_SPACES_LEN);

/**
 * Returns a string of spaces of the requested length using a pre-allocated slice when possible.
 */
function getSpaces(len: number): string {
    if (len <= 0) return '';
    if (len <= PREALLOC_SPACES_LEN) return PREALLOC_SPACES.slice(0, len);
    return ' '.repeat(len);
}

/**
 * Execute span masking starting from `startIndex` on `line`.
 */
function maskLineFromIndex(
    line: string,
    startIndex: number,
    state: MaskState,
    config: SourceMaskConfig,
): string {
    const len = line.length;
    let pieces: string[] | null = null;
    let lastCopied = 0;
    let index = startIndex;

    while (index < len) {
        const nextIdx = scanNextMaskSpan(line, index, state, config);
        if (nextIdx === -1) {
            index = advanceMaskIndex(line, index + 1, state);
            continue;
        }
        if (index < nextIdx) {
            if (pieces === null && nextIdx === len) {
                const prefix = index === 0 ? '' : line.slice(0, index);
                return prefix + getSpaces(len - index);
            }
            if (pieces === null) pieces = [];
            if (index > lastCopied) {
                pieces.push(line.slice(lastCopied, index));
            }
            pieces.push(getSpaces(nextIdx - index));
            lastCopied = nextIdx;
        }
        index = advanceMaskIndex(line, nextIdx, state);
    }

    if (pieces === null) return line;
    if (lastCopied < len) {
        pieces.push(line.slice(lastCopied));
    }
    return pieces.join('');
}

/**
 * Mask one raw line in place using contiguous span blanking to avoid array allocations.
 *
 * @param line - Raw source line without its trailing carriage return.
 * @param state - Masking state, mutated so multi-line constructs continue on later lines.
 * @param config - Comment and quote syntax of the language.
 * @returns A same-length copy whose comment and literal characters are spaces.
 */
function maskLine(line: string, state: MaskState, config: SourceMaskConfig): string {
    const len = line.length;
    if (len === 0) return line;
    if (isNormalMaskState(state)) {
        const firstTrigger = advanceToNextTrigger(line, 0, state.triggerTable);
        if (firstTrigger >= len) return line;
        return maskLineFromIndex(line, firstTrigger, state, config);
    }
    if (isFullyCommentedLine(line, state)) {
        return getSpaces(len);
    }
    return maskLineFromIndex(line, 0, state, config);
}
