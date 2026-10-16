/**
 * Module: Core Engine — Client Exposure & Build Hygiene Diagnostic Messages
 * File Path: src/core/messages/exposure.ts
 * Architecture Role: Declarative single source of user-facing diagnostic text and severities
 *   for client exposure risks, build hygiene, and frontend UI engineering rules.
 * Dependencies & Triggers: Imports DiagnosticDescriptor from ./types and each entry is checked by
 *   `as const satisfies DiagnosticDescriptor`; read by frontend, hygiene, and exposure analyzers.
 * Responsibilities: Supply message, suggestion, rationale, and risk for client exposure, build
 *   hygiene, and frontend architecture governance rules.
 * Exit Semantics & Design Rationale: Plain frozen constants with no functions; lookups are
 *   side-effect free and allocation-free.
 */

import type { DiagnosticDescriptor } from './types';

/**
 * Frozen registry of diagnostic text for exposure, hygiene, and frontend rules.
 */
export const ExposureMessages = {
    /** SEC-EXP-001: Internal or administrative API endpoints exposed to client bundles. */
    INTERNAL_API_EXPOSED: {
        message: 'Internal or administrative API endpoint exposed in client-facing bundle',
        suggestion:
            'Move administrative and internal operations behind a secure backend gateway proxy',
        rationale:
            'Exposing internal or privileged API paths in client code reveals attack surface.',
        risk: 'High',
    } as const satisfies DiagnosticDescriptor,

    /** SEC-EXP-002: Frontend visual or CSS concealment used instead of real authorization. */
    CLIENT_CSS_AUTH_BYPASS: {
        message: 'Frontend element hiding or button disabling used as sole authorization guard',
        suggestion:
            'Enforce authorization checks on backend APIs and avoid rendering privileged components',
        rationale:
            'CSS display:none or disabled attributes are easily bypassed in client DOM trees.',
        risk: 'High',
    } as const satisfies DiagnosticDescriptor,

    /** SEC-EXP-003: Inactive feature flags still bundling full privileged code. */
    DISABLED_FLAG_LEAKAGE: {
        message: 'Disabled feature flag still delivers full implementation code to client bundle',
        suggestion:
            'Use build-time dead-code elimination or dynamic import code splitting for flags',
        rationale:
            'Bundling disabled or preview code allows reverse engineering and unauthorized bypass.',
        risk: 'Medium',
    } as const satisfies DiagnosticDescriptor,

    /** SEC-EXP-004: Unreleased or test routes packaged into production builds. */
    UNRELEASED_ROUTE_EXPOSED: {
        message: 'Unreleased, debug, or internal staging route packaged into production router',
        suggestion:
            'Gate test and unreleased routes with environment flags or separate test builds',
        rationale: 'Test routes in production can lead to unexpected exposure and data leaks.',
        risk: 'High',
    } as const satisfies DiagnosticDescriptor,

    /**
     * SEC-EXP-005: Iframe/webview message handler lacks
     * event.userActivation or origin verification.
     */
    IFRAME_SYNTHETIC_USER_ACTIVATION: {
        message:
            'Cross-window message listener executes sensitive action without event.userActivation or origin verification',
        suggestion:
            'Verify event.userActivation.isActive or validate event.origin against a strict whitelist before performing sensitive operations',
        rationale:
            'Untrusted iframes or synthetic postMessage events can trigger unauthorized downloads, popups, or state mutation without user intent.',
        risk: 'High',
    } as const satisfies DiagnosticDescriptor,

    /** PROD-HYG-001: Debugging statements, TODO markers, or internal paths in production. */
    PROD_DEBUG_RESIDUE: {
        message:
            'Production build artifact contains debug logging, pending markers, or absolute paths',
        suggestion:
            'Strip console statements, TODOs, and internal paths during the production build step',
        rationale:
            'Production artifacts should be clean of diagnostic logs and internal workstation paths.',
        risk: 'Medium',
    } as const satisfies DiagnosticDescriptor,

    /** PROD-HYG-002: Source map files or mapping URLs exposed in production output. */
    PROD_SOURCE_MAP_LEAK: {
        message: 'Production build exposes source map references or unmapped original source files',
        suggestion:
            'Upload source maps to private crash-reporting tools instead of public deployments',
        rationale:
            'Public source maps reveal full original source code, secrets, and comments to clients.',
        risk: 'High',
    } as const satisfies DiagnosticDescriptor,

    /** PROD-HYG-003: Backend secret environment variables leaked into client code. */
    PROD_ENV_SECRET_LEAK: {
        message: 'Sensitive backend environment variable referenced in client-facing bundle',
        suggestion:
            'Prefix client variables with public namespaces and keep private secrets on server',
        rationale:
            'Embedding backend secrets in client bundles allows credential extraction by users.',
        risk: 'Critical',
    } as const satisfies DiagnosticDescriptor,

    /** UI-ENG-001: HTML semantic structure and accessibility violations. */
    UI_A11Y_SEMANTIC: {
        message:
            'Frontend component contains missing accessibility attributes or poor HTML semantics',
        suggestion:
            'Provide alt attributes for images, accessible labels for inputs, and valid ARIA roles',
        rationale:
            'Accessible markup is essential for screen readers and keyboard navigation compliance.',
        risk: 'Low',
    } as const satisfies DiagnosticDescriptor,

    /** UI-ENG-002: Excessive DOM nesting depth or reflow-triggering CSS transitions. */
    UI_DOM_DEPTH_REFLOW: {
        message: 'Deeply nested DOM structure or layout-reflowing CSS animation property detected',
        suggestion:
            'Flatten DOM hierarchy and use composite properties (transform, opacity) for animations',
        rationale:
            'Deep DOM trees and reflow properties trigger layout thrashing and lower frame rates.',
        risk: 'Medium',
    } as const satisfies DiagnosticDescriptor,

    /** UI-ENG-003: Bloated God components or duplicate DOM templates. */
    UI_COMPONENT_REUSE: {
        message:
            'Component shows excessive props footprint or repetitive DOM structure requiring reuse',
        suggestion:
            'Decompose into focused micro-components with clear single responsibility boundaries',
        rationale:
            'God components with excessive props create high maintenance burden and fragility.',
        risk: 'Low',
    } as const satisfies DiagnosticDescriptor,

    /** UI-ENG-004: Frontend hook or event handler naming convention violations. */
    UI_NAMING_STATE: {
        message: 'Frontend hook or event handler violates standard prefix conventions',
        suggestion:
            'Prefix custom hooks with "use" and event handler functions with "on" or "handle"',
        rationale:
            'Consistent naming conventions clarify component lifecycle and event dispatch boundaries.',
        risk: 'Low',
    } as const satisfies DiagnosticDescriptor,

    /** UI-ENG-005: Missing CJK IME composition interlock guard on Enter submission. */
    UI_IME_COMPOSITION_GUARD: {
        message: 'Enter key submission handler lacks CJK IME composition interlock guard',
        suggestion:
            'Add !(e.nativeEvent.isComposing || e.keyCode === 229) guard before handling Enter submission',
        rationale:
            'Un-guarded Enter key listeners prematurely trigger submission while users select IME candidate words.',
        risk: 'Medium',
    } as const satisfies DiagnosticDescriptor,

    /** UI-ENG-006: Dynamic timer, counter or metric display lacks tabular numbers font locking. */
    UI_TABULAR_NUMERICS: {
        message: 'Dynamic timer, timestamp, or counter display lacks tabular-nums font locking',
        suggestion:
            'Apply font-variant-numeric: tabular-nums or font-feature-settings: "tnum" to prevent text jitter',
        rationale:
            'Proportional figures cause character widths to fluctuate as numbers change, triggering horizontal jitter.',
        risk: 'Low',
    } as const satisfies DiagnosticDescriptor,

    /** UI-ENG-007: Nested closed border inside bordered container entity. */
    UI_SINGLE_BORDER_DISCIPLINE: {
        message:
            'Nested closed border detected inside bordered container entity violating single-stroke enclosure',
        suggestion:
            'Demote child controls inside bordered containers to ghost hover states or surface contrast fills',
        rationale:
            'Russian-doll nested borders generate unnecessary visual noise and heavy cognitive load.',
        risk: 'Low',
    } as const satisfies DiagnosticDescriptor,

    /**
     * UI-ENG-008: Component-scoped @media misuse or CJK text
     * squashing without anti-squash properties.
     */
    UI_CONTAINER_QUERY_ANTI_SQUASH: {
        message:
            'Local component uses global viewport @media instead of @container, or text container lacks anti-squash wrapping properties',
        suggestion:
            'Use @container queries for component-scoped responsive layout, and apply text-wrap: balance or overflow-wrap: break-word to prevent CJK vertical character collapse',
        rationale:
            'Local components embedded in webviews or cards must respond to container width rather than viewport, and CJK text requires wrapping safeguards against single-glyph squashing.',
        risk: 'Medium',
    } as const satisfies DiagnosticDescriptor,
};
