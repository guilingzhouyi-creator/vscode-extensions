/**
 * Module: Dashboard Types (仪表盘共享类型与消息协议)
 * File Path: src/domain/dashboard-types.ts
 * Architecture Role: 领域模型层与展示层（Webview/面板）的跨边界数据契约，规范聚合数据结构与双向消息通信协议。
 * Dependencies & Triggers: 依赖 daily-aggregator 与 weekly-aggregator 类型；由 TimerEngine、DashboardProvider、Webview 交互触发。
 * Responsibilities: 声明柱状图、热力图单元格、周趋势图等前端渲染模型；声明 DashboardData 全景展示快照；定义 DashboardMessage 消息联合。
 * Exit Semantics & Design Rationale: 纯 TypeScript 类型定义与重导出，无运行时开销；通过单向分层依赖保障展示层与应用层解耦。
 */

/** 柱状图每日一条 */
export interface DailyChartEntry {
    /** 显示标签，如 "06-10" */
    label: string;
    /** 星期，如 "一" */
    weekday: string;
    /** 当日毫秒数 */
    totalMs: number;
    /** 当日手动编码毫秒数 */
    manualMs?: number;
    /** 当日 AI 辅助毫秒数 */
    aiMs?: number;
}

/** 周报趋势一条（每周） */
export interface WeeklyTrendEntry {
    /** 周起始日期 YYYY-MM-DD（周一） */
    weekStart: string;
    /** 周截止日期 YYYY-MM-DD（周日） */
    weekEnd: string;
    /** 显示标签，如 "06-10 ~ 06-16" */
    label: string;
    /** 本周时长 (ms) */
    totalMs: number;
    /** 本周会话数 */
    sessionCount: number;
}

import type { DailyDetail } from './aggregator/daily-aggregator';
import type { WeeklySummary } from './aggregator/weekly-aggregator';

export type { DailyDetail, WeeklySummary };

/** 热力图单个格子（活动时间线） */
export interface HeatmapDay {
    /** 完整日期 YYYY-MM-DD */
    dateStr: string;
    /** 星期索引：0=周一 … 6=周日 */
    weekday: number;
    /** 当日累计毫秒 */
    totalMs: number;
    /** 着色等级 0~4（0=无记录） */
    level: 0 | 1 | 2 | 3 | 4;
    /** 是否为未来日期（当前周尚未到达的天） */
    future: boolean;
}

/** 面板展示数据 */
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
}

/** 面板消息协议 */
export type DashboardMessage =
    | { type: 'updateConfig'; payload: Partial<DashboardData> }
    | { type: 'newPeriod' }
    | { type: 'reset' }
    | { type: 'clearHistory' }
    | { type: 'exportCSV' }
    | { type: 'exportAggregated' }
    | { type: 'exportReport'; payload: { kind: 'daily' | 'weekly' } };
