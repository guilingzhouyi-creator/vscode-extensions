/**
 * DataValidator — 外部计时数据校验器
 *
 * 职责：还原（restore）前对不可信 JSON 做结构/数值校验与净化。
 * 边界：纯函数；**拒绝整体结构非法的文件，过滤条目级脏数据**——
 *       校验失败时绝不触碰现网数据。
 */

import { WorkspaceTimingData, LATEST_VERSION, DailyTotalsMap } from '../domain/models';

export interface ValidationResult {
    ok: boolean;
    /** ok=false 时的失败原因（面向用户的简短描述） */
    error?: string;
    /** 净化后的数据（ok=true 时可用） */
    data?: WorkspaceTimingData;
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

/** 校验并净化一份外部计时数据 */
export function validateTimingData(raw: unknown): ValidationResult {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { ok: false, error: 'not an object' };
    }
    const o = raw as Record<string, unknown>;

    // 版本：接受 >=1 的有限数（未知更高版本按最新语义尽力解析）
    if (!isFiniteNumber(o.version) || o.version < 1) {
        return { ok: false, error: 'invalid version' };
    }

    if (!isFiniteNumber(o.totalMs) || o.totalMs < 0) {
        return { ok: false, error: 'invalid totalMs' };
    }
    if (!isFiniteNumber(o.currentSessionStartMs) || o.currentSessionStartMs < 0) {
        return { ok: false, error: 'invalid currentSessionStartMs' };
    }
    if (!Array.isArray(o.sessions)) {
        return { ok: false, error: 'missing sessions' };
    }

    // 条目级净化：丢弃非法会话（负值/非有限/区间倒挂），不整体拒绝
    const sessions = [];
    for (const s of o.sessions as unknown[]) {
        if (typeof s !== 'object' || s === null) continue;
        const r = s as Record<string, unknown>;
        const { startMs, endMs, durationMs } = r as { startMs?: unknown; endMs?: unknown; durationMs?: unknown };
        if (!isFiniteNumber(startMs) || !isFiniteNumber(endMs) || !isFiniteNumber(durationMs)) continue;
        if (startMs <= 0 || endMs < startMs || durationMs < 0) continue;
        sessions.push({ startMs, endMs, durationMs });
    }

    // 日桶校验：非对象忽略；单桶非法值跳过该桶
    let dailyTotals: DailyTotalsMap | undefined;
    if (typeof o.dailyTotals === 'object' && o.dailyTotals !== null && !Array.isArray(o.dailyTotals)) {
        dailyTotals = {};
        for (const [key, v] of Object.entries(o.dailyTotals as Record<string, unknown>)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || typeof v !== 'object' || v === null) continue;
            const b = v as Record<string, unknown>;
            if (!isFiniteNumber(b.totalMs) || b.totalMs < 0) continue;
            if (!isFiniteNumber(b.sessionCount) || b.sessionCount < 0) continue;
            dailyTotals[key] = { totalMs: b.totalMs, sessionCount: Math.floor(b.sessionCount) };
        }
    }

    const data: WorkspaceTimingData = {
        version: LATEST_VERSION,
        totalMs: o.totalMs,
        currentSessionStartMs: 0, // 还原后一律从干净状态重新开始
        lastSavedAtMs: Date.now(),
        isEnabled: o.isEnabled !== false,
        sessions,
        ...(dailyTotals ? { dailyTotals } : {}),
    };

    return { ok: true, data };
}
