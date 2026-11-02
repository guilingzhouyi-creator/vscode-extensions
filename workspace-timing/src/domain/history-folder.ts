/**
 * Module: HistoryFolder — History Folding Engine (Pure Function)
 * File Path: src/domain/history-folder.ts
 * Architecture Role: Domain layer stateless folding and memory-bounded recycling engine
 * Dependencies & Triggers: domain/models.ts, domain/TimeAggregator.ts; triggered by SessionManager
 * Responsibilities: Fold expired and overflow work/idle sessions into dailyTotals buckets, recycle old week data, enforce bounded memory
 * Exit Semantics & Design Rationale: Pure calculation with zero I/O and zero VS Code dependencies; idempotent; preserves total durations and session counts across raw and aggregated layers.
 * Contract Invariant & Boundary: Conservation of Duration — sum(folded durations) + sum(kept durations) === original duration; never truncates valid time during bucket folding; fallback: non-positive or inverted slices (endMs <= startMs) pruned safely.
 */

import {
    TimeSession,
    IdleSession,
    DailyTotalsMap,
    DailyTotal,
    MAX_SESSIONS_PER_DAY,
    DEFAULT_MAX_SESSIONS,
    MS_PER_DAY,
} from './models';
import { TimeAggregator, localDateStr, parseLocalDate } from './TimeAggregator';

/**
 * 契约参数：历史折叠与容量裁剪配置选项 (HistoryFoldOptions)
 * 边界契约：各容量与天数上限字段为 0 时表示不设限；不变量：不修改既有历史日桶。
 */
export interface HistoryFoldOptions {
    /** 契约天数：原始会话保留天数（0 = 不限天数） */
    retentionDays?: number;
    /** 契约容量：原始会话最大保留条数（0 = 不限条数） */
    maxSessions?: number;
    /** 契约容量：单日最大保留条数（0 = 不限） */
    maxPerDay?: number;
    /** 策略契约：是否清理旧周会话（每周归零） */
    pruneWeekly?: boolean;
    /** 边界基准：当前时间戳，默认 Date.now() */
    now?: number;
    /** 契约时区：折叠与自然日切分所依据的时区偏移分钟数 */
    utcOffsetMinutes?: number;
}

/**
 * 契约输出：工作会话折叠计算结果 (FoldResult)
 * 不变量保证：keptSessions 与 updatedDailyTotals 满足时长守恒律。
 */
export interface FoldResult {
    /** 契约集合：保留在原始层的会话（未过期且未超容量） */
    keptSessions: TimeSession[];
    /** 契约日桶：合并后的完整日桶表（既有桶 + 本次折叠增量） */
    updatedDailyTotals: DailyTotalsMap;
    /** 计数契约：本次实际折叠的会话条数（0 = 无事发生，调用方可跳过写回） */
    foldedSessionCount: number;
}

/**
 * 契约输出：空闲会话折叠计算结果 (IdleFoldResult)
 * 不变量保证：保留空闲集合与日桶空闲累计满足时长守恒律。
 */
export interface IdleFoldResult {
    keptIdleSessions: IdleSession[];
    updatedDailyTotals: DailyTotalsMap;
    foldedIdleCount: number;
}

/**
 * 计算折叠截止点：今天零点 - retentionDays 天（支持指定时区偏移）。
 * @returns 0 表示不折叠（retentionDays <= 0）
 */
export function foldCutoffStartMs(retentionDays: number, now = Date.now(), offsetMinutes?: number): number {
    if (retentionDays <= 0) return 0;
    const today = localDateStr(now, offsetMinutes);
    const todayStart = parseLocalDate(today, offsetMinutes);
    return todayStart - retentionDays * MS_PER_DAY;
}

/** 单条日桶条目防御性拷贝，防止原地突变 */
function cloneDailyEntry(entry: DailyTotalsMap[string]): DailyTotalsMap[string] {
    return {
        totalMs: entry.totalMs,
        sessionCount: entry.sessionCount,
        manualMs: entry.manualMs,
        aiMs: entry.aiMs,
        idleTotalMs: entry.idleTotalMs,
        idleSessionCount: entry.idleSessionCount,
        recordedOffsetMinutes: entry.recordedOffsetMinutes,
    };
}

