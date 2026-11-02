/**
 * Module: Heatmap Aggregator (活动时间线热力图网格聚合器)
 * File Path: src/domain/aggregator/heatmap-aggregator.ts
 * Architecture Role: 领域模型层矩阵计算引擎，负责构建 24 周完整自然周网格，并将混合数据源映射为离散活跃度等级。
 * Dependencies & Triggers: 依赖 models、constants-chart、date-utils；在面板打开或数据变更时计算热力图数据。
 * Responsibilities: 生成以当前周为基准的 weeks*7 矩形时间单元；多源融合历史折叠日桶 (dailyTotals)、原始会话与活跃尾部；计算 5 档热力等级 (0~4)。
 * Exit Semantics & Design Rationale: 网格向左自然周对齐（周一开始）；未来日期与无记录格子标记清晰；纯计算无副作用。
 */

import { type DailyTotalsMap, MS_PER_DAY, MS_PER_HOUR, type TimeSession } from '../models';
import type { HeatmapDay } from '../dashboard-types';
import { DAYS_PER_WEEK, DAYS_TO_SUNDAY, DEFAULT_HEATMAP_WEEKS } from '../constants-chart';
import { eachDaySegment, formatTzDateStr } from './date-utils';

const MAX_HEATMAP_LEVEL = 4;
const HIGH_ACTIVITY_HOURS = 4;
const MID_ACTIVITY_HOURS = 2;

/** 热力图着色等级：基于当日累计时长分 5 档 */
export function heatmapLevel(ms: number): 0 | 1 | 2 | 3 | 4 {
    if (ms <= 0) return 0;
    if (ms < MS_PER_HOUR) return 1; // < 1h
    if (ms < MID_ACTIVITY_HOURS * MS_PER_HOUR) return 2; // 1h ~ 2h
    return ms < HIGH_ACTIVITY_HOURS * MS_PER_HOUR ? 3 : MAX_HEATMAP_LEVEL;
}

interface HeatmapWindow {
    cells: { dateStr: string; weekday: number; future: boolean }[];
    windowDates: Set<string>;
    windowStartMs: number;
    windowEndMs: number;
}

/** 构建热力图窗口格子序列（支持指定时区偏移） */
function buildHeatmapWindow(weeks: number, offsetMinutes?: number): HeatmapWindow {
    const nowMs = Date.now();
    const effOffset = typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)
        ? offsetMinutes
        : -new Date(nowMs).getTimezoneOffset();
    const shiftedNow = new Date(nowMs + effOffset * 60_000);
    const todayStartShifted = Date.UTC(
        shiftedNow.getUTCFullYear(),
        shiftedNow.getUTCMonth(),
        shiftedNow.getUTCDate(),
    );
    const todayStart = todayStartShifted - effOffset * 60_000;
    const todayDow = (shiftedNow.getUTCDay() + DAYS_TO_SUNDAY) % DAYS_PER_WEEK;
    const lastColMondayShifted = todayStartShifted - todayDow * MS_PER_DAY;
    const firstMondayShifted = lastColMondayShifted - (weeks - 1) * DAYS_PER_WEEK * MS_PER_DAY;
    const total = weeks * DAYS_PER_WEEK;

    const windowDates = new Set<string>();
    const cells: { dateStr: string; weekday: number; future: boolean }[] = [];
    let windowStartMs = 0;
    let windowEndMs = 0;

    for (let i = 0; i < total; i++) {
        const cellShifted = firstMondayShifted + i * MS_PER_DAY;
        const cellPhysicalMs = cellShifted - effOffset * 60_000;
        const dateStr = formatTzDateStr(cellPhysicalMs, offsetMinutes);
        if (i === 0) windowStartMs = cellPhysicalMs;
        windowEndMs = cellPhysicalMs;
        windowDates.add(dateStr);
        const cellShiftedDt = new Date(cellShifted);
        const weekday = (cellShiftedDt.getUTCDay() + DAYS_TO_SUNDAY) % DAYS_PER_WEEK;
        cells.push({ dateStr, weekday, future: cellPhysicalMs > todayStart });
    }
    windowEndMs += MS_PER_DAY;

    return { cells, windowDates, windowStartMs, windowEndMs };
}

