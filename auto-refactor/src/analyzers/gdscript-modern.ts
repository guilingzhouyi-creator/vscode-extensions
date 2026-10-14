/**
 * Module: Static Analysis Engine — GDScript Modernization Rules
 * File Path: src/analyzers/gdscript-modern.ts
 * Architecture Role: GDScript-only style analyzer (a language pack bound to the language, never to
 *     a project) — Godot 3 → 4 migration findings, which no mature external linter covers
 * Dependencies & Triggers: core types + the shared source masker; enabled when a config declares
 *     `analyzers.gdscript-modern`; specialized packs are default-off, so registering it cannot
 *     change an existing gate result
 * Responsibilities: Report seven migration findings on `.gd` files: GDM-YIELD-001 (`yield(`),
 *     GDM-EXPORT-001 (`export` statement), GDM-ONREADY-001 (`onready var`), GDM-TOOL-001 (bare
 *     `tool` line), GDM-POOL-001 (`Pool*Array`), GDM-CONNECT-001 (Godot 3 `connect` signature) and
 *     GDM-RPC-001 (`remote`/`master`/`puppet`/`slave` function modifiers)
 * Exit Semantics & Design Rationale: Pure line scanner over the shared masked view, never throws
 *     and returns [] for every other language. GDScript comments are `#` only, so the mask needs no
 *     block-comment state; triple-quoted docstrings still mask correctly because each quote opens a
 *     run that the next quote closes. The `connect` rule is the one shape that needs the raw line
 *     (its arguments are string literals, which the mask blanks), so it checks both views: the
 *     masked text proves the call is real code, the raw text proves the Godot 3 signature.
 */
import type { Analyzer, AnalyzerContext, Issue, Severity, AgentActionType } from '../core/types';
import { ANALYZER_GDSCRIPT_MODERN } from '../core/scoring/dimensionLiterals';
import { maskSourceText, type SourceMaskConfig } from '../core/policy/source-mask';

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

const GDSCRIPT_QUOTE_CHARS = '"\'`';

/** Masking syntax for GDScript: `#` line comments and the three quote characters. */
const GDSCRIPT_MASK: SourceMaskConfig = {
    lineComment: '#',
    quoteChars: GDSCRIPT_QUOTE_CHARS,
};

/** `yield(...)`, replaced by `await`. */
const YIELD_RE = /\byield\s*\(/;

/** `export var x` / `export(int) var x`, replaced by the `@export` annotation. */
const EXPORT_RE = /^\s*export(?:\s*\([^)]*\))?\s+(?:var|const|onready)\b/;

/** `onready var x`, replaced by `@onready var x`. */
const ONREADY_RE = /^\s*onready\s+var\b/;

/** A bare `tool` line at the top of the script, replaced by `@tool`. */
const TOOL_RE = /^\s*tool\s*$/;

/** `Pool*Array` types, renamed to `Packed*Array` in Godot 4. */
const POOL_ARRAY_RE = /\bPool(?:Byte|Int|Real|String|Vector2|Vector3|Color)Array\b/;

/** Godot 3 RPC/modifier keywords ahead of `func`, replaced by the `@rpc` annotation. */
const RPC_MODIFIER_RE =
    /^\s*(?:remote|master|puppet|slave|remotesync|mastersync|puppetsync|sync)\s+func\b/;

/** Godot 3 `connect("signal", self, "method")` call, whose arguments are string literals. */
const LEGACY_CONNECT_RE = /\.connect\s*\(\s*"[^"]*"\s*,\s*(?:self|[A-Za-z_]\w*)\s*,\s*"[^"]*"\s*\)/;

/** Issue metadata specification for constructing structured findings. */
interface IssueSpec {
    /** Canonical rule id (`GDM-TOPIC-NNN`). */
    readonly rule: string;
    /** Finding severity. */
    readonly severity: Severity;
    /** Why the Godot 4 form is preferable. */
    readonly message: string;
    /** One-line migration guidance. */
    readonly suggestion: string;
}

/** One keyword-anchored rule: pattern to match on the masked line plus its report text. */
interface LineRule extends IssueSpec {
    /** Pattern run against the masked line. */
    readonly pattern: RegExp;
}

