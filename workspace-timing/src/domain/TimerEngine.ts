/**
 * TimerEngine — 计时核心
 *
 * 职责：start / stop / elapsed 计算
 * 边界：不关心存储、不关心 UI、不关心禁用策略
 * 依赖：仅依赖 models.ts
 */

import { WorkspaceTimingData, ReadonlyTimingData, TimeSession, MS_PER_DAY, createEmptyTimingData } from './models';
import { localDateStr, parseLocalDate } from './TimeAggregator';

export interface TimerSnapshot {
    /** 当前累计总时长 (ms) */
    totalMs: number;
    /** 当前会话已持续时长 (ms) */
    sessionElapsedMs: number;
    /** 当前总时长（含本次会话） */
    currentTotalMs: number;
}

export class TimerEngine {
    private _data: WorkspaceTimingData;
    private _sessionStartMs: number = 0;
    private _running: boolean = false;

    // ── 今日累计增量计数器（O(1) 状态栏路径）──
    /** 计数器归属的本地日键（YYYY-MM-DD） */
    private _todayKey: string = '';
    /** 今日已结束会话的累计（不含进行中会话残段） */
    private _todayEndedMs: number = 0;
    /** 数据被整体替换（恢复/还原/折叠）后需惰性重算一次 */
    private _todayDirty: boolean = true;

    constructor(data?: WorkspaceTimingData) {
        this._data = data
            ? TimerEngine.withFrozenSessions(data)
            : { ...createEmptyTimingData(), sessions: TimerEngine.frozenSessions([]) };
        this._todayDirty = true;
    }

    /** 计数器当日零点（本地时区） */
    private get todayStartMs(): number {
        return parseLocalDate(this._todayKey);
    }

    /** O(1)：区间 [s,e) 与「今日」的重叠毫秒 */
    private todayOverlap(s: number, e: number): number {
        const dayStart = this.todayStartMs;
        return Math.max(0, Math.min(e, dayStart + MS_PER_DAY) - Math.max(s, dayStart));
    }

    /** 惰性重算（日切或数据替换后每自然日/每替换至多一次 O(N)，其余时刻不再发生） */
    private recomputeTodayEnded(): void {
        const dayStart = this.todayStartMs;
        const dayEnd = dayStart + MS_PER_DAY;
        let total = 0;
        for (const s of this._data.sessions) {
            if (s.endMs <= dayStart) continue;
            total += Math.max(0, Math.min(s.endMs, dayEnd) - Math.max(s.startMs, dayStart));
        }
        this._todayEndedMs = total;
    }

    /**
     * 今日已结束会话累计（增量维护）：
     * 会话封存事件 O(1) 叠加今日段；数据替换/日切时惰性重算一次。
     */
    getTodayEndedMs(): number {
        const key = localDateStr(Date.now());
        if (key !== this._todayKey) {
            this._todayKey = key;
            this._todayDirty = true;
        }
        if (this._todayDirty) {
            this.recomputeTodayEnded();
            this._todayDirty = false;
        }
        return this._todayEndedMs;
    }

    /**
     * 今日总计（O(1)）= 已结束会话今日累计 + 进行中会话今日残段。
     * 状态栏每秒读取的热点路径——替代原 O(N) 扫描 + 3s TTL 缓存方案。
     */
    getTodayMs(): number {
        const ended = this.getTodayEndedMs();
        let running = 0;
        if (this._running && this._data.currentSessionStartMs > 0) {
            running = Math.max(0, Date.now() - Math.max(this._data.currentSessionStartMs, this.todayStartMs));
        }
        return ended + running;
    }

    /**
     * 冻结 sessions 数组副本：对外只读视图的运行期兜底。
     * 内部一律以「替换新数组」而非「原地 push」演进（仅会话边界事件触发，
     * 非每秒热点），外部对 getter 视图的 push/splice 在编译期（ReadonlyArray）
     * 与运行期（Object.freeze）双重被拒。
     */
    private static frozenSessions(sessions: readonly TimeSession[]): TimeSession[] {
        return Object.freeze([...sessions]) as TimeSession[];
    }

    /** 以冻结 sessions 副本标准化外部传入数据 */
    private static withFrozenSessions(data: WorkspaceTimingData): WorkspaceTimingData {
        return { ...data, sessions: TimerEngine.frozenSessions(data.sessions) };
    }

    /**
     * 获取内部数据（只读快照）。
     * sessions 冻结为 ReadonlyArray——外部 push/splice 等突变在编译期即被拒绝，
     * 写路径只能经 start/stop/rotateSession/resumeFromSleep/replaceData 受控接口。
     */
    get data(): ReadonlyTimingData {
        return this._data;
    }

    /** 是否正在运行 */
    get isRunning(): boolean {
        return this._running;
    }

