/**
 * i18n types — 国际化字符串 key 定义
 *
 * 约定：按 UI 区域分层命名
 *   panel.xxx   → 配置面板
 *   status.xxx  → 状态栏
 *   cmd.xxx     → 命令
 *   common.xxx  → 通用
 */

export type Locale = 'zh-CN' | 'en';

export interface I18nStrings {

    // 状态栏
    'statusBar.todayTotal': string;
    'statusBar.totalToday': string;
    'statusBar.tooltip': string;

    // Toast
    'toast.newPeriod': string;
    'toast.exportCSV': string;
    'toast.reset': string;
    'toast.configUpdated': string;
    // 导出相关
    'toast.exportSaveLabel': string;
    'toast.exportCancelled': string;
    'toast.exportSuccess': string;
    'toast.exportFailed': string;
    'toast.exportNoWorkspace': string;
    'toast.exportReportDaily': string;
    'toast.exportReportWeekly': string;
    // 导出文件名前缀（随语言变化）
    'export.filename.daily': string;
    'export.filename.weekly': string;
    'export.filename.aggregated': string;
    // 云端同步占位
    'toast.cloudSyncPlaceholder': string;

    // 确认弹窗
    'confirm.newPeriod': string;
    'confirm.newPeriod.title': string;
    'confirm.reset': string;
    'confirm.reset.title': string;
    'confirm.clearGlobal': string;
    'confirm.clearGlobal.title': string;
    'toast.clearGlobal': string;
    // 清除历史 / 还原
    'confirm.clearHistory': string;
    'confirm.clearHistory.title': string;
    'toast.clearHistoryDone': string;
    'confirm.restore': string;
    'confirm.restore.title': string;
    'toast.restored': string;

    // 命令
    'cmd.modeSwitched': string;
    'cmd.enabled': string;
    'cmd.disabled': string;
    'cmd.globalEnabled': string;
    'cmd.globalDisabled': string;
    'cmd.noWorkspace': string;
    'cmd.debugSaved': string;

    // 状态栏显示模式名（命令提示与 tooltip 共用）
    'statusBar.mode.today-total': string;
    'statusBar.mode.total-today': string;
    'statusBar.mode.compact': string;

    // ─── 面板（DashboardPanel webview）───
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
    'panel.today.title': string;
    'panel.today.duration': string;
    'panel.today.activeWindow': string;
    'panel.today.empty': string;
    'panel.today.exportBtn': string;
    'panel.global.title': string;
    'panel.global.empty': string;
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
    'panel.actions.newPeriod': string;
    'panel.actions.exportCsv': string;
    'panel.actions.reset': string;
    'panel.actions.clearHistory': string;
    'panel.actions.exportAggregated': string;
    'panel.actions.hintPeriod': string;
    'panel.actions.hintPeriodDesc': string;
    'panel.actions.hintReset': string;
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
}