/** Context bundle targeting presentation view line scanning. */
interface ViewScanTarget {
    readonly masked: string[];
    readonly raw: string[];
    readonly file: string;
    readonly out: Issue[];
}

/** Keyword rules, all of which fit on one physical line. */
const LINE_RULES: LineRule[] = [
    {
        rule: RULE_GDM_YIELD_001,
        severity: SEV_WARN,
        pattern: YIELD_RE,
        message: '`yield` was removed in Godot 4: coroutines are plain `await` expressions.',
        suggestion: 'Rewrite `yield(obj, "signal")` as `await obj.signal`.',
    },
    {
        rule: RULE_GDM_EXPORT_001,
        severity: SEV_WARN,
        pattern: EXPORT_RE,
        message: 'The `export` statement syntax is gone; Godot 4 uses annotations.',
        suggestion: 'Write `@export var x: int`, keeping the type in the declaration itself.',
    },
    {
        rule: RULE_GDM_ONREADY_001,
        severity: SEV_WARN,
        pattern: ONREADY_RE,
        message: '`onready` became the `@onready` annotation in Godot 4.',
        suggestion: 'Write `@onready var node = $Path`.',
    },
    {
        rule: RULE_GDM_TOOL_001,
        severity: SEV_WARN,
        pattern: TOOL_RE,
        message: 'The `tool` keyword became the `@tool` annotation in Godot 4.',
        suggestion: 'Put `@tool` on the first line of the script.',
    },
    {
        rule: RULE_GDM_POOL_001,
        severity: SEV_WARN,
        pattern: POOL_ARRAY_RE,
        message: '`Pool*Array` types were renamed to `Packed*Array` in Godot 4.',
        suggestion: 'Use the `PackedByteArray` / `PackedVector2Array` family of names.',
    },
    {
        rule: RULE_GDM_RPC_001,
        severity: SEV_WARN,
        pattern: RPC_MODIFIER_RE,
        message: 'RPC keywords before `func` were replaced by the `@rpc` annotation.',
        suggestion:
            'Annotate the function (`@rpc("any_peer", "call_local")`) and drop the keyword.',
    },
];

interface ActionableSpec {
    readonly action?: AgentActionType;
    readonly code: string;
    readonly safeToAutomate?: boolean;
    readonly templateSnippet: string;
}

interface ActionableConfigEntry {
    readonly rule: string;
    readonly codeId: string;
    readonly snippet: string;
    readonly action?: AgentActionType;
    readonly autoSafe?: boolean;
}

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
const SNIPPET_SPLIT_SUBVIEWS = '# Split into sub-views';
const SNIPPET_EXTENDS_BASE_SCREEN = 'extends BaseScreen';
const SNIPPET_THEME_CONSTANTS = 'ThemeConstants.$1';
const SNIPPET_STATUS_BAR = 'StatusBar.new()';
const SNIPPET_VIRTUAL_LIST = 'VirtualList.new()';
const SNIPPET_TR = 'tr("$1")';
const SNIPPET_UNIQUE_NODE = '@onready var $1 = %$1';
const SNIPPET_PRESENTER_BIND = 'presenter.bind($1)';

