/**
 * Module: Core Engine - Praxis Presentation Layer i18n Contracts
 * File Path: src/core/praxis/presentation/i18n-types.ts
 * Architecture Role: Define localization types and contracts for Praxis frontend cards;
 *   decouples UI language resolution from underlying static rule definitions.
 * Dependencies & Triggers: Pure contracts; consumed by i18n providers and presentation adapters.
 * Responsibilities: Declare locale identifiers, rule localization entries, common UI phrases,
 *   and the IPraxisI18nProvider SPI contract interface.
 * Exit Semantics & Design Rationale: Zero runtime dependencies; ensures clean typing for bilingual
 *   translation dictionaries and graceful fallback behavior.
 */

/** Supported locale identifier types */
export type PraxisLocale = 'zh-CN' | 'en' | string;

/** Localized presentation entry for a single rule */
export interface PraxisRuleI18nEntry {
    /** Localized short rule title (e.g., "Hardcoded Secret Prohibited") */
    name: string;
    /** Localized rule summary and explanation */
    summary: string;
    /** Localized remediation guidance */
    remediation: string;
    /** Rule design intent and theoretical rationale (optional) */
    rationale?: string;
}

/** Common localized phrases for UI diagnostic cards */
export interface PraxisCommonI18nStrings {
    /** Overall verdict text: All Pass */
    verdictPass: string;
    /** Overall verdict text: Warnings Present */
    verdictWarn: string;
    /** Overall verdict text: Blockers Present */
    verdictBlock: string;
    /** Badge label: Pass */
    badgePass: string;
    /** Badge label: Warning */
    badgeWarn: string;
    /** Badge label: Block */
    badgeBlock: string;
    /** Badge label: Info */
    badgeInfo: string;
    /** Line prefix template (e.g., "Line {0}") */
    linePrefix: string;
    /** Quick fix action label (e.g., "Suggested Fix") */
    quickFixLabel: string;
    /** Documentation link label (e.g., "Documentation") */
    docsLabel: string;
    /** Machine token compression savings label (e.g., "Prompt Token Compression: {0}%") */
    tokenSavingsLabel: string;
    /** Default category title (e.g., "General Governance") */
    defaultCategoryTitle: string;
}

/** Praxis internationalization provider SPI contract */
export interface IPraxisI18nProvider {
    /** Gets current default locale */
    getLocale(): PraxisLocale;
    /** Sets current default locale */
    setLocale(locale: PraxisLocale): void;
    /** Resolves localized rule text for given rule and optional locale */
    getRuleText(ruleId: string, locale?: PraxisLocale): PraxisRuleI18nEntry | undefined;
    /** Retrieves common UI dictionary phrases */
    getCommonStrings(locale?: PraxisLocale): PraxisCommonI18nStrings;
    /** Dynamically registers or extends third-party or plugin rule translations */
    registerRuleI18n(
        locale: PraxisLocale,
        entries: Record<string, Partial<PraxisRuleI18nEntry>>,
    ): void;
}
