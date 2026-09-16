/**
 * ICacheStrategy — 缓存策略接口
 *
 * 决定 flush 的触发时机，支持可插拔策略。
 */

import { DEFAULT_JOURNAL_FLUSH_MS } from '../domain/models';

export interface FlushContext {
    /** 当前缓存条目数 */
    count: number;
    /** 缓存容量 */
    capacity: number;
    /** 最旧条目的时间戳 (ms)，0 表示空 */
    oldestMs: number;
    /** 最新条目的时间戳 (ms)，0 表示空 */
    newestMs: number;
    /** 距离上次 flush 的毫秒数 */
    elapsedSinceLastFlushMs: number;
}

export interface ICacheStrategy {
    readonly name: string;
    /** 判断是否应该执行 flush */
    shouldFlush(context: FlushContext): boolean;
    /** flush 完成后回调 */
    onFlushComplete(writtenCount: number): void;
}

/**
 * 基于时间的缓存策略。
 * 固定时间间隔触发 flush。
 */
export class TimeBasedCacheStrategy implements ICacheStrategy {
    readonly name = 'time-based';
    private readonly intervalMs: number;

    constructor(intervalMs: number = DEFAULT_JOURNAL_FLUSH_MS) {
        this.intervalMs = intervalMs;
    }

    shouldFlush(context: FlushContext): boolean {
        return context.count > 0 && context.elapsedSinceLastFlushMs >= this.intervalMs;
    }

    onFlushComplete(_writtenCount: number): void {
        // no-op
    }
}
