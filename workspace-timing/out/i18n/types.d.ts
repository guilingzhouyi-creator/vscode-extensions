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
    'panel.title': string;
    'panel.stat.today': string;
    'panel.stat.week': string;
    'panel.stat.total': string;
    'panel.stat.sessions': string;
    'panel.stat.status': string;
    'panel.section.weekly': string;
    'panel.section.basic': string;
    'panel.section.storage': string;
    'panel.section.actions': string;
    'panel.chart.empty': string;
    'panel.chart.weekTotal': string;
    'setting.enabled': string;
    'setting.enabled.desc': string;
    'setting.enabled.help': string;
    'setting.globalDisabled': string;
    'setting.globalDisabled.desc': string;
    'setting.globalDisabled.help': string;
    'setting.statusBar': string;
    'setting.statusBar.desc': string;
    'setting.statusBar.help': string;
    'setting.journal': string;
    'setting.journal.desc': string;
    'setting.journal.help': string;
    'setting.backup': string;
    'setting.backup.desc': string;
    'setting.backup.help': string;
    'setting.ringBuffer': string;
    'setting.ringBuffer.desc': string;
    'setting.ringBuffer.help': string;
    'setting.journalInterval': string;
    'setting.journalInterval.desc': string;
    'setting.journalInterval.help': string;
    'setting.fullSaveInterval': string;
    'setting.fullSaveInterval.desc': string;
    'setting.fullSaveInterval.help': string;
    'setting.maxSessions': string;
    'setting.maxSessions.desc': string;
    'setting.maxSessions.help': string;
    'action.newPeriod': string;
    'action.exportCSV': string;
    'action.reset': string;
    'action.newPeriod.hint': string;
    'action.reset.hint': string;
    'status.running': string;
    'status.globalDisabled': string;
    'status.disabled': string;
    'statusBar.todayTotal': string;
    'statusBar.totalToday': string;
    'statusBar.tooltip': string;
    'toast.newPeriod': string;
    'toast.exportCSV': string;
    'toast.reset': string;
    'toast.configUpdated': string;
    'confirm.newPeriod': string;
    'confirm.newPeriod.title': string;
    'confirm.reset': string;
    'confirm.reset.title': string;
    'cmd.modeSwitched': string;
}
