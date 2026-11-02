/**
 * Module: timer-engine-helpers — Pure Domain Helpers for TimerEngine
 * File Path: src/domain/timer-engine-helpers.ts
 * Architecture Role: Domain layer stateless calculation and data freeze helpers
 * Dependencies & Triggers: models.ts; consumed by TimerEngine
 * Responsibilities: Summation of idle totals, partition of session overlap, and immutability guards for timing data
 * Exit Semantics & Design Rationale: Pure TypeScript functions with zero side effects; eliminates large-file bloat in TimerEngine
 * Contract Invariant & Boundary: Pure mathematical transforms; partitionSessionOverlap strictly preserves overlap = ai + manual.
 */

import {
    type WorkspaceTimingData,
    type TimeSession,
    type IdleSession,
    MS_PER_DAY,
} from './models';

export function sumIdleSessions(idleSessions?: readonly { durationMs: number }[]): number {
    if (!idleSessions) return 0;
    let sum = 0;
    for (let i = 0; i < idleSessions.length; i++) {
        sum += idleSessions[i].durationMs;
    }
    return sum;
}

export function sumDailyIdleTotals(dailyTotals?: Record<string, { idleTotalMs?: number }>): number {
    if (!dailyTotals) return 0;
    let sum = 0;
    const keys = Object.keys(dailyTotals);
    for (let i = 0; i < keys.length; i++) {
        sum += dailyTotals[keys[i]].idleTotalMs ?? 0;
    }
    return sum;
}

/** 初始化空闲历史总时长（O(1) 状态栏常驻前置计算） */
export function computeInitialIdleTotal(data: WorkspaceTimingData): number {
    if (typeof data.idleTotalMs === 'number' && Number.isFinite(data.idleTotalMs) && data.idleTotalMs >= 0) {
        return data.idleTotalMs;
    }
    return sumIdleSessions(data.idleSessions) + sumDailyIdleTotals(data.dailyTotals);
}

/** 提取日桶预聚合统计（纯函数） */
export function extractBucketTotals(bucket?: { totalMs?: number; manualMs?: number; aiMs?: number; idleTotalMs?: number }): {
    total: number;
    manual: number;
    ai: number;
    idle: number;
} {
    if (!bucket) {
        return { total: 0, manual: 0, ai: 0, idle: 0 };
    }
    return {
        total: bucket.totalMs ?? 0,
        manual: bucket.manualMs ?? (bucket.totalMs ?? 0),
        ai: bucket.aiMs ?? 0,
        idle: bucket.idleTotalMs ?? 0,
    };
}

/** 计算单个会话与今日区间的模式分摊（纯函数） */
export function partitionSessionOverlap(
    s: TimeSession,
    overlap: number,
): { manual: number; ai: number } {
    const dur = s.durationMs > 0 ? s.durationMs : (s.endMs - s.startMs);
    const aiMs = s.aiMs;
    if (dur > 0 && typeof aiMs === 'number' && typeof s.manualMs === 'number') {
        const aiPart = Math.round(overlap * (aiMs / dur));
        return {
            ai: aiPart,
            manual: overlap - aiPart,
        };
    }
    return {
        ai: 0,
        manual: overlap,
    };
}

/** 合并已折叠日桶指标与原始会话指标（防时间膨胀不变量） */
export function canMergeBucketMetric(initialTotal: number, rawTotal: number): boolean {
    if (initialTotal <= 0) return false;
    if (rawTotal === 0) return true;
    return initialTotal !== rawTotal && rawTotal + initialTotal <= MS_PER_DAY;
}

export function frozenSessions(sessions: readonly TimeSession[]): TimeSession[] {
    return Object.freeze([...sessions]) as TimeSession[];
}

export function frozenIdleSessions(idleSessions: readonly IdleSession[]): IdleSession[] {
    return Object.freeze([...idleSessions]) as IdleSession[];
}

export function withFrozenSessions(data: WorkspaceTimingData): WorkspaceTimingData {
    return {
        ...data,
        sessions: frozenSessions(data.sessions ?? []),
        idleSessions: frozenIdleSessions(data.idleSessions ?? []),
    };
}
