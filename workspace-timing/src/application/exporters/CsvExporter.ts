/**
 * Module: CsvExporter — 工作区明细会话与日汇总 CSV 导出器
 * File Path: src/application/exporters/CsvExporter.ts
 * Architecture Role: Application layer exporter converting raw session timings into CSV representations
 * Dependencies & Triggers: domain/models.ts, domain/TimeAggregator.ts; invoked via exporters facade
 * Responsibilities: Format session-level durations and natural day aggregated buckets into CSV text with metadata headers
 * Exit Semantics & Design Rationale: Uses local timezone timestamps (YYYY-MM-DD HH:MM:SS) rather than UTC to guarantee bucket alignment with daily aggregator views
 */

import { type WorkspaceTimingData, MINUTES_PER_HOUR, MS_PER_MINUTE } from '../../domain/models';
import { TimeAggregator } from '../../domain/TimeAggregator';

const CSV_HEADER_SESSION_START_END_DURATION = 'Session Start (UTC),Session End (UTC),Duration (ms),Local Start,Local End';
const CSV_HEADER_DATE_TOTAL_SESSIONS = 'Date,Total (ms),Sessions';
const PAD_ZERO = '0';
const PAD_LEN = 2;

function formatOffset(offsetMinutes?: number): string {
    const effectiveOffset = typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)
        ? offsetMinutes
        : -new Date().getTimezoneOffset();
    const signPrefix = effectiveOffset >= 0 ? '+' : '-';
    const absMinutes = Math.abs(effectiveOffset);
    const hoursStr = String(Math.floor(absMinutes / MINUTES_PER_HOUR)).padStart(PAD_LEN, PAD_ZERO);
    const minutesStr = String(absMinutes % MINUTES_PER_HOUR).padStart(PAD_LEN, PAD_ZERO);
    return `${signPrefix}${hoursStr}:${minutesStr}`;
}

/** 本地/指定时区日期时间（YYYY-MM-DD HH:MM:SS） */
function localDateTime(timestampMs: number, offsetMinutes?: number): string {
    const formatPad = (num: number) => String(num).padStart(PAD_LEN, PAD_ZERO);
    if (typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)) {
        const shiftedDate = new Date(timestampMs + offsetMinutes * MS_PER_MINUTE);
        return `${shiftedDate.getUTCFullYear()}-${formatPad(shiftedDate.getUTCMonth() + 1)}-${formatPad(shiftedDate.getUTCDate())} ${formatPad(shiftedDate.getUTCHours())}:${formatPad(shiftedDate.getUTCMinutes())}:${formatPad(shiftedDate.getUTCSeconds())}`;
    }
    const dateObj = new Date(timestampMs);
    return `${dateObj.getFullYear()}-${formatPad(dateObj.getMonth() + 1)}-${formatPad(dateObj.getDate())} ${formatPad(dateObj.getHours())}:${formatPad(dateObj.getMinutes())}:${formatPad(dateObj.getSeconds())}`;
}

export class CsvExporter {
    readonly formatName = 'csv';

    async export(timingData: WorkspaceTimingData, workspaceName: string): Promise<string> {
        const csvLines: string[] = [];
        const tzName = timingData.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const offsetStr = formatOffset(timingData.utcOffsetMinutes);

        csvLines.push(`# Workspace Timing Export: ${workspaceName}`);
        csvLines.push(`# Generated: ${TimeAggregator.toUtcIsoString(Date.now())}`);
        csvLines.push(`# Timezone: ${tzName} (UTC${offsetStr})`);
        csvLines.push(`# Total: ${timingData.totalMs}ms`);
        csvLines.push('');

        csvLines.push(CSV_HEADER_SESSION_START_END_DURATION);
        for (const session of timingData.sessions) {
            const startUtc = TimeAggregator.toUtcIsoString(session.startMs);
            const endUtc = TimeAggregator.toUtcIsoString(session.endMs);
            const startLocal = localDateTime(session.startMs, timingData.utcOffsetMinutes);
            const endLocal = localDateTime(session.endMs, timingData.utcOffsetMinutes);
            csvLines.push(`${startUtc},${endUtc},${session.durationMs},${startLocal},${endLocal}`);
        }

        // 按日统计（与面板日报同源，跨午夜会话已按自然日切分归桶）
        csvLines.push('');
        csvLines.push(CSV_HEADER_DATE_TOTAL_SESSIONS);
        for (const dayStat of TimeAggregator.dailyStats(timingData.sessions, timingData.utcOffsetMinutes)) {
            csvLines.push(`${dayStat.date},${dayStat.totalMs},${dayStat.sessionCount}`);
        }

        return csvLines.join('\n');
    }
}
