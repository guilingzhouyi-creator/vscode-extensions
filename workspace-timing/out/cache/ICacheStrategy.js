"use strict";
/**
 * ICacheStrategy — 缓存策略接口
 *
 * 决定 flush 的触发时机，支持可插拔策略。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HybridCacheStrategy = exports.SizeBasedCacheStrategy = exports.TimeBasedCacheStrategy = void 0;
/**
 * 基于时间的缓存策略。
 * 固定时间间隔触发 flush。
 */
class TimeBasedCacheStrategy {
    constructor(intervalMs = 10000) {
        this.name = 'time-based';
        this.intervalMs = intervalMs;
    }
    shouldFlush(context) {
        return context.count > 0 && context.elapsedSinceLastFlushMs >= this.intervalMs;
    }
    onFlushComplete(_writtenCount) {
        // no-op
    }
}
exports.TimeBasedCacheStrategy = TimeBasedCacheStrategy;
/**
 * 基于缓冲区容量的缓存策略。
 * 缓冲区达到一定比例时触发 flush。
 */
class SizeBasedCacheStrategy {
    /** @param thresholdRatio 0.0 ~ 1.0，达到该比例时 flush */
    constructor(thresholdRatio = 0.5) {
        this.name = 'size-based';
        this.thresholdRatio = Math.max(0, Math.min(1, thresholdRatio));
    }
    shouldFlush(context) {
        if (context.capacity <= 0)
            return false;
        return (context.count / context.capacity) >= this.thresholdRatio;
    }
    onFlushComplete(_writtenCount) {
        // no-op
    }
}
exports.SizeBasedCacheStrategy = SizeBasedCacheStrategy;
/**
 * 混合策略：时间和大小双重条件，谁先触发用谁。
 */
class HybridCacheStrategy {
    constructor(intervalMs = 10000, thresholdRatio = 0.5) {
        this.name = 'hybrid';
        this.timeBased = new TimeBasedCacheStrategy(intervalMs);
        this.sizeBased = new SizeBasedCacheStrategy(thresholdRatio);
    }
    shouldFlush(context) {
        return this.timeBased.shouldFlush(context) || this.sizeBased.shouldFlush(context);
    }
    onFlushComplete(writtenCount) {
        this.timeBased.onFlushComplete(writtenCount);
        this.sizeBased.onFlushComplete(writtenCount);
    }
}
exports.HybridCacheStrategy = HybridCacheStrategy;
//# sourceMappingURL=ICacheStrategy.js.map