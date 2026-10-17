/**
 * Module: Static Analysis Engine — GDScript Modernization Rules
 * File Path: src/analyzers/gdscript-modern.ts
 * Architecture Role: GDScript-only style analyzer (a language pack bound to the language, never to
 *     a project) — Godot 3 → 4 migration findings, which no mature external linter covers.
 * Dependencies & Triggers: core types + declarative modern metapack; enabled when a config declares
 *     `analyzers.gdscript-modern`; specialized packs are default-off, so registering it cannot
 *     change an existing gate result.
 * Responsibilities: Report migration findings on `.gd` files: GDM-YIELD-001 (`yield(`),
 *     GDM-EXPORT-001 (`export` statement), GDM-ONREADY-001 (`onready var`), GDM-TOOL-001 (bare
 *     `tool` line), GDM-POOL-001 (`Pool*Array`), GDM-CONNECT-001 (Godot 3 `connect` signature),
 *     GDM-RPC-001 (legacy RPC modifiers), plus game architecture discipline rules.
 * Exit Semantics & Design Rationale: Built on DeclarativeModernAnalyzer over masked source, never throws
 *     and returns [] for every other language. GDScript comments are `#` only, so the mask needs no
 *     block-comment state; triple-quoted docstrings mask correctly because quotes close in pairs.
 */

import type { Analyzer, AnalyzerContext, Issue, Severity, AgentActionType } from '../core/types';
import { ANALYZER_GDSCRIPT_MODERN } from '../core/scoring/dimensionLiterals';
import type { SourceMaskConfig } from '../core/policy/source-mask';
import {
    DeclarativeModernAnalyzer,
    type DeclarativeLineRule,
    type LineScanContext,
} from './declarative-modern-pack';

const SEV_WARN: Severity = 'warning';
const SEV_INFO: Severity = 'info';

/** Rule identifier for deprecated Godot 3 yield() syntax. */
export const RULE_GDM_YIELD_001 = 'GDM-YIELD-001';
/** Rule identifier for Godot 3 export syntax needing migration to @export. */
export const RULE_GDM_EXPORT_001 = 'GDM-EXPORT-001';
/** Rule identifier for Godot 3 onready keyword needing migration to @onready. */
export const RULE_GDM_ONREADY_001 = 'GDM-ONREADY-001';
/** Rule identifier for Godot 3 tool keyword needing migration to @tool. */
export const RULE_GDM_TOOL_001 = 'GDM-TOOL-001';
/** Rule identifier for legacy Pool*Array types needing migration to Packed*Array. */
export const RULE_GDM_POOL_001 = 'GDM-POOL-001';
/** Rule identifier for legacy RPC modifiers needing migration to @rpc. */
export const RULE_GDM_RPC_001 = 'GDM-RPC-001';
/** Rule identifier for legacy string-based connect() needing migration to Callables. */
export const RULE_GDM_CONNECT_001 = 'GDM-CONNECT-001';
/** Rule identifier for object pool items missing super.reset_state() invocation. */
export const RULE_GDM_POOL_002 = 'GDM-POOL-002';
/** Rule identifier for UI button press events lacking debounce protection. */
export const RULE_GDM_DEB_001 = 'GDM-DEB-001';
/** Rule identifier for state transitions bypassing the finite state machine. */
export const RULE_GDM_FSM_001 = 'GDM-FSM-001';
/** Rule identifier for observer callbacks retaining strong references without weakref. */
export const RULE_GDM_WEAK_001 = 'GDM-WEAK-001';
/** Rule identifier for view layouts missing responsive container anchoring. */
export const RULE_GDM_RES_001 = 'GDM-RES-001';
/** Rule identifier for views performing direct store mutations without actions. */
export const RULE_GDM_UNI_001 = 'GDM-UNI-001';
/** Rule identifier for massive view scripts exceeding effective line budget. */
export const RULE_GDM_LOC_001 = 'GDM-LOC-001';
/** Rule identifier for screen scripts not inheriting from standard BaseScreen. */
export const RULE_GDM_EXT_001 = 'GDM-EXT-001';
/** Rule identifier for hardcoded style constants bypassing design tokens. */
export const RULE_GDM_TOK_001 = 'GDM-TOK-001';
/** Rule identifier for screen components missing status bar integration. */
export const RULE_GDM_BAR_001 = 'GDM-BAR-001';
/** Rule identifier for unbounded list rendering without virtualized recycling. */
export const RULE_GDM_VRT_001 = 'GDM-VRT-001';
/** Rule identifier for user-visible UI text lacking internationalization tr(). */
export const RULE_GDM_I18N_001 = 'GDM-I18N-001';
/** Rule identifier for brittle relative node paths bypassing unique names (%). */
export const RULE_GDM_NOD_001 = 'GDM-NOD-001';
/** Rule identifier for view components coupling directly with presentation models. */
export const RULE_GDM_BND_001 = 'GDM-BND-001';