    /** 开始计时 */
    start(): void {
        if (this._running) return;
        this._running = true;
        this._sessionStartMs = Date.now();
        this._data.currentSessionStartMs = this._sessionStartMs;
    }

    /** 停止计时，返回本次会话历时 (ms) */
    stop(): number {
        if (!this._running) return 0;
        this._running = false;

        const now = Date.now();
        // 时钟回拨防御：elapsed 不允许为负（否则 totalMs 会被扣减、sessions 出现负时长）
        const elapsed = Math.max(0, now - this._sessionStartMs);

        // 累加到 total
        this._data.totalMs += elapsed;
        this._data.currentSessionStartMs = 0;
        this._data.lastSavedAtMs = now;

        // 记录会话（替换式演进，保持对外视图冻结语义）；今日计数器 O(1) 叠加本次会话的今日段
        this.getTodayEndedMs();
        this._todayEndedMs += this.todayOverlap(this._sessionStartMs, now);
        this._data.sessions = TimerEngine.frozenSessions([
            ...this._data.sessions,
            { startMs: this._sessionStartMs, endMs: now, durationMs: elapsed },
        ]);

        return elapsed;
    }

    /**
     * 跨午夜自然日会话切分与轮转：
     * 将当前运行中会话截至 boundaryMs（昨日 23:59:59.999/次日零点）封存入 sessions[] 并累加 totalMs，
     * 同时无缝开启从 boundaryMs 起算的新会话段。
     * @returns 封存的昨日会话段时长 (ms)
     */
    rotateSession(boundaryMs: number): number {
        if (!this._running) return 0;
        void this.getTodayEndedMs(); // 刷新当日键（新密封段属昨日，今日段自然归零）

        const elapsed = Math.max(0, boundaryMs - this._sessionStartMs);
        this._data.totalMs += elapsed;

        if (elapsed > 0) {
            this._data.sessions = TimerEngine.frozenSessions([
                ...this._data.sessions,
                { startMs: this._sessionStartMs, endMs: boundaryMs, durationMs: elapsed },
            ]);
            // 密封段的今日部分计入计数器（真实跨日场景 overlap=0，同日 rotate 场景=密封时长）
            this._todayEndedMs += this.todayOverlap(this._sessionStartMs, boundaryMs);
        }

        this._sessionStartMs = boundaryMs;
        this._data.currentSessionStartMs = boundaryMs;
        this._data.lastSavedAtMs = boundaryMs;

        return elapsed;
    }

    /**
     * 系统休眠/挂起恢复处理：
     * 将休眠前的会话段封存截至 sleepStartMs，休眠时间不计入时长，
     * 并在唤醒时刻 resumeMs 重新开启活跃会话段。
     * @returns 封存的休眠前会话段时长 (ms)
     */
    resumeFromSleep(sleepStartMs: number, resumeMs: number): number {
        if (!this._running) return 0;
        this.getTodayEndedMs(); // 刷新当日键（休眠跨日场景）
        const sealedToday = this.todayOverlap(this._sessionStartMs, sleepStartMs);

        const elapsed = Math.max(0, sleepStartMs - this._sessionStartMs);
        this._data.totalMs += elapsed;

        if (elapsed > 0) {
            this._data.sessions = TimerEngine.frozenSessions([
                ...this._data.sessions,
                { startMs: this._sessionStartMs, endMs: sleepStartMs, durationMs: elapsed },
            ]);
            this._todayEndedMs += sealedToday;
        }

        this._sessionStartMs = resumeMs;
        this._data.currentSessionStartMs = resumeMs;
        this._data.lastSavedAtMs = resumeMs;

        return elapsed;
    }

    /** 获取当前快照（不停止计时） */
    snapshot(): TimerSnapshot {
        // 时钟回拨防御：进行中会话历时不为负
        const sessionElapsed = this._running
            ? Math.max(0, Date.now() - this._sessionStartMs)
            : 0;

        return {
            totalMs: this._data.totalMs,
            sessionElapsedMs: sessionElapsed,
            currentTotalMs: this._data.totalMs + sessionElapsed,
        };
    }

    /** 替换内部数据（用于崩溃恢复后加载）；sessions 经冻结副本标准化 */
    replaceData(data: WorkspaceTimingData): void {
        this._data = TimerEngine.withFrozenSessions(data);
        this._todayDirty = true;
    }

    /** 重置所有计时数据 */
    reset(): void {
        this._data = { ...createEmptyTimingData(), sessions: TimerEngine.frozenSessions([]) };
        this._sessionStartMs = 0;
        this._running = false;
        this._todayEndedMs = 0;
        this._todayDirty = false;
        this._todayKey = localDateStr(Date.now());
    }
}
