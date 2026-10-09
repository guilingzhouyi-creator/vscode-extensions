/**
 * Module: AggregatedCsvExporter — 全历史聚合日报 CSV 导出器
 * File Path: src/application/exporters/AggregatedCsvExporter.ts
 * Architecture Role: Application layer exporter specialized in aggregated daily history serialization
 * Dependencies & Triggers: domain/TimeAggregator.ts; invoked via exporters facade by TimerOrchestrator
 * Responsibilities: Format aggregated DailyStats sequence into RFC-4180 compliant CSV format with metadata headers
 * Exit Semantics & Design Rationale: Pure deterministic text formatter with zero disk I/O; operates on immutable series slices sorted chronologically
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
