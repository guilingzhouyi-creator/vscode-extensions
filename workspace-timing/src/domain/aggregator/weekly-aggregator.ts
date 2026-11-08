/**
 * Module: Weekly Aggregator (周报统计与多周趋势纯函数)
 * File Path: src/domain/aggregator/weekly-aggregator.ts
 * Architecture Role: 领域模型层周期度量聚合器，负责按自然周汇总会话、提取近 7 日趋势序列及生成周度文本摘要指标。
 * Dependencies & Triggers: 依赖 models、constants-chart、date-utils、daily-aggregator；在周报渲染、柱状图绘制与报告导出时触发。
 * Responsibilities: 计算全历史周汇总 weeklyStats；生成近 7 日柱状图序列 last7Days；生成近 N 周趋势序列 weeklyTrend；提取周峰值与活跃天数 weeklySummary。
 * Exit Semantics & Design Rationale: 跨周日跨午夜会话按切分片段精确归属自然周；多源合并（折叠日桶 + 原始会话 + 进行中会话）确保时长绝对守恒。
 * Contract Invariant & Boundary Fallback: Temporal conservation invariant (7 daily totals sum to weekly totalMs); boundary guards for rolling 7-day windows against partial week bounds.
 */

import { type DailyTotalsMap, type TimeSession, MS_PER_MINUTE } from '../models';
import { DAYS_PER_WEEK, DEFAULT_TREND_WEEKS, ISO_DATE_MD_START } from '../constants-chart';
import { eachDaySegment, localDateStr, parseLocalDate, weekKeyOf, weekStartStr, formatTzDateStr } from './date-utils';
import { type DailyStats, dailyStats } from './daily-aggregator';

const DAYS_TO_SUNDAY = 6;
const PERCENT_BASE = 100;

/** 按周聚合统计 */
export interface WeeklyStats {
    weekStart: string; // "2026-06-15" (周一)
    weekEnd: string; // "2026-06-21" (周日)
    totalMs: number;
    sessionCount: number;
}

/** 周报文字摘要 */
export interface WeeklySummary {
    weekStart: string;
    totalMs: number;
    sessionCount: number;
    avgDailyMs: number;
    peakDate: string;
    peakDateMs: number;
    activeDays: number;
}

interface OngoingSessionBounds {
    currentSessionStartMs: number;
    earliestStartMs: number;
    latestEndMs: number;
}

/** 从折叠沉淀桶中提取指定日期集合的日聚合数据 */
function initDayMapFromDailyTotals(
    dates: Set<string>,
    dailyTotals?: DailyTotalsMap,
): Map<string, { totalMs: number; sessionCount: number }> {
    const dayMap = new Map<string, { totalMs: number; sessionCount: number }>();
    if (dailyTotals) {
        for (const date of dates) {
            const b = dailyTotals[date];
            if (b && b.totalMs > 0) {
                dayMap.set(date, { totalMs: b.totalMs, sessionCount: b.sessionCount || 1 });
            }
        }
    }
    return dayMap;
}

/** 将进行中会话叠加至对应日聚合数据 */
function overlayOngoingSession(
    dayMap: Map<string, { totalMs: number; sessionCount: number }>,
    windowDates: Set<string>,
    bounds: OngoingSessionBounds,
    offsetMinutes?: number,
): void {
    const { currentSessionStartMs, earliestStartMs, latestEndMs } = bounds;
    if (currentSessionStartMs <= 0 || currentSessionStartMs >= latestEndMs) return;
    const segStartClamped = Math.max(currentSessionStartMs, earliestStartMs);
    const now = Date.now();
    if (now <= segStartClamped) return;

    let counted = false;
    eachDaySegment(segStartClamped, now, (date, segStart, segEnd) => {
        if (windowDates.has(date)) {
            const entry = dayMap.get(date) ?? { totalMs: 0, sessionCount: 0 };
            entry.totalMs += segEnd - segStart;
            if (!counted) entry.sessionCount++;
            counted = true;
            dayMap.set(date, entry);
        }
    }, offsetMinutes);
}

/**
 * 按周聚合会话列表（跨午夜/跨周日界的会话按切分后的片段归属，支持指定时区偏移）
 */
