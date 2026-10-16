/**
 * Module: ContainerQueries — 4 阶容器查询样式字符串常量与视图门面
 * File Path: src/presentation/container-queries.ts
 * Architecture Role: Presentation layer CSS token and layout stylesheet exporter
 * Dependencies & Triggers: Consumed by Webview HTML template builders (dashboardTemplate.ts)
 * Responsibilities: Export encapsulated 4-stage container queries CSS and CJK typography guards
 * Exit Semantics & Design Rationale: Immutable string constants matching VS Code container query standards; zero DOM overhead
 */

export const TIMING_VIEWPORT_CONTAINER_CLASS = 'timing-viewport-container';

export const TIMING_VIEWPORT_STYLES = /* css */ `
  .timing-viewport-container {
    container-type: inline-size;
    container-name: timing-viewport;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .timing-cjk-guard,
  .timing-viewport-container h1,
  .timing-viewport-container h2,
  .timing-viewport-container h3,
  .timing-viewport-container .stat-card .label,
  .timing-viewport-container .stat-card .value,
  .timing-viewport-container .setting-label,
  .timing-viewport-container .setting-header-row,
  .timing-viewport-container .setting-label .desc,
  .timing-viewport-container .wc-metric-item,
  .timing-viewport-container .summary-item .label,
  .timing-viewport-container .summary-item .value,
  .timing-viewport-container .ws-compare-name {
    min-width: 0;
    overflow-wrap: break-word;
    word-break: normal;
    text-wrap: balance;
  }

  .card-panel .btn,
  .card-panel .number-input,
  .card-panel .select-input {
    border-left: none;
    border-right: none;
  }
  .stat-card,
  .card-panel,
  .chart-container,
  .summary-item {
    border: 1px solid var(--card-border, #333333);
  }

  @container timing-viewport (max-width: 240px) {
    .stats-grid { grid-template-columns: 1fr; gap: 6px; }
    .stat-card { padding: 8px 6px; }
    .stat-card .value { font-size: 16px; }
    .stat-card .label { font-size: 10px; }
    .weekly-curve-metrics { flex-direction: column; align-items: flex-start; gap: 4px; }
    .wc-divider { display: none; }
    .btn-row { flex-direction: column; width: 100%; }
    .btn { width: 100%; justify-content: center; }
    .setting-row { flex-direction: column; align-items: flex-start; gap: 8px; }
    .number-input, .select-input { width: 100%; }
  }

  @container timing-viewport (min-width: 241px) and (max-width: 320px) {
    .stats-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .stat-card { padding: 10px 8px; }
    .stat-card .value { font-size: 17px; }
    .weekly-curve-header { flex-direction: column; align-items: flex-start; }
    .summary-grid { grid-template-columns: repeat(2, 1fr); }
    .setting-label { padding-right: 8px; }
  }

  @container timing-viewport (min-width: 321px) and (max-width: 384px) {
    .stats-grid { grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .stat-card { padding: 12px 10px; }
    .stat-card .value { font-size: 18px; }
    .summary-grid { grid-template-columns: repeat(3, 1fr); }
  }

  @container timing-viewport (min-width: 385px) {
    .stats-grid { grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
    .stat-card { padding: 14px 12px; }
    .stat-card .value { font-size: 20px; }
    .summary-grid { grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
  }

  .timing-scroll-mask,
  .timing-fade-viewport {
    --fade-size: 28px;
    --fade-top: 0px;
    --fade-bottom: 28px;
    position: relative;
    -webkit-mask-image: linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0) 0px,
      rgba(0, 0, 0, 0.051) calc(var(--fade-top) * 0.15),
      rgba(0, 0, 0, 0.149) calc(var(--fade-top) * 0.30),
      rgba(0, 0, 0, 0.302) calc(var(--fade-top) * 0.45),
      rgba(0, 0, 0, 0.502) calc(var(--fade-top) * 0.60),
      rgba(0, 0, 0, 0.702) calc(var(--fade-top) * 0.75),
      rgba(0, 0, 0, 0.851) calc(var(--fade-top) * 0.87),
      rgba(0, 0, 0, 1) var(--fade-top),
      rgba(0, 0, 0, 1) calc(100% - var(--fade-bottom)),
      rgba(0, 0, 0, 0.851) calc(100% - var(--fade-bottom) * 0.87),
      rgba(0, 0, 0, 0.702) calc(100% - var(--fade-bottom) * 0.75),
      rgba(0, 0, 0, 0.502) calc(100% - var(--fade-bottom) * 0.60),
      rgba(0, 0, 0, 0.302) calc(100% - var(--fade-bottom) * 0.45),
      rgba(0, 0, 0, 0.149) calc(100% - var(--fade-bottom) * 0.30),
      rgba(0, 0, 0, 0.051) calc(100% - var(--fade-bottom) * 0.15),
      rgba(0, 0, 0, 0) 100%
    );
    mask-image: linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0) 0px,
      rgba(0, 0, 0, 0.051) calc(var(--fade-top) * 0.15),
      rgba(0, 0, 0, 0.149) calc(var(--fade-top) * 0.30),
      rgba(0, 0, 0, 0.302) calc(var(--fade-top) * 0.45),
      rgba(0, 0, 0, 0.502) calc(var(--fade-top) * 0.60),
      rgba(0, 0, 0, 0.702) calc(var(--fade-top) * 0.75),
      rgba(0, 0, 0, 0.851) calc(var(--fade-top) * 0.87),
      rgba(0, 0, 0, 1) var(--fade-top),
      rgba(0, 0, 0, 1) calc(100% - var(--fade-bottom)),
      rgba(0, 0, 0, 0.851) calc(100% - var(--fade-bottom) * 0.87),
      rgba(0, 0, 0, 0.702) calc(100% - var(--fade-bottom) * 0.75),
      rgba(0, 0, 0, 0.502) calc(100% - var(--fade-bottom) * 0.60),
      rgba(0, 0, 0, 0.302) calc(100% - var(--fade-bottom) * 0.45),
      rgba(0, 0, 0, 0.149) calc(100% - var(--fade-bottom) * 0.30),
      rgba(0, 0, 0, 0.051) calc(100% - var(--fade-bottom) * 0.15),
      rgba(0, 0, 0, 0) 100%
    );
  }

  .timing-scroll-mask.is-at-top { --fade-top: 0px; }
  .timing-scroll-mask.is-at-bottom { --fade-bottom: 0px; }

  .timing-scroll-capsule {
    position: absolute;
    bottom: 12px;
    right: 16px;
    z-index: 10;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 11px;
    background: color-mix(in srgb, var(--vscode-editorWidget-background, #252526) 92%, var(--bg));
    border: 1px solid var(--card-border-hover);
    color: var(--fg);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    cursor: pointer;
    opacity: 0;
    transform: translateY(6px);
    pointer-events: none;
    transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .timing-scroll-capsule.is-visible {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }

  .timing-scroll-capsule:hover {
    background: var(--btn-hover);
    color: #ffffff;
    border-color: var(--focus);
  }
`;

