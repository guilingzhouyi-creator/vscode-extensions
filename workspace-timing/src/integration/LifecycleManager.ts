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
        // 当前目标 VS Code 版本未暴露 onWillSaveState 等关闭钩子，
        // 优雅存盘由 extension.deactivate() 经 onVSCodeClose() 统一负责（见 activation 层）。
        // 预留扩展点：后续版本可在此订阅窗口/焦点事件做增量保存。

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
