/**
 * en — English language pack
 */

import { I18nStrings } from './types';

const en: I18nStrings = {
    'panel.title': '⏱ Workspace Timing',
    'panel.stat.today': 'Today',
    'panel.stat.week': 'Week',
    'panel.stat.total': 'Total',
    'panel.stat.sessions': 'Sessions',
    'panel.stat.status': 'Status',
    'panel.section.weekly': '📊 Weekly Report',
    'panel.section.basic': 'Basic Settings',
    'panel.section.storage': '⚙️ Storage Settings',
    'panel.section.actions': '🔧 Actions',
    'panel.chart.empty': 'No data yet — start coding and it will be recorded automatically',
    'panel.chart.weekTotal': 'Week total: ',

    'setting.enabled': 'Workspace Timing',
    'setting.enabled.desc': 'Enable/disable timing for the current workspace',
    'setting.enabled.help': 'When enabled, timing starts as soon as the VS Code window opens;\nwhen disabled, all timing and recording stops completely',
    'setting.globalDisabled': 'Global Disable',
    'setting.globalDisabled.desc': 'Disable timing for all workspaces (highest priority)',
    'setting.globalDisabled.help': 'When globally disabled, no workspace will be timed;\ntakes priority over individual workspace settings',
    'setting.statusBar': 'Status Bar',
    'setting.statusBar.desc': 'Show timing in the status bar',
    'setting.statusBar.help': 'Shows today\'s time and total time in the status bar;\nclick to cycle through display modes',

    'setting.journal': 'Crash Protection',
    'setting.journal.desc': 'Enable journal file to prevent crash data loss',
    'setting.journal.help': 'Writes time slices to .journal file every 10 seconds;\non restart after crash, data can be recovered;\nmaximum loss ≈ 10 seconds',
    'setting.backup': 'JSON Backup',
    'setting.backup.desc': 'Write .vscode/workspace-timing.json additionally',
    'setting.backup.help': 'Writes complete data to .vscode/workspace-timing.json;\nvisible, version-controllable, and portable',
    'setting.ringBuffer': 'RingBuffer Capacity',
    'setting.ringBuffer.desc': 'Ring buffer entry count (64~65536)',
    'setting.ringBuffer.help': 'Number of time slices cached in memory;\nhigher values allow UI to query more history,\nbut use more memory (recommended: 1024 ≈ 17 min)',
    'setting.journalInterval': 'Journal Flush Interval',
    'setting.journalInterval.desc': 'Milliseconds (1000~300000)',
    'setting.journalInterval.help': 'How often the memory buffer is flushed to the journal file;\nshorter intervals reduce data loss but increase disk writes',
    'setting.fullSaveInterval': 'Full Save Interval',
    'setting.fullSaveInterval.desc': 'Milliseconds (5000~600000)',
    'setting.fullSaveInterval.help': 'How often complete timing data is saved to workspaceState and JSON;\nshorter intervals are safer but increase write frequency',
    'setting.maxSessions': 'Max Sessions',
    'setting.maxSessions.desc': '0 = unlimited',
    'setting.maxSessions.help': 'Maximum number of session records to keep;\noldest records are automatically deleted when exceeded;\n0 means unlimited (watch memory usage)',

    'action.newPeriod': 'New Period',
    'action.exportCSV': 'Export CSV',
    'action.reset': 'Reset All Data',
    'action.newPeriod.hint': 'Counter resets to zero; history preserved in session records',
    'action.reset.hint': 'Clears all timing data and history; irreversible',

    'status.running': 'Running',
    'status.globalDisabled': 'Globally Disabled',
    'status.disabled': 'Disabled',

    'statusBar.todayTotal': 'Today {0} · Total {1}',
    'statusBar.totalToday': 'Total {0} · Today {1}',
    'statusBar.tooltip': 'Workspace Timing — click to switch display mode',

    'toast.newPeriod': 'New period requested',
    'toast.exportCSV': 'CSV export requested',
    'toast.reset': 'Reset requested',
    'toast.configUpdated': 'Configuration updated',

    'confirm.newPeriod': 'Start a new counting period? The counter will reset to zero, but history will be preserved.',
    'confirm.newPeriod.title': 'Confirm New Period',
    'confirm.reset': 'Reset all timing data? This action cannot be undone!',
    'confirm.reset.title': 'Confirm Reset',

    'cmd.modeSwitched': 'Switched to "{0}" mode',
};

export default en;
