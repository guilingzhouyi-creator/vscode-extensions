/**
 * Module: GlobalAggregator — 跨工作区计时聚合服务
 * File Path: src/application/GlobalAggregator.ts
 * Architecture Role: Application layer multi-workspace synchronizer and global statistics aggregator
 * Dependencies & Triggers: domain/global-types.ts, domain/models.ts, GlobalStore port; triggered by Scheduler onFullSaved and TimerOrchestrator
 * Responsibilities: Synchronize current workspace durations into global state storage; prune stale workspaces exceeding TTL; project aggregated snapshots across workspaces
 * Exit Semantics & Design Rationale: Injected workspace identity port eliminates direct VS Code API coupling; re-entrancy lock and delta-check prevent redundant disk I/O
 */

import { GlobalTimingData, WorkspaceRecord } from '../domain/global-types';
import { GLOBAL_STALE_TTL_MS, MS_PER_HOUR } from '../domain/models';
import { LogLevel, log } from '../integration/Logger';

/** 当前工作区标识（由组合根注入，替代直读 vscode.workspace） */
export interface WorkspaceInfo {
    /** 归一化工作区 id（normalizeWorkspaceId 结果） */
    id: string;
    /** 显示名 */
    name: string;
    /** 完整 URI 字符串 */
    uri: string;
}

/** 全局存储端口（结构化最小接口；GlobalStorageProvider 天然满足） */
interface GlobalStore {
    isAvailable(): boolean;
    load(): Promise<GlobalTimingData>;
    save(data: GlobalTimingData): Promise<void>;
    delete(): Promise<void>;
}

export interface GlobalSnapshot {
    /** 所有工作区累计时长 (ms) */
    totalMs: number;
    /** 工作区数量 */
    workspaceCount: number;
    /** 各工作区列表 */
    workspaces: Array<{ name: string; totalMs: number }>;
}

/** 回收超过 TTL 未同步的陈旧工作区条目 */
function pruneStaleWorkspaces(
    workspaces: Record<string, WorkspaceRecord>,
    staleTtlMs: number,
    now: number,
): string[] {
    const pruned: string[] = [];
    for (const [id, w] of Object.entries(workspaces)) {
        if (now - (w.lastSyncedAt ?? 0) > staleTtlMs) {
            delete workspaces[id];
            pruned.push(`${w.name}(${Math.round((w.totalMs ?? 0) / MS_PER_HOUR)}h)`);
        }
    }
    return pruned;
}

export class GlobalAggregator {
    private readonly storage: GlobalStore;
    private readonly workspaceInfo: () => WorkspaceInfo | undefined;
    private _cached: GlobalTimingData | null = null;
    /** sync 进行中标志（防重入） */
    private _syncing = false;
    /**
     * 上次已成功同步的本工作区 totalMs；相等则跳过整轮读→改→写。
     */
    private _lastSyncedTotalMs: number | null = null;

    private static readonly STALE_TTL_MS = GLOBAL_STALE_TTL_MS;

    constructor(storage: GlobalStore, workspaceInfo: () => WorkspaceInfo | undefined) {
        this.storage = storage;
        this.workspaceInfo = workspaceInfo;
    }

    /**
     * 将当前工作区的计时同步到全局存储
     * 由 Scheduler 周期全量存盘回调与 TimerOrchestrator.saveNow() 调用
     */
    async sync(localTotalMs: number, force = false): Promise<void> {
        if (this._syncing) return;
        if (!force && this._lastSyncedTotalMs === localTotalMs) return;
        this._syncing = true;
        try {
            if (await this.doSync(localTotalMs)) {
                this._lastSyncedTotalMs = localTotalMs;
            }
        } finally {
            this._syncing = false;
        }
    }

    /** 执行一轮同步；返回是否成功 */
    private async doSync(localTotalMs: number): Promise<boolean> {
        if (!this.storage.isAvailable()) return false;

        const info = this.workspaceInfo();
        if (!info) return false;

        try {
            const global = await this.storage.load();
            const now = Date.now();

            const pruned = pruneStaleWorkspaces(global.workspaces, GlobalAggregator.STALE_TTL_MS, now);
            if (pruned.length > 0) {
                log(
                    LogLevel.Info,
                    `GlobalAggregator: pruned ${pruned.length} stale workspace entr(y/ies): ${pruned.join(', ')}`,
                );
            }

            // 更新/添加当前工作区记录
            global.workspaces[info.id] = {
                name: info.name,
                uri: info.uri,
                totalMs: localTotalMs,
                lastSyncedAt: Date.now(),
            };

            // 重新计算总和
            global.totalMs = Object.values(global.workspaces).reduce((sum, w) => sum + w.totalMs, 0);

            await this.storage.save(global);
            this._cached = global;

            log(
                LogLevel.Debug,
                `GlobalAggregator: synced (workspace=${info.name}, totalMs=${localTotalMs}, global=${global.totalMs})`,
            );
        } catch (err) {
            log(LogLevel.Warn, 'GlobalAggregator: sync failed', err as Error);
            return false;
        }
        return true;
    }

    /** 获取全局快照 */
    async snapshot(): Promise<GlobalSnapshot> {
        const global = this._cached ?? (await this.storage.load());
        this._cached = global;

        const workspaces = global.workspaces && typeof global.workspaces === 'object' ? global.workspaces : {};

        return {
            totalMs: typeof global.totalMs === 'number' ? global.totalMs : 0,
            workspaceCount: Object.keys(workspaces).length,
            workspaces: Object.values(workspaces)
                .filter((w): w is WorkspaceRecord => !!w && typeof w === 'object')
                .map((w) => ({ name: w.name, totalMs: w.totalMs }))
                .sort((a, b) => b.totalMs - a.totalMs),
        };
    }

    /** 清空全局数据 */
    async reset(): Promise<void> {
        await this.storage.delete();
        this._cached = null;
        this._lastSyncedTotalMs = null;
        log(LogLevel.Info, 'GlobalAggregator: reset');
    }
}