/** 深度拷贝既有日桶，防止原地突变与键注入污染 */
function cloneTotals(existingTotals?: DailyTotalsMap): DailyTotalsMap {
    if (!existingTotals) {
        return {};
    }
    const totals: DailyTotalsMap = {};
    for (const [k, v] of Object.entries(existingTotals)) {
        totals[k] = cloneDailyEntry(v);
    }
    return totals;
}

/** 依据截止时间戳过滤条目，清洗脏数据并划分保留与折叠集合 */
function filterByCutoff<T extends { startMs: number; endMs: number }>(
    items: readonly T[],
    cutoffStartMs: number,
): { kept: T[]; toFold: T[] } {
    const kept: T[] = [];
    const toFold: T[] = [];
    for (const item of items) {
        if (!(item.endMs > item.startMs) || item.startMs <= 0) continue;
        if (cutoffStartMs > 0 && item.endMs < cutoffStartMs) {
            toFold.push(item);
        } else {
            kept.push(item);
        }
    }
    return { kept, toFold };
}

/** 依据周起点时间戳过滤条目（旧周条目划分入 toFold） */
function filterByWeekStart<T extends { startMs: number; endMs: number }>(
    items: readonly T[],
    weekStartMs: number,
): { kept: T[]; toFold: T[] } {
    const kept: T[] = [];
    const toFold: T[] = [];
    for (const item of items) {
        if (!(item.endMs > item.startMs) || item.startMs <= 0) continue;
        if (item.endMs <= weekStartMs) {
            toFold.push(item);
        } else {
            kept.push(item);
        }
    }
    return { kept, toFold };
}

function getOrCreateBucket<T>(groups: Map<string, T[]>, key: string): T[] {
    const existing = groups.get(key);
    if (existing) {
        return existing;
    }
    const created: T[] = [];
    groups.set(key, created);
    return created;
}

/** 按自然日分组并对超出 maxPerDay 的最旧条目执行截断拆分 */
function partitionByDailyLimit<T extends { startMs: number; endMs: number }>(
    items: readonly T[],
    maxPerDay: number,
    offsetMinutes?: number,
): { kept: T[]; toFold: T[] } {
    if (maxPerDay <= 0 || items.length <= maxPerDay) {
        return { kept: [...items], toFold: [] };
    }
    const dayGroups = new Map<string, T[]>();
    for (const item of items) {
        if (!(item.endMs > item.startMs) || item.startMs <= 0) continue;
        const key = localDateStr(item.startMs, offsetMinutes);
        getOrCreateBucket(dayGroups, key).push(item);
    }
    const kept: T[] = [];
    const toFold: T[] = [];
    for (const list of dayGroups.values()) {
        if (list.length <= maxPerDay) {
            kept.push(...list);
            continue;
        }
        list.sort((a, b) => a.startMs - b.startMs);
        const excess = list.length - maxPerDay;
        toFold.push(...list.slice(0, excess));
        kept.push(...list.slice(excess));
    }
    kept.sort((a, b) => a.startMs - b.startMs);
    return { kept, toFold };
}

/** 获取或按需初始化指定日期的日汇总桶（并记录时区偏移） */
function getOrCreateDailyBucket(
    totals: DailyTotalsMap,
    startMs: number,
    offsetMinutes?: number,
): DailyTotal {
    const key = localDateStr(startMs, offsetMinutes);
    const bucket = totals[key] ?? { totalMs: 0, sessionCount: 0 };
    if (bucket.recordedOffsetMinutes === undefined) {
        bucket.recordedOffsetMinutes = typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)
            ? offsetMinutes
            : -new Date(startMs).getTimezoneOffset();
    }
    totals[key] = bucket;
    return bucket;
}

