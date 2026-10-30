/**
 * Module: Core Constants — Standardized Regular Expression Catalog
 * File Path: src/core/constants/regex-patterns.ts
 * Architecture Role: Single source of truth (SSOT) for regular expression patterns and safe
 *     scanner factories across all analyzers, rules, and governance guards.
 * Dependencies & Triggers: Zero external dependencies; imported by core analyzers and guards.
 * Responsibilities:
 *     1. Centralize canonical regular expression patterns partitioned into semantic domains.
 *     2. Enforce the state-separation discipline: stateless immutable constants vs fresh factories.
 *     3. Expose frozen domain namespaces (NAMING, SYNTAX, COMMENT, LITERAL, SHELL, SECURITY, PYTHON, GDSCRIPT).
 *     4. Provide backward-compatible named exports with zero mutable lastIndex state leakage.
 * Exit Semantics & Design Rationale: Pure, frozen regex constants and deterministic factories;
 *     zero side effects and strictly immune to ReDoS back-tracking traps.
 */

// ============================================================================
// 1. Naming & Identifier Patterns (REGEX.NAMING)
// ============================================================================

/** Matches valid lowerCamelCase identifier. */
export const CAMEL_CASE_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/** Matches valid UpperPascalCase identifier. */
export const PASCAL_CASE_PATTERN = /^[A-Z][a-zA-Z0-9]*$/;

/** Matches valid lower_snake_case identifier. */
export const SNAKE_CASE_PATTERN = /^[a-z0-9_]+$/;

/** Matches valid kebab-case identifier. */
export const KEBAB_CASE_PATTERN = /^[a-z0-9-]+$/;

/** Matches valid SCREAMING_SNAKE_CASE constant identifier. */
export const SCREAMING_SNAKE_CASE_PATTERN = /^[A-Z0-9_]+$/;

/** Matches single-letter identifier (usually flagged by naming analyzers). */
export const SINGLE_LETTER_IDENTIFIER_PATTERN = /^[a-zA-Z]$/;

/** Matches identifier containing double underscores or illegal punctuation. */
export const MALFORMED_IDENTIFIER_PUNCTUATION_PATTERN = /_{2,}|[^a-zA-Z0-9_$]/;

/** Standard replacement template token for converting camelCase to snake_case. */
export const CAMEL_TO_SNAKE_REPLACEMENT = '$1_$2';

/** Converts a camelCase identifier to lower_snake_case using SSOT patterns. */
export function camelToSnake(name: string): string {
    return name.replace(createCamelToSnakeScanner(), CAMEL_TO_SNAKE_REPLACEMENT).toLowerCase();
}

/** Creates a fresh global scanner for converting camelCase to snake_case. */
export function createCamelToSnakeScanner(): RegExp {
    return /([a-z0-9])([A-Z])/g;
}

/** Creates a fresh global scanner for converting snake_case to camelCase. */
export function createSnakeToCamelScanner(): RegExp {
    return /_([a-z0-9])/g;
}

/** Matches semantic event handler, solver, resolver, dispatcher, or input method name prefixes. */
export const HANDLER_OR_SOLVER_PATTERN =
    /^(?:on[A-Z]|handle[A-Z]|resolve[A-Z]|solve[A-Z]|dispatch[A-Z]|_on_[a-z0-9]|_input$|_gui_input$|_unhandled_input$)/;

/** Creates a fresh global scanner for converting kebab-case to camelCase. */
export function createKebabToCamelScanner(): RegExp {
    return /-([a-z0-9])/g;
}

/** Matches transient milestone or construction jargon in symbol and file names. */
export const TRANSIENT_JARGON_PATTERN =
    /\b(p[0-9]+|phase[\s_]*[0-9]+|st[\s_]*[0-9]+|temp|tmp|w\x69p|new)\b/i;

/** Matches standalone jargon tokens. */
export const JARGON_TOKEN_PATTERN = /^(p\d+|phase\d*|st\d+|temp|tmp|w\x69p)$/;

/** Matches prefix tokens for multi-part jargon. */
export const JARGON_PREFIX_TOKEN_PATTERN = /^(?:p|st|phase)$/;

/** Matches analyzer or engine core path components. */
export const ANALYZER_OR_ENGINE_PATH_PATTERN =
    /(?:\/(?:analyzers|core|engine|tests|scripts|test)\/|-(?:analyzer|rules|helper)\.ts$)/;

/** Matches test or event hook identifier prefixes. */
export const EXEMPT_PREFIX_PATTERN = /^(?:test_|on_)/;

/** Matches English vowel characters. */
export const VOWEL_PATTERN = /[aeiouy]/i;

/** Matches English letter characters. */
export const LETTERS_PATTERN = /[a-z]/i;

/** Matches test and spec file suffix patterns. */
export const TEST_SPEC_SUFFIX_PATTERN = /\.(test|spec)$/;

/** Matches identifier starting with numeric digit. */
export const LEADING_DIGIT_PATTERN = /^[0-9]/;

/** Creates a fresh global scanner for stripping leading and trailing underscores. */
export function createSnakeCleanScanner(): RegExp {
    return /^_+|_+$/g;
}

