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
    /** 生成 HTML */
    _getHtml() {
        return /* html */ `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #cccccc);
      --border: var(--vscode-panel-border, #333333);
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --input-border: var(--vscode-input-border, #555555);
      --btn-bg: var(--vscode-button-background, #0078d4);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-hover: var(--vscode-button-hoverBackground, #026ec1);
      --btn-secondary: var(--vscode-button-secondaryBackground, #3a3d41);
      --btn-secondary-hover: var(--vscode-button-secondaryHoverBackground, #45494e);
      --danger: var(--vscode-errorForeground, #f14c4c);
      --success: #4ec9b0;
      --section-header: var(--vscode-settings-headerForeground, #cccccc);
      --label: var(--vscode-settings-labelForeground, #cccccc);
      --description: var(--vscode-descriptionForeground, #9d9d9d);
      --focus: var(--vscode-focusBorder, #007fd4);
      --radius: 4px;
      --gap: 16px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--fg);
      background: var(--bg);
      padding: var(--gap);
      line-height: 1.5;
    }

    h1 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    h2 {
      font-size: 14px;
      font-weight: 600;
      color: var(--section-header);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border);
    }
    h3 { font-size: 13px; font-weight: 600; margin-bottom: 6px; }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 8px;
      margin-bottom: var(--gap);
    }
    .stat-card {
      background: var(--input-bg);
      border-radius: var(--radius);
      padding: 12px;
      text-align: center;
    }
    .stat-card .value {
      font-size: 24px;
      font-weight: 700;
      color: var(--success);
    }
    .stat-card .label {
      font-size: 11px;
      color: var(--description);
      margin-top: 4px;
    }

    .section { margin-bottom: var(--gap); }

    .setting-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
    }
    .setting-row:last-child { border-bottom: none; }
    .setting-label { flex: 1; }
    .setting-label .desc {
      font-size: 11px;
      color: var(--description);
      margin-top: 2px;
    }

    /* Toggle switch */
    .toggle {
      position: relative;
      width: 40px;
      height: 20px;
      flex-shrink: 0;
    }
    .toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .toggle .slider {
      position: absolute;
      inset: 0;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 10px;
      cursor: pointer;
      transition: 0.2s;
    }
    .toggle .slider::before {
      content: '';
      position: absolute;
      width: 14px;
      height: 14px;
      left: 2px;
      top: 2px;
      background: var(--description);
      border-radius: 50%;
      transition: 0.2s;
    }
    .toggle input:checked + .slider {
      background: var(--btn-bg);
      border-color: var(--btn-bg);
    }
    .toggle input:checked + .slider::before {
      left: 22px;
      background: var(--btn-fg);
    }
    .toggle input:focus-visible + .slider {
      outline: 1px solid var(--focus);
      outline-offset: 2px;
    }

    /* Number input */
    .number-input {
      width: 80px;
      padding: 4px 8px;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: var(--radius);
      font-size: 12px;
      text-align: right;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .number-input:focus {
      outline: none;
      border-color: var(--focus);
    }

    /* Buttons */
    .btn-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .btn {
      padding: 6px 14px;
      border: none;
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
      transition: 0.15s;
    }
    .btn:active { transform: scale(0.97); }
    .btn-primary {
      background: var(--btn-bg);
      color: var(--btn-fg);
    }
    .btn-primary:hover { background: var(--btn-hover); }
    .btn-secondary {
      background: var(--btn-secondary);
      color: var(--fg);
    }
    .btn-secondary:hover { background: var(--btn-secondary-hover); }
    .btn-danger {
      background: transparent;
      color: var(--danger);
      border: 1px solid var(--danger);
    }
    .btn-danger:hover { background: color-mix(in srgb, var(--danger) 15%, transparent); }

    .status-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
    }
    .status-running { background: color-mix(in srgb, var(--success) 20%, transparent); color: var(--success); }
    .status-disabled { background: color-mix(in srgb, var(--danger) 20%, transparent); color: var(--danger); }

    /* 柱状图 */
    .chart-container {
      margin: 12px 0 8px 0;
      padding: 12px;
      background: var(--input-bg);
      border-radius: var(--radius);
    }
    .chart-bars {
      display: flex;
      align-items: flex-end;
      justify-content: space-around;
      height: 100px;
      gap: 4px;
      margin-top: 8px;
    }
    .chart-bar-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
      justify-content: flex-end;
    }
    .chart-bar {
      width: 100%;
      max-width: 32px;
      min-height: 2px;
      border-radius: 3px 3px 0 0;
      background: var(--btn-bg);
      transition: height 0.4s ease;
      cursor: pointer;
      position: relative;
    }
    .chart-bar:hover {
      opacity: 0.8;
    }
    .chart-bar-label {
      font-size: 10px;
      color: var(--description);
      margin-top: 4px;
      text-align: center;
    }
    .chart-bar-value {
      font-size: 9px;
      color: var(--description);
      margin-bottom: 2px;
      text-align: center;
    }
    .chart-empty {
      color: var(--description);
      text-align: center;
      padding: 24px 0;
      font-size: 12px;
    }
    .week-total {
      text-align: center;
      font-size: 12px;
      color: var(--description);
      margin-top: 8px;
    }
    .week-total strong {
      color: var(--success);
      font-weight: 700;
    }

    /* 帮助提示图标 */
    .help-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--description);
      font-size: 10px;
      font-weight: 700;
      cursor: help;
      margin-left: 6px;
      flex-shrink: 0;
      position: relative;
    }
    .help-icon:hover {
      border-color: var(--focus);
      color: var(--fg);
    }
    .help-icon .tooltip {
      display: none;
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 400;
      color: var(--fg);
      white-space: nowrap;
      z-index: 10;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      pointer-events: none;
    }
    .help-icon:hover .tooltip {
      display: block;
    }
    .help-icon .tooltip::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: var(--border);
    }

    .setting-header-row {
      display: flex;
      align-items: center;
    }

    #statusToast {
      position: fixed;
      bottom: 16px;
      right: 16px;
      padding: 8px 16px;
      border-radius: var(--radius);
      background: var(--input-bg);
      border: 1px solid var(--border);
      font-size: 12px;
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: none;
    }
    #statusToast.show { opacity: 1; }
  </style>
</head>
<body>

  <h1>⏱ 工作区计时</h1>

  <!-- 统计卡片 -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="value" id="statToday">--</div>
      <div class="label">今日</div>
    </div>
    <div class="stat-card">
      <div class="value" id="statWeek">--</div>
      <div class="label">本周</div>
    </div>
    <div class="stat-card">
      <div class="value" id="statTotal">--</div>
      <div class="label">累计（本工作区）</div>
    </div>
    <div class="stat-card">
      <div class="value" id="statGlobalTotal">--</div>
      <div class="label">跨工作区累计</div>
    </div>
    <div class="stat-card">
      <div class="value" id="statSessions">--</div>
      <div class="label">会话数</div>
    </div>
    <div class="stat-card">
      <div class="value" id="statStatus">--</div>
      <div class="label">状态</div>
    </div>
  </div>

  <!-- 周报 + 柱状图 -->
  <div class="section">
    <h2>📊 周报</h2>
    <div class="chart-container">
      <div id="chartEmpty" class="chart-empty">暂无数据，开始编程后会自动记录</div>
      <div id="chartBars" class="chart-bars" style="display:none"></div>
      <div id="weekTotal" class="week-total" style="display:none"></div>
    </div>
  </div>

  <!-- 跨工作区 -->
  <div class="section" id="globalSection">
    <h2>🌐 跨工作区</h2>
    <div id="workspaceList" style="margin-bottom:8px">
      <div class="chart-empty" id="globalEmpty">暂无其他工作区数据</div>
    </div>
  </div>

  <!-- 基本设置 -->
  <div class="section">
    <h2>基本设置</h2>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>工作区计时</span>
          <span class="help-icon">?<span class="tooltip">启用后，当前 VS Code 窗口打开即开始累计时长；<br>禁用后完全停止计时和记录</span></span>
        </div>
        <div class="desc">启用/禁用当前工作区的计时</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="chkEnabled" data-key="isEnabled">
        <span class="slider"></span>
      </label>
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>全局禁用</span>
          <span class="help-icon">?<span class="tooltip">全局禁用后所有工作区均不计时，<br>优先级高于工作区独立开关</span></span>
        </div>
        <div class="desc">禁用所有工作区的计时（优先级最高）</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="chkGlobalDisabled" data-key="globalDisabled">
        <span class="slider"></span>
      </label>
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>状态栏显示</span>
          <span class="help-icon">?<span class="tooltip">状态栏显示今日时长和累计时长；<br>点击可循环切换显示模式</span></span>
        </div>
        <div class="desc">在底部状态栏显示计时</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="chkStatusBar" data-key="statusBarEnabled">
        <span class="slider"></span>
      </label>
    </div>
  </div>

  <!-- 存储设置 -->
  <div class="section">
    <h2>⚙️ 存储设置</h2>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>崩溃保护</span>
          <span class="help-icon">?<span class="tooltip">每 10 秒将时间片写入 .journal 文件；<br>VS Code 崩溃后重启时可回放恢复，<br>最多丢失约 10 秒数据</span></span>
        </div>
        <div class="desc">启用 journal 文件防止崩溃数据丢失</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="chkJournal" data-key="journalEnabled">
        <span class="slider"></span>
      </label>
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>JSON 备份</span>
          <span class="help-icon">?<span class="tooltip">额外写入 .vscode/workspace-timing.json；<br>用户可见、可版本控制、可移植</span></span>
        </div>
        <div class="desc">额外写入 .vscode/workspace-timing.json</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="chkBackup" data-key="backupToFile">
        <span class="slider"></span>
      </label>
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>RingBuffer 容量</span>
          <span class="help-icon">?<span class="tooltip">内存中缓存的时间片数量；<br>越大则 UI 可查询的历史越久，<br>但占用内存越多（推荐 1024 ≈ 17 分钟）</span></span>
        </div>
        <div class="desc">环形缓冲区条目数 (64~65536)</div>
      </div>
      <input class="number-input" type="number" id="numRingBuffer" data-key="ringBufferCapacity" min="64" max="65536">
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>Journal 写入间隔</span>
          <span class="help-icon">?<span class="tooltip">内存缓存写入 journal 文件的频率；<br>间隔越短丢失越少，但磁盘写入越频繁</span></span>
        </div>
        <div class="desc">毫秒 (1000~300000)</div>
      </div>
      <input class="number-input" type="number" id="numJournalInterval" data-key="journalFlushIntervalMs" min="1000" max="300000">
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>全量存盘间隔</span>
          <span class="help-icon">?<span class="tooltip">将完整计时数据写入 workspaceState 和 JSON 文件的频率；<br>间隔越短数据越安全，但写入越频繁</span></span>
        </div>
        <div class="desc">毫秒 (5000~600000)</div>
      </div>
      <input class="number-input" type="number" id="numFullSaveInterval" data-key="fullSaveIntervalMs" min="5000" max="600000">
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>会话保留上限</span>
          <span class="help-icon">?<span class="tooltip">最多保留的会话记录条数；<br>超出时自动删除最旧记录；<br>设为 0 表示不限（注意内存占用）</span></span>
        </div>
        <div class="desc">0 = 不限</div>
      </div>
      <input class="number-input" type="number" id="numMaxSessions" data-key="maxSessions" min="0">
    </div>
  </div>

  <!-- 操作 -->
  <div class="section">
    <h2>🔧 操作</h2>
    <div class="btn-row">
      <button class="btn btn-primary" id="btnNewPeriod">新建计时周期</button>
      <button class="btn btn-secondary" id="btnExportCSV">导出 CSV</button>
      <button class="btn btn-danger" id="btnReset">重置所有数据</button>
    </div>
    <div style="margin-top:8px;font-size:11px;color:var(--description)">
      <strong>新建计时周期</strong>：累计归零，历史保留在会话记录中<br>
      <strong>重置所有数据</strong>：清空所有计时数据和历史，不可撤销
    </div>
  </div>

  <div id="statusToast"></div>

  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      let pendingData = null;

      // ---- 更新 UI ----
      function updateUI(data) {
        // 统计卡片
        document.getElementById('statToday').textContent = formatDuration(data.todayMs);
        document.getElementById('statWeek').textContent = formatDuration(data.weekTotalMs || 0);
        document.getElementById('statTotal').textContent = formatDuration(data.totalMs);
        document.getElementById('statGlobalTotal').textContent = formatDuration(data.globalTotalMs || 0);
        document.getElementById('statSessions').textContent = String(data.sessionsCount);

        const statusEl = document.getElementById('statStatus');
        if (data.globalDisabled) {
          statusEl.innerHTML = '<span class="status-badge status-disabled">全局禁用</span>';
        } else if (!data.isEnabled) {
          statusEl.innerHTML = '<span class="status-badge status-disabled">已禁用</span>';
        } else {
          statusEl.innerHTML = '<span class="status-badge status-running">运行中</span>';
        }

        // 设置项
        setChecked('chkEnabled', data.isEnabled);
        setChecked('chkGlobalDisabled', data.globalDisabled);
        setChecked('chkStatusBar', data.statusBarEnabled);
        setChecked('chkJournal', data.journalEnabled);
        setChecked('chkBackup', data.backupToFile);
        setValue('numRingBuffer', data.ringBufferCapacity);
        setValue('numJournalInterval', data.journalFlushIntervalMs);
        setValue('numFullSaveInterval', data.fullSaveIntervalMs);
        setValue('numMaxSessions', data.maxSessions);

        // 跨工作区列表
        renderWorkspaceList(data.workspaceList, data.workspaceCount);

        // 柱状图
        renderChart(data.dailyStats, data.weekTotalMs);

        pendingData = data;
      }

      function setChecked(id, val) {
        const el = document.getElementById(id);
        if (el) el.checked = !!val;
      }
      function setValue(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = String(val);
      }

      function formatDuration(ms) {
        const s = Math.floor(ms / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) return h + 'h ' + m + 'm';
        if (m > 0) return m + 'm ' + sec + 's';
        return sec + 's';
      }

      // ---- 跨工作区列表渲染 ----
      function renderWorkspaceList(workspaces, count) {
        const container = document.getElementById('workspaceList');
        const emptyEl = document.getElementById('globalEmpty');

        if (!workspaces || workspaces.length <= 1) {
          container.innerHTML = '<div class="chart-empty">暂无其他工作区数据</div>';
          return;
        }

        let html = '';
        for (const ws of workspaces) {
          html += '<div class="setting-row">' +
            '<div class="setting-label">' +
            '<div>' + escapeHtml(ws.name) + '</div>' +
            '</div>' +
            '<div style="font-family:monospace;font-size:12px">' + formatDuration(ws.totalMs) + '</div>' +
            '</div>';
        }
        container.innerHTML = html;
      }

      function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
      }

      // ---- 柱状图渲染 ----
      function renderChart(dailyStats, weekTotalMs) {
        const container = document.getElementById('chartBars');
        const emptyEl = document.getElementById('chartEmpty');
        const weekTotalEl = document.getElementById('weekTotal');

        if (!dailyStats || dailyStats.length === 0 || dailyStats.every(d => d.totalMs === 0)) {
          container.style.display = 'none';
          weekTotalEl.style.display = 'none';
          emptyEl.style.display = 'block';
          return;
        }

        emptyEl.style.display = 'none';
        container.style.display = 'flex';
        weekTotalEl.style.display = 'block';

        const maxVal = Math.max(...dailyStats.map(d => d.totalMs), 1);

        container.innerHTML = dailyStats.map(d => {
          const pct = Math.max((d.totalMs / maxVal) * 100, 2);
          const valStr = formatDuration(d.totalMs);
          return '<div class="chart-bar-wrapper">' +
            '<div class="chart-bar-value">' + valStr + '</div>' +
            '<div class="chart-bar" style="height:' + pct + '%"></div>' +
            '<div class="chart-bar-label">' + d.weekday + '</div>' +
            '<div class="chart-bar-label" style="font-size:9px">' + d.label + '</div>' +
            '</div>';
        }).join('');

        weekTotalEl.innerHTML = '本周合计：<strong>' + formatDuration(weekTotalMs || 0) + '</strong>';
      }

      // ---- 消息通信 ----
      window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'updateData' && msg.payload) {
          updateUI(msg.payload);
        }
      });

      // ---- 发送配置变更 ----
      function sendUpdate(key, value) {
        vscode.postMessage({ type: 'updateConfig', payload: { [key]: value } });
      }

      // 复选框变更
      document.querySelectorAll('.toggle input[type="checkbox"]').forEach(el => {
        el.addEventListener('change', () => {
          sendUpdate(el.dataset.key, el.checked);
        });
      });

      // 数字输入变更
      document.querySelectorAll('.number-input').forEach(el => {
        let timeout = null;
        el.addEventListener('input', () => {
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            sendUpdate(el.dataset.key, parseInt(el.value) || 0);
          }, 500);
        });
      });

      // ---- 操作按钮 ----
      document.getElementById('btnNewPeriod').addEventListener('click', () => {
        vscode.postMessage({ type: 'newPeriod' });
        showToast('已请求新建计时周期');
      });

      document.getElementById('btnExportCSV').addEventListener('click', () => {
        vscode.postMessage({ type: 'exportCSV' });
        showToast('已请求导出 CSV');
      });

      document.getElementById('btnReset').addEventListener('click', () => {
        if (confirm('确定要重置所有计时数据？此操作不可撤销！')) {
          vscode.postMessage({ type: 'reset' });
          showToast('已请求重置数据');
        }
      });

      // ---- Toast 提示 ----
      function showToast(msg) {
        const toast = document.getElementById('statusToast');
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
      }
    })();
  </script>
</body>
</html>`;
    }
}
exports.DashboardPanel = DashboardPanel;
/** 全局消息处理器，所有面板共享 */
DashboardPanel._messageHandler = null;
//# sourceMappingURL=DashboardPanel.js.map