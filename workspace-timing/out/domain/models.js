"use strict";
/**
 * WorkspaceTiming — Domain 层数据模型
 *
 * 所有时间单位统一为毫秒 (ms)。
 * 时间戳使用 Date.now() (UTC 毫秒)。
 * 零外部依赖。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = exports.CRASH_COMPENSATION_CAP_MS = exports.DEFAULT_DAILY_GOAL_MS = exports.DEFAULT_IDLE_TIMEOUT_MS = exports.DEFAULT_MAX_SESSIONS = exports.DEFAULT_RING_BUFFER_CAP = exports.DEFAULT_FULL_SAVE_MS = exports.DEFAULT_JOURNAL_FLUSH_MS = exports.DEFAULT_STATUS_BAR_MS = exports.DEFAULT_HEARTBEAT_MS = exports.MS_PER_DAY = exports.MS_PER_HOUR = exports.MS_PER_MINUTE = exports.MS_PER_SECOND = exports.LATEST_VERSION = void 0;
exports.createEmptyTimingData = createEmptyTimingData;
/** 数据格式当前版本 */
exports.LATEST_VERSION = 1;
// ─── 时间常量（唯一来源，禁止下游硬编码）──────────────
exports.MS_PER_SECOND = 1000;
exports.MS_PER_MINUTE = 60000;
exports.MS_PER_HOUR = 3600000;
exports.MS_PER_DAY = 86400000;
// ─── 调度器默认间隔（引用时间常量）────────────────────
exports.DEFAULT_HEARTBEAT_MS = exports.MS_PER_SECOND; // 1s — 心跳推入 RingBuffer
exports.DEFAULT_STATUS_BAR_MS = 5 * exports.MS_PER_SECOND; // 5s — 状态栏刷新
exports.DEFAULT_JOURNAL_FLUSH_MS = 10 * exports.MS_PER_SECOND; // 10s — journal 落盘
exports.DEFAULT_FULL_SAVE_MS = exports.MS_PER_MINUTE; // 60s — 全量存盘
exports.DEFAULT_RING_BUFFER_CAP = 1024;
exports.DEFAULT_MAX_SESSIONS = 1000;
exports.DEFAULT_IDLE_TIMEOUT_MS = 5 * exports.MS_PER_MINUTE; // 5 分钟
exports.DEFAULT_DAILY_GOAL_MS = 6 * exports.MS_PER_HOUR; // 6 小时
exports.CRASH_COMPENSATION_CAP_MS = exports.MS_PER_DAY; // 崩溃补偿上限 24h
/** 创建一个空的 WorkspaceTimingData */
function createEmptyTimingData() {
    return {
        version: exports.LATEST_VERSION,
        totalMs: 0,
        currentSessionStartMs: 0,
        lastSavedAtMs: 0,
        isEnabled: true,
        sessions: [],
    };
}
/** 默认配置 */
exports.DEFAULT_CONFIG = {
    enabled: true,
    globalDisabled: false,
    statusBarEnabled: true,
    backupToFile: true,
    journalEnabled: true,
    ringBufferCapacity: exports.DEFAULT_RING_BUFFER_CAP,
    journalFlushIntervalMs: exports.DEFAULT_JOURNAL_FLUSH_MS,
    fullSaveIntervalMs: exports.DEFAULT_FULL_SAVE_MS,
    statusBarFormat: 'compact',
    statusBarClickAction: 'cycle',
    maxSessions: exports.DEFAULT_MAX_SESSIONS,
    activityTrackingEnabled: true,
    idleTimeoutMs: exports.DEFAULT_IDLE_TIMEOUT_MS,
    dailyGoalMs: exports.DEFAULT_DAILY_GOAL_MS,
    weeklyGoalMs: 0,
    autoExport: { enabled: false, intervalMinutes: 60, format: 'weekly', targetPath: '' },
};
//# sourceMappingURL=models.js.map