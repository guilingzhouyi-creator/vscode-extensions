/**
 * GlobalAggregator — 纯 Node 单测（假 store + 注入工作区解析器）
 *
 * 验证：同步写入、增量守卫（相同值跳过/失败不记账/reset 清守卫）、陈旧条目回收。
 * v0.4.x 起 GlobalAggregator 不再直接依赖 vscode API，可脱离编辑器运行。
 */
'use strict';

const assert = require('assert');
const { GlobalAggregator } = require('../../out/application/GlobalAggregator.js');
const { setLogLevel, LogLevel } = require('../../out/integration/Logger.js');

setLogLevel(LogLevel.None);

function emptyData() {
    return { version: 1, totalMs: 0, workspaces: {}, lastUpdatedAt: 0 };
}

/** 假全局存储：可注入保存失败 */
class FakeGlobalStore {
    constructor(initial) {
        this.data = initial ?? emptyData();
        this.available = true;
        this.saveCalls = 0;
        this.failSave = false;
    }
    isAvailable() { return this.available; }
    async load() { return JSON.parse(JSON.stringify(this.data)); }
    async save(d) {
        this.saveCalls++;
        if (this.failSave) throw new Error('quota exceeded');
        this.data = JSON.parse(JSON.stringify(d));
    }
    async delete() { this.data = emptyData(); }
}

function makeAggregator(store) {
    return new GlobalAggregator(store, () => ({ id: 'ws-1', name: 'Demo', uri: 'file:///demo' }));
}

describe('GlobalAggregator（跨工作区累计）', () => {
    it('sync：写入当前工作区条目并重算总和', async () => {
        const store = new FakeGlobalStore();
        const agg = makeAggregator(store);
        await agg.sync(1000);
        assert.strictEqual(store.data.workspaces['ws-1'].totalMs, 1000);
        assert.strictEqual(store.data.totalMs, 1000);
    });

    it('增量守卫：相同 totalMs 跳过整轮读写', async () => {
        const store = new FakeGlobalStore();
        const agg = makeAggregator(store);
        await agg.sync(500);
        const savesAfterFirst = store.saveCalls;
        await agg.sync(500);
        assert.strictEqual(store.saveCalls, savesAfterFirst, '值未变化不应再写');
        await agg.sync(700);
        assert.ok(store.saveCalls > savesAfterFirst, '值变化应重新写入');
    });

    it('增量守卫：保存失败不记账，下轮重试', async () => {
        const store = new FakeGlobalStore();
        const agg = makeAggregator(store);
        store.failSave = true;
        await agg.sync(300); // 内部 catch，不抛出；守卫不记账
        const failedSaves = store.saveCalls;
        store.failSave = false;
        await agg.sync(300); // 同值也应重试（上一轮未记账）
        assert.ok(store.saveCalls > failedSaves, '失败后同值应重试而非被守卫跳过');
        assert.strictEqual(store.data.totalMs, 300);
    });

    it('reset：清空数据并解除守卫，同值可再次写入', async () => {
        const store = new FakeGlobalStore();
        const agg = makeAggregator(store);
        await agg.sync(800);
        await agg.reset();
        assert.strictEqual(store.data.totalMs, 0);
        assert.deepStrictEqual(store.data.workspaces, {});
        await agg.sync(800);
        assert.strictEqual(store.data.workspaces['ws-1'].totalMs, 800, 'reset 后同值应重新回填');
    });

    it('陈旧回收：超过 TTL 未同步的条目不计入总和', async () => {
        const initial = emptyData();
        initial.workspaces['old-ws'] = { name: 'Old', uri: 'file:///old', totalMs: 999999, lastSyncedAt: 1 };
        const store = new FakeGlobalStore(initial);
        const agg = makeAggregator(store);
        await agg.sync(100);
        assert.strictEqual(store.data.workspaces['old-ws'], undefined, '陈旧条目应被回收');
        assert.strictEqual(store.data.totalMs, 100);
    });

    it('snapshot：返回排序后的工作区列表（含同步前已存在的条目）', async () => {
        const store = new FakeGlobalStore();
        // 同步前全局存储中已有另一个更高累计的工作区
        store.data.workspaces['ws-big'] = { name: 'Big', uri: 'file:///big', totalMs: 9000, lastSyncedAt: Date.now() };
        const agg = makeAggregator(store);
        await agg.sync(100); // sync 后 _cached 同时包含两个条目
        const snap = await agg.snapshot();
        assert.strictEqual(snap.workspaceCount, 2);
        assert.strictEqual(snap.workspaces[0].name, 'Big', '应按累计时长降序');
    });
});
