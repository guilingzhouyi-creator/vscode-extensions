/**
 * dashboardMessages — 面板消息路由与导出流程
 *
 * 职责：接收 DashboardPanel 的 postMessage 并分发到 application 层；
 *       CSV / 日报 / 周报导出的「选路径 → 写文件 → 提示」流程集中于此。
 * 边界：只做消息分发与导出编排，不直接操作存储；
 *       业务入口一律委托 TimerOrchestrator（如 reset 走 resetAllData）。
 *       依赖经 MessageRouterContext 注入，避免模块级可变状态。
 */
import { TimerOrchestrator } from '../application/TimerOrchestrator';
import { StatusBarController } from './StatusBarController';
import { DashboardMessage } from '../domain/dashboard-types';
/** 路由依赖（组合根注入） */
export interface MessageRouterContext {
    getOrchestrator(): TimerOrchestrator | null;
    /** reset 完成后用于状态栏归零 */
    getStatusBar(): StatusBarController | null;
    /** reset 完成后用于立即回推最新面板数据（注入而非静态单例，保持可测性） */
    getDashboard(): {
        updateData(data: unknown): void;
    } | null;
}
export type DashboardMessageHandler = (msg: DashboardMessage) => void;
/** 创建面板消息处理器（每次 activate 构造一次） */
export declare function createDashboardMessageHandler(ctx: MessageRouterContext): DashboardMessageHandler;
/**
 * 将当前工作区计时数据导出为 CSV 文件
 * 供 Dashboard 导出按钮与 workspaceTiming.export 命令共用。
 */
export declare function exportTimingToFile(ctx: MessageRouterContext): Promise<void>;
/**
 * 将日报 / 周报导出为 Markdown 文件
 * 供 Dashboard 导出按钮与命令面板触发。
 */
export declare function exportReportToFile(ctx: MessageRouterContext, kind: 'daily' | 'weekly'): Promise<void>;
