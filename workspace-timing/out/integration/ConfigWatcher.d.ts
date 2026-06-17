/**
 * ConfigWatcher — 配置变更监听器
 *
 * 职责：监听 VS Code 设置变更，同步到 DisableManager 和其他模块
 * 边界：只做配置变更通知，不做业务决策
 */
import { TimerOrchestrator } from '../application/TimerOrchestrator';
import { StatusBarController } from '../presentation/StatusBarController';
export declare class ConfigWatcher {
    private readonly disposables;
    private readonly orchestrator;
    private readonly statusBar;
    constructor(orchestrator: TimerOrchestrator, statusBar: StatusBarController);
    /** 开始监听配置变更 */
    start(): void;
    /** 读取当前配置 */
    private readConfig;
    /** 应用配置到各模块 */
    private applyConfig;
    /** 停止监听 */
    stop(): void;
}
