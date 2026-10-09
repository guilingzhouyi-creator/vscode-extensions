/**
 * Module: Core Rules — Frontend, Production Hygiene & Exposure Rule Entries
 * File Path: src/core/rules/entries/analyzers-modern-frontend.ts
 * Architecture Role: Modular rule catalog for frontend engineering, production build hygiene,
 *   and client exposure risk rules.
 * Dependencies & Triggers: ../types; consumed by analyzers-modern facade.
 * Responsibilities: Export rule definitions for UI, PROD, and client exposure rules.
 * Exit Semantics & Design Rationale: Immutable rule catalog array; zero runtime side-effects.
 */

import {
    ALL_LANGUAGES,
    defineRule,
    SEVERITY_INFO,
    SEVERITY_WARNING,
    SEVERITY_ERROR,
    RULE_FAMILY_UI,
    RULE_FAMILY_PRODUCTION,
    RULE_FAMILY_SECURITY,
} from '../types';
import type { RuleDefinition } from '../types';

/**
 * Helper to define frontend UI engineering rules.
 */
function defineUiRule(
    id: string,
    defaultSeverity: typeof SEVERITY_INFO | typeof SEVERITY_WARNING,
    summary: string,
    remediation: string,
    docsAnchor: string,
): RuleDefinition {
    return defineRule({
        id,
        family: RULE_FAMILY_UI,
        analyzer: 'frontend',
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity,
        summary,
        remediation,
        docsAnchor: `docs/04-analyzers-and-rules/01-builtin-rules.md#${docsAnchor}`,
    });
}

/**
 * Helper to define production hygiene rules.
 */
function defineProdHygieneRule(
    id: string,
    defaultSeverity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR,
    summary: string,
    remediation: string,
    docsAnchor: string,
): RuleDefinition {
    return defineRule({
        id,
        family: RULE_FAMILY_PRODUCTION,
        analyzer: 'production-hygiene',
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity,
        summary,
        remediation,
        docsAnchor: `docs/04-analyzers-and-rules/01-builtin-rules.md#${docsAnchor}`,
    });
}

/**
 * Helper to define client exposure security rules.
 */
function defineExposureRule(
    id: string,
    defaultSeverity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR,
    summary: string,
    remediation: string,
    docsAnchor: string,
): RuleDefinition {
    return defineRule({
        id,
        family: RULE_FAMILY_SECURITY,
        analyzer: 'client-exposure',
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity,
        summary,
        remediation,
        docsAnchor: `docs/04-analyzers-and-rules/01-builtin-rules.md#${docsAnchor}`,
    });
}

/**
 * Array of modern frontend, production hygiene, and client exposure rule definitions.
 */
export const ANALYZER_MODERN_FRONTEND_RULES: readonly RuleDefinition[] = [
    // ── Production Hygiene Rules (PROD-HYG) ───────────────────────────────────
    defineProdHygieneRule(
        'PROD-HYG-001',
        SEVERITY_ERROR,
        'Production build output must not contain console debug statements, TODO markers, or local absolute paths',
        'Configure build bundler minification to strip console logs, comments, and rewrite source paths',
        'prod-hyg-001',
    ),
    defineProdHygieneRule(
        'PROD-HYG-002',
        SEVERITY_ERROR,
        'Production build must not expose source map files or sourceMappingURL directives to clients',
        'Disable public source map generation or publish maps exclusively to private crash reporting systems',
        'prod-hyg-002',
    ),
    defineProdHygieneRule(
        'PROD-HYG-003',
        SEVERITY_ERROR,
        'Sensitive backend environment variable references must not leak into client-facing bundles',
        'Ensure secret tokens and database credentials are kept strictly on server and not bundled',
        'prod-hyg-003',
    ),

    // ── Client Exposure Risk Rules (SEC-EXP) ──────────────────────────────────
    defineExposureRule(
        'SEC-EXP-001',
        SEVERITY_ERROR,
        'Internal, administrative, or unauthenticated backend endpoints must not be exposed in client code',
        'Proxy sensitive administrative routes through a hardened backend gateway and remove internal paths',
        'sec-exp-001',
    ),
    defineExposureRule(
        'SEC-EXP-002',
        SEVERITY_ERROR,
        'Visual hiding (display:none) or UI disabling must not be used as sole authorization mechanism',
        'Enforce server-side role and permission validation on all sensitive operations and APIs',
        'sec-exp-002',
    ),
    defineExposureRule(
        'SEC-EXP-003',
        SEVERITY_WARNING,
        'Disabled feature flags must not bundle full implementation logic to client bundles',
        'Employ build-time code stripping or dynamic code splitting for unreleased feature flags',
        'sec-exp-003',
    ),
    defineExposureRule(
        'SEC-EXP-004',
        SEVERITY_ERROR,
        'Unreleased, experimental, or test preview routes must not be packaged into production routes',
        'Exclude development and staging routes from production bundles using build-time environment checks',
        'sec-exp-004',
    ),

    // ── Frontend Engineering Rules (UI-ENG) ───────────────────────────────────
    defineUiRule(
        'UI-ENG-001',
        SEVERITY_WARNING,
        'HTML semantic structure and accessibility attributes must be present on interactive elements',
        'Provide alt attributes for images, accessible labels for inputs, and explicit roles for custom controls',
        'ui-eng-001',
    ),
    defineUiRule(
        'UI-ENG-002',
        SEVERITY_WARNING,
        'DOM hierarchy nesting depth must not exceed 12 and CSS animations must avoid reflow properties',
        'Flatten DOM tree structure and use composite properties (transform, opacity) for transitions',
        'ui-eng-002',
    ),
    defineUiRule(
        'UI-ENG-003',
        SEVERITY_WARNING,
        'Component must not exceed 10 props or duplicate complex DOM subtrees without reuse',
        'Decompose large multi-purpose components into focused single-responsibility micro-components',
        'ui-eng-003',
    ),
    defineUiRule(
        'UI-ENG-004',
        SEVERITY_INFO,
        'Frontend hooks must start with "use" and event handler callbacks must start with "on" or "handle"',
        'Align hook identifiers with use* and event handler callbacks with handle* or on*',
        'ui-eng-004',
    ),
];
