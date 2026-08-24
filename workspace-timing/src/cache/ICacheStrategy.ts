/**
 * ICacheStrategy — 缓存策略接口
 *
 * 决定 flush 的触发时机，支持可插拔策略。
 */

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

    constructor(intervalMs: number = 10000) {
        this.intervalMs = intervalMs;
    }

    shouldFlush(context: FlushContext): boolean {
        return context.count > 0 && context.elapsedSinceLastFlushMs >= this.intervalMs;
    }

    onFlushComplete(_writtenCount: number): void {
        // no-op
    }
}

/**
 * 基于缓冲区容量的缓存策略。
 * 缓冲区达到一定比例时触发 flush。
 */
export class SizeBasedCacheStrategy implements ICacheStrategy {
    readonly name = 'size-based';
    private readonly thresholdRatio: number;

    /** @param thresholdRatio 0.0 ~ 1.0，达到该比例时 flush */
    constructor(thresholdRatio: number = 0.5) {
        this.thresholdRatio = Math.max(0, Math.min(1, thresholdRatio));
    }

    shouldFlush(context: FlushContext): boolean {
        if (context.capacity <= 0) return false;
        return (context.count / context.capacity) >= this.thresholdRatio;
    }

    onFlushComplete(_writtenCount: number): void {
        // no-op
    }
}

/**
 * 混合策略：时间和大小双重条件，谁先触发用谁。
 */
export class HybridCacheStrategy implements ICacheStrategy {
    readonly name = 'hybrid';
    private readonly timeBased: TimeBasedCacheStrategy;
    private readonly sizeBased: SizeBasedCacheStrategy;

    constructor(intervalMs: number = 10000, thresholdRatio: number = 0.5) {
        this.timeBased = new TimeBasedCacheStrategy(intervalMs);
        this.sizeBased = new SizeBasedCacheStrategy(thresholdRatio);
    }

    shouldFlush(context: FlushContext): boolean {
        return this.timeBased.shouldFlush(context) || this.sizeBased.shouldFlush(context);
    }

    onFlushComplete(writtenCount: number): void {
        this.timeBased.onFlushComplete(writtenCount);
        this.sizeBased.onFlushComplete(writtenCount);
    }
}
