/**
 * Module: Date Utilities (跨时区日期计算与时间刻度纯函数)
 * File Path: src/domain/aggregator/date-utils.ts
 * Architecture Role: 领域模型层基础时间算法库，提供 UTC(Z) 规范化、时区感知日期转换、周期对齐与跨天分段服务。
 * Dependencies & Triggers: 依赖 domain/models；供所有聚合器（daily、weekly、heatmap）及门面高频调用。
 * Responsibilities: 生成 ISO-8601 UTC 带 Z 字符串；生成时区感知 YYYY-MM-DD 字符串；解析时区零点时间戳；计算周一基准对齐日期；按时区自然日分段迭代 eachDaySegment。
 * Exit Semantics & Design Rationale: 物理层统一基于绝对 UTC / Unix 毫秒量纲，表现层支持时区注入投影；MAX_EXPANSION_SEGMENTS (4000) 与单调前进守卫阻断死循环。
 * Contract Invariant & Boundary Fallback: Temporal monotonicity (segEnd > segStart); zero duration or inverted intervals (endMs <= startMs) return early; pure deterministic calculations.
 */

import { MS_PER_DAY } from '../models';

const DAYS_TO_SUNDAY = 6;
const MAX_EXPANSION_SEGMENTS = 4000;
const MS_PER_MINUTE = 60000;
const ISO_DATE_LENGTH = 10;
const PAD_ZERO = '0';
const PAD_WIDTH = 2;

/**
 * 格式化为标准 ISO-8601 UTC 时间戳字符串 (强制带 'Z' 标识)。
 * @example toUtcIsoString(1730480400000) => "2026-11-01T17:00:00.000Z"
 */
export function toUtcIsoString(ms: number = Date.now()): string {
    return new Date(ms).toISOString();
}

/**
 * 获取时间戳在 UTC 日历下的日期字符串 (YYYY-MM-DD)。
 * @example utcDateStr(1730480400000) => "2026-11-01"
 */
export function utcDateStr(ms: number = Date.now()): string {
    return new Date(ms).toISOString().slice(0, ISO_DATE_LENGTH);
}

/**
 * 解析 "YYYY-MM-DD"（或 "YYYY-MM-DDZ"）为 UTC 零点时间戳 (ms)。
 */
export function parseUtcDateStartMs(dateStr: string): number {
    const clean = dateStr.replace(/Z$/i, '');
    const [y, m, d] = clean.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

/**
 * 将时间戳格式化为指定时区的日期字符串 (YYYY-MM-DD)。
 * @param ms 物理时间戳 (ms)
 * @param offsetMinutes 时区偏移分钟数（缺省取当前宿主本地偏移，如东八区为 480，美西为 -420）
 */
export function formatTzDateStr(ms: number = Date.now(), offsetMinutes?: number): string {
    const offset = typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)
        ? offsetMinutes
        : -new Date(ms).getTimezoneOffset();
    const shifted = new Date(ms + offset * MS_PER_MINUTE);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(PAD_WIDTH, PAD_ZERO);
    const d = String(shifted.getUTCDate()).padStart(PAD_WIDTH, PAD_ZERO);
    return `${y}-${m}-${d}`;
}

/**
 * 格式化为本地时区日期字符串 (YYYY-MM-DD)。
 * 向后兼容：调用方无需传入 offsetMinutes 即使用宿主当前本地时区。
 */
export function localDateStr(ms: number = Date.now(), offsetMinutes?: number): string {
    return formatTzDateStr(ms, offsetMinutes);
}

/**
 * 解析 "YYYY-MM-DD" 在指定时区下的零点绝对时间戳 (ms)。
 * @param dateStr "YYYY-MM-DD"
 * @param offsetMinutes 时区偏移分钟数（缺省取当前宿主本地时区在当天的偏移）
 */
