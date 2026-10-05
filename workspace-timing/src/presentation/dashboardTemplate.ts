/**
 * dashboardTemplate — 面板 HTML 模板（纯数据，零逻辑）
 *
 * 现代化 UI 深度美化版：
 * 1. 采用毛玻璃（Glassmorphism）与微层次卡片设计（微边框 + 柔和阴影 + 8px 圆角）。
 * 2. 运行中状态徽章增加 🟢 呼吸灯发光脉冲动效（Live Pulse Ring）。
 * 3. 统计数字采用等宽对齐与数值单位分层排版（Tabular figures + Unit typography）。
 * 4. 周活跃曲线升级为渐变区域填充（SVG LinearGradient Mask + 发光曲线描边 + 交互悬浮圆点）。
 * 5. 柱状图与进度条增加平滑渐变与悬浮微光（Glow & Elevation）。
 * 6. 12 周热力图增加悬浮缩放动效与更细腻的色阶。
 * 7. 完全兼容 VS Code Dark / Light / High Contrast 所有官方与第三方主题。
 * 8. 保持 100% 原有 DOM ID、事件绑定、消息通信与 i18n 完整性。
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
      <div class="setting-row">
        <div class="setting-label">
          <div class="setting-header-row">
            <span>${args.labels['panel.set.weeklyLimit.name']}</span>
            <span class="help-icon">?<span class="tooltip">${args.labels['panel.set.weeklyLimit.tip']}</span></span>
          </div>
          <div class="desc">${args.labels['panel.set.weeklyLimit.desc']}</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="chkWeeklyLimit" data-key="weeklyLimitEnabled">
          <span class="slider"></span>
        </label>
      </div>
      <div class="setting-row">
        <div class="setting-label">
          <div class="setting-header-row">
            <span>${args.labels['panel.set.weeklyLimitHours.name']}</span>
            <span class="help-icon">?<span class="tooltip">${args.labels['panel.set.weeklyLimitHours.tip']}</span></span>
          </div>
          <div class="desc">${args.labels['panel.set.weeklyLimitHours.desc']}</div>
        </div>
        <input class="number-input" type="number" id="numWeeklyLimitHours" data-key="weeklyLimitHours" min="1" max="168">
      </div>
    </div>
  </div>

  <!-- 存储设置 -->
  <div class="section">
    <h2>${args.labels['panel.section.storage']}</h2>
    <div class="card-panel">
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
        <strong>${args.labels['panel.actions.clearHistory']}</strong>${args.labels['confirm.clearHistory']}<br>
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
