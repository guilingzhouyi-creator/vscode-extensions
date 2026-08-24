"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.foldCutoffStartMs = foldCutoffStartMs;
exports.foldExpiredSessions = foldExpiredSessions;
exports.migrateToFolded = migrateToFolded;
const TimeAggregator_1 = require("./TimeAggregator");
function localDateStr(ms) {
    const d = new Date(ms);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}
/**
 * 计算折叠截止点：今天本地零点 - retentionDays 天。
 * @returns 0 表示不折叠（retentionDays <= 0）
 */
function foldCutoffStartMs(retentionDays, now = Date.now()) {
    if (retentionDays <= 0)
        return 0;
    const d = new Date(now);
    const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return todayStart - retentionDays * 86400000;
}
/**
 * 将过期会话折叠进日桶。
 * @param sessions 当前全部原始会话
 * @param existingTotals 既有沉淀桶（可为 undefined）
 * @param cutoffStartMs 折叠截止点（当日零点时刻戳）；0 = 不折叠
 */
function foldExpiredSessions(sessions, existingTotals, cutoffStartMs) {
    const kept = [];
    const totals = {};
    for (const [k, v] of Object.entries(existingTotals ?? {})) {
        totals[k] = { totalMs: v.totalMs, sessionCount: v.sessionCount };
    }
    let foldedCount = 0;
    if (cutoffStartMs > 0) {
        for (const s of sessions) {
            if (!(s.endMs > s.startMs) || s.startMs <= 0)
                continue; // 脏数据清除
            if (s.endMs >= cutoffStartMs) {
                kept.push(s);
                continue;
            }
            const segs = TimeAggregator_1.TimeAggregator.splitByNaturalDay(s.startMs, s.endMs);
            for (let i = 0; i < segs.length; i++) {
                const key = localDateStr(segs[i].startMs);
                const bucket = totals[key] ?? { totalMs: 0, sessionCount: 0 };
                bucket.totalMs += segs[i].durationMs;
                if (i === 0)
                    bucket.sessionCount += 1;
                totals[key] = bucket;
            }
            foldedCount++;
        }
    }
    else {
        kept.push(...sessions);
    }
    return { keptSessions: kept, updatedDailyTotals: totals, foldedSessionCount: foldedCount };
}
/**
 * 迁移到当前版本语义（v1→v2 或任意来源数据的标准化）：补齐 dailyTotals 并执行一次折叠。
 * 幂等：对同一数据重复调用结果不变；retentionDays<=0 时仅补空表。
 */
function migrateToFolded(data, retentionDays, now = Date.now()) {
    const cutoff = foldCutoffStartMs(retentionDays, now);
    const res = foldExpiredSessions(data.sessions ?? [], data.dailyTotals, cutoff);
    return {
        sessions: res.keptSessions,
        dailyTotals: res.updatedDailyTotals,
        foldedSessionCount: res.foldedSessionCount,
    };
}
//# sourceMappingURL=HistoryFolder.js.map