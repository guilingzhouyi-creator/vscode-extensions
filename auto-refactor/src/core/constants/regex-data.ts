/**
 * Module: Core Constants — Data Architecture & Persistence Regular Expression Catalog
 * File Path: src/core/constants/regex-data.ts
 * Architecture Role: Single source of truth (SSOT) for database queries, persistence drivers,
 *     serialization cycles, and resource registry patterns.
 * Dependencies & Triggers: Zero external dependencies; consumed by data-architecture analyzer
 *     and dataArchitecture intelligence modules.
 * Responsibilities:
 *     1. Centralize canonical data access, query shape, and serialization detector patterns.
 *     2. Enforce the state-separation discipline: stateless immutable constants vs fresh factories.
 *     3. Expose frozen REGEX_DATA domain namespace.
 * Exit Semantics & Design Rationale: Pure, frozen regex constants and deterministic helpers;
 *     zero side effects and strictly immune to ReDoS back-tracking traps.
 */

/** Matches storage or repository receivers with query/fetch operations. */
export const DATA_STORAGE_RECEIVER_QUERY_PATTERN =
    /(?:\b(?:repo(?:sitory)?|database|db|pool|client|model|dao|collection|prisma|table|session|orm|store)\s*\.\s*(?:find|select|query|fetch|get)\w*)\s*\(/i;

/** Matches direct query/finder methods called on expressions. */
export const DATA_DIRECT_QUERY_METHOD_PATTERN =
    /\.(?:find(?:ById|One|First|Many)|fetchRecords|getBy\w+|queryAll)\s*\(/i;

/** Tests whether a trimmed line is a database or storage query call site. */
export function isDataQueryCall(trimmed: string): boolean {
    return (
        DATA_STORAGE_RECEIVER_QUERY_PATTERN.test(trimmed) ||
        DATA_DIRECT_QUERY_METHOD_PATTERN.test(trimmed)
    );
}

/** Matches in-memory store receivers (caches, AST indexes, token tables) exempt from DB hazards. */
export const DATA_MEMORY_STORE_RECEIVER_PATTERN =
    /\b(?:index|cache|memory|map|local|token|entry|ast|symbol)Store\b/i;

/** Matches unpaginated or unbounded database query keywords. */
export const DATA_UNBOUNDED_QUERY_PATTERN =
    /(?:\b(?:findAll|selectAll|getAll|find\(\s*\)|select\(\s*\))\b|\bSELECT\s+\*)/i;

/** Matches JSON serialization or deserialization calls. */
export const DATA_SERIALIZATION_PATTERN = /\bJSON\.(?:parse|stringify)\s*\(/;

/** Matches parameter or invariant validation checks. */
export const DATA_VALIDATION_PATTERN =
    /\b(?:assert|validate|checkNotNull|ensureValid|requireNonEmpty)\s*\(/;

/** Matches raw low-level database driver calls. */
export const DATA_DRIVER_CALL_PATTERN =
    /\b(?:db\.query|pool\.execute|client\.query|execSql|rawQuery)\s*\(/;

/** Matches loop statement headers across supported languages. */
export const DATA_LOOP_HEADER_PATTERN =
    /\b(?:for\s*\(|for\s+[a-zA-Z0-9_$]+\s+in|while\s*\(|do\s*\{)\b/;

/** Matches array iteration method invocations. */
export const DATA_ITERATION_METHOD_PATTERN = /\.(?:map|forEach|filter|flatMap)\s*\(/;

/** Matches resource registration call sites. */
export const DATA_DANGLING_RESOURCE_PATH_PATTERN =
    /(?:register_resource|registerResource|addAsset|bindResource)\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*(?:['"]([^'"]*)['"]|null|undefined))?\s*\)/i;

/** Matches empty or unresolved resource mapping targets. */
export const DATA_DANGLING_TARGET_PATTERN = /^(?:""|''|res:\/\/?|\/)?$|\/$/;

/** Matches function, class, or async procedure declaration signatures. */
export const DATA_FN_DECL_PATTERN =
    /\b(?:function|class|async\s+function|def|func)\s+([A-Za-z0-9_$]+)/;

/** Matches class method declaration signatures with opening brace. */
export const DATA_METHOD_DECL_PATTERN =
    /\b(?:async\s+)?([A-Za-z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/;

/** Matches control flow statement keywords. */
export const DATA_CONTROL_KEYWORD_PATTERN = /^(?:if|for|while|switch|catch)$/;

/** Matches lines that are part of a regular expression literal rather than a call expression. */
export const DATA_REGEX_LITERAL_LINE_PATTERN = /^\s*\/(?![*/])|\/[gimsuy]*\s*[,;)]?\s*$/;

/** Matches HTTP route handler decorator annotations. */
export const DATA_ONLINE_ROUTE_DECORATOR_PATTERN =
    /@(?:Get|Post|Put|Delete|Patch|Route|Query|Mutation)\b/;

/** Matches HTTP server framework initialization calls. */
export const DATA_SERVER_FRAMEWORK_INIT_PATTERN = /\b(?:express|fastify|koa|router)\s*\(\s*\)/;

/** Matches event subscription or listener attachment calls. */
export const DATA_LISTENER_ATTACH_PATTERN = /\.(?:on|addListener|addEventListener|subscribe)\s*\(/;

/** Matches teardown, cleanup, or resource drain method calls. */
export const DATA_TEARDOWN_DRAIN_PATTERN =
    /\.(?:off|removeListener|removeEventListener|unsubscribe|teardown|dispose|flush|drain)\s*\(/;

/** Matches lock or mutex acquisition method calls. */
export const DATA_LOCK_ACQUIRE_PATTERN = /\b(?:acquire|lock|mutex\.lock)\s*\(/i;

/** Matches await keyword in asynchronous execution paths. */
export const DATA_AWAIT_KEYWORD_PATTERN = /\bawait\s+/;

/** Frozen domain namespace aggregating data access, query, and concurrency patterns. */
export const REGEX_DATA = Object.freeze({
    STORAGE_RECEIVER_QUERY: DATA_STORAGE_RECEIVER_QUERY_PATTERN,
    DIRECT_QUERY_METHOD: DATA_DIRECT_QUERY_METHOD_PATTERN,
    isDataQueryCall,
    MEMORY_STORE_RECEIVER: DATA_MEMORY_STORE_RECEIVER_PATTERN,
    UNBOUNDED_QUERY: DATA_UNBOUNDED_QUERY_PATTERN,
    SERIALIZATION: DATA_SERIALIZATION_PATTERN,
    VALIDATION: DATA_VALIDATION_PATTERN,
    DRIVER_CALL: DATA_DRIVER_CALL_PATTERN,
    LOOP_HEADER: DATA_LOOP_HEADER_PATTERN,
    ITERATION_METHOD: DATA_ITERATION_METHOD_PATTERN,
    DANGLING_RESOURCE_PATH: DATA_DANGLING_RESOURCE_PATH_PATTERN,
    DANGLING_TARGET: DATA_DANGLING_TARGET_PATTERN,
    FN_DECL: DATA_FN_DECL_PATTERN,
    METHOD_DECL: DATA_METHOD_DECL_PATTERN,
    CONTROL_KEYWORD: DATA_CONTROL_KEYWORD_PATTERN,
    REGEX_LITERAL_LINE: DATA_REGEX_LITERAL_LINE_PATTERN,
    ONLINE_ROUTE_DECORATOR: DATA_ONLINE_ROUTE_DECORATOR_PATTERN,
    SERVER_FRAMEWORK_INIT: DATA_SERVER_FRAMEWORK_INIT_PATTERN,
    LISTENER_ATTACH: DATA_LISTENER_ATTACH_PATTERN,
    TEARDOWN_DRAIN: DATA_TEARDOWN_DRAIN_PATTERN,
    LOCK_ACQUIRE: DATA_LOCK_ACQUIRE_PATTERN,
    AWAIT_KEYWORD: DATA_AWAIT_KEYWORD_PATTERN,
});