/** Creates a fresh global scanner for stripping enclosing quotes. */
export function createOuterQuotesScanner(): RegExp {
    return /^['"`]|['"`]$/g;
}

/** Creates a fresh global scanner for replacing non-alphanumeric sequences. */
export function createNonAlphanumericScanner(): RegExp {
    return /[^A-Za-z0-9]+/g;
}

export const REGEX_NAMING = Object.freeze({
    CAMEL_CASE: CAMEL_CASE_PATTERN,
    PASCAL_CASE: PASCAL_CASE_PATTERN,
    SNAKE_CASE: SNAKE_CASE_PATTERN,
    KEBAB_CASE: KEBAB_CASE_PATTERN,
    SCREAMING_SNAKE_CASE: SCREAMING_SNAKE_CASE_PATTERN,
    SINGLE_LETTER: SINGLE_LETTER_IDENTIFIER_PATTERN,
    MALFORMED_PUNCTUATION: MALFORMED_IDENTIFIER_PUNCTUATION_PATTERN,
    HANDLER_OR_SOLVER: HANDLER_OR_SOLVER_PATTERN,
    CAMEL_TO_SNAKE_REPLACEMENT,
    camelToSnake,
    createCamelToSnakeScanner,
    createSnakeToCamelScanner,
    createKebabToCamelScanner,
    TRANSIENT_JARGON: TRANSIENT_JARGON_PATTERN,
    JARGON_TOKEN: JARGON_TOKEN_PATTERN,
    JARGON_PREFIX_TOKEN: JARGON_PREFIX_TOKEN_PATTERN,
    ANALYZER_OR_ENGINE_PATH: ANALYZER_OR_ENGINE_PATH_PATTERN,
    EXEMPT_PREFIX: EXEMPT_PREFIX_PATTERN,
    VOWEL: VOWEL_PATTERN,
    LETTERS: LETTERS_PATTERN,
    TEST_SPEC_SUFFIX: TEST_SPEC_SUFFIX_PATTERN,
    LEADING_DIGIT: LEADING_DIGIT_PATTERN,
    createSnakeCleanScanner,
    createOuterQuotesScanner,
    createNonAlphanumericScanner,
});

// ============================================================================
// 2. Syntax & Declaration Patterns (REGEX.SYNTAX)
// ============================================================================

// --- TypeScript / JavaScript ---
/** Matches leading TypeScript/JavaScript import statement. */
export const TS_IMPORT_DECL_PATTERN = /^\s*import\s+/;

/** Matches leading TypeScript/JavaScript export statement. */
export const TS_EXPORT_DECL_PATTERN = /^\s*export\s+/;

/** Matches leading function declaration. */
export const TS_FUNCTION_DECL_PATTERN = /^(?:export\s+)?(?:async\s+)?function\b/;

/** Matches leading class declaration. */
export const TS_CLASS_DECL_PATTERN = /^(?:export\s+)?(?:abstract\s+)?class\b/;

/** Matches leading interface declaration. */
export const TS_INTERFACE_DECL_PATTERN = /^(?:export\s+)?interface\b/;

/** Matches leading type alias declaration. */
export const TS_TYPE_ALIAS_PATTERN = /^(?:export\s+)?type\s+[A-Za-z0-9_]+\s*=/;

/** Matches variable assignment statement. */
export const ASSIGN_PATTERN = /^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/;

/** Matches simple relative import specifier (starts with . or /). */
export const RELATIVE_SPECIFIER_PATTERN = /^\.\.?\/|^\//;

/** Creates a fresh global scanner for JS/TS import statements across multiple styles. */
export function createJsImportScanner(): RegExp {
    return /(?:import\s+(?:type\s+)?(?:[\s\S]*?from\s+)?|export\s+(?:[\s\S]*?from\s+)?|import\(|require\()['"]([^'"]+)['"]/g;
}

/** Creates a fresh global scanner for CommonJS require calls. */
export function createRequireCallScanner(): RegExp {
    return /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
}

// --- Python ---
/** Matches Python function definition. */
export const PYTHON_DEF_PATTERN = /^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(/;

/** Matches Python async def keyword header. */
export const PYTHON_ASYNC_DEF_PATTERN = /^\s*async\s+def\b/;

/** Matches Python def keyword header. */
export const PYTHON_DEF_KEYWORD_PATTERN = /^\s*def\b/;

/** Matches Python class keyword header. */
export const PYTHON_CLASS_KEYWORD_PATTERN = /^\s*class\b/;

/** Matches Python except keyword header. */
export const PYTHON_EXCEPT_KEYWORD_PATTERN = /^\s*except\b/;

/** Matches Python with statement header. */
export const PYTHON_WITH_PATTERN = /^\s*(?:async\s+)?with\b/;

/** Matches Python function definition with parameters. */
export const PYTHON_DEF_PARAMS_PATTERN = /^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/;

/** Matches Python raise statement with explicit from cause. */
export const PYTHON_RAISE_FROM_PATTERN = /^raise\b[^\n]*\bfrom\b/;

/** Matches Python mutable default argument expressions. */
export const PYTHON_MUTABLE_DEFAULT_PATTERN = /=\s*(?:\[|\{|(?:list|dict|set)\s*\()/;

/** Matches Python PEP 585 built-in generic type annotations. */
export const PYTHON_PEP585_PATTERN = /\b(?:typing\.)?(List|Dict|Set|FrozenSet|Tuple|Type)\s*\[/;

/** Matches Python class definition. */
export const PYTHON_CLASS_PATTERN = /^\s*class\s+([A-Za-z0-9_]+)/;

/** Matches Python import statement. */
export const PYTHON_FROM_IMPORT_PATTERN = /^\s*(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/;

// --- Rust ---
/** Matches Rust use declaration. */
export const RUST_USE_PATTERN = /^\s*use\s+(?:crate|super|[a-zA-Z0-9_]+)::/;

/** Matches Rust function declaration. */
export const RUST_FN_PATTERN = /^\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z0-9_]+)/;

/** Matches Rust struct or enum declaration. */
export const RUST_STRUCT_OR_ENUM_PATTERN = /^\s*(?:pub(?:\([^)]+\))?\s+)?(?:struct|enum)\s+([A-Za-z0-9_]+)/;

/** Matches Rust test attribute header (e.g. #[test], #[tokio::test], #[cfg(test)], #[rstest]). */
export const RUST_TEST_ATTR_PATTERN = /#\[[^\]]*(?:test|cfg\(test\))[^\]]*\]/;

/** Matches Rust naked unwrap method invocation. */
export const RUST_UNWRAP_PATTERN = /\.unwrap\s*\(/;

/** Creates a fresh global scanner for Rust .unwrap() and .expect() calls. */
export function createRustUnwrapScanner(): RegExp {
    return /\.(?:unwrap|expect)\s*\(/g;
}

// --- GDScript ---
/** Matches GDScript func declaration. */
export const GDSCRIPT_FUNC_PATTERN = /^\s*(?:static\s+)?func\s+([A-Za-z0-9_]+)\s*\(/;

/** Matches GDScript class_name declaration. */
export const GDSCRIPT_CLASS_NAME_PATTERN = /^\s*class_name\s+([A-Za-z0-9_]+)/;

/** Matches GDScript const declaration. */
export const GDSCRIPT_CONST_PATTERN = /^\s*const\s+([A-Za-z0-9_]+)\s*[:=]/;

/** Matches GDScript var declaration (including @export / @onready decorators). */
export const GDSCRIPT_VAR_PATTERN = /^\s*(?:@(?:export|onready)\s+)?var\s+([A-Za-z0-9_]+)/;

/** Matches GDScript extends statement. */
export const GDSCRIPT_EXTENDS_PATTERN = /^\s*extends\s+([A-Za-z0-9_"]+)/;

/** Matches GDScript signal connect method call. */
export const GDSCRIPT_SIGNAL_CONNECT_PATTERN = /\.connect\s*\(/;

/** Matches GDScript signal disconnect method call. */
export const GDSCRIPT_SIGNAL_DISCONNECT_PATTERN = /\.disconnect\s*\(/;

/** Matches GDScript reset_state function definition. */
export const GDSCRIPT_RESET_STATE_FUNC_PATTERN = /^\s*func\s+reset_state\s*\(\s*\)/;

/** Matches GDScript reset_state method invocation. */
export const GDSCRIPT_RESET_STATE_CALL_PATTERN = /(?:\.|\b)reset_state\s*\(/;

/** Matches legacy Godot 3 Pool*Array types. */
export const GDSCRIPT_POOL_ARRAY_PATTERN = /\bPool(?:Byte|Int|Real|String|Vector2|Vector3|Color)Array\b/;

/** Matches legacy Godot 3 onready var keyword prefix. */
export const GDSCRIPT_ONREADY_PATTERN = /^\s*onready\s+var\b/;

/** Matches legacy Godot 3 tool keyword statement. */
export const GDSCRIPT_TOOL_PATTERN = /^\s*tool\s*$/;

/** Matches legacy Godot 3 yield statement. */
export const GDSCRIPT_YIELD_PATTERN = /\byield\s*\(/;

/** Matches legacy Godot 3 export statement. */
export const GDSCRIPT_EXPORT_STMT_PATTERN = /^\s*export(?:\s*\([^)]*\))?\s+(?:var|const|onready)\b/;

/** Creates a fresh global scanner for GDScript preload/load calls and string extends. */
export function createGdscriptPreloadScanner(): RegExp {
    return /(?:(?:preload|load)\s*\(\s*['"](?:res:\/\/)?([^'"]+)['"]\s*\)|extends\s+['"](?:res:\/\/)?([^'"]+)['"])/g;
}

// --- Go ---
/** Matches Go package statement. */
export const GO_PACKAGE_PATTERN = /^\s*package\s+([a-zA-Z0-9_]+)/;

/** Matches Go func declaration. */
export const GO_FUNC_PATTERN = /^\s*func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)\s*\(/;

/** Matches Go import statement. */
export const GO_IMPORT_PATTERN = /^\s*(?:import\s+)?['"]([^'"]+)['"]/;

/** Matches Go type definition (type Foo struct or type Bar interface). */
export const GO_TYPE_DEF_PATTERN = /^type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(struct|interface)\b/;

/** Matches Go method declaration with receiver. */
export const GO_METHOD_DECL_PATTERN = /^func\s+\((?:[^)]+)\)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*\(/;

/** Matches Go func declaration with optional generics. */
export const GO_FUNC_DECL_PATTERN = /^func\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*\(/;

/** Matches Go var declaration. */
export const GO_VAR_DECL_PATTERN = /^var\s+(?:\(\s*)?([A-Za-z_][A-Za-z0-9_]*)/;

/** Matches Go const declaration. */
export const GO_CONST_DECL_PATTERN = /^const\s+(?:\(\s*)?([A-Za-z_][A-Za-z0-9_]*)/;

/** Matches Go const block start (const (). */
export const GO_CONST_BLOCK_START_PATTERN = /^const\s*\(/;

/** Matches Go var block start (var (). */
export const GO_VAR_BLOCK_START_PATTERN = /^var\s*\(/;

/** Matches Go entry line inside const/var block. */
export const GO_BLOCK_ENTRY_PATTERN = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|\s+[A-Za-z_*])/;

/** Matches Go control flow statement keywords. */
export const GO_CONTROL_FLOW_PATTERN = /^\s*(?:if|for|switch|select)\b/;

/** Matches Go switch or select case/default label. */
export const GO_CASE_LABEL_PATTERN = /^\s*(?:case\b|default:)/;

/** Matches Go goroutine spawn statement (go ...). */
export const GO_STMT_PATTERN = /^\s*go\s+/;

/** Matches Go defer statement (defer ...). */
export const GO_DEFER_STMT_PATTERN = /^\s*defer\s+/;

/** Matches Go return statement. */
export const GO_RETURN_STMT_PATTERN = /^\s*return\b/;

/** Creates a fresh global scanner for Go named literal tokens (true, false, nil, iota). */
export function createGoNamedLiteralScanner(): RegExp {
    return /\b(true|false|nil|iota)\b/g;
}

/** Creates a fresh global scanner for Go function call expressions. */
export function createGoCallExprScanner(): RegExp {
    return /([A-Za-z_](?:[\w.]*[A-Za-z0-9_])?)\s*\(/g;
}

/** Creates a fresh global scanner for quoted string literals. */
export function createStringLiteralScanner(): RegExp {
    return /(["`])((?:\\.|(?!\1).)*)\1/g;
}

/** Creates a fresh global scanner for integer literal numbers. */
export function createIntLiteralScanner(): RegExp {
    return /\b(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|[1-9][0-9_]*|0)\b/g;
}

/** Creates a fresh global scanner for floating point literal numbers. */
export function createFloatLiteralScanner(): RegExp {
    return /\b(?:(?:[0-9][0-9_]*\.[0-9_]*|[0-9][0-9_]*[eE][+-]?[0-9_]+|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9_]+)?)\b/g;
}

// --- Frontend / JSX & CSS ---
/** Matches <img> tag missing alt attribute. */
export const JSX_IMG_WITHOUT_ALT_PATTERN = /<img\b(?![^>]*\balt\s*=)[^>]*>/i;

/** Matches interactive div or span without semantic tag. */
export const JSX_INTERACTIVE_TAG_PATTERN = /<(?:div|span)\b[^>]*\bon(?:click|keydown|keyup)\s*=[^>]*>/i;

/** Matches role attribute in JSX/HTML. */
export const JSX_ROLE_ATTR_PATTERN = /\brole\s*=\s*(?:['"][^'"]+['"]|\{[^}]+\})/i;

/** Matches tabindex attribute in JSX/HTML. */
export const JSX_TABINDEX_ATTR_PATTERN = /\btabindex\s*=\s*(?:['"]?[-\d]+['"]?|\{[^}]+\})/i;

/** Matches Enter key event listener condition. */
export const JSX_ENTER_KEY_EVENT_PATTERN = /\b(?:e|event)\.(?:key\s*===?\s*['"]Enter['"]|code\s*===?\s*['"]Enter['"]|keyCode\s*===?\s*13\b)/i;

/** Matches IME composition state guard expression. */
export const JSX_IME_GUARD_PATTERN = /\b(?:isComposing|keyCode\s*===?\s*229|which\s*===?\s*229)\b/;

/** Matches dynamic timer, countdown, or counter display elements. */
export const JSX_TIMER_DISPLAY_PATTERN = /(?:\{\s*(?:format(?:Time|Duration|Timer)|[a-zA-Z0-9_]*(?:elapsed|timer|stopwatch|countdown)[a-zA-Z0-9_]*)\b|<(?:span|div|p)\b[^>]*\b(?:timer|stopwatch|clock|counter|elapsed|duration)[^>]*>)/i;

/** Matches tabular-nums CSS font variant class or property. */
export const JSX_TABULAR_NUMS_PATTERN = /\b(?:tabular-nums|tnum|font-variant-numeric)\b/i;

/** Matches bordered container elements. */
export const JSX_CONTAINER_BORDER_PATTERN = /<(?:div|section|aside|nav|fieldset)\b[^>]*\bclass(?:Name)?\s*=\s*['"][^'"]*\b(?:border|border-(?:gray|slate|zinc|neutral|stone|solid|dashed|\d{3}))\b[^'"]*['"]/i;

/** Matches bordered child control elements. */
export const JSX_CHILD_BORDER_PATTERN = /<(?:button|input|select|span)\b[^>]*\bclass(?:Name)?\s*=\s*['"][^'"]*(?<![tbrl]-)\bborder(?:\s+|-[a-z0-9]+|\b)(?![tbrl]-)[^'"]*['"]/i;

/** Matches closing container tags (div or section). */
export const JSX_CLOSING_CONTAINER_PATTERN = /<\/(?:div|section)>/i;

/** Matches CSS transition or animation properties triggering layout reflow. */
export const CSS_REFLOW_PROPERTIES_PATTERN = /\b(?:transition|animation)\s*:[^;]*\b(?:width|height|top|left|right|bottom|margin|padding)\b/i;

/** Matches CSS anti-squash properties for CJK typography. */
export const CSS_ANTI_SQUASH_PATTERN = /\b(?:text-balance|text-wrap:\s*balance\b|textWrap:\s*['"]balance['"]|break-words|overflow-wrap:\s*(?:break-word|anywhere)\b|overflowWrap:\s*['"](?:break-word|anywhere)['"]|word-break:\s*break-word\b)/i;

/** Matches CSS @media query rule. */
export const CSS_MEDIA_QUERY_PATTERN = /@media\b/i;

/** Matches CSS local class or id rule declaration block. */
export const CSS_LOCAL_CLASS_OR_ID_PATTERN = /(?:\.[a-zA-Z_-][\w-]*|#[a-zA-Z_-][\w-]*)\s*\{/;

/** Matches line opening a RegExp literal. */
export const REGEX_LITERAL_LINE_PATTERN = /^\s*(?:const|let|var)?\s*[\w$]+\s*(?::[^=]+)?=\s*\/(?![*/])/;

/** Matches single or double quoted pure string assignment line. */
export const PURE_STRING_ASSIGNMENT_PATTERN = /^\s*[\w$'"]+\s*:\s*(?:'[^'\r\n]*'|"[^"\r\n]*")\s*,?\s*$/;

/** Matches a standalone string literal line. */
export const STRING_VALUE_LINE_PATTERN = /^\s*(?:(?:const|let|var)\s+[\w$]+(?:\s*:\s*[^=]+)?\s*=\s*)?(?:'[^'\r\n]*'|"[^"\r\n]*")\s*;?\s*$/;

/** Creates a fresh global scanner for React hook function declarations. */
export function createJsxHookDeclScanner(): RegExp {
    return /\bfunction\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/g;
}

/** Creates a fresh global scanner for event handler arrow function declarations. */
export function createJsxHandlerDeclScanner(): RegExp {
    return /\b(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/g;
}

/** Creates a fresh global scanner for React Component Props interface declarations. */
export function createJsxInterfacePropsScanner(): RegExp {
    return /interface\s+([A-Za-z0-9_]*Props)\s*\{([^}]+)\}/g;
}

// --- Type System & Inference ---
/** Matches GDScript weak variable assignment without explicit type or inference. */
export const GDSCRIPT_WEAK_VAR_PATTERN = /^\s*(?:@\w+\s+)?(?:static\s+)?var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=(?!=)/;

/** Matches ambiguous Variant right-hand side initializers. */
export const GDSCRIPT_VARIANT_RHS_PATTERN = /^\s*(?:null|\[\]|\{\}|Variant)/;

/** Matches ambiguous Variant method calls. */
export const GDSCRIPT_VARIANT_CALL_PATTERN = /\.get\(|\bget\(.*Variant|Variant.*get\(/;

/** Matches collection indexing on a variable. */
export const GDSCRIPT_COLLECTION_ACCESS_PATTERN = /^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*[\[.]/;

/** Matches known non-Variant singleton calls. */
export const GDSCRIPT_NON_VARIANT_SINGLETONS_PATTERN = /(?:GameConfig|DeterministicRNG|UniqueIdGenerator)\./;

/** Matches dictionary get prefix call. */
export const GDSCRIPT_DICT_GET_PATTERN = /^d\.get\(/;

/** Matches GDScript func definition lacking return type arrow. */
export const GDSCRIPT_FUNC_NO_RETURN_PATTERN = /^\s*(?:static\s+)?func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*(?!->)\s*:/;

/** Matches start of Python def header. */
export const PYTHON_FUNC_START_PATTERN = /^\s*(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;

/** Matches Python return type annotation in def header. */
export const PYTHON_RETURN_TYPE_PATTERN = /\)\s*->\s*[^:]+:/;

/** Matches exported TypeScript function declaration header. */
export const TS_EXPORT_FN_PATTERN = /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/;

/** Matches exported TypeScript const arrow function declaration header. */
export const TS_EXPORT_CONST_ARROW_PATTERN = /^\s*export\s+const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(/;

/** Matches TypeScript function signature return type suffix. */
export const TS_FN_RETURN_TYPE_SUFFIX_PATTERN = /\)\s*:\s*[^{;]+(?:\{|;)/;

/** Matches TypeScript arrow function return type suffix. */
export const TS_ARROW_RETURN_TYPE_SUFFIX_PATTERN = /\)\s*:\s*[^=]+=>/;

/** Matches Rust standard or module path prefixes (std::, crate::, core::). */
export const RUST_PATH_PREFIX_PATTERN = /^(?:std|crate|core|super|self)::/;

/** Matches test assertion probe call prefixes (expect or assert). */
export const TEST_PROBE_PATTERN = /^(?:expect|assert)[.(]?$/;

/** Matches the "any" type keyword as a standalone token. */
export const TS_ANY_KEYWORD_PATTERN = /\bany\b/;

/** Matches explicit : any or as any type annotations. */
export const TS_ANY_TYPE_PATTERN = /:\s*\bany\b|\bas\s+any\b/;

/** Matches block opening brace or statement semicolon delimiter. */
export const BLOCK_OR_SEMI_PATTERN = /[{;]/;

/** Matches ES6 arrow function token =>. */
export const ARROW_BODY_PATTERN = /=>/;

// --- Java / JVM ---
/** Matches Java / Kotlin import statement. */
export const JAVA_IMPORT_PATTERN = /^\s*import\s+(?:static\s+)?([A-Za-z0-9_.]+);?/;

// --- C# / .NET ---
/** Matches C# using directive. */
export const CSHARP_USING_PATTERN = /^\s*using\s+([A-Za-z0-9_.]+);/;

// --- TypeScript / JavaScript Modernization & AST Blocks ---
/** Matches var variable declaration. */
export const TS_VAR_DECL_PATTERN = /\bvar\s+[A-Za-z_$]/;

/** Matches CommonJS require call. */
export const TS_REQUIRE_CALL_PATTERN = /\brequire\s*\(/;

/** Matches ESM import/export syntax header. */
export const TS_ESM_SYNTAX_PATTERN = /^\s*(?:import|export)\b/m;

/** Matches primitive wrapper constructor instantiations (new Array/Object/String/Number/Boolean). */
export const TS_WRAPPER_CTOR_PATTERN = /\bnew\s+(?:Array|Object|String|Number|Boolean)\s*\(/;

/** Matches usage of the legacy arguments object. */
export const TS_ARGUMENTS_USE_PATTERN = /\barguments\s*(?:\[|\.|\))/;

/** Matches Object.assign({}, ...) shallow clone call. */
export const TS_OBJECT_ASSIGN_PATTERN = /\bObject\s*\.\s*assign\s*\(\s*\{\s*\}/;

/** Matches indexOf comparison against boundary (-1 or 0). */
export const TS_INDEX_OF_BOUNDARY_PATTERN = /\.\s*indexOf\s*\([^)]*\)\s*(?:!==?\s*-1|===?\s*-1|>=?\s*0|>\s*-1)/;

/** Matches deprecated String.prototype.substr call. */
export const TS_SUBSTR_PATTERN = /\.\s*substr\s*\(/;

/** Matches String.prototype.replace call with a string literal pattern. */
export const TS_REPLACE_LITERAL_PATTERN = /\.\s*replace\s*\(\s*(['"`])/;

/** Fast guard pattern matching .replace( call. */
export const TS_REPLACE_CALL_PATTERN = /\.replace\(/;

/** Matches named import clause without type modifier. */
export const TS_NAMED_IMPORT_PATTERN = /^\s*import\s+\{([^}]*)\}\s+from\s/;

/** Matches standalone function declaration header for block extraction. */
export const TS_FUNCTION_HEADER_PATTERN = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/;

/** Matches method declaration header with optional modifiers and return type. */
export const TS_METHOD_HEADER_PATTERN = /^(?:(?:public|private|protected|static|async)\s+)*([A-Za-z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^,{]+)?\s*\{/;

/** Matches class declaration header for block extraction. */
export const TS_CLASS_HEADER_PATTERN = /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/;

/** Matches interface declaration header for block extraction. */
export const TS_INTERFACE_HEADER_PATTERN = /^(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/;

/** Matches type alias declaration header for block extraction. */
export const TS_TYPE_ALIAS_HEADER_PATTERN = /^(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/;

/** Matches general loop header statement across programming languages. */
export const LOOP_HEADER_PATTERN =
    /\b(?:for\s*\(|for\s+[a-zA-Z0-9_$]+(?:\s*,\s*[a-zA-Z0-9_$]+)?\s*(?:in|range|:=)|for\s*\{|while\s*\(|while\s+[^{:\n]+|loop\s*\{|do\s*\{)\b/;

/** Matches transient container heap allocation in TypeScript/JavaScript loops. */
export const TRANSIENT_TS_CONTAINER_PATTERN =
    /\b(?:new\s+(?:Array|Object|Map|Set|WeakMap|WeakSet|Int[0-9]+Array|Uint[0-9]+Array|Float[0-9]+Array)|\/duplicate\(true\)|\.clone\()/;

/** Matches synchronous or blocking I/O calls inside performance-critical paths or loops. */
export const BLOCKING_IO_PATTERN =
    /\b(?:fs\.readFileSync|fs\.writeFileSync|execSync|spawnSync|socket\.send|db\.query)\b/;

/** Matches valid JS/TS identifier name. */
export const VALID_IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;

/** Matches special regular expression characters for escaping. */
export const REGEX_ESCAPE_PATTERN = /[.*+?^${}()|[\]\\]/;

/** Creates a fresh global scanner for escaping regular expression characters. */
export function createRegexEscapeScanner(): RegExp {
    return /[.*+?^${}()|[\]\\]/g;
}

/**
 * Safely escapes special regular expression characters in a string.
 *
 * @param text - Raw input text.
 * @returns Escaped string safe for RegExp constructor.
 */
export function escapeRegex(text: string): string {
    return text.replace(createRegexEscapeScanner(), '\\$&');
}

/** Matches line-ending argument list terminator punctuation. */
export const PREV_LINE_ARG_TERMINATOR_PATTERN = /[(=,[]$/;

// --- Rust Modernization & Expressions ---
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
export const RUST_NUMERIC_CAST_PATTERN = /\bas\s+(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f32|f64)\b/;

/** Matches formatting macro invocation. */
export const RUST_FORMAT_CALL_PATTERN = /\b(?:println|print|eprintln|eprint|format|panic|write|writeln)!\s*\(/;

/** Matches positional placeholder {} in formatting macro. */
export const RUST_POSITIONAL_PLACEHOLDER_PATTERN = /!\s*\(\s*"[^"]*\{\}/;

/** Matches multiline format call with empty positional placeholder. */
export const RUST_MULTILINE_FORMAT_PATTERN = /\b(?:println|print|eprintln|eprint|format|panic|write|writeln)!\s*\([^;]*"[^"]*\{\}/;

/** Matches if let pattern matching statement. */
export const RUST_IF_LET_PATTERN = /\bif\s+let\s+[^{]+=\s*/;

/** Matches for ... in loop header. */
export const RUST_FOR_IN_PATTERN = /\bfor\s+(?:[A-Za-z_]\w*|\([A-Za-z0-9_,\s]+\))\s+in\b/;

/** Matches for ... in loop with immediate conditional return. */
export const RUST_FOR_FIND_PATTERN = /\bfor\s+[^{]+\{\s*if\s+[^{]+\{\s*return\b/;

/** Matches async function declaration. */
export const RUST_ASYNC_FN_PATTERN = /\basync\s+(?:unsafe\s+)?(?:extern(?:\s+"[^"]+")?\s+)?fn\b/;

/** Matches synchronous standard library Mutex/RwLock acquisition without await. */
export const RUST_STD_LOCK_PATTERN = /(?:std::sync::(?:Mutex|RwLock)|\.(?:lock|read|write)\s*\(\s*\)(?!\s*\.await))/;

/** Matches .await keyword expression. */
export const RUST_AWAIT_PATTERN = /\.await\b/;

/** Matches panic!, todo!, unimplemented!, or unreachable! macro calls. */
export const RUST_CRASH_MACRO_PATTERN = /\b(?:panic|todo|unimplemented|unreachable)!\s*\(/;

/** Matches .expect() method call. */
export const RUST_EXPECT_CALL_PATTERN = /\.expect\s*\(/;

// --- Code Simplification & Block Structure ---
/** Matches code assignment or invocation expression line. */
export const ASSIGN_LINE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*\s*(?:[-+*/%]?=|\+\+|--|\.[A-Za-z_]\w*\s*=|\()/;

/** Matches debug print / console logging calls across languages. */
export const DEBUG_PRINT_CALL_PATTERN = /\b(?:print|pprint|breakpoint|dbg!|println!|eprintln!)\s*\(|\bconsole\.(?:log|debug|info|trace)\s*\(/;

/** Matches Python empty body pass statement. */
export const PYTHON_EMPTY_BODY_PATTERN = /^pass\s*$/;

/** Matches function with empty brace body on a single line. */
export const BRACE_EMPTY_ONE_LINER_PATTERN = /\b(?:function|fn|func)\s+[A-Za-z_]\w*[^;{]*\{\s*\}\s*$/;

/** Matches function header line opening a brace. */
export const BRACE_OPEN_FN_PATTERN = /\b(?:function|fn|func)\s+[A-Za-z_]\w*[^;{]*\{\s*$/;

/** Matches line consisting only of closing brace with optional semicolon. */
export const BRACE_CLOSE_LINE_PATTERN = /^\s*\}\s*;?\s*$/;

/** Matches control-flow terminating statement (return, throw, break, continue). */
export const TERMINATING_STMT_PATTERN = /^\s*(?:return|throw|break|continue)\b/;

/** Matches if statement with opening brace. */
export const IF_OPEN_PATTERN = /\bif\s*\([^)]*\)\s*\{/;

/** Matches else clause following closing brace. */
export const ELSE_CLAUSE_PATTERN = /^\s*\}\s*else\b/;

/** Matches return true or return false statement. */
export const RETURN_BOOL_PATTERN = /^\s*return\s+(true|false)\s*[;}]?\s*$/;

/** Matches return statement with boolean ternary expression. */
export const TERNARY_BOOL_RETURN_PATTERN = /return\s+[^;]+\?\s*(?:true|false)\s*:\s*(?:true|false)\s*[;}]/;

/** Matches Python if statement header line. */
export const PYTHON_IF_HEADER_PATTERN = /^(\s*)if\s+.*:\s*$/;

/** Matches line composed exclusively of opening or closing braces. */
export const BRACE_ONLY_LINE_PATTERN = /^[{}]+$/;

/** Matches Rust use import specifier. */
export const RUST_USE_IMPORT_PATTERN = /^\s*use\s+([A-Za-z0-9_:]+)/;

/** Matches GDScript preload or load import statement. */
export const GDSCRIPT_LOAD_IMPORT_PATTERN = /(?:preload|load)\s*\(\s*['"](?:res:\/\/)?([^'"]+)['"]\s*\)/;

/** Matches Python function or class declaration header. */
export const PYTHON_DECL_HEADER_PATTERN = /^\s*(?:def|class)\s+[A-Za-z0-9_]+/;

/** Matches GDScript func declaration header. */
export const GDSCRIPT_FUNC_DECL_HEADER_PATTERN = /^\s*func\s+[A-Za-z0-9_]+/;

/** Matches Rust function declaration header. */
export const RUST_FN_DECL_HEADER_PATTERN = /^\s*(?:pub\s+)?(?:async\s+)?fn\s+[A-Za-z0-9_]+/;

/** Matches TypeScript import or require declaration line. */
export const TS_IMPORT_LINE_PATTERN =
    /^\s*(?:import\s+(?:type\s+)?(?:[\s\S]*?from\s+)?|const\s+.*=\s*require\()['"]([^'"]+)['"]/;

/** Matches TypeScript wildcard import statements. */
export const TS_WILDCARD_IMPORT_PATTERN = /\b(?:import\s+\*\s+as|import\s+\*)/;

/** Matches uppercase constant alias declarations. */
export const CONSTANT_ALIAS_PATTERN =
    /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*(?::\s*[^=]+)?\s*=\s*([A-Z][A-Z0-9_]{2,})\s*;?$/;

/** Matches diagnostic or logging message prefixes. */
export const DIAGNOSTIC_LOG_PREFIX_PATTERN =
    /^(?:error|failed|warning|info|debug|trace|fatal|assert|[A-Z0-9]+-[A-Z0-9]+-[0-9]+):/i;

/** Matches diagnostic or logging invocation parent contexts. */
export const DIAGNOSTIC_CALL_PARENT_PATTERN =
    /(?:\b(?:log(?:ger|ging)?|console\.(?:log|warn|error|info|debug)|print|println|eprintln|panic|bail|anyhow)\s*\(|new\s+Error|raise\s+|reject\(|exit\(|warn(?:ing)?\()/i;

/** Matches audit finding or violation sink push invocations. */
export const DIAGNOSTIC_SINK_PARENT_PATTERN =
    /(?:\b(?:violations\.push|push_violation|findings\.append|issues\.append|auditfinding|finding|violation|diagnostic)\s*\(|echo\s+|write-host\b|tracing::)/i;

/** Matches Go function declaration line. */
export const GO_FUNC_DECL_LINE_PATTERN =
    /^\s*func\s+(?:\([^)]+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*\(/;

/** Matches Go struct or interface type definition. */
export const GO_STRUCT_OR_INTERFACE_PATTERN =
    /^\s*(?:type\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:struct|interface)\b/;

/** Matches Go const declaration line (linear ReDoS immune). */
export const GO_CONST_DECL_LINE_PATTERN = /^\s*const\s+([a-zA-Z_][a-zA-Z0-9_,\s]*)/;

/** Matches Go var declaration line (linear ReDoS immune). */
export const GO_VAR_DECL_LINE_PATTERN = /^\s*var\s+([a-zA-Z_][a-zA-Z0-9_,\s]*)/;

/** Matches Go for-loop variable binding line (linear ReDoS immune). */
export const GO_FOR_DECL_LINE_PATTERN = /^\s*for\s+([a-zA-Z_][a-zA-Z0-9_,\s]*)\s*:?=/;

/** Matches Go if short statement binding line (linear ReDoS immune). */
export const GO_IF_SHORT_DECL_PATTERN = /^\s*if\s+([a-zA-Z_][a-zA-Z0-9_,\s]*)\s*:=/;

/** Matches Go short variable declaration line (linear ReDoS immune). */
export const GO_SHORT_VAR_DECL_PATTERN = /^\s*([a-zA-Z_][a-zA-Z0-9_,\s]*)\s*:=/;

/** Matches GDScript for loop statement line. */
export const GDSCRIPT_FOR_DECL_PATTERN = /^\s*for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\b/;

/** Matches cryptographic keywords for constant-time comparison audits. */
export const STDLIB_CRYPTO_KEYWORD_PATTERN =
    /(?:crypto|hash|token|secret|digest|cipher|signature|subtle|constant_time|hmac|sha256|blake3|keccak|aes_)/i;

/** Matches platform-specific target configuration attributes. */
export const STDLIB_TARGET_CFG_PATTERN =
    /(?:#\[cfg\(target_os|#\[cfg\(target_arch|#if defined\(__linux__\)|#ifdef _WIN32)/;

/** Matches compile error or unsupported platform fallbacks. */
export const STDLIB_FALLBACK_PATTERN = /(?:compile_error!|#error|unsupported platform|cfg\(not\(any\()/;

/** Matches no_std or kernel bare-metal context indicators. */
export const STDLIB_NO_STD_CONTEXT_PATTERN = /(?:#!\[no_std\]|#!\[no_core\]|\/no_std\/|\/core\/)/;

/** Matches implicit heap allocations in no_std/kernel contexts. */
export const STDLIB_IMPLICIT_ALLOC_PATTERN =
    /(?:\bBox::new\s*\(|\bVec::new\s*\(|\balloc::boxed::Box\b|\balloc::vec::Vec\b|\b(?:malloc|calloc)\s*\()/;

/** Matches bare panic, unwrap, or abort in public routines. */
export const STDLIB_RUST_PANIC_PATTERN = /(?:\bpanic!\s*\(|\b(?:todo!|unimplemented!)\s*\(|\.unwrap\(\))/;

/** Matches exported Go function signature header. */
export const STDLIB_GO_PUB_FN_PATTERN = /^func\s+(?:\([^)]+\)\s+)?([A-Z][a-zA-Z0-9_]*)\s*\(/;

/** Matches generic function definition header. */
export const STDLIB_FN_DEF_PATTERN = /(?:fn|function|def)\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/;

/** Matches recursion depth or budget limit parameter. */
export const STDLIB_DEPTH_GUARD_PARAM_PATTERN =
    /\b(?:depth|level|limit|fuel|recursion_limit|max_depth)\b/i;

/** Matches recursion depth guard check condition in function body. */
export const STDLIB_DEPTH_GUARD_BODY_PATTERN =
    /\bif\s+.*(?:depth|level|limit|fuel|recursion_limit|max_depth)\b/i;

export const REGEX_SYNTAX = Object.freeze({
    TS_IMPORT_DECL: TS_IMPORT_DECL_PATTERN,
    TS_EXPORT_DECL: TS_EXPORT_DECL_PATTERN,
    TS_FUNCTION_DECL: TS_FUNCTION_DECL_PATTERN,
    TS_CLASS_DECL: TS_CLASS_DECL_PATTERN,
    TS_INTERFACE_DECL: TS_INTERFACE_DECL_PATTERN,
    TS_TYPE_ALIAS: TS_TYPE_ALIAS_PATTERN,
    ASSIGN: ASSIGN_PATTERN,
    RELATIVE_SPECIFIER: RELATIVE_SPECIFIER_PATTERN,
    PYTHON_DEF: PYTHON_DEF_PATTERN,
    PYTHON_ASYNC_DEF: PYTHON_ASYNC_DEF_PATTERN,
    PYTHON_DEF_KEYWORD: PYTHON_DEF_KEYWORD_PATTERN,
    PYTHON_CLASS_KEYWORD: PYTHON_CLASS_KEYWORD_PATTERN,
    PYTHON_EXCEPT_KEYWORD: PYTHON_EXCEPT_KEYWORD_PATTERN,
    PYTHON_WITH: PYTHON_WITH_PATTERN,
    PYTHON_DEF_PARAMS: PYTHON_DEF_PARAMS_PATTERN,
    PYTHON_RAISE_FROM: PYTHON_RAISE_FROM_PATTERN,
    PYTHON_MUTABLE_DEFAULT: PYTHON_MUTABLE_DEFAULT_PATTERN,
    PYTHON_PEP585: PYTHON_PEP585_PATTERN,
    PYTHON_CLASS: PYTHON_CLASS_PATTERN,
    PYTHON_FROM_IMPORT: PYTHON_FROM_IMPORT_PATTERN,
    RUST_USE: RUST_USE_PATTERN,
    RUST_FN: RUST_FN_PATTERN,
    RUST_STRUCT_OR_ENUM: RUST_STRUCT_OR_ENUM_PATTERN,
    RUST_TEST_ATTR: RUST_TEST_ATTR_PATTERN,
    RUST_UNWRAP: RUST_UNWRAP_PATTERN,
    GDSCRIPT_FUNC: GDSCRIPT_FUNC_PATTERN,
    GDSCRIPT_CLASS_NAME: GDSCRIPT_CLASS_NAME_PATTERN,
    GDSCRIPT_CONST: GDSCRIPT_CONST_PATTERN,
    GDSCRIPT_VAR: GDSCRIPT_VAR_PATTERN,
    GDSCRIPT_EXTENDS: GDSCRIPT_EXTENDS_PATTERN,
    GDSCRIPT_SIGNAL_CONNECT: GDSCRIPT_SIGNAL_CONNECT_PATTERN,
    GDSCRIPT_SIGNAL_DISCONNECT: GDSCRIPT_SIGNAL_DISCONNECT_PATTERN,
    GDSCRIPT_RESET_STATE_FUNC: GDSCRIPT_RESET_STATE_FUNC_PATTERN,
    GDSCRIPT_RESET_STATE_CALL: GDSCRIPT_RESET_STATE_CALL_PATTERN,
    GDSCRIPT_POOL_ARRAY: GDSCRIPT_POOL_ARRAY_PATTERN,
    GDSCRIPT_ONREADY: GDSCRIPT_ONREADY_PATTERN,
    GDSCRIPT_TOOL: GDSCRIPT_TOOL_PATTERN,
    GDSCRIPT_YIELD: GDSCRIPT_YIELD_PATTERN,
    GDSCRIPT_EXPORT_STMT: GDSCRIPT_EXPORT_STMT_PATTERN,
    GO_PACKAGE: GO_PACKAGE_PATTERN,
    GO_FUNC: GO_FUNC_PATTERN,
    GO_IMPORT: GO_IMPORT_PATTERN,
    GO_TYPE_DEF: GO_TYPE_DEF_PATTERN,
    GO_METHOD_DECL: GO_METHOD_DECL_PATTERN,
    GO_FUNC_DECL: GO_FUNC_DECL_PATTERN,
    GO_VAR_DECL: GO_VAR_DECL_PATTERN,
    GO_CONST_DECL: GO_CONST_DECL_PATTERN,
    GO_CONST_BLOCK_START: GO_CONST_BLOCK_START_PATTERN,
    GO_VAR_BLOCK_START: GO_VAR_BLOCK_START_PATTERN,
    GO_BLOCK_ENTRY: GO_BLOCK_ENTRY_PATTERN,
    GO_CONTROL_FLOW: GO_CONTROL_FLOW_PATTERN,
    GO_CASE_LABEL: GO_CASE_LABEL_PATTERN,
    GO_STMT: GO_STMT_PATTERN,
    GO_DEFER_STMT: GO_DEFER_STMT_PATTERN,
    GO_RETURN_STMT: GO_RETURN_STMT_PATTERN,
    JSX_IMG_WITHOUT_ALT: JSX_IMG_WITHOUT_ALT_PATTERN,
    JSX_INTERACTIVE_TAG: JSX_INTERACTIVE_TAG_PATTERN,
    JSX_ROLE_ATTR: JSX_ROLE_ATTR_PATTERN,
    JSX_TABINDEX_ATTR: JSX_TABINDEX_ATTR_PATTERN,
    JSX_ENTER_KEY_EVENT: JSX_ENTER_KEY_EVENT_PATTERN,
    JSX_IME_GUARD: JSX_IME_GUARD_PATTERN,
    JSX_TIMER_DISPLAY: JSX_TIMER_DISPLAY_PATTERN,
    JSX_TABULAR_NUMS: JSX_TABULAR_NUMS_PATTERN,
    JSX_CONTAINER_BORDER: JSX_CONTAINER_BORDER_PATTERN,
    JSX_CHILD_BORDER: JSX_CHILD_BORDER_PATTERN,
    JSX_CLOSING_CONTAINER: JSX_CLOSING_CONTAINER_PATTERN,
    CSS_REFLOW_PROPERTIES: CSS_REFLOW_PROPERTIES_PATTERN,
    CSS_ANTI_SQUASH: CSS_ANTI_SQUASH_PATTERN,
    CSS_MEDIA_QUERY: CSS_MEDIA_QUERY_PATTERN,
    CSS_LOCAL_CLASS_OR_ID: CSS_LOCAL_CLASS_OR_ID_PATTERN,
    REGEX_LITERAL_LINE: REGEX_LITERAL_LINE_PATTERN,
    PURE_STRING_ASSIGNMENT: PURE_STRING_ASSIGNMENT_PATTERN,
    STRING_VALUE_LINE: STRING_VALUE_LINE_PATTERN,
    GDSCRIPT_WEAK_VAR: GDSCRIPT_WEAK_VAR_PATTERN,
    GDSCRIPT_VARIANT_RHS: GDSCRIPT_VARIANT_RHS_PATTERN,
    GDSCRIPT_VARIANT_CALL: GDSCRIPT_VARIANT_CALL_PATTERN,
    GDSCRIPT_COLLECTION_ACCESS: GDSCRIPT_COLLECTION_ACCESS_PATTERN,
    GDSCRIPT_NON_VARIANT_SINGLETONS: GDSCRIPT_NON_VARIANT_SINGLETONS_PATTERN,
    GDSCRIPT_DICT_GET: GDSCRIPT_DICT_GET_PATTERN,
    GDSCRIPT_FUNC_NO_RETURN: GDSCRIPT_FUNC_NO_RETURN_PATTERN,
    PYTHON_FUNC_START: PYTHON_FUNC_START_PATTERN,
    PYTHON_RETURN_TYPE: PYTHON_RETURN_TYPE_PATTERN,
    TS_EXPORT_FN: TS_EXPORT_FN_PATTERN,
    TS_EXPORT_CONST_ARROW: TS_EXPORT_CONST_ARROW_PATTERN,
    TS_FN_RETURN_TYPE_SUFFIX: TS_FN_RETURN_TYPE_SUFFIX_PATTERN,
    TS_ARROW_RETURN_TYPE_SUFFIX: TS_ARROW_RETURN_TYPE_SUFFIX_PATTERN,
    RUST_PATH_PREFIX: RUST_PATH_PREFIX_PATTERN,
    TEST_PROBE: TEST_PROBE_PATTERN,
    TS_ANY_KEYWORD: TS_ANY_KEYWORD_PATTERN,
    TS_ANY_TYPE: TS_ANY_TYPE_PATTERN,
    BLOCK_OR_SEMI: BLOCK_OR_SEMI_PATTERN,
    ARROW_BODY: ARROW_BODY_PATTERN,
    JAVA_IMPORT: JAVA_IMPORT_PATTERN,
    CSHARP_USING: CSHARP_USING_PATTERN,
    TS_VAR_DECL: TS_VAR_DECL_PATTERN,
    TS_REQUIRE_CALL: TS_REQUIRE_CALL_PATTERN,
    TS_ESM_SYNTAX: TS_ESM_SYNTAX_PATTERN,
    TS_WRAPPER_CTOR: TS_WRAPPER_CTOR_PATTERN,
    TS_ARGUMENTS_USE: TS_ARGUMENTS_USE_PATTERN,
    TS_OBJECT_ASSIGN: TS_OBJECT_ASSIGN_PATTERN,
    TS_INDEX_OF_BOUNDARY: TS_INDEX_OF_BOUNDARY_PATTERN,
    TS_SUBSTR: TS_SUBSTR_PATTERN,
    TS_REPLACE_LITERAL: TS_REPLACE_LITERAL_PATTERN,
    TS_REPLACE_CALL: TS_REPLACE_CALL_PATTERN,
    TS_NAMED_IMPORT: TS_NAMED_IMPORT_PATTERN,
    TS_FUNCTION_HEADER: TS_FUNCTION_HEADER_PATTERN,
    TS_METHOD_HEADER: TS_METHOD_HEADER_PATTERN,
    TS_CLASS_HEADER: TS_CLASS_HEADER_PATTERN,
    TS_INTERFACE_HEADER: TS_INTERFACE_HEADER_PATTERN,
    TS_TYPE_ALIAS_HEADER: TS_TYPE_ALIAS_HEADER_PATTERN,
    LOOP_HEADER: LOOP_HEADER_PATTERN,
    TRANSIENT_TS_CONTAINER: TRANSIENT_TS_CONTAINER_PATTERN,
    BLOCKING_IO: BLOCKING_IO_PATTERN,
    VALID_IDENTIFIER: VALID_IDENTIFIER_PATTERN,
    REGEX_ESCAPE: REGEX_ESCAPE_PATTERN,
    createRegexEscapeScanner: createRegexEscapeScanner,
    PREV_LINE_ARG_TERMINATOR: PREV_LINE_ARG_TERMINATOR_PATTERN,
    RUST_TRY_MACRO: RUST_TRY_MACRO_PATTERN,
    RUST_EXTERN_CRATE: RUST_EXTERN_CRATE_PATTERN,
    RUST_MACRO_USE: RUST_MACRO_USE_PATTERN,
    RUST_AMP_STRING: RUST_AMP_STRING_PATTERN,
    RUST_NEEDLESS_CLONE: RUST_NEEDLESS_CLONE_PATTERN,
    RUST_NUMERIC_CAST: RUST_NUMERIC_CAST_PATTERN,
    RUST_FORMAT_CALL: RUST_FORMAT_CALL_PATTERN,
    RUST_POSITIONAL_PLACEHOLDER: RUST_POSITIONAL_PLACEHOLDER_PATTERN,
    RUST_MULTILINE_FORMAT: RUST_MULTILINE_FORMAT_PATTERN,
    RUST_IF_LET: RUST_IF_LET_PATTERN,
    RUST_FOR_IN: RUST_FOR_IN_PATTERN,
    RUST_FOR_FIND: RUST_FOR_FIND_PATTERN,
    RUST_ASYNC_FN: RUST_ASYNC_FN_PATTERN,
    RUST_STD_LOCK: RUST_STD_LOCK_PATTERN,
    RUST_AWAIT: RUST_AWAIT_PATTERN,
    RUST_CRASH_MACRO: RUST_CRASH_MACRO_PATTERN,
    RUST_EXPECT_CALL: RUST_EXPECT_CALL_PATTERN,
    CODE_ASSIGN_LINE: ASSIGN_LINE_PATTERN,
    DEBUG_PRINT_CALL: DEBUG_PRINT_CALL_PATTERN,
    PYTHON_EMPTY_BODY: PYTHON_EMPTY_BODY_PATTERN,
    BRACE_EMPTY_ONE_LINER: BRACE_EMPTY_ONE_LINER_PATTERN,
    BRACE_OPEN_FN: BRACE_OPEN_FN_PATTERN,
    BRACE_CLOSE_LINE: BRACE_CLOSE_LINE_PATTERN,
    TERMINATING_STMT: TERMINATING_STMT_PATTERN,
    IF_OPEN: IF_OPEN_PATTERN,
    ELSE_CLAUSE: ELSE_CLAUSE_PATTERN,
    RETURN_BOOL: RETURN_BOOL_PATTERN,
    TERNARY_BOOL_RETURN: TERNARY_BOOL_RETURN_PATTERN,
    PYTHON_IF_HEADER: PYTHON_IF_HEADER_PATTERN,
    BRACE_ONLY_LINE: BRACE_ONLY_LINE_PATTERN,
    RUST_USE_IMPORT: RUST_USE_IMPORT_PATTERN,
    GDSCRIPT_LOAD_IMPORT: GDSCRIPT_LOAD_IMPORT_PATTERN,
    PYTHON_DECL_HEADER: PYTHON_DECL_HEADER_PATTERN,
    GDSCRIPT_FUNC_DECL_HEADER: GDSCRIPT_FUNC_DECL_HEADER_PATTERN,
    RUST_FN_DECL_HEADER: RUST_FN_DECL_HEADER_PATTERN,
    TS_IMPORT_LINE: TS_IMPORT_LINE_PATTERN,
    TS_WILDCARD_IMPORT: TS_WILDCARD_IMPORT_PATTERN,
    CONSTANT_ALIAS: CONSTANT_ALIAS_PATTERN,
    DIAGNOSTIC_LOG_PREFIX: DIAGNOSTIC_LOG_PREFIX_PATTERN,
    DIAGNOSTIC_CALL_PARENT: DIAGNOSTIC_CALL_PARENT_PATTERN,
    DIAGNOSTIC_SINK_PARENT: DIAGNOSTIC_SINK_PARENT_PATTERN,
    GO_FUNC_DECL_LINE: GO_FUNC_DECL_LINE_PATTERN,
    GO_STRUCT_OR_INTERFACE: GO_STRUCT_OR_INTERFACE_PATTERN,
    GO_CONST_DECL_LINE: GO_CONST_DECL_LINE_PATTERN,
    GO_VAR_DECL_LINE: GO_VAR_DECL_LINE_PATTERN,
    GO_FOR_DECL_LINE: GO_FOR_DECL_LINE_PATTERN,
    GO_IF_SHORT_DECL: GO_IF_SHORT_DECL_PATTERN,
    GO_SHORT_VAR_DECL: GO_SHORT_VAR_DECL_PATTERN,
    GDSCRIPT_FOR_DECL: GDSCRIPT_FOR_DECL_PATTERN,
    STDLIB_CRYPTO_KEYWORD: STDLIB_CRYPTO_KEYWORD_PATTERN,
    STDLIB_TARGET_CFG: STDLIB_TARGET_CFG_PATTERN,
    STDLIB_FALLBACK: STDLIB_FALLBACK_PATTERN,
    STDLIB_NO_STD_CONTEXT: STDLIB_NO_STD_CONTEXT_PATTERN,
    STDLIB_IMPLICIT_ALLOC: STDLIB_IMPLICIT_ALLOC_PATTERN,
    STDLIB_RUST_PANIC: STDLIB_RUST_PANIC_PATTERN,
    STDLIB_GO_PUB_FN: STDLIB_GO_PUB_FN_PATTERN,
    STDLIB_FN_DEF: STDLIB_FN_DEF_PATTERN,
    STDLIB_DEPTH_GUARD_PARAM: STDLIB_DEPTH_GUARD_PARAM_PATTERN,
    STDLIB_DEPTH_GUARD_BODY: STDLIB_DEPTH_GUARD_BODY_PATTERN,
    createJsImportScanner,
    createRequireCallScanner,
    createRustUnwrapScanner,
    createGdscriptPreloadScanner,
    createGoNamedLiteralScanner,
    createGoCallExprScanner,
    createStringLiteralScanner,
    createIntLiteralScanner,
    createFloatLiteralScanner,
    createJsxHookDeclScanner,
    createJsxHandlerDeclScanner,
    createJsxInterfacePropsScanner,
});

// ============================================================================
// 3. Comment & Annotation Patterns (REGEX.COMMENT)
// ============================================================================

import { REGEX_COMMENT } from './regex-comment';
export * from './regex-comment';

// ============================================================================
// 4. Literal, Quote & Format Patterns (REGEX.LITERAL)
// ============================================================================

/** Matches single-line single-quoted string literal. */
export const SINGLE_QUOTED_STRING_PATTERN = /^'[^'\r\n]*'$/;

/** Matches single-line double-quoted string literal. */
export const DOUBLE_QUOTED_STRING_PATTERN = /^"[^"\r\n]*"$/;

/** Matches backtick template string literal. */
export const BACKTICK_QUOTED_STRING_PATTERN = /^`[^`]*`$/;

/** Matches integer number literal. */
export const INTEGER_LITERAL_PATTERN = /^-?\d+$/;

/** Matches floating point number literal. */
export const FLOAT_LITERAL_PATTERN = /^-?\d+\.\d+$/;

/** Matches hexadecimal number literal. */
export const HEX_LITERAL_PATTERN = /^0x[0-9a-fA-F]+$/;

/** Matches pure whitespace line. */
export const WHITESPACE_LINE_PATTERN = /^\s*$/;

/** Matches newline sequence (CRLF or LF). */
export const LINE_BREAK_PATTERN = /\r?\n/;

/** Matches trailing spaces or tabs on a single line. */
export const TRAILING_WHITESPACE_PATTERN = /[ \t]+$/;

/** Matches standard network URL endpoints (http, https, ws, wss, ftp). */
export const URL_ENDPOINT_PATTERN = /^(?:https?|wss?|ftp):\/\/[^\s"'`<>]+$/i;

/** Matches root, drive, or relative path prefixes. */
export const PATH_PREFIX_PATTERN = /^(?:\/|[a-zA-Z]:[\\/]|\.\.?[\\/])/;

/** Matches common file extensions for assets, configs, and scripts. */
export const FILE_EXTENSION_PATTERN = /\.(?:json|ya?ml|toml|png|jpe?g|gif|svg|ico|css|scss|html|wasm|proto|graphql|sql|md)$/i;

/** Matches inline XML SVG opening tag. */
export const INLINE_SVG_PATTERN = /^\s*<svg(?:\s+[^>]*>|>)/i;

/** Matches glob metacharacters (*, ?, {, }, [, ]). */
export const GLOB_META_PATTERN = /[*?{}[\]]/;

/** Matches relative or directory specifier prefix. */
export const RELATIVE_SPECIFIER_PREFIX_PATTERN = /^(?:\.{1,2}\/|\/[A-Za-z0-9_@.-]+\/|[A-Za-z0-9_@.-]+\/)/;

/** Matches CJK ideograph character code ranges. */
export const CJK_CHAR_PATTERN = /[　-〿一-鿿＀-￯]/;

/** Matches remote URL in single or double quotes. */
export const REMOTE_URL_PATTERN = /['"](https?:\/\/[A-Za-z0-9_./?=&%-]+)['"]/;

/** Creates a fresh global scanner for remote URLs. */
export function createRemoteUrlScanner(): RegExp {
    return /['"](https?:\/\/[A-Za-z0-9_./?=&%-]+)['"]/g;
}

/** Matches exempted or placeholder remote URLs. */
export const EXEMPTED_REMOTE_URL_PATTERN =
    /(?:json-schema\.org|example\.com|localhost|127\.0\.0\.1)/;

/** Matches test directory path components. */
export const TEST_PATH_PATTERN = /[\\/](?:tests?|fixtures?|mocks?)[\\/]/i;

/** Matches test file extension patterns. */
export const TEST_FILE_EXT_PATTERN = /\.(?:test|spec)\.[a-z0-9]+$/i;

/** Matches styling stylesheet file extensions. */
export const STYLE_FILE_EXT_PATTERN = /\.(?:css|scss|less|sass)\b/i;

/** Creates a fresh global scanner for replacing all whitespace sequences. */
export function createWhitespaceGlobalScanner(): RegExp {
    return /\s+/g;
}

/** Creates a fresh global scanner for converting backslashes to forward slashes. */
export function createBackslashGlobalScanner(): RegExp {
    return /\\/g;
}

/** Normalizes all Windows-style backslashes to POSIX forward slashes. */
export function normalizePathSeparators(pathStr: string): string {
    return pathStr.replace(createBackslashGlobalScanner(), '/');
}

/** Creates a fresh multiline scanner for trailing whitespace removal. */
export function createTrailingWhitespaceScanner(): RegExp {
    return /[ \t]+$/gm;
}

export const REGEX_LITERAL = Object.freeze({
    SINGLE_QUOTED: SINGLE_QUOTED_STRING_PATTERN,
    DOUBLE_QUOTED: DOUBLE_QUOTED_STRING_PATTERN,
    BACKTICK_QUOTED: BACKTICK_QUOTED_STRING_PATTERN,
    INTEGER: INTEGER_LITERAL_PATTERN,
    FLOAT: FLOAT_LITERAL_PATTERN,
    HEX: HEX_LITERAL_PATTERN,
    WHITESPACE_LINE: WHITESPACE_LINE_PATTERN,
    LINE_BREAK: LINE_BREAK_PATTERN,
    TRAILING_WHITESPACE: TRAILING_WHITESPACE_PATTERN,
    URL: URL_ENDPOINT_PATTERN,
    PATH_PREFIX: PATH_PREFIX_PATTERN,
    FILE_EXTENSION: FILE_EXTENSION_PATTERN,
    INLINE_SVG: INLINE_SVG_PATTERN,
    GLOB_META: GLOB_META_PATTERN,
    RELATIVE_SPECIFIER_PREFIX: RELATIVE_SPECIFIER_PREFIX_PATTERN,
    CJK_CHAR: CJK_CHAR_PATTERN,
    REMOTE_URL: REMOTE_URL_PATTERN,
    createRemoteUrlScanner,
    EXEMPTED_REMOTE_URL: EXEMPTED_REMOTE_URL_PATTERN,
    TEST_PATH: TEST_PATH_PATTERN,
    TEST_FILE_EXT: TEST_FILE_EXT_PATTERN,
    STYLE_FILE_EXT: STYLE_FILE_EXT_PATTERN,
    createWhitespaceGlobalScanner,
    createBackslashGlobalScanner,
    normalizePathSeparators,
    createTrailingWhitespaceScanner,
});

// ============================================================================
// 5~11. Domain Catalogs Integration (SHELL, SECURITY, PYTHON, GDSCRIPT, DATA, GO, RUST)
// ============================================================================

import { REGEX_SHELL } from './regex-shell';
import { REGEX_SECURITY } from './regex-security';
import { REGEX_PYTHON } from './regex-python';
import { REGEX_GDSCRIPT } from './regex-gdscript';
import { REGEX_DATA } from './regex-data';
import { REGEX_GO } from './regex-go';
import { REGEX_RUST } from './regex-rust';

// Re-export domain sub-modules for seamless backward compatibility
export * from './regex-shell';
export * from './regex-security';
export * from './regex-python';
export * from './regex-gdscript';
export * from './regex-data';
export * from './regex-go';
export * from './regex-rust';

// ============================================================================
// Master Catalog Facade (export const REGEX)
// ============================================================================

/**
 * Immutable master regular expression catalog adhering to SSOT governance.
 */
export const REGEX = Object.freeze({
    NAMING: REGEX_NAMING,
    SYNTAX: REGEX_SYNTAX,
    COMMENT: REGEX_COMMENT,
    LITERAL: REGEX_LITERAL,
    SHELL: REGEX_SHELL,
    SECURITY: REGEX_SECURITY,
    PYTHON: REGEX_PYTHON,
    GDSCRIPT: REGEX_GDSCRIPT,
    DATA: REGEX_DATA,
    GO: REGEX_GO,
    RUST: REGEX_RUST,
    escape: escapeRegex,
});
