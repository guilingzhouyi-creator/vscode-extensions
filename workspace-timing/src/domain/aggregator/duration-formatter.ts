/**
 * Module: Duration Formatter (时长与绝对时间排版格式化器)
 * File Path: src/domain/aggregator/duration-formatter.ts
 * Architecture Role: 领域模型层表示格式化纯函数，负责将毫秒物理量纲转换为可读时长字符串与本地时间标签。
 * Dependencies & Triggers: 依赖 domain/models 时间转换常数；供状态栏、仪表盘、图表轴及日志展示调用。
 * Responsibilities: 格式化毫秒为完整易读文本 (formatDuration)；格式化为紧凑双单位文本 (formatDurationCompact)；格式化为本地 HH:mm 格式 (formatTime)。
 * Exit Semantics & Design Rationale: 纯函数零副作用；整除取模保证单位进位严格正确；高位优先渲染消除无效单位冗余。
 */

import { MS_PER_SECOND, SECONDS_PER_HOUR, SECONDS_PER_MINUTE } from '../models';

/**
 * 格式化毫秒为人类可读字符串
 * @example formatDuration(3661000) => "1h 1m 1s"
 */
export function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / MS_PER_SECOND);
    const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
    const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    const seconds = totalSeconds % SECONDS_PER_MINUTE;

    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);

    return parts.join(' ');
}

/**
 * 紧凑格式：只显示最显著的单位
 * @example formatDurationCompact(3661000) => "1h 1m"
 * @example formatDurationCompact(60000) => "1m 0s"
 */
export function formatDurationCompact(ms: number): string {
    const totalSeconds = Math.floor(ms / MS_PER_SECOND);
    const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
    const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    const seconds = totalSeconds % SECONDS_PER_MINUTE;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

/** 格式化时间戳为 HH:mm（本地时区） */
export function formatTime(ms: number): string {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}
