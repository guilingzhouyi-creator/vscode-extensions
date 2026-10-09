/**
 * Module: Data Validator (持久化数据深度校验与净化器)
 * File Path: src/persistence/DataValidator.ts
 * Architecture Role: 持久化层输入防护与反腐化层（ACL），在备份还原与外部导入时实施严格类型与数值守卫。
 * Dependencies & Triggers: 依赖 domain/models 核心模型与版本常量；在从外部文件或备份恢复计时数据时触发执行。
 * Responsibilities: 顶层结构完整性检查；会话条目时长守恒约束修复与排序；历史折叠日桶规范化；双轨时长配比合规性裁决。
 * Exit Semantics & Design Rationale: 纯函数设计，只读阻断异常数据；自动修复与净化向前兼容 v3 模式，确保流入持久层的数据结构绝对可信。
 */

import {
    WorkspaceTimingData,
    LATEST_VERSION,
    DailyTotalsMap,
    DailyTotal,
    TimeSession,
    IdleSession,
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

function sanitizeManualAndAi(manualMs: unknown, aiMs: unknown, cleanDuration: number): { manual: number; ai: number } {
    if (!isFiniteNumber(manualMs) || !isFiniteNumber(aiMs) || manualMs < 0 || aiMs < 0) {
        return { manual: cleanDuration, ai: 0 };
    }
    if (manualMs + aiMs === cleanDuration) {
        return { manual: manualMs, ai: aiMs };
    }
    const cleanManual = Math.min(cleanDuration, manualMs);
    return { manual: cleanManual, ai: cleanDuration - cleanManual };
}

function sanitizeSessionEntry(s: unknown): TimeSession | null {
    if (!isRecord(s)) return null;
    const { startMs, endMs, durationMs, manualMs, aiMs } = s;
    if (!isFiniteNumber(startMs) || !isFiniteNumber(endMs)) return null;
    if (startMs <= 0 || endMs < startMs) return null;

    // 强制保障时长守恒数学不变量：durationMs 严格等于 endMs - startMs
    const cleanDuration = isFiniteNumber(durationMs) && durationMs >= 0
        ? Math.min(durationMs, endMs - startMs)
        : endMs - startMs;

    const { manual: cleanManual, ai: cleanAi } = sanitizeManualAndAi(manualMs, aiMs, cleanDuration);

    return {
        startMs,
        endMs,
        durationMs: cleanDuration,
        manualMs: cleanManual,
        aiMs: cleanAi,
    };
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

function sanitizeIdleEntry(item: unknown): IdleSession | null {
    if (!isRecord(item)) return null;
    const { startMs, endMs, durationMs, reason } = item;
    if (!isFiniteNumber(startMs) || !isFiniteNumber(endMs)) return null;
    if (startMs <= 0 || endMs < startMs) return null;
    const cleanDur = isFiniteNumber(durationMs) && durationMs >= 0
        ? Math.min(durationMs, endMs - startMs)
        : endMs - startMs;
    return {
        startMs,
        endMs,
        durationMs: cleanDur,
        reason: typeof reason === 'string' ? reason : undefined,
    };
}

function sanitizeIdleSessions(raw: unknown): IdleSession[] {
    if (!Array.isArray(raw)) return [];
    const list: IdleSession[] = [];
    for (const item of raw) {
        const clean = sanitizeIdleEntry(item);
        if (clean) {
            list.push(clean);
        }
    }
    list.sort((a, b) => a.startMs - b.startMs);
    return list;
}

function getNonNegativeNumber(v: unknown): number | undefined {
    return isFiniteNumber(v) && v >= 0 ? v : undefined;
}

function sanitizeDailyEntry(v: unknown): DailyTotal | null {
    if (!isRecord(v)) return null;
    const totalMs = getNonNegativeNumber(v.totalMs);
    const sessionCount = getNonNegativeNumber(v.sessionCount);
    if (totalMs === undefined || sessionCount === undefined) return null;

    const entry: DailyTotal = {
        totalMs: Math.min(totalMs, MS_PER_DAY),
        sessionCount: Math.floor(sessionCount),
    };
    const manualMs = getNonNegativeNumber(v.manualMs);
    if (manualMs !== undefined) entry.manualMs = manualMs;
    const aiMs = getNonNegativeNumber(v.aiMs);
    if (aiMs !== undefined) entry.aiMs = aiMs;
    const idleTotalMs = getNonNegativeNumber(v.idleTotalMs);
    if (idleTotalMs !== undefined) entry.idleTotalMs = idleTotalMs;
    const idleCount = getNonNegativeNumber(v.idleSessionCount);
    if (idleCount !== undefined) entry.idleSessionCount = Math.floor(idleCount);
    return entry;
}

function sanitizeDailyTotals(rawTotals: unknown): DailyTotalsMap | undefined {
    if (!isRecord(rawTotals)) {
        return undefined;
    }
    const dailyTotals: DailyTotalsMap = {};
    for (const [key, v] of Object.entries(rawTotals)) {
        if (!ISO_DATE_PATTERN.test(key)) {
            continue;
        }
        const entry = sanitizeDailyEntry(v);
        if (entry) {
            dailyTotals[key] = entry;
        }
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

function resolveTotalsDistribution(
    totalMs: number,
    rawManual: unknown,
    rawAi: unknown,
): { manualTotalMs: number; aiTotalMs: number } {
    const manualTotal = isFiniteNumber(rawManual) && rawManual >= 0
        ? rawManual
        : totalMs;
    const aiTotal = isFiniteNumber(rawAi) && rawAi >= 0
        ? rawAi
        : 0;

    if (manualTotal + aiTotal === totalMs) {
        return { manualTotalMs: manualTotal, aiTotalMs: aiTotal };
    }
    return { manualTotalMs: totalMs, aiTotalMs: 0 };
}

function resolveIdleTotalMs(rawIdleTotal: unknown): number | undefined {
    return isFiniteNumber(rawIdleTotal) && rawIdleTotal >= 0 ? rawIdleTotal : undefined;
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
    const idleSessions = sanitizeIdleSessions(raw.idleSessions);
    const dailyTotals = sanitizeDailyTotals(raw.dailyTotals);
    const metadata = sanitizeMetadata(raw.metadata);

    const totalMs = raw.totalMs as number;
    const { manualTotalMs, aiTotalMs } = resolveTotalsDistribution(totalMs, raw.manualTotalMs, raw.aiTotalMs);
    const idleTotalMs = resolveIdleTotalMs(raw.idleTotalMs);

    const data: WorkspaceTimingData = {
        version: LATEST_VERSION,
        totalMs,
        manualTotalMs,
        aiTotalMs,
        ...(idleTotalMs !== undefined ? { idleTotalMs } : {}),
        currentSessionStartMs: 0, // 还原后一律从干净状态重新开始
        lastSavedAtMs: Date.now(),
        isEnabled: raw.isEnabled !== false,
        sessions,
        idleSessions,
        ...(dailyTotals ? { dailyTotals } : {}),
        ...(metadata ? { metadata } : {}),
    };

    return { ok: true, data };
}
