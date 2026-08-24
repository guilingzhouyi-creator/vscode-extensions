"use strict";
/**
 * AggregatedCsvExporter — 全历史聚合导出器
 *
 * 输出全历史日报序列 CSV（折叠桶 ∪ 当期原始计算），
 * 与面板日报同口径；日期升序。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggregatedCsvExporter = void 0;
const TimeAggregator_1 = require("../../domain/TimeAggregator");
class AggregatedCsvExporter {
    constructor() {
        this.formatName = 'aggregated-csv';
    }
    build(series, workspaceName) {
        const lines = [];
        lines.push(`# Workspace Timing Aggregated Export: ${workspaceName}`);
        lines.push(`# Generated: ${TimeAggregator_1.TimeAggregator.todayStr()} (local date)`);
        lines.push(`# Days: ${series.length}`);
        lines.push('');
        lines.push('Date,Total (ms),Sessions');
        for (const d of series) {
            lines.push(`${d.date},${d.totalMs},${d.sessionCount}`);
        }
        return lines.join('\n');
    }
}
exports.AggregatedCsvExporter = AggregatedCsvExporter;
//# sourceMappingURL=AggregatedCsvExporter.js.map