/**
 * JournalWriter — 日志写入器
 *
 * 职责：将 RingBuffer 中的 TimeSlice 批量追加到 journal 文件。
 * 边界：只写日志，不关心完整存储；落盘细节通过 IJournalStore 端口抽象（依赖倒置）。
 * 依赖：domain/models.ts, cache/RingBuffer.ts, cache/IJournalStore.ts
 *
 * 崩溃安全与两阶段提交：
 *   1. 预读（peekAll）：不推进 tail 指针，底层 I/O 失败时内存缓冲完好无损，严格保持原有时间戳升序；
 *   2. 确认（advance）：落盘成功后原子清退已写槽位；
 *   3. 截断安全（truncate）：清空 journal 文件时同步调用 ringBuffer.clear()，根除数据复活；
 *   4. 互斥保护（_flushingMutex）：防止 tryFlush 与 truncate 发生异步时序竞态。
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
