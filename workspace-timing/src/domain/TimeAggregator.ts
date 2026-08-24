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

/**
 * 将时间戳格式化为**本地时区**日期字符串 (YYYY-MM-DD)。
 *
 * ⚠️ 全模块统一使用本地时区归桶，禁止使用 toISOString()（UTC）——
 * 否则 UTC+8 用户在早晨 8 点前的会话会被归到前一天。
 */
function localDateStr(ms: number): string {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** 解析 "YYYY-MM-DD" 为该日本地零点时间戳 */
function parseLocalDate(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
}

export class TimeAggregator {
    /**
     * 今天的本地日期字符串 (YYYY-MM-DD)
     */
    static todayStr(): string {
        return localDateStr(Date.now());
    }

    /**
     * 将会话区间 [startMs, endMs) 按**本地自然日**切分为若干段，
     * 对每一段调用 fn(日期字符串, 段开始, 段结束)。
     *
     * 这是跨午夜统计口径的唯一实现：23:30→次日 00:30 的会话会被拆为
     * 「当天 30 分钟 + 次日 30 分钟」，保证日报/周报归属正确。
     * 使用 Date(y, m, d+1) 归一化，天然兼容 DST。
     */
    private static eachDaySegment(
        startMs: number,
        endMs: number,
        fn: (date: string, segStartMs: number, segEndMs: number) => void,
    ): void {
        let cursor = startMs;
        while (cursor < endMs) {
            const d = new Date(cursor);
            const nextDayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
            const segEnd = Math.min(endMs, nextDayStart);
            fn(localDateStr(cursor), cursor, segEnd);
            cursor = segEnd;
        }
    }

    /** 时间戳所在自然日的周一日期字符串（本地时区） */
    private static weekKeyOf(ms: number): string {
        return TimeAggregator.weekStartStr(new Date(ms));
    }

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
     * = 今日会话片段的总和（跨午夜会话按自然日切分）+ 当前活跃会话今日已历时
     *
     * @param sessions 历史会话列表
     * @param currentSessionStartMs 当前活跃会话开始时间，0 表示无活跃会话
     */
    static todayMs(sessions: TimeSession[], currentSessionStartMs: number): number {
        const today = localDateStr(Date.now());
        let total = 0;

        for (const s of sessions) {
            TimeAggregator.eachDaySegment(s.startMs, s.endMs, (date, segStart, segEnd) => {
                if (date === today) total += segEnd - segStart;
            });
        }

        if (currentSessionStartMs > 0) {
            const now = Date.now();
            TimeAggregator.eachDaySegment(currentSessionStartMs, now, (date, segStart, segEnd) => {
                if (date === today) total += segEnd - segStart;
            });
        }

        return total;
    }

    /**
     * 按日聚合会话列表（跨午夜会话按自然日切分归桶）
     */
    static dailyStats(sessions: TimeSession[]): DailyStats[] {
        const map = new Map<string, { totalMs: number; count: number }>();

        for (const s of sessions) {
            let counted = false;
            TimeAggregator.eachDaySegment(s.startMs, s.endMs, (date, segStart, segEnd) => {
                const entry = map.get(date) ?? { totalMs: 0, count: 0 };
                entry.totalMs += segEnd - segStart;
                if (!counted) entry.count++;
                counted = true;
                map.set(date, entry);
            });
        }

        return Array.from(map.entries())
            .map(([date, v]) => ({ date, totalMs: v.totalMs, sessionCount: v.count }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    /**
     * 按周聚合会话列表（跨午夜/跨周日界的会话按切分后的片段归属）
     */
    static weeklyStats(sessions: TimeSession[]): WeeklyStats[] {
        const map = new Map<string, { totalMs: number; count: number }>();

        for (const s of sessions) {
            let counted = false;
            TimeAggregator.eachDaySegment(s.startMs, s.endMs, (_date, segStart, segEnd) => {
                const weekStart = TimeAggregator.weekKeyOf(segStart);
                const entry = map.get(weekStart) ?? { totalMs: 0, count: 0 };
                entry.totalMs += segEnd - segStart;
                if (!counted) entry.count++;
                counted = true;
                map.set(weekStart, entry);
            });
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

        // 预生成 7 天日期桶（本地日期，插入顺序即日期升序）
        const dayMap = new Map<string, { label: string; weekday: string; totalMs: number }>();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
            const dateStr = localDateStr(d.getTime());
            dayMap.set(dateStr, {
                label: dateStr.slice(5), // "06-16"
                weekday: weekdayNames[d.getDay()],
                totalMs: 0,
            });
        }

        // 单次遍历 sessions，按自然日切分片段后归入对应日期桶，复杂度 O(N)。
        // 跨午夜会话（如昨日 23:30→今日 00:30）的两段会分别计入两天的桶。
        for (const s of sessions) {
            TimeAggregator.eachDaySegment(s.startMs, s.endMs, (date, segStart, segEnd) => {
                const bucket = dayMap.get(date);
                if (bucket) bucket.totalMs += segEnd - segStart;
            });
        }

        // 当前活跃会话：切分后累加到今天的桶
        if (currentSessionStartMs > 0) {
            const now = Date.now();
            TimeAggregator.eachDaySegment(currentSessionStartMs, now, (date, segStart, segEnd) => {
                const bucket = dayMap.get(date);
                if (bucket) bucket.totalMs += segEnd - segStart;
            });
        }

        return Array.from(dayMap.values());
    }

    /** 格式化时间戳为 HH:mm（本地时区） */
    private static formatTime(ms: number): string {
        const d = new Date(ms);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
    }

    /**
     * 将区间 [startMs, endMs) 按小时切分并累加到 hourMap。
     * 会话时长归属到实际经过的小时桶，而不是整段记到开始小时。
     * sessionCount 只在会话触及的第一个小时内 +1。
     */
    private static addToHourly(
        hourMap: Map<number, { totalMs: number; count: number }>,
        startMs: number,
        endMs: number,
    ): void {
        let cursor = startMs;
        let first = true;
        while (cursor < endMs) {
            const d = new Date(cursor);
            const nextHourStart =
                new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
            const segEnd = Math.min(endMs, nextHourStart);
            const entry = hourMap.get(d.getHours()) ?? { totalMs: 0, count: 0 };
            entry.totalMs += segEnd - cursor;
            if (first) entry.count++;
            first = false;
            hourMap.set(d.getHours(), entry);
            cursor = segEnd;
        }
    }

    /**
     * 获取指定日期的会话明细
     *
     * 跨午夜会话会在当日视图中被"裁剪"到该日的部分：
     * 昨日 23:30→今日 00:30 的会话，在昨日明细中显示 23:30–23:59(30m)，
     * 在今日明细中显示 00:00–00:30(30m)，时长与日累计口径一致。
     */
    static dailyDetail(sessions: TimeSession[], dateStr: string, currentSessionStartMs = 0): DailyDetail {
        const dayStartMs = parseLocalDate(dateStr);
        const dayEndMs = parseLocalDate(localDateStr(dayStartMs + 24 * 3600_000));

        type ClippedEntry = DailySessionEntry & { isRunningTail: boolean };
        const entries: ClippedEntry[] = [];

        const clipToDay = (startMs: number, endMs: number, running: boolean): void => {
            if (startMs >= dayEndMs || endMs <= dayStartMs) return;
            const visStart = Math.max(startMs, dayStartMs);
            const visEnd = Math.min(endMs, dayEndMs);
            entries.push({
                startMs: visStart,
                endMs: visEnd,
                durationMs: visEnd - visStart,
                startLabel: TimeAggregator.formatTime(visStart),
                endLabel: running && visEnd >= Date.now() ? '进行中' : TimeAggregator.formatTime(visEnd),
                isRunningTail: running && visEnd >= Date.now(),
            });
        };

        for (const s of sessions) {
            clipToDay(s.startMs, s.endMs, false);
        }
        if (currentSessionStartMs > 0) {
            clipToDay(currentSessionStartMs, Date.now(), true);
        }

        // 按开始时间排序
        entries.sort((a, b) => a.startMs - b.startMs);

        // 按小时分布（跨小时会话按实际经过时间分摊）
        const hourMap = new Map<number, { totalMs: number; count: number }>();
        for (const e of entries) {
            TimeAggregator.addToHourly(hourMap, e.startMs, e.endMs);
        }
        const hourly: HourlyBucket[] = Array.from(hourMap.entries())
            .map(([hour, v]) => ({ hour, totalMs: v.totalMs, sessionCount: v.count }))
            .sort((a, b) => a.hour - b.hour);

        const totalMs = entries.reduce((sum, e) => sum + e.durationMs, 0);
        const peakHour = hourly.length > 0
            ? hourly.reduce((max, h) => (h.totalMs > max.totalMs ? h : max), hourly[0]).hour
            : -1;

        // 活跃时段：连续小时区间按**累计时长**最大者（而非跨度最长）
        let activeWindow = '';
        if (hourly.length > 0) {
            let bestStart = hourly[0].hour;
            let bestLen = 1;
            let bestSum = hourly[0].totalMs;
            let curStart = hourly[0].hour;
            let curLen = 1;
            let curSum = hourly[0].totalMs;
            for (let i = 1; i < hourly.length; i++) {
                if (hourly[i].hour === hourly[i - 1].hour + 1) {
                    curLen++;
                    curSum += hourly[i].totalMs;
                    if (curSum > bestSum) {
                        bestSum = curSum;
                        bestLen = curLen;
                        bestStart = curStart;
                    }
                } else {
                    curStart = hourly[i].hour;
                    curLen = 1;
                    curSum = hourly[i].totalMs;
                }
            }
            const endHour = bestStart + bestLen - 1;
            activeWindow = `${String(bestStart).padStart(2, '0')}:00-${String(endHour).padStart(2, '0')}:00`;
        }

        return {
            date: dateStr,
            totalMs,
            sessionCount: entries.length,
            sessions: entries.map(({ isRunningTail: _ignored, ...rest }) => rest),
            hourly,
            peakHour,
            activeWindow,
        };
    }

    /** 计算时间戳所在周的起始日（周一）本地日期字符串 */
    private static weekStartStr(d: Date): string {
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day; // 周日归上一周一
        const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
        return localDateStr(monday.getTime());
    }

    /** 近 N 周按周聚合趋势（含当前周，降序） */
    static weeklyTrend(sessions: TimeSession[], weeks = 4): WeeklyStats[] {
        const result: WeeklyStats[] = [];
        const currentWeek = TimeAggregator.weekStartStr(new Date());

        // 预生成 N 周的周桶（纯本地日期运算，不经 UTC 解析）
        const weekMap = new Map<string, { totalMs: number; count: number }>();
        {
            const baseMs = parseLocalDate(currentWeek);
            for (let i = weeks - 1; i >= 0; i--) {
                const key = localDateStr(baseMs - i * 7 * 24 * 3600_000);
                weekMap.set(key, { totalMs: 0, count: 0 });
            }
        }

        // 遍历会话：按自然日切分片段，再归入片段所属的周桶
        for (const s of sessions) {
            let counted = false;
            TimeAggregator.eachDaySegment(s.startMs, s.endMs, (_date, segStart, segEnd) => {
                const bucket = weekMap.get(TimeAggregator.weekKeyOf(segStart));
                if (bucket) {
                    bucket.totalMs += segEnd - segStart;
                    if (!counted) bucket.count++;
                    counted = true;
                }
            });
        }

        for (const [weekStart, v] of weekMap.entries()) {
            result.push({ weekStart, totalMs: v.totalMs, sessionCount: v.count });
        }
        // 按周起始降序（最近在前）
        result.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
        return result;
    }

    /** 周报文字摘要 */
    static weeklySummary(sessions: TimeSession[], currentSessionStartMs = 0): WeeklySummary {
        const now = Date.now();
        const weekStart = TimeAggregator.weekStartStr(new Date(now));
        const weekStartMs = parseLocalDate(weekStart);
        const weekEndMs = weekStartMs + 7 * 24 * 3600_000;

        let totalMs = 0;
        let sessionCount = 0;

        // 活跃天数与最活跃日期（按自然日切分后的片段归属）
        const dayMap = new Map<string, number>();
        const accumulate = (startMs: number, endMs: number): void => {
            if (startMs >= weekEndMs || endMs <= weekStartMs) return;
            TimeAggregator.eachDaySegment(
                Math.max(startMs, weekStartMs),
                Math.min(endMs, weekEndMs),
                (date, segStart, segEnd) => {
                    const ms = segEnd - segStart;
                    totalMs += ms;
                    dayMap.set(date, (dayMap.get(date) ?? 0) + ms);
                },
            );
        };

        for (const s of sessions) {
            if (s.startMs >= weekEndMs || s.endMs <= weekStartMs) continue;
            sessionCount++;
            accumulate(s.startMs, s.endMs);
        }
        if (currentSessionStartMs > 0 && currentSessionStartMs < weekEndMs) {
            sessionCount++;
            accumulate(currentSessionStartMs, now);
        }

        const activeDays = dayMap.size;
        let peakDate = '';
        let peakDateMs = 0;
        for (const [date, ms] of dayMap.entries()) {
            if (ms > peakDateMs) {
                peakDateMs = ms;
                peakDate = date;
            }
        }

        // 日均 = 总时长 / 本周已过天数（周一~今天）
        const todayIndex = (new Date(now).getDay() + 6) % 7; // 0=周一 ... 6=周日
        const daysElapsed = Math.max(todayIndex + 1, 1);
        const avgDailyMs = Math.round(totalMs / daysElapsed);

        return {
            weekStart,
            totalMs,
            sessionCount,
            avgDailyMs,
            peakDate,
            peakDateMs,
            activeDays,
        };
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
