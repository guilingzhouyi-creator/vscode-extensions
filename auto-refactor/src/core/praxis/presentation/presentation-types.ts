/**
 * Module: Core Engine - Praxis Presentation Layer Types
 * File Path: src/core/praxis/presentation/presentation-types.ts
 * Architecture Role: Presentation contracts and UI diagnostic card models designed
 *   specifically for Praxis frontend consumers, IDE webviews, and human reviewers.
 * Dependencies & Triggers: Consumes CompactAgentPrompt and CAPP directives from guidance;
 *   consumed by PraxisPresentationAdapter and public API surface.
 * Responsibilities: Declare UI-friendly diagnostic card interfaces, presentation payload
 *   aggregations, presentation options, and the IPraxisPresentationService contract.
 * Exit Semantics & Design Rationale: Fully typed presentation layer; bridges machine-oriented
 *   CAPP prompt tokens to rich human-oriented UI cards with zero semantic loss.
 */

import type { CallGraph } from '../../intelligence/callGraph';
import type { CompactAgentPrompt } from '../../guidance/agentConstraintGenerator';
import type { PraxisSliceAuditInput, PraxisSliceAuditVerdict } from '../../router/sliceTypes';
import type { IPraxisI18nProvider, PraxisLocale } from './i18n-types';

/** Diagnostic severity level for presentation card */
export type PraxisPresentationSeverity = 'block' | 'warn' | 'info' | 'pass';

/** Visual badge semantic color */
export type PraxisBadgeColor = 'red' | 'yellow' | 'blue' | 'green';

/** Individual structured diagnostic card for UI rendering */
export interface PraxisDiagnosticCard {
    /** Unique card ID (e.g., "file:line:rule") */
    id: string;
    /** Canonical rule identifier (e.g., SEC-VUL-001) */
    ruleId: string;
    /** Mapped presentation severity level */
    severity: PraxisPresentationSeverity;
    /** Localized visual badge label (e.g., "[BLOCK]" or "[阻断]") */
    badgeText: string;
    /** Semantic color mapping for frontend CSS binding */
    badgeColor: PraxisBadgeColor;
    /** Target file relative path */
    file: string;
    /** Target line number */
    line: number;
    /** Target column number (optional) */
    column?: number;
    /** Localized short rule title */
    title: string;
    /** Localized diagnostic message and context */
    message: string;
    /** Localized remediation guidance */
    remediation: string;
    /** Suggested quick fix code snippet or instruction (optional) */
    quickFixSnippet?: string;
    /** Documentation URL link (optional) */
    docsUrl?: string;
    /** Underlying machine-oriented CAPP directive for bidirectional traceability */
    sourceAgentDirective: string;
}

/** Aggregated presentation metrics */
export interface PraxisPresentationMetrics {
    /** Total number of diagnostic directives */
    totalDirectives: number;
    /** Number of blocking cards */
    blockCount: number;
    /** Number of warning cards */
    warnCount: number;
    /** Number of info cards */
    infoCount: number;
    /** Underlying machine token compression savings ratio (0.00 ~ 1.00) */
    tokenSavingsRatio: number;
}

/** Complete presentation payload delivered to Praxis UI */
export interface PraxisPresentationPayload {
    /** Target slice scope or path (e.g., "src/cache.ts#L240") */
    target: string;
    /** Overall review verdict */
    overallVerdict: 'PASS' | 'WARN' | 'BLOCK';
    /** Currently active locale identifier */
    locale: PraxisLocale;
    /** Localized overall verdict summary text */
    summaryText: string;
    /** Presentation layer aggregate metrics */
    metrics: PraxisPresentationMetrics;
    /** List of diagnostic cards for display */
    cards: PraxisDiagnosticCard[];
    /** Underlying raw Agent CAPP prompt payload (dual-faceted architecture) */
    rawAgentPrompt: CompactAgentPrompt;
}

/** Configuration options for presentation rendering */
export interface PraxisPresentationOptions {
    /** Preferred target locale (defaults to 'zh-CN') */
    locale?: PraxisLocale;
    /** Whether to include quick-fix snippets (defaults to true) */
    includeQuickFix?: boolean;
    /** Base URL for rule documentation links */
    docsBaseUrl?: string;
}

/** Praxis presentation service SPI contract */
export interface IPraxisPresentationService {
    /**
     * Converts machine-oriented CAPP compact prompt to rich UI presentation payload.
     *
     * @param agentPrompt - Underlying CompactAgentPrompt
     * @param options - Presentation options
     * @returns Rich UI presentation payload
     */
    toPresentation(
        agentPrompt: CompactAgentPrompt,
        options?: PraxisPresentationOptions,
    ): PraxisPresentationPayload;

    /**
     * Converts raw slice audit verdict to rich UI presentation payload.
     *
     * @param verdict - Underlying slice audit verdict
     * @param target - Target slice scope identifier
     * @param options - Presentation options
     * @returns Rich UI presentation payload
     */
    fromSliceVerdict(
        verdict: PraxisSliceAuditVerdict,
        target: string,
        options?: PraxisPresentationOptions,
    ): PraxisPresentationPayload;

    /**
     * Dual-faceted all-in-one audit and presentation pipeline.
     *
     * @param input - Slice audit input
     * @param options - Presentation options
     * @param callGraph - Optional global call graph
     * @returns Rich UI presentation payload containing underlying CAPP
     */
    auditAndPresent(
        input: PraxisSliceAuditInput,
        options?: PraxisPresentationOptions,
        callGraph?: CallGraph,
    ): Promise<PraxisPresentationPayload>;

    /**
     * Returns the bound internationalization provider.
     *
     * @returns IPraxisI18nProvider instance
     */
    getI18nProvider(): IPraxisI18nProvider;
}
