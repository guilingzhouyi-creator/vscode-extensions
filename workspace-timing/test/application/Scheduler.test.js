/**
 * Scheduler — 周期调度器单测
 *
 * 直接对编译产物 out/application/Scheduler.js 断言，零 VS Code 运行时依赖。
 * 用短间隔真实定时器驱动心跳，验证：心跳推片与状态栏回调、全量存盘节拍、
 * 间隔热更新钳制（journal ≥1000ms / fullSave ≥5000ms 双向下界，见 models.ts 单一真源）、
 * journalEnabled=false 旁路、
 * 休眠恢复检测（时钟跳变 >15s）与跨午夜轮转检测，以及 stop 后定时器全清理。
 */
'use strict';

const assert = require('assert');
const { Scheduler } = require('../../out/application/Scheduler.js');

function makeJournalFake() {
    const calls = { pushed: [], tryFlush: 0, updateFlushInterval: [] };
    return {
        calls,
        push(slice) { calls.pushed.push(slice); },
        async tryFlush() { calls.tryFlush++; return 0; },
        async flushAll() { return 0; },
        updateFlushInterval(ms) { calls.updateFlushInterval.push(ms); },
        async truncate() { /* no-op */ },
    };
}

function makeSessionFake() {
    const calls = { checkpoints: 0, resumes: [], rotations: 0 };
    return {
        calls,
        // 真实 SessionManager 的 snapshot 是 getter，这里保持同形
        get snapshot() {
            return { totalMs: 1000, sessionElapsedMs: 0, currentTotalMs: 1000 };
        },
        getTodayMs() { return 500; },
        async saveCheckpoint() { calls.checkpoints++; },
        async handleSystemResume(sleepStartMs, resumeMs) {
            calls.resumes.push({ sleepStartMs, resumeMs });
        },
        async rotateSessionAtMidnight() { calls.rotations++; },
    };
}

