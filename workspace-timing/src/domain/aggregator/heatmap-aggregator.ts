/**
 * heatmap-aggregator — 24 周活动热力图纯函数
 *
 * 职责：构建自然周网格矩阵并聚合会话与折叠日桶。
 */

import { DailyTotalsMap, MS_PER_DAY, MS_PER_HOUR, TimeSession } from '../models';
import { HeatmapDay } from '../dashboard-types';
import { DAYS_PER_WEEK, DEFAULT_HEATMAP_WEEKS } from '../constants-chart';
import { eachDaySegment, localDateStr } from './date-utils';

const DAYS_TO_SUNDAY = 6;
const MAX_HEATMAP_LEVEL = 4;
const HIGH_ACTIVITY_HOURS = 4;
const MID_ACTIVITY_HOURS = 2;

/** 热力图着色等级：基于当日累计时长分 5 档 */
export function heatmapLevel(ms: number): 0 | 1 | 2 | 3 | 4 {
    if (ms <= 0) return 0;
    if (ms < MS_PER_HOUR) return 1; // < 1h
    if (ms < MID_ACTIVITY_HOURS * MS_PER_HOUR) return 2; // 1h ~ 2h
    if (ms < HIGH_ACTIVITY_HOURS * MS_PER_HOUR) return 3; // 2h ~ 4h
    return MAX_HEATMAP_LEVEL; // ≥ 4h
}

interface HeatmapWindow {
    cells: { dateStr: string; weekday: number; future: boolean }[];
    windowDates: Set<string>;
    windowStartMs: number;
    windowEndMs: number;
}

/** 构建热力图窗口格子序列 */
function buildHeatmapWindow(weeks: number): HeatmapWindow {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStart = today.getTime();
    const todayDow = (now.getDay() + DAYS_TO_SUNDAY) % DAYS_PER_WEEK;
    const lastColMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - todayDow);
    const firstMonday = new Date(
        lastColMonday.getFullYear(),
        lastColMonday.getMonth(),
        lastColMonday.getDate() - (weeks - 1) * DAYS_PER_WEEK,
    );
    const total = weeks * DAYS_PER_WEEK;

    const windowDates = new Set<string>();
    const cells: { dateStr: string; weekday: number; future: boolean }[] = [];
    let windowStartMs = 0;
    let windowEndMs = 0;

    for (let i = 0; i < total; i++) {
        const d = new Date(firstMonday.getFullYear(), firstMonday.getMonth(), firstMonday.getDate() + i);
        const dateStr = localDateStr(d.getTime());
        const ms = d.getTime();
        if (i === 0) windowStartMs = ms;
        windowEndMs = ms;
        windowDates.add(dateStr);
        cells.push({ dateStr, weekday: (d.getDay() + DAYS_TO_SUNDAY) % DAYS_PER_WEEK, future: ms > todayStart });
    }
    windowEndMs += MS_PER_DAY;

    return { cells, windowDates, windowStartMs, windowEndMs };
}

/** 聚合折叠桶与原始会话时长到日期字典 */
function aggregateWindowSessions(
    window: HeatmapWindow,
    sessions: readonly TimeSession[],
    currentSessionStartMs: number,
    dailyTotals?: DailyTotalsMap,
): Map<string, number> {
    const { windowDates, windowStartMs, windowEndMs } = window;
    const byDate = new Map<string, number>();

    if (dailyTotals) {
        for (const date of windowDates) {
            const v = dailyTotals[date];
            if (v && v.totalMs > 0) byDate.set(date, v.totalMs);
        }
    }

    const rawByDate = new Map<string, number>();
    for (const s of sessions) {
        if (s.endMs <= windowStartMs || s.startMs >= windowEndMs) continue;
        eachDaySegment(s.startMs, s.endMs, (date, segStart, segEnd) => {
            if (windowDates.has(date)) {
                rawByDate.set(date, (rawByDate.get(date) ?? 0) + (segEnd - segStart));
            }
        });
    }
    for (const [date, ms] of rawByDate) {
        byDate.set(date, ms);
    }

    if (currentSessionStartMs > 0) {
        eachDaySegment(currentSessionStartMs, Date.now(), (date, segStart, segEnd) => {
            if (windowDates.has(date)) {
                byDate.set(date, (byDate.get(date) ?? 0) + (segEnd - segStart));
            }
        });
    }

    return byDate;
}

/**
 * 活动时间线热力图：返回以「今日所在周」结尾的 weeks 个完整自然周（含本周）的按日格子。
 */
export function heatmapDays(
    sessions: readonly TimeSession[],
    currentSessionStartMs = 0,
    dailyTotals?: DailyTotalsMap,
    weeks = DEFAULT_HEATMAP_WEEKS,
): HeatmapDay[] {
    const window = buildHeatmapWindow(weeks);
    const byDate = aggregateWindowSessions(window, sessions, currentSessionStartMs, dailyTotals);

    return window.cells.map((c) => {
        const totalMs = c.future ? 0 : (byDate.get(c.dateStr) ?? 0);
        return {
            dateStr: c.dateStr,
            weekday: c.weekday,
            totalMs,
            level: heatmapLevel(totalMs),
            future: c.future,
        };
    });
}
