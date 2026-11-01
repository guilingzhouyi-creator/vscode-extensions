/**
 * Module: Core Constants — Rust Regular Expression Catalog
 * File Path: src/core/constants/regex-rust.ts
 * Architecture Role: Single source of truth (SSOT) for Rust syntax, unsafe blocks,
 *     safety proof comments, and declaration regular expressions.
 * Dependencies & Triggers: Zero external dependencies; consumed by rust-modern and
 *     naming-rust-helper.
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
export const RUST_LET_PATTERN = /^\s*let\s+(?:mut\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::[^=]+)?\s*=/;

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

/** Matches try! macro call. */
export const RUST_TRY_MACRO_PATTERN = /\btry!\s*\(/;

/** Matches extern crate declaration. */
export const RUST_EXTERN_CRATE_PATTERN = /^\s*extern\s+crate\s+[A-Za-z_]\w*\s*;/;

/** Matches #[macro_use] attribute. */
export const RUST_MACRO_USE_PATTERN = /#\[\s*macro_use\s*\]/;

/** Matches &String parameter in function signature. */
export const RUST_AMP_STRING_PATTERN = /&\s*String\b/;

/** Matches needless .clone() immediately before comparison or length check. */
export const RUST_NEEDLESS_CLONE_PATTERN = /\.clone\(\)\s*(?:==|!=|\.len\(\)|\.is_empty\(\))/;

/** Matches naked numeric as cast. */
export const RUST_NUMERIC_CAST_PATTERN =
    /\bas\s+(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f32|f64)\b/;

/** Matches formatting macro invocation. */
export const RUST_FORMAT_CALL_PATTERN =
    /\b(?:println|print|eprintln|eprint|format|panic|write|writeln)!\s*\(/;

/** Matches positional placeholder {} in formatting macro. */
export const RUST_POSITIONAL_PLACEHOLDER_PATTERN = /!\s*\(\s*"[^"]*\{\}/;

/** Matches multiline format call with empty positional placeholder. */
export const RUST_MULTILINE_FORMAT_PATTERN =
    /\b(?:println|print|eprintln|eprint|format|panic|write|writeln)!\s*\([^;]*"[^"]*\{\}/;

/** Matches if let pattern matching statement. */
export const RUST_IF_LET_PATTERN = /\bif\s+let\s+[^{]+=\s*/;

/** Matches for ... in loop header. */
export const RUST_FOR_IN_PATTERN = /\bfor\s+(?:[A-Za-z_]\w*|\([A-Za-z0-9_,\s]+\))\s+in\b/;

/** Matches for ... in loop with immediate conditional return. */
export const RUST_FOR_FIND_PATTERN = /\bfor\s+[^{]+\{\s*if\s+[^{]+\{\s*return\b/;

/** Matches async function declaration. */
export const RUST_ASYNC_FN_PATTERN = /\basync\s+(?:unsafe\s+)?(?:extern(?:\s+"[^"]+")?\s+)?fn\b/;

/** Matches synchronous standard library Mutex/RwLock acquisition without await. */
export const RUST_STD_LOCK_PATTERN =
    /(?:std::sync::(?:Mutex|RwLock)|\.(?:lock|read|write)\s*\(\s*\)(?!\s*\.await))/;

/** Matches .await keyword expression. */
export const RUST_AWAIT_PATTERN = /\.await\b/;

/** Matches panic!, todo!, unimplemented!, or unreachable! macro calls. */
export const RUST_CRASH_MACRO_PATTERN = /\b(?:panic|todo|unimplemented|unreachable)!\s*\(/;

/** Matches .expect() method call. */
export const RUST_EXPECT_CALL_PATTERN = /\.expect\s*\(/;

/** Matches Rust naked unwrap method invocation. */
export const RUST_UNWRAP_PATTERN = /\.unwrap\s*\(/;

/** Creates a fresh global scanner for Rust .unwrap() and .expect() calls. */
export function createRustUnwrapScanner(): RegExp {
    return /\.(?:unwrap|expect)\s*\(/g;
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
    TRY_MACRO: RUST_TRY_MACRO_PATTERN,
    EXTERN_CRATE: RUST_EXTERN_CRATE_PATTERN,
    MACRO_USE: RUST_MACRO_USE_PATTERN,
    AMP_STRING: RUST_AMP_STRING_PATTERN,
    NEEDLESS_CLONE: RUST_NEEDLESS_CLONE_PATTERN,
    NUMERIC_CAST: RUST_NUMERIC_CAST_PATTERN,
    FORMAT_CALL: RUST_FORMAT_CALL_PATTERN,
    POSITIONAL_PLACEHOLDER: RUST_POSITIONAL_PLACEHOLDER_PATTERN,
    MULTILINE_FORMAT: RUST_MULTILINE_FORMAT_PATTERN,
    IF_LET: RUST_IF_LET_PATTERN,
    FOR_IN: RUST_FOR_IN_PATTERN,
    FOR_FIND: RUST_FOR_FIND_PATTERN,
    ASYNC_FN: RUST_ASYNC_FN_PATTERN,
    STD_LOCK: RUST_STD_LOCK_PATTERN,
    AWAIT: RUST_AWAIT_PATTERN,
    CRASH_MACRO: RUST_CRASH_MACRO_PATTERN,
    EXPECT_CALL: RUST_EXPECT_CALL_PATTERN,
    UNWRAP: RUST_UNWRAP_PATTERN,
    createOpenBraceScanner: createRustOpenBraceScanner,
    createCloseBraceScanner: createRustCloseBraceScanner,
    createRustUnwrapScanner: createRustUnwrapScanner,
});
