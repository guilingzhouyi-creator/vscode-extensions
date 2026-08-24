"use strict";
/**
 * CommandRegistrar — 命令注册中心
 *
 * 职责：管理所有 VS Code command 的注册与释放
 * 边界：只负责注册/注销，不执行业务逻辑
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
exports.CommandRegistrar = void 0;
const vscode = __importStar(require("vscode"));
const DashboardPanel_1 = require("./DashboardPanel");
const Logger_1 = require("../integration/Logger");
const index_1 = require("../i18n/index");
class CommandRegistrar {
    constructor() {
        this.disposables = [];
    }
    register(context, orchestrator, statusBar, storage) {
        // 启用
        this.registerCommand('workspaceTiming.enable', async () => {
            if (!orchestrator) {
                this.noWorkspaceMsg();
                return;
            }
            orchestrator.disable.updateConfig({ enabled: true, globalDisabled: false });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());
            vscode.window.showInformationMessage('工作区计时: 已启用');
        });
        // 禁用
        this.registerCommand('workspaceTiming.disable', async () => {
            if (!orchestrator) {
                this.noWorkspaceMsg();
                return;
            }
            orchestrator.disable.updateConfig({ enabled: false });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());
            vscode.window.showInformationMessage('工作区计时: 已禁用');
        });
        // 全局开关
        this.registerCommand('workspaceTiming.toggleGlobal', async () => {
            if (!orchestrator) {
                this.noWorkspaceMsg();
                return;
            }
            const current = orchestrator.disable.config.globalDisabled;
            orchestrator.disable.updateConfig({ globalDisabled: !current });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());
            const msg = !current ? '工作区计时: 已全局禁用' : '工作区计时: 已全局启用';
            vscode.window.showInformationMessage(msg);
        });
        // 切换状态栏显示模式
        this.registerCommand('workspaceTiming.showStatus', () => {
            if (!statusBar) {
                this.noWorkspaceMsg();
                return;
            }
            const newMode = statusBar.cycleMode();
            const label = {
                'today-total': '今日优先',
                'total-today': '累计优先',
                'compact': '紧凑',
            };
            vscode.window.showInformationMessage((0, index_1.format)((0, index_1.t)()['cmd.modeSwitched'], label[newMode] ?? newMode));
        });
        // 打开配置面板
        this.registerCommand('workspaceTiming.openDashboard', () => {
            DashboardPanel_1.DashboardPanel.createOrShow(context.extensionUri);
        });
        // 调试：手动存盘
        this.registerCommand('workspaceTiming.debugSave', async () => {
            if (!orchestrator) {
                this.noWorkspaceMsg();
                return;
            }
            const result = await orchestrator.saveNow();
            vscode.window.showInformationMessage(`[调试] ${result}`);
        });
        // 新建计时周期（重置累计，保留历史）
        this.registerCommand('workspaceTiming.newPeriod', async () => {
            if (!orchestrator || !statusBar) {
                this.noWorkspaceMsg();
                return;
            }
            const msg = (0, index_1.t)()['confirm.newPeriod'];
            const title = (0, index_1.t)()['confirm.newPeriod.title'];
            const confirm = await vscode.window.showWarningMessage(msg, { modal: true }, title);
            if (confirm === title) {
                await orchestrator.newPeriod();
                vscode.window.showInformationMessage((0, index_1.t)()['toast.newPeriod']);
            }
        });
        // 重置数据
        this.registerCommand('workspaceTiming.reset', async () => {
            if (!orchestrator || !statusBar || !storage) {
                this.noWorkspaceMsg();
                return;
            }
            const msg = (0, index_1.t)()['confirm.reset'];
            const title = (0, index_1.t)()['confirm.reset.title'];
            const confirm = await vscode.window.showWarningMessage(msg, { modal: true }, title);
            if (confirm === title) {
                await orchestrator.stop();
                await storage.deleteAll();
                statusBar.updateTime(0, 0);
                vscode.window.showInformationMessage((0, index_1.t)()['toast.reset']);
            }
        });
        // 将 disposables 注册到 context.subscriptions
        for (const d of this.disposables) {
            context.subscriptions.push(d);
        }
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'CommandRegistrar: all commands registered');
    }
    registerCommand(id, handler) {
        const disposable = vscode.commands.registerCommand(id, handler);
        this.disposables.push(disposable);
    }
    /** 降级模式提示：当前未打开工作区 */
    noWorkspaceMsg() {
        vscode.window.showWarningMessage('工作区计时: 请先打开一个工作区文件夹');
    }
    dispose() {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
        (0, Logger_1.log)(Logger_1.LogLevel.Debug, 'CommandRegistrar: disposed');
    }
}
exports.CommandRegistrar = CommandRegistrar;
//# sourceMappingURL=CommandRegistrar.js.map