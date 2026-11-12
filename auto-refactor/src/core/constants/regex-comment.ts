/**
 * Module: Core Constants — Comment, Directive & Documentation Regular Expression Catalog
 * File Path: src/core/constants/regex-comment.ts
 * Architecture Role: Single source of truth (SSOT) for comment hygiene, linter suppression,
 *     JSDoc tags, tool directives, and public polyglot declaration markers.
 * Dependencies & Triggers: Zero external dependencies; consumed by comments analyzer
 *     and core comment auditors.
 * Responsibilities:
 *     1. Centralize canonical line/block comment tokens, JSDoc tags, and mojibake signatures.
 *     2. Provide tool directive exemptions and decorative separator patterns.
 *     3. Expose frozen REGEX_COMMENT domain namespace.
 * Exit Semantics & Design Rationale: Pure, frozen regex constants and deterministic factories;
 *     zero side effects and strictly immune to ReDoS back-tracking traps.
 */

/** Matches leading C-style // line comment. */
export const SLASH_SLASH_COMMENT_PATTERN = /^\s*\/\//;

/** Matches leading Python/Shell # line comment. */
export const HASH_COMMENT_PATTERN = /^\s*#/;

/** Matches leading SQL/Lua/Ada -- line comment. */
export const DASH_DASH_COMMENT_PATTERN = /^\s*--/;

/** Matches start of block comment. */
export const BLOCK_COMMENT_START_PATTERN = /\/\*/;

/** Matches end of block comment. */
export const BLOCK_COMMENT_END_PATTERN = /\*\//;

/** Matches any leading comment token across common languages. */
export const COMMENT_LINE_PATTERN = /^\s*(?:\/\/|#|--|\/\*|\*)/;

/** Matches eslint-disable, @ts-ignore, or @ts-expect-error suppression markers. */
export const LINTER_SUPPRESSION_PATTERN =
    /(?:eslint-disable(?:-next-line|-line)?|ts-ignore|ts-expect-error)/;

/** Matches ESLint disable suppression comment token. */
export const ESLINT_DISABLE_PATTERN = /eslint-disable/;

/** Matches single JSDoc tag on a line. */
export const JSDOC_TAG_PATTERN = /^\s*\*\s*@([a-zA-Z0-9_-]+)(?:\s+(.*))?$/;

/**
 * Creates a fresh global scanner for extracting JSDoc tags.
 * @returns Global regex capturing a JSDoc tag name.
 */
export function createJsdocTagScanner(): RegExp {
    return /@([a-zA-Z0-9_-]+)/g;
}

/** Matches encoding corruption (replacement character or double-decoding artifacts). */
export const COMMENT_MOJIBAKE_PATTERN = /\ufffd|\u00c3[\u0080-\u00bf]|\u00e2\u20ac/;

/** Matches generic tool and linter suppression directives across ecosystems. */
export const COMMENT_GENERIC_DIRECTIVE_PATTERN =
    /^(?:noqa\b|type:\s*ignore|pragma:|mypy:|pyright:|ruff:|fmt:|isort:|nosec\b|eslint-disable|prettier-ignore|@ts-(?:ignore|expect-error)|@ts-nocheck|nolint\b|istanbul\s+ignore|c8\s+ignore|coverage:\s*ignore)/i;

/** Matches async keyword in declaration positions (not member name or substring). */
export const COMMENT_ASYNC_DECLARATION_PATTERN = /\basync\b\s*(?=[A-Za-z_$(*])/;

/** Matches type-only declarations (type/interface/enum) exempt from concurrency notice. */
export const COMMENT_TYPE_ONLY_DECLARATION_PATTERN =
    /^\s*(?:export\s+)?(?:declare\s+)?(?:type|interface|enum)\b/;

/**
 * Polyglot export & public symbol declaration patterns across:
 * TypeScript / JavaScript, GDScript, Python, Rust, and Go.
 */
export const COMMENT_POLYGLOT_EXPORT_PATTERN =
    /^\s*(?:export\s+(?:declare\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+|class_name\s+|(?:static\s+)?func\s+|def\s+|class\s+|pub\s+(?:async\s+)?(?:fn|struct|enum|trait|type)\s+|func\s+)([A-Za-z0-9_$]+)/;

/** Bare rule of separator glyphs (decorative only). */
export const COMMENT_BARE_SEPARATOR_PATTERN = /^[─═\-=]{3,}$/;

/** Short separator token prefix (exactly 2 glyphs followed by non-glyph). */
export const COMMENT_SHORT_SEPARATOR_PATTERN = /^─{2}(?!─)/;

/** Long separator token prefix (3+ glyphs followed by content text). */
export const COMMENT_LONG_SEPARATOR_PATTERN = /^─{3,}\s*[^\s─]/;

/** Matches URLs or extended inline code blocks within documentation. */
export const COMMENT_URL_OR_INLINE_CODE_PATTERN = /https?:\/\/\S+|`[^`]{20,}`/;

/** Matches polyglot file header comment prefix delimiters (//, /*, *, #, ##, """). */
export const COMMENT_HEADER_PREFIX_PATTERN = /^\s*(\/\/|\/\*|\*|#|##|""")/;

/** Matches terminology audit exemption path segments. */
export const COMMENT_EXEMPT_TERMINOLOGY_PATH_PATTERN =
    /\/(?:tests|test|fixtures)\/|scripts\/validate-|src\/core\/praxis\/presentation\/dictionaries\//;

export const REGEX_COMMENT = Object.freeze({
    SLASH_SLASH: SLASH_SLASH_COMMENT_PATTERN,
    HASH: HASH_COMMENT_PATTERN,
    DASH_DASH: DASH_DASH_COMMENT_PATTERN,
    BLOCK_START: BLOCK_COMMENT_START_PATTERN,
    BLOCK_END: BLOCK_COMMENT_END_PATTERN,
    COMMENT_LINE: COMMENT_LINE_PATTERN,
    LINTER_SUPPRESSION: LINTER_SUPPRESSION_PATTERN,
    ESLINT_DISABLE: ESLINT_DISABLE_PATTERN,
    JSDOC_TAG: JSDOC_TAG_PATTERN,
    createJsdocTagScanner,
    MOJIBAKE: COMMENT_MOJIBAKE_PATTERN,
    GENERIC_DIRECTIVE: COMMENT_GENERIC_DIRECTIVE_PATTERN,
    ASYNC_DECLARATION: COMMENT_ASYNC_DECLARATION_PATTERN,
    TYPE_ONLY_DECLARATION: COMMENT_TYPE_ONLY_DECLARATION_PATTERN,
    POLYGLOT_EXPORT: COMMENT_POLYGLOT_EXPORT_PATTERN,
    BARE_SEPARATOR: COMMENT_BARE_SEPARATOR_PATTERN,
    SHORT_SEPARATOR: COMMENT_SHORT_SEPARATOR_PATTERN,
    LONG_SEPARATOR: COMMENT_LONG_SEPARATOR_PATTERN,
    URL_OR_INLINE_CODE: COMMENT_URL_OR_INLINE_CODE_PATTERN,
    HEADER_PREFIX: COMMENT_HEADER_PREFIX_PATTERN,
    EXEMPT_TERMINOLOGY_PATH: COMMENT_EXEMPT_TERMINOLOGY_PATH_PATTERN,
});
