/**
 * IJournalStore — journal 存储端口（依赖倒置）
 *
 * JournalWriter 只依赖此窄接口，不感知具体落盘实现（当前为 persistence/JournalStorageProvider）。
 * 目的：
 *   1. 消除 cache → persistence 具体类的反向依赖；
 *   2. 单测可用纯 Node 假实现替换，脱离 VS Code 文件系统。
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
