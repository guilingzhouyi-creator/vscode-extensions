/**
 * Module: Cache Strategy (缓存刷盘决策策略接口与实现)
 * File Path: src/cache/ICacheStrategy.ts
 * Architecture Role: 缓存控制层策略模式契约，解耦内存缓冲数据量、时间跨度判定与具体日志刷盘动作。
 * Dependencies & Triggers: 依赖 domain/models 常量；被 JournalWriter 在周期性调度检查点中求值触发。
 * Responsibilities: 声明 FlushContext 缓冲度量上下文；声明 ICacheStrategy 决策接口；实现基于时间间隔的 TimeBasedCacheStrategy 默认策略。
 * Exit Semantics & Design Rationale: 策略对象无内部可变状态；shouldFlush 基于时间戳与条目数判定，空缓冲严格短路拒绝刷盘。
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

    /** 基于时间的策略无需处理刷盘后统计，此处保持空实现以满足接口契约 */
    onFlushComplete(_writtenCount: number): void {}
}
