/**
 * Module: DashboardBaseStyles — 仪表盘基础视觉样式与主题变量规范
 * File Path: src/presentation/dashboard-base-styles.ts
 * Architecture Role: Presentation layer CSS design token specifications and base styles
 * Dependencies & Triggers: Consumed by src/presentation/dashboardTemplate.ts during Webview HTML synthesis
 * Responsibilities: Declare CSS custom properties (:root variables), layout grids, glassmorphism cards, form controls, and responsive breakpoints
 * Exit Semantics & Design Rationale: Immutable CSS string literal matching VS Code theme variables (--vscode-*); operates with zero runtime dependencies and zero DOM execution overhead
 */

export const DASHBOARD_BASE_STYLES = /* css */ `
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #cccccc);
      --border: var(--vscode-panel-border, #333333);
      --card-bg: color-mix(in srgb, var(--vscode-editorWidget-background, #252526) 75%, var(--bg));
      --card-bg-hover: color-mix(in srgb, var(--vscode-editorWidget-background, #2d2d2d) 90%, var(--bg));
      --card-border: color-mix(in srgb, var(--border) 60%, transparent);
      --card-border-hover: color-mix(in srgb, var(--vscode-focusBorder, #007fd4) 50%, var(--border));
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --input-border: var(--vscode-input-border, #555555);
      --btn-bg: var(--vscode-button-background, #0078d4);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-hover: var(--vscode-button-hoverBackground, #026ec1);
      --btn-secondary: var(--vscode-button-secondaryBackground, #3a3d41);
      --btn-secondary-hover: var(--vscode-button-secondaryHoverBackground, #45494e);
      --danger: var(--vscode-errorForeground, #f14c4c);
      --success: var(--vscode-charts-green, #4ec9b0);
      --success-glow: color-mix(in srgb, var(--success) 40%, transparent);
      --section-header: var(--vscode-settings-headerForeground, #e0e0e0);
      --label: var(--vscode-settings-labelForeground, #cccccc);
      --description: var(--vscode-descriptionForeground, #9d9d9d);
      --focus: var(--vscode-focusBorder, #007fd4);
      --cyan: var(--vscode-charts-blue, #38bdf8);
      --radius-sm: 4px;
      --radius: 8px;
      --radius-md: 10px;
      --radius-lg: 12px;
      --gap: 16px;
      --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.12);
      --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.18);
      --glass-bg: color-mix(in srgb, var(--vscode-editorWidget-background, #1e2430) 82%, var(--bg));
      --glass-border: rgba(255, 255, 255, 0.08);
      --glass-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
      --bar-scale: 0;
      --fill-scale: 0;
      --manual-scale: 0;
      --ai-scale: 0;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      min-height: 100%;
      overflow-x: hidden;
      overflow-y: auto;
    }

    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--fg);
      background: var(--bg);
      padding: var(--gap);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    /* VS Code 浅色主题无障碍对比度增强 (WCAG AA >= 4.5:1) */
    body.vscode-light {
      --description: var(--vscode-descriptionForeground, #555555);
      --section-header: var(--vscode-settings-headerForeground, #1e1e1e);
      --label: var(--vscode-settings-labelForeground, #242424);
      --success: var(--vscode-charts-green, #107c41);
      --cyan: var(--vscode-charts-blue, #005fb8);
      --card-bg: color-mix(in srgb, var(--vscode-editorWidget-background, #f3f3f3) 85%, var(--bg));
      --card-bg-hover: color-mix(in srgb, var(--vscode-editorWidget-background, #eaeaea) 95%, var(--bg));
      --card-border: color-mix(in srgb, var(--border) 80%, transparent);
      --card-border-hover: var(--vscode-focusBorder, #007fd4);
      --glass-bg: color-mix(in srgb, var(--vscode-editorWidget-background, #f9f9f9) 90%, var(--bg));
      --glass-border: rgba(0, 0, 0, 0.12);
      --glass-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
      --shadow-sm: 0 1px 4px rgba(0, 0, 0, 0.08);
      --shadow-md: 0 3px 12px rgba(0, 0, 0, 0.12);
    }

    /* VS Code 高对比度主题实线边框适配 */
    body.vscode-high-contrast,
    body.vscode-high-contrast-light {
      --card-border: var(--vscode-contrastBorder, #6fc1ff);
      --card-border-hover: var(--vscode-focusBorder, #f38518);
      --glass-border: var(--vscode-contrastBorder, #6fc1ff);
      --glass-bg: var(--bg);
      --card-bg: var(--bg);
      --card-bg-hover: var(--bg);
    }

    body.vscode-high-contrast .stat-card,
    body.vscode-high-contrast .card-panel,
    body.vscode-high-contrast .chart-container,
    body.vscode-high-contrast-light .stat-card,
    body.vscode-high-contrast-light .card-panel,
    body.vscode-high-contrast-light .chart-container {
      border: 1px solid var(--vscode-contrastBorder, currentColor);
    }

    body.vscode-high-contrast .setting-row,
    body.vscode-high-contrast-light .setting-row {
      border-bottom: 1px solid var(--vscode-contrastBorder, currentColor);
    }
    body.vscode-high-contrast .setting-row:last-child,
    body.vscode-high-contrast-light .setting-row:last-child {
      border-bottom: none;
    }

    body.vscode-high-contrast .btn,
    body.vscode-high-contrast-light .btn {
      border: 1px solid var(--vscode-contrastBorder, currentColor);
    }

    body.vscode-high-contrast .toggle .slider,
    body.vscode-high-contrast-light .toggle .slider {
      border: 1px solid var(--vscode-contrastBorder, currentColor);
    }

    body.vscode-high-contrast .help-icon .tooltip,
    body.vscode-high-contrast-light .help-icon .tooltip {
      border: 1px solid var(--vscode-contrastBorder, currentColor);
    }

    /* 视觉契约：页面入场交错动画，增强 Webview 初次呈现的层次感 */
    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes tooltipFadeIn {
      from {
        opacity: 0;
        transform: translate(-50%, 4px);
      }
      to {
        opacity: 1;
        transform: translate(-50%, 0);
      }
    }

    .main-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--card-border);
      animation: fadeInUp 0.3s ease both;
    }

    .main-header h1 {
      font-size: 18px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
      letter-spacing: -0.2px;
    }

    .main-header .header-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: var(--radius-sm);
      background: linear-gradient(135deg, var(--btn-bg), var(--focus));
      color: #fff;
      font-size: 14px;
      box-shadow: 0 2px 10px rgba(0, 120, 212, 0.35);
    }

    .section {
      margin-bottom: var(--gap);
      animation: fadeInUp 0.35s ease both;
    }

    h2 {
      font-size: 12px;
      font-weight: 700;
      color: var(--section-header);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    h2::before {
      content: '';
      display: inline-block;
      width: 3px;
      height: 12px;
      background: var(--focus);
      border-radius: 2px;
    }

    .section-header-flex {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }

    .section-header-flex h2 {
      margin-bottom: 0;
    }

    .global-header-total {
      font-size: 11.5px;
      color: var(--description);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .global-header-total strong {
      color: var(--success);
      font-family: var(--vscode-editor-font-family, monospace);
      font-weight: 700;
    }

    .global-header-total .ws-compare-count {
      color: var(--description);
      opacity: 0.85;
    }

    h3 {
      font-size: 12px;
      font-weight: 600;
      color: var(--fg);
      margin-bottom: 8px;
    }

    /* 布局契约：统计卡片响应式网格 (CSS Grid)，自适应面板宽度变化 */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 10px;
      margin-bottom: var(--gap);
      animation: fadeInUp 0.3s ease both;
      transform: none;
    }

    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      padding: 14px 12px;
      text-align: center;
      box-shadow: var(--shadow-sm);
      transition: background 0.15s ease, border-color 0.15s ease;
      position: relative;
      overflow: hidden;
    }

    .stat-card:hover {
      background: var(--card-bg-hover);
      border-color: var(--card-border-hover);
    }

    .stat-card .value {
      font-size: 20px;
      font-weight: 700;
      color: var(--success);
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.5px;
      line-height: 1.2;
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 2px;
    }

    .stat-card .label {
      font-size: 11px;
      font-weight: 500;
      color: var(--description);
      margin-top: 6px;
      letter-spacing: 0.2px;
    }

    /* 状态契约：运行状态 Badge，提供高可见度活跃感知 */
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.3px;
    }

    .status-running {
      background: color-mix(in srgb, var(--success) 15%, transparent);
      color: var(--success);
      border: 1px solid color-mix(in srgb, var(--success) 35%, transparent);
    }

    .status-running::before {
      content: '';
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--success);
    }

    .status-disabled {
      background: color-mix(in srgb, var(--danger) 15%, transparent);
      color: var(--danger);
      border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
    }

    .status-disabled::before {
      content: '';
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--danger);
    }

    /* 容器契约：卡片容器规范 (Card panel layout specifications) */
    .card-panel {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      padding: 14px;
      box-shadow: var(--shadow-sm);
    }

    /* 交互契约：设置列表行与对齐规范 */
    .setting-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
      transition: background 0.15s;
    }
    .setting-row:first-child { padding-top: 4px; }
    .setting-row:last-child { border-bottom: none; padding-bottom: 4px; }
    .setting-label { flex: 1; padding-right: 16px; }
    .setting-header-row {
      display: flex;
      align-items: center;
      font-weight: 500;
      color: var(--fg);
    }
    .setting-label .desc {
      font-size: 11px;
      color: var(--description);
      margin-top: 3px;
      line-height: 1.4;
    }

    /* 提示契约：帮助提示图标与 Tooltip 微组件规范 */
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
      user-select: none;
      transition: all 0.15s ease;
    }
    .help-icon:hover,
    .help-icon:focus-visible {
      border-color: var(--focus);
      color: var(--fg);
      background: var(--input-bg);
      outline: none;
    }
    .help-icon:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }
    .help-icon .tooltip {
      display: none;
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      background: color-mix(in srgb, var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background, #252526)) 95%, var(--bg));
      border: 1px solid var(--card-border);
      border-radius: var(--radius-sm);
      padding: 8px 12px;
      font-size: 11px;
      font-weight: 400;
      color: var(--fg);
      white-space: nowrap;
      z-index: 100;
      box-shadow: var(--shadow-md);
      pointer-events: none;
    }
    .help-icon:hover .tooltip,
    .help-icon:focus-visible .tooltip {
      display: block;
      animation: tooltipFadeIn 0.15s ease both;
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

    /* 表单契约：现代开关 Toggle switch 状态过渡与无障碍焦点 */
    .toggle {
      position: relative;
      width: 38px;
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
      background: color-mix(in srgb, var(--fg) 18%, transparent);
      border: 1px solid var(--input-border);
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
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
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }
    .toggle input:checked + .slider {
      background: var(--btn-bg);
      border-color: var(--btn-bg);
      box-shadow: 0 0 10px color-mix(in srgb, var(--btn-bg) 40%, transparent);
    }
    .toggle input:checked + .slider::before {
      left: 20px;
      background: #ffffff;
    }
    .toggle input:focus-visible + .slider {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }

    /* 控件契约：输入框与下拉选择器原生风格适配与状态聚焦 */
    .number-input, .select-input {
      padding: 5px 10px;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: var(--radius-sm);
      font-size: 12px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .number-input {
      width: 90px;
      text-align: right;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .select-input {
      font-family: inherit;
      cursor: pointer;
    }
    .number-input:focus, .select-input:focus {
      outline: none;
      border-color: var(--focus);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--focus) 30%, transparent);
    }
    .number-input:focus-visible, .select-input:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 1px;
      border-color: var(--focus);
    }

    /* 交互契约：按钮系统分级规范 (主要/次要/危险操作语义) */
    .btn-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 10px;
    }
    .btn {
      padding: 6px 14px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      font-family: inherit;
      transition: all 0.18s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn:active { transform: scale(0.97); }
    .btn:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }
    .btn-sm {
      padding: 2px 8px;
      font-size: 11px;
      line-height: 1.5;
      border-radius: var(--radius-sm);
    }
    .btn-primary {
      background: var(--btn-bg);
      color: var(--btn-fg);
      box-shadow: 0 2px 6px color-mix(in srgb, var(--btn-bg) 35%, transparent);
    }
    .btn-primary:hover {
      background: var(--btn-hover);
      box-shadow: 0 4px 12px color-mix(in srgb, var(--btn-bg) 50%, transparent);
    }
    .btn-secondary {
      background: var(--btn-secondary);
      color: var(--fg);
      border-color: color-mix(in srgb, var(--border) 60%, transparent);
    }
    .btn-secondary:hover {
      background: var(--btn-secondary-hover);
      border-color: var(--card-border-hover);
    }
    .btn-danger {
      background: transparent;
      color: var(--danger);
      border: 1px solid color-mix(in srgb, var(--danger) 50%, transparent);
    }
    .btn-danger:hover {
      background: color-mix(in srgb, var(--danger) 15%, transparent);
      border-color: var(--danger);
    }

    /* 工具栏契约：图表控制区自适应布局容器规范 */
    .chart-container {
      margin: 10px 0 8px 0;
      padding: 14px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-sm);
    }
    /* 聚合契约：周报卡片头部工具栏与集成指标（日均/活跃天数/最活跃日 + 导出操作） */
    .weekly-curve-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
      flex-wrap: wrap;
      gap: 10px;
    }
    .weekly-curve-metrics {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .wc-metric-item {
      display: inline-flex;
      align-items: baseline;
      gap: 5px;
      font-size: 11.5px;
    }
    .wc-metric-item .wc-label {
      color: var(--description);
      font-weight: 500;
    }
    .wc-metric-item .wc-val {
      color: var(--success);
      font-weight: 700;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .wc-divider {
      color: var(--description);
      opacity: 0.4;
    }
    .weekly-curve-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .chart-empty {
      color: var(--description);
      text-align: center;
      padding: 28px 0;
      font-size: 12px;
    }
    .week-total {
      text-align: center;
      font-size: 12px;
      color: var(--description);
      margin-top: 10px;
    }
    .week-total strong {
      color: var(--success);
      font-weight: 700;
    }

`;
