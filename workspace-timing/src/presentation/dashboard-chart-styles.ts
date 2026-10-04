/**
 * 模块归属: presentation (仪表盘图表与可视化样式)
 * 文件路径: workspace-timing/src/presentation/dashboard-chart-styles.ts
 * 架构定位: 面板 Webview 高级可视化图表专用样式
 * 职责说明: 提供活跃曲线 SVG、24周热力图、小时时间线标尺及气泡提示动画样式。
 */

export const DASHBOARD_CHART_STYLES = /* css */ `
    /* 实时活跃曲线（对标参考图二高级可视化） */
    .active-curve {
      display: block;
      width: 100%;
      height: 256px;
      margin: 10px 0 8px 0;
      padding: 12px 16px;
      background: var(--glass-bg);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-md);
      box-shadow: var(--glass-shadow), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      position: relative;
      overflow: hidden;
    }
    .ac-svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .ac-grid-line {
      stroke: rgba(255, 255, 255, 0.08);
      stroke-dasharray: 4 4;
      stroke-width: 1;
    }
    .ac-grid-base {
      stroke: rgba(255, 255, 255, 0.18);
      stroke-width: 1;
    }
    .ac-grid-label {
      font-size: 10.5px;
      font-weight: 500;
      font-family: var(--vscode-editor-font-family, monospace);
      fill: #ffffff;
      opacity: 0.85;
    }
    .ac-line {
      fill: none;
      stroke: url(#acLineGradient);
      stroke-width: 2.4;
      stroke-linejoin: round;
      stroke-linecap: round;
      filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.45));
    }
    .ac-area {
      fill: url(#acGradient);
    }
    /* 微型精致同心发光数据节点（仅活跃日展示，零值平原无节点） */
    .ac-dot-halo {
      fill: rgba(56, 189, 248, 0.22);
      stroke: rgba(56, 189, 248, 0.75);
      stroke-width: 1.5;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      cursor: pointer;
    }
    .ac-dot-core {
      fill: #ffffff;
      pointer-events: none;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .ac-dot-group:hover .ac-dot-halo {
      r: 7;
      fill: rgba(56, 189, 248, 0.38);
      stroke: #38bdf8;
      filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.85));
    }
    .ac-dot-group:hover .ac-dot-core {
      r: 3.2;
    }
    .ac-dot-group.is-peak .ac-dot-halo {
      stroke: #34d399;
      fill: rgba(16, 185, 129, 0.28);
      filter: drop-shadow(0 0 8px rgba(16, 185, 129, 0.65));
    }
    /* 悬浮胶囊药丸气泡标签 */
    .ac-pill-bg {
      fill: rgba(15, 23, 42, 0.92);
      stroke: rgba(255, 255, 255, 0.22);
      stroke-width: 1.2;
      filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.5));
      transition: all 0.2s ease;
    }
    .ac-pill-bg.is-peak {
      fill: rgba(15, 23, 42, 0.95);
      stroke: #38bdf8;
      stroke-width: 1.4;
      filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.45));
    }
    .ac-pill-text {
      font-size: 11px;
      font-weight: 700;
      font-family: var(--vscode-editor-font-family, monospace);
      fill: #ffffff;
      text-anchor: middle;
      pointer-events: none;
      user-select: none;
    }
    .ac-pill-text.is-peak {
      fill: #ffffff;
    }
    .ac-pill-text.is-zero {
      fill: rgba(255, 255, 255, 0.55);
    }
    .ac-pill-group:hover .ac-pill-bg {
      stroke: #38bdf8;
      fill: rgba(15, 23, 42, 0.98);
    }
    /* 底部双层 X 轴对齐标尺 */
    .ac-axis-date {
      font-size: 12px;
      font-weight: 600;
      font-family: var(--vscode-editor-font-family, monospace);
      fill: #ffffff;
      text-anchor: middle;
      user-select: none;
    }
    .ac-axis-val {
      font-size: 11.5px;
      font-weight: 700;
      font-family: var(--vscode-editor-font-family, monospace);
      fill: #ffffff;
      text-anchor: middle;
      user-select: none;
    }
    .ac-axis-val.is-peak {
      fill: #ffffff;
    }
    .ac-axis-val.is-zero {
      font-size: 10.5px;
      font-weight: 500;
      fill: rgba(255, 255, 255, 0.55);
    }

    /* 活动热力图（GitHub 风格现代化） */
    .heatmap-range {
      font-size: 11px;
      color: var(--description);
      margin-bottom: 8px;
    }
    .heatmap-wrap {
      display: flex;
      gap: 8px;
      align-items: stretch;
      padding: 12px 14px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-sm);
      width: 100%;
      box-sizing: border-box;
    }
    .heatmap-weekdays {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      font-size: 9px;
      color: var(--description);
      padding: 2px 0;
      flex-shrink: 0;
    }
    .heatmap-weekdays span {
      height: 12px;
      line-height: 12px;
      display: block;
    }
    .heatmap {
      display: flex;
      justify-content: space-between;
      gap: 3px;
      flex: 1;
      width: 100%;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .heatmap-week {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 3px;
      flex: 1;
      min-width: 10px;
      align-items: center;
    }
    .hm-cell {
      width: 100%;
      max-width: 14px;
      aspect-ratio: 1;
      height: auto;
      min-height: 10px;
      border-radius: 2.5px;
      background: color-mix(in srgb, var(--fg) 10%, transparent);
      transition: transform 0.15s ease, filter 0.15s ease;
      cursor: pointer;
    }
    .hm-cell.l1 { background: #0e4429; border: 1px solid rgba(57, 211, 83, 0.2); }
    .hm-cell.l2 { background: #006d32; border: 1px solid rgba(57, 211, 83, 0.4); }
    .hm-cell.l3 { background: #26a641; }
    .hm-cell.l4 { background: #39d353; box-shadow: 0 0 4px rgba(57, 211, 83, 0.5); }
    .hm-cell.future { opacity: 0.25; cursor: default; }
    .hm-cell:not(.future):hover {
      transform: scale(1.25);
      z-index: 2;
      outline: 1px solid #fff;
    }
    .heatmap-legend {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 10px;
      font-size: 10px;
      color: var(--description);
    }
    .heatmap-legend .hm-cell {
      width: 11px;
      height: 11px;
    }

    /* 摘要小卡片与列表 */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }
    .summary-item {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius-sm);
      padding: 8px 10px;
      text-align: center;
    }
    .summary-item .value {
      font-size: 15px;
      font-weight: 700;
      color: var(--success);
      font-variant-numeric: tabular-nums;
    }
    .summary-item .label {
      font-size: 10px;
      color: var(--description);
      margin-top: 2px;
    }
    .report-block {
      margin-bottom: 14px;
    }
    .session-list {
      border: 1px solid var(--card-border);
      border-radius: var(--radius-sm);
      background: var(--card-bg);
      overflow: hidden;
      margin-bottom: 10px;
    }
    .session-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 7px 12px;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 35%, transparent);
      font-size: 12px;
    }
    .session-row:last-child { border-bottom: none; }
    .session-time { color: var(--description); font-family: var(--vscode-editor-font-family, monospace); }
    .session-dur { font-family: var(--vscode-editor-font-family, monospace); font-weight: 600; color: var(--fg); }

    /* 按小时分布容器与骨架槽位 */
    .hourly-wrapper {
      position: relative;
      margin: 10px 0 6px 0;
      background: var(--glass-bg);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-md);
      box-shadow: var(--glass-shadow), inset 0 1px 0 rgba(255, 255, 255, 0.06);
      padding: 12px 14px 8px 14px;
      overflow: hidden;
    }
    .hourly-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .hourly-title-text {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--description);
    }
    .hourly-badge {
      font-size: 11px;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--cyan);
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 999px;
      padding: 1px 8px;
      transition: all 0.2s ease;
    }
    .hourly-chart {
      display: flex;
      align-items: stretch;
      gap: 2px;
      height: 72px;
      position: relative;
      box-sizing: border-box;
    }
    .hourly-slot {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      align-items: center;
      position: relative;
      cursor: pointer;
      border-radius: 3px;
      transition: background 0.15s ease;
    }
    .hourly-slot:hover {
      background: rgba(255, 255, 255, 0.06);
    }
    .hourly-slot.has-period-divider {
      border-right: 1px solid rgba(255, 255, 255, 0.12);
      padding-right: 2px;
      margin-right: 1px;
    }
    .hourly-slot-track {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      position: relative;
      border-radius: 2px 2px 0 0;
      background: rgba(255, 255, 255, 0.025);
    }
    .hourly-slot:hover .hourly-slot-track {
      background: rgba(255, 255, 255, 0.05);
    }
    .hourly-bar {
      width: 100%;
      min-width: 2px;
      border-radius: 2px 2px 0 0;
      background: linear-gradient(180deg, rgba(56, 189, 248, 0.75), rgba(59, 130, 246, 0.5));
      box-shadow: 0 0 6px rgba(56, 189, 248, 0.25);
      transition: height 0.35s cubic-bezier(0.16, 1, 0.3, 1), filter 0.2s ease;
    }
    .hourly-slot:hover .hourly-bar {
      filter: brightness(1.25);
    }
    .hourly-bar.is-peak {
      background: linear-gradient(180deg, #10b981, #06b6d4);
      box-shadow: 0 0 10px rgba(16, 185, 129, 0.45);
    }
    .hourly-slot-base {
      width: 100%;
      height: 2px;
      background: rgba(255, 255, 255, 0.1);
      margin-top: 2px;
      border-radius: 1px;
    }
    .hourly-slot.has-activity .hourly-slot-base {
      background: rgba(56, 189, 248, 0.5);
    }
    .hourly-slot.is-peak-slot .hourly-slot-base {
      background: #10b981;
      box-shadow: 0 0 4px #10b981;
    }

    /* 物理标尺刻度线与时间标签 */
    .hourly-axis {
      position: relative;
      height: 22px;
      margin-top: 4px;
      box-sizing: border-box;
    }
    .hourly-axis-line {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: rgba(255, 255, 255, 0.12);
    }
    .hourly-notch-group {
      position: absolute;
      top: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: none;
      user-select: none;
    }
    .hourly-notch-group.is-start {
      left: 0;
      align-items: flex-start;
    }
    .hourly-notch-group.is-end {
      right: 0;
      align-items: flex-end;
    }
    .hourly-notch-group.is-mid {
      transform: translateX(-50%);
    }
    .hourly-notch {
      width: 1px;
      height: 4px;
      background: rgba(255, 255, 255, 0.25);
    }
    .hourly-notch-group.is-noon .hourly-notch {
      height: 6px;
      background: var(--cyan);
      box-shadow: 0 0 4px rgba(56, 189, 248, 0.5);
    }
    .hourly-tick-label {
      font-size: 9.5px;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--description);
      margin-top: 3px;
      white-space: nowrap;
      letter-spacing: -0.02em;
    }
    .hourly-notch-group.is-noon .hourly-tick-label {
      color: var(--cyan);
      font-weight: 600;
    }

    /* 多周趋势条 */
    .trend-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 5px 0;
      font-size: 12px;
    }
    .trend-label {
      width: 96px;
      color: var(--description);
      flex-shrink: 0;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .trend-track {
      position: relative;
      flex: 1;
      height: 8px;
      border-radius: 4px;
      background: color-mix(in srgb, var(--input-bg) 80%, transparent);
      overflow: hidden;
    }
    .trend-divider-mark {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      background: #f43f5e;
      box-shadow: 0 0 5px rgba(244, 63, 94, 0.9);
      border-radius: 1px;
      z-index: 3;
      pointer-events: none;
      transform: translateX(-50%);
    }
    .trend-fill {
      height: 100%;
      border-radius: 4px;
      background: linear-gradient(90deg, var(--btn-bg), var(--focus));
      transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1), background 0.3s ease;
      min-width: 2px;
    }
    .trend-fill.is-over {
      box-shadow: 0 0 8px rgba(239, 68, 68, 0.55);
    }
    .trend-value {
      width: 72px;
      text-align: right;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--success);
      font-weight: 600;
      flex-shrink: 0;
      transition: color 0.3s ease, text-shadow 0.3s ease;
    }
    .trend-value.is-over {
      color: #ef4444;
      text-shadow: 0 0 6px rgba(239, 68, 68, 0.35);
    }

    /* 跨工作区对比视图 */
    .ws-compare-row {
      padding: 8px 0;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    }
    .ws-compare-row:last-of-type { border-bottom: none; }
    .ws-compare-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 5px;
      gap: 8px;
    }
    .ws-compare-name {
      font-size: 12px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }
    .ws-compare-value {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .ws-compare-share {
      font-size: 10px;
      font-weight: 400;
      color: var(--description);
      margin-left: 6px;
    }
    .ws-compare-track {
      height: 8px;
      border-radius: 4px;
      background: color-mix(in srgb, var(--input-bg) 80%, transparent);
      overflow: hidden;
    }
    .ws-compare-fill {
      height: 100%;
      border-radius: 4px;
      background: linear-gradient(90deg, var(--btn-bg), var(--success));
      transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      min-width: 2px;
    }
    .ws-compare-total {
      margin-top: 12px;
      padding-top: 10px;
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

    /* 帮助提示图标 Tooltip */
    .help-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 15px;
      height: 15px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--input-bg) 90%, transparent);
      border: 1px solid var(--input-border);
      color: var(--description);
      font-size: 9px;
      font-weight: 700;
      cursor: help;
      margin-left: 6px;
      flex-shrink: 0;
      position: relative;
      transition: all 0.15s;
    }
    .help-icon:hover {
      border-color: var(--focus);
      color: var(--fg);
      background: var(--input-bg);
    }
    .help-icon .tooltip {
      display: none;
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      background: color-mix(in srgb, var(--vscode-editorWidget-background, #252526) 95%, var(--bg));
      border: 1px solid var(--card-border);
      border-radius: var(--radius-sm);
      padding: 8px 12px;
      font-size: 11px;
      font-weight: 400;
      color: var(--fg);
      white-space: nowrap;
      z-index: 100;
      box-shadow: 0 4px 18px rgba(0,0,0,0.35);
      pointer-events: none;
      backdrop-filter: blur(10px);
    }
    .help-icon:hover .tooltip {
      display: block;
      animation: fadeInUp 0.15s ease both;
    }
    .help-icon .tooltip::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: var(--card-border);
    }

    /* Toast 浮动通知 */
    #statusToast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 10px 18px;
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--vscode-editorWidget-background, #252526) 90%, var(--bg));
      border: 1px solid var(--card-border-hover);
      color: var(--fg);
      font-size: 12px;
      font-weight: 500;
      box-shadow: 0 6px 20px rgba(0,0,0,0.3);
      backdrop-filter: blur(12px);
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
      z-index: 1000;
    }
    #statusToast.show {
      opacity: 1;
      transform: translateY(0);
    }
`;
