"use strict";
/**
 * WorkspaceTiming — Domain 层数据模型
 *
 * 所有时间单位统一为毫秒 (ms)。
 * 时间戳使用 Date.now() (UTC 毫秒)。
 * 零外部依赖。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = exports.CRASH_COMPENSATION_CAP_MS = exports.JOURNAL_WARN_BYTES = exports.DEFAULT_RAW_RETENTION_DAYS = exports.DEFAULT_MAX_SESSIONS = exports.DEFAULT_FULL_SAVE_MS = exports.DEFAULT_JOURNAL_FLUSH_MS = exports.DEFAULT_RING_BUFFER_CAP = exports.MS_PER_DAY = exports.MS_PER_HOUR = exports.MS_PER_MINUTE = exports.MS_PER_SECOND = exports.LATEST_VERSION = void 0;
exports.createEmptyTimingData = createEmptyTimingData;
/** 数据格式当前版本（v2：新增 dailyTotals 沉淀层） */
exports.LATEST_VERSION = 2;
// ─── 时间常量（唯一来源，禁止下游硬编码）──────────────
exports.MS_PER_SECOND = 1000;
exports.MS_PER_MINUTE = 60 * exports.MS_PER_SECOND;
exports.MS_PER_HOUR = 60 * exports.MS_PER_MINUTE;
exports.MS_PER_DAY = 24 * exports.MS_PER_HOUR;
// ─── 默认值（引用时间常量）──────────────
exports.DEFAULT_RING_BUFFER_CAP = 1024;
exports.DEFAULT_JOURNAL_FLUSH_MS = 10 * exports.MS_PER_SECOND; // 10s — journal 落盘
exports.DEFAULT_FULL_SAVE_MS = exports.MS_PER_MINUTE; // 60s — 全量存盘
/** 会话明细细细保留上限——兜底安全值；常规历史治理由 historyRawRetentionDays 折叠承担 */
exports.DEFAULT_MAX_SESSIONS = 5000;
/** 原始会话保留窗（天）：超出窗口的会话按日折叠进 dailyTotals；0=永不折叠 */
exports.DEFAULT_RAW_RETENTION_DAYS = 45;
/** journal 文件大小告警阈值 */
exports.JOURNAL_WARN_BYTES = 5 * 1024 * 1024;
/** 崩溃补偿上限 24h，防止异常数据导致计时暴涨 */
exports.CRASH_COMPENSATION_CAP_MS = exports.MS_PER_DAY;
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
    locale: 'auto',
    historyRawRetentionDays: exports.DEFAULT_RAW_RETENTION_DAYS,
    safetySnapshot: true,
    statusBarEnabled: true,
    backupToFile: true,
    journalEnabled: true,
    ringBufferCapacity: exports.DEFAULT_RING_BUFFER_CAP,
    journalFlushIntervalMs: exports.DEFAULT_JOURNAL_FLUSH_MS,
    fullSaveIntervalMs: exports.DEFAULT_FULL_SAVE_MS,
    statusBarFormat: 'compact',
    maxSessions: exports.DEFAULT_MAX_SESSIONS,
};
//# sourceMappingURL=models.js.map