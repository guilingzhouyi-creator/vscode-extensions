"use strict";
/**
 * TimeAggregator — 时间聚合器
 *
 * 职责：对 TimeSession[] 进行统计聚合
 * 边界：纯计算，不关心数据来源和存储
 * 依赖：仅依赖 models.ts 与 dashboard-types.ts
 *
 * ⚠️ 所有日期计算统一使用本地时区，禁止使用 toISOString()（UTC）
 *
 * 关键修正（0.3.2）：
 *   - 已结束的「跨午夜会话」此前被整段计入其起始日（todayMs / last7Days），
 *     导致当日/近 7 天数值虚高、跨日部分丢失。现已统一改用会话与目标日
 *     窗口的「交集」计算，与 thisWeekMs 的口径一致。
 *   - 新增 finishedSessionsByDate() 单次遍历完成分桶，供上层做结果缓存，
 *     避免每次刷新重复 O(n) 扫描。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeAggregator = void 0;
exports.localDateStr = localDateStr;
exports.nextMidnightMs = nextMidnightMs;
exports.finishedSessionsByDate = finishedSessionsByDate;
const models_1 = require("./models");
/**
 * 获取本地时区的日期字符串 (YYYY-MM-DD)
 * 禁止使用 toISOString() — 它返回 UTC，在中国 (UTC+8) 早上 8 点前会错位一天
 */
function localDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** 取某时间戳所在自然日的 00:00:00 本地时间戳 */
function startOfDayMs(ts) {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
/** 取某时间戳之后「下一个」本地 00:00:00 时间戳（供午夜切分定位边界） */
function nextMidnightMs(ts) {
    return startOfDayMs(ts) + models_1.MS_PER_DAY;
}
/** 取本周一 00:00:00 本地时间戳 */
function startOfMondayMs() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=周日, 1=周一, ..., 6=周六
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysSinceMonday);
    monday.setHours(0, 0, 0, 0);
    return monday.getTime();
}
/**
 * 计算 [startMs, endMs] 与 [winStart, winEnd] 两区间的交集毫秒数。
 * 这是所有「按日 / 按周」统计的单一事实来源，保证口径一致。
 */
function overlapMs(startMs, endMs, winStart, winEnd) {
    const s = Math.max(winStart, startMs);
    const e = Math.min(winEnd, endMs);
    return e > s ? e - s : 0;
}
/**
 * 单次遍历，将「已结束会话」按时长归属拆分到对应自然日，返回 dateStr → ms 的 map。
 *
 * 一个会话最多跨数天；循环按「天」步进，仅累加与目标日有交集的部分，
 * 因此整体复杂度为 O(会话总跨度天数)，对常见短会话近似 O(n)，远优于逐日 × O(n)。
 * 活跃（进行中）会话不在此处处理，由调用方叠加活跃交集。
 */
