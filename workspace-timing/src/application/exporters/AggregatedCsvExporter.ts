/**
 * Module: AggregatedCsvExporter — 全历史聚合日报 CSV 导出器
 * File Path: src/application/exporters/AggregatedCsvExporter.ts
 * Architecture Role: Application layer exporter specialized in aggregated daily history serialization
 * Dependencies & Triggers: domain/TimeAggregator.ts; invoked via exporters facade by TimerOrchestrator
 * Responsibilities: Format aggregated DailyStats sequence into RFC-4180 compliant CSV format with metadata headers
 * Exit Semantics & Design Rationale: Pure deterministic text formatter with zero disk I/O; operates on immutable series slices sorted chronologically
 */

import { TimeAggregator, type DailyStats } from '../../domain/TimeAggregator';

const CSV_HEADER_DATE_TOTAL_SESSIONS = 'Date,Total (ms),Sessions';

export class AggregatedCsvExporter {
    readonly formatName = 'aggregated-csv';

    build(series: DailyStats[], workspaceName: string): string {
        const csvLines: string[] = [];

        csvLines.push(`# Workspace Timing Aggregated Export: ${workspaceName}`);
        csvLines.push(`# Generated: ${TimeAggregator.todayStr()} (local date)`);
        csvLines.push(`# Days: ${series.length}`);
        csvLines.push('');

        csvLines.push(CSV_HEADER_DATE_TOTAL_SESSIONS);
        for (const dayStat of series) {
            csvLines.push(`${dayStat.date},${dayStat.totalMs},${dayStat.sessionCount}`);
        }

        return csvLines.join('\n');
    }
}
