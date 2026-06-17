/**
 * LifecycleManager — 生命周期事件管理
 *
 * 职责：监听 VS Code 窗口/焦点/关闭事件，转发到 Application 层
 * 边界：只做事件转发，不做业务逻辑
 */
import { TimerOrchestrator } from '../application/TimerOrchestrator';
export declare class LifecycleManager {
    private readonly disposables;
    private readonly orchestrator;
    constructor(orchestrator: TimerOrchestrator);
    /** 挂载所有事件监听 */
    start(): void;
    /** 停止所有监听 */
    stop(): void;
    /** VS Code 关闭前的清理 */
    onVSCodeClose(): Promise<void>;
}
