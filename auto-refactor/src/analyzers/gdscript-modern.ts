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
import { SEVERITY_WARNING, SEVERITY_INFO } from '../core/types';
import { ANALYZER_GDSCRIPT_MODERN } from '../core/scoring/dimensionLiterals';
import { maskSourceText, type SourceMaskConfig } from '../core/policy/source-mask';

/** Extension the pack accepts; the content-only path sees every language. */
const SOURCE_EXTENSION = '.gd';

/** Masking syntax for GDScript: `#` line comments and the three quote characters. */
const GDSCRIPT_MASK: SourceMaskConfig = {
    lineComment: '#',
    quoteChars: '"\'`',
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

/** One keyword-anchored rule: pattern to match on the masked line plus its report text. */
interface LineRule {
    /** Canonical rule id (`GDM-TOPIC-NNN`). */
    rule: string;
    /** Finding severity. */
    severity: Severity;
    /** Pattern run against the masked line. */
    pattern: RegExp;
    /** Why the Godot 4 form is preferable. */
    message: string;
    /** One-line migration guidance. */
    suggestion: string;
}

/** Keyword rules, all of which fit on one physical line. */
const LINE_RULES: LineRule[] = [
    {
        rule: 'GDM-YIELD-001',
        severity: SEVERITY_WARNING,
        pattern: YIELD_RE,
        message: '`yield` was removed in Godot 4: coroutines are plain `await` expressions.',
        suggestion: 'Rewrite `yield(obj, "signal")` as `await obj.signal`.',
    },
    {
        rule: 'GDM-EXPORT-001',
        severity: SEVERITY_WARNING,
        pattern: EXPORT_RE,
        message: 'The `export` statement syntax is gone; Godot 4 uses annotations.',
        suggestion: 'Write `@export var x: int`, keeping the type in the declaration itself.',
    },
    {
        rule: 'GDM-ONREADY-001',
        severity: SEVERITY_WARNING,
        pattern: ONREADY_RE,
        message: '`onready` became the `@onready` annotation in Godot 4.',
        suggestion: 'Write `@onready var node = $Path`.',
    },
    {
        rule: 'GDM-TOOL-001',
        severity: SEVERITY_WARNING,
        pattern: TOOL_RE,
        message: 'The `tool` keyword became the `@tool` annotation in Godot 4.',
        suggestion: 'Put `@tool` on the first line of the script.',
    },
    {
        rule: 'GDM-POOL-001',
        severity: SEVERITY_WARNING,
        pattern: POOL_ARRAY_RE,
        message: '`Pool*Array` types were renamed to `Packed*Array` in Godot 4.',
        suggestion: 'Use the `PackedByteArray` / `PackedVector2Array` family of names.',
    },
    {
        rule: 'GDM-RPC-001',
        severity: SEVERITY_WARNING,
        pattern: RPC_MODIFIER_RE,
        message: 'RPC keywords before `func` were replaced by the `@rpc` annotation.',
        suggestion:
            'Annotate the function (`@rpc("any_peer", "call_local")`) and drop the keyword.',
    },
];

const GDM_ACTIONABLE_MAP: Record<
    string,
    { action: AgentActionType; code: string; safeToAutomate: boolean; templateSnippet: string }
> = {
    'GDM-YIELD-001': {
        action: 'replace_token',
        code: 'AR:GDM:001',
        safeToAutomate: false,
        templateSnippet: 'await $1.$2',
    },
    'GDM-EXPORT-001': {
        action: 'replace_token',
        code: 'AR:GDM:002',
        safeToAutomate: false,
        templateSnippet: '@export var $1: $2',
    },
    'GDM-ONREADY-001': {
        action: 'replace_token',
        code: 'AR:GDM:003',
        safeToAutomate: true,
        templateSnippet: '@onready var $1 = $2',
    },
    'GDM-TOOL-001': {
        action: 'replace_token',
        code: 'AR:GDM:004',
        safeToAutomate: true,
        templateSnippet: '@tool',
    },
    'GDM-POOL-001': {
        action: 'replace_token',
        code: 'AR:GDM:005',
        safeToAutomate: true,
        templateSnippet: 'Packed$1Array',
    },
    'GDM-RPC-001': {
        action: 'replace_token',
        code: 'AR:GDM:006',
        safeToAutomate: false,
        templateSnippet: '@rpc func $1()',
    },
    'GDM-CONNECT-001': {
        action: 'replace_token',
        code: 'AR:GDM:007',
        safeToAutomate: false,
        templateSnippet: '$1.connect($2.$3)',
    },
    'GDM-POOL-002': {
        action: 'apply_guard_clause',
        code: 'AR:GDM:008',
        safeToAutomate: false,
        templateSnippet: 'super.reset_state()',
    },
    'GDM-DEB-001': {
        action: 'apply_guard_clause',
        code: 'AR:GDM:009',
        safeToAutomate: false,
        templateSnippet: 'btn.pressed_debounced.connect($1)',
    },
    'GDM-FSM-001': {
        action: 'apply_guard_clause',
        code: 'AR:GDM:010',
        safeToAutomate: false,
        templateSnippet: 'fsm.transition_to($1)',
    },
    'GDM-WEAK-001': {
        action: 'replace_token',
        code: 'AR:GDM:011',
        safeToAutomate: false,
        templateSnippet: 'weakref($1)',
    },
    'GDM-RES-001': {
        action: 'simplify_control_flow',
        code: 'AR:GDM:012',
        safeToAutomate: false,
        templateSnippet: 'apply_responsive_layout()',
    },
    'GDM-UNI-001': {
        action: 'simplify_control_flow',
        code: 'AR:GDM:013',
        safeToAutomate: false,
        templateSnippet: 'store.dispatch($1)',
    },
    'GDM-LOC-001': {
        action: 'decompose_module',
        code: 'AR:GDM:014',
        safeToAutomate: false,
        templateSnippet: '# Split into sub-views',
    },
    'GDM-EXT-001': {
        action: 'replace_token',
        code: 'AR:GDM:015',
        safeToAutomate: false,
        templateSnippet: 'extends BaseScreen',
    },
    'GDM-TOK-001': {
        action: 'replace_token',
        code: 'AR:GDM:016',
        safeToAutomate: false,
        templateSnippet: 'ThemeConstants.$1',
    },
    'GDM-BAR-001': {
        action: 'replace_token',
        code: 'AR:GDM:017',
        safeToAutomate: false,
        templateSnippet: 'StatusBar.new()',
    },
    'GDM-VRT-001': {
        action: 'replace_token',
        code: 'AR:GDM:018',
        safeToAutomate: false,
        templateSnippet: 'VirtualList.new()',
    },
    'GDM-I18N-001': {
        action: 'replace_token',
        code: 'AR:GDM:019',
        safeToAutomate: false,
        templateSnippet: 'tr("$1")',
    },
    'GDM-NOD-001': {
        action: 'replace_token',
        code: 'AR:GDM:020',
        safeToAutomate: false,
        templateSnippet: '@onready var $1 = %$1',
    },
    'GDM-BND-001': {
        action: 'decouple_facade',
        code: 'AR:GDM:021',
        safeToAutomate: false,
        templateSnippet: 'presenter.bind($1)',
    },
};

/**
 * Build one finding anchored to a source line.
 *
 * @param file - Normalized repository-relative path.
 * @param lineIndex - Zero-based line index.
 * @param rule - Canonical rule id.
 * @param severity - Finding severity.
 * @param message - Why the Godot 4 form is preferable.
 * @param suggestion - One-line migration guidance.
 * @param detail - Structured evidence for machines.
 * @returns The finding, ready to be pushed onto the result list.
 */
function makeIssue(
    file: string,
    lineIndex: number,
    rule: string,
    severity: Severity,
    message: string,
    suggestion: string,
    detail: Record<string, unknown>,
): Issue {
    const line = lineIndex + 1;
    const mapped = GDM_ACTIONABLE_MAP[rule];
    const actionable = mapped
        ? {
              action: mapped.action,
              code: mapped.code,
              safeToAutomate: mapped.safeToAutomate,
              templateSnippet: mapped.templateSnippet,
          }
        : undefined;

    return {
        id: `${ANALYZER_GDSCRIPT_MODERN}:${rule}:${file}:${line}`,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        rule,
        severity,
        message,
        location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
        detail,
        suggestion,
        ...(actionable ? { actionable } : {}),
    };
}

const FSM_EXEMPT_PATH_TOKENS: ReadonlySet<string> = new Set(['fsm', 'state_machine']);
const FSM_STATE_MUTATION_RE = /^\s*(?:self\.)?_current_state\s*=\s*(?:State\.|STATE_|[A-Z0-9_]+)/;
const WEAKREF_SAFE_CALLS: ReadonlySet<string> = new Set(['weakref']);
const WEAKREF_TOKEN_RE = /\b(weakref)\s*\(/;
const OBSERVER_APPEND_RE =
    /\b(?:_observers|_listeners|_bindings|_subscribers)\.append\s*\(\s*(?:node|listener|control|view|target)\s*\)/;

function isFsmExemptPath(file: string): boolean {
    const normalized = file.toLowerCase();
    if (normalized.includes('/fsm/') || normalized.includes('state_machine')) {
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
                out.push(
                    makeIssue(
                        file,
                        index,
                        rule.rule,
                        rule.severity,
                        rule.message,
                        rule.suggestion,
                        {
                            line: raw[index].trim(),
                        },
                    ),
                );
            }
            if (masked[index].includes('.connect(') && LEGACY_CONNECT_RE.test(raw[index])) {
                out.push(
                    makeIssue(
                        file,
                        index,
                        'GDM-CONNECT-001',
                        SEVERITY_INFO,
                        'Godot 3 `connect` passes the method as a string, which no checker validates.',
                        'Use `signal.connect(method.callable())` or `signal.connect(_on_signal)`.',
                        { line: raw[index].trim() },
                    ),
                );
            }
        }

        // Check for Object Pool contract violation: reset_state without super call
        this.checkResetStateSuperContract(masked, raw, file, out);
        this.checkDebounceDiscipline(masked, raw, file, out);
        this.checkFsmStateMutation(masked, raw, file, out);
        this.checkWeakRefObserverHygiene(masked, raw, file, out);
        this.checkResponsiveLayoutDiscipline(masked, raw, file, out);
        this.checkUnidirectionalFlowIntegrity(masked, raw, file, out);
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
        const hasExtends = masked.some((l) => /^\s*extends\s+[A-Za-z0-9_]/.test(l));
        if (!hasExtends) return;

        for (let index = 0; index < masked.length; index += 1) {
            const code = masked[index];
            if (!/^\s*func\s+reset_state\s*\(/.test(code)) continue;

            const funcIndent = code.search(/\S/);
            const hasSuperCall = this.hasSuperCallInResetState(masked, index + 1, funcIndent);
            if (!hasSuperCall) {
                out.push(
                    makeIssue(
                        file,
                        index,
                        'GDM-POOL-002',
                        SEVERITY_WARNING,
                        'Object pool `reset_state()` method should invoke `super.reset_state()` to maintain parent state cleanup contract.',
                        'Add `super.reset_state()` to ensure inherited entity properties are safely reset before reuse.',
                        { line: raw[index].trim() },
                    ),
                );
            }
        }
    }

    private hasSuperCallInResetState(
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
            if (/\bsuper(?:\.reset_state\s*\(|\s*\()/.test(bodyLine)) {
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
        if (!file.includes('/views/') && !file.includes('/frontend/')) return;
        for (let index = 0; index < masked.length; index += 1) {
            const line = masked[index];
            if (
                /\b(?:submit|buy|purchase|login|register|transfer|confirm|delete)_btn\b.*\.pressed\.connect\s*\(/.test(
                    line,
                ) ||
                /\.pressed\.connect\s*\(\s*(?:_on_submit|_on_buy|_on_purchase|_on_confirm|_on_transfer|_on_login)\b/.test(
                    line,
                )
            ) {
                out.push(
                    makeIssue(
                        file,
                        index,
                        'GDM-DEB-001',
                        SEVERITY_WARNING,
                        'Critical business action button connects bare `pressed` signal without debounce or loading fencing.',
                        'Wrap with KButton or connect to debounced_pressed signal to guard against rapid duplicate clicks.',
                        { line: raw[index].trim() },
                    ),
                );
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
                out.push(
                    makeIssue(
                        file,
                        index,
                        'GDM-FSM-001',
                        SEVERITY_WARNING,
                        'Direct mutation of private FSM state variable bypasses lifecycle transition guards.',
                        'Invoke `fsm.transition_to(target_state, payload)` to ensure entry/exit guards execute.',
                        { line: raw[index].trim() },
                    ),
                );
            }
        }
    }

    private checkWeakRefObserverHygiene(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        if (!file.includes('registry') && !file.includes('manager') && !file.includes('bus'))
            return;
        for (let index = 0; index < masked.length; index += 1) {
            const line = masked[index];
            if (OBSERVER_APPEND_RE.test(line) && !hasWeakRefCall(line)) {
                out.push(
                    makeIssue(
                        file,
                        index,
                        'GDM-WEAK-001',
                        SEVERITY_WARNING,
                        'Dynamic observer registry holds strong reference to Node instance without `weakref`.',
                        'Store `weakref(node)` and verify `.get_ref() != null` before dispatching updates.',
                        { line: raw[index].trim() },
                    ),
                );
            }
        }
    }

    private isViewFile(file: string): boolean {
        return /(?:^|\/)views\//.test(file);
    }

    private checkResponsiveLayoutDiscipline(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        if (!this.isViewFile(file)) return;
        for (let index = 0; index < masked.length; index += 1) {
            const line = masked[index];
            if (
                /\b(?:size|custom_minimum_size)\s*=\s*Vector2\s*\(\s*(?:1920|2560|3840|1280)\s*,\s*(?:1080|1440|2160|720)\s*\)/.test(
                    line,
                )
            ) {
                out.push(
                    makeIssue(
                        file,
                        index,
                        'GDM-RES-001',
                        SEVERITY_WARNING,
                        'Hardcoded absolute screen resolution in view layout breaks responsive multi-aspect scaling.',
                        'Use Anchors Preset (`set_anchors_preset(PRESET_FULL_RECT)`) and adaptive container layout.',
                        { line: raw[index].trim() },
                    ),
                );
            }
        }
    }

    private checkUnidirectionalFlowIntegrity(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        if (!this.isViewFile(file)) return;
        for (let index = 0; index < masked.length; index += 1) {
            const line = masked[index];
            if (
                /\b(?:snapshot|dto|_snapshot|_dto)\s*\.\s*(?:hp|mp|gold|score|level|exp|status|currency)\s*(?:=|\+=|-=|\*=)/.test(
                    line,
                )
            ) {
                out.push(
                    makeIssue(
                        file,
                        index,
                        'GDM-UNI-001',
                        SEVERITY_WARNING,
                        'In-place mutation of immutable Snapshot DTO field violates unidirectional data flow.',
                        'Dispatch an intention Command or call domain boundary service instead of modifying snapshot directly.',
                        { line: raw[index].trim() },
                    ),
                );
            }
        }
    }

    private checkViewLocBudget(_masked: string[], raw: string[], file: string, out: Issue[]): void {
        if (!this.isViewFile(file)) return;
        if (raw.length > 450) {
            out.push(
                makeIssue(
                    file,
                    0,
                    'GDM-LOC-001',
                    SEVERITY_WARNING,
                    'Presentation view script exceeds physical line budget limit of 450 LOC.',
                    'Decompose complex subpanels, item renderers, or companion controllers into separate modules.',
                    { lineCount: raw.length },
                ),
            );
        }
    }

    private checkScreenBaseInheritance(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        if (!this.isViewFile(file)) return;
        for (let index = 0; index < masked.length; index += 1) {
            const line = masked[index];
            if (/^\s*extends\s+Control\b/.test(line)) {
                out.push(
                    makeIssue(
                        file,
                        index,
                        'GDM-EXT-001',
                        SEVERITY_WARNING,
                        'Presentation view controller directly extends Control instead of BaseScreen or BaseModal.',
                        'Extend BaseScreen for full-screen views or BaseModal for dialogs to integrate standard lifecycle.',
                        { line: raw[index].trim() },
                    ),
                );
            }
        }
    }

    private checkDesignTokenCompliance(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        if (!this.isViewFile(file)) return;
        for (let index = 0; index < masked.length; index += 1) {
            if (/\bColor\s*\(/.test(masked[index])) {
                out.push(
                    makeIssue(
                        file,
                        index,
                        'GDM-TOK-001',
                        SEVERITY_WARNING,
                        'Hardcoded Color(...) literal in presentation view violates DesignTokens single source of truth.',
                        'Use semantic color constants from DesignTokens (e.g., DesignTokens.COLOR_*).',
                        { line: raw[index].trim() },
                    ),
                );
            }
        }
    }

    private checkStatusBarComponentAdoption(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        if (!this.isViewFile(file)) return;
        for (let index = 0; index < masked.length; index += 1) {
            if (/\bProgressBar\.new\s*\(/.test(masked[index])) {
                out.push(
                    makeIssue(
                        file,
                        index,
                        'GDM-BAR-001',
                        SEVERITY_WARNING,
                        'Direct instantiation of bare ProgressBar violates KStatusBar standardized component contract.',
                        'Use KStatusBarClass.create_bar(...) or instantiate KStatusBar to ensure uniform styling and smooth tweens.',
                        { line: raw[index].trim() },
                    ),
                );
            }
        }
    }

    private checkVirtualListAdoption(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        if (!this.isViewFile(file)) return;
        for (let index = 0; index < masked.length; index += 1) {
            if (/\b(?:list|_list)\.add_child\s*\(\s*item\s*\)/.test(masked[index])) {
                out.push(
                    makeIssue(
                        file,
                        index,
                        'GDM-VRT-001',
                        SEVERITY_WARNING,
                        'Unbounded dynamic node instantiation in list container without KVirtualList recycling.',
                        'Use KVirtualList with object pooling to recycle list item nodes efficiently.',
                        { line: raw[index].trim() },
                    ),
                );
            }
        }
    }

    private checkI18nBindingDiscipline(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        if (!this.isViewFile(file)) return;
        for (let index = 0; index < masked.length; index += 1) {
            const rawLine = raw[index];
            if (/^\s*(?:title|heading|text|subtitle)\s*=\s*"[A-Z][A-Za-z0-9 ]{3,}"/.test(rawLine)) {
                out.push(
                    makeIssue(
                        file,
                        index,
                        'GDM-I18N-001',
                        SEVERITY_WARNING,
                        'Hardcoded user-facing string assigned directly without i18n localization wrapper.',
                        'Wrap UI text with tr("KEY") or bind through UIIntermediary for reactive locale switching.',
                        { line: rawLine.trim() },
                    ),
                );
            }
        }
    }

    private checkExplicitNodePathDiscipline(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        if (!this.isViewFile(file)) return;
        for (let index = 0; index < masked.length; index += 1) {
            if (/\b(?:get_parent\s*\(\s*\)|find_child\s*\()/.test(masked[index])) {
                out.push(
                    makeIssue(
                        file,
                        index,
                        'GDM-NOD-001',
                        SEVERITY_WARNING,
                        'Fragile relative node traversal (get_parent/find_child) breaks presentation encapsulation.',
                        'Use explicit %UniqueNode naming or typed dependency injection instead of relative path lookup.',
                        { line: raw[index].trim() },
                    ),
                );
            }
        }
    }

    private checkPresentationDecoupling(
        masked: string[],
        raw: string[],
        file: string,
        out: Issue[],
    ): void {
        if (!this.isViewFile(file)) return;
        for (let index = 0; index < masked.length; index += 1) {
            if (/\bGameState\.[A-Za-z0-9_]+\s*\(/.test(masked[index])) {
                out.push(
                    makeIssue(
                        file,
                        index,
                        'GDM-BND-001',
                        SEVERITY_WARNING,
                        'Presentation view directly couples to backend GameState singleton.',
                        'Consume data via BaseScreen.apply_snapshot() and emit UI intentions instead of mutating backend state.',
                        { line: raw[index].trim() },
                    ),
                );
            }
        }
    }
}
