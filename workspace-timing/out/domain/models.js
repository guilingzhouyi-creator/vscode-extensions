"use strict";
/**
 * WorkspaceTiming — Domain 层数据模型
 *
 * 所有时间单位统一为毫秒 (ms)。
 * 时间戳使用 Date.now() (UTC 毫秒)。
 * 零外部依赖。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = exports.LATEST_VERSION = void 0;
exports.createEmptyTimingData = createEmptyTimingData;
/** 数据格式当前版本 */
exports.LATEST_VERSION = 1;
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
    ringBufferCapacity: 1024,
    journalFlushIntervalMs: 10000,
    fullSaveIntervalMs: 60000,
    statusBarFormat: 'compact',
    maxSessions: 1000,
};
//# sourceMappingURL=models.js.map