/**
 * GlobalAggregator — 跨工作区累计同步服务
 *
 * 职责：在每次 fullSave 后将当前工作区的计时数据同步到 globalState。
 * 实现跨工作区时长汇总。
 *
 * 调用方：Scheduler 周期全量存盘回调（onFullSaved）、TimerOrchestrator.saveNow()/newPeriod()
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
    /** sync 进行中标志（防重入：并发 load→modify→save 会互相覆盖丢失写入） */
    private _syncing;
    /**
     * 上次已成功同步的本工作区 totalMs；相等则跳过整轮读→改→写。
     * ★ 在 doSync 成功后才记账：失败不更新，下轮 checkpoint 会重试（避免旧值卡死跳过）。
     */
    private _lastSyncedTotalMs;
    /**
     * 陈旧条目回收阈值：超过该天数未同步的工作区不再计入跨工作区累计。
     * 背景：globalState 跨版本持久共享，历史遗留的失联工作区（已删除/改道的项目、
     * 旧双计数 bug 时代的膨胀值）会永远计入总和，导致"跨工作区累计"虚高失真。
     */
    private static readonly STALE_TTL_MS;
    constructor(storage: GlobalStorageProvider);
    /**
     * 将当前工作区的计时同步到全局存储
     * 由 Scheduler 周期全量存盘回调与 TimerOrchestrator.saveNow() 调用
     */
    sync(localTotalMs: number): Promise<void>;
    private doSync;
    /** 获取全局快照 */
    snapshot(): Promise<GlobalSnapshot>;
    /** 清空全局数据 */
    reset(): Promise<void>;
}
