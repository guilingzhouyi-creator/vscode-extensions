/**
 * Module: Daily Aggregator (日报统计与按日明细纯函数)
 * File Path: src/domain/aggregator/daily-aggregator.ts
 * Architecture Role: 领域模型层纯计算聚合器，负责当日时长累计、多日会话归桶分段及 24 小时分布分析。
 * Dependencies & Triggers: 依赖 models、date-utils、duration-formatter；在状态栏更新、面板刷新及导出报告时按需执行。
 * Responsibilities: 计算今日累计时长 todayMs（含未闭合活跃会话）；按日汇总会话 dailyStats；计算单日 24 小时分布与高峰时段 dailyDetail。
 * Exit Semantics & Design Rationale: 纯函数设计，无副作用；按本地自然日严格裁剪边界，规避夏令时/跨午夜引起的重复计算与死循环。
 */

import { TimeSession, MS_PER_HOUR } from '../models';
import { eachDaySegment, localDateStr, parseLocalDate } from './date-utils';
import { formatTime } from './duration-formatter';

/** 按日聚合统计 */
export interface DailyStats {
    date: string; // "2026-06-16"
    totalMs: number;
    sessionCount: number;
}

/** 单日会话明细 */
export interface DailySessionEntry {
    startMs: number;
    endMs: number;
    durationMs: number;
    startLabel: string;
    endLabel: string;
    /** 是否为当前正在进行中的活动尾部会话 */
    isRunningTail?: boolean;
}

/** 按小时分布（每日 24 小时桶） */
export interface HourlyBucket {
    hour: number;
    totalMs: number;
    sessionCount: number;
}

/** 单日明细报告 */
export interface DailyDetail {
    date: string;
    totalMs: number;
    sessionCount: number;
    sessions: DailySessionEntry[];
    hourly: HourlyBucket[];
    peakHour: number;
    activeWindow: string;
}

/**
 * 计算今日累计时长 (ms)
 * = 今日会话片段的总和（跨午夜会话按自然日切分）+ 当前活跃会话今日已历时
 */
export function todayMs(sessions: readonly TimeSession[], currentSessionStartMs = 0): number {
    const today = localDateStr(Date.now());
    const todayStartMs = parseLocalDate(today);
    let total = 0;

    for (const s of sessions) {
        if (s.endMs <= todayStartMs) continue;
        eachDaySegment(s.startMs, s.endMs, (date, segStart, segEnd) => {
            if (date === today) total += segEnd - segStart;
        });
    }

    if (currentSessionStartMs > 0) {
        const now = Date.now();
        eachDaySegment(currentSessionStartMs, now, (date, segStart, segEnd) => {
            if (date === today) total += segEnd - segStart;
        });
    }

    return total;
}

/**
 * 按日聚合会话列表（跨午夜会话按自然日切分归桶）
 */
export function dailyStats(sessions: readonly TimeSession[]): DailyStats[] {
    const map = new Map<string, { totalMs: number; count: number }>();

    for (const s of sessions) {
        let counted = false;
        eachDaySegment(s.startMs, s.endMs, (date, segStart, segEnd) => {
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
 * 将区间 [startMs, endMs) 按小时切分并累加到 hourMap。
 */
function addToHourly(
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
        let segEnd = Math.min(endMs, nextHourStart);
        // 时钟突变或夏令时/闰秒防御：确保 segEnd 严格单调前进，防止死循环
        if (segEnd <= cursor) {
            segEnd = Math.min(endMs, cursor + MS_PER_HOUR);
        }
        const entry = hourMap.get(d.getHours()) ?? { totalMs: 0, count: 0 };
        entry.totalMs += segEnd - cursor;
        if (first) entry.count++;
        first = false;
        hourMap.set(d.getHours(), entry);
        cursor = segEnd;
    }
}

/** 找出按累计时长最大的连续小时活跃时段 */
function computeActiveWindow(hourly: readonly HourlyBucket[]): string {
    if (hourly.length === 0) return '';
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
    return `${String(bestStart).padStart(2, '0')}:00-${String(endHour).padStart(2, '0')}:00`;
}

/**
 * 获取指定日期的会话明细
 */
export function dailyDetail(
    sessions: readonly TimeSession[],
    dateStr: string,
    currentSessionStartMs = 0,
): DailyDetail {
    const dayStartMs = parseLocalDate(dateStr);
    const [y, m, d] = dateStr.split('-').map(Number);
    const dayEndMs = new Date(y, m - 1, d + 1).getTime();

    const entries: DailySessionEntry[] = [];

    const clipToDay = (startMs: number, endMs: number, running: boolean): void => {
        if (startMs >= dayEndMs || endMs <= dayStartMs) return;
        const visStart = Math.max(startMs, dayStartMs);
        const visEnd = Math.min(endMs, dayEndMs);
        const isRunningTail = running && visEnd >= Date.now();
        entries.push({
            startMs: visStart,
            endMs: visEnd,
            durationMs: visEnd - visStart,
            startLabel: formatTime(visStart),
            endLabel: formatTime(visEnd),
            isRunningTail,
        });
    };

    for (const s of sessions) {
        if (s.endMs <= dayStartMs || s.startMs >= dayEndMs) continue;
        clipToDay(s.startMs, s.endMs, false);
    }
    if (currentSessionStartMs > 0) {
        clipToDay(currentSessionStartMs, Date.now(), true);
    }

    entries.sort((a, b) => a.startMs - b.startMs);

    const hourMap = new Map<number, { totalMs: number; count: number }>();
    for (const e of entries) {
        addToHourly(hourMap, e.startMs, e.endMs);
    }
    const hourly: HourlyBucket[] = Array.from(hourMap.entries())
        .map(([hour, v]) => ({ hour, totalMs: v.totalMs, sessionCount: v.count }))
        .sort((a, b) => a.hour - b.hour);

    const totalMs = entries.reduce((sum, e) => sum + e.durationMs, 0);
    const peakHour = hourly.length > 0
        ? hourly.reduce((max, h) => (h.totalMs > max.totalMs ? h : max), hourly[0]).hour
        : -1;

    const activeWindow = computeActiveWindow(hourly);

    return {
        date: dateStr,
        totalMs,
        sessionCount: entries.length,
        sessions: entries,
        hourly,
        peakHour,
        activeWindow,
    };
}
