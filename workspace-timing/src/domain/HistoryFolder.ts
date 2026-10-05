/**
 * HistoryFolder — 历史折叠引擎（纯函数）
 *
 * 职责：把超出保留窗的原始会话按自然日折叠进 dailyTotals 沉淀层，
 *       使"永久全历史统计"与"有界存储/查询成本"并存。
 *
 * 边界：纯计算，无 I/O、无 VS Code 依赖；幂等——调用方以返回的
 *       keptSessions 替换原列表并持久化 updatedDailyTotals 后，
 *       同一批会话不会二次折叠（它们已不在输入里）。
 *
 * 折叠规则：
 *   - 以 endMs < cutoffStartMs 判定整条过期（不切割会话，kept 恒为合法区间）；
 *   - 过期会话经 splitByNaturalDay 拆段按日累加；
 *   - sessionCount 记入会话起始自然日（与 TimeAggregator.dailyStats 口径一致）；
 *   - start/end 非法的脏数据直接清除（与聚合层跳过行为对齐）。
 */

import { TimeSession, DailyTotalsMap, MAX_SESSIONS_PER_DAY, DEFAULT_MAX_SESSIONS, MS_PER_DAY } from './models';
import { TimeAggregator, localDateStr, parseLocalDate } from './TimeAggregator';

export interface HistoryFoldOptions {
    /** 原始会话保留天数（0 = 不限天数） */
    retentionDays?: number;
    /** 原始会话最大保留条数（0 = 不限条数） */
    maxSessions?: number;
    /** 单日最大保留条数（0 = 不限） */
    maxPerDay?: number;
    /** 是否清理旧周会话（每周归零） */
    pruneWeekly?: boolean;
    /** 当前时间戳，默认 Date.now() */
    now?: number;
}

export type FoldOptions = HistoryFoldOptions;
export type RecycleOptions = HistoryFoldOptions;

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

export interface FoldResult {
    /** 保留在原始层的会话（未过期且未超容量） */
    keptSessions: TimeSession[];
    /** 合并后的完整日桶表（既有桶 + 本次折叠增量） */
    updatedDailyTotals: DailyTotalsMap;
    /** 本次实际折叠的会话条数（0 = 无事发生，调用方可跳过写回） */
    foldedSessionCount: number;
}

/** 将一组会话按自然日拆分累加进日桶表，返回成功折叠条数 */
function foldSessionsIntoTotals(sessions: readonly TimeSession[], totals: DailyTotalsMap): number {
    let count = 0;
    for (const s of sessions) {
        if (!(s.endMs > s.startMs) || s.startMs <= 0) continue; // 脏数据清除
        const segs = TimeAggregator.splitByNaturalDay(s.startMs, s.endMs);
        for (let i = 0; i < segs.length; i++) {
            const key = localDateStr(segs[i].startMs);
            const bucket = totals[key] ?? { totalMs: 0, sessionCount: 0 };
            bucket.totalMs += segs[i].durationMs;
            if (i === 0) bucket.sessionCount += 1;
            totals[key] = bucket;
        }
        count++;
    }
    return count;
}

/**
 * 将过期及超容量会话折叠进日桶（双阈值无损回收）。
 * @param sessions 当前全部原始会话
 * @param existingTotals 既有沉淀桶（可为 undefined）
 * @param cutoffStartMs 折叠截止点（当日零点时刻戳）；0 = 不按时间折叠
 * @param maxSessions 原始会话最大保留条数；0 = 不按条数折叠
 */
/**
 * 依据时间窗过滤会话，清洗脏数据并划分保留与折叠会话
 */
function filterSessionsByCutoff(
    sessions: readonly TimeSession[],
    cutoffStartMs: number,
): { kept: TimeSession[]; toFold: TimeSession[] } {
    const kept: TimeSession[] = [];
    const toFold: TimeSession[] = [];

    for (const s of sessions) {
        if (!(s.endMs > s.startMs) || s.startMs <= 0) continue; // 脏数据清除
        if (cutoffStartMs > 0 && s.endMs < cutoffStartMs) {
            toFold.push(s);
        } else {
            kept.push(s);
        }
    }
    return { kept, toFold };
}

/**
 * 将过期及超容量会话折叠进日桶（双阈值无损回收）。
 * @param sessions 当前全部原始会话
 * @param existingTotals 既有沉淀桶（可为 undefined）
 * @param cutoffStartMs 折叠截止点（当日零点时刻戳）；0 = 不按时间折叠
 * @param maxSessions 原始会话最大保留条数；0 = 不按条数折叠
 */
export function foldExpiredSessions(
    sessions: readonly TimeSession[],
    existingTotals: DailyTotalsMap | undefined,
    cutoffStartMs: number,
    maxSessions: number = 0,
): FoldResult {
    const totals: DailyTotalsMap = {};
    for (const [k, v] of Object.entries(existingTotals ?? {})) {
        totals[k] = { totalMs: v.totalMs, sessionCount: v.sessionCount };
    }

    // 空会话快退
    if (sessions.length === 0) {
        return { keptSessions: [], updatedDailyTotals: totals, foldedSessionCount: 0 };
    }

    // 1. 时间窗阈值过滤（retentionDays）
    const { kept: timeFilteredKept, toFold } = filterSessionsByCutoff(sessions, cutoffStartMs);
    let kept = timeFilteredKept;
    let foldedCount = foldSessionsIntoTotals(toFold, totals);

    // 2. 条数容量阈值截断（maxSessions）
    // 若剩余会话仍超出 maxSessions 容量，将最旧的超出部分按 FIFO 折叠入日桶
    if (maxSessions > 0 && kept.length > maxSessions) {
        const excessCount = kept.length - maxSessions;
        const excessSessions = kept.slice(0, excessCount);
        kept = kept.slice(excessCount);
        foldedCount += foldSessionsIntoTotals(excessSessions, totals);
    }

    return { keptSessions: kept, updatedDailyTotals: totals, foldedSessionCount: foldedCount };
}

