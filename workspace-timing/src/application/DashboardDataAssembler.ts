/**
 * DashboardDataAssembler — 面板 DTO 组装器（应用层纯函数）
 *
 * 职责：把计时器只读快照 + 配置 + 跨工作区快照组装为 DashboardData 视图模型。
 * 边界：纯组装，无 I/O、无状态；此前该职责内联在 TimerOrchestrator.getDashboardData，
 *       抽出后导出（exportReport）与面板（getDashboardData）两条路径共用同一组装逻辑，
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
} from '../domain/models';
import { TimeAggregator, WeeklySummary } from '../domain/TimeAggregator';
import { DashboardData, WeeklyTrendEntry } from '../domain/dashboard-types';
import { DEFAULT_HEATMAP_WEEKS, DEFAULT_TREND_WEEKS, ISO_DATE_MD_START } from '../domain/constants-chart';
import { GlobalSnapshot } from './GlobalAggregator';

export interface DashboardDataAssembler {
    buildDashboardData: typeof buildDashboardData;
    buildWeeklyTrendEntries: typeof buildWeeklyTrendEntries;
}

/** 入参聚合上下文：隔离外部对象直接传入，显式声明依赖字段 */
export interface AssembleContext {
    data: ReadonlyTimingData;
    currentTotalMs: number;
    todayMs: number;
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
function buildTodayDetail(data: ReadonlyTimingData): DashboardData['todayDetail'] {
    const detail = TimeAggregator.dailyDetail(
        data.sessions,
        TimeAggregator.todayStr(),
        data.currentSessionStartMs,
    );
    if (detail.sessionCount === 0) return null;
    return {
        date: detail.date,
        totalMs: detail.totalMs,
        sessionCount: detail.sessionCount,
        sessions: detail.sessions.map((s) => ({
            startLabel: s.startLabel,
            endLabel: s.endLabel,
            durationMs: s.durationMs,
        })),
        hourly: detail.hourly.map((h) => ({
            hour: h.hour,
            totalMs: h.totalMs,
            sessionCount: h.sessionCount,
        })),
        peakHour: detail.peakHour,
        activeWindow: detail.activeWindow,
    };
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
        sessionsCount: effectiveSessions,
        dailyStats: TimeAggregator.last7Days(
            data.sessions,
            data.currentSessionStartMs,
            config.locale === 'en' ? 'en' : 'zh-CN',
        ),
        heatmap,
        weekTotalMs: weeklySummary.totalMs,
        weeklyTrend,
        weeklySummary: {
            totalMs: weeklySummary.totalMs,
            sessionCount: weeklySummary.sessionCount,
            avgDailyMs: weeklySummary.avgDailyMs,
            peakDate: weeklySummary.peakDate,
            peakDateMs: weeklySummary.peakDateMs,
            activeDays: weeklySummary.activeDays,
        },
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
        weeklyLimitEnabled: config.weeklyLimitEnabled ?? false,
        weeklyLimitHours: config.weeklyLimitHours ?? DEFAULT_WEEKLY_LIMIT_HOURS,
    };
}
