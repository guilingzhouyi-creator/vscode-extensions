/**
 * Module: Journal Writer (增量追加日志写入控制器)
 * File Path: src/cache/JournalWriter.ts
 * Architecture Role: 缓存层事务协调者，将内存环形队列中的高频时间片批量持久化为磁盘增量日志，抵御宿主异常崩溃。
 * Dependencies & Triggers: 依赖 models、RingBuffer、ICacheStrategy、IJournalStore 及 Logger；由调度器心跳周期性触发。
 * Responsibilities: 缓冲时间切片；两阶段提交批量刷盘 (peekAll -> appendBatch -> advance)；截断清理与内存防数据复活；异步互斥保护。
 * Exit Semantics & Design Rationale: 两阶段提交保证底层 I/O 异常时缓冲无损并支持重试；截断时同步清空内存队列彻底消除脏数据复活。
 * Contract Invariant & Boundary Fallback: Two-phase commit invariants guarantee zero data loss on I/O failure; flush advance monotonicity ensures crash consistency fallback.
 */

import {
    TimeSlice,
    DEFAULT_RING_BUFFER_CAP,
    DEFAULT_JOURNAL_FLUSH_MS,
    MIN_JOURNAL_FLUSH_MS,
} from '../domain/models';
import { RingBuffer } from './RingBuffer';
import { ICacheStrategy, TimeBasedCacheStrategy } from './ICacheStrategy';
import { IJournalStore } from './IJournalStore';
import { LogLevel, log } from '../integration/Logger';

export class JournalWriter {
    private readonly ringBuffer: RingBuffer<TimeSlice>;
    private readonly storage: IJournalStore;
    private strategy: ICacheStrategy;
    private lastFlushTime: number = Date.now();
    private _flushingMutex: Promise<void> | null = null;

    constructor(
        storage: IJournalStore,
        capacity: number = DEFAULT_RING_BUFFER_CAP,
        strategy?: ICacheStrategy,
    ) {
        this.ringBuffer = new RingBuffer<TimeSlice>(capacity);
        this.storage = storage;
        this.strategy = strategy ?? new TimeBasedCacheStrategy(DEFAULT_JOURNAL_FLUSH_MS);
    }

    /** 写入一条时间片 */
    push(slice: TimeSlice): void {
        this.ringBuffer.push(slice);
    }

    /**
     * 运行期热更新 flush 间隔（替换策略实例）。
     */
    updateFlushInterval(ms: number): void {
        this.strategy = new TimeBasedCacheStrategy(Math.max(MIN_JOURNAL_FLUSH_MS, ms));
    }

    /**
     * 检查是否应该 flush，如果需要则执行。
     * 由 Scheduler 周期性调用。
     *
     * @returns 本次 flush 的条目数，0 表示未触发
     */
    async tryFlush(): Promise<number> {
        const context = {
            count: this.ringBuffer.count,
            capacity: this.ringBuffer.capacity,
            oldestMs: this.getOldestTimestamp(),
            newestMs: this.getNewestTimestamp(),
            elapsedSinceLastFlushMs: Date.now() - this.lastFlushTime,
        };

        if (!this.strategy.shouldFlush(context)) {
            return 0;
        }

        return this.flushNow();
    }

    /**
     * 执行一次 flush：两阶段提交（peekAll → appendBatch → advance）。
     * 失败时缓冲未动、时序不乱并向上抛出异常。
     */
    private async flushNow(): Promise<number> {
        while (this._flushingMutex) {
            await this._flushingMutex;
        }

        let releaseMutex: () => void = () => {};
        this._flushingMutex = new Promise<void>((resolve) => {
            releaseMutex = resolve;
        });

        try {
            const slices = this.ringBuffer.peekAll();
            if (slices.length === 0) {
                return 0;
            }

            await this.storage.appendBatch(slices);
            this.ringBuffer.advance(slices.length);

            this.lastFlushTime = Date.now();
            this.strategy.onFlushComplete(slices.length);

            log(LogLevel.Debug, `JournalWriter: flushed ${slices.length} slices`);
            return slices.length;
        } catch (err) {
            log(
                LogLevel.Error,
                `JournalWriter: append failed, ${this.ringBuffer.count} slices retained in buffer for retry: ${err}`,
            );
            throw err;
        } finally {
            this._flushingMutex = null;
            releaseMutex();
        }
    }

    /**
     * 清空 journal 文件与内存缓冲（全量存盘成功后调用）。
     * 同步清除 ringBuffer，防止截断前未落盘切片在下次心跳被重复写入导致数据复活。
     */
    async truncate(): Promise<void> {
        while (this._flushingMutex) {
            await this._flushingMutex;
        }

        let releaseMutex: () => void = () => {};
        this._flushingMutex = new Promise<void>((resolve) => {
            releaseMutex = resolve;
        });

        try {
            this.ringBuffer.clear();
            await this.storage.truncate();
            log(LogLevel.Debug, 'JournalWriter: journal truncated and memory buffer cleared');
        } finally {
            this._flushingMutex = null;
            releaseMutex();
        }
    }

    /** 强制 flush 所有未写入数据 */
    async flushAll(): Promise<number> {
        return this.flushNow();
    }

    private getOldestTimestamp(): number {
        const oldest = this.ringBuffer.peekOldest();
        return oldest ? oldest.timestamp : 0;
    }

    private getNewestTimestamp(): number {
        const newest = this.ringBuffer.peekNewest();
        return newest ? newest.timestamp : 0;
    }
}