/** 累加单个自然日工作切段到日桶表 */
function accumulateDaySegment(
    seg: { startMs: number; durationMs: number; manualMs?: number; aiMs?: number },
    isFirstSegment: boolean,
    totals: DailyTotalsMap,
    offsetMinutes?: number,
): void {
    const bucket = getOrCreateDailyBucket(totals, seg.startMs, offsetMinutes);
    bucket.totalMs += seg.durationMs;
    bucket.manualMs = (bucket.manualMs ?? 0) + (typeof seg.manualMs === 'number' ? seg.manualMs : seg.durationMs);
    bucket.aiMs = (bucket.aiMs ?? 0) + (typeof seg.aiMs === 'number' ? seg.aiMs : 0);
    if (isFirstSegment) {
        bucket.sessionCount += 1;
    }
}

/** 将一组工作会话按自然日拆分累加进日桶表，返回成功折叠条数 */
function foldSessionsIntoTotals(
    sessions: readonly TimeSession[],
    totals: DailyTotalsMap,
    offsetMinutes?: number,
): number {
    let count = 0;
    for (const s of sessions) {
        if (!(s.endMs > s.startMs) || s.startMs <= 0) continue;
        const segs = TimeAggregator.splitByNaturalDay(s.startMs, s.endMs, s.manualMs, s.aiMs, offsetMinutes);
        for (let i = 0; i < segs.length; i++) {
            accumulateDaySegment(segs[i], i === 0, totals, offsetMinutes);
        }
        count++;
    }
    return count;
}

/** 累加单个自然日空闲切段到日桶表 */
function accumulateIdleDaySegment(
    seg: { startMs: number; durationMs: number },
    isFirstSegment: boolean,
    totals: DailyTotalsMap,
    offsetMinutes?: number,
): void {
    const bucket = getOrCreateDailyBucket(totals, seg.startMs, offsetMinutes);
    bucket.idleTotalMs = (bucket.idleTotalMs ?? 0) + seg.durationMs;
    if (isFirstSegment) {
        bucket.idleSessionCount = (bucket.idleSessionCount ?? 0) + 1;
    }
}

/** 将一组空闲段按自然日拆分累加进日桶表，返回成功折叠条数 */
function foldIdleSessionsIntoTotals(
    idleSessions: readonly IdleSession[],
    totals: DailyTotalsMap,
    offsetMinutes?: number,
): number {
    let count = 0;
    for (const is of idleSessions) {
        if (!(is.endMs > is.startMs) || is.startMs <= 0) continue;
        const segs = TimeAggregator.splitByNaturalDay(is.startMs, is.endMs, undefined, undefined, offsetMinutes);
        for (let i = 0; i < segs.length; i++) {
            accumulateIdleDaySegment(segs[i], i === 0, totals, offsetMinutes);
        }
        count++;
    }
    return count;
}

export interface FoldExpiredOptions {
    maxSessions?: number;
    offsetMinutes?: number;
}

/** 将过期及超容量工作会话折叠进日桶（支持指定时区偏移） */
export function foldExpiredSessions(
    sessions: readonly TimeSession[],
    existingTotals: DailyTotalsMap | undefined,
    cutoffStartMs: number,
    optsOrMaxSessions: FoldExpiredOptions | number = 0,
    ...rest: (number | undefined)[]
): FoldResult {
    const isOpts = typeof optsOrMaxSessions === 'object' && optsOrMaxSessions !== null;
    const maxSessions = isOpts ? (optsOrMaxSessions.maxSessions ?? 0) : optsOrMaxSessions;
    const offsetMinutes = isOpts ? optsOrMaxSessions.offsetMinutes : rest[0];
    const totals = cloneTotals(existingTotals);
    if (sessions.length === 0) {
        return { keptSessions: [], updatedDailyTotals: totals, foldedSessionCount: 0 };
    }

    const { kept: timeFilteredKept, toFold } = filterByCutoff(sessions, cutoffStartMs);
    let kept = timeFilteredKept;
    let foldedCount = foldSessionsIntoTotals(toFold, totals, offsetMinutes);

    if (maxSessions > 0 && kept.length > maxSessions) {
        const excessCount = kept.length - maxSessions;
        const excessSessions = kept.slice(0, excessCount);
        kept = kept.slice(excessCount);
        foldedCount += foldSessionsIntoTotals(excessSessions, totals, offsetMinutes);
    }

    return { keptSessions: kept, updatedDailyTotals: totals, foldedSessionCount: foldedCount };
}

