/**
 * SessionManager — 会话生命周期与跨午夜/休眠单测
 *
 * 直接对编译产物 out/application/SessionManager.js 断言，零 VS Code 运行时依赖。
 * 验证：会话启动/停止、跨午夜自然日切分、系统休眠恢复、今日时长准确性。
 */
'use strict';

const assert = require('assert');
const { SessionManager } = require('../../out/application/SessionManager.js');
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
    });
});