const ACT_REPLACE_TOKEN: AgentActionType = 'replace_token';
const ACT_GUARD_CLAUSE: AgentActionType = 'apply_guard_clause';
const ACT_SIMPLIFY_CONTROL: AgentActionType = 'simplify_control_flow';
const ACT_DECOMPOSE_MODULE: AgentActionType = 'decompose_module';
const ACT_DECOUPLE_FACADE: AgentActionType = 'decouple_facade';

const PATH_VIEWS = '/views/';
const PATH_FRONTEND = '/frontend/';
const TOKEN_FSM_DIR = '/fsm/';
const TOKEN_STATE_MACHINE = 'state_machine';
const TOKEN_REGISTRY = 'registry';
const TOKEN_MANAGER = 'manager';
const TOKEN_BUS = 'bus';
const TOKEN_DOT_CONNECT = '.connect(';
const MAX_VIEW_LOC_BUDGET = 450;

/** Extension the pack accepts; the content-only path sees every language. */
const SOURCE_EXTENSION = '.gd';

const GDSCRIPT_MASK: SourceMaskConfig = {
    lineComment: '#',
    quoteChars: '"\'`',
};

// --- Regex Patterns ---

const YIELD_RE = /\byield\s*\(/;
const EXPORT_RE = /^\s*export(?:\s*\([^)]*\))?\s+(?:var|const|onready)\b/;
const ONREADY_RE = /^\s*onready\s+var\b/;
const TOOL_RE = /^\s*tool\s*$/;
const POOL_ARRAY_RE = /\bPool(?:Byte|Int|Real|String|Vector2|Vector3|Color)Array\b/;
const RPC_MODIFIER_RE =
    /^\s*(?:remote|master|puppet|slave|remotesync|mastersync|puppetsync|sync)\s+func\b/;
const LEGACY_CONNECT_RE =
    /\.connect\s*\(\s*"[^"]*"\s*,\s*(?:self|[A-Za-z_]\w*)\s*,\s*"[^"]*"\s*\)/;

