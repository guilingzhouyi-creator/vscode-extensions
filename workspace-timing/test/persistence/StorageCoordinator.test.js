/**
 * StorageCoordinator — 三级存储协同单测
 *
 * 直接对编译产物 out/persistence/StorageCoordinator.js 断言，零 VS Code 运行时依赖。
 * 以鸭子类型 Fake 注入三级 Provider（协作者仅要求 load/save/saveAs/delete 形状），
 * 验证：级联写降频、load 兜底优先级、restore 截断 journal、
 *       破坏性安全快照、以及"协调器不改写入参"的无副作用边界。
 */
'use strict';

const assert = require('assert');
const { StorageCoordinator } = require('../../out/persistence/StorageCoordinator.js');

function makeData(totalMs) {
    return {
        version: 2,
        totalMs,
        currentSessionStartMs: 0,
        lastSavedAtMs: 0,
        isEnabled: true,
        sessions: [],
    };
}

/** 可编程 Fake Provider：记录调用；stored 经 setStored 外部可控 */
function makeProvider(name, { initialData = null, failOnSave = false } = {}) {
    const state = { stored: initialData };
    const calls = { saves: [], savesAs: [], deletes: 0, loads: 0 };
    return {
        id: name,
        calls,
        setStored(data) { state.stored = data; },
        async load() {
            calls.loads++;
            return state.stored;
        },
        async save(data) {
            if (failOnSave) throw new Error(name + ' save failed');
            calls.saves.push(data);
            state.stored = data;
        },
        async saveAs(data, fileName) {
            calls.savesAs.push({ data, fileName });
        },
        async delete() {
            calls.deletes++;
            state.stored = null;
        },
    };
}

function makeJournalFake() {
    const calls = { truncates: 0, deletes: 0 };
    return {
        calls,
        async truncate() { calls.truncates++; },
        async delete() { calls.deletes++; },
    };
}

describe('StorageCoordinator（三级存储协同）', () => {
    it('save 级联：主存每次写，JSON 备份每 3 次降频写一次', async () => {
        const primary = makeProvider('primary');
        const fileBackup = makeProvider('fileBackup');
        const coord = new StorageCoordinator(primary, fileBackup, makeJournalFake());

        await coord.save(makeData(1000));
        await coord.save(makeData(2000));
        assert.strictEqual(fileBackup.calls.saves.length, 0, '前两次不写 JSON 备份');

        await coord.save(makeData(3000));
        assert.strictEqual(fileBackup.calls.saves.length, 1, '第 3 次触发降频备份');
        assert.strictEqual(primary.calls.saves.length, 3, '主存每次都写');
    });

    it('save(forceFileBackup) 关键事件绕过降频强制写 JSON 备份', async () => {
        const primary = makeProvider('primary');
        const fileBackup = makeProvider('fileBackup');
        const coord = new StorageCoordinator(primary, fileBackup, makeJournalFake());

        await coord.save(makeData(1), true);
        await coord.save(makeData(2), true);
        assert.strictEqual(fileBackup.calls.saves.length, 2, 'force 每次都写备份');
    });

    it('save 不原地改写调用方入参（协调器无副作用），落盘副本带新时间戳', async () => {
        const primary = makeProvider('primary');
        const coord = new StorageCoordinator(primary, makeProvider('fileBackup'), makeJournalFake());

        const input = makeData(5000);
        const before = input.lastSavedAtMs;
        await coord.save(input);

        assert.strictEqual(input.lastSavedAtMs, before, '入参不得被原地改写');
        assert.ok(primary.calls.saves[0].lastSavedAtMs > 0, '落盘副本应带新时间戳');
        assert.notStrictEqual(primary.calls.saves[0], input, '落盘的应是副本而非同一引用');
    });

    it('load 兜底优先级：主存 → 文件备份 → none，并如实报告来源', async () => {
        const primary = makeProvider('primary', { initialData: makeData(111) });
        const fileBackup = makeProvider('fileBackup', { initialData: makeData(222) });
        const coord = new StorageCoordinator(primary, fileBackup, makeJournalFake());

        let res = await coord.load();
        assert.strictEqual(res.data.totalMs, 111);
        assert.strictEqual(res.source, 'workspaceState');

        primary.setStored(null);
        res = await coord.load();
        assert.strictEqual(res.data.totalMs, 222);
        assert.strictEqual(res.source, 'fileBackup');
    });

    it('load：两级皆无数据时返回 null + none', async () => {
        const coord = new StorageCoordinator(
            makeProvider('primary'), makeProvider('fileBackup'), makeJournalFake());
        const res = await coord.load();
        assert.strictEqual(res.data, null);
        assert.strictEqual(res.source, 'none');
    });

    it('restore：强制级联保存并截断 journal', async () => {
        const primary = makeProvider('primary');
        const fileBackup = makeProvider('fileBackup');
        const journal = makeJournalFake();
        const coord = new StorageCoordinator(primary, fileBackup, journal);

        await coord.restore(makeData(999));
        assert.strictEqual(primary.calls.saves.length, 1);
        assert.strictEqual(fileBackup.calls.saves.length, 1, '还原属关键事件，强制 JSON 备份');
        assert.strictEqual(journal.calls.truncates, 1, '旧 journal 增量对新数据无效，应截断');
    });

    it('deleteAll：三级全部清理', async () => {
        const primary = makeProvider('primary');
        const fileBackup = makeProvider('fileBackup');
        const journal = makeJournalFake();
        const coord = new StorageCoordinator(primary, fileBackup, journal);

        await coord.deleteAll();
        assert.strictEqual(primary.calls.deletes, 1);
        assert.strictEqual(fileBackup.calls.deletes, 1);
        assert.strictEqual(journal.calls.deletes, 1);
    });

    it('snapshotBeforeDestructive：有现网数据时写 before-<op> 快照，无数据时跳过', async () => {
        const fileBackup = makeProvider('fileBackup', { initialData: makeData(777) });
        const coord = new StorageCoordinator(makeProvider('primary'), fileBackup, makeJournalFake());

        await coord.snapshotBeforeDestructive('reset');
        assert.strictEqual(fileBackup.calls.savesAs.length, 1);
        assert.strictEqual(fileBackup.calls.savesAs[0].fileName, 'workspace-timing.before-reset.json');
        assert.strictEqual(fileBackup.calls.savesAs[0].data.totalMs, 777);

        const emptyBackup = makeProvider('emptyBackup');
        const coord2 = new StorageCoordinator(makeProvider('primary'), emptyBackup, makeJournalFake());
        await coord2.snapshotBeforeDestructive('reset');
        assert.strictEqual(emptyBackup.calls.savesAs.length, 0, '无现网数据无需快照');
    });

    it('save 部分失败不抛出、不影响另一路写入（仅告警）', async () => {
        const primary = makeProvider('primary', { failOnSave: true });
        const fileBackup = makeProvider('fileBackup');
        const coord = new StorageCoordinator(primary, fileBackup, makeJournalFake());

        await coord.save(makeData(42), true); // 主存失败不应向上抛
        assert.strictEqual(fileBackup.calls.saves.length, 1, 'JSON 备份不受主存失败影响');
    });
});