export function weeklyStats(sessions: readonly TimeSession[], offsetMinutes?: number): WeeklyStats[] {
    const map = new Map<string, { totalMs: number; count: number }>();

    for (const s of sessions) {
        let counted = false;
        eachDaySegment(s.startMs, s.endMs, (_date, segStart, segEnd) => {
            const weekStart = weekKeyOf(segStart, offsetMinutes);
            const entry = map.get(weekStart) ?? { totalMs: 0, count: 0 };
            entry.totalMs += segEnd - segStart;
            if (!counted) entry.count++;
            counted = true;
            map.set(weekStart, entry);
        }, offsetMinutes);
    }

    return Array.from(map.entries())
        .map(([weekStart, v]) => {
            const [y, m, d] = weekStart.split('-').map(Number);
            const endDtMs = typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)
                ? Date.UTC(y, m - 1, d + DAYS_TO_SUNDAY) - offsetMinutes * MS_PER_MINUTE
                : new Date(y, m - 1, d + DAYS_TO_SUNDAY).getTime();
            const weekEnd = localDateStr(endDtMs, offsetMinutes);
            return { weekStart, weekEnd, totalMs: v.totalMs, sessionCount: v.count };
        })
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

interface DayBucketEntry {
    label: string;
    weekday: string;
    totalMs: number;
    manualMs: number;
    aiMs: number;
}

function buildLast7DaysBuckets(
    locale: 'zh-CN' | 'en',
    offsetMinutes?: number,
): Map<string, DayBucketEntry> {
    const weekdayNames = locale === 'en'
        ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        : ['日', '一', '二', '三', '四', '五', '六'];
    const nowMs = Date.now();
    const effOffset = typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)
        ? offsetMinutes
        : -new Date(nowMs).getTimezoneOffset();
    const shiftedNow = new Date(nowMs + effOffset * MS_PER_MINUTE);

    const dayMap = new Map<string, DayBucketEntry>();
    for (let i = DAYS_TO_SUNDAY; i >= 0; i--) {
        const shiftedTarget = new Date(Date.UTC(
            shiftedNow.getUTCFullYear(),
            shiftedNow.getUTCMonth(),
            shiftedNow.getUTCDate() - i,
        ));
        const physicalMs = shiftedTarget.getTime() - effOffset * MS_PER_MINUTE;
        const dateStr = formatTzDateStr(physicalMs, offsetMinutes);
        dayMap.set(dateStr, {
            label: dateStr.slice(ISO_DATE_MD_START),
            weekday: weekdayNames[shiftedTarget.getUTCDay()],
            totalMs: 0,
            manualMs: 0,
            aiMs: 0,
        });
    }
    return dayMap;
}

function accumulate7DaySessions(
    sessions: readonly TimeSession[],
    dayMap: Map<string, DayBucketEntry>,
    firstDayStartMs: number,
    offsetMinutes?: number,
): void {
    for (const s of sessions) {
        if (s.endMs <= firstDayStartMs) continue;
        const totalSessionDuration = s.endMs - s.startMs;
        if (totalSessionDuration <= 0) continue;

        const sManual = s.manualMs ?? totalSessionDuration;
        const sAi = s.aiMs ?? 0;

        eachDaySegment(s.startMs, s.endMs, (date, segStart, segEnd) => {
            const bucket = dayMap.get(date);
            if (!bucket) return;
            const segDuration = segEnd - segStart;
            bucket.totalMs += segDuration;

            if (segDuration === totalSessionDuration) {
                bucket.manualMs += sManual;
                bucket.aiMs += sAi;
            } else {
                const ratio = segDuration / totalSessionDuration;
                let segManual = Math.round(sManual * ratio);
                segManual = Math.max(0, Math.min(segDuration, segManual));
                const segAi = segDuration - segManual;
                bucket.manualMs += segManual;
                bucket.aiMs += segAi;
            }
        }, offsetMinutes);
    }
}

/**
 * 最近 7 天每日统计
 */
