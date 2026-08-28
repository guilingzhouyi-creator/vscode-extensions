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
    private strategy: ICacheStrategy;
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

    /** 写入一条时间片 */
    push(slice: TimeSlice): void {
        this.ringBuffer.push(slice);
    }

    /**
     * 运行期热更新 flush 间隔（替换策略实例；Scheduler 心跳不再持有独立定时器，
     * flush 节奏完全由策略裁决——见 Scheduler.start 的契约说明）。
     */
    updateFlushInterval(ms: number): void {
        this.strategy = new TimeBasedCacheStrategy(Math.max(1000, ms));
    }

    /**
     * 检查是否应该 flush，如果需要则执行。
     * 由 Scheduler 周期性调用。
     *
     * ★ 失败语义：append 失败时把切片**退回 RingBuffer**（数据不丢），
     *   不推进 lastFlushTime（下轮尽快重试），并向调用方抛出。
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
     * 执行一次 flush：取出切片 → 追加到 journal。
     * 失败时切片退回缓冲并抛出（由调用方决定重试节奏）。
     */
    private async flushNow(): Promise<number> {
        const slices = this.ringBuffer.flush();
        if (slices.length === 0) return 0;

        try {
            await this.storage.appendBatch(slices);
        } catch (err) {
            // 数据不落盘就绝不丢弃：退回缓冲（若期间有新切片入队，
            // 退回切片会排在其后，时序轻微错位但优于丢失；缓冲满时覆盖最旧）。
            // ★ 必须按原顺序正序回退：flush() 按 tail→head 取出（旧→新），
            //   若倒序 push，缓冲内整批切片顺序反转（最新变最旧），
            //   下次 flush 后 journal 中时间片顺序错乱，回放分组会误判断点。
            for (let i = 0; i < slices.length; i++) {
                this.ringBuffer.push(slices[i]);
            }
            log(LogLevel.Error,
                `JournalWriter: append failed, ${slices.length} slices restored to buffer for retry`);
            throw err;
        }

        this.lastFlushTime = Date.now();
        this.strategy.onFlushComplete(slices.length);

        log(LogLevel.Debug, `JournalWriter: flushed ${slices.length} slices`);

        return slices.length;
    }

    /**
     * 清空 journal 文件（全量存盘成功后调用）。
     * ★ 返回 Promise：此前为 fire-and-forget，调用方 await 无效，
     *   存在 truncate 未完成时后续 append 先落盘的竞态（数据复活/丢失）。
     * 失败向上抛出（IJournalStore 契约），调用方需感知清空是否成功。
     */
    async truncate(): Promise<void> {
        await this.storage.truncate();
        log(LogLevel.Debug, 'JournalWriter: journal truncated');
    }

    /** 强制 flush 所有未写入数据（失败语义同 tryFlush：退回缓冲并抛出） */
    async flushAll(): Promise<number> {
        return this.flushNow();
    }

    private getOldestTimestamp(): number {
        // O(1)：直接读最旧一条，避免全量拷贝缓冲
        const oldest = this.ringBuffer.peekOldest();
        return oldest ? oldest.timestamp : 0;
    }

    private getNewestTimestamp(): number {
        // O(1)：直接读最新一条，避免全量拷贝缓冲
        const newest = this.ringBuffer.peekNewest();
        return newest ? newest.timestamp : 0;
    }
}
