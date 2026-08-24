/**
 * DashboardPanel — 配置面板 Webview
 *
 * 使用 VS Code Webview API 创建配置 + 统计面板。
 * 样式使用 VS Code CSS 变量，保证原生外观。
 */
import * as vscode from 'vscode';
import { DashboardData, DashboardMessage } from '../domain/dashboard-types';
export type { DashboardData, DashboardMessage };
export declare class DashboardPanel {
    static currentPanel: DashboardPanel | undefined;
    /** 全局消息处理器，所有面板共享 */
    private static _messageHandler;
    /** 设置全局消息处理器 */
    static setMessageHandler(handler: ((msg: DashboardMessage) => void) | null): void;
    /** 关闭当前面板（扩展停用时调用，释放 Webview 资源） */
    static disposeCurrent(): void;
    /** 生成 CSP nonce（每次渲染 HTML 时唯一） */
    private static getNonce;
    private readonly _panel;
    private readonly _extensionUri;
    private _disposables;
    private _onMessage;
    private _disposed;
    private constructor();
    /** 注册实例消息处理器（附加在全局之后） */
    onMessage(cb: (msg: DashboardMessage) => void): void;
    /** 创建或聚焦面板 */
    static createOrShow(extensionUri: vscode.Uri): DashboardPanel;
    /** 刷新数据显示 */
    updateData(data: DashboardData): void;
    /** 设置 HTML 内容 */
    private _updateContent;
    /** 释放资源（幂等，防 onDidDispose 递归） */
    dispose(): void;
    /** 生成 HTML（含 CSP + nonce 安全加固） */
    private _getHtml;
}
