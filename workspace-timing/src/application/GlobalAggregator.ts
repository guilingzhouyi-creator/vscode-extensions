/**
 * GlobalAggregator — 跨工作区累计同步服务
 *
 * 职责：在每次 fullSave 后将当前工作区的计时数据同步到 globalState。
 * 实现跨工作区时长汇总。
 *
 * 调用方：TimerOrchestrator.saveCheckpoint() 结束后触发
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

    constructor(storage: GlobalStorageProvider) {
        this.storage = storage;
    }

    /**
     * 将当前工作区的计时同步到全局存储
     * 由 TimerOrchestrator.saveCheckpoint() 结束后调用
     */
    async sync(localTotalMs: number): Promise<void> {
        if (!this.storage.isAvailable()) return;

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceRoot) return;

        const wsId = normalizeWorkspaceId(workspaceRoot.uri.toString());
        const wsName = workspaceRoot.name;

        try {
            const global = await this.storage.load();

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
        log(LogLevel.Info, 'GlobalAggregator: reset');
    }
}
