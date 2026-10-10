/**
 * Module: DashboardMessages — 仪表盘消息路由与导出交互编排
 * File Path: src/presentation/dashboardMessages.ts
 * Architecture Role: Presentation layer message handler and export interaction pipeline
 * Dependencies & Triggers: vscode API, TimerOrchestrator, StatusBarController, i18n subsystem; triggered by Webview onDidReceiveMessage events
 * Responsibilities: Route Webview client actions to application services; orchestrate CSV and Markdown export dialogs, file writing, and toast feedback; update configurations
 * Exit Semantics & Design Rationale: Declarative strategy table (MessageStrategy map) eliminates switch-case complexity; context injection via MessageRouterContext ensures testability and loose coupling
 */

import * as vscode from 'vscode';
import { TimerOrchestrator } from '../application/TimerOrchestrator';
import { StatusBarController } from './StatusBarController';
import { DashboardMessage } from '../domain/dashboard-types';
import { TimeAggregator } from '../domain/TimeAggregator';
import { LogLevel, log } from '../integration/Logger';
import { persistTimingConfig } from '../integration/ConfigWatcher';
import { t, format, setLocale, resolveLocale } from '../i18n/index';
import { DashboardPanel } from './DashboardPanel';

/** 路由依赖（组合根注入） */
export interface MessageRouterContext {
    getOrchestrator(): TimerOrchestrator | null;
    /** reset 完成后用于状态栏归零 */
    getStatusBar(): StatusBarController | null;
    /** reset 完成后用于立即回推最新面板数据（注入而非静态单例，保持可测性） */
    getDashboard(): { updateData(data: unknown): void } | null;
}

export type DashboardMessageHandler = (msg: DashboardMessage) => void;

type MessageStrategy<T extends DashboardMessage['type']> = (
    ctx: MessageRouterContext,
    msg: Extract<DashboardMessage, { type: T }>
) => void | Promise<void>;

/**
 * 消息策略分发表：采用声明式字典路由映射替代集中式条件分支，
 * 确保各类面板事件处理具有独立的单向数据流与清晰的关注点隔离。
 */
const MESSAGE_STRATEGIES: {
    [K in DashboardMessage['type']]: MessageStrategy<K>;
} = {
    updateConfig: (ctx, msg) => {
        // 1. 内存即时应用：面板与调度器即时生效
        ctx.getOrchestrator()?.applyDashboardConfig(msg.payload);
        // 2. 持久化写入 VS Code settings.json，防止重载窗口后失效
        persistTimingConfig(msg.payload).catch(err =>
            log(LogLevel.Error, 'updateConfig persist failed', err as Error)
        );
        // 3. locale 显式切换：热生效 i18n + 重建面板（webview 静态词条在渲染时注入）
        if (msg.payload.locale !== undefined) {
            setLocale(resolveLocale(msg.payload.locale));
            DashboardPanel.recreateForLocale();
        }
    },

    newPeriod: (ctx) => {
        // 与 reset 路径时序一致：编排完成后提示，失败不打成功扰
        ctx.getOrchestrator()?.newPeriod().then(() => {
            vscode.window.showInformationMessage(t()['toast.newPeriod']);
        }).catch(err =>
            log(LogLevel.Error, 'newPeriod failed', err as Error)
        );
    },

    reset: (ctx) => {
        // 编排统一走 orchestrator.resetAllData：清数据 → 清全局 → 重启计时
        ctx.getOrchestrator()?.resetAllData().then(data => {
            ctx.getStatusBar()?.updateTime(0, 0);
            // 立即推送归零后的最新数据，不等下一个刷新周期
            ctx.getDashboard()?.updateData(data);
            vscode.window.showInformationMessage(t()['toast.reset']);
        }).catch(err =>
            log(LogLevel.Error, 'reset failed', err as Error)
        );
    },

    clearHistory: (ctx) => {
        // 清除历史明细（保留累计数字），编排委托 orchestrator.clearHistory
        ctx.getOrchestrator()?.clearHistory().then(data => {
            ctx.getStatusBar()?.updateTime(data.todayMs, data.totalMs);
            ctx.getDashboard()?.updateData(data);
            vscode.window.showInformationMessage(t()['toast.clearHistoryDone']);
        }).catch(err =>
            log(LogLevel.Error, 'clearHistory failed', err as Error)
        );
    },

    exportCSV: (ctx) => {
        void exportTimingToFile(ctx);
    },

    exportAggregated: (ctx) => {
        void exportAggregatedToFile(ctx);
    },

    exportReport: (ctx, msg) => {
        void exportReportToFile(ctx, msg.payload.kind);
    },
};

