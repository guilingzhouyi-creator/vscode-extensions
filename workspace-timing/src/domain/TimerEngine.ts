/**
 * Module: TimerEngine — Core Timing Engine with Dual-Track and Idle Session Support
 * File Path: src/domain/TimerEngine.ts
 * Architecture Role: Domain layer timing state machine and duration calculation core
 * Dependencies & Triggers: domain/models.ts, domain/TimeAggregator.ts; triggered by SessionManager / Scheduler
 * Responsibilities: Track active durations across manual/ai activity modes, manage idle pause and retroactive resume, calculate O(1) today metrics
 * Exit Semantics & Design Rationale: Pure TypeScript domain entity with zero VS Code / I/O dependencies; maintains mathematical conservation law totalMs = manualTotalMs + aiTotalMs.
 * Contract Invariant & Boundary: Conservation of Duration — totalMs === manualTotalMs + aiTotalMs; todayOverlap algorithm strictly bounded to [0, MS_PER_DAY]; idle transition preserves atomic continuity without dropping elapsed work seconds.
 */

import {
    WorkspaceTimingData,
    ReadonlyTimingData,
    IdleSession,
    ActivityMode,
    MS_PER_DAY,
    MS_PER_MINUTE,
    DEFAULT_IDLE_TIMEOUT_MINUTES,
    createEmptyTimingData,
} from './models';
import { localDateStr, parseLocalDate, splitByNaturalDay } from './TimeAggregator';
import {
    computeInitialIdleTotal,
    extractBucketTotals,
    partitionSessionOverlap,
    canMergeBucketMetric,
    frozenSessions,
    frozenIdleSessions,
    withFrozenSessions,
} from './timer-engine-helpers';

/** 模式常量（消除硬编码重复字面量） */
const MODE_MANUAL: ActivityMode = 'manual';
const MODE_AI: ActivityMode = 'ai';

/**
 * 契约模型：当前计时器状态快照 (TimerSnapshot)
 * 不变量契约：所有工时字段严格非负；currentTotalMs === totalMs + sessionElapsedMs 严格满足守恒律。
 */
export interface TimerSnapshot {
    totalMs: number;
    manualTotalMs: number;
    aiTotalMs: number;
    idleTotalMs: number;
    sessionElapsedMs: number;
    sessionManualMs: number;
    sessionAiMs: number;
    currentTotalMs: number;
    currentMode: ActivityMode;
}

export class TimerEngine {
    private _data: WorkspaceTimingData;
    private _sessionStartMs: number = 0;
    private _segmentStartMs: number = 0;
    private _sessionManualAccMs: number = 0;
    private _sessionAiAccMs: number = 0;
    private _running: boolean = false;
    private _pausedIdle: boolean = false;
    private _idleStartMs: number = 0;
    private _currentMode: ActivityMode = MODE_MANUAL;

    // ── 性能契约：今日累计增量计数器（O(1) 状态栏极速查询路径）──
    private _todayKey: string = '';
    private _todayEndedMs: number = 0;
    private _todayEndedManualMs: number = 0;
    private _todayEndedAiMs: number = 0;
    private _todayEndedIdleMs: number = 0;
    private _todayDirty: boolean = true;

    constructor(data?: WorkspaceTimingData) {
        this._data = data
            ? withFrozenSessions(data)
            : { ...createEmptyTimingData(), sessions: frozenSessions([]) };
        if (this._data.idleTotalMs === undefined) {
            this._data.idleTotalMs = computeInitialIdleTotal(this._data);
        }
        this._todayDirty = true;
    }

    /** 计数器当日零点（支持指定时区偏移） */
    private get todayStartMs(): number {
        return parseLocalDate(this._todayKey, this._data.utcOffsetMinutes);
    }

    /**
     * 算法契约：计算时间区间 [s, e) 与今日自然日窗口的物理重叠毫秒数 (O(1))
     * 边界契约：返回值严格在 [0, MS_PER_DAY] 闭区间内，无重叠时确定性返回 0。
     * @param s 区间起始时间戳
     * @param e 区间结束时间戳
     * @returns 重叠毫秒数不变量
     */
    private todayOverlap(s: number, e: number): number {
        const dayStart = this.todayStartMs;
        return Math.max(0, Math.min(e, dayStart + MS_PER_DAY) - Math.max(s, dayStart));
    }

