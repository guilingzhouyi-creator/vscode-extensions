/**
 * DashboardDataAssembler — 面板 DTO 组装器（应用层纯函数）
 *
 * 职责：把计时器只读快照 + 配置 + 跨工作区快照组装为 DashboardData 视图模型。
 * 边界：纯组装，无 I/O、无状态；供导出与面板两条路径共用同一组装逻辑，
 *       消除 weeklyTrend 等字段的重复拼装。
 */

import {
    TimingConfig,
    ReadonlyTimingData,
    DailyTotalsMap,
    TimeSession,
    DEFAULT_RING_BUFFER_CAP,
    DEFAULT_JOURNAL_FLUSH_MS,
    MS_PER_MINUTE,
    DEFAULT_MAX_SESSIONS,
    DEFAULT_WEEKLY_LIMIT_HOURS,
    DEFAULT_RAW_RETENTION_DAYS,
} from '../domain/models';
import { TimeAggregator, WeeklySummary } from '../domain/TimeAggregator';
import { DashboardData, DailyDetail, WeeklyTrendEntry } from '../domain/dashboard-types';
import { DEFAULT_HEATMAP_WEEKS, DEFAULT_TREND_WEEKS, ISO_DATE_MD_START } from '../domain/constants-chart';
import { GlobalSnapshot } from './GlobalAggregator';

/** 入参聚合上下文：隔离外部对象直接传入，显式声明依赖字段 */
export interface AssembleContext {
    data: ReadonlyTimingData;
    currentTotalMs: number;
    todayMs: number;
    manualTodayMs?: number;
    aiTodayMs?: number;
    idleTodayMs?: number;
    manualTotalMs?: number;
    aiTotalMs?: number;
    idleTotalMs?: number;
    config: TimingConfig;
    global: GlobalSnapshot;
}

/**
 * 组装近 N 周趋势列表（纯函数，无 I/O）。
 * 从 TimeAggregator.weeklyTrend 获取原始周统计，映射为带紧凑日期范围 label 的 DTO：
 * label 取 "MM-DD ~ MM-DD" 紧凑区间。
 */
export function buildWeeklyTrendEntries(
    sessions: readonly TimeSession[],
    weeks: number,
    currentSessionStartMs: number,
    dailyTotals?: DailyTotalsMap,
): WeeklyTrendEntry[] {
    return TimeAggregator.weeklyTrend(sessions, weeks, currentSessionStartMs, dailyTotals).map((w) => ({
        weekStart: w.weekStart,
        weekEnd: w.weekEnd,
        label: `${w.weekStart.slice(ISO_DATE_MD_START)} ~ ${w.weekEnd.slice(ISO_DATE_MD_START)}`,
        totalMs: w.totalMs,
        sessionCount: w.sessionCount,
    }));
}

/** 构建今日会话明细（供面板展示；无会话返回 null） */
function buildTodayDetail(data: ReadonlyTimingData): DailyDetail | null {
    const detail = TimeAggregator.dailyDetail(
        data.sessions,
        TimeAggregator.todayStr(),
        data.currentSessionStartMs,
    );
    if (detail.sessions.length === 0) {
        return null;
    }
    return detail;
}

/**
 * 组装完整的 DashboardData 视图模型（纯函数，无状态，不触发任何副作用）。
 */
export function buildDashboardData(ctx: AssembleContext): DashboardData {
    const { data, currentTotalMs, todayMs, config, global } = ctx;

    const heatmap = TimeAggregator.heatmapDays(
        data.sessions,
        data.currentSessionStartMs,
        data.dailyTotals,
        DEFAULT_HEATMAP_WEEKS,
    );

    const weeklySummary: WeeklySummary = TimeAggregator.weeklySummary(
        data.sessions,
        data.currentSessionStartMs,
        data.dailyTotals,
    );

    const weeklyTrend = buildWeeklyTrendEntries(
        data.sessions,
        DEFAULT_TREND_WEEKS,
        data.currentSessionStartMs,
        data.dailyTotals,
    );

    const todayDetail = buildTodayDetail(data);

    // 面板会话数与当期有效会话严格对齐（已结束条目 + 进行中会话）
    const effectiveSessions = data.sessions.length + (data.currentSessionStartMs > 0 ? 1 : 0);

    return {
        totalMs: currentTotalMs,
        todayMs,
        manualTodayMs: ctx.manualTodayMs,
        aiTodayMs: ctx.aiTodayMs,
        idleTodayMs: ctx.idleTodayMs,
        manualTotalMs: ctx.manualTotalMs,
        aiTotalMs: ctx.aiTotalMs,
        idleTotalMs: ctx.idleTotalMs,
        sessionsCount: effectiveSessions,
        dailyStats: TimeAggregator.last7Days(
            data.sessions,
            data.currentSessionStartMs,
            config.locale === 'en' ? 'en' : 'zh-CN',
        ),
        heatmap,
        weekTotalMs: weeklySummary.totalMs,
        weeklyTrend,
        weeklySummary,
        todayDetail,
        globalTotalMs: global.totalMs,
        workspaceCount: global.workspaceCount,
        workspaceList: global.workspaces,
        isEnabled: config.enabled,
        globalDisabled: config.globalDisabled,
        locale: config.locale ?? 'auto',
        statusBarEnabled: config.statusBarEnabled,
        journalEnabled: config.journalEnabled ?? true,
        backupToFile: config.backupToFile ?? true,
        ringBufferCapacity: config.ringBufferCapacity ?? DEFAULT_RING_BUFFER_CAP,
        journalFlushIntervalMs: config.journalFlushIntervalMs ?? DEFAULT_JOURNAL_FLUSH_MS,
        fullSaveIntervalMs: config.fullSaveIntervalMs ?? MS_PER_MINUTE,
        maxSessions: config.maxSessions ?? DEFAULT_MAX_SESSIONS,
        historyRawRetentionDays: config.historyRawRetentionDays ?? DEFAULT_RAW_RETENTION_DAYS,
        safetySnapshot: config.safetySnapshot ?? true,
        weeklyLimitEnabled: config.weeklyLimitEnabled ?? false,
        weeklyLimitHours: config.weeklyLimitHours ?? DEFAULT_WEEKLY_LIMIT_HOURS,
        idleTimeoutMinutes: config.idleTimeoutMinutes,
        aiDetectionEnabled: config.aiDetectionEnabled,
        aiCooldownSeconds: config.aiCooldownSeconds,
    };
}