export function last7Days(
    sessions: readonly TimeSession[],
    currentSessionStartMs = 0,
    locale: 'zh-CN' | 'en' = 'zh-CN',
    currentActivityMode: 'manual' | 'ai' = 'manual',
    offsetMinutes?: number,
): {
    label: string;
    weekday: string;
    totalMs: number;
    manualMs: number;
    aiMs: number;
    manualRatio: number;
    aiRatio: number;
}[] {
    const dayMap = buildLast7DaysBuckets(locale, offsetMinutes);
    const firstDayKey = dayMap.keys().next().value as string;
    const firstDayStartMs = parseLocalDate(firstDayKey, offsetMinutes);
    accumulate7DaySessions(sessions, dayMap, firstDayStartMs, offsetMinutes);

    if (currentSessionStartMs > 0) {
        const now = Date.now();
        if (now > currentSessionStartMs) {
            const isAi = currentActivityMode === 'ai';
            eachDaySegment(currentSessionStartMs, now, (date, segStart, segEnd) => {
                const bucket = dayMap.get(date);
                if (!bucket) return;
                const segDuration = segEnd - segStart;
                bucket.totalMs += segDuration;
                if (isAi) {
                    bucket.aiMs += segDuration;
                } else {
                    bucket.manualMs += segDuration;
                }
            }, offsetMinutes);
        }
    }

    return Array.from(dayMap.values()).map(entry => {
        let manualRatio = 0;
        let aiRatio = 0;
        if (entry.totalMs > 0) {
            manualRatio = Math.round((entry.manualMs / entry.totalMs) * PERCENT_BASE);
            manualRatio = Math.max(0, Math.min(PERCENT_BASE, manualRatio));
            aiRatio = PERCENT_BASE - manualRatio;
        }
        return {
            label: entry.label,
            weekday: entry.weekday,
            totalMs: entry.totalMs,
            manualMs: entry.manualMs,
            aiMs: entry.aiMs,
            manualRatio,
            aiRatio,
        };
    });
}

/**
 * 全历史按日聚合序列（用于聚合导出，支持指定时区偏移）
 */
