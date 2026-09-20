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
import { DEFAULT_HEATMAP_WEEKS, DEFAULT_TREND_WEEKS } from '../domain/chartConstants';
import { GlobalSnapshot } from './GlobalAggregator';

/** 组装面板 DTO 所需的最小快照（由 Orchestrator 采集） */
export interface DashboardAssemblerInput {
    /** 计时器只读数据视图（含 sessions / dailyTotals / currentSessionStartMs） */
    data: ReadonlyTimingData;
    /** 当前累计总时长（含进行中会话） */
    currentTotalMs: number;
    /** 今日累计（SessionManager 3s TTL 缓存值） */
    todayMs: number;
    /** 当前配置快照 */
    config: Readonly<TimingConfig>;
    /** 跨工作区聚合快照 */
    global: GlobalSnapshot;
}

/**
 * 近 N 周趋势（面板与周报导出共用，消除两处重复拼装）。
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
        label: `${w.weekStart.slice(5)} ~ ${w.weekEnd.slice(5)}`,
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

/** 组装完整面板 DTO（纯函数，无副作用） */
export function buildDashboardData(input: DashboardAssemblerInput): DashboardData {
    const { data, config, global } = input;
    const sessions = data.sessions;

    // 本周合计（自然周一至今，含进行中会话与折叠层）
    const weeklySummary: WeeklySummary = TimeAggregator.weeklySummary(
        sessions,
        data.currentSessionStartMs,
        data.dailyTotals,
    );

    // 最近 7 天每日统计（柱状图，跟随界面语言）
    const locale = config.locale === 'en' ? 'en' : 'zh-CN';
    const dailyStats = TimeAggregator.last7Days(sessions, data.currentSessionStartMs, locale);

    // 活动时间线热力图（近 12 周，含本周；窗口化聚合，复用按日口径）
    const heatmap = TimeAggregator.heatmapDays(
        sessions,
        data.currentSessionStartMs,
        data.dailyTotals,
        DEFAULT_HEATMAP_WEEKS,
    );

    // 周报多周趋势（近 4 周）+ 今日明细
    const weeklyTrend = buildWeeklyTrendEntries(
        sessions,
        DEFAULT_TREND_WEEKS,
        data.currentSessionStartMs,
        data.dailyTotals,
    );
    const todayDetail = buildTodayDetail(data);

    const foldedSessionCount = Object.values(data.dailyTotals ?? {})
        .reduce((sum, b) => sum + (b.sessionCount || 0), 0);
    const currentSessionActive = data.currentSessionStartMs > 0 ? 1 : 0;
    const totalSessionsCount = foldedSessionCount + sessions.length + currentSessionActive;

    return {
        totalMs: input.currentTotalMs,
        todayMs: input.todayMs,
        // 会话数口径统一：折叠层会话数 + 未折叠原始会话数 + 进行中会话（1）
        sessionsCount: totalSessionsCount,
        dailyStats,
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
