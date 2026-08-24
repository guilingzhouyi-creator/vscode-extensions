/**
 * AggregatedCsvExporter — 全历史聚合导出器
 *
 * 输出全历史日报序列 CSV（折叠桶 ∪ 当期原始计算），
 * 与面板日报同口径；日期升序。
 */

import { TimeAggregator, DailyStats } from '../../domain/TimeAggregator';

export class AggregatedCsvExporter {
    readonly formatName = 'aggregated-csv';

    build(series: DailyStats[], workspaceName: string): string {
        const lines: string[] = [];

        lines.push(`# Workspace Timing Aggregated Export: ${workspaceName}`);
        lines.push(`# Generated: ${TimeAggregator.todayStr()} (local date)`);
        lines.push(`# Days: ${series.length}`);
        lines.push('');

        lines.push('Date,Total (ms),Sessions');
        for (const d of series) {
            lines.push(`${d.date},${d.totalMs},${d.sessionCount}`);
        }

        return lines.join('\n');
    }
}