const EXTENDS_ANY_RE = /^\s*extends\s+[A-Za-z_]\w*/;
const RESET_STATE_FUNC_RE = /^\s*func\s+reset_state\s*\(\s*\)/;
const SUPER_RESET_RE = /\bsuper(?:\.reset_state\s*\(\s*\)|\s*\(\s*\))/;
const DEBOUNCE_ACTION_BUTTON_RE = /\b(?:btn|button|action)_[a-zA-Z0-9_]*\.pressed\.connect\b/;
const DEBOUNCE_HANDLER_RE = /func\s+_on_(?:btn|button|action)_[a-zA-Z0-9_]*_pressed\b/;
const FSM_STATE_MUTATION_RE = /\bcurrent_state\s*=\s*/;
const OBSERVER_APPEND_RE = /\b(?:listeners|observers|subscribers)\.append\s*\(/;
const WEAKREF_TOKEN_RE = /\b([a-zA-Z0-9_]+)\s*\(/;
const WEAKREF_SAFE_CALLS = new Set(['weakref', 'is_instance_valid']);
const RESPONSIVE_LAYOUT_RE =
    /position\s*=\s*Vector2\([0-9\s.,-]+\)|size\s*=\s*Vector2\([0-9\s.,-]+\)/;
const UNIDIRECTIONAL_FLOW_RE =
    /\b(?:AppState|GameStore|PlayerData)\.[a-zA-Z0-9_]+\s*=[^=]/;
const SCREEN_EXTENDS_RE = /^\s*extends\s+(?:Control|Node2D|CanvasLayer)\s*$/;
const DESIGN_TOKEN_RE = /\bColor\s*\(/;
const STATUS_BAR_RE =
    /\bProgressBar\.new\s*\(|\bfunc\s+_ready\(\):\s*(?:(?!StatusBar).)*$/;
const VIRTUAL_LIST_RE =
    /(?:\b(?:list|_list)\.add_child\s*\(\s*item\s*\)|for\s+[a-zA-Z0-9_]+\s+in\s+[a-zA-Z0-9_.]+\s*:\s*.*add_child\()/;
const I18N_BINDING_RE =
    /(?:title|heading|text|subtitle)\s*=\s*"[A-Z][A-Za-z0-9_ ]{3,}"|\btext\s*=\s*"[A-Z0-9_ ]{4,}"/;
const EXPLICIT_NODE_PATH_RE =
    /\$"?\.\.\/[a-zA-Z0-9_/]+"?|\bget_node\("?\.\.\/|\b(?:get_parent\s*\(\s*\)|find_child\s*\()/;
const GAME_STATE_COUPLE_RE = /\bGameState\.[a-zA-Z0-9_]+\(/;

const FSM_EXEMPT_PATH_TOKENS = new Set([
    'fsm',
    'state',
    'states',
    'statemachine',
    'state_machine',
    'controller',
    'manager',
    'core',
]);

const SNIPPET_AWAIT = 'await $1.$2';
const SNIPPET_EXPORT = '@export var $1: $2';
const SNIPPET_ONREADY = '@onready var $1 = $2';
const SNIPPET_TOOL = '@tool';
const SNIPPET_PACKED_ARRAY = 'Packed$1Array';
const SNIPPET_RPC = '@rpc func $1()';
const SNIPPET_CONNECT = '$1.connect($2.$3)';
const SNIPPET_SUPER_RESET = 'super.reset_state()';
const SNIPPET_DEBOUNCE_CONNECT = 'btn.pressed_debounced.connect($1)';
const SNIPPET_FSM_TRANSITION = 'fsm.transition_to($1)';
const SNIPPET_WEAKREF = 'weakref($1)';
const SNIPPET_RESPONSIVE_LAYOUT = 'apply_responsive_layout()';
const SNIPPET_STORE_DISPATCH = 'store.dispatch($1)';
const SNIPPET_EXTRACT_COMPONENT = '# Extract view subcomponent';
const SNIPPET_BASE_SCREEN = 'extends BaseScreen';
const SNIPPET_DESIGN_TOKEN = 'ThemeTokens.get_color("$1")';
const SNIPPET_STATUS_BAR = 'StatusBar.register(self)';
const SNIPPET_VIRTUAL_LIST = 'virtual_list.set_items(data)';
const SNIPPET_TR_WRAP = 'tr("$1")';
const SNIPPET_UNIQUE_NODE = '%$1';
const SNIPPET_ACTION_DISPATCH = 'dispatch(Actions.$1)';

function isFsmExemptPath(file: string): boolean {
    const normalized = file.toLowerCase();
    if (normalized.includes(TOKEN_FSM_DIR) || normalized.includes(TOKEN_STATE_MACHINE)) {
        return true;
    }
    const segments = normalized.split(/[\\/._-]+/);
    for (const segment of segments) {
        if (FSM_EXEMPT_PATH_TOKENS.has(segment)) {
            return true;
        }
    }
    return false;
}

function hasWeakRefCall(line: string): boolean {
    const match = WEAKREF_TOKEN_RE.exec(line);
    return match !== null && WEAKREF_SAFE_CALLS.has(match[1]);
}

function isViewFile(file: string): boolean {
    const norm = file.startsWith('/') ? file : '/' + file.replace(/\\/g, '/');
    return norm.includes(PATH_VIEWS);
}

function isFrontendFile(file: string): boolean {
    const norm = file.startsWith('/') ? file : '/' + file.replace(/\\/g, '/');
    return norm.includes(PATH_VIEWS) || norm.includes(PATH_FRONTEND);
}

// --- Multi-line scanner hooks ---

function scanMultiLineResetState(
    raw: readonly string[],
    masked: readonly string[],
    file: string,
    delegate: DeclarativeModernAnalyzer,
    issues: Issue[],
    rule: DeclarativeLineRule,
): void {
    const hasExtends = masked.some((l) => EXTENDS_ANY_RE.test(l));
    if (!hasExtends) return;

    for (let index = 0; index < masked.length; index += 1) {
        const code = masked[index];
        if (!RESET_STATE_FUNC_RE.test(code)) continue;

        const funcIndent = code.search(/\S/);
        let hasSuper = false;
        for (let j = index + 1; j < masked.length; j += 1) {
            const bodyLine = masked[j];
            if (bodyLine.trim().length === 0 || bodyLine.trim().startsWith('#')) continue;
            const bodyIndent = bodyLine.search(/\S/);
            if (bodyIndent <= funcIndent) {
                break;
            }
            if (SUPER_RESET_RE.test(bodyLine)) {
                hasSuper = true;
                break;
            }
        }

        if (!hasSuper) {
            issues.push(delegate.emitIssue(rule, file, index + 1, { line: raw[index].trim() }));
        }
    }
}

function scanMultiLineViewRules(
    raw: readonly string[],
    file: string,
    delegate: DeclarativeModernAnalyzer,
    issues: Issue[],
    ruleViewLoc: DeclarativeLineRule,
): void {
    if (!isViewFile(file)) return;
    if (raw.length > MAX_VIEW_LOC_BUDGET) {
        issues.push(delegate.emitIssue(ruleViewLoc, file, 1, { lineCount: raw.length }));
    }
}

/**
 * GDScript modernization pack backed by DeclarativeModernAnalyzer.
 */
export class GdscriptModernAnalyzer implements Analyzer {
    public readonly name = ANALYZER_GDSCRIPT_MODERN;
    private readonly delegate: DeclarativeModernAnalyzer;

    constructor() {
        const rulePoolReset: DeclarativeLineRule = {
            rule: RULE_GDM_POOL_002,
            severity: SEV_WARN,
            message:
                'Object pool item implements reset_state() without calling super.reset_state().',
            suggestion:
                'Add super.reset_state() at the start of reset_state() to ensure base state cleans up.',
            actionable: {
                action: ACT_GUARD_CLAUSE,
                codeId: '008',
                templateSnippet: SNIPPET_SUPER_RESET,
            },
        };

        const ruleViewLoc: DeclarativeLineRule = {
            rule: RULE_GDM_LOC_001,
            severity: SEV_INFO,
            message: `View script exceeds recommended size limit of ${MAX_VIEW_LOC_BUDGET} lines.`,
            suggestion:
                'Extract reusable subcomponents or move complex view logic to presentation presenters.',
            actionable: {
                action: ACT_DECOMPOSE_MODULE,
                codeId: '014',
                templateSnippet: SNIPPET_EXTRACT_COMPONENT,
            },
        };

        const rules: readonly DeclarativeLineRule[] = [
            {
                rule: RULE_GDM_YIELD_001,
                severity: SEV_WARN,
                pattern: YIELD_RE,
                message:
                    '`yield` was removed in Godot 4: coroutines are plain `await` expressions.',
                suggestion: 'Rewrite `yield(obj, "signal")` as `await obj.signal`.',
                actionable: {
                    action: ACT_REPLACE_TOKEN,
                    codeId: '001',
                    templateSnippet: SNIPPET_AWAIT,
                },
            },
            {
                rule: RULE_GDM_EXPORT_001,
                severity: SEV_WARN,
                pattern: EXPORT_RE,
                message: 'The `export` statement syntax is gone; Godot 4 uses annotations.',
                suggestion:
                    'Write `@export var x: int`, keeping the type in the declaration itself.',
                actionable: {
                    action: ACT_REPLACE_TOKEN,
                    codeId: '002',
                    templateSnippet: SNIPPET_EXPORT,
                },
            },
            {
                rule: RULE_GDM_ONREADY_001,
                severity: SEV_WARN,
                pattern: ONREADY_RE,
                message: '`onready` became the `@onready` annotation in Godot 4.',
                suggestion: 'Write `@onready var node = $Path`.',
                actionable: {
                    action: ACT_REPLACE_TOKEN,
                    codeId: '003',
                    templateSnippet: SNIPPET_ONREADY,
                },
            },
            {
                rule: RULE_GDM_TOOL_001,
                severity: SEV_WARN,
                pattern: TOOL_RE,
                message: 'The `tool` keyword became the `@tool` annotation in Godot 4.',
                suggestion: 'Put `@tool` on the first line of the script.',
                actionable: {
                    action: ACT_REPLACE_TOKEN,
                    codeId: '004',
                    templateSnippet: SNIPPET_TOOL,
                },
            },
            {
                rule: RULE_GDM_POOL_001,
                severity: SEV_WARN,
                pattern: POOL_ARRAY_RE,
                message: '`Pool*Array` types were renamed to `Packed*Array` in Godot 4.',
                suggestion: 'Use the `PackedByteArray` / `PackedVector2Array` family of names.',
                actionable: {
                    action: ACT_REPLACE_TOKEN,
                    codeId: '005',
                    templateSnippet: SNIPPET_PACKED_ARRAY,
                },
            },
            {
                rule: RULE_GDM_RPC_001,
                severity: SEV_WARN,
                pattern: RPC_MODIFIER_RE,
                message: 'RPC keywords before `func` were replaced by the `@rpc` annotation.',
                suggestion:
                    'Annotate the function (`@rpc("any_peer", "call_local")`) and drop the keyword.',
                actionable: {
                    action: ACT_REPLACE_TOKEN,
                    codeId: '006',
                    templateSnippet: SNIPPET_RPC,
                },
            },
            {
                rule: RULE_GDM_CONNECT_001,
                severity: SEV_WARN,
                message:
                    'String-based `connect("signal", target, "method")` is deprecated in Godot 4.',
                suggestion:
                    'Connect directly to the signal with a Callable: `signal_name.connect(target.method)`.',
                condition: (ctx) =>
                    ctx.maskedLine.includes(TOKEN_DOT_CONNECT) &&
                    LEGACY_CONNECT_RE.test(ctx.rawLine),
                actionable: {
                    action: ACT_REPLACE_TOKEN,
                    codeId: '007',
                    templateSnippet: SNIPPET_CONNECT,
                },
            },
            {
                rule: RULE_GDM_DEB_001,
                severity: SEV_INFO,
                message: 'Button press event connected without debounce protection.',
                suggestion:
                    'Connect through debounce gate or use DebouncedButton to prevent rapid click spam.',
                condition: (ctx) =>
                    isFrontendFile(ctx.file) &&
                    (DEBOUNCE_ACTION_BUTTON_RE.test(ctx.maskedLine) ||
                        DEBOUNCE_HANDLER_RE.test(ctx.maskedLine)),
                actionable: {
                    action: ACT_GUARD_CLAUSE,
                    codeId: '009',
                    templateSnippet: SNIPPET_DEBOUNCE_CONNECT,
                },
            },
            {
                rule: RULE_GDM_FSM_001,
                severity: SEV_WARN,
                message: 'Direct state mutation bypassing state machine transition control.',
                suggestion:
                    'Route state changes through state_machine.transition_to(State) to preserve lifecycle hooks.',
                condition: (ctx) =>
                    !isFsmExemptPath(ctx.file) &&
                    FSM_STATE_MUTATION_RE.test(ctx.maskedLine),
                actionable: {
                    action: ACT_SIMPLIFY_CONTROL,
                    codeId: '010',
                    templateSnippet: SNIPPET_FSM_TRANSITION,
                },
            },
            {
                rule: RULE_GDM_WEAK_001,
                severity: SEV_WARN,
                message:
                    'Observer/listener collection retains direct object reference without weakref.',
                suggestion:
                    'Store weakref(target) in subscriber arrays to prevent memory leaks across scene reloads.',
                condition: (ctx) =>
                    (ctx.file.includes(TOKEN_REGISTRY) ||
                        ctx.file.includes(TOKEN_MANAGER) ||
                        ctx.file.includes(TOKEN_BUS)) &&
                    OBSERVER_APPEND_RE.test(ctx.maskedLine) &&
                    !hasWeakRefCall(ctx.maskedLine),
                actionable: {
                    action: ACT_GUARD_CLAUSE,
                    codeId: '011',
                    templateSnippet: SNIPPET_WEAKREF,
                },
            },
            {
                rule: RULE_GDM_RES_001,
                severity: SEV_INFO,
                message: 'Absolute positioning used in responsive view script.',
                suggestion:
                    'Anchor nodes using Container layouts or apply responsive scale factors.',
                condition: (ctx) =>
                    isViewFile(ctx.file) && RESPONSIVE_LAYOUT_RE.test(ctx.maskedLine),
                actionable: {
                    action: ACT_DECOMPOSE_MODULE,
                    codeId: '012',
                    templateSnippet: SNIPPET_RESPONSIVE_LAYOUT,
                },
            },
            {
                rule: RULE_GDM_UNI_001,
                severity: SEV_WARN,
                message: 'View performs direct state store mutation.',
                suggestion:
                    'Dispatch actions through the unidirectional flow dispatcher instead of direct mutation.',
                condition: (ctx) =>
                    isViewFile(ctx.file) && UNIDIRECTIONAL_FLOW_RE.test(ctx.maskedLine),
                actionable: {
                    action: ACT_DECOUPLE_FACADE,
                    codeId: '013',
                    templateSnippet: SNIPPET_STORE_DISPATCH,
                },
            },
            {
                rule: RULE_GDM_EXT_001,
                severity: SEV_WARN,
                message: 'View script does not inherit from BaseScreen.',
                suggestion:
                    'Inherit from BaseScreen to participate in screen lifecycle and transition protocols.',
                condition: (ctx) =>
                    isViewFile(ctx.file) && SCREEN_EXTENDS_RE.test(ctx.maskedLine),
                actionable: {
                    action: ACT_REPLACE_TOKEN,
                    codeId: '015',
                    templateSnippet: SNIPPET_BASE_SCREEN,
                },
            },
            {
                rule: RULE_GDM_TOK_001,
                severity: SEV_INFO,
                message: 'Hardcoded color or theme override bypassing design token constants.',
                suggestion:
                    'Reference ThemeTokens color constants or use design token overrides.',
                condition: (ctx) =>
                    isViewFile(ctx.file) && DESIGN_TOKEN_RE.test(ctx.maskedLine),
                actionable: {
                    action: ACT_REPLACE_TOKEN,
                    codeId: '016',
                    templateSnippet: SNIPPET_DESIGN_TOKEN,
                },
            },
            {
                rule: RULE_GDM_BAR_001,
                severity: SEV_INFO,
                message: 'Screen ready handler missing status bar registration.',
                suggestion:
                    'Register screen with the status bar coordinator during _ready() setup.',
                condition: (ctx) =>
                    isViewFile(ctx.file) && STATUS_BAR_RE.test(ctx.maskedLine),
                actionable: {
                    action: ACT_GUARD_CLAUSE,
                    codeId: '017',
                    templateSnippet: SNIPPET_STATUS_BAR,
                },
            },
            {
                rule: RULE_GDM_VRT_001,
                severity: SEV_INFO,
                message: 'Unbounded loop child instantiation without virtual recycling.',
                suggestion:
                    'Use VirtualListContainer recycling to maintain bounded node allocations.',
                condition: (ctx) =>
                    isViewFile(ctx.file) && VIRTUAL_LIST_RE.test(ctx.maskedLine),
                actionable: {
                    action: ACT_DECOMPOSE_MODULE,
                    codeId: '018',
                    templateSnippet: SNIPPET_VIRTUAL_LIST,
                },
            },
            {
                rule: RULE_GDM_I18N_001,
                severity: SEV_INFO,
                message: 'Static UI text string bound without tr() translation wrapper.',
                suggestion: 'Wrap user-facing strings with tr("KEY") for localization.',
                condition: (ctx) =>
                    isViewFile(ctx.file) && I18N_BINDING_RE.test(ctx.rawLine),
                actionable: {
                    action: ACT_REPLACE_TOKEN,
                    codeId: '019',
                    templateSnippet: SNIPPET_TR_WRAP,
                },
            },
            {
                rule: RULE_GDM_NOD_001,
                severity: SEV_INFO,
                message: 'Brittle relative node path navigation (../) in view.',
                suggestion:
                    'Mark target nodes as unique (%NodeName) and access via %Name syntax.',
                condition: (ctx) =>
                    isViewFile(ctx.file) && EXPLICIT_NODE_PATH_RE.test(ctx.maskedLine),
                actionable: {
                    action: ACT_REPLACE_TOKEN,
                    codeId: '020',
                    templateSnippet: SNIPPET_UNIQUE_NODE,
                },
            },
            {
                rule: RULE_GDM_BND_001,
                severity: SEV_WARN,
                message: 'View script directly binds to mutable GameState methods.',
                suggestion:
                    'Bind through ViewBinding layer or dispatch structured presentation actions.',
                condition: (ctx) =>
                    isViewFile(ctx.file) && GAME_STATE_COUPLE_RE.test(ctx.maskedLine),
                actionable: {
                    action: ACT_DECOUPLE_FACADE,
                    codeId: '021',
                    templateSnippet: SNIPPET_ACTION_DISPATCH,
                },
            },
            rulePoolReset,
            ruleViewLoc,
        ];

        this.delegate = new DeclarativeModernAnalyzer({
            analyzerId: ANALYZER_GDSCRIPT_MODERN,
            fileExtensions: [SOURCE_EXTENSION],
            maskConfig: GDSCRIPT_MASK,
            rules,
            multiLineScanner: (raw, masked, file, issues) => {
                scanMultiLineResetState(raw, masked, file, this.delegate, issues, rulePoolReset);
                scanMultiLineViewRules(raw, file, this.delegate, issues, ruleViewLoc);
            },
        });
    }

    public finalize(ctx: AnalyzerContext): Issue[] {
        return this.delegate.finalize(ctx);
    }

    public analyze(sf: unknown, ctx: AnalyzerContext): Issue[] {
        return this.delegate.analyze(sf, ctx);
    }
}
