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

import { TimeSession, DailyTotalsMap } from './models';
import { TimeAggregator, localDateStr } from './TimeAggregator';

/**
 * 计算折叠截止点：今天本地零点 - retentionDays 天。
 * @returns 0 表示不折叠（retentionDays <= 0）
 */
export function foldCutoffStartMs(retentionDays: number, now = Date.now()): number {
    if (retentionDays <= 0) return 0;
    const d = new Date(now);
    const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return todayStart - retentionDays * 86400000;
}

export interface FoldResult {
    /** 保留在原始层的会话（未过期） */
    keptSessions: TimeSession[];
    /** 合并后的完整日桶表（既有桶 + 本次折叠增量） */
    updatedDailyTotals: DailyTotalsMap;
    /** 本次实际折叠的会话条数（0 = 无事发生，调用方可跳过写回） */
    foldedSessionCount: number;
}

/**
 * 将过期会话折叠进日桶。
 * @param sessions 当前全部原始会话
 * @param existingTotals 既有沉淀桶（可为 undefined）
 * @param cutoffStartMs 折叠截止点（当日零点时刻戳）；0 = 不折叠
 */
export function foldExpiredSessions(
    sessions: TimeSession[],
    existingTotals: DailyTotalsMap | undefined,
    cutoffStartMs: number,
): FoldResult {
    const kept: TimeSession[] = [];
    const totals: DailyTotalsMap = {};
    for (const [k, v] of Object.entries(existingTotals ?? {})) {
        totals[k] = { totalMs: v.totalMs, sessionCount: v.sessionCount };
    }
    let foldedCount = 0;

    if (cutoffStartMs > 0) {
        for (const s of sessions) {
            if (!(s.endMs > s.startMs) || s.startMs <= 0) continue; // 脏数据清除
            if (s.endMs >= cutoffStartMs) {
                kept.push(s);
                continue;
            }
            const segs = TimeAggregator.splitByNaturalDay(s.startMs, s.endMs);
            for (let i = 0; i < segs.length; i++) {
                const key = localDateStr(segs[i].startMs);
                const bucket = totals[key] ?? { totalMs: 0, sessionCount: 0 };
                bucket.totalMs += segs[i].durationMs;
                if (i === 0) bucket.sessionCount += 1;
                totals[key] = bucket;
            }
            foldedCount++;
        }
    } else {
        kept.push(...sessions);
    }

    return { keptSessions: kept, updatedDailyTotals: totals, foldedSessionCount: foldedCount };
}

/**
 * 迁移到当前版本语义（v1→v2 或任意来源数据的标准化）：补齐 dailyTotals 并执行一次折叠。
 * 幂等：对同一数据重复调用结果不变；retentionDays<=0 时仅补空表。
 */
export function migrateToFolded(
    data: { sessions?: TimeSession[]; dailyTotals?: DailyTotalsMap },
    retentionDays: number,
    now = Date.now(),
): { sessions: TimeSession[]; dailyTotals: DailyTotalsMap; foldedSessionCount: number } {
    const cutoff = foldCutoffStartMs(retentionDays, now);
    const res = foldExpiredSessions(data.sessions ?? [], data.dailyTotals, cutoff);
    return {
        sessions: res.keptSessions,
        dailyTotals: res.updatedDailyTotals,
        foldedSessionCount: res.foldedSessionCount,
    };
}