/** 跨周工作会话归零清理（支持指定时区偏移） */
export function prunePriorWeekSessions(
    sessions: readonly TimeSession[],
    totals: DailyTotalsMap,
    now: number,
    offsetMinutes?: number,
): { kept: TimeSession[]; foldedCount: number } {
    const weekStart = TimeAggregator.weekStartStr(new Date(now), offsetMinutes);
    const weekStartMs = parseLocalDate(weekStart, offsetMinutes);
    const { kept, toFold } = filterByWeekStart(sessions, weekStartMs);
    const foldedCount = foldSessionsIntoTotals(toFold, totals, offsetMinutes);
    return { kept, foldedCount };
}

/** 单日工作会话上限截断（每日最高 maxPerDay 条，支持指定时区偏移） */
export function pruneDailyOverflowSessions(
    sessions: readonly TimeSession[],
    totals: DailyTotalsMap,
    maxPerDay: number,
    offsetMinutes?: number,
): { kept: TimeSession[]; foldedCount: number } {
    const { kept, toFold } = partitionByDailyLimit(sessions, maxPerDay, offsetMinutes);
    const foldedCount = foldSessionsIntoTotals(toFold, totals, offsetMinutes);
    return { kept, foldedCount };
}

interface ResolvedFoldConfig {
    now: number;
    pruneWeekly: boolean;
    maxPerDay: number;
    maxSessions: number;
    retentionDays: number;
    offsetMinutes?: number;
}

function resolveFoldConfig(options?: HistoryFoldOptions): ResolvedFoldConfig {
    return {
        now: options?.now ?? Date.now(),
        pruneWeekly: options?.pruneWeekly ?? true,
        maxPerDay: options?.maxPerDay ?? MAX_SESSIONS_PER_DAY,
        maxSessions: options?.maxSessions ?? DEFAULT_MAX_SESSIONS,
        retentionDays: options?.retentionDays ?? 0,
        offsetMinutes: options?.utcOffsetMinutes,
    };
}

/** 完整工作会话自动回收引擎 */
export function recycleSessions(
    sessions: readonly TimeSession[],
    existingTotals: DailyTotalsMap | undefined,
    options?: HistoryFoldOptions,
): FoldResult {
    const totals = cloneTotals(existingTotals);
    if (sessions.length === 0) {
        return { keptSessions: [], updatedDailyTotals: totals, foldedSessionCount: 0 };
    }

    const cfg = resolveFoldConfig(options);
    let currentSessions = sessions;
    let totalFolded = 0;

    if (cfg.pruneWeekly) {
        const weekRes = prunePriorWeekSessions(currentSessions, totals, cfg.now, cfg.offsetMinutes);
        currentSessions = weekRes.kept;
        totalFolded += weekRes.foldedCount;
    }

    if (cfg.maxPerDay > 0) {
        const dailyRes = pruneDailyOverflowSessions(currentSessions, totals, cfg.maxPerDay, cfg.offsetMinutes);
        currentSessions = dailyRes.kept;
        totalFolded += dailyRes.foldedCount;
    }

    const cutoff = foldCutoffStartMs(cfg.retentionDays, cfg.now, cfg.offsetMinutes);
    const foldRes = foldExpiredSessions(currentSessions, totals, cutoff, {
        maxSessions: cfg.maxSessions,
        offsetMinutes: cfg.offsetMinutes,
    });
    totalFolded += foldRes.foldedSessionCount;

    return {
        keptSessions: foldRes.keptSessions,
        updatedDailyTotals: foldRes.updatedDailyTotals,
        foldedSessionCount: totalFolded,
    };
}