const ACTIONABLE_SPECS_TABLE: readonly ActionableConfigEntry[] = [
    { rule: RULE_GDM_YIELD_001, codeId: '001', snippet: SNIPPET_AWAIT },
    { rule: RULE_GDM_EXPORT_001, codeId: '002', snippet: SNIPPET_EXPORT },
    { rule: RULE_GDM_ONREADY_001, codeId: '003', snippet: SNIPPET_ONREADY, autoSafe: true },
    { rule: RULE_GDM_TOOL_001, codeId: '004', snippet: SNIPPET_TOOL, autoSafe: true },
    { rule: RULE_GDM_POOL_001, codeId: '005', snippet: SNIPPET_PACKED_ARRAY, autoSafe: true },
    { rule: RULE_GDM_RPC_001, codeId: '006', snippet: SNIPPET_RPC },
    { rule: RULE_GDM_CONNECT_001, codeId: '007', snippet: SNIPPET_CONNECT },
    {
        rule: RULE_GDM_POOL_002,
        codeId: '008',
        snippet: SNIPPET_SUPER_RESET,
        action: ACT_GUARD_CLAUSE,
    },
    {
        rule: RULE_GDM_DEB_001,
        codeId: '009',
        snippet: SNIPPET_DEBOUNCE_CONNECT,
        action: ACT_GUARD_CLAUSE,
    },
    {
        rule: RULE_GDM_FSM_001,
        codeId: '010',
        snippet: SNIPPET_FSM_TRANSITION,
        action: ACT_GUARD_CLAUSE,
    },
    { rule: RULE_GDM_WEAK_001, codeId: '011', snippet: SNIPPET_WEAKREF },
    {
        rule: RULE_GDM_RES_001,
        codeId: '012',
        snippet: SNIPPET_RESPONSIVE_LAYOUT,
        action: ACT_SIMPLIFY_CONTROL,
    },
    {
        rule: RULE_GDM_UNI_001,
        codeId: '013',
        snippet: SNIPPET_STORE_DISPATCH,
        action: ACT_SIMPLIFY_CONTROL,
    },
    {
        rule: RULE_GDM_LOC_001,
        codeId: '014',
        snippet: SNIPPET_SPLIT_SUBVIEWS,
        action: ACT_DECOMPOSE_MODULE,
    },
    { rule: RULE_GDM_EXT_001, codeId: '015', snippet: SNIPPET_EXTENDS_BASE_SCREEN },
    { rule: RULE_GDM_TOK_001, codeId: '016', snippet: SNIPPET_THEME_CONSTANTS },
    { rule: RULE_GDM_BAR_001, codeId: '017', snippet: SNIPPET_STATUS_BAR },
    { rule: RULE_GDM_VRT_001, codeId: '018', snippet: SNIPPET_VIRTUAL_LIST },
    { rule: RULE_GDM_I18N_001, codeId: '019', snippet: SNIPPET_TR },
    { rule: RULE_GDM_NOD_001, codeId: '020', snippet: SNIPPET_UNIQUE_NODE },
    {
        rule: RULE_GDM_BND_001,
        codeId: '021',
        snippet: SNIPPET_PRESENTER_BIND,
        action: ACT_DECOUPLE_FACADE,
    },
];

function buildActionableSpecMap(
    entries: readonly ActionableConfigEntry[],
): Record<string, ActionableSpec> {
    const map: Record<string, ActionableSpec> = {};
    for (let i = 0; i < entries.length; i++) {
        const configEntry = entries[i];
        map[configEntry.rule] = {
            code: `AR:GDM:${configEntry.codeId}`,
            templateSnippet: configEntry.snippet,
            ...(configEntry.action ? { action: configEntry.action } : {}),
            ...(configEntry.autoSafe ? { safeToAutomate: configEntry.autoSafe } : {}),
        };
    }
    return map;
}

const ACTIONABLE_SPECS: Readonly<Record<string, ActionableSpec>> = Object.freeze(
    buildActionableSpecMap(ACTIONABLE_SPECS_TABLE),
);

const SPEC_CONNECT: IssueSpec = Object.freeze({
    rule: RULE_GDM_CONNECT_001,
    severity: SEV_INFO,
    message: 'Godot 3 `connect` passes the method as a string, which no checker validates.',
    suggestion: 'Use `signal.connect(method.callable())` or `signal.connect(_on_signal)`.',
});

const SPEC_POOL_RESET: IssueSpec = Object.freeze({
    rule: RULE_GDM_POOL_002,
    severity: SEV_WARN,
    message:
        'Object pool `reset_state()` method should invoke `super.reset_state()` to maintain parent state cleanup contract.',
    suggestion:
        'Add `super.reset_state()` to ensure inherited entity properties are safely reset before reuse.',
});

const SPEC_DEBOUNCE: IssueSpec = Object.freeze({
    rule: RULE_GDM_DEB_001,
    severity: SEV_WARN,
    message:
        'Critical business action button connects bare `pressed` signal without debounce or loading fencing.',
    suggestion:
        'Wrap with KButton or connect to debounced_pressed signal to guard against rapid duplicate clicks.',
});

