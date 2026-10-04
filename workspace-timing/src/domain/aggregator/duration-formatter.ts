/**
 * duration-formatter — 时长与时间排版纯函数
 *
 * 职责：将毫秒数转换为人类可读字符串或紧凑标签。
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
