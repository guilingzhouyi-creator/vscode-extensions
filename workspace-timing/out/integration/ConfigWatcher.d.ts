/**
 * ConfigWatcher — 配置变更监听器
 *
 * 职责：监听 VS Code 设置变更，同步到 DisableManager 和其他模块
 * 边界：只做配置变更通知，不做业务决策
 */
import * as vscode from 'vscode';
import { TimingConfig } from '../domain/models';
import { TimerOrchestrator } from '../application/TimerOrchestrator';
import { StatusBarController } from '../presentation/StatusBarController';
/**
 * 读取当前用户配置（唯一入口，避免多处重复实现导致配置漂移）。
 * 供 ConfigWatcher 与 extension.ts 初始化共用，保证初始化/运行期配置同源。
 */
export declare function readTimingConfig(): TimingConfig;
export declare class ConfigWatcher {
    private readonly disposables;
    private readonly orchestrator;
    private readonly statusBar;
    private readonly extensionUri;
    /** 上次应用的语言设置（undefined=尚未应用过首轮） */
    private _lastLocale;
    constructor(orchestrator: TimerOrchestrator, statusBar: StatusBarController, extensionUri: vscode.Uri);
    /** 开始监听配置变更 */
    start(): void;
    /** 读取当前配置 */
    private readConfig;
    /** 应用配置到各模块 */
    private applyConfig;
    /**
     * 云端同步占位检测：
     * 用户尝试开启 cloudSync.enabled 时给出「即将推出」提示。
     * v0.2.0 阶段仅为扩展点占位，不实现真实同步。
     */
    private checkCloudSyncPlaceholder;
    /** 停止监听 */
    stop(): void;
}
