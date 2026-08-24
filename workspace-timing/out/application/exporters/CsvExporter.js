"use strict";
/**
 * CsvExporter — CSV 导出器（预留）
 *
 * 将 WorkspaceTimingData 导出为 CSV 格式。
 * 后续配合 "workspaceTiming.export" 命令使用。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CsvExporter = void 0;
class CsvExporter {
    constructor() {
        this.formatName = 'csv';
    }
    async export(data, workspaceName) {
        const lines = [];
        // 头部
        lines.push(`# Workspace Timing Export: ${workspaceName}`);
        lines.push(`# Generated: ${new Date().toISOString()}`);
        lines.push(`# Total: ${data.totalMs}ms`);
        lines.push('');
        // 表头
        lines.push('Session Start,Session End,Duration (ms)');
        // 数据行
        for (const session of data.sessions) {
            const start = new Date(session.startMs).toISOString();
            const end = new Date(session.endMs).toISOString();
            lines.push(`${start},${end},${session.durationMs}`);
        }
        return lines.join('\n');
    }
}
exports.CsvExporter = CsvExporter;
//# sourceMappingURL=CsvExporter.js.map