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
export declare class TimeAggregator {
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
     * = 今日已结束会话的总和 + 当前活跃会话已历时
     *
     * @param sessions 历史会话列表（含今日已结束的会话）
     * @param currentSessionStartMs 当前活跃会话开始时间，0 表示无活跃会话
     */
    static todayMs(sessions: TimeSession[], currentSessionStartMs: number): number;
    /**
     * 按日聚合会话列表
     */
    static dailyStats(sessions: TimeSession[]): DailyStats[];
    /**
     * 按周聚合会话列表
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
