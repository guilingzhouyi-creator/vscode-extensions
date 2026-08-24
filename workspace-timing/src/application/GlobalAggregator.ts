/**
 * GlobalAggregator — 跨工作区累计同步服务
 *
 * 职责：在每次 fullSave 后将当前工作区的计时数据同步到 globalState。
 * 实现跨工作区时长汇总。
 *
 * 调用方：Scheduler 周期全量存盘回调（onFullSaved）、TimerOrchestrator.saveNow()/newPeriod()
 */

import * as vscode from 'vscode';
import { GlobalStorageProvider } from '../persistence/GlobalStorageProvider';
import { normalizeWorkspaceId, GlobalTimingData } from '../domain/global-types';
import { LogLevel, log } from '../integration/Logger';

export interface GlobalSnapshot {
    /** 所有工作区累计时长 (ms) */
    totalMs: number;
    /** 工作区数量 */
    workspaceCount: number;
    /** 各工作区列表 */
    workspaces: Array<{ name: string; totalMs: number }>;
}

export class GlobalAggregator {
    private readonly storage: GlobalStorageProvider;
    private _cached: GlobalTimingData | null = null;
    /** sync 进行中标志（防重入：并发 load→modify→save 会互相覆盖丢失写入） */
    private _syncing = false;
    /**
     * 上次已成功同步的本工作区 totalMs；相等则跳过整轮读→改→写。
     * ★ 在 doSync 成功后才记账：失败不更新，下轮 checkpoint 会重试（避免旧值卡死跳过）。
     */
    private _lastSyncedTotalMs: number | null = null;
    /**
     * 陈旧条目回收阈值：超过该天数未同步的工作区不再计入跨工作区累计。
     * 背景：globalState 跨版本持久共享，历史遗留的失联工作区（已删除/改道的项目、
     * 旧双计数 bug 时代的膨胀值）会永远计入总和，导致"跨工作区累计"虚高失真。
     */
    private static readonly STALE_TTL_MS = 30 * 24 * 3600_000;

    constructor(storage: GlobalStorageProvider) {
        this.storage = storage;
    }

    /**
     * 将当前工作区的计时同步到全局存储
     * 由 Scheduler 周期全量存盘回调与 TimerOrchestrator.saveNow() 调用
     */
    async sync(localTotalMs: number): Promise<void> {
        if (this._syncing) return; // 上一轮尚未完成，跳过本轮（下轮 checkpoint 会再同步）
        if (this._lastSyncedTotalMs === localTotalMs) return; // 未变化，跳过整轮读写
        this._syncing = true;
        try {
            await this.doSync(localTotalMs);
            this._lastSyncedTotalMs = localTotalMs;
        } finally {
            this._syncing = false;
        }
    }

    private async doSync(localTotalMs: number): Promise<void> {
        if (!this.storage.isAvailable()) return;

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceRoot) return;

        const wsId = normalizeWorkspaceId(workspaceRoot.uri.toString());
        const wsName = workspaceRoot.name;

        try {
            const global = await this.storage.load();

            // 回收陈旧条目：长期未同步的工作区（缺 lastSyncedAt 视为最陈旧）不再计入。
            // 当前工作区条目随后会被刷新，不受影响。
            const now = Date.now();
            const pruned: string[] = [];
            for (const [id, w] of Object.entries(global.workspaces)) {
                if (now - (w.lastSyncedAt ?? 0) > GlobalAggregator.STALE_TTL_MS) {
                    delete global.workspaces[id];
                    pruned.push(`${w.name}(${Math.round((w.totalMs ?? 0) / 3600000)}h)`);
                }
            }
            if (pruned.length > 0) {
                log(LogLevel.Info,
                    `GlobalAggregator: pruned ${pruned.length} stale workspace entr(y/ies): ${pruned.join(', ')}`);
            }

            // 更新/添加当前工作区记录
            global.workspaces[wsId] = {
                name: wsName,
                uri: workspaceRoot.uri.toString(),
                totalMs: localTotalMs,
                lastSyncedAt: Date.now(),
            };

            // 重新计算总和
            global.totalMs = Object.values(global.workspaces).reduce(
                (sum, w) => sum + w.totalMs, 0,
            );

            await this.storage.save(global);
            this._cached = global;

            log(LogLevel.Debug,
                `GlobalAggregator: synced (workspace=${wsName}, totalMs=${localTotalMs}, global=${global.totalMs})`);
        } catch (err) {
            log(LogLevel.Warn, 'GlobalAggregator: sync failed', err as Error);
        }
    }

    /** 获取全局快照 */
    async snapshot(): Promise<GlobalSnapshot> {
        const global = this._cached ?? await this.storage.load();
        this._cached = global;

        return {
            totalMs: global.totalMs,
            workspaceCount: Object.keys(global.workspaces).length,
            workspaces: Object.values(global.workspaces)
                .map(w => ({ name: w.name, totalMs: w.totalMs }))
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