    private computeRawTodayWork(): { total: number; manual: number; ai: number } {
        let total = 0;
        let manual = 0;
        let ai = 0;
        for (const s of this._data.sessions) {
            const overlap = this.todayOverlap(s.startMs, s.endMs);
            if (overlap <= 0) continue;
            total += overlap;
            const parts = partitionSessionOverlap(s, overlap);
            ai += parts.ai;
            manual += parts.manual;
        }
        return { total, manual, ai };
    }

    private computeRawTodayIdle(): number {
        let idle = 0;
        const idleSessions = this._data.idleSessions;
        if (idleSessions) {
            for (let i = 0; i < idleSessions.length; i++) {
                const is = idleSessions[i];
                const overlap = this.todayOverlap(is.startMs, is.endMs);
                if (overlap > 0) idle += overlap;
            }
        }
        return idle;
    }

    /** 惰性重算（日切或数据替换后每自然日/每替换至多一次 O(N)） */
    private recomputeTodayEnded(): void {
        const rawWork = this.computeRawTodayWork();
        const rawIdle = this.computeRawTodayIdle();
        const initial = extractBucketTotals(this._data.dailyTotals?.[this._todayKey]);

        const shouldMergeWork = canMergeBucketMetric(initial.total, rawWork.total);
        const shouldMergeIdle = canMergeBucketMetric(initial.idle, rawIdle);

        this._todayEndedMs = rawWork.total + (shouldMergeWork ? initial.total : 0);
        this._todayEndedManualMs = rawWork.manual + (shouldMergeWork ? initial.manual : 0);
        this._todayEndedAiMs = rawWork.ai + (shouldMergeWork ? initial.ai : 0);
        this._todayEndedIdleMs = rawIdle + (shouldMergeIdle ? initial.idle : 0);
    }

    /** 确保今日日键与增量计数器处于最新鲜状态 */
    private ensureTodayFresh(): void {
        const key = localDateStr(Date.now(), this._data.utcOffsetMinutes);
        if (key !== this._todayKey) {
            this._todayKey = key;
            this._todayDirty = true;
        }
        if (this._todayDirty) {
            this.recomputeTodayEnded();
            this._todayDirty = false;
        }
    }

    /** 计算当前未固化段的手动与 AI 累计 */
    private computeCurrentSegments(endTimeMs: number): { manual: number; ai: number } {
        const segElapsed = Math.max(0, endTimeMs - this._segmentStartMs);
        return {
            manual: this._sessionManualAccMs + (this._currentMode === MODE_MANUAL ? segElapsed : 0),
            ai: this._sessionAiAccMs + (this._currentMode === MODE_AI ? segElapsed : 0),
        };
    }

    /** 重置/设置会话内部指针 */
    private resetSessionPointers(startMs: number): void {
        this._sessionStartMs = startMs;
        this._segmentStartMs = startMs;
        this._sessionManualAccMs = 0;
        this._sessionAiAccMs = 0;
        this._data.currentSessionStartMs = startMs;
        if (startMs > 0) this._data.lastSavedAtMs = startMs;
    }

    /** 今日已结束会话累计（增量维护） */
    getTodayEndedMs(): number {
        this.ensureTodayFresh();
        return this._todayEndedMs;
    }

    /** 今日全量指标快照（单次计算，避免心跳每秒重复计算与分配） */
    getTodayMetrics(now: number = Date.now()): {
        todayMs: number;
        todayManualMs: number;
        todayAiMs: number;
        todayIdleMs: number;
    } {
        this.ensureTodayFresh();
        const idleOverlap = (!this._pausedIdle || this._idleStartMs <= 0)
            ? 0
            : Math.max(0, now - Math.max(this._idleStartMs, this.todayStartMs));
        const todayIdleMs = this._todayEndedIdleMs + idleOverlap;

        if (!this._running || this._data.currentSessionStartMs <= 0) {
            return {
                todayMs: this._todayEndedMs,
                todayManualMs: this._todayEndedManualMs,
                todayAiMs: this._todayEndedAiMs,
                todayIdleMs,
            };
        }

        const overlap = Math.max(0, now - Math.max(this._data.currentSessionStartMs, this.todayStartMs));
        const todayMs = this._todayEndedMs + overlap;
        if (overlap <= 0) {
            return {
                todayMs,
                todayManualMs: this._todayEndedManualMs,
                todayAiMs: this._todayEndedAiMs,
                todayIdleMs,
            };
        }

        const segs = this.computeCurrentSegments(now);
        const total = Math.max(1, segs.manual + segs.ai);
        const todayManualMs = this._todayEndedManualMs + Math.round(overlap * (segs.manual / total));
        const todayAiMs = this._todayEndedAiMs + Math.round(overlap * (segs.ai / total));

        return {
            todayMs,
            todayManualMs,
            todayAiMs,
            todayIdleMs,
        };
    }

