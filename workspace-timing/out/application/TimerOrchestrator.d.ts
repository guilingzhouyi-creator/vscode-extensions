/**
 * TimerOrchestrator — 计时总控
 *
 * 职责：协调 SessionManager + DisableManager + Scheduler
 * 边界：不直接操作存储、不渲染 UI
 * 调用链：
 *   ExtensionEntry → TimerOrchestrator → SessionManager → TimerEngine
 *                                       → DisableManager
 *                                       → Scheduler
 */
import { TimerEngine } from '../domain/TimerEngine';
import { StorageCoordinator } from '../persistence/StorageCoordinator';
import { JournalWriter } from '../cache/JournalWriter';
import { SessionManager, SessionResult } from './SessionManager';
import { TimingConfig } from '../domain/models';
import { DashboardData } from '../domain/dashboard-types';
import { GlobalAggregator } from './GlobalAggregator';
import { DisableManager, DisableState } from './DisableManager';
import { Scheduler } from './Scheduler';
import { ReportKind } from './exporters/ReportExporter';
export type OrchestratorState = 'idle' | 'running' | 'disabled' | 'saving';
export declare class TimerOrchestrator {
    private readonly timer;
    private readonly storage;
    private readonly journal;
    private readonly sessionManager;
    private readonly disableManager;
    private readonly scheduler;
    private readonly global;
    private _state;
    private _onStateChange;
    constructor(timer: TimerEngine, storage: StorageCoordinator, journal: JournalWriter, sessionManager: SessionManager, disableManager: DisableManager, scheduler: Scheduler, globalAggregator: GlobalAggregator);
    /** 当前状态 */
    get state(): OrchestratorState;
    /** 会话管理器引用（供 UI 层获取快照） */
    get session(): SessionManager;
    /** 禁用管理器引用 */
    get disable(): DisableManager;
    /** 状态变更回调 */
    onStateChange(cb: (state: OrchestratorState) => void): void;
    /**
     * 启动计时流程
     * 调用链：崩溃恢复 → 禁用判定 → 开始会话 → 启动调度器
     */
    start(): Promise<void>;
    /** 状态栏 tick 回调（由 Scheduler 驱动） */
    private _onTick;
    onTick(cb: (data: {
        totalMs: number;
        todayMs: number;
    }) => void): void;
    /**
     * 停止计时流程
     * 结束会话 → 停止调度器 → 最终存盘
     */
    stop(): Promise<SessionResult>;
    /**
     * 响应禁用设置变更
     */
    onDisableStateChanged(newState: DisableState): Promise<void>;
    /** 获取面板数据快照 */
    getDashboardData(): Promise<DashboardData>;
    /** 构建今日会话明细（供面板展示） */
    private buildTodayDetail;
    /**
     * 导出日报 / 周报为 Markdown 文本
     * @param kind 报告类型：'daily' 日报 / 'weekly' 周报
     */
    exportReport(kind: ReportKind): Promise<string>;
    /**
     * 立即手动存盘（调试用）
     */
    saveNow(): Promise<string>;
    /** 从面板更新配置 */
    applyDashboardConfig(partial: Partial<DashboardData>): void;
    /**
     * 运行期热更新可变配置：调度间隔、会话历史上限。
     * 由 ConfigWatcher 与 applyDashboardConfig 共用。
     */
    applyRuntimeConfig(cfg: Partial<TimingConfig>): void;
    /**
     * 导出当前工作区计时数据为 CSV 字符串
     * 配合 CsvExporter 使用，供 UI / 命令面板触发导出。
     *
     * @param workspaceName 工作区名称（用于 CSV 头部注释）
     */
    exportCSV(workspaceName: string): Promise<string>;
    /**
     * 新建计时周期：结束当前会话 → 重置 totalMs → 重新开始
     * 历史会话记录保留在 sessions[] 中
     */
    newPeriod(): Promise<void>;
}
