"use strict";
/**
 * CsvExporter — CSV 导出器
 *
 * 将 WorkspaceTimingData 导出为 CSV：会话记录 + 按日统计。
 *
 * ⚠️ 时间戳统一使用**本地时区**格式化（YYYY-MM-DD HH:MM:SS），
 *    与聚合层的本地时区归桶口径一致——禁止使用 toISOString()（UTC），
 *    否则 UTC+8 用户早上 8 点前的会话会被归到前一天。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CsvExporter = void 0;
const TimeAggregator_1 = require("../../domain/TimeAggregator");
/** 本地时区日期时间（YYYY-MM-DD HH:MM:SS） */
function localDateTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
class CsvExporter {
    constructor() {
        this.formatName = 'csv';
    }
    async export(data, workspaceName) {
        const lines = [];
        // 头部
        lines.push(`# Workspace Timing Export: ${workspaceName}`);
        lines.push(`# Generated: ${localDateTime(Date.now())}`);
        lines.push(`# Total: ${data.totalMs}ms`);
        lines.push('');
        // 会话记录
        lines.push('Session Start,Session End,Duration (ms)');
        for (const session of data.sessions) {
            const start = localDateTime(session.startMs);
            const end = localDateTime(session.endMs);
            lines.push(`${start},${end},${session.durationMs}`);
        }
        // 按日统计（与面板日报同源，跨午夜会话已按自然日切分归桶）
        lines.push('');
        lines.push('Date,Total (ms),Sessions');
        for (const d of TimeAggregator_1.TimeAggregator.dailyStats(data.sessions)) {
            lines.push(`${d.date},${d.totalMs},${d.sessionCount}`);
        }
        return lines.join('\n');
    }
}
exports.CsvExporter = CsvExporter;
//# sourceMappingURL=CsvExporter.js.map