    /** 今日手动已结束与进行中累计 (O(1)) */
    getTodayManualMs(): number {
        return this.getTodayMetrics().todayManualMs;
    }

    /** 今日 AI 已结束与进行中累计 (O(1)) */
    getTodayAiMs(): number {
        return this.getTodayMetrics().todayAiMs;
    }

    /** 今日空闲累计 (O(1)) */
    getTodayIdleMs(): number {
        return this.getTodayMetrics().todayIdleMs;
    }

    /** 今日总计（O(1)）= 已结束会话今日累计 + 进行中会话今日残段 */
    getTodayMs(): number {
        return this.getTodayMetrics().todayMs;
    }

    get data(): ReadonlyTimingData { return this._data; }
    get isRunning(): boolean { return this._running; }
    get isPausedIdle(): boolean { return this._pausedIdle; }
    get currentMode(): ActivityMode { return this._currentMode; }

    /** 切换当前模式 */
    switchMode(newMode: ActivityMode): void {
        if (this._currentMode === newMode) return;
        if (this._running) {
            const now = Date.now();
            const elapsed = Math.max(0, now - this._segmentStartMs);
            if (this._currentMode === MODE_AI) {
                this._sessionAiAccMs += elapsed;
            } else {
                this._sessionManualAccMs += elapsed;
            }
            this._segmentStartMs = now;
        }
        this._currentMode = newMode;
    }

    /** 开始计时 */
    start(): void {
        if (this._running) return;
        this._running = true;
        this._pausedIdle = false;
        this._idleStartMs = 0;
        this.resetSessionPointers(Date.now());
    }

    /** 停止计时并固化本次会话 */
    stop(): number {
        if (!this._running) {
            if (this._pausedIdle) {
                this._pausedIdle = false;
                this._idleStartMs = 0;
            }
            return 0;
        }
        this._running = false;
        this._pausedIdle = false;
        this._idleStartMs = 0;

        const now = Date.now();
        const totalSessionElapsed = Math.max(0, now - this._sessionStartMs);
        const segs = this.computeCurrentSegments(now);
        let finalManual = segs.manual;
        let finalAi = segs.ai;
        if (finalManual + finalAi !== totalSessionElapsed) {
            if (this._currentMode === MODE_AI) {
                finalAi = Math.max(0, totalSessionElapsed - this._sessionManualAccMs);
            } else {
                finalManual = Math.max(0, totalSessionElapsed - this._sessionAiAccMs);
            }
        }

        this._data.totalMs += totalSessionElapsed;
        this._data.manualTotalMs = (this._data.manualTotalMs ?? 0) + finalManual;
        this._data.aiTotalMs = (this._data.aiTotalMs ?? 0) + finalAi;
        this._data.currentSessionStartMs = 0;
        this._data.lastSavedAtMs = now;

        this.ensureTodayFresh();
        const overlap = this.todayOverlap(this._sessionStartMs, now);
        if (overlap > 0 && totalSessionElapsed > 0) {
            const aiOverlap = Math.round(overlap * (finalAi / totalSessionElapsed));
            this._todayEndedAiMs += aiOverlap;
            this._todayEndedManualMs += (overlap - aiOverlap);
            this._todayEndedMs += overlap;
        } else if (overlap > 0) {
            this._todayEndedManualMs += overlap;
            this._todayEndedMs += overlap;
        }
        this._data.sessions = frozenSessions([
            ...this._data.sessions,
            {
                startMs: this._sessionStartMs,
                endMs: now,
                durationMs: totalSessionElapsed,
                manualMs: finalManual,
                aiMs: finalAi,
            },
        ]);
        return totalSessionElapsed;
    }

