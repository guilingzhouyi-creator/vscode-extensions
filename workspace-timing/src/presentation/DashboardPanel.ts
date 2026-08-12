/**
 * DashboardPanel — 配置面板 Webview
 *
 * 使用 VS Code Webview API 创建配置 + 统计面板。
 * 样式使用 VS Code CSS 变量，保证原生外观。
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { DashboardData, DashboardMessage } from '../domain/dashboard-types';
export type { DashboardData, DashboardMessage }; // 重新导出以便其他文件引用

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  /** 全局消息处理器，所有面板共享 */
  private static _messageHandler: ((msg: DashboardMessage) => void) | null = null;

  /** 设置全局消息处理器 */
  static setMessageHandler(handler: (msg: DashboardMessage) => void): void {
    DashboardPanel._messageHandler = handler;
  }

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _onMessage: ((msg: DashboardMessage) => void) | null = null;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // 先走全局处理器，再走实例处理器
    this._panel.webview.onDidReceiveMessage(
      (msg: DashboardMessage) => {
        DashboardPanel._messageHandler?.(msg);
        this._onMessage?.(msg);
      },
      null,
      this._disposables,
    );
  }

  /** 注册实例消息处理器（附加在全局之后） */
  onMessage(cb: (msg: DashboardMessage) => void): void {
    this._onMessage = cb;
  }

  /** 创建或聚焦面板 */
  static createOrShow(extensionUri: vscode.Uri): DashboardPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel._panel.reveal(column);
      return DashboardPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'workspaceTiming.dashboard',
      '工作区计时',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out')],
      },
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri);
    DashboardPanel.currentPanel._updateContent();
    return DashboardPanel.currentPanel;
  }

  /** 刷新数据显示 */
  updateData(data: DashboardData): void {
    if (this._panel.visible) {
      this._panel.webview.postMessage({ type: 'updateData', payload: data });
    }
  }

  /** 设置 HTML 内容 */
  private _updateContent(): void {
    this._panel.webview.html = this._getHtml();
  }

  /** 释放资源 */
  dispose(): void {
    DashboardPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }

  /** 生成 HTML — 按标志或 VS Code 语言选择 */
  private _getHtml(): string {
    const file = DashboardPanel._useEnglish
      ? 'dashboard.en.html'
      : vscode.env.language.toLowerCase().startsWith('zh')
        ? 'dashboard.html' : 'dashboard.en.html';
    return fs.readFileSync(path.join(__dirname, file), 'utf-8');
  }

  /** 语言切换标志 */
  static _useEnglish = false;
}