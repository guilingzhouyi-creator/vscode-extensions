/**
 * Module: Dashboard Types (仪表盘共享类型与消息协议)
 * File Path: src/domain/dashboard-types.ts
 * Architecture Role: 领域模型层与展示层（Webview/面板）的跨边界数据契约，规范聚合数据结构与双向消息通信协议。
 * Dependencies & Triggers: 依赖 daily-aggregator 与 weekly-aggregator 类型；由 TimerEngine、DashboardProvider、Webview 交互触发。
 * Responsibilities: 声明柱状图、热力图单元格、周趋势图等前端渲染模型；声明 DashboardData 全景展示快照；定义 DashboardMessage 消息联合。
 * Exit Semantics & Design Rationale: 纯 TypeScript 类型定义与重导出，无运行时开销；通过单向分层依赖保障展示层与应用层解耦。
 */

/**
 * 契约模型：柱状图每日工时渲染条目 (DailyChartEntry)
 * 不变量契约：所有工时字段均以物理量纲非负毫秒 (*Ms) 表达，保证数值守恒与时间确定性。
 */
export interface DailyChartEntry {
    /** 契约标签：显示日期，如 "06-10" */
    label: string;
    /** 契约标签：本地星期显示，如 "一" */
    weekday: string;
    /** 契约时长：当日总工时毫秒数 (>= 0) */
    totalMs: number;
    /** 契约时长：当日手动编码毫秒数 (>= 0) */
    manualMs?: number;
    /** 契约时长：当日 AI 辅助毫秒数 (>= 0) */
    aiMs?: number;
    /** 契约占比：当日手动编码占比百分比 (0~100) */
    manualRatio?: number;
    /** 契约占比：当日 AI 辅助占比百分比 (0~100) */
    aiRatio?: number;
}

/**
 * 契约模型：周报趋势多周条目 (WeeklyTrendEntry)
 * 设计依据：按周切分工时汇总，周起始严格对齐本地自然周一 (Monday 00:00:00)。
 */
export interface WeeklyTrendEntry {
    /** 契约范围：周起始日期 YYYY-MM-DD（周一） */
    weekStart: string;
    /** 契约范围：周截止日期 YYYY-MM-DD（周日） */
    weekEnd: string;
    /** 契约标签：区间显示标签，如 "06-10 ~ 06-16" */
    label: string;
    /** 契约时长：本周累计工时 (ms) */
    totalMs: number;
    /** 契约计数：本周有效会话总数 */
    sessionCount: number;
}

import type { DailyDetail } from './aggregator/daily-aggregator';
import type { WeeklySummary } from './aggregator/weekly-aggregator';

export type { DailyDetail, WeeklySummary };

/**
 * 契约模型：活动时间线热力图矩阵单元格 (HeatmapDay)
 * 不变量契约：level 在 0~4 之间按分位数单调递增，future 标记未来自然日。
 */
export interface HeatmapDay {
    /** 契约日期：完整日期 YYYY-MM-DD */
    dateStr: string;
    /** 契约索引：星期索引 0=周一 … 6=周日 */
    weekday: number;
    /** 契约时长：当日累计工时毫秒数 */
    totalMs: number;
    /** 契约分级：着色深度等级 0~4（0 为无工时底色） */
    level: 0 | 1 | 2 | 3 | 4;
    /** 边界标记：是否为未来尚未到来的日期 */
    future: boolean;
}

/**
 * 架构契约：面板全量展示 DTO 快照模型 (DashboardData Snapshot)
 * 设计依据：封装 Webview 所需的只读展示数据与可变配置项，保证单向数据流与界面渲染纯粹性。
 */
export interface DashboardData {
    totalMs: number;
    todayMs: number;
    sessionsCount: number;
    /** 今日手动编码时长 (ms) */
    manualTodayMs?: number;
    /** 今日 AI 辅助时长 (ms) */
    aiTodayMs?: number;
    /** 今日空闲/离开时长 (ms) */
    idleTodayMs?: number;
    /** 累计手动总时长 (ms) */
    manualTotalMs?: number;
    /** 累计 AI 总时长 (ms) */
    aiTotalMs?: number;
    /** 累计空闲离开总时长 (ms) */
    idleTotalMs?: number;
    /** 最近 7 天每日数据，用于柱状图 */
    dailyStats: DailyChartEntry[];
    /** 活动时间线热力图（近 12 周，按日） */
    heatmap: HeatmapDay[];
    /** 本周合计 (ms) */
    weekTotalMs: number;
    /** 周报多周趋势（近 4 周） */
    weeklyTrend: WeeklyTrendEntry[];
    /** 周报文字摘要 */
    weeklySummary: WeeklySummary | null;
    /** 今日会话明细 */
    todayDetail: DailyDetail | null;
    /** 跨工作区累计 */
    globalTotalMs: number;
    /** 工作区数量 */
    workspaceCount: number;
    /** 各工作区列表 */
    workspaceList: Array<{ name: string; totalMs: number }>;
    isEnabled: boolean;
    globalDisabled: boolean;
    /** 界面语言（auto=跟随 VS Code 显示语言） */
    locale: 'auto' | 'zh-CN' | 'en';
    statusBarEnabled: boolean;
    journalEnabled: boolean;
    backupToFile: boolean;
    ringBufferCapacity: number;
    journalFlushIntervalMs: number;
    fullSaveIntervalMs: number;
    maxSessions: number;
    /** 原始会话保留天数（超出自动折叠入日统计） */
    historyRawRetentionDays: number;
    /** 危险操作前是否自动生成安全快照 */
    safetySnapshot: boolean;
    /** 周工作时长上限开关 */
    weeklyLimitEnabled: boolean;
    /** 周工作时长上限（小时） */
    weeklyLimitHours: number;
    /** 空闲超时判定分钟数 */
    idleTimeoutMinutes?: number;
    /** 是否启用 AI 协作改动检测 */
    aiDetectionEnabled?: boolean;
    /** AI 协作冷却秒数 */
    aiCooldownSeconds?: number;
    /** 是否启用图表双轨堆叠与对比显示 */
    chartDualTrackDisplay?: boolean;
}

/**
 * 协议契约：Webview 与扩展宿主双向 postMessage 通信消息联合 (DashboardMessage)
 * 不变量契约：所有消息类型均携带不可变鉴别属性 type，通过模式匹配进行类型安全派发。
 */
export type DashboardMessage =
    | { type: 'updateConfig'; payload: Partial<DashboardData> }
    | { type: 'newPeriod' }
    | { type: 'reset' }
    | { type: 'clearHistory' }
    | { type: 'exportCSV' }
    | { type: 'exportAggregated' }
    | { type: 'exportReport'; payload: { kind: 'daily' | 'weekly' } };