export function fullDailySeries(
    sessions: readonly TimeSession[],
    currentSessionStartMs = 0,
    dailyTotals?: DailyTotalsMap,
    offsetMinutes?: number,
): DailyStats[] {
    const map = new Map<string, { totalMs: number; sessionCount: number }>();
    for (const [date, v] of Object.entries(dailyTotals ?? {})) {
        map.set(date, { totalMs: v.totalMs, sessionCount: v.sessionCount });
    }
    for (const d of dailyStats(sessions, offsetMinutes)) {
        map.set(d.date, { totalMs: d.totalMs, sessionCount: d.sessionCount });
    }
    if (currentSessionStartMs > 0) {
        const now = Date.now();
        eachDaySegment(currentSessionStartMs, now, (date, segStart, segEnd) => {
            const b = map.get(date) ?? { totalMs: 0, sessionCount: 0 };
            b.totalMs += segEnd - segStart;
            map.set(date, b);
        }, offsetMinutes);
    }
    return Array.from(map.entries())
        .map(([date, v]) => ({ date, totalMs: v.totalMs, sessionCount: v.sessionCount }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

function accumulateSessionSegments(
    rawDayMap: Map<string, { totalMs: number; sessionCount: number }>,
    targetDates: ReadonlySet<string>,
    bounds: { startMs: number; endMs: number },
    offsetMinutes?: number,
): void {
    let counted = false;
    eachDaySegment(
        bounds.startMs,
        bounds.endMs,
        (date, segStart, segEnd) => {
            if (targetDates.has(date)) {
                const entry = rawDayMap.get(date) ?? { totalMs: 0, sessionCount: 0 };
                entry.totalMs += segEnd - segStart;
                if (!counted) entry.sessionCount++;
                counted = true;
                rawDayMap.set(date, entry);
            }
        },
        offsetMinutes,
    );
}

function summarizeWeekDayMap(dayMap: ReadonlyMap<string, { totalMs: number; sessionCount: number }>): {
    totalMs: number;
    sessionCount: number;
    activeDays: number;
    peakDate: string;
    peakDateMs: number;
} {
    let totalMs = 0;
    let sessionCount = 0;
    let activeDays = 0;
    let peakDate = '';
    let peakDateMs = 0;

    for (const [date, v] of dayMap) {
        totalMs += v.totalMs;
        sessionCount += v.sessionCount;
        if (v.totalMs > 0) {
            activeDays++;
            if (v.totalMs > peakDateMs) {
                peakDateMs = v.totalMs;
                peakDate = date;
            }
        }
    }
    return { totalMs, sessionCount, activeDays, peakDate, peakDateMs };
}

function computeAvgDailyMs(totalMs: number, now: number, offsetMinutes?: number): number {
    const effOffset = typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)
        ? offsetMinutes
        : -new Date(now).getTimezoneOffset();
    const shiftedNow = new Date(now + effOffset * MS_PER_MINUTE);
    const todayIndex = (shiftedNow.getUTCDay() + DAYS_TO_SUNDAY) % DAYS_PER_WEEK;
    const daysElapsed = Math.max(todayIndex + 1, 1);
    return Math.round(totalMs / daysElapsed);
}

interface TrendWindows {
    weekMap: Map<string, { weekEnd: string; totalMs: number; count: number }>;
    windowDates: Set<string>;
    earliestStartMs: number;
    latestEndMs: number;
}

function buildTrendWindows(currentWeek: string, weeks: number, offsetMinutes?: number): TrendWindows {
    const weekMap = new Map<string, { weekEnd: string; totalMs: number; count: number }>();
    const windowDates = new Set<string>();
    let earliestStartMs = 0;
    let latestEndMs = 0;

    const [by, bm, bd] = currentWeek.split('-').map(Number);
    for (let i = weeks - 1; i >= 0; i--) {
        const isCustom = typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes);
        const dtMs = isCustom
            ? Date.UTC(by, bm - 1, bd - DAYS_PER_WEEK * i) - offsetMinutes * MS_PER_MINUTE
            : new Date(by, bm - 1, bd - DAYS_PER_WEEK * i).getTime();
        const weekStart = localDateStr(dtMs, offsetMinutes);
        const endDtMs = isCustom
            ? Date.UTC(by, bm - 1, bd - DAYS_PER_WEEK * i + DAYS_TO_SUNDAY) - offsetMinutes * MS_PER_MINUTE
            : new Date(by, bm - 1, bd - DAYS_PER_WEEK * i + DAYS_TO_SUNDAY).getTime();
        const weekEnd = localDateStr(endDtMs, offsetMinutes);
        weekMap.set(weekStart, { weekEnd, totalMs: 0, count: 0 });

        if (i === weeks - 1) earliestStartMs = dtMs;
        if (i === 0) {
            latestEndMs = isCustom
                ? Date.UTC(by, bm - 1, bd - DAYS_PER_WEEK * i + DAYS_PER_WEEK) - offsetMinutes * MS_PER_MINUTE
                : new Date(by, bm - 1, bd - DAYS_PER_WEEK * i + DAYS_PER_WEEK).getTime();
        }

        for (let dayOffset = 0; dayOffset < DAYS_PER_WEEK; dayOffset++) {
            const dayMs = isCustom
                ? Date.UTC(by, bm - 1, bd - DAYS_PER_WEEK * i + dayOffset) - offsetMinutes * MS_PER_MINUTE
                : new Date(by, bm - 1, bd - DAYS_PER_WEEK * i + dayOffset).getTime();
            windowDates.add(localDateStr(dayMs, offsetMinutes));
        }
    }

    return { weekMap, windowDates, earliestStartMs, latestEndMs };
}

/**
 * 近 N 周按周聚合趋势（含当前周，降序，窗口化 O(weeks*7) 算法，支持指定时区偏移）
 */
export function weeklyTrend(
    sessions: readonly TimeSession[],
    weeks = DEFAULT_TREND_WEEKS,
    currentSessionStartMs = 0,
    dailyTotals?: DailyTotalsMap,
    offsetMinutes?: number,
): WeeklyStats[] {
    const currentWeek = weekStartStr(new Date(), offsetMinutes);
    const { weekMap, windowDates, earliestStartMs, latestEndMs } = buildTrendWindows(currentWeek, weeks, offsetMinutes);

    const dayMap = initDayMapFromDailyTotals(windowDates, dailyTotals);
    const rawDayMap = new Map<string, { totalMs: number; sessionCount: number }>();
    for (const sessionItem of sessions) {
        if (sessionItem.endMs <= earliestStartMs || sessionItem.startMs >= latestEndMs) continue;
        accumulateSessionSegments(
            rawDayMap,
            windowDates,
            {
                startMs: Math.max(sessionItem.startMs, earliestStartMs),
                endMs: Math.min(sessionItem.endMs, latestEndMs),
            },
            offsetMinutes,
        );
    }
    for (const [date, val] of rawDayMap) {
        dayMap.set(date, val);
    }

    overlayOngoingSession(dayMap, windowDates, { currentSessionStartMs, earliestStartMs, latestEndMs }, offsetMinutes);

    for (const [date, val] of dayMap) {
        const dMs = parseLocalDate(date, offsetMinutes);
        const weekKey = weekKeyOf(dMs, offsetMinutes);
        const bucket = weekMap.get(weekKey);
        if (bucket) {
            bucket.totalMs += val.totalMs;
            bucket.count += val.sessionCount;
        }
    }

    const result: WeeklyStats[] = [];
    for (const [weekStart, val] of weekMap.entries()) {
        result.push({ weekStart, weekEnd: val.weekEnd, totalMs: val.totalMs, sessionCount: val.count });
    }
    result.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    return result;
}

/**
 * 周报文字摘要（窗口化 O(1) 本周聚合，按自然日严格切分，含 dailyTotals 折叠层与进行中会话，支持指定时区偏移）
 */
export function weeklySummary(
    sessions: readonly TimeSession[],
    currentSessionStartMs = 0,
    dailyTotals?: DailyTotalsMap,
    offsetMinutes?: number,
): WeeklySummary {
    const now = Date.now();
    const weekStart = weekStartStr(new Date(now), offsetMinutes);
    const weekStartMs = parseLocalDate(weekStart, offsetMinutes);
    const [wsY, wsM, wsD] = weekStart.split('-').map(Number);
    const weekEndMs = typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)
        ? Date.UTC(wsY, wsM - 1, wsD + DAYS_PER_WEEK) - offsetMinutes * MS_PER_MINUTE
        : new Date(wsY, wsM - 1, wsD + DAYS_PER_WEEK).getTime();

    const weekDates = new Set<string>();
    for (let i = 0; i < DAYS_PER_WEEK; i++) {
        const dayMs = typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)
            ? Date.UTC(wsY, wsM - 1, wsD + i) - offsetMinutes * MS_PER_MINUTE
            : new Date(wsY, wsM - 1, wsD + i).getTime();
        weekDates.add(localDateStr(dayMs, offsetMinutes));
    }

    const dayMap = initDayMapFromDailyTotals(weekDates, dailyTotals);

    const rawDayMap = new Map<string, { totalMs: number; sessionCount: number }>();
    for (let i = sessions.length - 1; i >= 0; i--) {
        const s = sessions[i];
        if (s.endMs <= weekStartMs) break;
        if (s.startMs >= weekEndMs) continue;
        accumulateSessionSegments(
            rawDayMap,
            weekDates,
            {
                startMs: Math.max(s.startMs, weekStartMs),
                endMs: Math.min(s.endMs, weekEndMs),
            },
            offsetMinutes,
        );
    }
    for (const [date, v] of rawDayMap) {
        dayMap.set(date, v);
    }

    overlayOngoingSession(dayMap, weekDates, {
        currentSessionStartMs,
        earliestStartMs: weekStartMs,
        latestEndMs: weekEndMs,
    }, offsetMinutes);

    const metrics = summarizeWeekDayMap(dayMap);
    const avgDailyMs = computeAvgDailyMs(metrics.totalMs, now, offsetMinutes);

    return {
        weekStart,
        totalMs: metrics.totalMs,
        sessionCount: metrics.sessionCount,
        avgDailyMs,
        peakDate: metrics.peakDate,
        peakDateMs: metrics.peakDateMs,
        activeDays: metrics.activeDays,
    };
}
