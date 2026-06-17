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
    date: string;        // "2026-06-16"
    totalMs: number;
    sessionCount: number;
}

/** 按周聚合统计 */
export interface WeeklyStats {
    weekStart: string;   // "2026-06-15" (周一)
    totalMs: number;
    sessionCount: number;
}

/**
 * 获取今天的日期字符串 (YYYY-MM-DD)
 */
function todayDateStr(): string {
    return new Date().toISOString().slice(0, 10);
}

export class TimeAggregator {
    /**
     * 将 TimeSlice 数组累加为总时长 (ms)
     */
    static sumSlices(slices: TimeSlice[]): number {
        return slices.reduce((sum, s) => sum + s.deltaMs, 0);
    }

    /**
     * 将 journal 中的 TimeSlice 合并到 WorkspaceTimingData
     */
    static mergeJournal(data: WorkspaceTimingData, slices: TimeSlice[]): void {
        const totalDelta = TimeAggregator.sumSlices(slices);
        data.totalMs += totalDelta;
    }

    /**
     * 计算今日累计时长 (ms)
     * = 今日已结束会话的总和 + 当前活跃会话已历时
     *
     * @param sessions 历史会话列表（含今日已结束的会话）
     * @param currentSessionStartMs 当前活跃会话开始时间，0 表示无活跃会话
     */
    static todayMs(sessions: TimeSession[], currentSessionStartMs: number): number {
        const today = todayDateStr();
        let total = 0;

        // 今日已结束的会话
        for (const s of sessions) {
            const date = new Date(s.startMs).toISOString().slice(0, 10);
            if (date === today) {
                total += s.durationMs;
            }
        }

        // 当前活跃会话（如果是从今天开始的）
        if (currentSessionStartMs > 0) {
            const sessionDate = new Date(currentSessionStartMs).toISOString().slice(0, 10);
            if (sessionDate === today) {
                total += Date.now() - currentSessionStartMs;
            }
        }

        return total;
    }

    /**
     * 按日聚合会话列表
     */
    static dailyStats(sessions: TimeSession[]): DailyStats[] {
        const map = new Map<string, { totalMs: number; count: number }>();

        for (const s of sessions) {
            const date = new Date(s.startMs).toISOString().slice(0, 10); // "2026-06-16"
            const entry = map.get(date) ?? { totalMs: 0, count: 0 };
            entry.totalMs += s.durationMs;
            entry.count++;
            map.set(date, entry);
        }

        return Array.from(map.entries())
            .map(([date, v]) => ({ date, totalMs: v.totalMs, sessionCount: v.count }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    /**
     * 按周聚合会话列表
     */
    static weeklyStats(sessions: TimeSession[]): WeeklyStats[] {
        const map = new Map<string, { totalMs: number; count: number }>();

        for (const s of sessions) {
            const d = new Date(s.startMs);
            // 计算周一日期
            const day = d.getDay();
            const diff = day === 0 ? -6 : 1 - day; // 周日特殊处理
            const monday = new Date(d);
            monday.setDate(d.getDate() + diff);
            const weekStart = monday.toISOString().slice(0, 10);

            const entry = map.get(weekStart) ?? { totalMs: 0, count: 0 };
            entry.totalMs += s.durationMs;
            entry.count++;
            map.set(weekStart, entry);
        }

        return Array.from(map.entries())
            .map(([weekStart, v]) => ({ weekStart, totalMs: v.totalMs, sessionCount: v.count }))
            .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    }

    /**
     * 最近 7 天每日统计（用于柱状图）
     *
     * @param sessions 历史会话列表
     * @param currentSessionStartMs 当前活跃会话开始时间
     * @returns 最近 7 天的 DailyChartEntry 数组，按日期升序
     */
    static last7Days(
        sessions: TimeSession[],
        currentSessionStartMs: number,
    ): { label: string; weekday: string; totalMs: number }[] {
        const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
        const today = new Date();
        const result: { label: string; weekday: string; totalMs: number }[] = [];

        // 生成本周各日期的 dateStr
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const dateStr = d.toISOString().slice(0, 10);
            const label = dateStr.slice(5); // "06-16"
            const weekday = weekdayNames[d.getDay()];
            let totalMs = 0;

            // 累加当日已结束会话
            for (const s of sessions) {
                const sDate = new Date(s.startMs).toISOString().slice(0, 10);
                if (sDate === dateStr) {
                    totalMs += s.durationMs;
                }
            }

            // 累加当前活跃会话（如果是今天开始的）
            if (dateStr === today.toISOString().slice(0, 10) && currentSessionStartMs > 0) {
                totalMs += Date.now() - currentSessionStartMs;
            }

            result.push({ label, weekday, totalMs });
        }

        return result;
    }

    /**
     * 格式化毫秒为人类可读字符串
     * @example formatDuration(3661000) => "1h 1m 1s"
     */
    static formatDuration(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const parts: string[] = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        parts.push(`${seconds}s`);

        return parts.join(' ');
    }

    /**
     * 紧凑格式：只显示最显著的单位
     * @example formatDurationCompact(3661000) => "1h 1m"
     * @example formatDurationCompact(60000) => "1m 0s"
     */
    static formatDurationCompact(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) return `${hours}h ${minutes}m`;
        if (minutes > 0) return `${minutes}m ${seconds}s`;
        return `${seconds}s`;
    }

    /**
     * 双段格式：今日 + 累计
     * @example formatDual(1800000, 7200000) => "今日 30m · 累计 2h"
     */
    static formatDual(todayMs: number, totalMs: number): string {
        return `今日 ${TimeAggregator.formatDurationCompact(todayMs)} · 累计 ${TimeAggregator.formatDurationCompact(totalMs)}`;
    }
}
