/**
 * Module: DashboardTemplate — 仪表盘 Webview HTML 页面结构组装器
 * File Path: src/presentation/dashboardTemplate.ts
 * Architecture Role: Presentation layer HTML document builder and static template generator
 * Dependencies & Triggers: dashboard-base-styles.ts, dashboard-chart-styles.ts, dashboard-script.ts; invoked by DashboardPanel._getHtml()
 * Responsibilities: Assemble HTML shell with strict CSP meta headers; embed base CSS and chart styles; render static card layouts, setting rows, and metric widgets; inject client bootstrap script
 * Exit Semantics & Design Rationale: Pure functional template generator without runtime side effects; guarantees strict CSP nonce isolation preventing inline script injection attacks
 */

import { DASHBOARD_BASE_STYLES } from './dashboard-base-styles';
import { DASHBOARD_CHART_STYLES } from './dashboard-chart-styles';
import { buildDashboardScript } from './dashboard-script';

export interface DashboardTemplateArgs {
    /** CSP nonce（每次渲染唯一） */
    nonce: string;
    /** webview 资源源（panel.webview.cspSource） */
    cspSource: string;
    /** 文档语言（currentLocale()，如 'zh-CN' / 'en'） */
    lang: string;
    /**
     * 面板词条表（panel.* 与 confirm.* 子集，由 i18n/labelsWithPrefix 构建）。
     * 静态 HTML 用 ${args.labels['key']} 插值；webview 脚本经 JSON 注入为常量 L。
     */
    labels: Record<string, string>;
}

interface SettingRowSpec {
    id: string;
    dataKey: string;
    name: string;
    tip: string;
    desc: string;
    type: 'toggle' | 'number' | 'select';
    min?: number;
    max?: number;
    options?: Array<{ value: string; label: string }>;
}

function renderStatCard(id: string, label: string): string {
    return /* html */ `
    <div class="stat-card">
      <div class="value" id="${id}">--</div>
      <div class="label">${label}</div>
    </div>`;
}

function renderSettingRow(spec: SettingRowSpec): string {
    const labelId = `${spec.id}-label`;
    const descId = `${spec.id}-desc`;
    let controlHtml = '';

    if (spec.type === 'toggle') {
        controlHtml = `
        <label class="toggle">
          <input type="checkbox" id="${spec.id}" data-key="${spec.dataKey}" role="switch" aria-labelledby="${labelId}" aria-describedby="${descId}">
          <span class="slider"></span>
        </label>`;
    } else if (spec.type === 'number') {
        const maxAttr = spec.max !== undefined ? ` max="${spec.max}"` : '';
        controlHtml = `
        <input class="number-input" type="number" id="${spec.id}" data-key="${spec.dataKey}" min="${spec.min ?? 0}"${maxAttr} aria-labelledby="${labelId}" aria-describedby="${descId}">`;
    } else if (spec.type === 'select') {
        const optionsHtml = (spec.options ?? [])
            .map(opt => `<option value="${opt.value}">${opt.label}</option>`)
            .join('\n          ');
        controlHtml = `
        <select class="select-input" id="${spec.id}" data-key="${spec.dataKey}" aria-labelledby="${labelId}" aria-describedby="${descId}">
          ${optionsHtml}
        </select>`;
    }

    return /* html */ `
      <div class="setting-row">
        <div class="setting-label">
          <div class="setting-header-row">
            <span id="${labelId}">${spec.name}</span>
            <span class="help-icon" tabindex="0" role="button" aria-label="Help">?<span class="tooltip">${spec.tip}</span></span>
          </div>
          <div class="desc" id="${descId}">${spec.desc}</div>
        </div>${controlHtml}
      </div>`;
}

