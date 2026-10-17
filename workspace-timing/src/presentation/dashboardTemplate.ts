/**
 * Module: DashboardTemplate
 * File Path: src/presentation/dashboardTemplate.ts
 * Architecture Role: Presentation layer HTML document builder and static template generator
 * Dependencies & Triggers: dashboard-base-styles.ts, dashboard-chart-styles.ts,
 *   dashboard-script.ts; invoked by DashboardPanel._getHtml()
 * Responsibilities: Assemble HTML shell with strict CSP meta headers; embed base CSS and
 *   chart styles; render static card layouts, setting rows, and widgets; inject bootstrap script
 * Exit Semantics & Design Rationale: Pure functional template generator without runtime side
 *   effects; guarantees strict CSP nonce isolation preventing inline script injection attacks
 */

import { DASHBOARD_BASE_STYLES } from './dashboard-base-styles';
import { DASHBOARD_CHART_STYLES } from './dashboard-chart-styles';
import { TIMING_VIEWPORT_STYLES, TIMING_VIEWPORT_CONTAINER_CLASS } from './container-queries';
import { buildDashboardScript } from './dashboard-script';

/**
 * Arguments required to render the dashboard webview HTML template.
 */
export interface DashboardTemplateArgs {
    /** Unique CSP nonce for script execution isolation. */
    nonce: string;
    /** Resource root for webview assets (panel.webview.cspSource). */
    cspSource: string;
    /** Document language locale (e.g., 'zh-CN' or 'en'). */
    lang: string;
    /** Localized string dictionary for template labels and script constants. */
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

const ROW_TYPE_TOGGLE = 'toggle';
const ROW_TYPE_NUMBER = 'number';
const ROW_TYPE_SELECT = 'select';

const STAT_ID_TODAY = 'statToday';
const STAT_ID_WEEK = 'statWeek';
const STAT_ID_TOTAL = 'statTotal';
const STAT_ID_GLOBAL_TOTAL = 'statGlobalTotal';
const STAT_ID_SESSIONS = 'statSessions';
const STAT_ID_STATUS = 'statStatus';

const DEFAULT_HELP_ARIA_LABEL = 'Help';
const OPTION_JOIN_SEPARATOR = '\n          ';
const ROW_JOIN_SEPARATOR = '\n      ';

const ID_CHK_ENABLED = 'chkEnabled';
const KEY_ENABLED = 'isEnabled';
const ID_CHK_GLOBAL_DISABLED = 'chkGlobalDisabled';
const KEY_GLOBAL_DISABLED = 'globalDisabled';
const ID_CHK_CHART_DUAL_TRACK = 'chkChartDualTrack';
const KEY_CHART_DUAL_TRACK = 'chartDualTrackDisplay';
const ID_CHK_AI_DETECTION = 'chkAiDetection';
const KEY_AI_DETECTION = 'aiDetectionEnabled';
const ID_NUM_IDLE_TIMEOUT = 'numIdleTimeout';
const KEY_IDLE_TIMEOUT = 'idleTimeoutMinutes';
const ID_NUM_AI_COOLDOWN = 'numAiCooldown';
const KEY_AI_COOLDOWN = 'aiCooldownSeconds';
const ID_CHK_STATUS_BAR = 'chkStatusBar';
const KEY_STATUS_BAR = 'statusBarEnabled';
const ID_SEL_LOCALE = 'selLocale';
const KEY_LOCALE = 'locale';
const ID_CHK_WEEKLY_LIMIT = 'chkWeeklyLimit';
const KEY_WEEKLY_LIMIT = 'weeklyLimitEnabled';
const ID_NUM_WEEKLY_LIMIT_HOURS = 'numWeeklyLimitHours';
const KEY_WEEKLY_LIMIT_HOURS = 'weeklyLimitHours';

const ID_CHK_JOURNAL = 'chkJournal';
const KEY_JOURNAL = 'journalEnabled';
const ID_CHK_BACKUP = 'chkBackup';
const KEY_BACKUP = 'backupToFile';
const ID_NUM_RING_BUFFER = 'numRingBuffer';
const KEY_RING_BUFFER = 'ringBufferCapacity';
const ID_NUM_JOURNAL_INTERVAL = 'numJournalInterval';
const KEY_JOURNAL_INTERVAL = 'journalFlushIntervalMs';
const ID_NUM_FULL_SAVE_INTERVAL = 'numFullSaveInterval';
const KEY_FULL_SAVE_INTERVAL = 'fullSaveIntervalMs';
const ID_NUM_MAX_SESSIONS = 'numMaxSessions';
const KEY_MAX_SESSIONS = 'maxSessions';

const LOCALE_VALUE_AUTO = 'auto';
const LOCALE_VALUE_ZH_CN = 'zh-CN';
const LOCALE_VALUE_EN = 'en';

const MAX_IDLE_TIMEOUT_MINUTES = 1440;
const MAX_AI_COOLDOWN_SECONDS = 3600;
const MAX_WEEKLY_LIMIT_HOURS = 168;

const MIN_RING_BUFFER_CAPACITY = 64;
const MAX_RING_BUFFER_CAPACITY = 65536;
const MIN_JOURNAL_FLUSH_INTERVAL_MS = 1000;
const MAX_JOURNAL_FLUSH_INTERVAL_MS = 300000;
const MIN_FULL_SAVE_INTERVAL_MS = 5000;
const MAX_FULL_SAVE_INTERVAL_MS = 600000;

function renderStatCard(id: string, label: string): string {
    return /* html */ `
    <div class="stat-card">
      <div class="value" id="${id}">--</div>
      <div class="label">${label}</div>
    </div>`;
}

function renderSettingRow(spec: SettingRowSpec, helpAriaLabel: string = DEFAULT_HELP_ARIA_LABEL): string {
    const labelId = `${spec.id}-label`;
    const descId = `${spec.id}-desc`;
    let controlHtml = '';

    if (spec.type === ROW_TYPE_TOGGLE) {
        controlHtml = `
        <label class="toggle">
          <input type="checkbox" id="${spec.id}" data-key="${spec.dataKey}" role="switch" aria-labelledby="${labelId}" aria-describedby="${descId}">
          <span class="slider"></span>
        </label>`;
    } else if (spec.type === ROW_TYPE_NUMBER) {
        const maxAttr = spec.max !== undefined ? ` max="${spec.max}"` : '';
        controlHtml = `
        <input class="number-input" type="number" id="${spec.id}" data-key="${spec.dataKey}" min="${spec.min ?? 0}"${maxAttr} aria-labelledby="${labelId}" aria-describedby="${descId}">`;
    } else if (spec.type === ROW_TYPE_SELECT) {
        const optionsHtml = (spec.options ?? [])
            .map(opt => `<option value="${opt.value}">${opt.label}</option>`)
            .join(OPTION_JOIN_SEPARATOR);
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
            <span class="help-icon" tabindex="0" role="button" aria-label="${helpAriaLabel}">?<span class="tooltip">${spec.tip}</span></span>
          </div>
          <div class="desc" id="${descId}">${spec.desc}</div>
        </div>${controlHtml}
      </div>`;
}

function renderBasicSettingsRows(
    labels: Record<string, string>,
    renderRow: (spec: SettingRowSpec) => string,
): string {
    return [
        renderRow({ id: ID_CHK_ENABLED, dataKey: KEY_ENABLED, type: ROW_TYPE_TOGGLE, name: labels['panel.set.enabled.name'], tip: labels['panel.set.enabled.tip'], desc: labels['panel.set.enabled.desc'] }),
        renderRow({ id: ID_CHK_GLOBAL_DISABLED, dataKey: KEY_GLOBAL_DISABLED, type: ROW_TYPE_TOGGLE, name: labels['panel.set.globalDisabled.name'], tip: labels['panel.set.globalDisabled.tip'], desc: labels['panel.set.globalDisabled.desc'] }),
        renderRow({ id: ID_CHK_CHART_DUAL_TRACK, dataKey: KEY_CHART_DUAL_TRACK, type: ROW_TYPE_TOGGLE, name: labels['panel.set.chartDualTrack.name'], tip: labels['panel.set.chartDualTrack.tip'], desc: labels['panel.set.chartDualTrack.desc'] }),
        renderRow({ id: ID_CHK_AI_DETECTION, dataKey: KEY_AI_DETECTION, type: ROW_TYPE_TOGGLE, name: labels['panel.set.aiDetection.name'], tip: labels['panel.set.aiDetection.tip'], desc: labels['panel.set.aiDetection.desc'] }),
        renderRow({ id: ID_NUM_IDLE_TIMEOUT, dataKey: KEY_IDLE_TIMEOUT, type: ROW_TYPE_NUMBER, min: 0, max: MAX_IDLE_TIMEOUT_MINUTES, name: labels['panel.set.idleTimeout.name'], tip: labels['panel.set.idleTimeout.tip'], desc: labels['panel.set.idleTimeout.desc'] }),
        renderRow({ id: ID_NUM_AI_COOLDOWN, dataKey: KEY_AI_COOLDOWN, type: ROW_TYPE_NUMBER, min: 0, max: MAX_AI_COOLDOWN_SECONDS, name: labels['panel.set.aiCooldown.name'], tip: labels['panel.set.aiCooldown.tip'], desc: labels['panel.set.aiCooldown.desc'] }),
        renderRow({ id: ID_CHK_STATUS_BAR, dataKey: KEY_STATUS_BAR, type: ROW_TYPE_TOGGLE, name: labels['panel.set.statusBar.name'], tip: labels['panel.set.statusBar.tip'], desc: labels['panel.set.statusBar.desc'] }),
        renderRow({
            id: ID_SEL_LOCALE,
            dataKey: KEY_LOCALE,
            type: ROW_TYPE_SELECT,
            name: labels['panel.set.locale.name'],
            tip: labels['panel.set.locale.tip'],
            desc: labels['panel.set.locale.desc'],
            options: [
                { value: LOCALE_VALUE_AUTO, label: labels['panel.set.locale.auto'] },
                { value: LOCALE_VALUE_ZH_CN, label: labels['panel.set.locale.zhCN'] },
                { value: LOCALE_VALUE_EN, label: labels['panel.set.locale.en'] },
            ],
        }),
        renderRow({ id: ID_CHK_WEEKLY_LIMIT, dataKey: KEY_WEEKLY_LIMIT, type: ROW_TYPE_TOGGLE, name: labels['panel.set.weeklyLimit.name'], tip: labels['panel.set.weeklyLimit.tip'], desc: labels['panel.set.weeklyLimit.desc'] }),
        renderRow({ id: ID_NUM_WEEKLY_LIMIT_HOURS, dataKey: KEY_WEEKLY_LIMIT_HOURS, type: ROW_TYPE_NUMBER, min: 1, max: MAX_WEEKLY_LIMIT_HOURS, name: labels['panel.set.weeklyLimitHours.name'], tip: labels['panel.set.weeklyLimitHours.tip'], desc: labels['panel.set.weeklyLimitHours.desc'] }),
    ].join(ROW_JOIN_SEPARATOR);
}

function renderStorageSettingsRows(
    labels: Record<string, string>,
    renderRow: (spec: SettingRowSpec) => string,
): string {
    return [
        renderRow({ id: ID_CHK_JOURNAL, dataKey: KEY_JOURNAL, type: ROW_TYPE_TOGGLE, name: labels['panel.set.journal.name'], tip: labels['panel.set.journal.tip'], desc: labels['panel.set.journal.desc'] }),
        renderRow({ id: ID_CHK_BACKUP, dataKey: KEY_BACKUP, type: ROW_TYPE_TOGGLE, name: labels['panel.set.backup.name'], tip: labels['panel.set.backup.tip'], desc: labels['panel.set.backup.desc'] }),
        renderRow({ id: ID_NUM_RING_BUFFER, dataKey: KEY_RING_BUFFER, type: ROW_TYPE_NUMBER, min: MIN_RING_BUFFER_CAPACITY, max: MAX_RING_BUFFER_CAPACITY, name: labels['panel.set.ringBuffer.name'], tip: labels['panel.set.ringBuffer.tip'], desc: labels['panel.set.ringBuffer.desc'] }),
        renderRow({ id: ID_NUM_JOURNAL_INTERVAL, dataKey: KEY_JOURNAL_INTERVAL, type: ROW_TYPE_NUMBER, min: MIN_JOURNAL_FLUSH_INTERVAL_MS, max: MAX_JOURNAL_FLUSH_INTERVAL_MS, name: labels['panel.set.journalInterval.name'], tip: labels['panel.set.journalInterval.tip'], desc: labels['panel.set.journalInterval.desc'] }),
        renderRow({ id: ID_NUM_FULL_SAVE_INTERVAL, dataKey: KEY_FULL_SAVE_INTERVAL, type: ROW_TYPE_NUMBER, min: MIN_FULL_SAVE_INTERVAL_MS, max: MAX_FULL_SAVE_INTERVAL_MS, name: labels['panel.set.fullSaveInterval.name'], tip: labels['panel.set.fullSaveInterval.tip'], desc: labels['panel.set.fullSaveInterval.desc'] }),
        renderRow({ id: ID_NUM_MAX_SESSIONS, dataKey: KEY_MAX_SESSIONS, type: ROW_TYPE_NUMBER, min: 0, name: labels['panel.set.maxSessions.name'], tip: labels['panel.set.maxSessions.tip'], desc: labels['panel.set.maxSessions.desc'] }),
    ].join(ROW_JOIN_SEPARATOR);
}

/**
 * Builds the complete HTML page string for the timing dashboard webview.
 *
 * @param args - Template parameters including nonce, CSP source, language, and i18n labels
 * @returns Fully constructed HTML page string
 */
export function buildDashboardHtml(args: DashboardTemplateArgs): string {
    const helpLabel = args.labels['panel.aria.help'] || DEFAULT_HELP_ARIA_LABEL;
    const renderRow = (spec: SettingRowSpec) => renderSettingRow(spec, helpLabel);
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
${TIMING_VIEWPORT_STYLES}
  </style>
</head>
<body class="${TIMING_VIEWPORT_CONTAINER_CLASS}">

  <!-- 头部主标题栏 -->
  <div class="main-header">
    <h1>
      <span class="header-icon">⏱️</span>
      ${args.labels['panel.title']}
    </h1>
  </div>

  <!-- 统计卡片网格 -->
  <div class="stats-grid">
    ${renderStatCard(STAT_ID_TODAY, args.labels['panel.label.today'])}
    ${renderStatCard(STAT_ID_WEEK, args.labels['panel.label.week'])}
    ${renderStatCard(STAT_ID_TOTAL, args.labels['panel.label.totalWs'])}
    ${renderStatCard(STAT_ID_GLOBAL_TOTAL, args.labels['panel.label.global'])}
    ${renderStatCard(STAT_ID_SESSIONS, args.labels['panel.label.sessions'])}
    ${renderStatCard(STAT_ID_STATUS, args.labels['panel.label.status'])}
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
      ${renderBasicSettingsRows(args.labels, renderRow)}
    </div>
  </div>

  <!-- 存储设置 -->
  <div class="section">
    <h2>${args.labels['panel.section.storage']}</h2>
    <div class="card-panel">
      ${renderStorageSettingsRows(args.labels, renderRow)}
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
