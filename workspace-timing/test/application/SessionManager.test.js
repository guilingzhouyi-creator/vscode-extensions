/**
 * SessionManager — 会话生命周期与跨午夜/休眠单测
 *
 * 直接对编译产物 out/application/SessionManager.js 断言，零 VS Code 运行时依赖。
 * 验证：会话启动/停止、跨午夜自然日切分、系统休眠恢复、今日时长准确性。
 */
'use strict';

const assert = require('assert');
const { SessionManager } = require('../../out/application/SessionManager.js');
const { RecoveryService } = require('../../out/application/RecoveryService.js');
const { TimerEngine } = require('../../out/domain/TimerEngine.js');
const { TimeAggregator, parseLocalDate, localDateStr } = require('../../out/domain/TimeAggregator.js');

class FakeStorageCoordinator {
    constructor(initialData = null) {
        this.data = initialData;
        this.saved = [];
    }
    async load() {
        return { data: this.data, source: 'fake' };
    }
    async save(data, forceFileBackup = false) {
        this.saved.push({ ...data });
        this.data = { ...data };
    }
}

class FakeJournalWriter {
    constructor() {
        this.flushed = [];
    }
    async flushAll() { return 0; }
    async truncate() { return true; }
    async tryFlush() { return false; }
}

class FakeRecoveryService {
    async recover(retentionDays) {
        return {
            version: 2,
            totalMs: 0,
            currentSessionStartMs: 0,
            lastSavedAtMs: 0,
            isEnabled: true,
            sessions: [],
            dailyTotals: {},
        };
    }
}

/** 假 journal store（IJournalStore 端口）：可注入切片，供真实 RecoveryService 回放 */
class FakeJournalStore {
    constructor(slices = []) {
        this.slices = slices;
        this.truncateCalls = 0;
    }
    async exists() { return true; }
    async readJournal() { return [...this.slices]; }
    async truncate() { this.slices = []; this.truncateCalls++; }
    async delete() { this.slices = []; }
    async appendBatch(batch) { this.slices.push(...batch); }
}

