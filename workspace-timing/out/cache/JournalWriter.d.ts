/**
 * JournalWriter — 日志写入器
 *
 * 职责：将 RingBuffer 中的 TimeSlice 批量追加到 journal 文件
 * 边界：只写日志，不关心完整存储；文件操作通过 IStorageProvider 抽象
 * 依赖：domain/models.ts, cache/RingBuffer.ts, persistence/IStorageProvider.ts
 */
import { TimeSlice } from '../domain/models';
import { RingBuffer } from './RingBuffer';
import { ICacheStrategy } from './ICacheStrategy';
import { JournalStorageProvider } from '../persistence/JournalStorageProvider';
export declare class JournalWriter {
    private readonly ringBuffer;
    private readonly storage;
    private readonly strategy;
    private lastFlushTime;
    constructor(storage: JournalStorageProvider, capacity?: number, strategy?: ICacheStrategy);
    /** 获取内部 RingBuffer 引用（供 UI 读取最近数据） */
    get buffer(): RingBuffer<TimeSlice>;
    /** 写入一条时间片 */
    push(slice: TimeSlice): void;
    /**
     * 检查是否应该 flush，如果需要则执行。
     * 由 Scheduler 周期性调用。
     * @returns 本次 flush 的条目数，0 表示未触发
     */
    tryFlush(): Promise<number>;
    /** 清空 journal 文件（全量存盘成功后调用） */
    truncate(): void;
    /** 强制 flush 所有未写入数据 */
    flushAll(): Promise<number>;
    /** 获取最近 N 条时间片（用于 UI 活跃曲线） */
    peekLast(n: number): TimeSlice[];
    private getOldestTimestamp;
    private getNewestTimestamp;
}
