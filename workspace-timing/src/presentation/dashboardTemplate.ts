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

    /* 下拉选择（语言切换等） */
    .select-input {
      padding: 4px 8px;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: var(--radius);
      font-size: 12px;
      font-family: var(--vscode-font-family, inherit);
    }
    .select-input:focus {
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

    /* 按小时分布柱状图 */
    .hourly-chart {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 60px;
      margin: 8px 0 4px 0;
      padding: 4px 2px;
      background: var(--input-bg);
      border-radius: var(--radius);
    }
    .hourly-bar {
      flex: 1;
      min-width: 3px;
      border-radius: 2px 2px 0 0;
      background: var(--btn-bg);
      opacity: 0.75;
      transition: height 0.3s ease;
    }
    .hourly-bar:hover { opacity: 1; }
    .hourly-bar.is-peak { background: var(--focus); opacity: 1; }
    /* 小时 X 轴刻度（与柱状图同 24 格对齐；每 4 小时标注一次） */
    .hourly-axis {
      display: flex;
      gap: 2px;
      margin: 0 2px 8px 2px;
      font-size: 9px;
      color: var(--description);
      text-align: center;
    }
    .hourly-axis .tick {
      flex: 1;
      min-width: 0;
      overflow: visible;
      white-space: nowrap;
    }

    /* 实时活跃曲线 */
    .chart-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-size: 11px;
      color: var(--description);
    }
    .chart-mode-btn {
      padding: 2px 10px;
      border: 1px solid var(--input-border);
      border-radius: 10px;
      background: var(--input-bg);
      color: var(--fg);
      font-size: 11px;
      font-family: inherit;
      cursor: pointer;
    }
    .chart-mode-btn:hover { border-color: var(--focus); }
    .active-curve {
      display: block;
      height: 60px;
      margin: 8px 0 4px 0;
      padding: 4px 2px;
      background: var(--input-bg);
      border-radius: var(--radius);
    }
    .ac-svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    .ac-line {
      fill: none;
      stroke: var(--success);
      stroke-width: 2;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .ac-area {
      fill: color-mix(in srgb, var(--success) 22%, transparent);
    }

    /* 活动时间线热力图 */
    .heatmap-wrap {
      display: flex;
      gap: 6px;
      align-items: flex-start;
    }
    .heatmap-weekdays {
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 10px;
      color: var(--description);
    }
    .heatmap-weekdays span {
      height: 12px;
      line-height: 12px;
      display: block;
    }
    .heatmap {
      display: flex;
      gap: 3px;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .heatmap-week {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .hm-cell {
      width: 12px;
      height: 12px;
      border-radius: 2px;
      background: color-mix(in srgb, var(--fg) 12%, transparent);
    }
    .hm-cell.l1 { background: #9be9a8; }
    .hm-cell.l2 { background: #40c463; }
    .hm-cell.l3 { background: #30a14e; }
    .hm-cell.l4 { background: #216e39; }
    .hm-cell.future { opacity: 0.35; }
    .hm-cell:hover {
      outline: 1px solid var(--focus);
      outline-offset: 1px;
    }
    .heatmap-legend {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
      font-size: 10px;
      color: var(--description);
    }
    .heatmap-legend .hm-cell {
      width: 11px;
      height: 11px;
    }
    .heatmap-range {
      font-size: 11px;
      color: var(--description);
      margin-bottom: 6px;
    }
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
      <div class="chart-toolbar">
        <span id="chartModeLabel">${args.labels['panel.js.chartModeBars']}</span>
        <button class="chart-mode-btn" id="btnToggleChartMode">${args.labels['panel.js.chartModeCurve']}</button>
      </div>
      <div id="chartEmpty" class="chart-empty">${args.labels['panel.weekly.emptyChart']}</div>
      <div id="chartBars" class="chart-bars" style="display:none"></div>
      <div id="activeCurve" class="active-curve" style="display:none"></div>
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

  <!-- 活动时间线热力图 -->
  <div class="section" id="heatmapSection">
    <h2>${args.labels['panel.heatmap.title']}</h2>
    <div class="heatmap-range" id="heatmapRange"></div>
    <div class="heatmap-wrap">
      <div class="heatmap-weekdays">
        <span>${args.labels['panel.heatmap.mon']}</span>
        <span></span>
        <span>${args.labels['panel.heatmap.wed']}</span>
        <span></span>
        <span>${args.labels['panel.heatmap.fri']}</span>
        <span></span>
        <span></span>
      </div>
      <div id="heatmap" class="heatmap"></div>
    </div>
    <div class="heatmap-legend">
      <span>${args.labels['panel.heatmap.less']}</span>
      <div class="hm-cell"></div>
      <div class="hm-cell l1"></div>
      <div class="hm-cell l2"></div>
      <div class="hm-cell l3"></div>
      <div class="hm-cell l4"></div>
      <span>${args.labels['panel.heatmap.more']}</span>
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
      <h3 id="hourlyTitle" style="display:none;margin-top:12px">${args.labels['panel.today.hourlyTitle']}</h3>
      <div id="hourlyChart" class="hourly-chart" style="display:none"></div>
      <div id="hourlyAxis" class="hourly-axis" style="display:none"></div>
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
          <span class="help-icon">?<span class="tooltip">${args.labels['panel.set.enabled.tip']}</span></span>
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
          <span class="help-icon">?<span class="tooltip">${args.labels['panel.set.globalDisabled.tip']}</span></span>
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
          <span class="help-icon">?<span class="tooltip">${args.labels['panel.set.statusBar.tip']}</span></span>
        </div>
        <div class="desc">${args.labels['panel.set.statusBar.desc']}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="chkStatusBar" data-key="statusBarEnabled">
        <span class="slider"></span>
      </label>
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>${args.labels['panel.set.locale.name']}</span>
          <span class="help-icon">?<span class="tooltip">${args.labels['panel.set.locale.tip']}</span></span>
        </div>
        <div class="desc">${args.labels['panel.set.locale.desc']}</div>
      </div>
      <select class="select-input" id="selLocale" data-key="locale">
        <option value="auto">${args.labels['panel.set.locale.auto']}</option>
        <option value="zh-CN">${args.labels['panel.set.locale.zhCN']}</option>
        <option value="en">${args.labels['panel.set.locale.en']}</option>
      </select>
    </div>
  </div>

  <!-- 存储设置 -->
  <div class="section">
    <h2>${args.labels['panel.section.storage']}</h2>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>${args.labels['panel.set.journal.name']}</span>
          <span class="help-icon">?<span class="tooltip">${args.labels['panel.set.journal.tip']}</span></span>
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
          <span class="help-icon">?<span class="tooltip">${args.labels['panel.set.backup.tip']}</span></span>
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
          <span class="help-icon">?<span class="tooltip">${args.labels['panel.set.ringBuffer.tip']}</span></span>
        </div>
        <div class="desc">${args.labels['panel.set.ringBuffer.desc']}</div>
      </div>
      <input class="number-input" type="number" id="numRingBuffer" data-key="ringBufferCapacity" min="64" max="65536">
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>${args.labels['panel.set.journalInterval.name']}</span>
          <span class="help-icon">?<span class="tooltip">${args.labels['panel.set.journalInterval.tip']}</span></span>
        </div>
        <div class="desc">${args.labels['panel.set.journalInterval.desc']}</div>
      </div>
      <input class="number-input" type="number" id="numJournalInterval" data-key="journalFlushIntervalMs" min="1000" max="300000">
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>${args.labels['panel.set.fullSaveInterval.name']}</span>
          <span class="help-icon">?<span class="tooltip">${args.labels['panel.set.fullSaveInterval.tip']}</span></span>
        </div>
        <div class="desc">${args.labels['panel.set.fullSaveInterval.desc']}</div>
      </div>
      <input class="number-input" type="number" id="numFullSaveInterval" data-key="fullSaveIntervalMs" min="5000" max="600000">
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-header-row">
          <span>${args.labels['panel.set.maxSessions.name']}</span>
          <span class="help-icon">?<span class="tooltip">${args.labels['panel.set.maxSessions.tip']}</span></span>
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
      <button class="btn btn-secondary" id="btnExportAggregated">${args.labels['panel.actions.exportAggregated']}</button>
      <button class="btn btn-danger" id="btnClearHistory">${args.labels['panel.actions.clearHistory']}</button>
      <button class="btn btn-danger" id="btnReset">${args.labels['panel.actions.reset']}</button>
    </div>
    <div style="margin-top:8px;font-size:11px;color:var(--description)">
      <strong>${args.labels['panel.actions.newPeriod']}</strong>${args.labels['panel.actions.hintPeriodDesc']}<br>
      <strong>${args.labels['panel.actions.clearHistory']}</strong>${args.labels['confirm.clearHistory']}<br>
      <strong>${args.labels['panel.actions.reset']}</strong>${args.labels['panel.actions.hintResetDesc']}
    </div>
  </div>

  <div id="statusToast"></div>

  <script nonce="${args.nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      // 词条表（渲染时由扩展宿主按当前语言序列化注入）
      const L = ${JSON.stringify(args.labels)};
      // {0}/{1} 占位符格式化（与宿主 i18n format 语义一致；curveSegTip 等词条含双占位符）
      function fmt(tpl) {
        const args = Array.prototype.slice.call(arguments, 1);
        return String(tpl).replace(/{([0-9]+)}/g, (_, idx) => {
          const i = parseInt(idx, 10);
          return args[i] !== undefined ? String(args[i]) : '{' + idx + '}';
        });
      }
      let pendingData = null;
      // 图表区域显示模式：'bars' 周柱状图 / 'curve' 实时活跃曲线
      let chartMode = 'bars';

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
        setValue('selLocale', data.locale || 'auto');
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

        // 活动时间线热力图
        renderHeatmap(data.heatmap);

        // 周报曲线（与柱状图同源：dailyStats 含今日实时增量，尾端随刷新移动）
        renderActiveCurve(data.dailyStats);

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

        // 大数组防护：workspaces 数量无上限，用循环求最大而非 Math.max(...spread)（防栈溢出）
        let maxVal = 1;
        for (const ws of workspaces) {
          if (ws.totalMs > maxVal) maxVal = ws.totalMs;
        }
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

        // ★ 兜底：count 必须为有限数字，否则 fmt 会输出字面量占位符（如 "（{0} 个工作区）"）。
        //   宿主数据异常（旧版 globalState 缺 workspaces 字段）时以实际列表长度兜底。
        const wsCount = typeof count === 'number' && Number.isFinite(count)
            ? count
            : (Array.isArray(workspaces) ? workspaces.length : 0);

        html +=
          '<div class="ws-compare-total">' + L['panel.js.grandTotalPrefix'] + '<strong>' + formatDuration(grandTotal) +
          '</strong><span class="ws-compare-count">' + fmt(L['panel.js.workspaceCountFmt'], wsCount) + '</span></div>';

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

        // 活跃曲线模式下隐藏柱状图区域（显示由 activeCurve 接管）
        if (chartMode === 'curve') {
          container.style.display = 'none';
          weekTotalEl.style.display = 'none';
          emptyEl.style.display = 'none';
          return;
        }

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

      // ---- 周报曲线渲染（与柱状图同源）----
      // 数据：与柱状图完全同源（data.dailyStats = last7Days，含今日实时增量），
      //       曲线落差与柱状图一致；今日格随 updateData 周期增长 → 曲线尾端实时移动。
      function renderActiveCurve(dailyStats) {
        const el = document.getElementById('activeCurve');
        if (!el) return;
        const data = dailyStats || [];
        const hasData = data.length > 0 && data.some(d => d.totalMs > 0);
        if (!hasData) {
          el.innerHTML = '<div class="chart-empty">' + L['panel.js.curveEmpty'] + '</div>';
          return;
        }

        // 归一化点集：x 从左到右（7 天）、y 值越大越高（留 4px 上下内边距）
        const W = 600, H = 60, PAD = 4;
        const maxVal = Math.max(...data.map(d => d.totalMs), 1);
        const pts = data.map((d, i) => {
          const x = (i / (data.length - 1)) * W;
          const y = H - PAD - (d.totalMs / maxVal) * (H - 2 * PAD);
          return [x, y];
        });

        // Catmull-Rom → 三次贝塞尔：过全部采样点的光滑曲线
        function smoothPath(p) {
          if (p.length < 2) return '';
          let d = 'M' + p[0][0].toFixed(1) + ',' + p[0][1].toFixed(1);
          for (let i = 0; i < p.length - 1; i++) {
            const p0 = p[i - 1] || p[i];
            const p1 = p[i];
            const p2 = p[i + 1];
            const p3 = p[i + 2] || p2;
            const c1x = p1[0] + (p2[0] - p0[0]) / 6;
            const c1y = p1[1] + (p2[1] - p0[1]) / 6;
            const c2x = p2[0] - (p3[0] - p1[0]) / 6;
            const c2y = p2[1] - (p3[1] - p1[1]) / 6;
            d += 'C' + c1x.toFixed(1) + ',' + c1y.toFixed(1)
              + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1)
              + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
          }
          return d;
        }
        const line = smoothPath(pts);
        const base = H - PAD;
        const area = line + 'L' + W.toFixed(1) + ',' + base.toFixed(1) + 'L0,' + base.toFixed(1) + 'Z';

        // 悬停总览：最近 7 天总时长（与柱状图周合计同口径）
        const totalMs = data.reduce((s, d) => s + d.totalMs, 0);
        const tip = L['panel.js.weekTotalPrefix'] + formatDuration(totalMs);

        // 数据点悬停提示（每格日期 + 时长）
        const dots = data.map((d, i) => {
          const cx = (i / (data.length - 1)) * W;
          const cy = H - PAD - (d.totalMs / maxVal) * (H - 2 * PAD);
          const t = d.label + ' ' + formatDuration(d.totalMs);
          return '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="2.5">' +
            '<title>' + t + '</title></circle>';
        }).join('');

        el.innerHTML =
          '<svg class="ac-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
            '<title>' + tip + '</title>' +
            '<path class="ac-area" d="' + area + '"></path>' +
            '<path class="ac-line" d="' + line + '"></path>' +
            dots +
          '</svg>';
      }

      // ---- 活动时间线热力图渲染 ----
      // 数据：近 12 周按日格子（周一为首行，current 周未到的天标 future）
      function renderHeatmap(days) {
        const el = document.getElementById('heatmap');
        const rangeEl = document.getElementById('heatmapRange');
        if (!el) return;
        const data = days || [];
        if (data.length === 0) {
          el.innerHTML = '';
          if (rangeEl) rangeEl.textContent = '';
          return;
        }

        // 按 7 天一组切成「周」列（数据已按周一为首行排布）
        const weeks = [];
        for (let i = 0; i < data.length; i += 7) {
          weeks.push(data.slice(i, i + 7));
        }
        el.innerHTML = weeks.map(week =>
          '<div class="heatmap-week">' + week.map(d => {
            const cls = 'hm-cell l' + d.level + (d.future ? ' future' : '');
            const tip = d.future ? d.dateStr : (d.dateStr + ' · ' + formatDuration(d.totalMs));
            return '<div class="' + cls + '" title="' + tip + '"></div>';
          }).join('') + '</div>'
        ).join('');

        // 日期范围（首日 ~ 末日）
        if (rangeEl) {
          rangeEl.textContent = data[0].dateStr + ' ~ ' + data[data.length - 1].dateStr;
        }
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
        const hourlyEl = document.getElementById('hourlyChart');
        const hourlyTitle = document.getElementById('hourlyTitle');
        const hourlyAxis = document.getElementById('hourlyAxis');

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

        // 按小时分布（24 根柱，峰值小时高亮）
        renderHourly(detail.hourly, detail.peakHour, hourlyEl, hourlyTitle, hourlyAxis);
      }

      // ---- 按小时分布柱状图 ----
      function renderHourly(hourly, peakHour, el, titleEl, axisEl) {
        if (!el || !titleEl) return;
        const buckets = hourly || [];
        if (buckets.length === 0) {
          el.style.display = 'none';
          titleEl.style.display = 'none';
          if (axisEl) axisEl.style.display = 'none';
          return;
        }
        titleEl.style.display = 'block';
        el.style.display = 'flex';

        // 展开为 0..23 的数组（缺省小时为 0）
        const hours = new Array(24).fill(0);
        for (const b of buckets) {
          if (b.hour >= 0 && b.hour <= 23) hours[b.hour] = b.totalMs;
        }
        const maxVal = Math.max(...hours, 1);

        el.innerHTML = hours.map((ms, h) => {
          const pct = ms > 0 ? Math.max((ms / maxVal) * 100, 4) : 0;
          const isPeak = ms > 0 && h === peakHour ? ' is-peak' : '';
          const tip = String(h).padStart(2, '0') + ':00 ' + formatDuration(ms);
          return '<div class="hourly-bar' + isPeak + '" style="height:' + pct + '%" title="' + tip + '"></div>';
        }).join('');

        // X 轴刻度：与柱状图同 24 格对齐，每 4 小时标注一次（0/4/8/12/16/20）
        if (axisEl) {
          axisEl.style.display = 'flex';
          axisEl.innerHTML = hours.map((_, h) => {
            const label = h % 4 === 0 ? String(h).padStart(2, '0') + ':00' : '';
            return '<div class="tick">' + label + '</div>';
          }).join('');
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

      // 语言选择变更（显式 i18n 切换；宿主收到后热生效并重建面板）
      document.getElementById('selLocale').addEventListener('change', (e) => {
        sendUpdate('locale', e.target.value);
      });

      // 数字输入变更（按输入框 min/max 钳制；空/非法输入不发送，宿主端亦有下限兜底）
      document.querySelectorAll('.number-input').forEach(el => {
        let timeout = null;
        el.addEventListener('input', () => {
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            const raw = parseInt(el.value, 10);
            if (Number.isNaN(raw)) return;
            const min = el.min ? parseInt(el.min, 10) : 0;
            const max = el.max ? parseInt(el.max, 10) : Number.MAX_SAFE_INTEGER;
            sendUpdate(el.dataset.key, Math.min(Math.max(raw, min), max));
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

      // 清除历史（保留累计数字）
      document.getElementById('btnClearHistory').addEventListener('click', () => {
        if (confirm(L['confirm.clearHistory'])) {
          vscode.postMessage({ type: 'clearHistory' });
          showToast(L['panel.toast.clearHistoryRequested']);
        }
      });

      // 导出聚合数据（全历史日报 CSV）
      document.getElementById('btnExportAggregated').addEventListener('click', () => {
        vscode.postMessage({ type: 'exportAggregated' });
        showToast(L['panel.toast.exportAggregatedRequested']);
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

      // ---- 图表模式切换（周柱状图 ↔ 活跃曲线）----
      function setChartMode(mode) {
        chartMode = mode;
        const btn = document.getElementById('btnToggleChartMode');
        const label = document.getElementById('chartModeLabel');
        const curveEl = document.getElementById('activeCurve');
        if (!btn || !label || !curveEl) return;

        if (mode === 'curve') {
          btn.textContent = L['panel.js.chartModeBars'];
          label.textContent = L['panel.js.chartModeCurve'];
          curveEl.style.display = 'flex';
          // ★ 立即隐藏柱状图区域，避免切换瞬间旧柱状图残留几帧
          //   （此前依赖下一轮 updateData 的 renderChart 守卫才隐藏，产生闪烁）
          const barsEl = document.getElementById('chartBars');
          const emptyEl = document.getElementById('chartEmpty');
          const weekEl = document.getElementById('weekTotal');
          if (barsEl) barsEl.style.display = 'none';
          if (emptyEl) emptyEl.style.display = 'none';
          if (weekEl) weekEl.style.display = 'none';
          // 用已有数据立即渲染（曲线与柱状图同源，后续随 updateData 周期刷新）
          if (pendingData) renderActiveCurve(pendingData.dailyStats);
        } else {
          btn.textContent = L['panel.js.chartModeCurve'];
          label.textContent = L['panel.js.chartModeBars'];
          curveEl.style.display = 'none';
          // 恢复柱状图（renderChart 的 curve 守卫不再生效，用已有数据重渲染）
          if (pendingData) renderChart(pendingData.dailyStats, pendingData.weekTotalMs);
        }
      }

      document.getElementById('btnToggleChartMode').addEventListener('click', () => {
        setChartMode(chartMode === 'bars' ? 'curve' : 'bars');
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
