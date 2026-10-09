/**
 * Module: Global Storage Provider (跨工作区全局状态持久化提供者)
 * File Path: src/persistence/GlobalStorageProvider.ts
 * Architecture Role: 持久化层全局状态控制器，封装 VS Code globalState 提供跨所有工作区的计时统计聚合存储。
 * Dependencies & Triggers: 依赖 vscode.ExtensionContext、domain/global-types 与 Logger；在跨工作区汇总同步及清除时被调用。
 * Responsibilities: 读取与解析跨工作区汇总 GlobalTimingData；安全序列化与更新 globalState；版本不匹配自愈兜底与异常隔离。
 * Exit Semantics & Design Rationale: 内部捕获解析异常并安全回退空数据，避免损坏的全局键破坏单工作区会话；更新前自动打标 lastUpdatedAt 时间戳。
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
