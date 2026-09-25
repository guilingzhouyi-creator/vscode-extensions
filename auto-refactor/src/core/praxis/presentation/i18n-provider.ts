/**
 * Module: Core Engine - Praxis Presentation i18n Provider
 * File Path: src/core/praxis/presentation/i18n-provider.ts
 * Architecture Role: Concrete localization provider supporting bilingual dictionaries
 *   and automatic fallback to canonical engine rule registry metadata.
 * Dependencies & Triggers: Consumes i18n-types and getRule from rules/registry; consumed by
 *   PraxisPresentationAdapter and frontend components.
 * Responsibilities: Resolve localized rule titles, descriptions, and common UI strings;
 *   support dynamic registration of extension rules; handle locale normalization.
 * Exit Semantics & Design Rationale: Never throws; falls back to English, Chinese, or
 *   canonical rule definition so frontend never displays empty cards.
 */

import { getRule } from '../../rules/registry';
import { EN_COMMON, EN_RULES } from './dictionaries/en';
import { ZH_CN_COMMON, ZH_CN_RULES } from './dictionaries/zh-cn';
import type {
    IPraxisI18nProvider,
    PraxisCommonI18nStrings,
    PraxisLocale,
    PraxisRuleI18nEntry,
} from './i18n-types';

/**
 * Normalizes input locale string to canonical tag.
 *
 * @param locale - Input locale code (e.g., 'zh-cn', 'zh-CN', 'en-US')
 * @returns Normalized language tag ('zh-CN' | 'en')
 */
export function normalizeLocale(locale?: string): 'zh-CN' | 'en' {
    if (!locale) {
        return 'zh-CN';
    }
    const lower = locale.toLowerCase().trim();
    if (lower.startsWith('zh')) {
        return 'zh-CN';
    }
    return 'en';
}

/** Concrete Praxis presentation i18n provider implementation */
export class PraxisI18nProvider implements IPraxisI18nProvider {
    private currentLocale: 'zh-CN' | 'en' = 'zh-CN';
    private customRules: Map<string, Map<string, Partial<PraxisRuleI18nEntry>>> = new Map();

    public constructor(initialLocale: PraxisLocale = 'zh-CN') {
        this.currentLocale = normalizeLocale(initialLocale);
    }

    /**
     * Gets currently active default locale.
     *
     * @returns Current normalized locale tag
     */
    public getLocale(): PraxisLocale {
        return this.currentLocale;
    }

    /**
     * Sets currently active default locale.
     *
     * @param locale - Target locale
     */
    public setLocale(locale: PraxisLocale): void {
        this.currentLocale = normalizeLocale(locale);
    }

    /**
     * Looks up localized presentation entry with graceful degradation fallback.
     *
     * @param ruleId - Rule ID (e.g., 'SEC-VUL-001')
     * @param targetLocale - Optional target locale (defaults to current locale)
     * @returns Matching localized entry or degraded fallback entry
     */
    public getRuleText(
        ruleId: string,
        targetLocale?: PraxisLocale,
    ): PraxisRuleI18nEntry | undefined {
        const locale = normalizeLocale(targetLocale ?? this.currentLocale);

        // 1. Query dynamically registered custom dictionary first
        const customForLocale = this.customRules.get(locale);
        if (customForLocale && customForLocale.has(ruleId)) {
            const custom = customForLocale.get(ruleId)!;
            const fallback = this.resolveStaticDictionary(ruleId, locale);
            return {
                name: custom.name ?? fallback?.name ?? ruleId,
                summary: custom.summary ?? fallback?.summary ?? '',
                remediation: custom.remediation ?? fallback?.remediation ?? '',
                rationale: custom.rationale ?? fallback?.rationale,
            };
        }

        // 2. Query built-in static multi-language dictionaries
        const staticEntry = this.resolveStaticDictionary(ruleId, locale);
        if (staticEntry) {
            return staticEntry;
        }

        // 3. Graceful fallback: fall back to core RULE_REGISTRY metadata
        const canonical = getRule(ruleId);
        if (canonical) {
            return {
                name: ruleId,
                summary: canonical.summary,
                remediation: canonical.remediation,
            };
        }

        return undefined;
    }

    /**
     * Retrieves common UI strings table.
     *
     * @param targetLocale - Optional target locale
     * @returns Common UI strings dictionary
     */
    public getCommonStrings(targetLocale?: PraxisLocale): PraxisCommonI18nStrings {
        const locale = normalizeLocale(targetLocale ?? this.currentLocale);
        return locale === 'zh-CN' ? ZH_CN_COMMON : EN_COMMON;
    }

    /**
     * Dynamically registers extension or plugin rule translations.
     *
     * @param locale - Locale code
     * @param entries - Rule entry mapping table
     */
    public registerRuleI18n(
        locale: PraxisLocale,
        entries: Record<string, Partial<PraxisRuleI18nEntry>>,
    ): void {
        const normalized = normalizeLocale(locale);
        let localeMap = this.customRules.get(normalized);
        if (!localeMap) {
            localeMap = new Map();
            this.customRules.set(normalized, localeMap);
        }
        for (const [id, entry] of Object.entries(entries)) {
            const existing = localeMap.get(id) ?? {};
            localeMap.set(id, { ...existing, ...entry });
        }
    }

    private resolveStaticDictionary(
        ruleId: string,
        locale: 'zh-CN' | 'en',
    ): PraxisRuleI18nEntry | undefined {
        if (locale === 'zh-CN') {
            return ZH_CN_RULES[ruleId] ?? EN_RULES[ruleId];
        }
        return EN_RULES[ruleId] ?? ZH_CN_RULES[ruleId];
    }
}

/** Default global Praxis i18n provider singleton instance */
export const defaultPraxisI18nProvider = new PraxisI18nProvider('zh-CN');

/**
 * Creates an independent Praxis i18n provider instance.
 *
 * @param initialLocale - Initial locale (defaults to 'zh-CN')
 * @returns Independent IPraxisI18nProvider instance
 */
export function createPraxisI18nProvider(
    initialLocale: PraxisLocale = 'zh-CN',
): IPraxisI18nProvider {
    return new PraxisI18nProvider(initialLocale);
}
