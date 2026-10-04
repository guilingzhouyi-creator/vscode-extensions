/**
 * DataValidator — 外部计时数据校验器
 *
 * 职责：还原（restore）前对不可信 JSON 做结构/数值校验与净化。
 * 边界：纯函数；**拒绝整体结构非法的文件，过滤条目级脏数据**——
 *       校验失败时绝不触碰现网数据。
 */

import { WorkspaceTimingData, LATEST_VERSION, DailyTotalsMap, TimeSession } from '../domain/models';

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
    if (!isFiniteNumber(startMs) || !isFiniteNumber(endMs) || !isFiniteNumber(durationMs)) return null;
    if (startMs <= 0 || endMs < startMs || durationMs < 0) return null;
    return { startMs, endMs, durationMs };
}

function sanitizeSessions(rawSessions: unknown[]): TimeSession[] {
    const sessions: TimeSession[] = [];
    for (const s of rawSessions) {
        const clean = sanitizeSessionEntry(s);
        if (clean) sessions.push(clean);
    }
    // 排序不变量固化：按起始时间升序
    sessions.sort((a, b) => a.startMs - b.startMs);
    return sessions;
}

function sanitizeDailyTotals(rawTotals: unknown): DailyTotalsMap | undefined {
    if (!isRecord(rawTotals)) return undefined;
    const dailyTotals: DailyTotalsMap = {};
    for (const [key, v] of Object.entries(rawTotals)) {
        if (!ISO_DATE_PATTERN.test(key) || !isRecord(v)) continue;
        if (!isFiniteNumber(v.totalMs) || v.totalMs < 0) continue;
        if (!isFiniteNumber(v.sessionCount) || v.sessionCount < 0) continue;
        dailyTotals[key] = { totalMs: v.totalMs, sessionCount: Math.floor(v.sessionCount) };
    }
    return dailyTotals;
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

    const data: WorkspaceTimingData = {
        version: LATEST_VERSION,
        totalMs: raw.totalMs as number,
        currentSessionStartMs: 0, // 还原后一律从干净状态重新开始
        lastSavedAtMs: Date.now(),
        isEnabled: raw.isEnabled !== false,
        sessions,
        ...(dailyTotals ? { dailyTotals } : {}),
    };

    return { ok: true, data };
}

/** 计时数据校验器接口契约 */
export interface DataValidator {
    validateTimingData: typeof validateTimingData;
}