    /** 空闲追溯暂停：截断当前进行中的会话至 idleStartMs 并固化 */
    pauseForIdle(idleStartMs: number): number {
        if (!this._running) return 0;
        this._running = false;
        this._pausedIdle = true;
        this._idleStartMs = idleStartMs;

        const effectiveEnd = Math.max(this._sessionStartMs, idleStartMs);
        const elapsed = Math.max(0, effectiveEnd - this._sessionStartMs);

        let finalManual = 0;
        let finalAi = 0;
        if (effectiveEnd >= this._segmentStartMs) {
            const segs = this.computeCurrentSegments(effectiveEnd);
            finalManual = segs.manual;
            finalAi = segs.ai;
        } else {
            const currentElapsed = Math.max(1, this._sessionManualAccMs + this._sessionAiAccMs);
            finalManual = Math.round(elapsed * (this._sessionManualAccMs / currentElapsed));
            finalAi = elapsed - finalManual;
        }

        this._data.totalMs += elapsed;
        this._data.manualTotalMs = (this._data.manualTotalMs ?? 0) + finalManual;
        this._data.aiTotalMs = (this._data.aiTotalMs ?? 0) + finalAi;
        this._data.currentSessionStartMs = 0;
        this._data.lastSavedAtMs = effectiveEnd;

        this.ensureTodayFresh();
        if (elapsed > 0) {
            const overlap = this.todayOverlap(this._sessionStartMs, effectiveEnd);
            if (overlap > 0) {
                const aiOverlap = Math.round(overlap * (finalAi / elapsed));
                this._todayEndedAiMs += aiOverlap;
                this._todayEndedManualMs += (overlap - aiOverlap);
                this._todayEndedMs += overlap;
            }
            this._data.sessions = frozenSessions([
                ...this._data.sessions,
                {
                    startMs: this._sessionStartMs,
                    endMs: effectiveEnd,
                    durationMs: elapsed,
                    manualMs: finalManual,
                    aiMs: finalAi,
                },
            ]);
        }

        this.resetSessionPointers(0);
        return elapsed;
    }

    /** 记录单次空闲离开会话并更新累计与今日指标 */
    private recordIdleSession(startMs: number, endMs: number, durationMs: number): void {
        const idleEntry: IdleSession = {
            startMs,
            endMs,
            durationMs,
            reason: 'idle_timeout',
        };
        this._data.idleSessions = frozenIdleSessions([
            ...(this._data.idleSessions ?? []),
            idleEntry,
        ]);
        this._data.idleTotalMs = (this._data.idleTotalMs ?? 0) + durationMs;
        this._todayEndedIdleMs += this.todayOverlap(startMs, endMs);
    }

    /** 空闲唤醒恢复：记录离开区间至 idleSessions 并开启新会话 */
    resumeFromIdle(resumeMs: number, idleStartMs: number = 0): number {
        const rawStart = idleStartMs || this._idleStartMs;
        const effectiveStart = rawStart > 0 ? rawStart : resumeMs;
        const effectiveEnd = Math.max(effectiveStart, resumeMs);
        const idleDuration = effectiveEnd - effectiveStart;

        this.ensureTodayFresh();
        if (idleDuration > 0) {
            this.recordIdleSession(effectiveStart, effectiveEnd, idleDuration);
        }

        this._pausedIdle = false;
        this._idleStartMs = 0;
        this._running = true;
        this.resetSessionPointers(effectiveEnd);
        return idleDuration;
    }

    /**
     * 架构契约：对当前运行中的手动工时段进行有界追溯纠偏
     * 守恒契约：重分类时长严格在 [0, maxLookbackMs] 内，且不超过当前段历时与当日零点边界；
     * 会话总历时 sessionElapsedMs 严格守恒，仅在 manual 与 ai 累计量之间发生原子转移。
     */
    private reclassifyRunningSegmentToAi(now: number, maxLookbackMs: number): number {
        if (this._currentMode === MODE_AI) {
            return 0;
        }
        const lookbackLimit = Math.max(0, maxLookbackMs);
        const minPossibleStart = Math.max(this._segmentStartMs, this.todayStartMs);
        const lookbackStart = Math.max(minPossibleStart, now - lookbackLimit);
        const reclassifiedMs = Math.max(0, now - lookbackStart);
        const retainedManualMs = Math.max(0, lookbackStart - this._segmentStartMs);

        this._sessionManualAccMs += retainedManualMs;
        this._sessionAiAccMs += reclassifiedMs;
        this._segmentStartMs = now;
        this._currentMode = MODE_AI;

        return reclassifiedMs;
    }

