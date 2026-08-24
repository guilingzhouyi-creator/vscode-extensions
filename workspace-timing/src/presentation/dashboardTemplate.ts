/**
 * dashboardTemplate — 面板 HTML 模板（纯数据，零逻辑）
 *
 * 从 DashboardPanel.ts 机械搬移而来：仅 ${args.nonce}/${cspSource} 两类插值改为参数化。
 * 边界：不引用任何 VS Code API 与运行时状态；面板生命周期逻辑见 DashboardPanel.ts。
 */

export interface DashboardTemplateArgs {
    /** CSP nonce（每次渲染唯一） */
    nonce: string;
    /** webview 资源源（panel.webview.cspSource） */
    cspSource: string;
    /**
     * 面板词条表（panel.* 与 confirm.* 子集，由 i18n/labelsWithPrefix 构建）。
     * 静态 HTML 用 ${args.labels['key']} 插值；webview 脚本经 JSON 注入为常量 L。
     */
    labels: Record<string, string>;
}

export function buildDashboardHtml(args: DashboardTemplateArgs): string {
    return /* html */ `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${args.cspSource} 'unsafe-inline'; script-src 'nonce-${args.nonce}'; img-src ${args.cspSource} data:; font-src ${args.cspSource};">
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

    /* 跨工作区对比视图（R1） */
    .ws-compare-row {
      padding: 8px 0;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
    }
    .ws-compare-row:last-of-type {
      border-bottom: none;
    }
    .ws-compare-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
      gap: 8px;
    }
    .ws-compare-name {
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }
    .ws-compare-value {
      font-family: monospace;
      font-size: 12px;
      flex-shrink: 0;
    }
    .ws-compare-share {
      font-size: 10px;
      color: var(--description);
      margin-left: 6px;
    }
    .ws-compare-track {
      height: 8px;
      border-radius: 4px;
      background: var(--input-bg);
      overflow: hidden;
    }
    .ws-compare-fill {
      height: 100%;
      border-radius: 4px;
      background: linear-gradient(90deg, var(--btn-bg), var(--focus));
      transition: width 0.4s ease;
      min-width: 2px;
    }
    .ws-compare-total {
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
      font-size: 12px;
      color: var(--description);
    }
    .ws-compare-total strong {
      color: var(--success);
      font-weight: 700;
    }
    .ws-compare-count {
      font-size: 10px;
      margin-left: 6px;
    }

    /* 周报摘要 / 日报明细 */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 8px;
      margin-bottom: 8px;
    }
    .summary-item {
      background: var(--input-bg);
      border-radius: var(--radius);
      padding: 8px 10px;
      text-align: center;
    }
    .summary-item .value {
      font-size: 16px;
      font-weight: 700;
      color: var(--success);
    }
    .summary-item .label {
      font-size: 10px;
      color: var(--description);
      margin-top: 2px;
    }
    .report-block {
      margin-bottom: 12px;
    }
    .session-list {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }
    .session-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
      font-size: 12px;
    }
    .session-row:last-child { border-bottom: none; }
    .session-time { color: var(--description); font-family: var(--vscode-editor-font-family, monospace); }
    .session-dur { font-family: var(--vscode-editor-font-family, monospace); }
    .empty-hint {
      color: var(--description);
      text-align: center;
      padding: 12px;
      font-size: 12px;
    }
    .trend-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 12px;
    }
    .trend-label {
      width: 56px;
      color: var(--description);
      flex-shrink: 0;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .trend-track {
      flex: 1;
      height: 10px;
      border-radius: 5px;
      background: var(--input-bg);
      overflow: hidden;
    }
    .trend-fill {
      height: 100%;
      border-radius: 5px;
      background: linear-gradient(90deg, var(--btn-bg), var(--focus));
      transition: width 0.4s ease;
      min-width: 2px;
    }
    .trend-value {
      width: 70px;
      text-align: right;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--success);
      flex-shrink: 0;
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

  <h1>${args.labels['panel.title']}</h1>

  <!-- 统计卡片 -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="value" id="statToday">--</div>
      <div class="label">${args.labels['panel.label.today']}</div>
    </div>
    <div class="stat-card">
      <div class="value" id="statWeek">--</div>
      <div class="label">${args.labels['panel.label.week']}</div>
    </div>
    <div class="stat-card">
      <div class="value" id="statTotal">--</div>
      <div class="label">${args.labels['panel.label.totalWs']}</div>
    </div>
    <div class="stat-card">
      <div class="value" id="statGlobalTotal">--</div>
      <div class="label">${args.labels['panel.label.global']}</div>
    </div>
    <div class="stat-card">
      <div class="value" id="statSessions">--</div>
      <div class="label">${args.labels['panel.label.sessions']}</div>
    </div>
    <div class="stat-card">
      <div class="value" id="statStatus">--</div>
      <div class="label">${args.labels['panel.label.status']}</div>
    </div>
  </div>

  <!-- 周报 + 柱状图 -->
  <div class="section">
    <h2>${args.labels['panel.weekly.title']}</h2>
    <div class="chart-container">
      <div id="chartEmpty" class="chart-empty">${args.labels['panel.weekly.emptyChart']}</div>
      <div id="chartBars" class="chart-bars" style="display:none"></div>
      <div id="weekTotal" class="week-total" style="display:none"></div>
    </div>
    <!-- 周报文字摘要 -->
    <div id="weeklySummary" class="report-block" style="display:none">
      <div class="summary-grid">
        <div class="summary-item">
          <div class="value" id="sumTotal">--</div>
          <div class="label">${args.labels['panel.weekly.totalLabel']}</div>
        </div>
        <div class="summary-item">
          <div class="value" id="sumAvg">--</div>
          <div class="label">${args.labels['panel.weekly.avgDaily']}</div>
        </div>
        <div class="summary-item">
          <div class="value" id="sumActiveDays">--</div>
          <div class="label">${args.labels['panel.weekly.activeDays']}</div>
        </div>
        <div class="summary-item">
          <div class="value" id="sumPeakDate">--</div>
          <div class="label">${args.labels['panel.weekly.peakDate']}</div>
        </div>
        <div class="summary-item">
          <div class="value" id="sumSessions">--</div>
          <div class="label">${args.labels['panel.label.sessions']}</div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="btnExportWeekly">${args.labels['panel.weekly.exportBtn']}</button>
      </div>
    </div>
    <!-- 多周趋势 -->
    <div id="weeklyTrend" class="report-block" style="display:none">
      <h3>${args.labels['panel.weekly.trendTitle']}</h3>
      <div id="trendList"></div>
    </div>
  </div>

  <!-- 今日明细 -->
  <div class="section" id="todaySection" style="display:none">
    <h2>${args.labels['panel.today.title']}</h2>
    <div class="report-block">
      <div class="summary-grid">
        <div class="summary-item">
          <div class="value" id="todayDetailTotal">--</div>
          <div class="label">${args.labels['panel.today.duration']}</div>
        </div>
        <div class="summary-item">
          <div class="value" id="todayDetailCount">--</div>
          <div class="label">${args.labels['panel.label.sessions']}</div>
        </div>
        <div class="summary-item">
          <div class="value" id="todayDetailWindow">--</div>
          <div class="label">${args.labels['panel.today.activeWindow']}</div>
        </div>
      </div>
      <div id="sessionList" class="session-list" style="display:none"></div>
      <div class="empty-hint" id="sessionEmpty" style="display:none">${args.labels['panel.today.empty']}</div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="btnExportDaily">${args.labels['panel.today.exportBtn']}</button>
      </div>
    </div>
  </div>

  <!-- 跨工作区 -->
  <div class="section" id="globalSection">
    <h2>${args.labels['panel.global.title']}</h2>
    <div id="workspaceList" style="margin-bottom:8px">
      <div class="chart-empty" id="globalEmpty">${args.labels['panel.global.empty']}</div>
    </div>
  </div>

  <!-- 基本设置 -->
  <div class="section">
    <h2>${args.labels['panel.section.basic']}</h2>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>${args.labels['panel.set.enabled.name']}</span>
          <span class="help-icon">?<span class="tooltip"></span></span>
        </div>
        <div class="desc">${args.labels['panel.set.enabled.desc']}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="chkEnabled" data-key="isEnabled">
        <span class="slider"></span>
      </label>
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>${args.labels['panel.set.globalDisabled.name']}</span>
          <span class="help-icon">?<span class="tooltip"></span></span>
        </div>
        <div class="desc">${args.labels['panel.set.globalDisabled.desc']}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="chkGlobalDisabled" data-key="globalDisabled">
        <span class="slider"></span>
      </label>
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>${args.labels['panel.set.statusBar.name']}</span>
          <span class="help-icon">?<span class="tooltip"></span></span>
        </div>
        <div class="desc">${args.labels['panel.set.statusBar.desc']}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="chkStatusBar" data-key="statusBarEnabled">
        <span class="slider"></span>
      </label>
    </div>
  </div>

  <!-- 存储设置 -->
  <div class="section">
    <h2>${args.labels['panel.section.storage']}</h2>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>${args.labels['panel.set.journal.name']}</span>
          <span class="help-icon">?<span class="tooltip"></span></span>
        </div>
        <div class="desc">${args.labels['panel.set.journal.desc']}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="chkJournal" data-key="journalEnabled">
        <span class="slider"></span>
      </label>
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>${args.labels['panel.set.backup.name']}</span>
          <span class="help-icon">?<span class="tooltip"></span></span>
        </div>
        <div class="desc">${args.labels['panel.set.backup.desc']}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="chkBackup" data-key="backupToFile">
        <span class="slider"></span>
      </label>
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>${args.labels['panel.set.ringBuffer.name']}</span>
          <span class="help-icon">?<span class="tooltip"></span></span>
        </div>
        <div class="desc">${args.labels['panel.set.ringBuffer.desc']}</div>
      </div>
      <input class="number-input" type="number" id="numRingBuffer" data-key="ringBufferCapacity" min="64" max="65536">
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>${args.labels['panel.set.journalInterval.name']}</span>
          <span class="help-icon">?<span class="tooltip"></span></span>
        </div>
        <div class="desc">${args.labels['panel.set.journalInterval.desc']}</div>
      </div>
      <input class="number-input" type="number" id="numJournalInterval" data-key="journalFlushIntervalMs" min="1000" max="300000">
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>${args.labels['panel.set.fullSaveInterval.name']}</span>
          <span class="help-icon">?<span class="tooltip"></span></span>
        </div>
        <div class="desc">${args.labels['panel.set.fullSaveInterval.desc']}</div>
      </div>
      <input class="number-input" type="number" id="numFullSaveInterval" data-key="fullSaveIntervalMs" min="5000" max="600000">
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>${args.labels['panel.set.maxSessions.name']}</span>
          <span class="help-icon">?<span class="tooltip"></span></span>
        </div>
        <div class="desc">${args.labels['panel.set.maxSessions.desc']}</div>
      </div>
      <input class="number-input" type="number" id="numMaxSessions" data-key="maxSessions" min="0">
    </div>
  </div>

  <!-- 操作 -->
  <div class="section">
    <h2>${args.labels['panel.section.actions']}</h2>
    <div class="btn-row">
      <button class="btn btn-primary" id="btnNewPeriod">${args.labels['panel.actions.newPeriod']}</button>
      <button class="btn btn-secondary" id="btnExportCSV">${args.labels['panel.actions.exportCsv']}</button>
      <button class="btn btn-danger" id="btnReset">${args.labels['panel.actions.reset']}</button>
    </div>
    <div style="margin-top:8px;font-size:11px;color:var(--description)">
      <strong>${args.labels['panel.actions.newPeriod']}</strong>${args.labels['panel.actions.hintPeriodDesc']}<br>
      <strong>${args.labels['panel.actions.reset']}</strong>${args.labels['panel.actions.hintResetDesc']}
    </div>
  </div>

  <div id="statusToast"></div>

  <script nonce="${args.nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      // 词条表（渲染时由扩展宿主按当前语言序列化注入）
      const L = ${JSON.stringify(args.labels)};
      // {0} 占位符格式化（词条中的可变部分）
      function fmt(tpl, v) { return String(tpl).replace('{0}', String(v)); }
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
          statusEl.innerHTML = '<span class="status-badge status-disabled">' + L['panel.js.badgeGlobalDisabled'] + '</span>';
        } else if (!data.isEnabled) {
          statusEl.innerHTML = '<span class="status-badge status-disabled">' + L['panel.js.badgeDisabled'] + '</span>';
        } else {
          statusEl.innerHTML = '<span class="status-badge status-running">' + L['panel.js.badgeRunning'] + '</span>';
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

        // 跨工作区对比视图
        renderWorkspaceCompare(data.workspaceList, data.workspaceCount, data.globalTotalMs);

        // 柱状图
        renderChart(data.dailyStats, data.weekTotalMs);

        // 周报摘要 + 多周趋势 + 今日明细
        renderWeeklySummary(data.weeklySummary, data.weeklyTrend);
        renderTodayDetail(data.todayDetail);

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

      // ---- 跨工作区对比视图渲染（R1：多工作区时长对比可视化） ----
      function renderWorkspaceCompare(workspaces, count, globalTotalMs) {
        const container = document.getElementById('workspaceList');

        if (!workspaces || workspaces.length <= 1) {
          container.innerHTML = '<div class="chart-empty">' + L['panel.global.empty'] + '</div>';
          return;
        }

        const maxVal = Math.max(...workspaces.map(ws => ws.totalMs), 1);
        const grandTotal = globalTotalMs || workspaces.reduce((sum, ws) => sum + (ws.totalMs || 0), 0);

        let html = '';
        for (const ws of workspaces) {
          const pct = Math.max((ws.totalMs / maxVal) * 100, 2);
          const share = grandTotal > 0 ? Math.round((ws.totalMs / grandTotal) * 100) : 0;
          html +=
            '<div class="ws-compare-row">' +
              '<div class="ws-compare-header">' +
                '<div class="ws-compare-name" title="' + escapeHtml(ws.name) + '">' + escapeHtml(ws.name) + '</div>' +
                '<div class="ws-compare-value">' + formatDuration(ws.totalMs) +
                  '<span class="ws-compare-share">' + share + '%</span></div>' +
              '</div>' +
              '<div class="ws-compare-track">' +
                '<div class="ws-compare-fill" style="width:' + pct + '%"></div>' +
              '</div>' +
            '</div>';
        }

        html +=
          '<div class="ws-compare-total">' + L['panel.js.grandTotalPrefix'] + '<strong>'' + formatDuration(grandTotal) +
          '</strong><span class="ws-compare-count">' + fmt(L['panel.js.workspaceCountFmt'], count) + '' + count + ')</span></div>';

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
            '<div class="chart-bar-label">' + escapeHtml(d.weekday) + '</div>' +
            '<div class="chart-bar-label" style="font-size:9px">' + escapeHtml(d.label) + '</div>' +
            '</div>';
        }).join('');

        weekTotalEl.innerHTML = L['panel.js.weekTotalPrefix'] + '<strong>' + formatDuration(weekTotalMs || 0) + '</strong>';
      }

      // ---- 周报摘要 + 多周趋势渲染 ----
      function renderWeeklySummary(summary, trend) {
        const sumEl = document.getElementById('weeklySummary');
        const trendEl = document.getElementById('weeklyTrend');

        if (!summary || summary.totalMs <= 0) {
          sumEl.style.display = 'none';
          trendEl.style.display = 'none';
          return;
        }

        // 摘要
        sumEl.style.display = 'block';
        document.getElementById('sumTotal').textContent = formatDuration(summary.totalMs);
        document.getElementById('sumAvg').textContent = formatDuration(summary.avgDailyMs);
        document.getElementById('sumActiveDays').textContent = fmt(L['panel.js.daysFmt'], summary.activeDays);
        document.getElementById('sumPeakDate').textContent = summary.peakDate || '--';
        document.getElementById('sumSessions').textContent = String(summary.sessionCount);

        // 多周趋势
        if (trend && trend.length > 0) {
          trendEl.style.display = 'block';
          const maxVal = Math.max(...trend.map(w => w.totalMs), 1);
          document.getElementById('trendList').innerHTML = trend.map(w => {
            const pct = Math.max((w.totalMs / maxVal) * 100, 2);
            return '<div class="trend-row">' +
              '<div class="trend-label" title="' + escapeHtml(w.weekStart) + '">' + escapeHtml(w.label) + '</div>' +
              '<div class="trend-track"><div class="trend-fill" style="width:' + pct + '%"></div></div>' +
              '<div class="trend-value">' + formatDuration(w.totalMs) + '</div>' +
              '</div>';
          }).join('');
        } else {
          trendEl.style.display = 'none';
        }
      }

      // ---- 今日明细渲染 ----
      function renderTodayDetail(detail) {
        const section = document.getElementById('todaySection');
        const listEl = document.getElementById('sessionList');
        const emptyEl = document.getElementById('sessionEmpty');

        if (!detail || detail.sessionCount === 0) {
          section.style.display = 'none';
          return;
        }

        section.style.display = 'block';
        document.getElementById('todayDetailTotal').textContent = formatDuration(detail.totalMs);
        document.getElementById('todayDetailCount').textContent = String(detail.sessionCount);
        document.getElementById('todayDetailWindow').textContent = detail.activeWindow || '--';

        if (detail.sessions.length > 0) {
          emptyEl.style.display = 'none';
          listEl.style.display = 'block';
          listEl.innerHTML = detail.sessions.map(s =>
            '<div class="session-row">' +
              '<div class="session-time">' + escapeHtml(s.startLabel) + ' → ' + escapeHtml(s.endLabel) + '</div>' +
              '<div class="session-dur">' + formatDuration(s.durationMs) + '</div>' +
            '</div>'
          ).join('');
        } else {
          listEl.style.display = 'none';
          emptyEl.style.display = 'block';
        }
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
        showToast(L['panel.toast.newPeriodRequested']);
      });

      document.getElementById('btnExportCSV').addEventListener('click', () => {
        vscode.postMessage({ type: 'exportCSV' });
        showToast(L['panel.toast.exportCsvRequested']);
      });

      document.getElementById('btnReset').addEventListener('click', () => {
        if (confirm(L['confirm.reset'])) {
          vscode.postMessage({ type: 'reset' });
          showToast(L['panel.toast.resetRequested']);
        }
      });

      // 导出日报 / 周报
      document.getElementById('btnExportDaily').addEventListener('click', () => {
        vscode.postMessage({ type: 'exportReport', payload: { kind: 'daily' } });
        showToast(L['panel.toast.exportDailyRequested']);
      });
      document.getElementById('btnExportWeekly').addEventListener('click', () => {
        vscode.postMessage({ type: 'exportReport', payload: { kind: 'weekly' } });
        showToast(L['panel.toast.exportWeeklyRequested']);
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
</html>
`;}
