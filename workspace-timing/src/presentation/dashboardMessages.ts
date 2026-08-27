/**
 * dashboardMessages — 面板消息路由与导出流程
 *
 * 职责：接收 DashboardPanel 的 postMessage 并分发到 application 层；
 *       CSV / 日报 / 周报导出的「选路径 → 写文件 → 提示」流程集中于此。
 * 边界：只做消息分发与导出编排，不直接操作存储；
 *       业务入口一律委托 TimerOrchestrator（如 reset 走 resetAllData）。
 *       依赖经 MessageRouterContext 注入，避免模块级可变状态。
 */

import * as vscode from 'vscode';
import { TimerOrchestrator } from '../application/TimerOrchestrator';
import { StatusBarController } from './StatusBarController';
import { DashboardMessage } from '../domain/dashboard-types';
import { TimeAggregator } from '../domain/TimeAggregator';
import { LogLevel, log } from '../integration/Logger';
import { t, format, setLocale, resolveLocale } from '../i18n/index';
import { DashboardPanel } from './DashboardPanel';
import { sanitizeFileName } from './fileUtils';

/** 路由依赖（组合根注入） */
export interface MessageRouterContext {
    getOrchestrator(): TimerOrchestrator | null;
    /** reset 完成后用于状态栏归零 */
    getStatusBar(): StatusBarController | null;
    /** reset 完成后用于立即回推最新面板数据（注入而非静态单例，保持可测性） */
    getDashboard(): { updateData(data: unknown): void } | null;
}

export type DashboardMessageHandler = (msg: DashboardMessage) => void;

/** 创建面板消息处理器（每次 activate 构造一次） */
export function createDashboardMessageHandler(ctx: MessageRouterContext): DashboardMessageHandler {
    return (msg: DashboardMessage) => {
        switch (msg.type) {
            case 'updateConfig':
                // 静默应用：面板自身已有视觉反馈，每次变更都弹系统 toast 过于嘈杂
                ctx.getOrchestrator()?.applyDashboardConfig(msg.payload);
                // locale 显式切换：热生效 i18n + 重建面板（webview 静态词条在渲染时注入）
                if (msg.payload.locale !== undefined) {
                    setLocale(resolveLocale(msg.payload.locale));
                    DashboardPanel.recreateForLocale();
                }
                break;

            case 'newPeriod':
                ctx.getOrchestrator()?.newPeriod().catch(err =>
                    log(LogLevel.Error, 'newPeriod failed', err as Error)
                );
                vscode.window.showInformationMessage(t()['toast.newPeriod']);
                break;

            case 'reset': {
                // 编排统一走 orchestrator.resetAllData：清数据 → 清全局 → 重启计时
                ctx.getOrchestrator()?.resetAllData().then(data => {
                    ctx.getStatusBar()?.updateTime(0, 0);
                    // 立即推送归零后的最新数据，不等下一个刷新周期
                    ctx.getDashboard()?.updateData(data);
                    vscode.window.showInformationMessage(t()['toast.reset']);
                }).catch(err =>
                    log(LogLevel.Error, 'reset failed', err as Error)
                );
                break;
            }

            case 'clearHistory': {
                // 清除历史明细（保留累计数字），编排委托 orchestrator.clearHistory
                ctx.getOrchestrator()?.clearHistory().then(data => {
                    ctx.getStatusBar()?.updateTime(data.todayMs, data.totalMs);
                    ctx.getDashboard()?.updateData(data);
                    vscode.window.showInformationMessage(t()['toast.clearHistoryDone']);
                }).catch(err =>
                    log(LogLevel.Error, 'clearHistory failed', err as Error)
                );
                break;
            }

            case 'exportCSV':
                void exportTimingToFile(ctx);
                break;

            case 'exportAggregated':
                void exportAggregatedToFile(ctx);
                break;

            case 'exportReport':
                void exportReportToFile(ctx, msg.payload.kind);
                break;
        }
    };
}

/**
 * 将当前工作区计时数据导出为 CSV 文件
 * 供 Dashboard 导出按钮与 workspaceTiming.export 命令共用。
 */
