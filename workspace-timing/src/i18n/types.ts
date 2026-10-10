/**
 * Module: I18nTypes — 国际化类型与词条契约定义
 * File Path: src/i18n/types.ts
 * Architecture Role: Internationalization layer type system and translation key contract
 * Dependencies & Triggers: Consumed by src/i18n/zh-CN.ts, src/i18n/en.ts, and src/i18n/index.ts
 * Responsibilities: Define strongly-typed I18nStrings mapping and supported Locale union ('zh-CN' | 'en')
 * Exit Semantics & Design Rationale: Single source of truth for UI string keys; TypeScript compilation guarantees compile-time completeness and parity across all localized language packs
 */

export type Locale = 'zh-CN' | 'en';

export interface I18nStrings {

    /** 状态栏渲染契约：用于实时展示今日累计与全局工时 (StatusBar presentation contracts) */
    'statusBar.todayTotal': string;
    'statusBar.totalToday': string;
    'statusBar.tooltip': string;
    'statusBar.tooltipWithMode': string;

    /** 交互通知契约：操作完成与配置变更的即时反馈提示 (Toast notification contracts) */
    'toast.newPeriod': string;
    'toast.exportCSV': string;
    'toast.reset': string;
    'toast.configUpdated': string;
    /** 导出对话框动作标签与状态提示契约 (Export file picker and status contracts) */
    'toast.exportSaveLabel': string;
    'toast.exportCancelled': string;
    'toast.exportSuccess': string;
    'toast.exportFailed': string;
    'toast.exportNoWorkspace': string;
    'toast.exportReportDaily': string;
    'toast.exportReportWeekly': string;
    /** 导出文件名前缀契约：随语言环境动态生成规范化文件名 */
    'export.filename.daily': string;
    'export.filename.weekly': string;
    'export.filename.aggregated': string;
    /** 导出对话框文件类型过滤器契约 (File type filter labels) */
    'export.filter.csv': string;
    'export.filter.md': string;
    'export.filter.json': string;
    'export.filter.all': string;

    /** Markdown 报表排版契约：定义日报与周报各节标题与明细表头 (Report layout contracts) */
    'report.daily.title': string;
    'report.daily.todayDuration': string;
    'report.daily.sessionCount': string;
    'report.daily.activeWindow': string;
    'report.weekly.title': string;
    'report.weekly.summary': string;
    'report.weekly.totalDuration': string;
    'report.weekly.avgDaily': string;
    'report.weekly.activeDays': string;
    'report.weekly.activeDaysFmt': string;
    'report.weekly.peakDate': string;
    'report.weekly.sessionCount': string;
    'report.weekly.distribution': string;
    'report.weekly.trend': string;
    'report.table.sessions': string;
    'report.table.start': string;
    'report.table.end': string;
    'report.table.duration': string;
    'report.table.date': string;
    'report.table.weekday': string;
    'report.table.weekStart': string;
    'report.table.weekRange': string;
    'report.table.sessionCount': string;
    'report.generatedAt': string;

    /** 弹窗确认与安全回滚契约：防止用户误触清空操作 (Confirmation modal contracts) */
    'confirm.newPeriod': string;
    'confirm.newPeriod.title': string;
    'confirm.reset': string;
    'confirm.reset.title': string;
    'confirm.clearGlobal': string;
    'confirm.clearGlobal.title': string;
    'toast.clearGlobal': string;
    /** 历史数据清理与快照还原通知契约 (History cleanup and restore contracts) */
    'confirm.clearHistory': string;
    'confirm.clearHistory.title': string;
    'toast.clearHistoryDone': string;
    'confirm.restore': string;
    'confirm.restore.title': string;
    'toast.restored': string;
    'toast.restoreFailed': string;

    /** 命令面板执行反馈契约：响应扩展命令调度与状态切换 (Command execution feedback contracts) */
    'cmd.modeSwitched': string;
    'cmd.enabled': string;
    'cmd.disabled': string;
    'cmd.globalEnabled': string;
    'cmd.globalDisabled': string;
    'cmd.noWorkspace': string;
    'cmd.debugSaved': string;
    /** 手动存盘操作结果文案契约 (Manual debug save status contracts) */
    'debugSave.notRunning': string;
    'debugSave.done': string;
    'debugSave.failed': string;

    /** 状态栏显示模式切换标签契约 (StatusBar display mode label contracts) */
    'statusBar.mode.today-total': string;
    'statusBar.mode.total-today': string;
    'statusBar.mode.compact': string;