/**
 * 跨周会话归零清理：
 * 将早于当前自然周周一零点的旧周会话折叠进 dailyTotals，
 * 从 sessions 中全量清除归零，新周会话从 0 开始累计。
 */
export function prunePriorWeekSessions(
    sessions: readonly TimeSession[],
    totals: DailyTotalsMap,
    now: number,
): { kept: TimeSession[]; foldedCount: number } {
    const weekStart = TimeAggregator.weekStartStr(new Date(now));
    const weekStartMs = parseLocalDate(weekStart);

    const kept: TimeSession[] = [];
    const toFold: TimeSession[] = [];

    for (const s of sessions) {
        if (!(s.endMs > s.startMs) || s.startMs <= 0) continue; // 脏数据清除
        if (s.endMs <= weekStartMs) {
            toFold.push(s);
        } else {
            kept.push(s);
        }
    }

    const foldedCount = foldSessionsIntoTotals(toFold, totals);
    return { kept, foldedCount };
}

/**
 * 单日会话上限截断（每日最高 20 条）：
 * 同一自然日内超过 maxPerDay 的会话，按 FIFO 将最远（最旧）的会话折叠进 dailyTotals，
 * 仅保留最新 20 条。
 */
export function pruneDailyOverflowSessions(
    sessions: readonly TimeSession[],
    totals: DailyTotalsMap,
    maxPerDay: number,
): { kept: TimeSession[]; foldedCount: number } {
    if (maxPerDay <= 0 || sessions.length <= maxPerDay) {
        return { kept: [...sessions], foldedCount: 0 };
    }

    const dayGroups = new Map<string, TimeSession[]>();
    for (const s of sessions) {
        if (!(s.endMs > s.startMs) || s.startMs <= 0) continue;
        const key = localDateStr(s.startMs);
        let list = dayGroups.get(key);
        if (!list) {
            list = [];
            dayGroups.set(key, list);
        }
        list.push(s);
    }

    const kept: TimeSession[] = [];
    const toFold: TimeSession[] = [];

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
    const foldedCount = foldSessionsIntoTotals(toFold, totals);
    return { kept, foldedCount };
}

/**
 * 完整会话自动回收引擎（纯函数）：
 * 1. 跨周全条目归零（每周统一清理旧周会话入 dailyTotals）；
 * 2. 单日会话上限（每日最高 20 条，淘汰最远条目入 dailyTotals）；
 * 3. 时间窗与总容量上限截断。
 *
 * 数学守恒定理：dailyStats(keptSessions) ∪ updatedDailyTotals ≡ dailyStats(originalSessions)
 * 会话总时长在裁剪前后严格无损，会话计数不重不漏。
 *
 * @param sessions - 待处理会话序列
 * @param existingTotals - 既有日汇总桶集合
 * @param options - 回收策略选项（跨周/单日上限/容量阈值）
 * @returns 截断后保留的会话集与更新后的日汇总桶
 */
export function recycleSessions(
    sessions: readonly TimeSession[],
    existingTotals: DailyTotalsMap | undefined,
    options?: HistoryFoldOptions,
): FoldResult {
    const totals: DailyTotalsMap = {};
    for (const [k, v] of Object.entries(existingTotals ?? {})) {
        totals[k] = { totalMs: v.totalMs, sessionCount: v.sessionCount };
    }

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

    // 1. 每周统一清理全条目归零（旧周会话折叠进日桶并从内存移除）
    if (pruneWeekly) {
        const weekRes = prunePriorWeekSessions(currentSessions, totals, now);
        currentSessions = weekRes.kept;
        totalFolded += weekRes.foldedCount;
    }

    // 2. 单日会话上限（每日最高 20 条，淘汰最远条目入日桶）
    if (maxPerDay > 0) {
        const dailyRes = pruneDailyOverflowSessions(currentSessions, totals, maxPerDay);
        currentSessions = dailyRes.kept;
        totalFolded += dailyRes.foldedCount;
    }

    // 3. 时间窗与总容量上限截断
    const cutoff = foldCutoffStartMs(retentionDays, now);
    const foldRes = foldExpiredSessions(currentSessions, totals, cutoff, maxSessions);
    totalFolded += foldRes.foldedSessionCount;

    return {
        keptSessions: foldRes.keptSessions,
        updatedDailyTotals: foldRes.updatedDailyTotals,
        foldedSessionCount: totalFolded,
    };
}

/**
 * 解析并标准化折叠选项，消除外部多态入参在主流程的分支复杂度。
 */
function parseFoldOptions(options: number | HistoryFoldOptions, defaultNow: number): HistoryFoldOptions {
    if (typeof options === 'number') {
        return { retentionDays: options, now: defaultNow };
    }
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
 * 补齐 dailyTotals 并执行时间与容量双阈值折叠。
 * 幂等：对同一数据重复调用结果不变。
 */
export function migrateToFolded(
    data: { sessions?: readonly TimeSession[]; dailyTotals?: DailyTotalsMap },
    options: number | HistoryFoldOptions,
    now = Date.now(),
): { sessions: TimeSession[]; dailyTotals: DailyTotalsMap; foldedSessionCount: number } {
    const opt = parseFoldOptions(options, now);
    const res = recycleSessions(data.sessions ?? [], data.dailyTotals, opt);
    return {
        sessions: res.keptSessions,
        dailyTotals: res.updatedDailyTotals,
        foldedSessionCount: res.foldedSessionCount,
    };
}
