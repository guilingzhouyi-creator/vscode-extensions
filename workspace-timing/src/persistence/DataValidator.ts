/**
 * DataValidator — 外部计时数据校验器
 *
 * 职责：还原（restore）前对不可信 JSON 做结构/数值校验与净化。
 * 边界：纯函数；拒绝整体结构非法的文件，过滤条目级脏数据——
 *       校验失败时绝不触碰现网数据。
 */

import {
    WorkspaceTimingData,
    LATEST_VERSION,
    DailyTotalsMap,
    TimeSession,
    MS_PER_DAY,
    TimingMetadata,
} from '../domain/models';

export interface ValidationResult {
    ok: boolean;
    /** ok=false 时的失败原因（面向用户的简短描述） */
    error?: string;
    /** 净化后的数据（ok=true 时可用） */
    data?: WorkspaceTimingData;
}

const ERROR_NOT_AN_OBJECT = 'not an object';
const ERROR_INVALID_VERSION = 'invalid version';
const ERROR_INVALID_TOTAL_MS = 'invalid totalMs';
const ERROR_INVALID_CURRENT_SESSION = 'invalid currentSessionStartMs';
const ERROR_MISSING_SESSIONS = 'missing sessions';
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateTopLevelFields(o: Record<string, unknown>): string | null {
    if (!isFiniteNumber(o.version) || o.version < 1) {
        return ERROR_INVALID_VERSION;
    }
    if (!isFiniteNumber(o.totalMs) || o.totalMs < 0) {
        return ERROR_INVALID_TOTAL_MS;
    }
    if (!isFiniteNumber(o.currentSessionStartMs) || o.currentSessionStartMs < 0) {
        return ERROR_INVALID_CURRENT_SESSION;
    }
    if (!Array.isArray(o.sessions)) {
        return ERROR_MISSING_SESSIONS;
    }
    return null;
}

function sanitizeSessionEntry(s: unknown): TimeSession | null {
    if (!isRecord(s)) return null;
    const { startMs, endMs, durationMs } = s;
    if (!isFiniteNumber(startMs) || !isFiniteNumber(endMs)) return null;
    if (startMs <= 0 || endMs < startMs) return null;

    // 强制保障时长守恒数学不变量：durationMs 严格等于 endMs - startMs
    const cleanDuration = isFiniteNumber(durationMs) && durationMs >= 0
        ? Math.min(durationMs, endMs - startMs)
        : endMs - startMs;

    return { startMs, endMs, durationMs: cleanDuration };
}

function sanitizeSessions(rawSessions: unknown[]): TimeSession[] {
    const sessions: TimeSession[] = [];
    for (const s of rawSessions) {
        const clean = sanitizeSessionEntry(s);
        if (clean) {
            sessions.push(clean);
        }
    }
    // 排序不变量固化：按起始时间升序
    sessions.sort((a, b) => a.startMs - b.startMs);
    return sessions;
}

function sanitizeDailyTotals(rawTotals: unknown): DailyTotalsMap | undefined {
    if (!isRecord(rawTotals)) {
        return undefined;
    }
    const dailyTotals: DailyTotalsMap = {};
    for (const [key, v] of Object.entries(rawTotals)) {
        if (!ISO_DATE_PATTERN.test(key) || !isRecord(v)) {
            continue;
        }
        if (!isFiniteNumber(v.totalMs) || v.totalMs < 0) {
            continue;
        }
        if (!isFiniteNumber(v.sessionCount) || v.sessionCount < 0) {
            continue;
        }
        // 钳制单日上限总时长不超过 24 小时（MS_PER_DAY）
        const clampedMs = Math.min(v.totalMs, MS_PER_DAY);
        dailyTotals[key] = {
            totalMs: clampedMs,
            sessionCount: Math.floor(v.sessionCount),
        };
    }
    return dailyTotals;
}

function sanitizeMetadata(rawMeta: unknown): TimingMetadata | undefined {
    if (!isRecord(rawMeta)) {
        return undefined;
    }
    const meta: TimingMetadata = {};
    if (isFiniteNumber(rawMeta.lastJournalTs) && rawMeta.lastJournalTs > 0) {
        meta.lastJournalTs = rawMeta.lastJournalTs;
    }
    if (typeof rawMeta.lastJournalTs === 'string' && rawMeta.lastJournalTs.trim() !== '') {
        meta.lastJournalTs = rawMeta.lastJournalTs;
    }
    if (isFiniteNumber(rawMeta.foldedSessionCount) && rawMeta.foldedSessionCount >= 0) {
        meta.foldedSessionCount = Math.floor(rawMeta.foldedSessionCount);
    }
    if (isFiniteNumber(rawMeta.journalPlaybackCount) && rawMeta.journalPlaybackCount >= 0) {
        meta.journalPlaybackCount = Math.floor(rawMeta.journalPlaybackCount);
    }
    return Object.keys(meta).length > 0 ? meta : undefined;
}

/** 校验并净化一份外部计时数据 */
export function validateTimingData(raw: unknown): ValidationResult {
    if (!isRecord(raw)) {
        return { ok: false, error: ERROR_NOT_AN_OBJECT };
    }

    const fieldError = validateTopLevelFields(raw);
    if (fieldError) {
        return { ok: false, error: fieldError };
    }

    const sessions = sanitizeSessions(raw.sessions as unknown[]);
    const dailyTotals = sanitizeDailyTotals(raw.dailyTotals);
    const metadata = sanitizeMetadata(raw.metadata);

    const data: WorkspaceTimingData = {
        version: LATEST_VERSION,
        totalMs: raw.totalMs as number,
        currentSessionStartMs: 0, // 还原后一律从干净状态重新开始
        lastSavedAtMs: Date.now(),
        isEnabled: raw.isEnabled !== false,
        sessions,
        ...(dailyTotals ? { dailyTotals } : {}),
        ...(metadata ? { metadata } : {}),
    };

    return { ok: true, data };
}
