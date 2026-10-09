/**
 * Module: Workspace State Provider (工作区状态主持久化提供者)
 * File Path: src/persistence/WorkspaceStateProvider.ts
 * Architecture Role: 持久化层一级主存储驱动，通过 VS Code ExtensionContext.workspaceState 机制实现高性能、隔离的工作区状态持久化。
 * Dependencies & Triggers: 依赖 vscode.ExtensionContext、domain/models 与 Logger；被 StorageCoordinator 选为一级主存首选驱动。
 * Responsibilities: 实现 IStorageProvider 接口；基于 JSON 字符串存储与读取 WorkspaceTimingData；管理存储可用性与错误隔离。
 * Exit Semantics & Design Rationale: 利用 VS Code 原生工作区存储实现自然的数据隔离与快速存取；遇脏数据或解析异常时安全熔断，返回 null。
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
