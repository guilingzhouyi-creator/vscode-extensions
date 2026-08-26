/**
 * JournalWriter — 纯 Node 单测（IJournalStore 假实现）
 *
 * 验证：flush 写入路径、truncate 可等待（竞态修复回归）、flushAll 绕过策略。
 * 依赖 out/ 编译产物，先 npm run compile。
 */
'use strict';

const assert = require('assert');
const { JournalWriter } = require('../../out/cache/JournalWriter.js');
const { TimeBasedCacheStrategy } = require('../../out/cache/ICacheStrategy.js');
const { setLogLevel, LogLevel } = require('../../out/integration/Logger.js');

setLogLevel(LogLevel.None);

/** 假 journal 存储：记录调用时序，可注入失败 */
class FakeJournalStore {
    constructor() {
        this.appendCalls = [];
        this.truncateCalls = 0;
        this.inFlight = 0;
        this.maxConcurrentAppend = 0;
        this.failAppend = false;
    }

    async appendBatch(slices) {
        this.inFlight++;
        this.maxConcurrentAppend = Math.max(this.maxConcurrentAppend, this.inFlight);
        await new Promise(r => setTimeout(r, 5));
        if (this.failAppend) {
            this.inFlight--;
            throw new Error('disk full');
        }
        this.appendCalls.push(slices);
        this.inFlight--;
    }

    async readJournal() { return []; }
    async exists() { return true; }
    async delete() {}
    async truncate() { this.truncateCalls++; }
}

function slice(ts, delta) { return { timestamp: ts, deltaMs: delta }; }

describe('JournalWriter（IJournalStore 端口）', () => {
    it('tryFlush：按策略把缓冲切片写入 store，返回条数', async () => {
        const store = new FakeJournalStore();
        // interval=0 → count>0 即触发
        const w = new JournalWriter(store, 16, new TimeBasedCacheStrategy(0));
        w.push(slice(Date.now(), 1000));
        w.push(slice(Date.now(), 1000));
        const n = await w.tryFlush();
        assert.strictEqual(n, 2);
        assert.strictEqual(store.appendCalls.length, 1);
        assert.strictEqual(store.appendCalls[0].length, 2);
    });

    it('truncate：可等待且确实调用 store.truncate（竞态修复回归）', async () => {
        const store = new FakeJournalStore();
        const w = new JournalWriter(store, 16, new TimeBasedCacheStrategy(0));
        await w.truncate();
        assert.strictEqual(store.truncateCalls, 1);
    });

    it('truncate 后的 append 不会早于 truncate 完成（时序保证）', async () => {
        const store = new FakeJournalStore();
        const w = new JournalWriter(store, 16, new TimeBasedCacheStrategy(0));
        w.push(slice(1, 1));
        const p = w.truncate();
        // truncate 未完成前不允许发起新 append（模拟真实调用顺序约束）
        await p;
        w.push(slice(2, 1));
        await w.flushAll();
        assert.strictEqual(store.truncateCalls, 1);
        assert.strictEqual(store.appendCalls.length, 1);
    });

    it('flushAll：绕过策略立即清空缓冲', async () => {
        const store = new FakeJournalStore();
        // interval 极大 → tryFlush 永不触发；flushAll 应不受策略限制
        const w = new JournalWriter(store, 16, new TimeBasedCacheStrategy(60_000));
        w.push(slice(Date.now(), 500));
        assert.strictEqual(await w.tryFlush(), 0, '策略未到间隔应跳过');
        assert.strictEqual(await w.flushAll(), 1);
        assert.strictEqual(store.appendCalls[0].length, 1);
    });

    it('flushAll：append 失败按契约向调用方传播（Scheduler.saveNow 负责兜底）', async () => {
        const store = new FakeJournalStore();
        store.failAppend = true;
        const w = new JournalWriter(store, 16, new TimeBasedCacheStrategy(0));
        w.push(slice(Date.now(), 1));
        await assert.rejects(() => w.flushAll(), /disk full/);
    });
});

describe('JournalWriter：getRecent 活跃曲线保留窗', () => {
    it('返回最近 N 条，不受 flush 清空影响', async () => {
        const store = new FakeJournalStore();
        const w = new JournalWriter(store, 16, new TimeBasedCacheStrategy(0));
        for (let i = 0; i < 10; i++) w.push(slice(1000 + i, 1000));
        await w.tryFlush(); // 清空 RingBuffer
        const recent = w.getRecent(5);
        assert.strictEqual(recent.length, 5);
        assert.strictEqual(recent[0].timestamp, 1005, '保留最近 5 条中的最旧');
        assert.strictEqual(recent[4].timestamp, 1009, '最新一条保留');
        assert.strictEqual(store.appendCalls.length, 1, 'flush 确已执行');
    });

    it('条数超过上限时按 FIFO 淘汰，最多保留 300 条', () => {
        const store = new FakeJournalStore();
        const w = new JournalWriter(store, 16, new TimeBasedCacheStrategy(60_000));
        for (let i = 0; i < 301; i++) w.push(slice(1000 + i, 1000));
        const all = w.getRecent(1000);
        assert.strictEqual(all.length, 300, '保留窗上限 300');
        assert.strictEqual(all[0].timestamp, 1001, '最旧一条被淘汰');
        assert.strictEqual(all[299].timestamp, 1300, '最新一条保留');
    });

    it('n<=0 或空窗返回空数组', () => {
        const store = new FakeJournalStore();
        const w = new JournalWriter(store, 16, new TimeBasedCacheStrategy(0));
        assert.deepStrictEqual(w.getRecent(0), []);
        assert.deepStrictEqual(w.getRecent(-1), []);
        assert.deepStrictEqual(w.getRecent(5), []);
    });
});
