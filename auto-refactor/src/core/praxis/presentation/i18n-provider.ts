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
 * 规范化语言标识符
 *
 * @param locale - 输入的语言代码 (如 'zh-cn', 'zh-CN', 'en-US')
 * @returns 标准化的语言标签 ('zh-CN' | 'en')
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

/** Praxis 呈现层 i18n 提供者实现类 */
export class PraxisI18nProvider implements IPraxisI18nProvider {
    private currentLocale: 'zh-CN' | 'en' = 'zh-CN';
    private customRules: Map<string, Map<string, Partial<PraxisRuleI18nEntry>>> = new Map();

    public constructor(initialLocale: PraxisLocale = 'zh-CN') {
        this.currentLocale = normalizeLocale(initialLocale);
    }

    /**
     * 获取当前默认语言
     *
     * @returns 当前生效的规范化语言标签
     */
    public getLocale(): PraxisLocale {
        return this.currentLocale;
    }

    /**
     * 设置当前默认语言
     *
     * @param locale - 目标语言
     */
    public setLocale(locale: PraxisLocale): void {
        this.currentLocale = normalizeLocale(locale);
    }

    /**
     * 查询规则的本地化展示条目，包含优雅降级逻辑
     *
     * @param ruleId - 规则编号 (如 'SEC-CST-001')
     * @param targetLocale - 可选的目标语言，默认取当前生效语言
     * @returns 匹配的本地化条目，或降级构建的条目
     */
    public getRuleText(ruleId: string, targetLocale?: PraxisLocale): PraxisRuleI18nEntry | undefined {
        const locale = normalizeLocale(targetLocale ?? this.currentLocale);

        // 1. 优先查动态扩展字典
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

        // 2. 查内置静态多语言字典
        const staticEntry = this.resolveStaticDictionary(ruleId, locale);
        if (staticEntry) {
            return staticEntry;
        }

        // 3. 优雅降级：直接回退到底层 RULE_REGISTRY 元数据
        const canonical = getRule(ruleId);
        if (canonical) {
            return {
                name: ruleId,
                summary: canonical.summary,
                remediation: canonical.remediation,
                rationale: canonical.rationale,
            };
        }

        return undefined;
    }

    /**
     * 获取通用短语表
     *
     * @param targetLocale - 可选的目标语言
     * @returns 通用短语表
     */
    public getCommonStrings(targetLocale?: PraxisLocale): PraxisCommonI18nStrings {
        const locale = normalizeLocale(targetLocale ?? this.currentLocale);
        return locale === 'zh-CN' ? ZH_CN_COMMON : EN_COMMON;
    }

    /**
     * 动态注册第三方或插件规则的多语言条目
     *
     * @param locale - 语言代码
     * @param entries - 规则条目映射表
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

    private resolveStaticDictionary(ruleId: string, locale: 'zh-CN' | 'en'): PraxisRuleI18nEntry | undefined {
        if (locale === 'zh-CN') {
            return ZH_CN_RULES[ruleId] ?? EN_RULES[ruleId];
        }
        return EN_RULES[ruleId] ?? ZH_CN_RULES[ruleId];
    }
}

/** 默认全局 Praxis i18n 提供者单例 */
export const defaultPraxisI18nProvider = new PraxisI18nProvider('zh-CN');

/**
 * 创建独立的 Praxis i18n 提供者实例
 *
 * @param initialLocale - 初始语言，默认为 'zh-CN'
 * @returns 独立的 IPraxisI18nProvider 实例
 */
export function createPraxisI18nProvider(initialLocale: PraxisLocale = 'zh-CN'): IPraxisI18nProvider {
    return new PraxisI18nProvider(initialLocale);
}
