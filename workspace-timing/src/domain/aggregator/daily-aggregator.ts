/**
 * Module: Daily Aggregator (日报统计与按日明细纯函数)
 * File Path: src/domain/aggregator/daily-aggregator.ts
 * Architecture Role: 领域模型层纯计算聚合器，负责当日时长累计、多日会话归桶分段及 24 小时分布分析。
 * Dependencies & Triggers: 依赖 models、date-utils、duration-formatter；在状态栏更新、面板刷新及导出报告时按需执行。
 * Responsibilities: 计算今日累计时长 todayMs（含未闭合活跃会话）；按日汇总会话 dailyStats；计算单日 24 小时分布与高峰时段 dailyDetail。
 * Exit Semantics & Design Rationale: 纯函数设计，无副作用；按本地自然日严格裁剪边界，规避夏令时/跨午夜引起的重复计算与死循环。
 * Contract Invariant & Boundary Fallback: Conservation invariant across daily buckets (sum of 24 hourly buckets == daily totalMs); boundary clamping ensures sessions never project into negative or future time bounds.
 */

import { type TimeSession, MS_PER_HOUR, MS_PER_MINUTE } from '../models';
import { eachDaySegment, localDateStr, parseLocalDate, toUtcIsoString } from './date-utils';
import { formatTime } from './duration-formatter';

const PERCENT_BASE = 100;

/** 会话时长切片与双轨工时分配载荷 */
interface SessionDurationSlice {
    startMs: number;
    endMs: number;
    manualMs?: number;
    aiMs?: number;
}

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
    startUtcIso?: string;
    endUtcIso?: string;
    manualMs?: number;
    aiMs?: number;
    /** 是否为当前正在进行中的活动尾部会话 */
    isRunningTail?: boolean;
}

