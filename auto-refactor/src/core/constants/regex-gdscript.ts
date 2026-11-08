/**
 * Module: Core Constants — GDScript Regular Expression Catalog
 * File Path: src/core/constants/regex-gdscript.ts
 * Architecture Role: Single source of truth (SSOT) for GDScript syntax, signal connections,
 *     and game architecture modernization regular expressions.
 * Dependencies & Triggers: Zero external dependencies; consumed by gdscript-modern analyzer.
 * Responsibilities:
 *     1. Centralize canonical GDScript patterns (signal connect, debounce, state machine, views).
 *     2. Enforce the state-separation discipline: stateless immutable constants vs fresh factories.
 *     3. Expose frozen REGEX_GDSCRIPT domain namespace.
 * Exit Semantics & Design Rationale: Pure, frozen regex constants and deterministic factories;
 *     zero side effects and strictly immune to ReDoS back-tracking traps.
 */

/** Matches Godot 3 string-based signal connect syntax. */
export const GD_LEGACY_CONNECT_PATTERN =
    /\.connect\s*\(\s*"[^"]*"\s*,\s*(?:self|[A-Za-z_]\w*)\s*,\s*"[^"]*"\s*\)/;

/** Matches Godot super reset state call. */
export const GD_SUPER_RESET_PATTERN = /\bsuper(?:\.reset_state\s*\(\s*\)|\s*\(\s*\))/;

/** Matches Godot button pressed signal connect for debounce auditing. */
export const GD_DEBOUNCE_ACTION_BUTTON_PATTERN =
    /\b(?:btn|button|action)_[a-zA-Z0-9_]*\.pressed\.connect\b/;

/** Matches Godot button pressed handler for debounce auditing. */
export const GD_DEBOUNCE_HANDLER_PATTERN =
    /func\s+_on_(?:btn|button|action)_[a-zA-Z0-9_]*_pressed\b/;

/** Matches direct state assignment bypassing state machine transition methods. */
export const GD_FSM_STATE_MUTATION_PATTERN = /\bcurrent_state\s*=\s*/;

