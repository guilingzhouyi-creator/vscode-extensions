/**
 * JournalWriter — 日志写入器
 *
 * 职责：将 RingBuffer 中的 TimeSlice 批量追加到 journal 文件
 * 边界：只写日志，不关心完整存储；落盘细节通过 IJournalStore 端口抽象（依赖倒置）
 * 依赖：domain/models.ts, cache/RingBuffer.ts, cache/IJournalStore.ts
 */
import { TimeSlice } from '../domain/models';
import { RingBuffer } from './RingBuffer';
import { ICacheStrategy } from './ICacheStrategy';
import { IJournalStore } from './IJournalStore';
export declare class JournalWriter {
    private readonly ringBuffer;
    private readonly storage;
    private readonly strategy;
    private lastFlushTime;
    constructor(storage: IJournalStore, capacity?: number, strategy?: ICacheStrategy);
    /** 获取内部 RingBuffer 引用（供 UI 读取最近数据） */
    get buffer(): RingBuffer<TimeSlice>;
    /** 写入一条时间片 */
    push(slice: TimeSlice): void;
    /**
     * 检查是否应该 flush，如果需要则执行。
     * 由 Scheduler 周期性调用。
     *
     * ★ 失败语义：append 失败时把切片**退回 RingBuffer**（数据不丢），
     *   不推进 lastFlushTime（下轮尽快重试），并向调用方抛出。
     *
     * @returns 本次 flush 的条目数，0 表示未触发
     */
    tryFlush(): Promise<number>;
    /**
     * 执行一次 flush：取出切片 → 追加到 journal。
     * 失败时切片退回缓冲并抛出（由调用方决定重试节奏）。
     */
    private flushNow;
    /**
     * 清空 journal 文件（全量存盘成功后调用）。
     * ★ 返回 Promise：此前为 fire-and-forget，调用方 await 无效，
     *   存在 truncate 未完成时后续 append 先落盘的竞态（数据复活/丢失）。
     * 失败向上抛出（IJournalStore 契约），调用方需感知清空是否成功。
     */
    truncate(): Promise<void>;
    /** 强制 flush 所有未写入数据（失败语义同 tryFlush：退回缓冲并抛出） */
    flushAll(): Promise<number>;
    /** 获取最近 N 条时间片（用于 UI 活跃曲线） */
    peekLast(n: number): TimeSlice[];
    private getOldestTimestamp;
    private getNewestTimestamp;
}
