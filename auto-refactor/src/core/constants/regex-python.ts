/**
 * Module: Core Constants — Python Regular Expression Catalog
 * File Path: src/core/constants/regex-python.ts
 * Architecture Role: Single source of truth (SSOT) for Python syntax, block structure,
 *     and modernization regular expressions.
 * Dependencies & Triggers: Zero external dependencies; consumed by python-modern analyzer.
 * Responsibilities:
 *     1. Centralize canonical Python patterns (block boundaries, imports, ORM calls, typing).
 *     2. Enforce the state-separation discipline: stateless immutable constants vs fresh factories.
 *     3. Expose frozen REGEX_PYTHON domain namespace.
 * Exit Semantics & Design Rationale: Pure, frozen regex constants and deterministic factories;
 *     zero side effects and strictly immune to ReDoS back-tracking traps.
 */

/** Matches Python block opening colon, ignoring trailing comments. */
export const PY_BLOCK_OPEN_PATTERN = /:\s*(?:#.*)?$/;

/** Matches Python direct variable assignment excluding compound operators. */
export const PY_ASSIGN_PATTERN =
    /^\s*([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<=|>>=|\*\*=|\/\/=)/;

/** Matches Python for-loop variable declaration. */
export const PY_FOR_VAR_PATTERN = /^\s*for\s+([A-Za-z_]\w*)\s+in\b/;

/** Matches Python with statement binding target. */
export const PY_WITH_AS_PATTERN = /^\s*(?:async\s+)?with\b.*\bas\s+([A-Za-z_]\w*)\s*[:,#]/;

/** Matches Python except clause target variable. */
export const PY_EXCEPT_AS_PATTERN = /^\s*except\b[^:]*\bas\s+([A-Za-z_]\w*)\s*:/;

/** Matches Python simple import statement. */
export const PY_IMPORT_SIMPLE_PATTERN = /^\s*import\s+([A-Za-z_]\w*)/;

/** Matches Python from-import statement. */
export const PY_IMPORT_FROM_PATTERN = /^\s*from\s+[A-Za-z_.\w]+\s+import\s+(.+)$/;

/** Matches Python blocking IO calls inside async contexts. */
export const PY_BLOCKING_CALL_PATTERN =
    /\b(?:time\.sleep|requests\.(?:get|post|put|patch|delete|request)|urllib\.request\.urlopen)\s*\(/;

/** Matches Python synchronous ORM session calls (ReDoS-safe linear lookahead). */
export const PY_SYNC_ORM_CALL_PATTERN =
    /(?<![\w.])(?:[A-Za-z_][\w.]*)?(?:session|Session)\.(?:query|execute)\s*\(/;

/** Matches Python awaited ORM call. */
export const PY_AWAITED_ORM_CALL_PATTERN =
    /await\s+[^=;]*\b(?:session|Session)\.(?:query|execute)\s*\(/;

/** Matches Python legacy percent-formatting. */
export const PY_PERCENT_FORMAT_PATTERN =
    /(?:'[^']*%[sdrfioxeg%][^']*'|"[^"]*%[sdrfioxeg%][^"]*")\s*%/;

/** Matches Python raise statement. */
export const PY_RAISE_PATTERN = /^raise\s+\S/;

/** Matches Python collections/typing ABC imports. */
export const PY_ABC_IMPORT_PATTERN = /^from\s+typing\s+import\s+(.+)$/;

/** Matches Python PEP 604 Optional/Union type annotation assignment. */
export const PY_PEP604_ANN_ASSIGN_PATTERN =
    /^\s*[A-Za-z_]\w*\s*:\s*(?:typing\.)?(?:Optional|Union)\s*\[[^\]]*\]\s*=/;

/** Matches Python PEP 604 type alias assignment. */
export const PY_PEP604_ALIAS_PATTERN =
    /^\s*[A-Za-z_]\w*\s*=\s*(?:typing\.)?(?:Optional|Union)\s*\[/;

/** Matches Python dataclass decorator. */
export const PY_DATACLASS_PATTERN = /^@(?:dataclasses\.)?dataclass\b/;

/** Matches Python timezone.utc reference. */
export const PY_TIMEZONE_UTC_PATTERN = /\btimezone\.utc\b/;

/** Matches Python open() function call. */
export const PY_OPEN_CALL_PATTERN = /\bopen\s*\(/;

/** Matches Python class declaration. */
export const PY_CLASS_DECL_PATTERN = /^class\s+[A-Za-z_]\w*\s*:/;

/** Matches Python module-level import or from statement start. */
export const PY_IMPORT_STMT_PATTERN = /^(?:import|from)\s+/;

/** Matches Python from-import statement extracting source module. */
export const PY_FROM_IMPORT_CAPTURE_PATTERN = /^from\s+([A-Za-z_][\w.]*)\s+import\b/;

/** Matches Python import statement extracting root module name. */
export const PY_IMPORT_CAPTURE_PATTERN = /^import\s+([A-Za-z_][\w.]*)/;

/** Matches Python import as alias capture. */
export const PY_AS_ALIAS_CAPTURE_PATTERN = /^(.+?)\s+as\s+([A-Za-z_]\w*)$/;

/** Matches valid Python identifier name. */
export const PY_VALID_IDENTIFIER_PATTERN = /^[A-Za-z_]\w*$/;

/** Matches Python class definition declaration line. */
export const PY_CLASS_PATTERN = /^\s*class\s+([A-Za-z_]\w*)/;

/** Matches Python function definition declaration line. */
export const PY_DEF_LINE_PATTERN = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/;

/** Matches transient heap allocation patterns in Python loops (list/dict/set calls or .copy()). */
export const PY_TRANSIENT_ALLOCATION_PATTERN = /(?:(?<![.\w])(?:list|dict|set)\s*\(|\.copy\()/;

/** Matches Python boolean literal return statement. */
export const PY_RETURN_BOOL_PATTERN = /^\s*return\s+(True|False)\s*$/;

/** Matches Python if statement header line. */
export const PY_IF_STMT_PATTERN = /^\s*if\s+([^:]+):\s*$/;

/** Matches Python variable assignment or type annotation binding target. */
export const PY_ASSIGN_BINDING_PATTERN = /^([A-Za-z_]\w*)\s*[:=]/;

/** Matches Python for-loop variable declaration supporting multi-variable unpacking. */
export const PY_FOR_MULTI_VAR_PATTERN = /^for\s+([A-Za-z0-9_,\s]+)\s+in\b/;

/** Matches Python empty body pass statement. */
export const PYTHON_EMPTY_BODY_PATTERN = /^pass\s*$/;

/** Matches Python if statement header line. */
export const PYTHON_IF_HEADER_PATTERN = /^\s*if\s+[^:]+:\s*$/;

/** Matches Python def or class declaration header. */
export const PYTHON_DECL_HEADER_PATTERN = /^\s*(?:def|class)\s+[a-zA-Z_]\w*\b/;

/** Creates a fresh global scanner for stripping parentheses. */
export function createParenStripScanner(): RegExp {
    return /[()]/g;
}

/** Creates a fresh scanner for stripping Python pointer/star prefixes (*args, **kwargs). */
export function createStarPrefixStripScanner(): RegExp {
    return /^\*{1,2}/;
}

/** Creates a fresh global scanner for with statement target bindings. */
export function createWithAsScanner(): RegExp {
    return /\bas\s+([A-Za-z_]\w*)\s*(?:,|:)/g;
}

export const REGEX_PYTHON = Object.freeze({
    BLOCK_OPEN: PY_BLOCK_OPEN_PATTERN,
    ASSIGN: PY_ASSIGN_PATTERN,
    FOR_VAR: PY_FOR_VAR_PATTERN,
    WITH_AS: PY_WITH_AS_PATTERN,
    EXCEPT_AS: PY_EXCEPT_AS_PATTERN,
    IMPORT_SIMPLE: PY_IMPORT_SIMPLE_PATTERN,
    IMPORT_FROM: PY_IMPORT_FROM_PATTERN,
    BLOCKING_CALL: PY_BLOCKING_CALL_PATTERN,
    SYNC_ORM_CALL: PY_SYNC_ORM_CALL_PATTERN,
    AWAITED_ORM_CALL: PY_AWAITED_ORM_CALL_PATTERN,
    PERCENT_FORMAT: PY_PERCENT_FORMAT_PATTERN,
    RAISE: PY_RAISE_PATTERN,
    ABC_IMPORT: PY_ABC_IMPORT_PATTERN,
    PEP604_ANN_ASSIGN: PY_PEP604_ANN_ASSIGN_PATTERN,
    PEP604_ALIAS: PY_PEP604_ALIAS_PATTERN,
    DATACLASS: PY_DATACLASS_PATTERN,
    TIMEZONE_UTC: PY_TIMEZONE_UTC_PATTERN,
    OPEN_CALL: PY_OPEN_CALL_PATTERN,
    CLASS_DECL: PY_CLASS_DECL_PATTERN,
    CLASS: PY_CLASS_PATTERN,
    DEF_LINE: PY_DEF_LINE_PATTERN,
    RETURN_BOOL: PY_RETURN_BOOL_PATTERN,
    IF_STMT: PY_IF_STMT_PATTERN,
    ASSIGN_BINDING: PY_ASSIGN_BINDING_PATTERN,
    FOR_MULTI_VAR: PY_FOR_MULTI_VAR_PATTERN,
    TRANSIENT_ALLOCATION: PY_TRANSIENT_ALLOCATION_PATTERN,
    IMPORT_STMT: PY_IMPORT_STMT_PATTERN,
    FROM_IMPORT_CAPTURE: PY_FROM_IMPORT_CAPTURE_PATTERN,
    IMPORT_CAPTURE: PY_IMPORT_CAPTURE_PATTERN,
    AS_ALIAS_CAPTURE: PY_AS_ALIAS_CAPTURE_PATTERN,
    VALID_IDENTIFIER: PY_VALID_IDENTIFIER_PATTERN,
    EMPTY_BODY: PYTHON_EMPTY_BODY_PATTERN,
    IF_HEADER: PYTHON_IF_HEADER_PATTERN,
    DECL_HEADER: PYTHON_DECL_HEADER_PATTERN,
    createParenStripScanner,
    createStarPrefixStripScanner,
    createWithAsScanner,
});
