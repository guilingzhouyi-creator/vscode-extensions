/**
 * Module: HistoryFolder — History Folding Engine (Pure Function)
 * File Path: src/domain/HistoryFolder.ts
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
 * 计算折叠截止点：今天本地零点 - retentionDays 天。
 * @returns 0 表示不折叠（retentionDays <= 0）
 */
export function foldCutoffStartMs(retentionDays: number, now = Date.now()): number {
    if (retentionDays <= 0) return 0;
    const d = new Date(now);
    const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return todayStart - retentionDays * MS_PER_DAY;
}

/** 深度拷贝既有日桶，防止原地突变与键注入污染 */
function cloneTotals(existingTotals?: DailyTotalsMap): DailyTotalsMap {
    const totals: DailyTotalsMap = {};
    for (const [k, v] of Object.entries(existingTotals ?? {})) {
        totals[k] = { ...v };
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

/** 按自然日分组并对超出 maxPerDay 的最旧条目执行截断拆分 */
function partitionByDailyLimit<T extends { startMs: number; endMs: number }>(
    items: readonly T[],
    maxPerDay: number,
): { kept: T[]; toFold: T[] } {
    if (maxPerDay <= 0 || items.length <= maxPerDay) {
        return { kept: [...items], toFold: [] };
    }
    const dayGroups = new Map<string, T[]>();
    for (const item of items) {
        if (!(item.endMs > item.startMs) || item.startMs <= 0) continue;
        const key = localDateStr(item.startMs);
        let list = dayGroups.get(key);
        if (!list) {
            list = [];
            dayGroups.set(key, list);
        }
        list.push(item);
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

/** 累加单个自然日工作切段到日桶表 */
function accumulateDaySegment(
    seg: { startMs: number; durationMs: number; manualMs?: number; aiMs?: number },
    isFirstSegment: boolean,
    totals: DailyTotalsMap,
): void {
    const key = localDateStr(seg.startMs);
    const bucket = totals[key] ?? { totalMs: 0, sessionCount: 0 };
    bucket.totalMs += seg.durationMs;
    bucket.manualMs = (bucket.manualMs ?? 0) + (typeof seg.manualMs === 'number' ? seg.manualMs : seg.durationMs);
    bucket.aiMs = (bucket.aiMs ?? 0) + (typeof seg.aiMs === 'number' ? seg.aiMs : 0);
    if (isFirstSegment) {
        bucket.sessionCount += 1;
    }
    totals[key] = bucket;
}

/** 将一组工作会话按自然日拆分累加进日桶表，返回成功折叠条数 */
function foldSessionsIntoTotals(sessions: readonly TimeSession[], totals: DailyTotalsMap): number {
    let count = 0;
    for (const s of sessions) {
        if (!(s.endMs > s.startMs) || s.startMs <= 0) continue;
        const segs = TimeAggregator.splitByNaturalDay(s.startMs, s.endMs, s.manualMs, s.aiMs);
        for (let i = 0; i < segs.length; i++) {
            accumulateDaySegment(segs[i], i === 0, totals);
        }
        count++;
    }
    return count;
}

/** 将一组空闲段按自然日拆分累加进日桶表，返回成功折叠条数 */
function foldIdleSessionsIntoTotals(idleSessions: readonly IdleSession[], totals: DailyTotalsMap): number {
    let count = 0;
    for (const is of idleSessions) {
        if (!(is.endMs > is.startMs) || is.startMs <= 0) continue;
        const segs = TimeAggregator.splitByNaturalDay(is.startMs, is.endMs);
        for (let i = 0; i < segs.length; i++) {
            const key = localDateStr(segs[i].startMs);
            const bucket = totals[key] ?? { totalMs: 0, sessionCount: 0 };
            bucket.idleTotalMs = (bucket.idleTotalMs ?? 0) + segs[i].durationMs;
            if (i === 0) {
                bucket.idleSessionCount = (bucket.idleSessionCount ?? 0) + 1;
            }
            totals[key] = bucket;
        }
        count++;
    }
    return count;
}

/** 将过期及超容量工作会话折叠进日桶 */
export function foldExpiredSessions(
    sessions: readonly TimeSession[],
    existingTotals: DailyTotalsMap | undefined,
    cutoffStartMs: number,
    maxSessions: number = 0,
): FoldResult {
    const totals = cloneTotals(existingTotals);
    if (sessions.length === 0) {
        return { keptSessions: [], updatedDailyTotals: totals, foldedSessionCount: 0 };
    }

    const { kept: timeFilteredKept, toFold } = filterByCutoff(sessions, cutoffStartMs);
    let kept = timeFilteredKept;
    let foldedCount = foldSessionsIntoTotals(toFold, totals);

    if (maxSessions > 0 && kept.length > maxSessions) {
        const excessCount = kept.length - maxSessions;
        const excessSessions = kept.slice(0, excessCount);
        kept = kept.slice(excessCount);
        foldedCount += foldSessionsIntoTotals(excessSessions, totals);
    }

    return { keptSessions: kept, updatedDailyTotals: totals, foldedSessionCount: foldedCount };
}

/** 跨周工作会话归零清理 */
export function prunePriorWeekSessions(
    sessions: readonly TimeSession[],
    totals: DailyTotalsMap,
    now: number,
): { kept: TimeSession[]; foldedCount: number } {
    const weekStart = TimeAggregator.weekStartStr(new Date(now));
    const weekStartMs = parseLocalDate(weekStart);
    const { kept, toFold } = filterByWeekStart(sessions, weekStartMs);
    const foldedCount = foldSessionsIntoTotals(toFold, totals);
    return { kept, foldedCount };
}

/** 单日工作会话上限截断（每日最高 maxPerDay 条） */
export function pruneDailyOverflowSessions(
    sessions: readonly TimeSession[],
    totals: DailyTotalsMap,
    maxPerDay: number,
): { kept: TimeSession[]; foldedCount: number } {
    const { kept, toFold } = partitionByDailyLimit(sessions, maxPerDay);
    const foldedCount = foldSessionsIntoTotals(toFold, totals);
    return { kept, foldedCount };
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

    const now = options?.now ?? Date.now();
    const pruneWeekly = options?.pruneWeekly ?? true;
    const maxPerDay = options?.maxPerDay ?? MAX_SESSIONS_PER_DAY;
    const maxSessions = options?.maxSessions ?? DEFAULT_MAX_SESSIONS;
    const retentionDays = options?.retentionDays ?? 0;

    let currentSessions = sessions;
    let totalFolded = 0;

    if (pruneWeekly) {
        const weekRes = prunePriorWeekSessions(currentSessions, totals, now);
        currentSessions = weekRes.kept;
        totalFolded += weekRes.foldedCount;
    }

    if (maxPerDay > 0) {
        const dailyRes = pruneDailyOverflowSessions(currentSessions, totals, maxPerDay);
        currentSessions = dailyRes.kept;
        totalFolded += dailyRes.foldedCount;
    }

    const cutoff = foldCutoffStartMs(retentionDays, now);
    const foldRes = foldExpiredSessions(currentSessions, totals, cutoff, maxSessions);
    totalFolded += foldRes.foldedSessionCount;

    return {
        keptSessions: foldRes.keptSessions,
        updatedDailyTotals: foldRes.updatedDailyTotals,
        foldedSessionCount: totalFolded,
    };
}

/** 将过期及超容量空闲段折叠进日桶 */
export function foldExpiredIdleSessions(
    idleSessions: readonly IdleSession[],
    existingTotals: DailyTotalsMap | undefined,
    cutoffStartMs: number,
    maxSessions: number = 0,
): { kept: IdleSession[]; updatedDailyTotals: DailyTotalsMap; foldedCount: number } {
    const totals = cloneTotals(existingTotals);
    if (idleSessions.length === 0) {
        return { kept: [], updatedDailyTotals: totals, foldedCount: 0 };
    }
    const { kept: timeFiltered, toFold } = filterByCutoff(idleSessions, cutoffStartMs);
    let kept = timeFiltered;
    let foldedCount = foldIdleSessionsIntoTotals(toFold, totals);
    if (maxSessions > 0 && kept.length > maxSessions) {
        const excessCount = kept.length - maxSessions;
        const excess = kept.slice(0, excessCount);
        kept = kept.slice(excessCount);
        foldedCount += foldIdleSessionsIntoTotals(excess, totals);
    }
    return { kept, updatedDailyTotals: totals, foldedCount };
}

/** 跨周空闲段归零清理 */
export function prunePriorWeekIdleSessions(
    idleSessions: readonly IdleSession[],
    totals: DailyTotalsMap,
    now: number,
): { kept: IdleSession[]; foldedCount: number } {
    const weekStart = TimeAggregator.weekStartStr(new Date(now));
    const weekStartMs = parseLocalDate(weekStart);
    const { kept, toFold } = filterByWeekStart(idleSessions, weekStartMs);
    const foldedCount = foldIdleSessionsIntoTotals(toFold, totals);
    return { kept, foldedCount };
}

/** 单日空闲段上限截断 */
export function pruneDailyOverflowIdleSessions(
    idleSessions: readonly IdleSession[],
    totals: DailyTotalsMap,
    maxPerDay: number,
): { kept: IdleSession[]; foldedCount: number } {
    const { kept, toFold } = partitionByDailyLimit(idleSessions, maxPerDay);
    const foldedCount = foldIdleSessionsIntoTotals(toFold, totals);
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
    const now = options?.now ?? Date.now();
    const pruneWeekly = options?.pruneWeekly ?? true;
    const maxPerDay = options?.maxPerDay ?? MAX_SESSIONS_PER_DAY;
    const maxSessions = options?.maxSessions ?? DEFAULT_MAX_SESSIONS;
    const retentionDays = options?.retentionDays ?? 0;

    let current = idleSessions;
    let totalFolded = 0;

    if (pruneWeekly) {
        const weekRes = prunePriorWeekIdleSessions(current, totals, now);
        current = weekRes.kept;
        totalFolded += weekRes.foldedCount;
    }

    if (maxPerDay > 0) {
        const dailyRes = pruneDailyOverflowIdleSessions(current, totals, maxPerDay);
        current = dailyRes.kept;
        totalFolded += dailyRes.foldedCount;
    }

    const cutoff = foldCutoffStartMs(retentionDays, now);
    const foldRes = foldExpiredIdleSessions(current, totals, cutoff, maxSessions);
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
    };
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
    const recycleResult = recycleSessions(data.sessions ?? [], data.dailyTotals, opt);
    const idleResult = recycleIdleSessions(data.idleSessions ?? [], recycleResult.updatedDailyTotals, opt);
    return {
        sessions: recycleResult.keptSessions,
        idleSessions: idleResult.keptIdleSessions,
        dailyTotals: idleResult.updatedDailyTotals,
        foldedSessionCount: recycleResult.foldedSessionCount,
        foldedIdleCount: idleResult.foldedIdleCount,
    };
}