    /**
     * 架构契约：对空闲超时暂停态进行有界复活纠偏
     * 守恒契约：总历时 D_idle 严格拆解为 [真实空闲 idleSession] + [复活 AI 会话]；
     * 复活时长严格受控在 maxLookbackMs 与当日零点闭界内，超出部分确定性作为 idleSession 固化落盘。
     */
    private reviveIdleSegmentToAi(now: number, maxLookbackMs: number): number {
        const idleDuration = Math.max(0, now - this._idleStartMs);
        const lookbackLimit = Math.max(0, maxLookbackMs);
        const todayLimit = Math.max(0, now - this.todayStartMs);
        const candidateRevive = Math.min(idleDuration, lookbackLimit, todayLimit);
        const revivedStartMs = now - candidateRevive;
        const trueIdleDuration = Math.max(0, revivedStartMs - this._idleStartMs);

        this.ensureTodayFresh();

        if (trueIdleDuration > 0) {
            this.recordIdleSession(this._idleStartMs, revivedStartMs, trueIdleDuration);
        }

        this._pausedIdle = false;
        this._idleStartMs = 0;
        this._running = true;
        this._sessionStartMs = revivedStartMs;
        this._segmentStartMs = now;
        this._sessionManualAccMs = 0;
        this._sessionAiAccMs = candidateRevive;
        this._currentMode = MODE_AI;
        this._data.currentSessionStartMs = revivedStartMs;
        this._data.lastSavedAtMs = now;

        return candidateRevive;
    }

    /**
     * 架构契约：有界追溯纠偏与空闲复活统一入口 (reclassifyOrReviveToAi)
     * 职责：当接收到 Agent 突发变动时，纠偏此前静默思考时间，防止误计为 manual 或被 idle 截断丢弃。
     */
    reclassifyOrReviveToAi(
        burstTimeMs?: number,
        maxLookbackMs: number = DEFAULT_IDLE_TIMEOUT_MINUTES * MS_PER_MINUTE,
    ): { reclassifiedMs: number; revivedIdleMs: number } {
        this.ensureTodayFresh();
        const now = burstTimeMs ?? Date.now();
        if (this._running) {
            const reclassifiedMs = this.reclassifyRunningSegmentToAi(now, maxLookbackMs);
            return { reclassifiedMs, revivedIdleMs: 0 };
        }
        if (this._pausedIdle) {
            const revivedIdleMs = this.reviveIdleSegmentToAi(now, maxLookbackMs);
            return { reclassifiedMs: 0, revivedIdleMs };
        }
        return { reclassifiedMs: 0, revivedIdleMs: 0 };
    }

    /** 跨午夜自然日会话切分与轮转 */
    rotateSession(boundaryMs: number): number {
        if (!this._running) return 0;
        this.ensureTodayFresh();

        const elapsed = Math.max(0, boundaryMs - this._sessionStartMs);
        this._data.totalMs += elapsed;

        if (elapsed > 0) {
            const segs = this.computeCurrentSegments(boundaryMs);
            const manualSeg = segs.manual === 0 && segs.ai === 0 ? elapsed : segs.manual;
            const aiSeg = segs.ai;
            this._data.manualTotalMs = (this._data.manualTotalMs ?? 0) + manualSeg;
            this._data.aiTotalMs = (this._data.aiTotalMs ?? 0) + aiSeg;

            this._data.sessions = frozenSessions([
                ...this._data.sessions,
                {
                    startMs: this._sessionStartMs,
                    endMs: boundaryMs,
                    durationMs: elapsed,
                    manualMs: manualSeg,
                    aiMs: aiSeg,
                },
            ]);
            const overlap = this.todayOverlap(this._sessionStartMs, boundaryMs);
            if (overlap > 0) {
                const aiOverlap = Math.round(overlap * (aiSeg / elapsed));
                this._todayEndedAiMs += aiOverlap;
                this._todayEndedManualMs += overlap - aiOverlap;
                this._todayEndedMs += overlap;
            }
        }

        this.resetSessionPointers(boundaryMs);
        return elapsed;
    }