/** 将过期及超容量空闲段折叠进日桶（支持指定时区偏移） */
export function foldExpiredIdleSessions(
    idleSessions: readonly IdleSession[],
    existingTotals: DailyTotalsMap | undefined,
    cutoffStartMs: number,
    optsOrMaxSessions: FoldExpiredOptions | number = 0,
    ...rest: (number | undefined)[]
): { kept: IdleSession[]; updatedDailyTotals: DailyTotalsMap; foldedCount: number } {
    const isOpts = typeof optsOrMaxSessions === 'object' && optsOrMaxSessions !== null;
    const maxSessions = isOpts ? (optsOrMaxSessions.maxSessions ?? 0) : optsOrMaxSessions;
    const offsetMinutes = isOpts ? optsOrMaxSessions.offsetMinutes : rest[0];
    const totals = cloneTotals(existingTotals);
    if (idleSessions.length === 0) {
        return { kept: [], updatedDailyTotals: totals, foldedCount: 0 };
    }
    const { kept: timeFiltered, toFold } = filterByCutoff(idleSessions, cutoffStartMs);
    let kept = timeFiltered;
    let foldedCount = foldIdleSessionsIntoTotals(toFold, totals, offsetMinutes);
    if (maxSessions > 0 && kept.length > maxSessions) {
        const excessCount = kept.length - maxSessions;
        const excess = kept.slice(0, excessCount);
        kept = kept.slice(excessCount);
        foldedCount += foldIdleSessionsIntoTotals(excess, totals, offsetMinutes);
    }
    return { kept, updatedDailyTotals: totals, foldedCount };
}

/** 跨周空闲段归零清理（支持指定时区偏移） */
export function prunePriorWeekIdleSessions(
    idleSessions: readonly IdleSession[],
    totals: DailyTotalsMap,
    now: number,
    offsetMinutes?: number,
): { kept: IdleSession[]; foldedCount: number } {
    const weekStart = TimeAggregator.weekStartStr(new Date(now), offsetMinutes);
    const weekStartMs = parseLocalDate(weekStart, offsetMinutes);
    const { kept, toFold } = filterByWeekStart(idleSessions, weekStartMs);
    const foldedCount = foldIdleSessionsIntoTotals(toFold, totals, offsetMinutes);
    return { kept, foldedCount };
}

/** 单日空闲段上限截断（支持指定时区偏移） */
export function pruneDailyOverflowIdleSessions(
    idleSessions: readonly IdleSession[],
    totals: DailyTotalsMap,
    maxPerDay: number,
    offsetMinutes?: number,
): { kept: IdleSession[]; foldedCount: number } {
    const { kept, toFold } = partitionByDailyLimit(idleSessions, maxPerDay, offsetMinutes);
    const foldedCount = foldIdleSessionsIntoTotals(toFold, totals, offsetMinutes);
    return { kept, foldedCount };
}

/** 完整空闲段自动回收引擎（控制有界内存） */
export function recycleIdleSessions(
    idleSessions: readonly IdleSession[],
    existingTotals: DailyTotalsMap | undefined,
    options?: HistoryFoldOptions,
): { keptIdleSessions: IdleSession[]; updatedDailyTotals: DailyTotalsMap; foldedIdleCount: number } {
    const totals = cloneTotals(existingTotals);
    if (idleSessions.length === 0) {
        return { keptIdleSessions: [], updatedDailyTotals: totals, foldedIdleCount: 0 };
    }
    const cfg = resolveFoldConfig(options);
    let current = idleSessions;
    let totalFolded = 0;

    if (cfg.pruneWeekly) {
        const weekRes = prunePriorWeekIdleSessions(current, totals, cfg.now, cfg.offsetMinutes);
        current = weekRes.kept;
        totalFolded += weekRes.foldedCount;
    }

    if (cfg.maxPerDay > 0) {
        const dailyRes = pruneDailyOverflowIdleSessions(current, totals, cfg.maxPerDay, cfg.offsetMinutes);
        current = dailyRes.kept;
        totalFolded += dailyRes.foldedCount;
    }

    const cutoff = foldCutoffStartMs(cfg.retentionDays, cfg.now, cfg.offsetMinutes);
    const foldRes = foldExpiredIdleSessions(current, totals, cutoff, {
        maxSessions: cfg.maxSessions,
        offsetMinutes: cfg.offsetMinutes,
    });
    totalFolded += foldRes.foldedCount;

    return {
        keptIdleSessions: foldRes.kept,
        updatedDailyTotals: foldRes.updatedDailyTotals,
        foldedIdleCount: totalFolded,
    };
}