export function parseTzDateStartMs(dateStr: string, offsetMinutes?: number): number {
    const clean = dateStr.replace(/Z$/i, '');
    const [y, m, d] = clean.split('-').map(Number);
    if (typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)) {
        return Date.UTC(y, m - 1, d) - offsetMinutes * MS_PER_MINUTE;
    }
    return new Date(y, m - 1, d).getTime();
}

/**
 * 解析 "YYYY-MM-DD" 为该日本地零点时间戳。
 * 向后兼容既有接口。
 */
export function parseLocalDate(dateStr: string, offsetMinutes?: number): number {
    return parseTzDateStartMs(dateStr, offsetMinutes);
}

/** 今天的本地日期字符串 (YYYY-MM-DD) */
export function todayStr(offsetMinutes?: number): string {
    return formatTzDateStr(Date.now(), offsetMinutes);
}

/**
 * 计算时间戳所在自然周的起始日（周一）日期字符串。
 * @param d 日期对象或时间戳
 * @param offsetMinutes 时区偏移分钟数（缺省取当前宿主本地偏移）
 */
export function weekStartStr(d: Date | number, offsetMinutes?: number): string {
    const ms = typeof d === 'number' ? d : d.getTime();
    const offset = typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)
        ? offsetMinutes
        : -new Date(ms).getTimezoneOffset();
    const shiftedMs = ms + offset * MS_PER_MINUTE;
    const shifted = new Date(shiftedMs);
    const day = shifted.getUTCDay(); // 0 是周日
    const diff = day === 0 ? -DAYS_TO_SUNDAY : 1 - day;
    const mondayShiftedMs = shiftedMs + diff * MS_PER_DAY;
    const monday = new Date(mondayShiftedMs);
    const y = monday.getUTCFullYear();
    const m = String(monday.getUTCMonth() + 1).padStart(PAD_WIDTH, PAD_ZERO);
    const dayStr = String(monday.getUTCDate()).padStart(PAD_WIDTH, PAD_ZERO);
    return `${y}-${m}-${dayStr}`;
}

/**
 * 时间戳所在自然周的周一日期字符串 (YYYY-MM-DD)。
 */
export function weekKeyOf(ms: number, offsetMinutes?: number): string {
    return weekStartStr(ms, offsetMinutes);
}

/**
 * 将会话区间 [startMs, endMs) 按指定时区的自然日切分为若干段，
 * 对每一段调用 fn(日期字符串, 段开始, 段结束)。
 * 物理时钟单调前进保障：基于 UTC 绝对时间步进，彻底规避夏令时 (DST) 时钟回跳导致的死循环与时长丢失。
 *
 * @param startMs 起始物理毫秒戳
 * @param endMs 结束物理毫秒戳
 * @param fn 回调函数 (dateStr, segStartMs, segEndMs)
 * @param offsetMinutes 时区偏移分钟数（缺省取当前宿主本地时区在当天的偏移）
 */
export function eachDaySegment(
    startMs: number,
    endMs: number,
    fn: (date: string, segStartMs: number, segEndMs: number) => void,
    offsetMinutes?: number,
): void {
    if (!(startMs > 0) || !(endMs > startMs)) return;
    let cursor = startMs;
    let guard = 0;
    while (cursor < endMs && guard++ < MAX_EXPANSION_SEGMENTS) {
        const offset = typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)
            ? offsetMinutes
            : -new Date(cursor).getTimezoneOffset();
        const shiftedMs = cursor + offset * MS_PER_MINUTE;
        const d = new Date(shiftedMs);
        const nextMidnightShifted = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
        const nextMidnight = nextMidnightShifted - offset * MS_PER_MINUTE;
        let segEnd = Math.min(endMs, nextMidnight);
        if (segEnd <= cursor) {
            segEnd = Math.min(endMs, cursor + MS_PER_DAY);
        }
        fn(formatTzDateStr(cursor, offset), cursor, segEnd);
        cursor = segEnd;
    }
}
