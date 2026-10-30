/**
 * Module: Core Constants — Rust Regular Expression Catalog
 * File Path: src/core/constants/regex-rust.ts
 * Architecture Role: Single source of truth (SSOT) for Rust syntax, unsafe blocks,
 *     safety proof comments, and declaration regular expressions.
 * Dependencies & Triggers: Zero external dependencies; consumed by rust-modern and naming-rust-helper.
 * Responsibilities:
 *     1. Centralize canonical Rust patterns (unsafe blocks, safety comments, fn/struct/let).
 *     2. Enforce the state-separation discipline: stateless immutable constants vs fresh factories.
 *     3. Expose frozen REGEX_RUST domain namespace.
 * Exit Semantics & Design Rationale: Pure, frozen regex constants and deterministic factories;
 *     zero side effects and strictly immune to ReDoS back-tracking traps.
 */

/** Matches Rust unsafe block or function signature start. */
export const RUST_UNSAFE_KEYWORD_PATTERN = /\bunsafe\s*(?:\{|\bfn\b)/;

/** Matches Rust safety proof comment invariant declaration. */
export const RUST_SAFETY_PROOF_COMMENT_PATTERN = /\/\/\s*SAFETY:\s*\S+/;

/** Matches Rust test file path suffix and convention. */
export const RUST_TEST_FILE_PATTERN = /(?:[\\/]tests[\\/]|[\\/]test_[^\\/]+\.rs$|_test\.rs$)/i;

/** Matches Rust function signature declaration. */
export const RUST_FN_PATTERN =
    /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern(?:\s*"[^"]*")?\s+)?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)/;

/** Matches Rust struct, enum, or trait type declaration. */
export const RUST_TYPE_PATTERN =
    /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([a-zA-Z_][a-zA-Z0-9_]*)/;

/** Matches Rust const or static variable declaration. */
export const RUST_CONST_PATTERN =
    /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:const|static)\s+(?:mut\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*:/;

/** Matches Rust let variable binding statement. */
export const RUST_LET_PATTERN =
    /^\s*let\s+(?:mut\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::[^=]+)?\s*=/;

/** Matches Rust for-loop variable binding header. */
export const RUST_FOR_PATTERN = /^\s*for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\b/;

/** Matches Rust tuple destructuring let statement. */
export const RUST_TUPLE_LET_PATTERN =
    /^\s*let\s+(?:mut\s+)?\(([a-zA-Z0-9_,\s]+)\)\s*(?::[^=]+)?\s*=/;

/** Matches transient heap allocation patterns in Rust loops (Vec/Box/String/HashMap/clone). */
export const RUST_TRANSIENT_ALLOCATION_PATTERN =
    /\b(?:(?:Vec|Box|String|HashMap|BTreeMap|HashSet|BTreeSet)::(?:new|with_capacity)\s*\(|\.clone\()/;

/** Creates a fresh global scanner for matching open braces in Rust blocks. */
export function createRustOpenBraceScanner(): RegExp {
    return /\{/g;
}

/** Creates a fresh global scanner for matching close braces in Rust blocks. */
export function createRustCloseBraceScanner(): RegExp {
    return /\}/g;
}

/**
 * Frozen Rust domain regex catalog namespace.
 */
export const REGEX_RUST = Object.freeze({
    UNSAFE_KEYWORD: RUST_UNSAFE_KEYWORD_PATTERN,
    SAFETY_PROOF_COMMENT: RUST_SAFETY_PROOF_COMMENT_PATTERN,
    TEST_FILE: RUST_TEST_FILE_PATTERN,
    FN: RUST_FN_PATTERN,
    TYPE: RUST_TYPE_PATTERN,
    CONST: RUST_CONST_PATTERN,
    LET: RUST_LET_PATTERN,
    FOR: RUST_FOR_PATTERN,
    TUPLE_LET: RUST_TUPLE_LET_PATTERN,
    TRANSIENT_ALLOCATION: RUST_TRANSIENT_ALLOCATION_PATTERN,
    createOpenBraceScanner: createRustOpenBraceScanner,
    createCloseBraceScanner: createRustCloseBraceScanner,
});
