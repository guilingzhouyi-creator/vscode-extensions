/**
 * Module: Core Rules — GDScript Modern & Architecture Rule Entries
 * File Path: src/core/rules/entries/analyzers-modern-gdscript.ts
 * Architecture Role: Modular rule catalog for GDScript modernization, frontend architecture,
 *   and game domain rules.
 * Dependencies & Triggers: ../types, dimensionLiterals; consumed by analyzers-modern facade.
 * Responsibilities: Export rule definitions for GDScript rules within LOC budget (< 900 LOC).
 * Exit Semantics & Design Rationale: Immutable rule catalog array; zero runtime side-effects.
 */

import {
    defineRule,
    SEVERITY_WARNING,
    SEVERITY_ERROR,
    RULE_FAMILY_GDSCRIPT_MODERN,
    LANGUAGE_GDSCRIPT,
} from '../types';
import type { RuleDefinition } from '../types';

import { ANALYZER_GDSCRIPT_MODERN, ANALYZER_GDSCRIPT_GAME } from '../../scoring/dimensionLiterals';

/** Shared remediation level descriptor for GDScript rules. */
export const REMEDIATION_STANDARD_AND_ABOVE = '`standard` and above';

/**
 * Modern GDScript and game domain rule definitions.
 */
export const ANALYZER_MODERN_GDSCRIPT_RULES: readonly RuleDefinition[] = [
    defineRule({
        id: 'GDM-YIELD-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Legacy Godot 3 yield coroutine syntax detected.',
        remediation: 'Migrate to the modern Godot 4 await expression.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-yield-001',
    }),
    defineRule({
        id: 'GDM-EXPORT-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Legacy Godot 3 export statement detected.',
        remediation:
            'Use the @export annotation while preserving explicit static type declarations.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-export-001',
    }),
    defineRule({
        id: 'GDM-ONREADY-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Legacy onready keyword detected.',
        remediation: 'Migrate to the modern @onready annotation.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-onready-001',
    }),
    defineRule({
        id: 'GDM-TOOL-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Bare tool keyword detected.',
        remediation: 'Use the @tool annotation on the first line of the script.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-tool-001',
    }),
    defineRule({
        id: 'GDM-POOL-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Deprecated Pool*Array type detected.',
        remediation:
            'Migrate to the modern Packed*Array series (e.g., PackedStringArray, PackedByteArray).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-pool-001',
    }),
    defineRule({
        id: 'GDM-CONNECT-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Legacy Godot 3 signal connect signature passing method name as a string.',
        remediation: 'Use the modern signal connect(Callable) syntax.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-connect-001',
    }),
    defineRule({
        id: 'GDM-RPC-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Legacy remote/master/puppet/slave function modifiers detected.',
        remediation: 'Migrate to the modern @rpc annotation.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-rpc-001',
    }),
    defineRule({
        id: 'GDM-POOL-002',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Object pool reset_state does not invoke super.reset_state(), violating inheritance contract.',
        remediation:
            'Add super.reset_state() call inside reset_state() to ensure base state is properly cleaned up.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-pool-002',
    }),
    defineRule({
        id: 'GDM-DEB-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'High-frequency UI button directly connected to signal without debounce mechanism or loading state lock.',
        remediation:
            'Use KButton atomic component or connect to debounced_pressed signal to prevent repeated submissions.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-deb-001',
    }),
    defineRule({
        id: 'GDM-FSM-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'FSM private state variable mutated directly in-place, bypassing transition guards and lifecycle hooks.',
        remediation:
            'Trigger valid state transitions exclusively through fsm.transition_to(target_state, payload).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-fsm-001',
    }),
    defineRule({
        id: 'GDM-WEAK-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Dynamic observer or global manager holds strong reference to Node instance without weakref, risking memory leaks.',
        remediation:
            'Wrap registered nodes with weakref(node) and verify get_ref() is valid before dispatching events.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-weak-001',
    }),
    defineRule({
        id: 'GDM-RES-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'UI layout script hardcodes fixed resolutions or absolute pixel dimensions, breaking responsive multi-screen layout.',
        remediation:
            'Use Anchors Preset system, responsive containers, or DesignTokens relative scale references.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-res-001',
    }),
    defineRule({
        id: 'GDM-UNI-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Presentation view mutates read-only Snapshot DTO properties in-place, violating CQRS unidirectional data flow.',
        remediation:
            'Treat snapshots as immutable read-only data; request changes via Command intents or domain boundary services.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-uni-001',
    }),
    defineRule({
        id: 'GDM-LOC-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Presentation view script line count exceeds physical budget limit (LOC <= 450 lines).',
        remediation:
            'Decompose complex subcomponents, item renderers, data converters, or companion controllers into modular files.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-loc-001',
    }),
    defineRule({
        id: 'GDM-EXT-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Presentation main view controller does not inherit from BaseScreen or BaseModal base class.',
        remediation:
            'Inherit from BaseScreen (fullscreen) or BaseModal (popup) to bind to standard lifecycle and snapshot assembly contracts.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-ext-001',
    }),
    defineRule({
        id: 'GDM-TOK-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Presentation view hardcodes Color(...) literals or raw hex codes, breaking DesignTokens single source of truth.',
        remediation:
            'Reference semantic color constants from DesignTokens (e.g., DesignTokens.COLOR_*), ensuring consistent themes.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-tok-001',
    }),
    defineRule({
        id: 'GDM-BAR-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Presentation layer directly manipulates bare ProgressBar instance, bypassing KStatusBar standard animations.',
        remediation:
            'Use KStatusBar standard component to unify progress bar lifecycle, smooth tweening, and styling contracts.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-bar-001',
    }),
    defineRule({
        id: 'GDM-VRT-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Large list instances created all-at-once without KVirtualList virtualization and object pool reuse.',
        remediation:
            'Integrate KVirtualList container with object pooling (ADV-POOL-001); prohibit unbounded transient node instantiation.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-vrt-001',
    }),
    defineRule({
        id: 'GDM-I18N-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Presentation UI text hardcodes raw strings without UIIntermediary or i18n translation key binding.',
        remediation:
            'Bind UI text using tr(KEY) or via UIIntermediary for responsive internationalization.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-i18n-001',
    }),
    defineRule({
        id: 'GDM-NOD-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'View script contains drifting relative node paths (e.g., get_parent(), find_child(), or multi-tier indices).',
        remediation:
            'Reference nodes using explicit @onready %UniqueNode or typed dependency injection, avoiding brittle relative hierarchy navigation.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-nod-001',
    }),
    defineRule({
        id: 'GDM-BND-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_MODERN,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Presentation view directly couples with backend domain singletons or cross-layer global EventBus subscriptions.',
        remediation:
            'Receive data unidirectionally via BaseScreen.apply_snapshot(); dispatch user actions via explicit callbacks or UI intents.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-bnd-001',
    }),
    defineRule({
        id: 'GDM-PRF-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_GAME,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Transient heap allocation in loop or high-frequency execution path risks frame rate drops.',
        remediation:
            'Pre-allocate collections outside loops, use object pools, or reuse buffer instances.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-prf-001',
    }),
    defineRule({
        id: 'GDM-POL-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_GAME,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Pooled object does not implement or invoke reset_state contract upon acquisition or release.',
        remediation:
            'Implement reset_state() on pooled objects and ensure state is reset on acquire and release.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-pol-001',
    }),
    defineRule({
        id: 'GDM-SIG-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_GAME,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Signal connection lacks corresponding disconnect logic, causing dangling lifecycle leaks.',
        remediation:
            'Invoke disconnect() before lifecycle ends or use automatically managed signal connections.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-sig-001',
    }),
    defineRule({
        id: 'GDM-ISO-001',
        family: RULE_FAMILY_GDSCRIPT_MODERN,
        analyzer: ANALYZER_GDSCRIPT_GAME,
        canonical: true,
        languages: [LANGUAGE_GDSCRIPT],
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Headless domain logic layer directly references view layer or SceneTree nodes, breaking decoupled architecture.',
        remediation:
            'Decouple domain logic from presentation layer; communicate exclusively via data snapshots or pure state machines.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gdm-iso-001',
    }),
];
