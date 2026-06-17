/**
 * WorkspaceStateProvider — 主存储提供者
 *
 * 通过 VS Code 的 workspaceState 进行存储。
 * 优点是自动按工作区隔离、无需额外文件、读写快速。
 * 缺点是数据不直观可见。
 */

import * as vscode from 'vscode';
import { WorkspaceTimingData } from '../domain/models';
import { IStorageProvider } from './IStorageProvider';
import { LogLevel, log } from '../integration/Logger';

const STORAGE_KEY = 'workspaceTiming:data';

export class WorkspaceStateProvider implements IStorageProvider {
    readonly id = 'workspace-state';

    private readonly context: vscode.ExtensionContext;
    private _available: boolean = true;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    isAvailable(): boolean {
        return this._available;
    }

    async load(): Promise<WorkspaceTimingData | null> {
        try {
            const raw = this.context.workspaceState.get<string>(STORAGE_KEY);
            if (!raw) return null;

            const data: WorkspaceTimingData = JSON.parse(raw);

            // 基本校验
            if (typeof data.totalMs !== 'number' || typeof data.version !== 'number') {
                log(LogLevel.Warn, 'WorkspaceStateProvider: invalid data format, ignoring');
                return null;
            }

            return data;
        } catch (err) {
            log(LogLevel.Warn, 'WorkspaceStateProvider: load failed', err as Error);
            this._available = false;
            return null;
        }
    }

    async save(data: WorkspaceTimingData): Promise<void> {
        try {
            const raw = JSON.stringify(data);
            await this.context.workspaceState.update(STORAGE_KEY, raw);
        } catch (err) {
            log(LogLevel.Error, 'WorkspaceStateProvider: save failed', err as Error);
            throw err;
        }
    }

    async delete(): Promise<void> {
        try {
            await this.context.workspaceState.update(STORAGE_KEY, undefined);
        } catch (err) {
            log(LogLevel.Error, 'WorkspaceStateProvider: delete failed', err as Error);
            throw err;
        }
    }
}
