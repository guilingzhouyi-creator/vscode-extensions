/**
 * Module: Time Aggregator Facade (时间聚合领域门面)
 * File Path: src/domain/TimeAggregator.ts
 * Architecture Role: 领域模型层门面（Facade），聚合日期计算、时长排版、日报、周报与热力图五个子领域纯函数模块。
 * Dependencies & Triggers: 聚合 models 及 aggregator/* 子模块；由应用层 TimerEngine、RecoveryService 及展示层交互驱动。
 * Responsibilities: 对外统一暴露日期与时长计算接口；提供跨自然日切分 splitByNaturalDay 算法并保障时长守恒；不可变冻结门面对象。
 * Exit Semantics & Design Rationale: Object.freeze 确保门面对象运行时不可变；跨午夜切分严格保障 manualMs + aiMs 比例分配与总时长精确守恒。
 * Contract Invariant & Boundary Fallback: Temporal conservation invariant (sum of split durations == original duration; manualMs + aiMs == durationMs); day boundary midnight splitting guarantees zero time leakage.
 */

import type { TimeSession } from './models';

// 子领域纯函数与类型对外统一聚合导出
export * from './aggregator/date-utils';
export * from './aggregator/duration-formatter';
export * from './aggregator/daily-aggregator';
export * from './aggregator/weekly-aggregator';
export * from './aggregator/heatmap-aggregator';

import {
    todayStr,
    weekStartStr,
    weekKeyOf,
    eachDaySegment,
    toUtcIsoString,
    utcDateStr,
    formatTzDateStr,
    parseTzDateStartMs,
} from './aggregator/date-utils';
import {
    formatDuration,
    formatDurationCompact,
    formatTime,
} from './aggregator/duration-formatter';
import {
    todayMs,
    dailyStats,
    dailyDetail,
} from './aggregator/daily-aggregator';
import {
    weeklyStats,
    last7Days,
    fullDailySeries,
    weeklyTrend,
    weeklySummary,
} from './aggregator/weekly-aggregator';
import {
    heatmapDays,
    heatmapLevel,
} from './aggregator/heatmap-aggregator';

function allocateSegmentManualAi(
    segDuration: number,
    totalDuration: number,
    manualMs: number,
    remaining: { manual: number; ai: number },
): { segManual: number; segAi: number } {
    const ratio = totalDuration > 0 ? (segDuration / totalDuration) : 0;
    const segManual = Math.min(remaining.manual, Math.round(manualMs * ratio));
    const segAi = Math.min(remaining.ai, segDuration - segManual);
    remaining.manual -= segManual;
    remaining.ai -= segAi;
    return { segManual, segAi };
}

function adjustResidualManualAi(
    sessions: TimeSession[],
    remainingManual: number,
    remainingAi: number,
): void {
    if (sessions.length === 0) return;
    const last = sessions[sessions.length - 1];
    const newManual = (last.manualMs ?? 0) + remainingManual;
    const newAi = (last.aiMs ?? 0) + remainingAi;
    last.manualMs = newManual;
    last.aiMs = newAi;
    const total = newManual + newAi;
    if (total > 0) {
        last.durationMs = total;
    }
}

export interface SplitNaturalDayOptions {
    manualMs?: number;
    aiMs?: number;
    offsetMinutes?: number;
}

/**
 * 将区间 [startMs, endMs) 按自然日切分为 TimeSession 片段（支持指定时区偏移或参数对象）。
 * 若传入 manualMs / aiMs，各自然日切片按时长等比切分分配 manualMs 与 aiMs，确保切片守恒。
 */
export function splitByNaturalDay(
    startMs: number,
    endMs: number,
    optsOrManual?: SplitNaturalDayOptions | number,
    ...rest: (number | undefined)[]
): TimeSession[] {
    const out: TimeSession[] = [];
    if (!(startMs > 0) || !(endMs > startMs)) return out;
    const totalDuration = endMs - startMs;
    const isOpts = typeof optsOrManual === 'object' && optsOrManual !== null;
    const manualMs = isOpts ? optsOrManual.manualMs : optsOrManual;
    const aiMs = isOpts ? optsOrManual.aiMs : rest[0];
    const offsetMinutes = isOpts ? optsOrManual.offsetMinutes : rest[1];
    const hasManualAi = typeof manualMs === 'number' && typeof aiMs === 'number';
    const remaining = {
        manual: hasManualAi ? manualMs! : 0,
        ai: hasManualAi ? aiMs! : 0,
    };

    eachDaySegment(startMs, endMs, (_date, segStart, segEnd) => {
        const segDuration = segEnd - segStart;
        if (!hasManualAi) {
            out.push({ startMs: segStart, endMs: segEnd, durationMs: segDuration });
            return;
        }
        const { segManual, segAi } = allocateSegmentManualAi(
            segDuration,
            totalDuration,
            manualMs!,
            remaining,
        );
        out.push({
            startMs: segStart,
            endMs: segEnd,
            durationMs: segDuration,
            manualMs: segManual,
            aiMs: segAi,
        });
    }, offsetMinutes);

    if (hasManualAi) {
        adjustResidualManualAi(out, remaining.manual, remaining.ai);
    }
    return out;
}

/**
 * 时间聚合器统一门面对象（深层只读冻结，聚合 5 个子领域纯函数模块）
 */
export const TimeAggregator = Object.freeze({
    /** 今天的本地日期字符串 (YYYY-MM-DD) */
    todayStr,

    /** 格式化为标准 ISO-8601 UTC 时间戳字符串 (带 'Z' 标识) */
    toUtcIsoString,

    /** 获取 UTC 日期字符串 (YYYY-MM-DD) */
    utcDateStr,

    /** 格式化为指定时区的日期字符串 (YYYY-MM-DD) */
    formatTzDateStr,

    /** 解析 "YYYY-MM-DD" 在指定时区下的绝对零点时间戳 (ms) */
    parseTzDateStartMs,

    /** 将区间 [startMs, endMs) 按本地自然日切分为 TimeSession 片段（支持 manualMs / aiMs 双轨守恒切分与时区偏移） */
    splitByNaturalDay,

    /** 计算时间戳所在周的起始日（周一）本地日期字符串 */
    weekStartStr,

    /** 计算时间戳所在自然周的键（周一） */
    weekKeyOf,

    /** 展开自然日分段迭代器，供外部统计与图表遍历使用 */
    eachDaySegment,

    /** 格式化毫秒为人类可读字符串 (如 "1h 1m 1s") */
    formatDuration,

    /** 紧凑格式时长 (如 "1h 1m") */
    formatDurationCompact,

    /** 计算今日累计时长 (ms) */
    todayMs,

    /** 按日聚合会话列表 */
    dailyStats,

    /** 获取指定日期的会话明细 */
    dailyDetail,

    /** 按周聚合会话列表 */
    weeklyStats,

    /** 最近 7 天每日统计 */
    last7Days,

    /** 全历史日报序列（聚合导出用） */
    fullDailySeries,

    /** 近 N 周按周聚合趋势 */
    weeklyTrend,

    /** 周报文字摘要 */
    weeklySummary,

    /** 格式化绝对时间点 (如 "14:30:00") */
    formatTime,

    /** 活动时间线热力图 */
    heatmapDays,

    /** 根据当日累计时长计算 5 档热力图活跃等级 (0~4) */
    heatmapLevel,
});

export type TimeAggregator = typeof TimeAggregator;