function finishedSessionsByDate(sessions) {
    const map = new Map();
    if (sessions.length === 0)
        return map;
    for (const s of sessions) {
        if (s.startMs <= 0 || s.endMs <= s.startMs)
            continue;
        let cursor = startOfDayMs(s.startMs);
        const lastDay = startOfDayMs(s.endMs);
        // 安全上限：单会话最多跨 400 天，避免异常数据导致死循环
        let guard = 0;
        while (cursor <= lastDay && guard++ < 400) {
            const dayEnd = cursor + models_1.MS_PER_DAY;
            const ov = overlapMs(s.startMs, s.endMs, cursor, dayEnd);
            if (ov > 0) {
                const key = localDateStr(new Date(cursor));
                map.set(key, (map.get(key) ?? 0) + ov);
            }
            cursor += models_1.MS_PER_DAY;
        }
    }
    return map;
}
class TimeAggregator {
    /**
     * 计算今日累计时长 (ms)
     * = 已结束会话在今日的交集之和 + 活跃会话在今日内的部分
     *
     * ★ 跨日连续会话自动拆分：取 max(今日 00:00, 会话区间) 作为计时区间
     */
    static todayMs(sessions, currentSessionStartMs) {
        return this.todayMsFromFinished(finishedSessionsByDate(sessions), currentSessionStartMs);
    }
    /** 基于已结束会话分桶结果计算今日累计（供缓存层复用） */
    static todayMsFromFinished(finishedByDate, currentSessionStartMs) {
        const dayStart = startOfDayMs(Date.now());
        const todayKey = localDateStr(new Date(dayStart));
        let total = finishedByDate.get(todayKey) ?? 0;
        if (currentSessionStartMs > 0) {
            total += overlapMs(currentSessionStartMs, Date.now(), dayStart, dayStart + models_1.MS_PER_DAY);
        }
        return total;
    }
    /**
     * 计算本周累计时长 (ms) — 独立于每日明细
     * 本周 = 本周一 00:00:00（本地）到此刻，对每条会话取 [startMs, endMs] ∩ [周一00:00, now]
     */
    static thisWeekMs(sessions, currentSessionStartMs) {
        return this.thisWeekMsFromFinished(finishedSessionsByDate(sessions), currentSessionStartMs);
    }
    /** 基于已结束会话分桶结果计算本周累计（供缓存层复用） */
    static thisWeekMsFromFinished(finishedByDate, currentSessionStartMs) {
        const now = Date.now();
        const weekStart = startOfMondayMs();
        // 已结束会话：汇总落在 [周一, 今日] 日期范围内的分桶
        let total = 0;
        for (const [dateStr, ms] of finishedByDate) {
            const [y, m, d] = dateStr.split('-').map(Number);
            const dayStart = new Date(y, m - 1, d).getTime();
            if (dayStart >= weekStart && dayStart <= startOfDayMs(now)) {
                total += ms;
            }
        }
        // 活跃会话在本周内的部分
        if (currentSessionStartMs > 0) {
            total += overlapMs(currentSessionStartMs, now, weekStart, now);
        }
        return total;
    }
    /**
     * 自然周每日明细（用于「周报」面板与周报导出）。
     * - fullWeek=false（默认）：本周一 00:00 → 今日（本周至今，随周中增长）。
     * - fullWeek=true：本周一 00:00 → 本周日 24:00（完整自然周，未来天时长为 0）。
     */
    static weekDailyBreakdown(sessions, currentSessionStartMs, fullWeek = false) {
        return this.weekDailyFromFinished(finishedSessionsByDate(sessions), currentSessionStartMs, fullWeek);
    }
    /** 基于已结束会话分桶结果生成自然周每日明细（供缓存层复用） */
    static weekDailyFromFinished(finishedByDate, currentSessionStartMs, fullWeek = false) {
        const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
        const now = new Date();
        const todayStart = startOfDayMs(now.getTime());
        const weekStart = startOfMondayMs();
        const lastDay = fullWeek ? weekStart + 6 * models_1.MS_PER_DAY : todayStart;
        const result = [];
        let cursor = weekStart;
        let guard = 0;
        while (cursor <= lastDay && guard++ < 10) {
            const dateStr = localDateStr(new Date(cursor));
            const d = new Date(cursor);
            let totalMs = finishedByDate.get(dateStr) ?? 0;
            if (currentSessionStartMs > 0) {
                totalMs += overlapMs(currentSessionStartMs, Date.now(), cursor, cursor + models_1.MS_PER_DAY);
            }
            result.push({
                label: dateStr.slice(5),
                weekday: weekdayNames[d.getDay()],
                totalMs,
                dateStr,
            });
            cursor += models_1.MS_PER_DAY;
        }
        return result;
    }
    /**
     * 上一自然周（上周一 00:00 → 上周日 24:00）累计时长 (ms)。
     * 活跃会话属于本周，上周不计入活跃部分，仅汇总已结束会话分桶。
     */
    static lastWeekMs(sessions) {
        return this.lastWeekMsFromFinished(finishedSessionsByDate(sessions));
    }
    /** 基于已结束会话分桶结果计算上一自然周累计（供缓存层复用） */
    static lastWeekMsFromFinished(finishedByDate) {
        const weekStart = startOfMondayMs();
        const lastWeekStart = weekStart - 7 * models_1.MS_PER_DAY;
        const lastWeekEnd = weekStart; // 本周一 00:00 = 上周日 24:00（上周结束边界，不含）
        let total = 0;
        for (const [dateStr, ms] of finishedByDate) {
            const [y, m, d] = dateStr.split('-').map(Number);
            const dayStart = new Date(y, m - 1, d).getTime();
            if (dayStart >= lastWeekStart && dayStart < lastWeekEnd) {
                total += ms;
            }
        }
        return total;
    }
    /**
     * 格式化毫秒为人类可读字符串
     * @example formatDuration(3661000) => "1h 1m 1s"
     */
    static formatDuration(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const parts = [];
        if (hours > 0)
            parts.push(`${hours}h`);
        if (minutes > 0)
            parts.push(`${minutes}m`);
        parts.push(`${seconds}s`);
        return parts.join(' ');
    }
    /**
     * 紧凑格式：只显示最显著的单位
     * @example formatDurationCompact(3661000) => "1h 1m"
     * @example formatDurationCompact(60000) => "1m 0s"
     */
    static formatDurationCompact(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        if (hours > 0)
            return `${hours}h ${minutes}m`;
        if (minutes > 0)
            return `${minutes}m ${seconds}s`;
        return `${seconds}s`;
    }
    /**
     * 双段格式：今日 + 累计
     * @example formatDual(1800000, 7200000) => "今日 30m · 累计 2h"
     */
    static formatDual(todayMs, totalMs) {
        return `今日 ${TimeAggregator.formatDurationCompact(todayMs)} · 累计 ${TimeAggregator.formatDurationCompact(totalMs)}`;
    }
}
exports.TimeAggregator = TimeAggregator;
//# sourceMappingURL=TimeAggregator.js.map