const SPEC_FSM: IssueSpec = Object.freeze({
    rule: RULE_GDM_FSM_001,
    severity: SEV_WARN,
    message: 'Direct mutation of private FSM state variable bypasses lifecycle transition guards.',
    suggestion:
        'Invoke `fsm.transition_to(target_state, payload)` to ensure entry/exit guards execute.',
});

const SPEC_WEAKREF: IssueSpec = Object.freeze({
    rule: RULE_GDM_WEAK_001,
    severity: SEV_WARN,
    message: 'Dynamic observer registry holds strong reference to Node instance without `weakref`.',
    suggestion: 'Store `weakref(node)` and verify `.get_ref() != null` before dispatching updates.',
});

const SPEC_RESPONSIVE: IssueSpec = Object.freeze({
    rule: RULE_GDM_RES_001,
    severity: SEV_WARN,
    message:
        'Hardcoded absolute screen resolution in view layout breaks responsive multi-aspect scaling.',
    suggestion:
        'Use Anchors Preset (`set_anchors_preset(PRESET_FULL_RECT)`) and adaptive container layout.',
});

const SPEC_UNIDIRECTIONAL: IssueSpec = Object.freeze({
    rule: RULE_GDM_UNI_001,
    severity: SEV_WARN,
    message: 'In-place mutation of immutable Snapshot DTO field violates unidirectional data flow.',
    suggestion:
        'Dispatch an intention Command or call domain boundary service instead of modifying snapshot directly.',
});

const SPEC_VIEW_LOC: IssueSpec = Object.freeze({
    rule: RULE_GDM_LOC_001,
    severity: SEV_WARN,
    message: 'Presentation view script exceeds physical line budget limit of 450 LOC.',
    suggestion:
        'Decompose complex subpanels, item renderers, or companion controllers into separate modules.',
});

const SPEC_SCREEN_EXTENDS: IssueSpec = Object.freeze({
    rule: RULE_GDM_EXT_001,
    severity: SEV_WARN,
    message:
        'Presentation view controller directly extends Control instead of BaseScreen or BaseModal.',
    suggestion:
        'Extend BaseScreen for full-screen views or BaseModal for dialogs to integrate standard lifecycle.',
});

const SPEC_DESIGN_TOKEN: IssueSpec = Object.freeze({
    rule: RULE_GDM_TOK_001,
    severity: SEV_WARN,
    message:
        'Hardcoded Color(...) literal in presentation view violates DesignTokens single source of truth.',
    suggestion: 'Use semantic color constants from DesignTokens (e.g., DesignTokens.COLOR_*).',
});

const SPEC_STATUS_BAR: IssueSpec = Object.freeze({
    rule: RULE_GDM_BAR_001,
    severity: SEV_WARN,
    message:
        'Direct instantiation of bare ProgressBar violates KStatusBar standardized component contract.',
    suggestion:
        'Use KStatusBarClass.create_bar(...) or instantiate KStatusBar to ensure uniform styling and smooth tweens.',
});

const SPEC_VIRTUAL_LIST: IssueSpec = Object.freeze({
    rule: RULE_GDM_VRT_001,
    severity: SEV_WARN,
    message:
        'Unbounded dynamic node instantiation in list container without KVirtualList recycling.',
    suggestion: 'Use KVirtualList with object pooling to recycle list item nodes efficiently.',
});

const SPEC_I18N: IssueSpec = Object.freeze({
    rule: RULE_GDM_I18N_001,
    severity: SEV_WARN,
    message: 'Hardcoded user-facing string assigned directly without i18n localization wrapper.',
    suggestion:
        'Wrap UI text with tr("KEY") or bind through UIIntermediary for reactive locale switching.',
});

const SPEC_NODE_PATH: IssueSpec = Object.freeze({
    rule: RULE_GDM_NOD_001,
    severity: SEV_WARN,
    message:
        'Fragile relative node traversal (get_parent/find_child) breaks presentation encapsulation.',
    suggestion:
        'Use explicit %UniqueNode naming or typed dependency injection instead of relative path lookup.',
});

