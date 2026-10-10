/**
 * Module: Weekly Aggregator (周报统计与多周趋势纯函数)
 * File Path: src/domain/aggregator/weekly-aggregator.ts
 * Architecture Role: 领域模型层周期度量聚合器，负责按自然周汇总会话、提取近 7 日趋势序列及生成周度文本摘要指标。
 * Dependencies & Triggers: 依赖 models、constants-chart、date-utils、daily-aggregator；在周报渲染、柱状图绘制与报告导出时触发。
 * Responsibilities: 计算全历史周汇总 weeklyStats；生成近 7 日柱状图序列 last7Days；生成近 N 周趋势序列 weeklyTrend；提取周峰值与活跃天数 weeklySummary。
 * Exit Semantics & Design Rationale: 跨周日跨午夜会话按切分片段精确归属自然周；多源合并（折叠日桶 + 原始会话 + 进行中会话）确保时长绝对守恒。
 * Contract Invariant & Boundary Fallback: Temporal conservation invariant (7 daily totals sum to weekly totalMs); boundary guards for rolling 7-day windows against partial week bounds.
 */

import { DailyTotalsMap, TimeSession } from '../models';
import { DAYS_PER_WEEK, DEFAULT_TREND_WEEKS, ISO_DATE_MD_START } from '../constants-chart';
import { eachDaySegment, localDateStr, parseLocalDate, weekKeyOf, weekStartStr } from './date-utils';
import { DailyStats, dailyStats } from './daily-aggregator';

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
    });
}

/**
 * 按周聚合会话列表（跨午夜/跨周日界的会话按切分后的片段归属）
 */
export function weeklyStats(sessions: readonly TimeSession[]): WeeklyStats[] {
    const map = new Map<string, { totalMs: number; count: number }>();

    for (const s of sessions) {
        let counted = false;
        eachDaySegment(s.startMs, s.endMs, (_date, segStart, segEnd) => {
            const weekStart = weekKeyOf(segStart);
            const entry = map.get(weekStart) ?? { totalMs: 0, count: 0 };
            entry.totalMs += segEnd - segStart;
            if (!counted) entry.count++;
            counted = true;
            map.set(weekStart, entry);
        });
    }

    return Array.from(map.entries())
        .map(([weekStart, v]) => {
            const [y, m, d] = weekStart.split('-').map(Number);
            const endDt = new Date(y, m - 1, d + DAYS_TO_SUNDAY);
            const weekEnd = localDateStr(endDt.getTime());
            return { weekStart, weekEnd, totalMs: v.totalMs, sessionCount: v.count };
        })
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/**
 * 最近 7 天每日统计
 */
export function last7Days(
    sessions: readonly TimeSession[],
    currentSessionStartMs = 0,
    locale: 'zh-CN' | 'en' = 'zh-CN',
    currentActivityMode: 'manual' | 'ai' = 'manual',
): {
    label: string;
    weekday: string;
    totalMs: number;
    manualMs: number;
    aiMs: number;
    manualRatio: number;
    aiRatio: number;
}[] {
    const weekdayNames = locale === 'en'
        ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        : ['日', '一', '二', '三', '四', '五', '六'];
    const today = new Date();

    const dayMap = new Map<string, {
        label: string;
        weekday: string;
        totalMs: number;
        manualMs: number;
        aiMs: number;
    }>();
    for (let i = DAYS_TO_SUNDAY; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
        const dateStr = localDateStr(d.getTime());
        dayMap.set(dateStr, {
            label: dateStr.slice(ISO_DATE_MD_START),
            weekday: weekdayNames[d.getDay()],
            totalMs: 0,
            manualMs: 0,
            aiMs: 0,
        });
    }

    const firstDayStartMs = parseLocalDate(dayMap.keys().next().value as string);
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
        });
    }

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
            });
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
 * 全历史按日聚合序列（用于聚合导出）
 */
