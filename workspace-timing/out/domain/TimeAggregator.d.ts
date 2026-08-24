/**
 * TimeAggregator — 时间聚合器
 *
 * 职责：对 TimeSlice[] 进行统计聚合
 * 边界：纯计算，不关心数据来源和存储
 * 依赖：仅依赖 models.ts
 */
import { TimeSlice, TimeSession, WorkspaceTimingData } from './models';
/** 按日聚合统计 */
export interface DailyStats {
    date: string;
    totalMs: number;
    sessionCount: number;
}
/** 按周聚合统计 */
export interface WeeklyStats {
    weekStart: string;
    totalMs: number;
    sessionCount: number;
}
/** 单日会话明细 */
export interface DailySessionEntry {
    /** 会话开始时间戳 */
    startMs: number;
    /** 会话结束时间戳 */
    endMs: number;
    /** 会话时长 (ms) */
    durationMs: number;
    /** 开始时间 HH:mm */
    startLabel: string;
    /** 结束时间 HH:mm */
    endLabel: string;
}
/** 按小时分布（每日 24 小时桶） */
export interface HourlyBucket {
    /** 小时 0~23 */
    hour: number;
    /** 该小时内累计时长 (ms) */
    totalMs: number;
    /** 该小时内会话数 */
    sessionCount: number;
}
/** 单日明细报告 */
export interface DailyDetail {
    /** 日期 YYYY-MM-DD */
    date: string;
    /** 当日累计时长 (ms) */
    totalMs: number;
    /** 当日会话数 */
    sessionCount: number;
    /** 会话列表 */
    sessions: DailySessionEntry[];
    /** 按小时分布（非零桶） */
    hourly: HourlyBucket[];
    /** 最活跃时段（小时，-1 表示无数据） */
    peakHour: number;
    /** 活跃时段描述，如 "09:00-11:00" */
    activeWindow: string;
}
/** 周报文字摘要 */
export interface WeeklySummary {
    /** 周起始日期 YYYY-MM-DD（周一） */
    weekStart: string;
    /** 本周累计时长 (ms) */
    totalMs: number;
    /** 本周会话数 */
    sessionCount: number;
    /** 日均时长 (ms) */
    avgDailyMs: number;
    /** 本周最活跃日期 YYYY-MM-DD */
    peakDate: string;
    /** 最活跃日期时长 (ms) */
    peakDateMs: number;
    /** 活跃天数（有计时的天数） */
    activeDays: number;
}
export declare class TimeAggregator {
    /**
     * 今天的本地日期字符串 (YYYY-MM-DD)
     */
    static todayStr(): string;
    /**
     * 将会话区间 [startMs, endMs) 按**本地自然日**切分为若干段，
     * 对每一段调用 fn(日期字符串, 段开始, 段结束)。
     *
     * 这是跨午夜统计口径的唯一实现：23:30→次日 00:30 的会话会被拆为
     * 「当天 30 分钟 + 次日 30 分钟」，保证日报/周报归属正确。
     * 使用 Date(y, m, d+1) 归一化，天然兼容 DST。
     */
    private static eachDaySegment;
    /**
     * 将区间 [startMs, endMs) 按**本地自然日**切分为 TimeSession 片段。
     * 供崩溃恢复把「进行中会话」落成按日粒度的历史记录，保证恢复后
     * 日报/周报口径与正常运行一致（跨午夜自动拆分）。
     */
    static splitByNaturalDay(startMs: number, endMs: number): TimeSession[];
    /** 时间戳所在自然日的周一日期字符串（本地时区） */
    private static weekKeyOf;
    /**
     * 将 TimeSlice 数组累加为总时长 (ms)
     */
    static sumSlices(slices: TimeSlice[]): number;
    /**
     * 将 journal 中的 TimeSlice 合并到 WorkspaceTimingData
     */
    static mergeJournal(data: WorkspaceTimingData, slices: TimeSlice[]): void;
    /**
     * 计算今日累计时长 (ms)
     * = 今日会话片段的总和（跨午夜会话按自然日切分）+ 当前活跃会话今日已历时
     *
     * @param sessions 历史会话列表
     * @param currentSessionStartMs 当前活跃会话开始时间，0 表示无活跃会话
     */
    static todayMs(sessions: TimeSession[], currentSessionStartMs: number): number;
    /**
     * 按日聚合会话列表（跨午夜会话按自然日切分归桶）
     */
    static dailyStats(sessions: TimeSession[]): DailyStats[];
    /**
     * 按周聚合会话列表（跨午夜/跨周日界的会话按切分后的片段归属）
     */
    static weeklyStats(sessions: TimeSession[]): WeeklyStats[];
    /**
     * 最近 7 天每日统计（用于柱状图）
     *
     * @param sessions 历史会话列表
     * @param currentSessionStartMs 当前活跃会话开始时间
     * @returns 最近 7 天的 DailyChartEntry 数组，按日期升序
     */
    static last7Days(sessions: TimeSession[], currentSessionStartMs: number): {
        label: string;
        weekday: string;
        totalMs: number;
    }[];
    /** 格式化时间戳为 HH:mm（本地时区） */
    private static formatTime;
    /**
     * 将区间 [startMs, endMs) 按小时切分并累加到 hourMap。
     * 会话时长归属到实际经过的小时桶，而不是整段记到开始小时。
     * sessionCount 只在会话触及的第一个小时内 +1。
     */
    private static addToHourly;
    /**
     * 获取指定日期的会话明细
     *
     * 跨午夜会话会在当日视图中被"裁剪"到该日的部分：
     * 昨日 23:30→今日 00:30 的会话，在昨日明细中显示 23:30–23:59(30m)，
     * 在今日明细中显示 00:00–00:30(30m)，时长与日累计口径一致。
     */
    static dailyDetail(sessions: TimeSession[], dateStr: string, currentSessionStartMs?: number): DailyDetail;
    /** 计算时间戳所在周的起始日（周一）本地日期字符串 */
    private static weekStartStr;
    /** 近 N 周按周聚合趋势（含当前周，降序） */
    static weeklyTrend(sessions: TimeSession[], weeks?: number): WeeklyStats[];
    /** 周报文字摘要 */
    static weeklySummary(sessions: TimeSession[], currentSessionStartMs?: number): WeeklySummary;
    /**
     * 格式化毫秒为人类可读字符串
     * @example formatDuration(3661000) => "1h 1m 1s"
     */
    static formatDuration(ms: number): string;
    /**
     * 紧凑格式：只显示最显著的单位
     * @example formatDurationCompact(3661000) => "1h 1m"
     * @example formatDurationCompact(60000) => "1m 0s"
     */
    static formatDurationCompact(ms: number): string;
    /**
     * 双段格式：今日 + 累计
     * @example formatDual(1800000, 7200000) => "今日 30m · 累计 2h"
     */
    static formatDual(todayMs: number, totalMs: number): string;
}
