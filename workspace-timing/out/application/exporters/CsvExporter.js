"use strict";
/**
 * CsvExporter — CSV 导出器
 *
 * 导出会话记录 + 每日统计 + 效率数据。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CsvExporter = void 0;
const TimeAggregator_1 = require("../../domain/TimeAggregator");
/** 本地时区日期时间（YYYY-MM-DD HH:MM:SS），与全局按本地日期统计的口径一致 */
function localDateTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
class CsvExporter {
    constructor() {
        this.formatName = 'csv';
    }
    /** 原始数据导出（仅会话记录）*/
    async export(data, workspaceName) {
        const lines = [];
        lines.push(`# Workspace Timing Export: ${workspaceName}`);
        lines.push(`# Generated: ${localDateTime(Date.now())}`);
        lines.push(`# Total: ${data.totalMs}ms`);
        lines.push('');
        lines.push('Session Start,Session End,Duration (ms)');
        for (const session of data.sessions) {
            const start = localDateTime(session.startMs);
            const end = localDateTime(session.endMs);
            lines.push(`${start},${end},${session.durationMs}`);
        }
        return lines.join('\n');
    }
    /** 面板数据导出（会话 + 每日统计 + 效率）*/
    exportDashboard(data, workspaceName) {
        const lines = [];
        lines.push(`# Workspace Timing Export: ${workspaceName}`);
        lines.push(`# Generated: ${localDateTime(Date.now())}`);
        lines.push(`# Total: ${TimeAggregator_1.TimeAggregator.formatDuration(data.totalMs)}`);
        lines.push(`# Today: ${TimeAggregator_1.TimeAggregator.formatDuration(data.todayMs)}`);
        lines.push(`# Week Total: ${TimeAggregator_1.TimeAggregator.formatDuration(data.weekTotalMs)}`);
        if (data.weekEfficiency !== undefined) {
            lines.push(`# Week Efficiency: ${(data.weekEfficiency * 100).toFixed(1)}%`);
        }
        lines.push('');
        // 每日统计
        lines.push('Date,Weekday,Total,Active,Idle,Efficiency');
        for (const d of data.dailyStats) {
            const total = TimeAggregator_1.TimeAggregator.formatDuration(d.totalMs);
            const active = d.activeMs !== undefined ? TimeAggregator_1.TimeAggregator.formatDuration(d.activeMs) : '-';
            const idle = d.idleMs !== undefined ? TimeAggregator_1.TimeAggregator.formatDuration(d.idleMs) : '-';
            const eff = d.efficiency !== undefined ? `${(d.efficiency * 100).toFixed(0)}%` : '-';
            lines.push(`${d.label},${d.weekday},${total},${active},${idle},${eff}`);
        }
        return lines.join('\n');
    }
}
exports.CsvExporter = CsvExporter;
//# sourceMappingURL=CsvExporter.js.map