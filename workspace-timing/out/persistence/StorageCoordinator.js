"use strict";
/**
 * StorageCoordinator — 存储协调器
 *
 * 职责：
 *   1. 协调三级存储：workspaceState（主）→ JSON 文件（备）→ journal（崩溃恢复）
 *   2. 崩溃恢复：三步走算法（加载主数据 → 回放 journal → 补偿未完成会话）
 *   3. 写入时级联写入主 + 备
 *
 * 崩溃恢复算法（三步走）：
 *   Step 1: 从 workspaceState 加载；若不可用则 fallback 到 JSON 文件
 *   Step 2: 如果 journal 存在，回放所有未提交的 TimeSlice
 *   Step 3: 仅当 journal 无有效回放且 sessionStartMs > 0 时，补偿未完成会话的历时（兕底）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageCoordinator = void 0;
const models_1 = require("../domain/models");
const TimeAggregator_1 = require("../domain/TimeAggregator");
const Logger_1 = require("../integration/Logger");
/** journal 片段分组断点阈值：相邻片段起始间隔超过该值视为中断（如系统休眠） */
const JOURNAL_RUN_GAP_MS = 60000;
class StorageCoordinator {
    constructor(primary, fileBackup, journal) {
        this._fileBackupCount = 0;
        this.primary = primary;
        this.fileBackup = fileBackup;
        this.journal = journal;
    }
    /**
     * 完整崩溃恢复 + 数据加载
     *
     * 三步走：
     *   1. 加载主存储 → fallback JSON
     *   2. 回放 journal
     *   3. 补偿未完成会话
     */
    async recover() {
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'StorageCoordinator: crash recovery started');
        // Step 1: 加载主数据
        let data = await this.primary.load();
        let source = 'workspaceState';
        if (!data) {
            data = await this.fileBackup.load();
            source = 'fileBackup';
        }
        if (!data) {
            data = (0, models_1.createEmptyTimingData)();
            source = 'empty (fresh start)';
            (0, Logger_1.log)(Logger_1.LogLevel.Info, `StorageCoordinator: no existing data, starting fresh`);
        }
        else {
            (0, Logger_1.log)(Logger_1.LogLevel.Info, `StorageCoordinator: loaded from ${source}, totalMs=${data.totalMs}`);
        }
        // Step 2: 回放 journal
        // 进行中会话的增量由 journal 完整记录（checkpoint 只固化历史累计、不清空 journal）。
        // ★ 修复：回放时长必须落成按自然日切分的 finished TimeSession 并入 sessions[]，
        //   否则 totalMs 虽恢复，今日/近7天/周报等按日统计在重载后会丢失该段时长。
        //   片段按时间连续性分组（间隔 > JOURNAL_RUN_GAP_MS 视为断点，如系统休眠），
        //   每组合成会话；组内 durationMs 以墙钟跨度计（与按日归桶口径一致）。
        let journalReplayed = false;
        const journalExists = await this.journal.exists();
        if (journalExists) {
            const slices = await this.journal.readJournal();
            if (slices.length > 0) {
                const journalDelta = slices.reduce((sum, s) => sum + s.deltaMs, 0);
                data.totalMs += journalDelta;
                journalReplayed = true;
                const runs = [];
                for (const s of slices) {
                    const start = s.timestamp - s.deltaMs;
                    const last = runs[runs.length - 1];
                    if (last && start <= last.endMs + JOURNAL_RUN_GAP_MS) {
                        last.endMs = Math.max(last.endMs, s.timestamp);
                    }
                    else {
                        runs.push({ startMs: start, endMs: s.timestamp });
                    }
                }
                let synthesized = 0;
                for (const run of runs) {
                    const segs = TimeAggregator_1.TimeAggregator.splitByNaturalDay(run.startMs, run.endMs);
                    data.sessions.push(...segs);
                    synthesized += segs.length;
                }
                (0, Logger_1.log)(Logger_1.LogLevel.Info, `StorageCoordinator: replayed ${slices.length} journal entries, +${journalDelta}ms, ` +
                    `synthesized ${synthesized} session segment(s)`);
            }
            await this.journal.truncate();
        }
        // Step 3: 补偿未完成会话
        // 仅当 journal 无有效回放且存在进行中会话时，才用起止时间差兜底补偿，
        // 避免与 journal 回放对同一时段重复累计（"三重计数"修复）。
        if (!journalReplayed && data.currentSessionStartMs > 0) {
            const now = Date.now();
            const elapsed = now - data.currentSessionStartMs;
            if (elapsed > 0 && elapsed < models_1.CRASH_COMPENSATION_CAP_MS) { // 最多补偿 24h，防止异常
                data.totalMs += elapsed;
                // ★ 补偿时长同样落成按日会话，保证日报/周报口径一致
                for (const seg of TimeAggregator_1.TimeAggregator.splitByNaturalDay(data.currentSessionStartMs, now)) {
                    data.sessions.push(seg);
                }
                (0, Logger_1.log)(Logger_1.LogLevel.Info, `StorageCoordinator: compensated unfinished session: +${elapsed}ms`);
            }
        }
        // 重置会话状态
        data.currentSessionStartMs = 0;
        data.lastSavedAtMs = Date.now();
        data.version = models_1.LATEST_VERSION;
        // 写回存储（恢复属关键事件，强制落 JSON 备份）
        await this.save(data, true);
        (0, Logger_1.log)(Logger_1.LogLevel.Info, `StorageCoordinator: recovery complete, totalMs=${data.totalMs}`);
        return data;
    }
    /**
     * 级联写入：主存储 + JSON 备份
     * 主存储失败时不影响备份写入。
     * JSON 备份为二级兜底，每 FILE_BACKUP_EVERY_N 次落盘一次以降低磁盘抖动；
     * 会话结束/重置/恢复等关键事件用 forceFileBackup 强制写入。
     */
    async save(data, forceFileBackup = false) {
        // 更新最后保存时间
        data.lastSavedAtMs = Date.now();
        const errors = [];
        try {
            await this.primary.save(data);
        }
        catch (err) {
            errors.push(`primary: ${err.message}`);
        }
        this._fileBackupCount++;
        if (forceFileBackup || this._fileBackupCount % StorageCoordinator.FILE_BACKUP_EVERY_N === 0) {
            try {
                await this.fileBackup.save(data);
            }
            catch (err) {
                errors.push(`fileBackup: ${err.message}`);
            }
        }
        if (errors.length > 0) {
            (0, Logger_1.log)(Logger_1.LogLevel.Warn, `StorageCoordinator: save partially failed: ${errors.join('; ')}`);
        }
    }
    /** 读取数据（不执行恢复，仅加载当前持久化状态） */
    async load() {
        let data = await this.primary.load();
        if (!data) {
            data = await this.fileBackup.load();
        }
        return data;
    }
    /** 删除所有存储数据 */
    async deleteAll() {
        try {
            await this.primary.delete();
        }
        catch {
            // ignore
        }
        try {
            await this.fileBackup.delete();
        }
        catch {
            // ignore
        }
        try {
            await this.journal.delete();
        }
        catch {
            // ignore
        }
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'StorageCoordinator: all data deleted');
    }
    /** 获取 journal 存储引用（供 Scheduler/JournalWriter 使用） */
    getJournalProvider() {
        return this.journal;
    }
}
exports.StorageCoordinator = StorageCoordinator;
/** 文件备份降频：每 N 次全量存盘才写一次 JSON 备份（主存 workspaceState 仍每次写） */
StorageCoordinator.FILE_BACKUP_EVERY_N = 3;
//# sourceMappingURL=StorageCoordinator.js.map