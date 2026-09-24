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
import type { PraxisSliceAuditInput, PraxisSliceAuditVerdict } from '../router/sliceTypes';
import type { IPraxisI18nProvider, PraxisLocale } from './i18n-types';

/** 前端卡片严重级别 */
export type PraxisPresentationSeverity = 'block' | 'warn' | 'info' | 'pass';

/** 前端视觉语义色彩 */
export type PraxisBadgeColor = 'red' | 'yellow' | 'blue' | 'green';

/** 单个面向前端界面的结构化诊断卡片 */
export interface PraxisDiagnosticCard {
    /** 卡片唯一 ID (形如 "file:line:rule") */
    id: string;
    /** 规则编号 (如 SEC-CST-001) */
    ruleId: string;
    /** 前端严重级别映射 */
    severity: PraxisPresentationSeverity;
    /** 本地化视觉徽章文案 (如 "[阻断]" / "[BLOCK]") */
    badgeText: string;
    /** 视觉色彩映射，便于直接绑定前端 CSS 类 */
    badgeColor: PraxisBadgeColor;
    /** 目标文件名或相对路径 */
    file: string;
    /** 目标行号 */
    line: number;
    /** 目标列号 (可选) */
    column?: number;
    /** 本地化规则短标题 */
    title: string;
    /** 本地化规则概要与上下文信息 */
    message: string;
    /** 本地化修复指导意见 */
    remediation: string;
    /** 建议修复代码片段或操作提示 (可选) */
    quickFixSnippet?: string;
    /** 规则设计规约或说明文档跳转 URL (可选) */
    docsUrl?: string;
    /** 底层对应的 Agent CAPP 指令原文 (一体两面同源回溯) */
    sourceAgentDirective: string;
}

/** 呈现层聚合统计指标 */
export interface PraxisPresentationMetrics {
    /** 诊断指令总数 */
    totalDirectives: number;
    /** 阻断级卡片数 */
    blockCount: number;
    /** 警告级卡片数 */
    warnCount: number;
    /** 提示级卡片数 */
    infoCount: number;
    /** 底层机器面 Token 压缩节省率 (0.00 ~ 1.00) */
    tokenSavingsRatio: number;
}

/** 交付给 Praxis 前端的完整展示载荷 */
export interface PraxisPresentationPayload {
    /** 目标切片范围或路径 (如 "src/cache.ts#L240") */
    target: string;
    /** 综合审查裁决 */
    overallVerdict: 'PASS' | 'WARN' | 'BLOCK';
    /** 当前生效的语言标识 */
    locale: PraxisLocale;
    /** 本地化综合结论摘要 */
    summaryText: string;
    /** 呈现层统计指标 */
    metrics: PraxisPresentationMetrics;
    /** 前端诊断卡片列表 */
    cards: PraxisDiagnosticCard[];
    /** 挂载的底层原始 Agent CAPP 提示载荷 (一体两面) */
    rawAgentPrompt: CompactAgentPrompt;
}

/** 前端转换配置选项 */
export interface PraxisPresentationOptions {
    /** 目标语言偏好 (默认为 'zh-CN') */
    locale?: PraxisLocale;
    /** 是否包含快速修复代码片段 (默认为 true) */
    includeQuickFix?: boolean;
    /** 规则文档基路径 (如 "https://rules.praxis.internal/rules/") */
    docsBaseUrl?: string;
}

/** Praxis 呈现转换与集成服务 SPI 契约 */
export interface IPraxisPresentationService {
    /**
     * 将面向 Agent 的 CAPP 紧凑提示转换为前端展示载荷
     *
     * @param agentPrompt - 底层生成的 CompactAgentPrompt
     * @param options - 呈现选项
     * @returns 面向前端的富展示载荷
     */
    toPresentation(
        agentPrompt: CompactAgentPrompt,
        options?: PraxisPresentationOptions,
    ): PraxisPresentationPayload;

    /**
     * 将底层切片审计结果直接转换为前端展示载荷
     *
     * @param verdict - 底层切片审计裁决
     * @param target - 目标切片范围标识
     * @param options - 呈现选项
     * @returns 面向前端的富展示载荷
     */
    fromSliceVerdict(
        verdict: PraxisSliceAuditVerdict,
        target: string,
        options?: PraxisPresentationOptions,
    ): PraxisPresentationPayload;

    /**
     * 一体两面一站式审计与呈现：同时完成底层 AST 切片审计并输出前端展示载荷
     *
     * @param input - 切片审计输入
     * @param options - 呈现选项
     * @param callGraph - 可选的全局调用图
     * @returns 面向前端的富展示载荷（内含底层 CAPP）
     */
    auditAndPresent(
        input: PraxisSliceAuditInput,
        options?: PraxisPresentationOptions,
        callGraph?: CallGraph,
    ): Promise<PraxisPresentationPayload>;

    /**
     * 获取绑定的 i18n 多语言提供者
     *
     * @returns IPraxisI18nProvider 实例
     */
    getI18nProvider(): IPraxisI18nProvider;
}
