"use strict";
/**
 * dashboardMessages — 面板消息路由与导出流程
 *
 * 职责：接收 DashboardPanel 的 postMessage 并分发到 application 层；
 *       CSV / 日报 / 周报导出的「选路径 → 写文件 → 提示」流程集中于此。
 * 边界：只做消息分发与导出编排，不直接操作存储；
 *       业务入口一律委托 TimerOrchestrator（如 reset 走 resetAllData）。
 *       依赖经 MessageRouterContext 注入，避免模块级可变状态。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDashboardMessageHandler = createDashboardMessageHandler;
exports.exportTimingToFile = exportTimingToFile;
exports.exportReportToFile = exportReportToFile;
const vscode = __importStar(require("vscode"));
const TimeAggregator_1 = require("../domain/TimeAggregator");
const Logger_1 = require("../integration/Logger");
const index_1 = require("../i18n/index");
/** 清洗文件名中的非法字符（工作区名可能含 /\:*?"<>| 等） */
function sanitizeFileName(name) {
    return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'workspace';
}
/** 创建面板消息处理器（每次 activate 构造一次） */
function createDashboardMessageHandler(ctx) {
    return (msg) => {
        switch (msg.type) {
            case 'updateConfig':
                // 静默应用：面板自身已有视觉反馈，每次变更都弹系统 toast 过于嘈杂
                ctx.getOrchestrator()?.applyDashboardConfig(msg.payload);
                break;
            case 'newPeriod':
                ctx.getOrchestrator()?.newPeriod().catch(err => (0, Logger_1.log)(Logger_1.LogLevel.Error, 'newPeriod failed', err));
                vscode.window.showInformationMessage((0, index_1.t)()['toast.newPeriod']);
                break;
            case 'reset': {
                // 编排统一走 orchestrator.resetAllData：清数据 → 清全局 → 重启计时
                ctx.getOrchestrator()?.resetAllData().then(data => {
                    ctx.getStatusBar()?.updateTime(0, 0);
                    // 立即推送归零后的最新数据，不等下一个刷新周期
                    ctx.getDashboard()?.updateData(data);
                    vscode.window.showInformationMessage((0, index_1.t)()['toast.reset']);
                }).catch(err => (0, Logger_1.log)(Logger_1.LogLevel.Error, 'reset failed', err));
                break;
            }
            case 'exportCSV':
                void exportTimingToFile(ctx);
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
async function exportTimingToFile(ctx) {
    try {
        const orch = ctx.getOrchestrator();
        if (!orch) {
            vscode.window.showWarningMessage((0, index_1.t)()['toast.exportNoWorkspace']);
            return;
        }
        const workspaceName = sanitizeFileName(vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace');
        const defaultUri = vscode.Uri.file(`${workspaceName}-timing-${TimeAggregator_1.TimeAggregator.todayStr()}.csv`);
        const uri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'CSV 文件 (*.csv)': ['csv'] },
            saveLabel: (0, index_1.t)()['toast.exportSaveLabel'],
        });
        if (!uri) {
            vscode.window.showInformationMessage((0, index_1.t)()['toast.exportCancelled']);
            return;
        }
        const csv = await orch.exportCSV(workspaceName);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf8'));
        vscode.window.showInformationMessage((0, index_1.format)((0, index_1.t)()['toast.exportSuccess'], uri.fsPath));
    }
    catch (err) {
        (0, Logger_1.log)(Logger_1.LogLevel.Error, 'WorkspaceTiming: export CSV failed', err);
        vscode.window.showErrorMessage((0, index_1.t)()['toast.exportFailed']);
    }
}
/**
 * 将日报 / 周报导出为 Markdown 文件
 * 供 Dashboard 导出按钮与命令面板触发。
 */
async function exportReportToFile(ctx, kind) {
    try {
        const orch = ctx.getOrchestrator();
        if (!orch) {
            vscode.window.showWarningMessage((0, index_1.t)()['toast.exportNoWorkspace']);
            return;
        }
        const workspaceName = sanitizeFileName(vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace');
        const today = TimeAggregator_1.TimeAggregator.todayStr();
        const prefix = kind === 'daily'
            ? (0, index_1.t)()['export.filename.daily']
            : (0, index_1.t)()['export.filename.weekly'];
        const defaultUri = vscode.Uri.file(`${workspaceName}-${prefix}-${today}.md`);
        const uri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'Markdown 文件 (*.md)': ['md'] },
            saveLabel: (0, index_1.t)()['toast.exportSaveLabel'],
        });
        if (!uri) {
            vscode.window.showInformationMessage((0, index_1.t)()['toast.exportCancelled']);
            return;
        }
        const md = await orch.exportReport(kind);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(md, 'utf8'));
        const key = kind === 'daily' ? 'toast.exportReportDaily' : 'toast.exportReportWeekly';
        vscode.window.showInformationMessage((0, index_1.format)((0, index_1.t)()[key], uri.fsPath));
    }
    catch (err) {
        (0, Logger_1.log)(Logger_1.LogLevel.Error, 'WorkspaceTiming: export report failed', err);
        vscode.window.showErrorMessage((0, index_1.t)()['toast.exportFailed']);
    }
}
//# sourceMappingURL=dashboardMessages.js.map