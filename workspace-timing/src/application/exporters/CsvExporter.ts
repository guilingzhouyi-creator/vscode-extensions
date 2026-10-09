/**
 * Module: CsvExporter — 工作区明细会话与日汇总 CSV 导出器
 * File Path: src/application/exporters/CsvExporter.ts
 * Architecture Role: Application layer exporter converting raw session timings into CSV representations
 * Dependencies & Triggers: domain/models.ts, domain/TimeAggregator.ts; invoked via exporters facade
 * Responsibilities: Format session-level durations and natural day aggregated buckets into CSV text with metadata headers
 * Exit Semantics & Design Rationale: Uses local timezone timestamps (YYYY-MM-DD HH:MM:SS) rather than UTC to guarantee bucket alignment with daily aggregator views
 */

import { WorkspaceTimingData } from '../../domain/models';
import { TimeAggregator } from '../../domain/TimeAggregator';

/** 本地时区日期时间（YYYY-MM-DD HH:MM:SS） */
function localDateTime(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export class CsvExporter {
    readonly formatName = 'csv';

    async export(data: WorkspaceTimingData, workspaceName: string): Promise<string> {
        const lines: string[] = [];

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

        // 按日统计（与面板日报同源，跨午夜会话已按自然日切分归桶）
        lines.push('');
        lines.push('Date,Total (ms),Sessions');
        for (const d of TimeAggregator.dailyStats(data.sessions)) {
            lines.push(`${d.date},${d.totalMs},${d.sessionCount}`);
        }

        return lines.join('\n');
    }
}