const SPEC_PRESENTATION_BIND: IssueSpec = Object.freeze({
    rule: RULE_GDM_BND_001,
    severity: SEV_WARN,
    message: 'Presentation view directly couples to backend GameState singleton.',
    suggestion:
        'Consume data via BaseScreen.apply_snapshot() and emit UI intentions instead of mutating backend state.',
});

/**
 * Build one finding anchored to a source line.
 *
 * @param file - Normalized repository-relative path.
 * @param lineIndex - Zero-based line index.
 * @param spec - Canonical issue metadata specification.
 * @param detail - Structured evidence for machines.
 * @returns The finding, ready to be pushed onto the result list.
 */
function makeIssue(
    file: string,
    lineIndex: number,
    spec: IssueSpec,
    detail: Record<string, unknown>,
): Issue {
    const line = lineIndex + 1;
    const mapped = ACTIONABLE_SPECS[spec.rule];
    const actionable = mapped
        ? {
              action: mapped.action ?? ACT_REPLACE_TOKEN,
              code: mapped.code,
              safeToAutomate: mapped.safeToAutomate ?? false,
              templateSnippet: mapped.templateSnippet,
          }
        : undefined;

    return {
        id: `${ANALYZER_GDSCRIPT_MODERN}:${spec.rule}:${file}:${line}`,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        rule: spec.rule,
        severity: spec.severity,
        message: spec.message,
        location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
        detail,
        suggestion: spec.suggestion,
        ...(actionable ? { actionable } : {}),
    };
}

