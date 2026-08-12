"use strict";
/**
 * DashboardPanel — 配置面板 Webview
 *
 * 使用 VS Code Webview API 创建配置 + 统计面板。
 * 样式使用 VS Code CSS 变量，保证原生外观。
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
exports.DashboardPanel = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class DashboardPanel {
    /** 设置全局消息处理器 */
    static setMessageHandler(handler) {
        DashboardPanel._messageHandler = handler;
    }
    constructor(panel, extensionUri) {
        this._disposables = [];
        this._onMessage = null;
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        // 先走全局处理器，再走实例处理器
        this._panel.webview.onDidReceiveMessage((msg) => {
            DashboardPanel._messageHandler?.(msg);
            this._onMessage?.(msg);
        }, null, this._disposables);
    }
    /** 注册实例消息处理器（附加在全局之后） */
    onMessage(cb) {
        this._onMessage = cb;
    }
    /** 创建或聚焦面板 */
    static createOrShow(extensionUri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel._panel.reveal(column);
            return DashboardPanel.currentPanel;
        }
        const panel = vscode.window.createWebviewPanel('workspaceTiming.dashboard', '工作区计时', column ?? vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out')],
        });
        DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri);
        DashboardPanel.currentPanel._updateContent();
        return DashboardPanel.currentPanel;
    }
    /** 刷新数据显示 */
    updateData(data) {
        if (this._panel.visible) {
            this._panel.webview.postMessage({ type: 'updateData', payload: data });
        }
    }
    /** 设置 HTML 内容 */
    _updateContent() {
        this._panel.webview.html = this._getHtml();
    }
    /** 释放资源 */
    dispose() {
        DashboardPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d)
                d.dispose();
        }
    }
    /** 生成 HTML — 按标志或 VS Code 语言选择 */
    _getHtml() {
        const file = DashboardPanel._useEnglish
            ? 'dashboard.en.html'
            : vscode.env.language.toLowerCase().startsWith('zh')
                ? 'dashboard.html' : 'dashboard.en.html';
        return fs.readFileSync(path.join(__dirname, file), 'utf-8');
    }
}
exports.DashboardPanel = DashboardPanel;
/** 全局消息处理器，所有面板共享 */
DashboardPanel._messageHandler = null;
/** 语言切换标志 */
DashboardPanel._useEnglish = false;
//# sourceMappingURL=DashboardPanel.js.map