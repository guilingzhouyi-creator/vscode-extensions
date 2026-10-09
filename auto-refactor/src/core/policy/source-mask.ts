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

/** Characters that, immediately before a `/`, mean the slash opens a regex literal. */
const REGEX_PREFIX_CHARS = new Set('([{,=:!&|?;+-*%<>');

/** Flag characters consumed after a regex literal's closing slash. */
const REGEX_FLAG_RE = /[a-z]/i;

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
    const raw: string[] = new Array(len);
    const masked: string[] = new Array(len);
    const state: MaskState = { inBlockComment: false, quote: null };
    for (let i = 0; i < len; i++) {
        let line = lines[i];
        if (line.endsWith('\r')) line = line.slice(0, -1);
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
    if (content.length > 50000) {
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
    /** True while inside an unterminated HTML comment. */
    inHtmlComment?: boolean;
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
    if (config.htmlComment) chars.add('<');

    const escaped = [...chars]
        .map((char) => char.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'))
        .join('');
    const built = new RegExp(`[${escaped}]`);
    TRIGGER_CACHE.set(config, built);
    return built;
}

/**
 * Decide whether a slash opens a regex literal rather than dividing.
 */
function opensRegexLiteral(line: string, index: number): boolean {
    for (let back = index - 1; back >= 0; back -= 1) {
        const char = line[back];
        if (char === ' ' || char === '\t') continue;
        return REGEX_PREFIX_CHARS.has(char);
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
    let index = startIndex;
    while (index < line.length) {
        const char = line[index];
        if (char === '\\') {
            index += 2;
            continue;
        }
        if (char === quoteChar) {
            state.quote = null;
            index++;
            break;
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
    while (cursor < line.length && REGEX_FLAG_RE.test(line[cursor])) {
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
    while (cursor < line.length) {
        const rc = line[cursor];
        if (rc === '\\') {
            cursor += 2;
            continue;
        }
        if (rc === '[') {
            inClass = true;
            cursor++;
            continue;
        }
        if (rc === ']') {
            inClass = false;
            cursor++;
            continue;
        }
        if (rc === '/' && !inClass) {
            return consumeRegexFlags(line, cursor + 1);
        }
        cursor++;
    }
    return cursor;
}

/**
 * Advance past continuing block comment content.
 */
function scanBlockCommentContinuation(
    line: string,
    index: number,
    close: string,
    state: MaskState,
): number {
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
 * Scans the next masked span starting at `index`.
 * Returns the end index of the span, or -1 if the current character is unmasked.
 */
function scanNextMaskSpan(
    line: string,
    index: number,
    state: MaskState,
    config: SourceMaskConfig,
    close: string,
): number {
    if (state.quote) {
        return scanQuotedSpan(line, index, state.quote, state);
    }
    if (state.inBlockComment) {
        return scanBlockCommentContinuation(line, index, close, state);
    }
    if (config.htmlComment && state.inHtmlComment) {
        const cIdx = line.indexOf('-->', index);
        if (cIdx !== -1) {
            state.inHtmlComment = false;
            return cIdx + 3;
        }
        return line.length;
    }
    if (line.startsWith(config.lineComment, index)) {
        return line.length;
    }
    const bcEnd = scanOpeningBlockComment(line, index, config, state);
    if (bcEnd !== -1) {
        return bcEnd;
    }
    if (config.htmlComment && line.startsWith('<!--', index)) {
        state.inHtmlComment = true;
        const cIdx = line.indexOf('-->', index + 4);
        if (cIdx !== -1) {
            state.inHtmlComment = false;
            return cIdx + 3;
        }
        return line.length;
    }
    return scanQuoteOrRegex(line, index, config, state);
}

/**
 * Decides whether line masking can be skipped entirely.
 */
function shouldSkipMasking(line: string, state: MaskState, config: SourceMaskConfig): boolean {
    if (state.quote || state.inBlockComment || state.inHtmlComment) return false;
    return !triggerRegex(config).test(line);
}

/**
 * Checks if a line is completely enclosed inside a multi-line comment block.
 */
function isFullyCommentedLine(line: string, state: MaskState, close: string): boolean {
    if (state.quote) return false;
    if (state.inBlockComment && close.length > 0 && !line.includes(close)) {
        return true;
    }
    return Boolean(state.inHtmlComment && !line.includes('-->'));
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
    if (shouldSkipMasking(line, state, config)) return line;

    const close = config.blockComment?.close ?? '';
    if (isFullyCommentedLine(line, state, close)) {
        return ' '.repeat(line.length);
    }

    const pieces: string[] = [];
    let lastCopied = 0;
    let hasBlanked = false;

    const blankSpan = (start: number, end: number): void => {
        if (start >= end) return;
        hasBlanked = true;
        if (start > lastCopied) {
            pieces.push(line.slice(lastCopied, start));
        }
        pieces.push(' '.repeat(end - start));
        lastCopied = end;
    };

    let index = 0;
    while (index < line.length) {
        const nextIdx = scanNextMaskSpan(line, index, state, config, close);
        if (nextIdx !== -1) {
            blankSpan(index, nextIdx);
            index = nextIdx;
        } else {
            index++;
        }
    }

    if (!hasBlanked) return line;
    if (lastCopied < line.length) {
        pieces.push(line.slice(lastCopied));
    }
    return pieces.join('');
}