/** 按小时分布（每日 24 小时桶，双轨堆叠契约） */
export interface HourlyBucket {
    hour: number;
    totalMs: number;
    manualMs: number;
    aiMs: number;
    manualRatio: number;
    aiRatio: number;
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
export function todayMs(
    sessions: readonly TimeSession[],
    currentSessionStartMs = 0,
    offsetMinutes?: number,
): number {
    const today = localDateStr(Date.now(), offsetMinutes);
    const todayStartMs = parseLocalDate(today, offsetMinutes);
    let total = 0;

    for (const s of sessions) {
        if (s.endMs <= todayStartMs) continue;
        eachDaySegment(s.startMs, s.endMs, (date, segStart, segEnd) => {
            if (date === today) total += segEnd - segStart;
        }, offsetMinutes);
    }

    if (currentSessionStartMs > 0) {
        const now = Date.now();
        eachDaySegment(currentSessionStartMs, now, (date, segStart, segEnd) => {
            if (date === today) total += segEnd - segStart;
        }, offsetMinutes);
    }

    return total;
}

/**
 * 按日聚合会话列表（跨午夜会话按自然日切分归桶，支持指定时区偏移）
 */
export function dailyStats(sessions: readonly TimeSession[], offsetMinutes?: number): DailyStats[] {
    const map = new Map<string, { totalMs: number; count: number }>();

    for (const s of sessions) {
        let counted = false;
        eachDaySegment(s.startMs, s.endMs, (date, segStart, segEnd) => {
            const entry = map.get(date) ?? { totalMs: 0, count: 0 };
            entry.totalMs += segEnd - segStart;
            if (!counted) entry.count++;
            counted = true;
            map.set(date, entry);
        }, offsetMinutes);
    }

    return Array.from(map.entries())
        .map(([date, v]) => ({ date, totalMs: v.totalMs, sessionCount: v.count }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 将区间 [startMs, endMs) 按小时切分并累加到 hourMap，支持 manualMs 与 aiMs 等比守恒分配。
 * 基于指定时区偏移或宿主时区步进，严格保证 24 个小时桶总和等于当日总时长。
 */
function addToHourly(
    hourMap: Map<number, { totalMs: number; manualMs: number; aiMs: number; count: number }>,
    slice: SessionDurationSlice,
    offsetMinutes?: number,
): void {
    const { startMs, endMs } = slice;
    const totalDuration = endMs - startMs;
    if (totalDuration <= 0) return;

    let remainingDuration = totalDuration;
    let remainingManual = slice.manualMs ?? 0;
    let remainingAi = slice.aiMs ?? 0;
    if (remainingManual + remainingAi !== totalDuration) {
        remainingManual = totalDuration;
        remainingAi = 0;
    }

    let cursor = startMs;
    let first = true;
    while (cursor < endMs) {
        const effOffset = typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)
            ? offsetMinutes
            : -new Date(cursor).getTimezoneOffset();
        const shiftedMs = cursor + effOffset * MS_PER_MINUTE;
        const hour = new Date(shiftedMs).getUTCHours();
        const currentHourStartShifted = Math.floor(shiftedMs / MS_PER_HOUR) * MS_PER_HOUR;
        const nextHourStartShifted = currentHourStartShifted + MS_PER_HOUR;
        const nextHourStartPhysical = nextHourStartShifted - effOffset * MS_PER_MINUTE;

        let segEnd = Math.min(endMs, nextHourStartPhysical);
        // 时钟突变或夏令时/闰秒防御：确保 segEnd 严格单调前进，防止死循环
        if (segEnd <= cursor) {
            segEnd = Math.min(endMs, cursor + MS_PER_HOUR);
        }
        const segDuration = segEnd - cursor;

        let segManual: number;
        let segAi: number;
        if (segEnd >= endMs || segDuration >= remainingDuration) {
            segManual = remainingManual;
            segAi = remainingAi;
        } else {
            const ratio = segDuration / remainingDuration;
            segManual = Math.round(remainingManual * ratio);
            segManual = Math.max(0, Math.min(segDuration, segManual));
            segAi = segDuration - segManual;
            remainingDuration -= segDuration;
            remainingManual -= segManual;
            remainingAi -= segAi;
        }

        const entry = hourMap.get(hour) ?? { totalMs: 0, manualMs: 0, aiMs: 0, count: 0 };
        entry.totalMs += segDuration;
        entry.manualMs += segManual;
        entry.aiMs += segAi;
        if (first) entry.count++;
        first = false;
        hourMap.set(hour, entry);
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

function allocateSessionManualAi(
    target: SessionDurationSlice,
    durationMs: number,
    totalSessionDuration: number,
): { manualMs: number; aiMs: number } {
    if (totalSessionDuration <= 0) {
        return { manualMs: durationMs, aiMs: 0 };
    }
    if (durationMs === totalSessionDuration) {
        const m = target.manualMs ?? durationMs;
        const a = target.aiMs ?? 0;
        if (m + a === durationMs) {
            return { manualMs: m, aiMs: a };
        }
        const boundedManual = Math.min(durationMs, Math.max(0, m));
        return { manualMs: boundedManual, aiMs: durationMs - boundedManual };
    }
    const m = target.manualMs ?? totalSessionDuration;
    const ratio = durationMs / totalSessionDuration;
    const scaledManual = Math.max(0, Math.min(durationMs, Math.round(m * ratio)));
    return { manualMs: scaledManual, aiMs: durationMs - scaledManual };
}

export interface DailyDetailOptions {
    currentSessionStartMs?: number;
    currentActivityMode?: 'manual' | 'ai';
    offsetMinutes?: number;
}

interface NormalizedDailyDetailOptions {
    currentSessionStartMs: number;
    currentActivityMode: 'manual' | 'ai';
    offsetMinutes?: number;
}

function parseDailyDetailOptions(
    optsOrStartMs?: DailyDetailOptions | number,
    ...rest: (string | number | undefined)[]
): NormalizedDailyDetailOptions {
    if (typeof optsOrStartMs === 'object' && optsOrStartMs !== null) {
        return {
            currentSessionStartMs: optsOrStartMs.currentSessionStartMs ?? 0,
            currentActivityMode: optsOrStartMs.currentActivityMode ?? 'manual',
            offsetMinutes: optsOrStartMs.offsetMinutes,
        };
    }
    return {
        currentSessionStartMs: (optsOrStartMs as number) ?? 0,
        currentActivityMode: (rest[0] as 'manual' | 'ai') ?? 'manual',
        offsetMinutes: rest[1] as number | undefined,
    };
}

function computeDayEndMs(dateStr: string, offsetMinutes?: number): number {
    const [y, m, d] = dateStr.replace(/Z$/i, '').split('-').map(Number);
    if (typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)) {
        return Date.UTC(y, m - 1, d + 1) - offsetMinutes * MS_PER_MINUTE;
    }
    return new Date(y, m - 1, d + 1).getTime();
}

interface DailySessionEntryContext {
    dayStartMs: number;
    dayEndMs: number;
    running?: boolean;
    offsetMinutes?: number;
}

function createDailySessionEntry(
    target: SessionDurationSlice,
    ctx: DailySessionEntryContext,
): DailySessionEntry | null {
    const { startMs, endMs } = target;
    const { dayStartMs, dayEndMs, running = false, offsetMinutes } = ctx;
    if (startMs >= dayEndMs || endMs <= dayStartMs) return null;
    const visStart = Math.max(startMs, dayStartMs);
    const visEnd = Math.min(endMs, dayEndMs);
    const durationMs = visEnd - visStart;
    if (durationMs <= 0) return null;

    const isRunningTail = running && visEnd >= Date.now();
    const totalSessionDuration = endMs - startMs;
    const { manualMs, aiMs } = allocateSessionManualAi(target, durationMs, totalSessionDuration);

    return {
        startMs: visStart,
        endMs: visEnd,
        durationMs,
        startLabel: formatTime(visStart, offsetMinutes),
        endLabel: formatTime(visEnd, offsetMinutes),
        startUtcIso: toUtcIsoString(visStart),
        endUtcIso: toUtcIsoString(visEnd),
        manualMs,
        aiMs,
        isRunningTail,
    };
}

function collectDailyEntries(
    sessions: readonly TimeSession[],
    dayStartMs: number,
    dayEndMs: number,
    opts: NormalizedDailyDetailOptions,
): DailySessionEntry[] {
    const entries: DailySessionEntry[] = [];
    const entryCtx: DailySessionEntryContext = {
        dayStartMs,
        dayEndMs,
        running: false,
        offsetMinutes: opts.offsetMinutes,
    };

    for (const sessionItem of sessions) {
        if (sessionItem.endMs <= dayStartMs || sessionItem.startMs >= dayEndMs) continue;
        const entry = createDailySessionEntry(sessionItem, entryCtx);
        if (entry) entries.push(entry);
    }
    if (opts.currentSessionStartMs > 0) {
        const now = Date.now();
        const isAi = opts.currentActivityMode === 'ai';
        const runningDur = Math.max(0, now - opts.currentSessionStartMs);
        const curManual = isAi ? 0 : runningDur;
        const curAi = isAi ? runningDur : 0;
        const runningSlice: SessionDurationSlice = {
            startMs: opts.currentSessionStartMs,
            endMs: now,
            manualMs: curManual,
            aiMs: curAi,
        };
        const runningCtx: DailySessionEntryContext = {
            dayStartMs,
            dayEndMs,
            running: true,
            offsetMinutes: opts.offsetMinutes,
        };
        const entry = createDailySessionEntry(runningSlice, runningCtx);
        if (entry) entries.push(entry);
    }
    entries.sort((a, b) => a.startMs - b.startMs);
    return entries;
}

function buildHourlyBuckets(
    entries: readonly DailySessionEntry[],
    offsetMinutes?: number,
): HourlyBucket[] {
    const hourMap = new Map<number, { totalMs: number; manualMs: number; aiMs: number; count: number }>();
    for (const entry of entries) {
        addToHourly(hourMap, entry, offsetMinutes);
    }
    return Array.from(hourMap.entries())
        .map(([hour, v]) => {
            let manualRatio = 0;
            let aiRatio = 0;
            if (v.totalMs > 0) {
                manualRatio = Math.round((v.manualMs / v.totalMs) * PERCENT_BASE);
                manualRatio = Math.max(0, Math.min(PERCENT_BASE, manualRatio));
                aiRatio = PERCENT_BASE - manualRatio;
            }
            return {
                hour,
                totalMs: v.totalMs,
                manualMs: v.manualMs,
                aiMs: v.aiMs,
                manualRatio,
                aiRatio,
                sessionCount: v.count,
            };
        })
        .sort((a, b) => a.hour - b.hour);
}

/**
 * 获取指定日期的会话明细（支持双轨时长、活动模式透传与指定时区偏移）
 */
export function dailyDetail(
    sessions: readonly TimeSession[],
    dateStr: string,
    optsOrStartMs?: DailyDetailOptions | number,
    ...rest: (string | number | undefined)[]
): DailyDetail {
    const opts = parseDailyDetailOptions(optsOrStartMs, ...rest);
    const dayStartMs = parseLocalDate(dateStr, opts.offsetMinutes);
    const dayEndMs = computeDayEndMs(dateStr, opts.offsetMinutes);
    const entries = collectDailyEntries(sessions, dayStartMs, dayEndMs, opts);
    const hourly = buildHourlyBuckets(entries, opts.offsetMinutes);
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
