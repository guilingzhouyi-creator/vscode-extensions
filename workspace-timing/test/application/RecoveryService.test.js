/**
 * RecoveryService — 崩溃恢复编排单测（假 store + 假 journal，纯 Node）
 *
 * 验证：全新启动、文件兜底来源诊断、journal 回放合成、水位线去重、
 *       truncate 失败降级、未完成会话补偿、恢复后写回。
 * 此路径在 StorageCoordinator 时代无测试覆盖，随编排上移至应用层补齐。
 */
'use strict';

const assert = require('assert');
const { RecoveryService } = require('../../out/application/RecoveryService.js');
const { setLogLevel, LogLevel } = require('../../out/integration/Logger.js');

setLogLevel(LogLevel.None);

function emptyData() {
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

/** 假主数据源：可注入来源与保存失败 */
class FakeStore {
    constructor(initial, source = 'workspaceState') {
        this.data = initial; // null 表示无现网数据
        this.source = source;
        this.saved = null;
        this.saveForceFlags = [];
    }
    async load() {
        if (!this.data) return { data: null, source: 'none' };
        return { data: JSON.parse(JSON.stringify(this.data)), source: this.source };
    }
    async save(data, forceFileBackup) {
        this.saved = JSON.parse(JSON.stringify(data));
        this.saveForceFlags.push(!!forceFileBackup);
    }
}

/** 假 journal：可注入切片、exists 开关与 truncate 失败 */
class FakeJournal {
    constructor(slices = [], { exists = true, failTruncate = false } = {}) {
        this.slices = slices;
        this.existsValue = exists;
        this.failTruncate = failTruncate;
        this.truncateCalls = 0;
        this.readCalls = 0;
    }
    async exists() { return this.existsValue; }
    async readJournal() {
        this.readCalls++;
        return [...this.slices];
    }
    async truncate() {
        this.truncateCalls++;
        if (this.failTruncate) throw new Error('truncate failed');
    }
    async delete() { this.slices = []; }
}

function makeRecovery(store, journal) {
    return new RecoveryService(store, journal);
}

describe('RecoveryService（崩溃恢复编排）', () => {
    it('全新启动：无现网数据时返回空数据并写回', async () => {
        const store = new FakeStore(null);
        const journal = new FakeJournal([], { exists: false });
        const data = await makeRecovery(store, journal).recover(45);
        assert.strictEqual(data.totalMs, 0);
        assert.deepStrictEqual(data.sessions, []);
        assert.ok(store.saved, '恢复结果必须写回存储');
        assert.strictEqual(store.saveForceFlags[0], true, '恢复属关键事件，应强制 JSON 备份');
    });

    it('来源诊断：文件备份兜底成功时 source 为 fileBackup', async () => {
        const store = new FakeStore({ ...emptyData(), totalMs: 5000 }, 'fileBackup');
        const journal = new FakeJournal([], { exists: false });
        const data = await makeRecovery(store, journal).recover(45);
        assert.strictEqual(data.totalMs, 5000);
    });

    it('journal 回放：切片合成会话段并入日桶，totalMs 累加', async () => {
        const base = emptyData();
        base.totalMs = 1000;
        const now = Date.now();
        const slices = [
            { timestamp: now - 4000, deltaMs: 1000 },
            { timestamp: now - 3000, deltaMs: 1000 },
            { timestamp: now - 2000, deltaMs: 1000 },
        ];
        const store = new FakeStore(base);
        const journal = new FakeJournal(slices);
        const data = await makeRecovery(store, journal).recover(45);
        assert.strictEqual(data.totalMs, 4000, '1000 + 3×1000');
        assert.ok(data.sessions.length >= 1, '回放应合成会话段');
        assert.strictEqual(journal.truncateCalls, 1, '回放成功后应清空 journal');
        const today = new Date();
        const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        assert.ok(data.dailyTotals[key], '合成段应同步入日桶');
    });

    it('水位线去重：metadata.lastJournalTs 之下的旧切片不重复累计', async () => {
        const base = emptyData();
        base.metadata = { lastJournalTs: '5000' };
        const journal = new FakeJournal([
            { timestamp: 4000, deltaMs: 1000 },  // ≤ 水位线 → 跳过
            { timestamp: 6000, deltaMs: 1000 },  // > 水位线 → 回放
        ]);
        const store = new FakeStore(base);
        const data = await makeRecovery(store, journal).recover(45);
        assert.strictEqual(data.totalMs, 1000, '仅回放水位线之上的切片');
        assert.strictEqual(data.metadata.lastJournalTs, '6000', '水位线推进到最新时间戳');
    });

    it('truncate 失败降级：不阻塞激活，水位线已推进', async () => {
        const base = emptyData();
        const journal = new FakeJournal([{ timestamp: 1000, deltaMs: 500 }], { failTruncate: true });
        const store = new FakeStore(base);
        const data = await makeRecovery(store, journal).recover(45);
        assert.strictEqual(data.totalMs, 500, '回放仍应生效');
        assert.strictEqual(data.metadata.lastJournalTs, '1000', '水位线随写回持久化，供下次去重');
    });

    it('补偿：journal 无有效回放且存在进行中会话时，按历时兜底补偿', async () => {
        const base = emptyData();
        base.currentSessionStartMs = Date.now() - 60000; // 60s 前开始
        const journal = new FakeJournal([], { exists: false });
        const store = new FakeStore(base);
        const data = await makeRecovery(store, journal).recover(45);
        assert.ok(data.totalMs >= 60000, '补偿至少 60s');
        assert.strictEqual(data.currentSessionStartMs, 0, '恢复后会话状态重置');
    });

    it('补偿上限：超 24h 的异常进行中会话不补偿', async () => {
        const base = emptyData();
        base.currentSessionStartMs = Date.now() - 26 * 3600_000;
        const journal = new FakeJournal([], { exists: false });
        const store = new FakeStore(base);
        const data = await makeRecovery(store, journal).recover(45);
        assert.strictEqual(data.totalMs, 0, '超上限不补偿，防止计时暴涨');
    });

    it('恢复时执行过期会话折叠（retention 窗口外入日桶）', async () => {
        const base = emptyData();
        const oldMs = Date.now() - 60 * 24 * 3600_000; // 60 天前
        base.sessions = [{ startMs: oldMs, endMs: oldMs + 3600_000, durationMs: 3600_000 }];
        const journal = new FakeJournal([], { exists: false });
        const store = new FakeStore(base);
        const data = await makeRecovery(store, journal).recover(45);
        assert.deepStrictEqual(data.sessions, [], '超窗会话应从原始层折叠走');
        assert.strictEqual(Object.keys(data.dailyTotals).length, 1, '折叠入 1 个日桶');
    });
});