function shortOptions() {
    return {
        journalFlushIntervalMs: 1000,
        fullSaveIntervalMs: 40,
        statusBarUpdateIntervalMs: 20,
        journalEnabled: true,
    };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Scheduler（周期调度）', function () {
    this.timeout(4000);

    it('心跳：推入 1s 时间片、尝试 flush、回调状态栏数据', async () => {
        const journal = makeJournalFake();
        const sessions = makeSessionFake();
        const sched = new Scheduler(journal, sessions, shortOptions());

        const ticks = [];
        sched.onStatusBarUpdate((d) => ticks.push(d));
        sched.start();
        await wait(120);
        sched.stop();

        assert.ok(ticks.length >= 2, '状态栏回调应被心跳驱动多次: ' + ticks.length);
        assert.strictEqual(ticks[0].totalMs, 1000);
        assert.strictEqual(ticks[0].todayMs, 500);
        assert.ok(journal.calls.pushed.length >= 2, '心跳应推入时间片');
        assert.strictEqual(
            journal.calls.pushed[0].deltaMs,
            shortOptions().statusBarUpdateIntervalMs,
            '切片粒度契约：journal 时间片 = 心跳间隔（本测例用 20ms 加速驱动）',
        );
    });

    it('全量存盘节拍：fullSaveIntervalMs 到期触发 checkpoint 并回调 onFullSaved', async () => {
        const journal = makeJournalFake();
        const sessions = makeSessionFake();
        const sched = new Scheduler(journal, sessions, shortOptions());

        const fullSaved = [];
        sched.onStatusBarUpdate(() => {});
        sched.onFullSaved(() => { fullSaved.push(1); });
        sched.start();
        await wait(150);
        sched.stop();

        assert.ok(sessions.calls.checkpoints >= 1, '应至少完成一次周期 checkpoint');
        assert.strictEqual(fullSaved.length, sessions.calls.checkpoints, 'onFullSaved 与 checkpoint 一一对应');
    });

    it('updateIntervals：越界值钳制到合法域（journal≥1000 / fullSave≥5000）并同步给缓存策略', () => {
        const journal = makeJournalFake();
        // 默认构造（flush 间隔 10s），写入 0/-5 应钳制到各域下界并判定为"已变化"
        const sched = new Scheduler(journal, makeSessionFake());

        sched.updateIntervals({ journalFlushIntervalMs: 0, fullSaveIntervalMs: -5 });
        assert.deepStrictEqual(journal.calls.updateFlushInterval, [1000], 'flush 间隔钳制后同步给 JournalWriter');
    });

    it('updateIntervals：未变化时零操作', () => {
        const journal = makeJournalFake();
        const sched = new Scheduler(journal, makeSessionFake());

        sched.updateIntervals({ journalFlushIntervalMs: 10000 });
        assert.strictEqual(journal.calls.updateFlushInterval.length, 0, '值未变化不同步');
    });

    it('journalEnabled=false：心跳不推时间片，状态栏照常更新', async () => {
        const journal = makeJournalFake();
        const sessions = makeSessionFake();
        const sched = new Scheduler(journal, sessions, {
            ...shortOptions(),
            journalEnabled: false,
        });

        const ticks = [];
        sched.onStatusBarUpdate((d) => ticks.push(d));
        sched.start();
        await wait(80);
        sched.stop();

        assert.strictEqual(journal.calls.pushed.length, 0, 'journal 关闭时不推切片');
        assert.ok(ticks.length >= 1, '状态栏不受影响');
    });

    it('休眠恢复检测：心跳间隔 >15s 触发 handleSystemResume 且不推休眠期切片', async () => {
        const journal = makeJournalFake();
        const sessions = makeSessionFake();
        const sched = new Scheduler(journal, sessions, shortOptions());

        sched.onStatusBarUpdate(() => {});
        sched.start();
        await wait(40);
        // 模拟系统休眠：把上次心跳时间拨回 20 秒前（超过 15s 断点阈值）
        sched._lastTickMs = Date.now() - 20000;
        await wait(60);
        sched.stop();

        assert.strictEqual(sessions.calls.resumes.length, 1, '应触发一次休眠恢复');
        const gap = sessions.calls.resumes[0].resumeMs - sessions.calls.resumes[0].sleepStartMs;
        assert.ok(gap > 15000, '恢复跨度应覆盖休眠期: ' + gap);
    });

    it('跨午夜检测：日期串更替触发 rotateSessionAtMidnight', async () => {
        const journal = makeJournalFake();
        const sessions = makeSessionFake();
        const sched = new Scheduler(journal, sessions, shortOptions());

        sched.onStatusBarUpdate(() => {});
        sched.start();
        await wait(40);
        // 模拟自然日更替：把当前日期串拨回 2000-01-01
        sched._currentDayStr = '2000-01-01';
        await wait(60);
        sched.stop();

        assert.strictEqual(sessions.calls.rotations, 1, '应触发一次跨午夜轮转');
    });

    it('stop 后定时器全清理：心跳与 checkpoint 计数停止增长', async () => {
        const journal = makeJournalFake();
        const sessions = makeSessionFake();
        const sched = new Scheduler(journal, sessions, shortOptions());

        sched.onStatusBarUpdate(() => {});
        sched.start();
        await wait(80);
        sched.stop();

        const checkpoints = sessions.calls.checkpoints;
        const pushed = journal.calls.pushed.length;
        await wait(80);
        assert.strictEqual(sessions.calls.checkpoints, checkpoints, 'stop 后不再 checkpoint');
        assert.strictEqual(journal.calls.pushed.length, pushed, 'stop 后不再推片');
        assert.strictEqual(sched.isRunning, false);
    });

    it('journal flush 失败不中断心跳循环（下轮继续尝试）', async () => {
        const journal = makeJournalFake();
        let failNext = true;
        journal.tryFlush = async () => {
            if (failNext) { failNext = false; throw new Error('disk full'); }
            return 0;
        };
        const sessions = makeSessionFake();
        const sched = new Scheduler(journal, sessions, shortOptions());

        const ticks = [];
        sched.onStatusBarUpdate((d) => ticks.push(d));
        sched.start();
        await wait(100);
        sched.stop();

        assert.ok(ticks.length >= 2, 'flush 失败后心跳应继续');
        assert.strictEqual(failNext, false, '第二次 flush 尝试应已发生');
    });
});
