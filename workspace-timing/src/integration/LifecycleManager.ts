/**
 * LifecycleManager — 生命周期事件管理
 *
 * 职责：监听 VS Code 窗口/焦点/关闭事件，转发到 Application 层
 * 边界：只做事件转发，不做业务逻辑
 */

import * as vscode from 'vscode';
import { TimerOrchestrator } from '../application/TimerOrchestrator';
import { LogLevel, log } from './Logger';

export class LifecycleManager {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly orchestrator: TimerOrchestrator;

    constructor(orchestrator: TimerOrchestrator) {
        this.orchestrator = orchestrator;
    }

    /** 挂载所有事件监听 */
    start(): void {
        // 窗口焦点变化（预留：后续可作为可选策略）
        // 当前需求"窗口打开即计"，不依赖焦点

        log(LogLevel.Info, 'LifecycleManager: started');
    }

    /** 停止所有监听 */
    stop(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
        log(LogLevel.Info, 'LifecycleManager: stopped');
    }

    /** VS Code 关闭前的清理 */
    async onVSCodeClose(): Promise<void> {
        log(LogLevel.Info, 'LifecycleManager: VS Code closing');
        await this.orchestrator.stop();
        this.stop();
    }
}