describe('SessionManager（跨午夜与休眠管理）', () => {
    let timer;
    let storage;
    let journal;
    let recovery;
    let sessionManager;

    beforeEach(() => {
        timer = new TimerEngine();
        storage = new FakeStorageCoordinator();
        journal = new FakeJournalWriter();
        recovery = new FakeRecoveryService();
        sessionManager = new SessionManager(timer, storage, journal, recovery, 1000, 45);
    });

    it('startSession / endSession 正常生命周期', async () => {
        await sessionManager.startSession();
        assert.strictEqual(sessionManager.isSessionActive, true);
        assert.strictEqual(timer.isRunning, true);

        const res = await sessionManager.endSession();
        assert.strictEqual(sessionManager.isSessionActive, false);
        assert.strictEqual(timer.isRunning, false);
        assert.ok(storage.saved.length > 0, '会话结束时触发了存盘');
    });

    it('rotateSessionAtMidnight：跨午夜轮转将会话封存入昨天，今天从零起算', async () => {
        await sessionManager.startSession();

        // 模拟昨晚 23:00 开始的会话
        const today = TimeAggregator.todayStr();
        const todayZero = parseLocalDate(today);
        const yesterday23h = todayZero - 3600000; // 昨晚 23:00

        // 手动调整引擎会话起点为昨晚 23:00
        timer._sessionStartMs = yesterday23h;
        timer.data.currentSessionStartMs = yesterday23h;

        // 执行跨午夜轮转（通常在 00:00:00 由 Scheduler 触发）
        await sessionManager.rotateSessionAtMidnight();

        // 验证：昨晚 1 小时已被封存进 sessions
        assert.strictEqual(timer.data.sessions.length, 1);
        assert.strictEqual(timer.data.sessions[0].startMs, yesterday23h);
        assert.strictEqual(timer.data.sessions[0].endMs, todayZero);
        assert.strictEqual(timer.data.sessions[0].durationMs, 3600000);
        assert.strictEqual(timer.data.totalMs, 3600000);

        // 验证：journal 水位线推进到今日零点（崩溃恢复时跳过封存段，防双重计数）
        assert.strictEqual(timer.data.metadata.lastJournalTs, String(todayZero));
        assert.strictEqual(storage.saved[storage.saved.length - 1].metadata.lastJournalTs, String(todayZero),
            '水位线必须随落盘持久化');

        // 验证：今日会话新起点为今日零点，昨日 1 小时不计入今日
        assert.strictEqual(timer.data.currentSessionStartMs, todayZero);
        sessionManager.invalidateTodayCache();
        const todayMs = sessionManager.getTodayMs();
        assert.ok(Math.abs(todayMs - (Date.now() - todayZero)) < 50, '昨天的时长不计入今日');
    });

    it('handleSystemResume：系统休眠恢复后不计入休眠时长', async () => {
        await sessionManager.startSession();

        const startMs = Date.now();
        timer._sessionStartMs = startMs;
        timer.data.currentSessionStartMs = startMs;

        const sleepStart = startMs + 1800000; // 30 分钟后盒盖睡眠
        const resumeMs = startMs + 28800000;  // 8 小时后唤醒

        await sessionManager.handleSystemResume(sleepStart, resumeMs);

        // 验证：仅累计了睡眠前 30 分钟，8 小时睡眠期间不计入
        assert.strictEqual(timer.data.totalMs, 1800000);
        assert.strictEqual(timer.data.sessions.length, 1);
        assert.strictEqual(timer.data.sessions[0].durationMs, 1800000);
        assert.strictEqual(timer.data.currentSessionStartMs, resumeMs, '新起点设为唤醒时刻');

        // 验证：journal 水位线推进到唤醒时刻（崩溃恢复时跳过休眠前封存段，防双重计数）
        assert.strictEqual(timer.data.metadata.lastJournalTs, String(resumeMs));
    });

    it('setMaxSessions / saveCheckpoint：容量超限时自动触发无损折叠回收入 dailyTotals', async () => {
        await sessionManager.startSession();

        const t0 = Date.now();
        // 构造 5 个已完成会话
        timer.data.sessions = [
            { startMs: t0 - 50000, endMs: t0 - 40000, durationMs: 10000 },
            { startMs: t0 - 40000, endMs: t0 - 30000, durationMs: 10000 },
            { startMs: t0 - 30000, endMs: t0 - 20000, durationMs: 10000 },
            { startMs: t0 - 20000, endMs: t0 - 10000, durationMs: 10000 },
            { startMs: t0 - 10000, endMs: t0, durationMs: 10000 },
        ];
        timer.data.totalMs = 50000;

        // 设置上限为 2，应立即触发自动折叠
        sessionManager.setMaxSessions(2);

        // 验证：内存中仅保留最新的 2 条，最旧的 3 条折叠进 dailyTotals
        assert.strictEqual(timer.data.sessions.length, 2);
        const foldedCount = Object.values(timer.data.dailyTotals).reduce((sum, b) => sum + b.sessionCount, 0);
        assert.strictEqual(foldedCount, 3);
        const foldedMs = Object.values(timer.data.dailyTotals).reduce((sum, b) => sum + b.totalMs, 0);
        assert.strictEqual(foldedMs, 30000);

        // 验证 endSession 返回的总会话数为 6（3+1 条折叠 + 2 条内存，包含 startSession 开启并结束的会话）
        const res = await sessionManager.endSession();
        assert.strictEqual(res.sessionCount, 6);
        assert.strictEqual(res.totalMs, 50000);
    });

    it('跨午夜轮转后崩溃恢复：封存段不双计（双重计数回归）', async () => {
        // 真实 RecoveryService + 可回放 journal，验证"跨午夜轮转 → 崩溃 → 重启恢复"全链路：
        // 昨夜封存段已计入 totalMs 并落盘，journal 回放必须跳过水位线之前的切片，只补今日增量。
        const journalStore = new FakeJournalStore();
        const realRecovery = new RecoveryService(storage, journalStore);
        const sm = new SessionManager(timer, storage, journal, realRecovery, 1000, 45);

        // 1. 启动会话（全新启动）
        await sm.startSession();

        // 2. 模拟昨晚 23:00 开始的会话，并写入昨夜 journal 切片（每 5 分钟一片，共 12 片 = 1h）
        const today = TimeAggregator.todayStr();
        const todayZero = parseLocalDate(today);
        const yesterday23h = todayZero - 3600000;
        timer._sessionStartMs = yesterday23h;
        timer.data.currentSessionStartMs = yesterday23h;
        for (let t = yesterday23h + 300000; t <= todayZero; t += 300000) {
            journalStore.slices.push({ timestamp: t, deltaMs: 300000 });
        }

        // 3. 跨午夜轮转：昨夜 1h 封存进 totalMs 并落盘，水位线推进到今日零点
        await sm.rotateSessionAtMidnight();
        assert.strictEqual(timer.data.totalMs, 3600000);

        // 4. 崩溃前：journal 又写入了今日凌晨 30 分钟的切片（新会话段增量）
        for (let t = todayZero + 300000; t <= todayZero + 1800000; t += 300000) {
            journalStore.slices.push({ timestamp: t, deltaMs: 300000 });
        }

        // 5. 重启恢复：昨夜封存段已在 totalMs 中，回放必须跳过 ≤ 水位线的切片
        const recovered = await realRecovery.recover(45, 1000);
        assert.strictEqual(recovered.totalMs, 3600000 + 1800000,
            '封存段只计一次，仅追加今日 30 分钟增量');
    });
});
