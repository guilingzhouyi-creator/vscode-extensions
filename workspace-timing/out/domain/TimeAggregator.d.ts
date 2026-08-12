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
import { TimeSession } from './models';
import { DailyChartEntry } from './dashboard-types';
/**
 * 获取本地时区的日期字符串 (YYYY-MM-DD)
 * 禁止使用 toISOString() — 它返回 UTC，在中国 (UTC+8) 早上 8 点前会错位一天
 */
export declare function localDateStr(d: Date): string;
/** 取某时间戳之后「下一个」本地 00:00:00 时间戳（供午夜切分定位边界） */
export declare function nextMidnightMs(ts: number): number;
/**
 * 单次遍历，将「已结束会话」按时长归属拆分到对应自然日，返回 dateStr → ms 的 map。
 *
 * 一个会话最多跨数天；循环按「天」步进，仅累加与目标日有交集的部分，
 * 因此整体复杂度为 O(会话总跨度天数)，对常见短会话近似 O(n)，远优于逐日 × O(n)。
 * 活跃（进行中）会话不在此处处理，由调用方叠加活跃交集。
 */
export declare function finishedSessionsByDate(sessions: TimeSession[]): Map<string, number>;
export declare class TimeAggregator {
    /**
     * 计算今日累计时长 (ms)
     * = 已结束会话在今日的交集之和 + 活跃会话在今日内的部分
     *
     * ★ 跨日连续会话自动拆分：取 max(今日 00:00, 会话区间) 作为计时区间
     */
    static todayMs(sessions: TimeSession[], currentSessionStartMs: number): number;
    /** 基于已结束会话分桶结果计算今日累计（供缓存层复用） */
    static todayMsFromFinished(finishedByDate: Map<string, number>, currentSessionStartMs: number): number;
    /**
     * 计算本周累计时长 (ms) — 独立于每日明细
     * 本周 = 本周一 00:00:00（本地）到此刻，对每条会话取 [startMs, endMs] ∩ [周一00:00, now]
     */
    static thisWeekMs(sessions: TimeSession[], currentSessionStartMs: number): number;
    /** 基于已结束会话分桶结果计算本周累计（供缓存层复用） */
    static thisWeekMsFromFinished(finishedByDate: Map<string, number>, currentSessionStartMs: number): number;
    /**
     * 最近 7 天每日统计（用于柱状图）。
     * 单次遍历完成分桶后，仅对 7 个窗口做廉价叠加，避免 7×O(n) 重复扫描。
     */
    static last7Days(sessions: TimeSession[], currentSessionStartMs: number): DailyChartEntry[];
    /** 基于已结束会话分桶结果生成近 7 天统计（供缓存层复用） */
    static last7DaysFromFinished(finishedByDate: Map<string, number>, currentSessionStartMs: number): DailyChartEntry[];
    /**
     * 格式化毫秒为人类可读字符串
     * @example formatDuration(3661000) => "1h 1m 1s"
     */
    static formatDuration(ms: number): string;
    /**
     * 紧凑格式：只显示最显著的单位
     * @example formatDurationCompact(3661000) => "1h 1m"
     * @example formatDurationCompact(60000) => "1m 0s"
     */
    static formatDurationCompact(ms: number): string;
    /**
     * 双段格式：今日 + 累计
     * @example formatDual(1800000, 7200000) => "今日 30m · 累计 2h"
     */
    static formatDual(todayMs: number, totalMs: number): string;
}
