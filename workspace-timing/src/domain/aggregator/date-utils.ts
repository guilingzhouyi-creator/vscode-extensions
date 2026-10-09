/**
 * Module: Date Utilities (本地时区日期计算纯函数)
 * File Path: src/domain/aggregator/date-utils.ts
 * Architecture Role: 领域模型层基础时间算法库，提供一致的本地时区日期转换、周期对齐与跨天段切分服务。
 * Dependencies & Triggers: 依赖 domain/models；供所有聚合器（daily、weekly、heatmap）及门面高频调用。
 * Responsibilities: 生成本地时区 YYYY-MM-DD 字符串；解析本地零点时间戳；计算周一基准对齐日期；按本地自然日分段迭代 eachDaySegment。
 * Exit Semantics & Design Rationale: 统一本地时区口径，杜绝 UTC 导致的午夜偏离；MAX_EXPANSION_SEGMENTS (4000) 边界守卫阻断死循环。
 */

import { TimeSession } from '../models';

const DAYS_TO_SUNDAY = 6;
const MAX_EXPANSION_SEGMENTS = 4000;

/**
 * 将时间戳格式化为本地时区日期字符串 (YYYY-MM-DD)。
 * 全模块统一使用本地时区归桶，禁止使用 toISOString()（UTC）。
 */
export function localDateStr(ms: number = Date.now()): string {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** 解析 "YYYY-MM-DD" 为该日本地零点时间戳 */
export function parseLocalDate(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
}

/** 今天的本地日期字符串 (YYYY-MM-DD) */
export function todayStr(): string {
    return localDateStr(Date.now());
}

/** 计算时间戳所在周的起始日（周一）本地日期字符串 */
export function weekStartStr(d: Date): string {
    const day = d.getDay();
    const diff = day === 0 ? -DAYS_TO_SUNDAY : 1 - day; // 周日归上一周一
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
    return localDateStr(monday.getTime());
}

/** 时间戳所在自然日的周一日期字符串（本地时区） */
export function weekKeyOf(ms: number): string {
    return weekStartStr(new Date(ms));
}

/**
 * 将会话区间 [startMs, endMs) 按本地自然日切分为若干段，
 * 对每一段调用 fn(日期字符串, 段开始, 段结束)。
 */
export function eachDaySegment(
    startMs: number,
    endMs: number,
    fn: (date: string, segStartMs: number, segEndMs: number) => void,
): void {
    let cursor = startMs;
    let guard = 0;
    while (cursor < endMs && guard++ < MAX_EXPANSION_SEGMENTS) {
        const d = new Date(cursor);
        const nextDayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
        const segEnd = Math.min(endMs, nextDayStart);
        fn(localDateStr(cursor), cursor, segEnd);
        cursor = segEnd;
    }
}

/**
 * 将区间 [startMs, endMs) 按本地自然日切分为 TimeSession 片段。
 */
export function splitByNaturalDay(startMs: number, endMs: number): TimeSession[] {
    const out: TimeSession[] = [];
    if (!(startMs > 0) || !(endMs > startMs)) return out;
    eachDaySegment(startMs, endMs, (_date, segStart, segEnd) => {
        out.push({ startMs: segStart, endMs: segEnd, durationMs: segEnd - segStart });
    });
    return out;
}