    /** Webview 面板主视图与统计概览卡片契约 (Dashboard main view and KPI card contracts) */
    'panel.title': string;
    'panel.label.today': string;
    'panel.label.week': string;
    'panel.label.totalWs': string;
    'panel.label.global': string;
    'panel.label.sessions': string;
    'panel.label.status': string;
    'panel.weekly.title': string;
    'panel.weekly.emptyChart': string;
    'panel.weekly.totalLabel': string;
    'panel.weekly.avgDaily': string;
    'panel.weekly.activeDays': string;
    'panel.weekly.peakDate': string;
    'panel.weekly.exportBtn': string;
    'panel.weekly.trendTitle': string;
    'panel.heatmap.title': string;
    'panel.heatmap.mon': string;
    'panel.heatmap.wed': string;
    'panel.heatmap.fri': string;
    'panel.heatmap.less': string;
    'panel.heatmap.more': string;
    'panel.today.title': string;
    'panel.today.duration': string;
    'panel.today.activeWindow': string;
    'panel.today.empty': string;
    'panel.today.running': string;
    'panel.today.exportBtn': string;
    'panel.today.showMore': string;
    'panel.today.showLess': string;
    'panel.today.hourlyTitle': string;
    'panel.today.hourlyPeak': string;
    'panel.today.hourlyIdle': string;
    'panel.today.hourlyOverview': string;
    'panel.global.title': string;
    'panel.global.empty': string;
    'panel.global.showMore': string;
    'panel.global.showLess': string;
    'panel.section.basic': string;
    'panel.section.storage': string;
    'panel.section.actions': string;
    'panel.set.enabled.name': string;
    'panel.set.enabled.tip': string;
    'panel.set.enabled.desc': string;
    'panel.set.globalDisabled.name': string;
    'panel.set.globalDisabled.tip': string;
    'panel.set.globalDisabled.desc': string;
    'panel.set.statusBar.name': string;
    'panel.set.statusBar.tip': string;
    'panel.set.statusBar.desc': string;
    'panel.set.locale.name': string;
    'panel.set.locale.tip': string;
    'panel.set.locale.desc': string;
    'panel.set.locale.auto': string;
    'panel.set.locale.zhCN': string;
    'panel.set.locale.en': string;
    'panel.set.journal.name': string;
    'panel.set.journal.tip': string;
    'panel.set.journal.desc': string;
    'panel.set.backup.name': string;
    'panel.set.backup.tip': string;
    'panel.set.backup.desc': string;
    'panel.set.ringBuffer.name': string;
    'panel.set.ringBuffer.tip': string;
    'panel.set.ringBuffer.desc': string;
    'panel.set.journalInterval.name': string;
    'panel.set.journalInterval.tip': string;
    'panel.set.journalInterval.desc': string;
    'panel.set.fullSaveInterval.name': string;
    'panel.set.fullSaveInterval.tip': string;
    'panel.set.fullSaveInterval.desc': string;
    'panel.set.maxSessions.name': string;
    'panel.set.maxSessions.tip': string;
    'panel.set.maxSessions.desc': string;
    'panel.set.weeklyLimit.name': string;
    'panel.set.weeklyLimit.tip': string;
    'panel.set.weeklyLimit.desc': string;
    'panel.set.weeklyLimitHours.name': string;
    'panel.set.weeklyLimitHours.tip': string;
    'panel.set.weeklyLimitHours.desc': string;
    'panel.trend.limitMarker': string;
    'notify.weeklyLimitExceeded': string;
    'panel.actions.newPeriod': string;
    'panel.actions.exportCsv': string;
    'panel.actions.reset': string;
    'panel.actions.clearHistory': string;
    'panel.actions.exportAggregated': string;
    'panel.actions.hintPeriodDesc': string;
    'panel.actions.hintClearHistoryDesc': string;
    'panel.actions.hintResetDesc': string;
    'panel.js.badgeGlobalDisabled': string;
    'panel.js.badgeDisabled': string;
    'panel.js.badgeRunning': string;
    'panel.js.grandTotalPrefix': string;
    'panel.js.workspaceCountFmt': string;
    'panel.js.weekTotalPrefix': string;
    'panel.js.daysFmt': string;
    'panel.toast.newPeriodRequested': string;
    'panel.toast.exportCsvRequested': string;
    'panel.toast.resetRequested': string;
    'panel.toast.exportDailyRequested': string;
    'panel.toast.exportWeeklyRequested': string;
    'panel.toast.exportAggregatedRequested': string;
    'panel.toast.clearHistoryRequested': string;

    /** 动态活动感知与智能协作状态契约 (Activity mode and AI collaboration contracts) */
    'activity.mode.manual': string;
    'activity.mode.ai': string;
    'activity.mode.idle': string;
    'status.idle': string;
    'status.ai': string;
    'statusBar.idle': string;
    'statusBar.ai': string;
    'statusBar.tooltipWithActivity': string;

    /** Webview 面板状态指示徽标文案契约 (Dashboard status badge contracts) */
    'panel.js.badgeIdle': string;
    'panel.js.badgeAi': string;

    /** 空闲超时与 AI 协作检测表单项契约 (Configuration form field contracts) */
    'panel.set.idleTimeout.name': string;
    'panel.set.idleTimeout.tip': string;
    'panel.set.idleTimeout.desc': string;
    'panel.set.aiDetection.name': string;
    'panel.set.aiDetection.tip': string;
    'panel.set.aiDetection.desc': string;
    'panel.set.aiCooldown.name': string;
    'panel.set.aiCooldown.tip': string;
    'panel.set.aiCooldown.desc': string;

    /** 双轨图表展示配置与图例契约 (Dual-track chart configuration and legend contracts) */
    'panel.set.chartDualTrack.name': string;
    'panel.set.chartDualTrack.tip': string;
    'panel.set.chartDualTrack.desc': string;
    'panel.weekly.legendManual': string;
    'panel.weekly.legendAi': string;
    'panel.weekly.legendRatio': string;
    'panel.today.hourlyStackedTooltip': string;
    /** 无障碍帮助图标标签 (Accessibility help label) */
    'panel.aria.help': string;
}