export async function exportTimingToFile(ctx: MessageRouterContext): Promise<void> {
    try {
        const orch = ctx.getOrchestrator();
        if (!orch) {
            vscode.window.showWarningMessage(t()['toast.exportNoWorkspace']);
            return;
        }

        const workspaceName = sanitizeFileName(
            vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace',
        );

        const defaultUri = vscode.Uri.file(
            `${workspaceName}-timing-${TimeAggregator.todayStr()}.csv`,
        );
        const uri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'CSV 文件 (*.csv)': ['csv'] },
            saveLabel: t()['toast.exportSaveLabel'],
        });

        if (!uri) {
            vscode.window.showInformationMessage(t()['toast.exportCancelled']);
            return;
        }

        const csv = await orch.exportCSV(workspaceName);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf8'));

        vscode.window.showInformationMessage(
            format(t()['toast.exportSuccess'], uri.fsPath),
        );
    } catch (err) {
        log(LogLevel.Error, 'WorkspaceTiming: export CSV failed', err as Error);
        vscode.window.showErrorMessage(t()['toast.exportFailed']);
    }
}

/**
 * 将日报 / 周报导出为 Markdown 文件
 * 供 Dashboard 导出按钮与命令面板触发。
 */
export async function exportReportToFile(
    ctx: MessageRouterContext,
    kind: 'daily' | 'weekly',
): Promise<void> {
    try {
        const orch = ctx.getOrchestrator();
        if (!orch) {
            vscode.window.showWarningMessage(t()['toast.exportNoWorkspace']);
            return;
        }

        const workspaceName = sanitizeFileName(
            vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace',
        );
        const today = TimeAggregator.todayStr();
        const prefix = kind === 'daily'
            ? t()['export.filename.daily']
            : t()['export.filename.weekly'];
        const defaultUri = vscode.Uri.file(
            `${workspaceName}-${prefix}-${today}.md`,
        );

        const uri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'Markdown 文件 (*.md)': ['md'] },
            saveLabel: t()['toast.exportSaveLabel'],
        });

        if (!uri) {
            vscode.window.showInformationMessage(t()['toast.exportCancelled']);
            return;
        }

        const md = await orch.exportReport(kind);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(md, 'utf8'));

        const key = kind === 'daily' ? 'toast.exportReportDaily' : 'toast.exportReportWeekly';
        vscode.window.showInformationMessage(
            format(t()[key], uri.fsPath),
        );
    } catch (err) {
        log(LogLevel.Error, 'WorkspaceTiming: export report failed', err as Error);
        vscode.window.showErrorMessage(t()['toast.exportFailed']);
    }
}

/**
 * 导出全历史聚合日报序列 CSV（折叠桶 ∪ 当期原始计算）
 * 供 Dashboard 导出按钮与 workspaceTiming.exportAggregated 命令共用。
 */
export async function exportAggregatedToFile(ctx: MessageRouterContext): Promise<void> {
    try {
        const orch = ctx.getOrchestrator();
        if (!orch) {
            vscode.window.showWarningMessage(t()['toast.exportNoWorkspace']);
            return;
        }

        const workspaceName = sanitizeFileName(
            vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace',
        );
        const defaultUri = vscode.Uri.file(
            `${workspaceName}-timing-${t()['export.filename.aggregated']}-${TimeAggregator.todayStr()}.csv`,
        );

        const uri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'CSV Files (*.csv)': ['csv'] },
            saveLabel: t()['toast.exportSaveLabel'],
        });

        if (!uri) {
            vscode.window.showInformationMessage(t()['toast.exportCancelled']);
            return;
        }

        const csv = await orch.exportAggregatedCSV(workspaceName);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf8'));

        vscode.window.showInformationMessage(
            format(t()['toast.exportSuccess'], uri.fsPath),
        );
    } catch (err) {
        log(LogLevel.Error, 'WorkspaceTiming: aggregated export failed', err as Error);
        vscode.window.showErrorMessage(t()['toast.exportFailed']);
    }
}
