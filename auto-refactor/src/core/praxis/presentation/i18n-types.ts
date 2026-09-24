/**
 * Module: Core Engine - Praxis Presentation Layer i18n Contracts
 * File Path: src/core/praxis/presentation/i18n-types.ts
 * Architecture Role: Define multi-language localization types and contracts for Praxis frontend cards;
 *   decouples UI language resolution from underlying static rule definitions.
 * Dependencies & Triggers: Pure contract declarations; consumed by i18n providers and presentation adapters.
 * Responsibilities: Declare locale identifiers, rule localization entries, common UI phrases,
 *   and the IPraxisI18nProvider SPI contract interface.
 * Exit Semantics & Design Rationale: Zero runtime dependencies; ensures clean typing for bilingual
 *   translation dictionaries and graceful fallback behavior.
 */

/** 支持的语言代码类型 */
export type PraxisLocale = 'zh-CN' | 'en' | string;

/** 单条规则的本地化展示条目 */
export interface PraxisRuleI18nEntry {
    /** 本地化规则短标题 (例如 "禁止硬编码敏感凭据" / "Hardcoded Secret Prohibited") */
    name: string;
    /** 本地化规则概要说明 */
    summary: string;
    /** 本地化修复指导建议 */
    remediation: string;
    /** 规则设计意图与理论依据（可选） */
    rationale?: string;
}

/** 前端卡片通用本地化短语字典 */
export interface PraxisCommonI18nStrings {
    /** 综合结论：全量通过 */
    verdictPass: string;
    /** 综合结论：存在警告 */
    verdictWarn: string;
    /** 综合结论：存在阻断项 */
    verdictBlock: string;
    /** 徽章文本：通过 */
    badgePass: string;
    /** 徽章文本：警告 */
    badgeWarn: string;
    /** 徽章文本：阻断 */
    badgeBlock: string;
    /** 徽章文本：提示 */
    badgeInfo: string;
    /** 行号前缀模板 (例如 "第 {0} 行" / "Line {0}") */
    linePrefix: string;
    /** 快速修复按钮或区域标签 (例如 "建议修复" / "Suggested Fix") */
    quickFixLabel: string;
    /** 规则文档超链接标签 (例如 "查看规则文档" / "Documentation") */
    docsLabel: string;
    /** 机器面 Token 节省统计文本模板 (例如 "Agent 提示 Token 压缩率: {0}%" / "Prompt Token Compression: {0}%") */
    tokenSavingsLabel: string;
    /** 规则分类默认标题 (例如 "通用规范" / "General Governance") */
    defaultCategoryTitle: string;
}

/** Praxis 本地化国际化提供者 SPI 契约 */
export interface IPraxisI18nProvider {
    /** 获取当前默认语言 */
    getLocale(): PraxisLocale;
    /** 设置当前默认语言 */
    setLocale(locale: PraxisLocale): void;
    /** 查询指定规则的本地化文本，支持指定目标语言（若缺省则使用默认语言） */
    getRuleText(ruleId: string, locale?: PraxisLocale): PraxisRuleI18nEntry | undefined;
    /** 获取通用 UI 词条表 */
    getCommonStrings(locale?: PraxisLocale): PraxisCommonI18nStrings;
    /** 动态注册或扩展第三方或插件规则的多语言字典条目 */
    registerRuleI18n(locale: PraxisLocale, entries: Record<string, Partial<PraxisRuleI18nEntry>>): void;
}