const FSM_EXEMPT_PATH_TOKENS: ReadonlySet<string> = new Set(['fsm', 'state_machine']);
const FSM_STATE_MUTATION_RE = /^\s*(?:self\.)?_current_state\s*=\s*(?:State\.|STATE_|[A-Z0-9_]+)/;
const WEAKREF_SAFE_CALLS: ReadonlySet<string> = new Set(['weakref']);
const WEAKREF_TOKEN_RE = /\b(weakref)\s*\(/;
const OBSERVER_APPEND_RE =
    /\b(?:_observers|_listeners|_bindings|_subscribers)\.append\s*\(\s*(?:node|listener|control|view|target)\s*\)/;

const SCREEN_EXTENDS_RE = /^\s*extends\s+Control\b/;
const DESIGN_TOKEN_RE = /\bColor\s*\(/;
const STATUS_BAR_RE = /\bProgressBar\.new\s*\(/;
const VIRTUAL_LIST_RE = /\b(?:list|_list)\.add_child\s*\(\s*item\s*\)/;
const I18N_BINDING_RE = /^\s*(?:title|heading|text|subtitle)\s*=\s*"[A-Z][A-Za-z0-9 ]{3,}"/;
const EXPLICIT_NODE_PATH_RE = /\b(?:get_parent\s*\(\s*\)|find_child\s*\()/;
const GAME_STATE_COUPLE_RE = /\bGameState\.[A-Za-z0-9_]+\s*\(/;
const RESPONSIVE_LAYOUT_RE =
    /\b(?:size|custom_minimum_size)\s*=\s*Vector2\s*\(\s*(?:1920|2560|3840|1280)\s*,\s*(?:1080|1440|2160|720)\s*\)/;
const UNIDIRECTIONAL_FLOW_RE =
    /\b(?:snapshot|dto|_snapshot|_dto)\s*\.\s*(?:hp|mp|gold|score|level|exp|status|currency)\s*(?:=|\+=|-=|\*=)/;
const DEBOUNCE_ACTION_BUTTON_RE =
    /\b(?:submit|buy|purchase|login|register|transfer|confirm|delete)_btn\b.*\.pressed\.connect\s*\(/;
const DEBOUNCE_HANDLER_RE =
    /\.pressed\.connect\s*\(\s*(?:_on_submit|_on_buy|_on_purchase|_on_confirm|_on_transfer|_on_login)\b/;
const RESET_STATE_FUNC_RE = /^\s*func\s+reset_state\s*\(/;
const EXTENDS_ANY_RE = /^\s*extends\s+[A-Za-z0-9_]/;
const SUPER_RESET_RE = /\bsuper(?:\.reset_state\s*\(|\s*\()/;

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

/** GDScript modernization pack: seven rules over a masked view of the file. */
export class GdscriptModernAnalyzer implements Analyzer {
    name = ANALYZER_GDSCRIPT_MODERN;

    /**
     * Streaming-path entry point: the engine invokes this once per file. Content-only analyzers
     * must expose it, because the legacy `analyze` path covers the TS-family adapters only.
     *
     * @param ctx - Analyzer context carrying the file content and path.
     * @returns All findings for the file.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    /**
     * Scan one GDScript file for Godot 3 → 4 migration findings.
     *
     * @param _sf - Unused TypeScript source file (kept for the analyzer contract).
     * @param ctx - Analyzer context carrying the file content and path.
     * @returns All findings for the file.
     */
    analyze(_sf: unknown, ctx: AnalyzerContext): Issue[] {
        const file = ctx.filePath.replace(/\\/g, '/');
        if (!file.endsWith(SOURCE_EXTENSION)) return [];
        const content = ctx.content || '';
        if (content.length === 0) return [];
        const { raw, masked } = maskSourceText(content, GDSCRIPT_MASK);
        const out: Issue[] = [];
        for (let index = 0; index < masked.length; index += 1) {
            const code = masked[index];
            if (code.trim().length === 0) continue;
            for (const rule of LINE_RULES) {
                if (!rule.pattern.test(code)) continue;
                out.push(makeIssue(file, index, rule, { line: raw[index].trim() }));
            }
            if (masked[index].includes(TOKEN_DOT_CONNECT) && LEGACY_CONNECT_RE.test(raw[index])) {
                out.push(makeIssue(file, index, SPEC_CONNECT, { line: raw[index].trim() }));
            }
        }

        // Check for Object Pool contract violation: reset_state without super call
        this.checkResetStateSuperContract(masked, raw, file, out);
        this.checkDebounceDiscipline(masked, raw, file, out);
        this.checkFsmStateMutation(masked, raw, file, out);
        this.checkWeakRefObserverHygiene(masked, raw, file, out);
        this.checkResponsiveLayoutDiscipline(masked, raw, file, out);
        this.checkUnidirectionalFlow(masked, raw, file, out);
        this.checkViewLocBudget(masked, raw, file, out);
        this.checkScreenBaseInheritance(masked, raw, file, out);
        this.checkDesignTokenCompliance(masked, raw, file, out);
        this.checkStatusBarComponentAdoption(masked, raw, file, out);
        this.checkVirtualListAdoption(masked, raw, file, out);
        this.checkI18nBindingDiscipline(masked, raw, file, out);
        this.checkExplicitNodePathDiscipline(masked, raw, file, out);
        this.checkPresentationDecoupling(masked, raw, file, out);
        return out;
    }

    private checkResetStateSuperContract(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        const hasExtends = masked.some((l) => EXTENDS_ANY_RE.test(l));
        if (!hasExtends) return;

        for (let index = 0; index < masked.length; index += 1) {
            const code = masked[index];
            if (!RESET_STATE_FUNC_RE.test(code)) continue;

            const funcIndent = code.search(/\S/);
            const hasSuperCall = this.hasSuperInResetState(masked, index + 1, funcIndent);
            if (!hasSuperCall) {
                out.push(makeIssue(file, index, SPEC_POOL_RESET, { line: raw[index].trim() }));
            }
        }
    }

    private hasSuperInResetState(
        masked: string[],
        startIndex: number,
        funcIndent: number,
    ): boolean {
        for (let j = startIndex; j < masked.length; j += 1) {
            const bodyLine = masked[j];
            if (bodyLine.trim().length === 0 || bodyLine.trim().startsWith('#')) continue;
            const bodyIndent = bodyLine.search(/\S/);
            if (bodyIndent <= funcIndent) {
                break;
            }
            if (SUPER_RESET_RE.test(bodyLine)) {
                return true;
            }
        }
        return false;
    }

    private checkDebounceDiscipline(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        const norm = file.startsWith('/') ? file : '/' + file.replace(/\\/g, '/');
        if (!norm.includes(PATH_VIEWS) && !norm.includes(PATH_FRONTEND)) return;
        for (let index = 0; index < masked.length; index += 1) {
            const line = masked[index];
            if (DEBOUNCE_ACTION_BUTTON_RE.test(line) || DEBOUNCE_HANDLER_RE.test(line)) {
                out.push(makeIssue(file, index, SPEC_DEBOUNCE, { line: raw[index].trim() }));
            }
        }
    }

    private checkFsmStateMutation(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        if (isFsmExemptPath(file)) return;
        for (let index = 0; index < masked.length; index += 1) {
            const line = masked[index];
            if (FSM_STATE_MUTATION_RE.test(line)) {
                out.push(makeIssue(file, index, SPEC_FSM, { line: raw[index].trim() }));
            }
        }
    }

    private checkWeakRefObserverHygiene(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        if (
            !file.includes(TOKEN_REGISTRY) &&
            !file.includes(TOKEN_MANAGER) &&
            !file.includes(TOKEN_BUS)
        ) {
            return;
        }
        for (let index = 0; index < masked.length; index += 1) {
            const line = masked[index];
            if (OBSERVER_APPEND_RE.test(line) && !hasWeakRefCall(line)) {
                out.push(makeIssue(file, index, SPEC_WEAKREF, { line: raw[index].trim() }));
            }
        }
    }

    private isViewFile(file: string): boolean {
        const norm = file.startsWith('/') ? file : '/' + file.replace(/\\/g, '/');
        return norm.includes(PATH_VIEWS);
    }

    private scanViewPattern(
        target: ViewScanTarget,
        pattern: RegExp,
        spec: IssueSpec,
        useRaw = false,
    ): void {
        if (!this.isViewFile(target.file)) return;
        const source = useRaw ? target.raw : target.masked;
        for (let index = 0; index < source.length; index += 1) {
            if (pattern.test(source[index])) {
                target.out.push(
                    makeIssue(target.file, index, spec, { line: target.raw[index].trim() }),
                );
            }
        }
    }

    private checkResponsiveLayoutDiscipline(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        this.scanViewPattern({ masked, raw, file, out }, RESPONSIVE_LAYOUT_RE, SPEC_RESPONSIVE);
    }

    private checkUnidirectionalFlow(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        this.scanViewPattern(
            { masked, raw, file, out },
            UNIDIRECTIONAL_FLOW_RE,
            SPEC_UNIDIRECTIONAL,
        );
    }

    private checkViewLocBudget(_masked: string[], raw: string[], file: string, out: Issue[]): void {
        if (!this.isViewFile(file)) return;
        if (raw.length > MAX_VIEW_LOC_BUDGET) {
            out.push(makeIssue(file, 0, SPEC_VIEW_LOC, { lineCount: raw.length }));
        }
    }

    private checkScreenBaseInheritance(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        this.scanViewPattern({ masked, raw, file, out }, SCREEN_EXTENDS_RE, SPEC_SCREEN_EXTENDS);
    }

    private checkDesignTokenCompliance(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        this.scanViewPattern({ masked, raw, file, out }, DESIGN_TOKEN_RE, SPEC_DESIGN_TOKEN);
    }

    private checkStatusBarComponentAdoption(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        this.scanViewPattern({ masked, raw, file, out }, STATUS_BAR_RE, SPEC_STATUS_BAR);
    }

    private checkVirtualListAdoption(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        this.scanViewPattern({ masked, raw, file, out }, VIRTUAL_LIST_RE, SPEC_VIRTUAL_LIST);
    }

    private checkI18nBindingDiscipline(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        this.scanViewPattern({ masked, raw, file, out }, I18N_BINDING_RE, SPEC_I18N, true);
    }

    private checkExplicitNodePathDiscipline(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        this.scanViewPattern({ masked, raw, file, out }, EXPLICIT_NODE_PATH_RE, SPEC_NODE_PATH);
    }

    private checkPresentationDecoupling(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        const scanTarget: ViewScanTarget = { masked, raw, file, out };
        this.scanViewPattern(scanTarget, GAME_STATE_COUPLE_RE, SPEC_PRESENTATION_BIND);
    }
}