export function buildDashboardHtml(args: DashboardTemplateArgs): string {
    return /* html */ `
<!DOCTYPE html>
<html lang="${args.lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${args.cspSource} 'unsafe-inline'; script-src 'nonce-${args.nonce}'; img-src ${args.cspSource} data:; font-src ${args.cspSource};">
  <style>
${DASHBOARD_BASE_STYLES}
${DASHBOARD_CHART_STYLES}
  </style>
</head>
<body>

  <!-- 头部主标题栏 -->
  <div class="main-header">
    <h1>
      <span class="header-icon">⏱️</span>
      ${args.labels['panel.title']}
    </h1>
  </div>

  <!-- 统计卡片网格 -->
  <div class="stats-grid">
    ${renderStatCard('statToday', args.labels['panel.label.today'])}
    ${renderStatCard('statWeek', args.labels['panel.label.week'])}
    ${renderStatCard('statTotal', args.labels['panel.label.totalWs'])}
    ${renderStatCard('statGlobalTotal', args.labels['panel.label.global'])}
    ${renderStatCard('statSessions', args.labels['panel.label.sessions'])}
    ${renderStatCard('statStatus', args.labels['panel.label.status'])}
  </div>

  <!-- 周报 + 活跃曲线 -->
  <div class="section">
    <h2>${args.labels['panel.weekly.title']}</h2>
    <div class="chart-container">
      <div class="weekly-curve-header">
        <div class="weekly-curve-metrics" id="weeklyCurveMetrics">
          <div class="wc-metric-item">
            <span class="wc-label">${args.labels['panel.weekly.avgDaily']}:</span>
            <span class="wc-val" id="sumAvg">--</span>
          </div>
          <span class="wc-divider">·</span>
          <div class="wc-metric-item">
            <span class="wc-label">${args.labels['panel.weekly.activeDays']}:</span>
            <span class="wc-val" id="sumActiveDays">--</span>
          </div>
          <span class="wc-divider">·</span>
          <div class="wc-metric-item">
            <span class="wc-label">${args.labels['panel.weekly.peakDate']}:</span>
            <span class="wc-val" id="sumPeakDate">--</span>
          </div>
        </div>
        <div class="weekly-curve-actions">
          <div class="ac-legend" id="acLegend">
            <div class="ac-legend-item"><span class="ac-legend-dot manual"></span><span>${args.labels['panel.weekly.legendManual']}</span></div>
            <div class="ac-legend-item"><span class="ac-legend-dot ai"></span><span>${args.labels['panel.weekly.legendAi']}</span></div>
          </div>
          <button class="btn btn-secondary" id="btnExportWeekly">${args.labels['panel.weekly.exportBtn']}</button>
        </div>
      </div>
      <div id="chartEmpty" class="chart-empty" style="display:none">${args.labels['panel.weekly.emptyChart']}</div>
      <div id="activeCurve" class="active-curve"></div>
      <div id="weekTotal" class="week-total"></div>
    </div>
    <!-- 多周趋势 -->
    <div id="weeklyTrend" class="report-block" style="display:none">
      <h3>${args.labels['panel.weekly.trendTitle']}</h3>
      <div id="trendList" class="card-panel"></div>
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
    <div class="section-header-flex">
      <h2>${args.labels['panel.today.title']}</h2>
      <button class="btn btn-secondary btn-sm" id="btnExportDaily">${args.labels['panel.today.exportBtn']}</button>
    </div>
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
      <div class="hourly-wrapper" id="hourlyWrapper" style="display:none">
        <div class="hourly-header-row">
          <div class="hourly-title-text" id="hourlyTitle">${args.labels['panel.today.hourlyTitle']}</div>
          <div class="hourly-badge" id="hourlyBadge">--</div>
        </div>
        <div id="hourlyChart" class="hourly-chart"></div>
        <div id="hourlyAxis" class="hourly-axis"></div>
      </div>
    </div>
  </div>

  <!-- 跨工作区 -->
  <div class="section" id="globalSection">
    <div class="section-header-flex">
      <h2>${args.labels['panel.global.title']}</h2>
      <div class="global-header-total" id="globalTotalBadge"></div>
    </div>
    <div class="card-panel">
      <div id="workspaceList">
        <div class="chart-empty" id="globalEmpty">${args.labels['panel.global.empty']}</div>
      </div>
    </div>
  </div>

  <!-- 基本设置 -->
  <div class="section">
    <h2>${args.labels['panel.section.basic']}</h2>
    <div class="card-panel">
      ${renderSettingRow({
        id: 'chkEnabled',
        dataKey: 'isEnabled',
        type: 'toggle',
        name: args.labels['panel.set.enabled.name'],
        tip: args.labels['panel.set.enabled.tip'],
        desc: args.labels['panel.set.enabled.desc'],
      })}
      ${renderSettingRow({
        id: 'chkGlobalDisabled',
        dataKey: 'globalDisabled',
        type: 'toggle',
        name: args.labels['panel.set.globalDisabled.name'],
        tip: args.labels['panel.set.globalDisabled.tip'],
        desc: args.labels['panel.set.globalDisabled.desc'],
      })}
      ${renderSettingRow({
        id: 'chkChartDualTrack',
        dataKey: 'chartDualTrackDisplay',
        type: 'toggle',
        name: args.labels['panel.set.chartDualTrack.name'],
        tip: args.labels['panel.set.chartDualTrack.tip'],
        desc: args.labels['panel.set.chartDualTrack.desc'],
      })}
      ${renderSettingRow({
        id: 'chkStatusBar',
        dataKey: 'statusBarEnabled',
        type: 'toggle',
        name: args.labels['panel.set.statusBar.name'],
        tip: args.labels['panel.set.statusBar.tip'],
        desc: args.labels['panel.set.statusBar.desc'],
      })}
      ${renderSettingRow({
        id: 'selLocale',
        dataKey: 'locale',
        type: 'select',
        name: args.labels['panel.set.locale.name'],
        tip: args.labels['panel.set.locale.tip'],
        desc: args.labels['panel.set.locale.desc'],
        options: [
          { value: 'auto', label: args.labels['panel.set.locale.auto'] },
          { value: 'zh-CN', label: args.labels['panel.set.locale.zhCN'] },
          { value: 'en', label: args.labels['panel.set.locale.en'] },
        ],
      })}
      ${renderSettingRow({
        id: 'chkWeeklyLimit',
        dataKey: 'weeklyLimitEnabled',
        type: 'toggle',
        name: args.labels['panel.set.weeklyLimit.name'],
        tip: args.labels['panel.set.weeklyLimit.tip'],
        desc: args.labels['panel.set.weeklyLimit.desc'],
      })}
      ${renderSettingRow({
        id: 'numWeeklyLimitHours',
        dataKey: 'weeklyLimitHours',
        type: 'number',
        min: 1,
        max: 168,
        name: args.labels['panel.set.weeklyLimitHours.name'],
        tip: args.labels['panel.set.weeklyLimitHours.tip'],
        desc: args.labels['panel.set.weeklyLimitHours.desc'],
      })}
    </div>
  </div>

  <!-- 存储设置 -->
  <div class="section">
    <h2>${args.labels['panel.section.storage']}</h2>
    <div class="card-panel">
      ${renderSettingRow({
        id: 'chkJournal',
        dataKey: 'journalEnabled',
        type: 'toggle',
        name: args.labels['panel.set.journal.name'],
        tip: args.labels['panel.set.journal.tip'],
        desc: args.labels['panel.set.journal.desc'],
      })}
      ${renderSettingRow({
        id: 'chkBackup',
        dataKey: 'backupToFile',
        type: 'toggle',
        name: args.labels['panel.set.backup.name'],
        tip: args.labels['panel.set.backup.tip'],
        desc: args.labels['panel.set.backup.desc'],
      })}
      ${renderSettingRow({
        id: 'numRingBuffer',
        dataKey: 'ringBufferCapacity',
        type: 'number',
        min: 64,
        max: 65536,
        name: args.labels['panel.set.ringBuffer.name'],
        tip: args.labels['panel.set.ringBuffer.tip'],
        desc: args.labels['panel.set.ringBuffer.desc'],
      })}
      ${renderSettingRow({
        id: 'numJournalInterval',
        dataKey: 'journalFlushIntervalMs',
        type: 'number',
        min: 1000,
        max: 300000,
        name: args.labels['panel.set.journalInterval.name'],
        tip: args.labels['panel.set.journalInterval.tip'],
        desc: args.labels['panel.set.journalInterval.desc'],
      })}
      ${renderSettingRow({
        id: 'numFullSaveInterval',
        dataKey: 'fullSaveIntervalMs',
        type: 'number',
        min: 5000,
        max: 600000,
        name: args.labels['panel.set.fullSaveInterval.name'],
        tip: args.labels['panel.set.fullSaveInterval.tip'],
        desc: args.labels['panel.set.fullSaveInterval.desc'],
      })}
      ${renderSettingRow({
        id: 'numMaxSessions',
        dataKey: 'maxSessions',
        type: 'number',
        min: 0,
        name: args.labels['panel.set.maxSessions.name'],
        tip: args.labels['panel.set.maxSessions.tip'],
        desc: args.labels['panel.set.maxSessions.desc'],
      })}
    </div>
  </div>

  <!-- 操作 -->
  <div class="section">
    <h2>${args.labels['panel.section.actions']}</h2>
    <div class="card-panel">
      <div class="btn-row" style="margin-top:0">
        <button class="btn btn-primary" id="btnNewPeriod">${args.labels['panel.actions.newPeriod']}</button>
        <button class="btn btn-secondary" id="btnExportCSV">${args.labels['panel.actions.exportCsv']}</button>
        <button class="btn btn-secondary" id="btnExportAggregated">${args.labels['panel.actions.exportAggregated']}</button>
        <button class="btn btn-danger" id="btnClearHistory">${args.labels['panel.actions.clearHistory']}</button>
        <button class="btn btn-danger" id="btnReset">${args.labels['panel.actions.reset']}</button>
      </div>
      <div style="margin-top:12px;font-size:11px;color:var(--description);line-height:1.6">
        <strong>${args.labels['panel.actions.newPeriod']}</strong>${args.labels['panel.actions.hintPeriodDesc']}<br>
        <strong>${args.labels['panel.actions.clearHistory']}</strong>${args.labels['panel.actions.hintClearHistoryDesc']}<br>
        <strong>${args.labels['panel.actions.reset']}</strong>${args.labels['panel.actions.hintResetDesc']}
      </div>
    </div>
  </div>

  <div id="statusToast"></div>

  <script nonce="${args.nonce}">
${buildDashboardScript(args.labels)}
  </script>
</body>
</html>
`;
}
