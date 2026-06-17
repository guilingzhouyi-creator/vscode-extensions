/**
 * GlobalStorageProvider — 全局存储提供者
 *
 * 通过 VS Code 的 ExtensionContext.globalState 实现跨工作区数据共享。
 * 用于跨工作区累计时长汇总。
 */

import * as vscode from 'vscode';
import { GlobalTimingData, createEmptyGlobalData } from '../domain/global-types';
import { LogLevel, log } from '../integration/Logger';

const STORAGE_KEY = 'workspaceTiming:global';

export class GlobalStorageProvider {
    private readonly context: vscode.ExtensionContext;
    private _available: boolean = true;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    isAvailable(): boolean {
        return this._available;
    }

    /** 读取全局数据 */
    async load(): Promise<GlobalTimingData> {
        try {
            const raw = this.context.globalState.get<string>(STORAGE_KEY);
            if (!raw) return createEmptyGlobalData();

            const data: GlobalTimingData = JSON.parse(raw);
            if (typeof data.version !== 'number') {
                return createEmptyGlobalData();
            }
            return data;
        } catch (err) {
            log(LogLevel.Warn, 'GlobalStorage: load failed', err as Error);
            this._available = false;
            return createEmptyGlobalData();
        }
    }

    /** 写入全局数据 */
    async save(data: GlobalTimingData): Promise<void> {
        try {
            data.lastUpdatedAt = Date.now();
            const raw = JSON.stringify(data);
            await this.context.globalState.update(STORAGE_KEY, raw);
        } catch (err) {
            log(LogLevel.Error, 'GlobalStorage: save failed', err as Error);
            throw err;
        }
    }

    /** 清空全局数据 */
    async delete(): Promise<void> {
        try {
            await this.context.globalState.update(STORAGE_KEY, undefined);
        } catch (err) {
            log(LogLevel.Error, 'GlobalStorage: delete failed', err as Error);
        }
    }
}
