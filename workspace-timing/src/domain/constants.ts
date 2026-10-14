/**
 * Module: Domain Constants — VS Code Commands & Configuration Keys SSOT
 * File Path: src/domain/constants.ts
 * Architecture Role: Single source of truth for all domain constants, configuration keys, and command IDs
 * Dependencies & Triggers: Consumed by models, ConfigWatcher, CommandRegistrar, and UI presentation layers
 * Responsibilities: Declare frozen dictionary mappings for VS Code extension setting keys and command identifiers
 * Exit Semantics & Design Rationale: Immutable frozen records; prevents scattered string literals across domain and application layers
 */

/**
 * 架构契约：VS Code 配置项唯一真源键值映射字典 (TIMING_CONFIG_KEYS)
 * 约束公理：全仓严禁散落未定义的配置键硬编码字符串。
 */
export const TIMING_CONFIG_KEYS = Object.freeze({
    SECTION: 'workspaceTiming',
    ENABLED: 'enabled',
    GLOBAL_DISABLED: 'globalDisabled',
    LOCALE: 'locale',
    STATUS_BAR_ENABLED: 'statusBar.enabled',
    STATUS_BAR_MODE: 'statusBar.mode',
    STORAGE_BACKUP_TO_FILE: 'storage.backupToFile',
    STORAGE_JOURNAL_ENABLED: 'storage.journalEnabled',
    STORAGE_RING_BUFFER_CAPACITY: 'storage.ringBufferCapacity',
    STORAGE_JOURNAL_FLUSH_INTERVAL: 'storage.journalFlushInterval',
    STORAGE_FULL_SAVE_INTERVAL: 'storage.fullSaveInterval',
    STORAGE_MAX_SESSIONS: 'storage.maxSessions',
    STORAGE_HISTORY_RAW_RETENTION_DAYS: 'storage.historyRawRetentionDays',
    STORAGE_SAFETY_SNAPSHOT: 'storage.safetySnapshot',
    IDLE_TIMEOUT_MINUTES: 'idleTimeoutMinutes',
    AI_DETECTION_ENABLED: 'aiDetectionEnabled',
    AI_COOLDOWN_SECONDS: 'aiCooldownSeconds',
    WEEKLY_LIMIT_ENABLED: 'weeklyLimit.enabled',
    WEEKLY_LIMIT_HOURS: 'weeklyLimit.hours',
    CHART_DUAL_TRACK_DISPLAY: 'chartDualTrackDisplay',
} as const);

/**
 * 架构契约：VS Code 命令标识符唯一真源映射字典 (TIMING_COMMAND_IDS)
 * 约束公理：命令注册、调用与交互面板派发必须收敛于此单一真源。
 */
export const TIMING_COMMAND_IDS = Object.freeze({
    ENABLE: 'workspaceTiming.enable',
    DISABLE: 'workspaceTiming.disable',
    TOGGLE_GLOBAL: 'workspaceTiming.toggleGlobal',
    SHOW_STATUS: 'workspaceTiming.showStatus',
    TOGGLE_ACTIVITY_MODE: 'workspaceTiming.toggleActivityMode',
    SET_MODE_AI: 'workspaceTiming.setModeAi',
    SET_MODE_MANUAL: 'workspaceTiming.setModeManual',
    SET_MODE_AUTO: 'workspaceTiming.setModeAuto',
    DEBUG_SAVE: 'workspaceTiming.debugSave',
    NEW_PERIOD: 'workspaceTiming.newPeriod',
    RESET: 'workspaceTiming.reset',
    CLEAR_GLOBAL: 'workspaceTiming.clearGlobal',
    CLEAR_HISTORY: 'workspaceTiming.clearHistory',
    RESTORE: 'workspaceTiming.restore',
    OPEN_DASHBOARD: 'workspaceTiming.openDashboard',
    EXPORT: 'workspaceTiming.export',
    EXPORT_AGGREGATED: 'workspaceTiming.exportAggregated',
} as const);
