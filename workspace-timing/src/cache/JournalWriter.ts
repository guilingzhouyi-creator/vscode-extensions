/**
 * JournalWriter — 日志写入器
 *
 * 职责：将 RingBuffer 中的 TimeSlice 批量追加到 journal 文件
 * 边界：只写日志，不关心完整存储；落盘细节通过 IJournalStore 端口抽象（依赖倒置）
 * 依赖：domain/models.ts, cache/RingBuffer.ts, cache/IJournalStore.ts
 */

import { TimeSlice, DEFAULT_RING_BUFFER_CAP, DEFAULT_JOURNAL_FLUSH_MS } from '../domain/models';
import { RingBuffer } from './RingBuffer';
import { ICacheStrategy, TimeBasedCacheStrategy } from './ICacheStrategy';
import { IJournalStore } from './IJournalStore';
import { LogLevel, log } from '../integration/Logger';

export class JournalWriter {
    private readonly ringBuffer: RingBuffer<TimeSlice>;
    private readonly storage: IJournalStore;
    private readonly strategy: ICacheStrategy;
    private lastFlushTime: number = Date.now();

    constructor(
        storage: IJournalStore,
        capacity: number = DEFAULT_RING_BUFFER_CAP,
        strategy?: ICacheStrategy,
    ) {
        this.ringBuffer = new RingBuffer<TimeSlice>(capacity);
        this.storage = storage;
        this.strategy = strategy ?? new TimeBasedCacheStrategy(DEFAULT_JOURNAL_FLUSH_MS);
    }

    /** 获取内部 RingBuffer 引用（供 UI 读取最近数据） */
    get buffer(): RingBuffer<TimeSlice> {
        return this.ringBuffer;
    }

    /** 写入一条时间片 */
    push(slice: TimeSlice): void {
        this.ringBuffer.push(slice);
    }

    /**
     * 检查是否应该 flush，如果需要则执行。
     * 由 Scheduler 周期性调用。
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

        const slices = this.ringBuffer.flush();
        if (slices.length === 0) return 0;

        await this.storage.appendBatch(slices);
        this.lastFlushTime = Date.now();
        this.strategy.onFlushComplete(slices.length);

        log(LogLevel.Debug, `JournalWriter: flushed ${slices.length} slices`);

        return slices.length;
    }

    /**
     * 清空 journal 文件（全量存盘成功后调用）。
     * ★ 返回 Promise：此前为 fire-and-forget，调用方 await 无效，
     *   存在 truncate 未完成时后续 append 先落盘的竞态（数据复活/丢失）。
     */
    async truncate(): Promise<void> {
        await this.storage.truncate();
        log(LogLevel.Debug, 'JournalWriter: journal truncated');
    }

    /** 强制 flush 所有未写入数据 */
    async flushAll(): Promise<number> {
        const slices = this.ringBuffer.flush();
        if (slices.length === 0) return 0;

        await this.storage.appendBatch(slices);
        this.lastFlushTime = Date.now();
        return slices.length;
    }

    /** 获取最近 N 条时间片（用于 UI 活跃曲线） */
    peekLast(n: number): TimeSlice[] {
        return this.ringBuffer.peekLast(n);
    }

    private getOldestTimestamp(): number {
        // O(1)：直接读最旧一条，避免此前 peekLast(count) 全量拷贝缓冲
        const oldest = this.ringBuffer.peekOldest();
        return oldest ? oldest.timestamp : 0;
    }

    private getNewestTimestamp(): number {
        // O(1)：直接读最新一条，避免此前 peekLast(count) 全量拷贝缓冲
        const newest = this.ringBuffer.peekNewest();
        return newest ? newest.timestamp : 0;
    }
}