/** 从已折叠历史日汇总桶中初始化热力图基底数据 */
function seedFromDailyTotals(
    windowDates: ReadonlySet<string>,
    dailyTotals?: DailyTotalsMap,
): Map<string, number> {
    const byDate = new Map<string, number>();
    if (!dailyTotals) {
        return byDate;
    }
    for (const date of windowDates) {
        const v = dailyTotals[date];
        if (v && v.totalMs > 0) {
            byDate.set(date, v.totalMs);
        }
    }
    return byDate;
}

/** 累加原始会话切片时长并覆盖或更新日总计 */
function accumulateRawSessions(
    window: HeatmapWindow,
    sessions: readonly TimeSession[],
    byDate: Map<string, number>,
    offsetMinutes?: number,
): void {
    const rawByDate = new Map<string, number>();
    for (const s of sessions) {
        if (s.endMs <= window.windowStartMs || s.startMs >= window.windowEndMs) {
            continue;
        }
        eachDaySegment(s.startMs, s.endMs, (date, segStart, segEnd) => {
            if (window.windowDates.has(date)) {
                rawByDate.set(date, (rawByDate.get(date) ?? 0) + (segEnd - segStart));
            }
        }, offsetMinutes);
    }
    for (const [date, ms] of rawByDate) {
        byDate.set(date, ms);
    }
}

/** 叠加当前正在进行中的未闭合活跃会话 */
function accumulateCurrentSession(
    windowDates: ReadonlySet<string>,
    currentSessionStartMs: number,
    byDate: Map<string, number>,
    offsetMinutes?: number,
): void {
    if (currentSessionStartMs <= 0) {
        return;
    }
    eachDaySegment(currentSessionStartMs, Date.now(), (date, segStart, segEnd) => {
        if (windowDates.has(date)) {
            byDate.set(date, (byDate.get(date) ?? 0) + (segEnd - segStart));
        }
    }, offsetMinutes);
}

interface AggregateWindowOptions {
    window: HeatmapWindow;
    sessions: readonly TimeSession[];
    currentSessionStartMs: number;
    dailyTotals?: DailyTotalsMap;
    offsetMinutes?: number;
}

/** 聚合折叠桶与原始会话时长到日期字典 */
function aggregateWindowSessions(opts: AggregateWindowOptions): Map<string, number> {
    const { window, sessions, currentSessionStartMs, dailyTotals, offsetMinutes } = opts;
    const byDate = seedFromDailyTotals(window.windowDates, dailyTotals);
    accumulateRawSessions(window, sessions, byDate, offsetMinutes);
    accumulateCurrentSession(window.windowDates, currentSessionStartMs, byDate, offsetMinutes);
    return byDate;
}

export interface HeatmapDaysOptions {
    currentSessionStartMs?: number;
    dailyTotals?: DailyTotalsMap;
    weeks?: number;
    offsetMinutes?: number;
}

/**
 * 活动时间线热力图：返回以「今日所在周」结尾的 weeks 个完整自然周（含本周）的按日格子（支持指定时区偏移）。
 */
export function heatmapDays(
    sessions: readonly TimeSession[],
    optsOrStartMs?: HeatmapDaysOptions | number,
    ...rest: (DailyTotalsMap | number | undefined)[]
): HeatmapDay[] {
    const isOpts = typeof optsOrStartMs === 'object' && optsOrStartMs !== null;
    const currentSessionStartMs = isOpts
        ? (optsOrStartMs.currentSessionStartMs ?? 0)
        : ((optsOrStartMs as number) ?? 0);
    const dailyTotals = isOpts
        ? optsOrStartMs.dailyTotals
        : (rest[0] as DailyTotalsMap | undefined);
    const weeks = isOpts
        ? (optsOrStartMs.weeks ?? DEFAULT_HEATMAP_WEEKS)
        : ((rest[1] as number) ?? DEFAULT_HEATMAP_WEEKS);
    const offsetMinutes = isOpts
        ? optsOrStartMs.offsetMinutes
        : (rest[2] as number | undefined);

    const window = buildHeatmapWindow(weeks, offsetMinutes);
    const byDate = aggregateWindowSessions({
        window,
        sessions,
        currentSessionStartMs,
        dailyTotals,
        offsetMinutes,
    });

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
