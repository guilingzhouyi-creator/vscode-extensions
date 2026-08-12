/**
 * ActivityTracker — 编辑活跃度追踪
 *
 * 职责：监听 onDidChangeTextDocument，统计每秒是否有编辑活动。
 *       心跳 (1s) 调用 tick() 消费累积标志，累加每日活跃秒数。
 * 边界：不持久化 — 仅会话内有效，重启归零。
 *
 * 效率 = 活跃时长 / 计时器时长
 */
export interface DailyActivitySnapshot {
    date: string;
    activeMs: number;
    totalMs: number;
    ratio: number;
}
export declare class ActivityTracker {
    /** dateStr → 活跃秒数 */
    private dailyActiveSeconds;
    private changedSinceLastBeat;
    private readonly disposables;
    /** 启动监听 */
    start(): void;
    /**
     * 心跳回调 — 每秒由 Scheduler 调用。
     * 消费 changedSinceLastBeat 标志，累加当日活跃秒数。
     */
    tick(): void;
    /** 获取指定日期的活跃时长 (ms) */
    getDailyActiveMs(dateStr: string): number;
    /** 获取最近 7 天的活跃快照（由外部填充 totalMs） */
    getSnapshot(dailyTotalMs: Map<string, number>): DailyActivitySnapshot[];
    /** 停止监听 */
    stop(): void;
}
