/**
 * GlobalAggregator — 跨工作区累计同步服务
 *
 * 职责：在每次 fullSave 后将当前工作区的计时数据同步到 globalState。
 * 实现跨工作区时长汇总。
 *
 * 调用方：TimerOrchestrator.saveCheckpoint() 结束后触发
 */
import { GlobalStorageProvider } from '../persistence/GlobalStorageProvider';
export interface GlobalSnapshot {
    /** 所有工作区累计时长 (ms) */
    totalMs: number;
    /** 工作区数量 */
    workspaceCount: number;
    /** 各工作区列表 */
    workspaces: Array<{
        name: string;
        totalMs: number;
    }>;
}
export declare class GlobalAggregator {
    private readonly storage;
    private _cached;
    /** 上次已同步的本工作区 totalMs；相等则跳过整轮读写（增量守卫） */
    private _lastSyncedTotalMs;
    /** 后台刷新进行中标志：防止 globalStorage 失效时 refreshInBackground 被反复触发 */
    private _refreshing;
    constructor(storage: GlobalStorageProvider);
    /**
     * 将当前工作区的计时同步到全局存储
     * 由 TimerOrchestrator.saveCheckpoint() 结束后调用
     */
    sync(localTotalMs: number): Promise<void>;
    /** 获取全局快照 */
    snapshot(): Promise<GlobalSnapshot>;
    /** 清空全局数据 */
    reset(): Promise<void>;
    /**
     * 同步读取已缓存的全局快照（供高频面板刷新，避免每 tick 一次 async 往返）。
     * 缓存为空时返回 null——调用方应回退到空快照并触发一次后台刷新。
     */
    getCached(): GlobalSnapshot | null;
    /** 后台刷新缓存（fire-and-forget），不阻塞调用方 */
    refreshInBackground(): void;
}