/** 解析并标准化折叠选项 */
function parseFoldOptions(options: HistoryFoldOptions, defaultNow: number): HistoryFoldOptions {
    return {
        retentionDays: options.retentionDays || 0,
        maxSessions: options.maxSessions || 0,
        maxPerDay: options.maxPerDay || 0,
        pruneWeekly: options.pruneWeekly ?? false,
        now: options.now ?? defaultNow,
        utcOffsetMinutes: options.utcOffsetMinutes,
    };
}

/** 按自然日聚合原始有效会话历时（支持指定时区偏移） */
function aggregateRawDayTotals(sessions: readonly TimeSession[], offsetMinutes?: number): Map<string, number> {
    const dayTotals = new Map<string, number>();
    for (const s of sessions) {
        if (s.startMs > 0 && s.endMs > s.startMs) {
            TimeAggregator.eachDaySegment(s.startMs, s.endMs, (date, segStart, segEnd) => {
                dayTotals.set(date, (dayTotals.get(date) ?? 0) + (segEnd - segStart));
            }, offsetMinutes);
        }
    }
    return dayTotals;
}

/** 判定日桶是否属于镜像重复注入或异常超限条目 */
function isRedundantDailyBucket(bucketTotal: number, rawTotal?: number): boolean {
    if (rawTotal === undefined) {
        return false;
    }
    return bucketTotal === rawTotal || bucketTotal + rawTotal > MS_PER_DAY;
}

/**
 * 清除已在原始会话集合中重复注入或超限膨胀的日桶冗余条目（数据自愈不变量）。
 * 若日桶时长与 sessions 当日累计完全相等（镜像重复注入）或两者相加超过 24h，予以剔除；
 * 正常的单日部分折叠（两者不相等且总和未超 24h）予以完整保留。
 */
export function sanitizeOverlappingDailyTotals(
    dailyTotals: DailyTotalsMap | undefined,
    sessions: readonly TimeSession[],
    offsetMinutes?: number,
): DailyTotalsMap | undefined {
    if (!dailyTotals || sessions.length === 0) {
        return dailyTotals;
    }
    const dayTotals = aggregateRawDayTotals(sessions, offsetMinutes);
    const cleaned: DailyTotalsMap = {};
    let pruned = false;

    for (const [date, bucket] of Object.entries(dailyTotals)) {
        if (isRedundantDailyBucket(bucket.totalMs, dayTotals.get(date))) {
            pruned = true;
            continue;
        }
        cleaned[date] = bucket;
    }

    if (!pruned) {
        return dailyTotals;
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/**
 * 迁移与标准化（启动恢复、还原或运行期回收）：
 * 补齐 dailyTotals 并对工作会话与空闲会话执行双轨时间与容量双阈值折叠。
 * 内存有界性：原始会话与空闲记录均受严格条数与时间窗口约束，溢出部分无损沉淀至日桶。
 */
export function migrateToFolded(
    data: {
        sessions?: readonly TimeSession[];
        idleSessions?: readonly IdleSession[];
        dailyTotals?: DailyTotalsMap;
    },
    options: HistoryFoldOptions,
    now = Date.now(),
): {
    sessions: TimeSession[];
    idleSessions: IdleSession[];
    dailyTotals: DailyTotalsMap;
    foldedSessionCount: number;
    foldedIdleCount: number;
} {
    const opt = parseFoldOptions(options, now);
    const sanitizedTotals = sanitizeOverlappingDailyTotals(data.dailyTotals, data.sessions ?? [], opt.utcOffsetMinutes);
    const recycleResult = recycleSessions(data.sessions ?? [], sanitizedTotals, opt);
    const idleResult = recycleIdleSessions(data.idleSessions ?? [], recycleResult.updatedDailyTotals, opt);
    return {
        sessions: recycleResult.keptSessions,
        idleSessions: idleResult.keptIdleSessions,
        dailyTotals: idleResult.updatedDailyTotals,
        foldedSessionCount: recycleResult.foldedSessionCount,
        foldedIdleCount: idleResult.foldedIdleCount,
    };
}
