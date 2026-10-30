/**
 * Module: Core Constants — Go Regular Expression Catalog
 * File Path: src/core/constants/regex-go.ts
 * Architecture Role: Single source of truth (SSOT) for Go syntax, receiver naming,
 *     error handling, and modernization regular expressions.
 * Dependencies & Triggers: Zero external dependencies; consumed by go-modern and complexity analyzers.
 * Responsibilities:
 *     1. Centralize canonical Go patterns (unchecked errors, context params, function signatures).
 *     2. Enforce the state-separation discipline: stateless immutable constants vs fresh factories.
 *     3. Expose frozen REGEX_GO domain namespace.
 * Exit Semantics & Design Rationale: Pure, frozen regex constants and deterministic factories;
 *     zero side effects and strictly immune to ReDoS back-tracking traps.
 */

/** Matches unchecked error assignment discarding error return value via blank identifier. */
export const GO_UNCHECKED_ERROR_PATTERN = /,\s*_\s*(?::=|=)|^_\s*(?::=|=)/;

/** Matches context.Context type occurrence within signature parameters. */
export const GO_CONTEXT_IN_PARAMS_PATTERN = /context\.Context/;

/** Matches Go function or method signature header to locate parameter list. */
export const GO_FUNC_SIGNATURE_PATTERN =
    /^func\s+(?:\([^)]+\)\s+)?[A-Za-z_][A-Za-z0-9_]*\s*(?:\[[^\]]*\])?\s*\(/;

/** Matches Go method receiver declaration with receiver variable and struct target. */
export const GO_RECEIVER_PATTERN =
    /^func\s+\(\s*([A-Za-z_][A-Za-z0-9_]*)\s+\*?([A-Za-z_][A-Za-z0-9_]*)\s*\)/;

/** Matches Go variable declaration holding error type. */
export const GO_VAR_ERROR_TYPE_PATTERN = /^var\s+([A-Za-z_][A-Za-z0-9_]*)\s+error\b/;

/** Matches transient heap allocation patterns in Go loops (make slice/map/chan, struct address). */
export const GO_TRANSIENT_ALLOCATION_PATTERN =
    /\b(?:make\s*\(\s*(?:\[\]|map\[|chan\b)|&[A-Z][a-zA-Z0-9_]*\{|\.clone\()/;

/** Matches Go package-level docstring header comment. */
export const GO_PACKAGE_COMMENT_PATTERN = /^\s*\/\/\s*Package\s+/;

/** Matches Go panic invocation. */
export const GO_PANIC_PATTERN = /\bpanic\s*\(/;

/**
 * Frozen Go domain regex catalog namespace.
 */
export const REGEX_GO = Object.freeze({
    UNCHECKED_ERROR: GO_UNCHECKED_ERROR_PATTERN,
    CONTEXT_IN_PARAMS: GO_CONTEXT_IN_PARAMS_PATTERN,
    FUNC_SIGNATURE: GO_FUNC_SIGNATURE_PATTERN,
    RECEIVER: GO_RECEIVER_PATTERN,
    VAR_ERROR_TYPE: GO_VAR_ERROR_TYPE_PATTERN,
    TRANSIENT_ALLOCATION: GO_TRANSIENT_ALLOCATION_PATTERN,
    PACKAGE_COMMENT: GO_PACKAGE_COMMENT_PATTERN,
    PANIC: GO_PANIC_PATTERN,
});
