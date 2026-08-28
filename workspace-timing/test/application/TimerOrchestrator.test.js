/**
 * TimerOrchestrator — 周工作上限与总控单测
 *
 * 直接对编译产物 out/application/TimerOrchestrator.js 断言，零 VS Code 运行时依赖。
 * 验证：周工作上限配置传递、超限检测、单周防重复提醒机制。
 */
'use strict';

const assert = require('assert');
const { TimerOrchestrator } = require('../../out/application/TimerOrchestrator.js');
const { TimerEngine } = require('../../out/domain/TimerEngine.js');
const { DisableManager } = require('../../out/application/DisableManager.js');
const { SessionManager } = require('../../out/application/SessionManager.js');
const { Scheduler } = require('../../out/application/Scheduler.js');
const { GlobalAggregator } = require('../../out/application/GlobalAggregator.js');
const { init, setLocale } = require('../../out/i18n/index.js');

class FakeStorageCoordinator {
    constructor(initialData = null) {
        this.data = initialData;
    }
    async load() { return { data: this.data, source: 'fake' }; }
    async save(data) { this.data = { ...data }; }
}

class FakeJournalWriter {
    async flushAll() { return 0; }
    async truncate() { return true; }
    async tryFlush() { return false; }
    push() {}
    updateFlushInterval() {}
}

class FakeRecoveryService {
    async recover() {
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

class FakeGlobalStore {
    constructor() {
        this.data = { version: 1, workspaces: {}, lastUpdatedAt: 0 };
    }
    async load() { return this.data; }
    async save(d) { this.data = d; }
}

describe('TimerOrchestrator（周工作上限模块）', () => {
    let timer;
    let storage;
    let journal;
    let recovery;
    let sessionManager;
    let disableManager;
    let scheduler;
    let globalAggregator;
    let orchestrator;

    beforeEach(() => {
        init();
        setLocale('zh-CN');
        timer = new TimerEngine();
        storage = new FakeStorageCoordinator();
        journal = new FakeJournalWriter();
        recovery = new FakeRecoveryService();
        sessionManager = new SessionManager(timer, storage, journal, recovery, 1000, 45);
        disableManager = new DisableManager({
            enabled: true,
            globalDisabled: false,
            weeklyLimitEnabled: false,
            weeklyLimitHours: 40,
        });
        scheduler = new Scheduler(journal, sessionManager);
        globalAggregator = new GlobalAggregator(new FakeGlobalStore(), () => undefined);
        orchestrator = new TimerOrchestrator(
            timer, storage, journal, sessionManager, disableManager, scheduler, globalAggregator,
        );
    });

    it('默认配置：周上限默认不开启（weeklyLimitEnabled = false）', async () => {
        const data = await orchestrator.getDashboardData();
        assert.strictEqual(data.weeklyLimitEnabled, false);
        assert.strictEqual(data.weeklyLimitHours, 40);
    });

    it('applyDashboardConfig：支持开启周上限并自定义阈值', async () => {
        orchestrator.applyDashboardConfig({
            weeklyLimitEnabled: true,
            weeklyLimitHours: 35,
        });

        const data = await orchestrator.getDashboardData();
        assert.strictEqual(data.weeklyLimitEnabled, true);
        assert.strictEqual(data.weeklyLimitHours, 35);
    });

    it('checkWeeklyLimit：未开启时不触发超限提醒', () => {
        let notifiedMsg = null;
        orchestrator.onWeeklyLimitExceeded((msg) => {
            notifiedMsg = msg;
        });

        // 本周会话 50 小时（> 40h），但开关为 false
        const now = Date.now();
        timer.data.sessions.push({
            startMs: now - 50 * 3600_000,
            endMs: now,
            durationMs: 50 * 3600_000,
        });

        orchestrator.checkWeeklyLimit();
        assert.strictEqual(notifiedMsg, null, '未开启时不应提醒');
    });

    it('checkWeeklyLimit：开启且超限时触发提醒，且每周仅提醒一次', () => {
        let notificationCount = 0;
        let lastMsg = null;
        orchestrator.onWeeklyLimitExceeded((msg) => {
            notificationCount++;
            lastMsg = msg;
        });

        orchestrator.applyDashboardConfig({
            weeklyLimitEnabled: true,
            weeklyLimitHours: 40,
        });

        // 构造本周 42 小时工时
        const now = Date.now();
        timer.data.sessions.push({
            startMs: now - 42 * 3600_000,
            endMs: now,
            durationMs: 42 * 3600_000,
        });

        // 首次检查：触发提醒
        orchestrator.checkWeeklyLimit();
        assert.strictEqual(notificationCount, 1, '超限应触发 1 次提醒');
        assert.ok(lastMsg && lastMsg.includes('超过设定的周工作上限（40h）'), '提示词条包含上限与休息');

        // 第二次检查（模拟心跳继续推进）：不重复提醒
        orchestrator.checkWeeklyLimit();
        assert.strictEqual(notificationCount, 1, '同周内不应重复轰炸提醒');
    });

    it('周时长上下界与非法输入约束：0/负数/超出 168h/非数字自动安全纠偏', async () => {
        // 测试越界与非法值
        orchestrator.applyDashboardConfig({ weeklyLimitHours: -5 });
        let data = await orchestrator.getDashboardData();
        assert.strictEqual(data.weeklyLimitHours, 1, '小于 1h 纠偏为下界 1h');

        orchestrator.applyDashboardConfig({ weeklyLimitHours: 999 });
        data = await orchestrator.getDashboardData();
        assert.strictEqual(data.weeklyLimitHours, 168, '大于 168h 纠偏为物理上界 168h (7*24h)');

        orchestrator.applyDashboardConfig({ weeklyLimitHours: NaN });
        data = await orchestrator.getDashboardData();
        assert.strictEqual(data.weeklyLimitHours, 40, 'NaN 纠偏为默认 40h');
    });

    it('跨周隔离：上周的历史时长不计入本周工时上限判定', () => {
        let notified = false;
        orchestrator.onWeeklyLimitExceeded(() => { notified = true; });

        orchestrator.applyDashboardConfig({
            weeklyLimitEnabled: true,
            weeklyLimitHours: 10,
        });

        // 构造上周 100 小时的超级会话（7 天前）
        const twoWeeksAgo = Date.now() - 14 * 86400_000;
        timer.data.sessions.push({
            startMs: twoWeeksAgo,
            endMs: twoWeeksAgo + 100 * 3600_000,
            durationMs: 100 * 3600_000,
        });

        orchestrator.checkWeeklyLimit();
        assert.strictEqual(notified, false, '上周的历史时长绝不应触发本周上限提醒');
    });
});