export function fullDailySeries(
    sessions: readonly TimeSession[],
    currentSessionStartMs = 0,
    dailyTotals?: DailyTotalsMap,
): DailyStats[] {
    const map = new Map<string, { totalMs: number; sessionCount: number }>();
    for (const [date, v] of Object.entries(dailyTotals ?? {})) {
        map.set(date, { totalMs: v.totalMs, sessionCount: v.sessionCount });
    }
    for (const d of dailyStats(sessions)) {
        map.set(d.date, { totalMs: d.totalMs, sessionCount: d.sessionCount });
    }
    if (currentSessionStartMs > 0) {
        const now = Date.now();
        eachDaySegment(currentSessionStartMs, now, (date, segStart, segEnd) => {
            const b = map.get(date) ?? { totalMs: 0, sessionCount: 0 };
            b.totalMs += segEnd - segStart;
            map.set(date, b);
        });
    }
    return Array.from(map.entries())
        .map(([date, v]) => ({ date, totalMs: v.totalMs, sessionCount: v.sessionCount }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 近 N 周按周聚合趋势（含当前周，降序，窗口化 O(weeks*7) 算法）
 */
export function weeklyTrend(
    sessions: readonly TimeSession[],
    weeks = DEFAULT_TREND_WEEKS,
    currentSessionStartMs = 0,
    dailyTotals?: DailyTotalsMap,
): WeeklyStats[] {
    const result: WeeklyStats[] = [];
    const currentWeek = weekStartStr(new Date());

    const weekMap = new Map<string, { weekEnd: string; totalMs: number; count: number }>();
    const windowDates = new Set<string>();
    let earliestStartMs = 0;
    let latestEndMs = 0;

    const base = parseLocalDate(currentWeek);
    const bd = new Date(base);
    for (let i = weeks - 1; i >= 0; i--) {
        const dt = new Date(bd.getFullYear(), bd.getMonth(), bd.getDate() - DAYS_PER_WEEK * i);
        const weekStart = localDateStr(dt.getTime());
        const endDt = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + DAYS_TO_SUNDAY);
        const weekEnd = localDateStr(endDt.getTime());
        weekMap.set(weekStart, { weekEnd, totalMs: 0, count: 0 });

        if (i === weeks - 1) earliestStartMs = dt.getTime();
        if (i === 0) latestEndMs = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + DAYS_PER_WEEK).getTime();

        for (let d = 0; d < DAYS_PER_WEEK; d++) {
            const day = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + d);
            windowDates.add(localDateStr(day.getTime()));
        }
    }

    const dayMap = initDayMapFromDailyTotals(windowDates, dailyTotals);

    const rawDayMap = new Map<string, { totalMs: number; sessionCount: number }>();
    for (const s of sessions) {
        if (s.endMs <= earliestStartMs || s.startMs >= latestEndMs) continue;
        let counted = false;
        eachDaySegment(
            Math.max(s.startMs, earliestStartMs),
            Math.min(s.endMs, latestEndMs),
            (date, segStart, segEnd) => {
                if (windowDates.has(date)) {
                    const entry = rawDayMap.get(date) ?? { totalMs: 0, sessionCount: 0 };
                    entry.totalMs += segEnd - segStart;
                    if (!counted) entry.sessionCount++;
                    counted = true;
                    rawDayMap.set(date, entry);
                }
            },
        );
    }
    for (const [date, v] of rawDayMap) {
        dayMap.set(date, v);
    }

    overlayOngoingSession(dayMap, windowDates, { currentSessionStartMs, earliestStartMs, latestEndMs });

    for (const [date, v] of dayMap) {
        const dMs = parseLocalDate(date);
        const weekKey = weekKeyOf(dMs);
        const bucket = weekMap.get(weekKey);
        if (bucket) {
            bucket.totalMs += v.totalMs;
            bucket.count += v.sessionCount;
        }
    }

    for (const [weekStart, v] of weekMap.entries()) {
        result.push({ weekStart, weekEnd: v.weekEnd, totalMs: v.totalMs, sessionCount: v.count });
    }
    result.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    return result;
}

/**
 * 周报文字摘要（窗口化 O(1) 本周聚合，按自然日严格切分，含 dailyTotals 折叠层与进行中会话）
 */
export function weeklySummary(
    sessions: readonly TimeSession[],
    currentSessionStartMs = 0,
    dailyTotals?: DailyTotalsMap,
): WeeklySummary {
    const now = Date.now();
    const weekStart = weekStartStr(new Date(now));
    const weekStartMs = parseLocalDate(weekStart);
    const wsDate = new Date(weekStartMs);
    const weekEndMs = new Date(wsDate.getFullYear(), wsDate.getMonth(), wsDate.getDate() + DAYS_PER_WEEK).getTime();

    const weekDates = new Set<string>();
    for (let i = 0; i < DAYS_PER_WEEK; i++) {
        const d = new Date(wsDate.getFullYear(), wsDate.getMonth(), wsDate.getDate() + i);
        weekDates.add(localDateStr(d.getTime()));
    }

    const dayMap = initDayMapFromDailyTotals(weekDates, dailyTotals);

    const rawDayMap = new Map<string, { totalMs: number; sessionCount: number }>();
    for (let i = sessions.length - 1; i >= 0; i--) {
        const s = sessions[i];
        if (s.endMs <= weekStartMs) break;
        if (s.startMs >= weekEndMs) continue;
        let counted = false;
        eachDaySegment(
            Math.max(s.startMs, weekStartMs),
            Math.min(s.endMs, weekEndMs),
            (date, segStart, segEnd) => {
                if (weekDates.has(date)) {
                    const entry = rawDayMap.get(date) ?? { totalMs: 0, sessionCount: 0 };
                    entry.totalMs += segEnd - segStart;
                    if (!counted) entry.sessionCount++;
                    counted = true;
                    rawDayMap.set(date, entry);
                }
            },
        );
    }
    for (const [date, v] of rawDayMap) {
        dayMap.set(date, v);
    }

    overlayOngoingSession(dayMap, weekDates, {
        currentSessionStartMs,
        earliestStartMs: weekStartMs,
        latestEndMs: weekEndMs,
    });

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

    const todayIndex = (new Date(now).getDay() + DAYS_TO_SUNDAY) % DAYS_PER_WEEK;
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
