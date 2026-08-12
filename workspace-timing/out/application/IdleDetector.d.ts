/**
 * IdleDetector — 闲置检测器
 *
 * 职责：判定用户是否离开 / 非活跃，输出每日闲置时长供效率计算。
 * 效率公式：实际打字 / (总时长 - 闲置时长)
 *
 * ★ 修复（0.3.2）：
 *   - 原实现中 lastActivityMs 被写入但从未读取（死代码），且闲置仅在
 *     「失焦 → 重新聚焦且超时」时才被判定，聚焦但长时间不操作（阅读、思考）
 *     不会被计入闲置，导致效率比虚高。
 *   - 现改为每秒心跳驱动的判定：聚焦态下距上次编辑活动超过阈值即判定为闲置
 *     （回溯到最后一次活动时刻起算），并在出现新活动时结束；失焦态沿用
 *     「失焦超时回溯」逻辑。两种路径口径一致，闲置统计更真实。
 */
export declare class IdleDetector {
    /** 累计闲置时长 (ms) — 按日统计 */
    private dailyIdleMs;
    /** 当前闲置段开始时间（回溯到非活跃起点），0 = 未闲置 */
    private idleStartMs;
    /** 失焦时刻，用于失焦态的超时判定；聚焦时为 0 */
    private focusLostAt;
    /** 最后一次编辑 / 聚焦活动时刻 */
    private lastActivityMs;
    /** 当前窗口是否聚焦 */
    private focused;
    /** 闲置超时阈值 (ms)，默认 5 分钟 */
    private readonly timeoutMs;
    private readonly disposables;
    constructor(timeoutMs?: number);
    /** 启动监听 */
    start(): void;
    /**
     * 心跳回调 — 每秒由 Scheduler 调用。
     * 依据最近活动时刻与聚焦状态判定闲置，使其对「聚焦但不操作」也生效。
     */
    tick(): void;
    /** 获取指定日期的闲置时长 (ms) */
    getDailyIdleMs(dateStr: string): number;
    /** 当前是否处于闲置状态 */
    get isIdle(): boolean;
    /** 停止监听 */
    stop(): void;
    private onFocusLost;
    private onFocusGained;
    private startIdlePeriod;
    private endIdlePeriod;
    private todayStr;
}