    /** 系统休眠/挂起恢复处理 */
    resumeFromSleep(sleepStartMs: number, resumeMs: number): number {
        if (!this._running) return 0;
        this.ensureTodayFresh();
        const sealedToday = this.todayOverlap(this._sessionStartMs, sleepStartMs);

        const elapsed = Math.max(0, sleepStartMs - this._sessionStartMs);
        this._data.totalMs += elapsed;

        if (elapsed > 0) {
            const segs = this.computeCurrentSegments(sleepStartMs);
            this._data.manualTotalMs = (this._data.manualTotalMs ?? 0) + segs.manual;
            this._data.aiTotalMs = (this._data.aiTotalMs ?? 0) + segs.ai;

            const split = splitByNaturalDay(this._sessionStartMs, sleepStartMs, segs.manual, segs.ai, this._data.utcOffsetMinutes);
            const segmentedSessions = split.length > 0
                ? split
                : [{ startMs: this._sessionStartMs, endMs: sleepStartMs, durationMs: elapsed, manualMs: segs.manual, aiMs: segs.ai }];
            this._data.sessions = frozenSessions([
                ...this._data.sessions,
                ...segmentedSessions,
            ]);
            if (sealedToday > 0) {
                const aiOverlap = Math.round(sealedToday * (segs.ai / elapsed));
                this._todayEndedAiMs += aiOverlap;
                this._todayEndedManualMs += sealedToday - aiOverlap;
                this._todayEndedMs += sealedToday;
            }
        }

        this.resetSessionPointers(resumeMs);
        return elapsed;
    }

    /** 获取当前快照（不停止计时，O(1) 状态读取，消除循环分配） */
    snapshot(): TimerSnapshot {
        let sessionManual = 0;
        let sessionAi = 0;
        if (this._running) {
            const segs = this.computeCurrentSegments(Date.now());
            sessionManual = segs.manual;
            sessionAi = segs.ai;
        }
        const sessionElapsed = sessionManual + sessionAi;
        const runningIdle = (this._pausedIdle && this._idleStartMs > 0)
            ? Math.max(0, Date.now() - this._idleStartMs)
            : 0;
        const idleTotal = (this._data.idleTotalMs ?? 0) + runningIdle;

        return {
            totalMs: this._data.totalMs,
            manualTotalMs: (this._data.manualTotalMs ?? 0) + sessionManual,
            aiTotalMs: (this._data.aiTotalMs ?? 0) + sessionAi,
            idleTotalMs: idleTotal,
            sessionElapsedMs: sessionElapsed,
            sessionManualMs: sessionManual,
            sessionAiMs: sessionAi,
            currentTotalMs: this._data.totalMs + sessionElapsed,
            currentMode: this._currentMode,
        };
    }

    /** 替换内部数据（用于崩溃恢复后加载）；sessions 经冻结副本标准化 */
    replaceData(data: WorkspaceTimingData): void {
        const frozen = withFrozenSessions(data);
        if (frozen.idleTotalMs === undefined) {
            frozen.idleTotalMs = computeInitialIdleTotal(frozen);
        }
        this._data = frozen;
        this._todayDirty = true;
    }

    /** 动态刷新时区偏置与当日键（跨时区环境感知） */
    updateTimezone(timezone?: string, utcOffsetMinutes?: number): void {
        if (timezone !== undefined) this._data.timezone = timezone;
        if (utcOffsetMinutes !== undefined) this._data.utcOffsetMinutes = utcOffsetMinutes;
        this._todayDirty = true;
        this.ensureTodayFresh();
    }

    /** 重置所有计时数据 */
    reset(): void {
        this._data = { ...createEmptyTimingData(), sessions: frozenSessions([]) };
        this.resetSessionPointers(0);
        this._running = false;
        this._pausedIdle = false;
        this._idleStartMs = 0;
        this._data.idleTotalMs = 0;
        this._todayEndedMs = 0;
        this._todayEndedManualMs = 0;
        this._todayEndedAiMs = 0;
        this._todayEndedIdleMs = 0;
        this._todayDirty = false;
        this._todayKey = localDateStr(Date.now(), this._data.utcOffsetMinutes);
    }
}