/** Matches observer registration append call. */
export const GD_OBSERVER_APPEND_PATTERN = /\b(?:listeners|observers|subscribers)\.append\s*\(/;

/** Matches weakref token call. */
export const GD_WEAKREF_TOKEN_PATTERN = /\b([a-zA-Z0-9_]+)\s*\(/;

/** Matches hardcoded responsive coordinate vectors. */
export const GD_RESPONSIVE_ANCHOR_PATTERN =
    /position\s*=\s*Vector2\([0-9\s.,-]+\)|size\s*=\s*Vector2\([0-9\s.,-]+\)/;

/** Matches direct global store mutation bypassing actions. */
export const GD_UNIDIRECTIONAL_FLOW_PATTERN =
    /\b(?:AppState|GameStore|PlayerData)\.[a-zA-Z0-9_]+\s*=[^=]/;

/** Matches screen script class inheritance. */
export const GD_SCREEN_EXTENDS_PATTERN = /^\s*extends\s+(?:Control|Node2D|CanvasLayer)\s*$/;

/** Matches hardcoded color literal bypassing design tokens. */
export const GD_DESIGN_TOKEN_PATTERN = /\bColor\s*\(/;

/** Matches status bar constructor or handler. */
export const GD_STATUS_BAR_PATTERN =
    /\bProgressBar\.new\s*\(|\bfunc\s+_ready\(\):\s*(?:(?!StatusBar).)*$/;

/** Matches unbounded child instantiation without virtual list recycling. */
export const GD_VIRTUAL_LIST_PATTERN =
    /(?:\b(?:list|_list)\.add_child\s*\(\s*item\s*\)|for\s+[a-zA-Z0-9_]+\s+in\s+[a-zA-Z0-9_.]+\s*:\s*.*add_child\()/;

/** Matches hardcoded UI strings bypassing tr() localization. */
export const GD_I18N_RAW_TEXT_PATTERN =
    /(?:title|heading|text|subtitle)\s*=\s*"[A-Z][A-Za-z0-9_ ]{3,}"|\btext\s*=\s*"[A-Z0-9_ ]{4,}"/;

/** Matches brittle relative node traversal paths. */
export const GD_RELATIVE_PATH_PATTERN =
    /\$"?\.\.\/[a-zA-Z0-9_/]+"?|\bget_node\("?\.\.\/|\b(?:get_parent\s*\(\s*\)|find_child\s*\()/;

/** Matches tight coupling with global GameState singleton. */
export const GD_GAME_STATE_COUPLE_PATTERN = /\bGameState\.[a-zA-Z0-9_]+\(/;

/** Matches legacy Godot 3 RPC function modifiers. */
export const GD_RPC_MODIFIER_PATTERN =
    /^\s*(?:remote|master|puppet|slave|remotesync|mastersync|puppetsync|sync)\s+func\b/;

/** Matches transient heap allocation patterns in GDScript loops (.duplicate()). */
export const GD_TRANSIENT_ALLOCATION_PATTERN = /\b(?:\/duplicate\(true\)|\.duplicate\()/;

/** Matches GDScript func declaration. */
export const GDSCRIPT_FUNC_PATTERN = /^\s*(?:static\s+)?func\s+([A-Za-z0-9_]+)\s*\(/;

/** Matches GDScript load/preload import line. */
export const GDSCRIPT_LOAD_IMPORT_PATTERN =
    /^(?:const|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:preload|load)\s*\(\s*['"]([^'"]+)['"]\s*\)/;

/** Matches GDScript function declaration header. */
export const GDSCRIPT_FUNC_DECL_HEADER_PATTERN = /^\s*(?:static\s+)?func\s+[a-zA-Z_]\w*\s*\(/;

/** Matches GDScript for loop declaration line. */
export const GDSCRIPT_FOR_DECL_PATTERN = /^\s*for\s+[a-zA-Z_]\w*\s+in\b/;

/** Matches GDScript file-header prologue directives that precede preload imports. */
export const GDSCRIPT_HEADER_PROLOGUE_PATTERN =
    /^(?:@tool\b|@icon\s*\(|tool\b|class_name\s+|extends\s+)/;

/** Creates a fresh global scanner for GDScript preload/load calls. */
export function createGdscriptPreloadScanner(): RegExp {
    return /(?:preload|load)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
}

/** Frozen domain namespace aggregating Godot GDScript syntax and game-loop patterns. */
export const REGEX_GDSCRIPT = Object.freeze({
    LEGACY_CONNECT: GD_LEGACY_CONNECT_PATTERN,
    SUPER_RESET: GD_SUPER_RESET_PATTERN,
    DEBOUNCE_ACTION_BUTTON: GD_DEBOUNCE_ACTION_BUTTON_PATTERN,
    DEBOUNCE_HANDLER: GD_DEBOUNCE_HANDLER_PATTERN,
    FSM_STATE_MUTATION: GD_FSM_STATE_MUTATION_PATTERN,
    OBSERVER_APPEND: GD_OBSERVER_APPEND_PATTERN,
    WEAKREF_TOKEN: GD_WEAKREF_TOKEN_PATTERN,
    RESPONSIVE_ANCHOR: GD_RESPONSIVE_ANCHOR_PATTERN,
    UNIDIRECTIONAL_FLOW: GD_UNIDIRECTIONAL_FLOW_PATTERN,
    SCREEN_EXTENDS: GD_SCREEN_EXTENDS_PATTERN,
    DESIGN_TOKEN: GD_DESIGN_TOKEN_PATTERN,
    STATUS_BAR: GD_STATUS_BAR_PATTERN,
    VIRTUAL_LIST: GD_VIRTUAL_LIST_PATTERN,
    I18N_RAW_TEXT: GD_I18N_RAW_TEXT_PATTERN,
    RELATIVE_PATH: GD_RELATIVE_PATH_PATTERN,
    GAME_STATE_COUPLE: GD_GAME_STATE_COUPLE_PATTERN,
    RPC_MODIFIER: GD_RPC_MODIFIER_PATTERN,
    TRANSIENT_ALLOCATION: GD_TRANSIENT_ALLOCATION_PATTERN,
    FUNC: GDSCRIPT_FUNC_PATTERN,
    LOAD_IMPORT: GDSCRIPT_LOAD_IMPORT_PATTERN,
    FUNC_DECL_HEADER: GDSCRIPT_FUNC_DECL_HEADER_PATTERN,
    FOR_DECL: GDSCRIPT_FOR_DECL_PATTERN,
    HEADER_PROLOGUE: GDSCRIPT_HEADER_PROLOGUE_PATTERN,
    createGdscriptPreloadScanner: createGdscriptPreloadScanner,
});
