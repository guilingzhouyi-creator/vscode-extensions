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
}