/** 创建面板消息处理器（每次 activate 构造一次） */
export function createDashboardMessageHandler(ctx: MessageRouterContext): DashboardMessageHandler {
    return (msg: DashboardMessage) => {
        const handler = MESSAGE_STRATEGIES[msg.type];
        if (handler) {
            void handler(ctx, msg as never);
        } else if ((msg as { type: string }).type === 'saveSettings') {
            const payload = (msg as { payload: Partial<any> }).payload;
            if (payload) {
                void MESSAGE_STRATEGIES.updateConfig(ctx, { type: 'updateConfig', payload });
            }
        }
    };
}

/** 文件导出通用参数契约 */
export interface FileExportPipelineOptions {
    ctx: MessageRouterContext;
    defaultFileName: string | ((workspaceName: string) => string);
    filters: Record<string, string[]>;
    generator: (orch: TimerOrchestrator, workspaceName: string) => Promise<string>;
    successMessage?: (filePath: string) => string;
    logTag: string;
}

/** 清洗文件名中的非法字符（工作区名可能含 /\:*?"<>| 等）；空结果回退为 'workspace' */
function sanitizeFileName(name: string): string {
    return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'workspace';
}

/**
 * 提取通用导出管道：选路径 → 写文件 → 提示
 * 消除 CommandRegistrar 与 dashboardMessages 之间的重复逻辑。
 */
export async function runFileExportPipeline(options: FileExportPipelineOptions): Promise<void> {
    try {
        const orch = options.ctx.getOrchestrator();
        if (!orch) {
            vscode.window.showWarningMessage(t()['toast.exportNoWorkspace']);
            return;
        }

        const workspaceName = sanitizeFileName(
            vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace',
        );

        const fileName = typeof options.defaultFileName === 'function'
            ? options.defaultFileName(workspaceName)
            : options.defaultFileName;

        const defaultUri = vscode.Uri.file(fileName);
        const uri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: options.filters,
            saveLabel: t()['toast.exportSaveLabel'],
        });

        if (!uri) {
            vscode.window.showInformationMessage(t()['toast.exportCancelled']);
            return;
        }

        const content = await options.generator(orch, workspaceName);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));

        const successText = options.successMessage
            ? options.successMessage(uri.fsPath)
            : format(t()['toast.exportSuccess'], uri.fsPath);
        vscode.window.showInformationMessage(successText);
    } catch (err) {
        log(LogLevel.Error, options.logTag, err as Error);
        vscode.window.showErrorMessage(t()['toast.exportFailed']);
    }
}

/**
 * 将当前工作区计时数据导出为 CSV 文件
 * 供 Dashboard 导出按钮与 workspaceTiming.export 命令共用。
 */
export async function exportTimingToFile(ctx: MessageRouterContext): Promise<void> {
    return runFileExportPipeline({
        ctx,
        defaultFileName: (ws) => `${ws}-timing-${TimeAggregator.todayStr()}.csv`,
        filters: { [t()['export.filter.csv']]: ['csv'] },
        generator: (orch, ws) => orch.exportCSV(ws),
        logTag: 'WorkspaceTiming: export CSV failed',
    });
}

/**
 * 将日报 / 周报导出为 Markdown 文件
 * 供 Dashboard 导出按钮与命令面板触发。
 */
export async function exportReportToFile(
    ctx: MessageRouterContext,
    kind: 'daily' | 'weekly',
): Promise<void> {
    const today = TimeAggregator.todayStr();
    const prefix = kind === 'daily'
        ? t()['export.filename.daily']
        : t()['export.filename.weekly'];
    const key = kind === 'daily' ? 'toast.exportReportDaily' : 'toast.exportReportWeekly';

    return runFileExportPipeline({
        ctx,
        defaultFileName: (ws) => `${ws}-${prefix}-${today}.md`,
        filters: { [t()['export.filter.md']]: ['md'] },
        generator: (orch) => orch.exportReport(kind),
        successMessage: (filePath) => format(t()[key], filePath),
        logTag: 'WorkspaceTiming: export report failed',
    });
}

/**
 * 导出全历史聚合日报序列 CSV（折叠桶 ∪ 当期原始计算）
 * 供 Dashboard 导出按钮与 workspaceTiming.exportAggregated 命令共用。
 */
export async function exportAggregatedToFile(ctx: MessageRouterContext): Promise<void> {
    return runFileExportPipeline({
        ctx,
        defaultFileName: (ws) => `${ws}-timing-${t()['export.filename.aggregated']}-${TimeAggregator.todayStr()}.csv`,
        filters: { [t()['export.filter.csv']]: ['csv'] },
        generator: (orch, ws) => orch.exportAggregatedCSV(ws),
        logTag: 'WorkspaceTiming: aggregated export failed',
    });
}
