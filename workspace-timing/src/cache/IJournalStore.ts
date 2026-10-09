/**
 * Module: Journal Store Interface (增量日志存储端口)
 * File Path: src/cache/IJournalStore.ts
 * Architecture Role: 缓存与持久化边界的依赖倒置端口（DIP），使高层缓存控制器与底层文件系统落盘介质解耦。
 * Dependencies & Triggers: 仅依赖 domain/models 的 TimeSlice 数据结构；由 JournalWriter 驱动落盘与截断。
 * Responsibilities: 声明批量追加 appendBatch、全量回读 readJournal、安全截断 truncate 及存在性探针接口。
 * Exit Semantics & Design Rationale: 异步 Promise 契约保证非阻塞 I/O；消除缓存层对持久层具体实现的依赖，提升单测可测试性。
 */

import { TimeSlice } from '../domain/models';

export interface IJournalStore {
    /** 批量追加时间片 */
    appendBatch(slices: TimeSlice[]): Promise<void>;
    /** 读取全部 journal 行 */
    readJournal(): Promise<TimeSlice[]>;
    /** 清空 journal 文件 */
    truncate(): Promise<void>;
    /** journal 文件是否存在 */
    exists(): Promise<boolean>;
    /** 删除 journal 文件 */
    delete(): Promise<void>;
}
