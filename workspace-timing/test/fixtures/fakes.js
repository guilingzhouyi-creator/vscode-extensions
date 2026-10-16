/**
 * Module: Test Fixtures — Shared In-Memory Fakes and Time Isolation Utilities
 * File Path: test/fixtures/fakes.js
 * Architecture Role: Test infrastructure layer providing high-fidelity reusable in-memory doubles
 *   and deterministic time freezing utilities across workspace-timing test suites.
 * Dependencies & Triggers: Consumes out/domain/models; required by test suites across application, cache, and domain layers.
 * Responsibilities:
 *   1. Provide withFixedNow deterministic system clock freezing for sync and async execution;
 *   2. Provide FakeStorageCoordinator, FakeJournalWriter, FakeRecoveryService, FakeJournalStore, FakeGlobalStore;
 *   3. Provide factory functions for clean test datasets (createEmptyTimingData, createEmptyGlobalData);
 *   4. Enforce strict exit semantics and clean test state isolation.
 * Exit Semantics & Design Rationale: Pure test fixture library exporting deterministic test doubles; zero external production dependencies.
 */
'use strict';

const { createEmptyTimingData } = require('../../out/domain/models.js');

function createEmptyGlobalData() {
    return { version: 1, totalMs: 0, workspaces: {}, lastUpdatedAt: 0 };
}

/**
 * 在固定时刻内运行回调：冻结 Date（覆盖 Date.now() 与 new Date()），
 * 防止用例在午夜前后的前 10~30 分钟执行时跨越自然日边界导致今日累计切分偏差。
 * 支持同步与异步回调函数。
 */
function withFixedNow(iso, fn) {
    const RealDate = Date;
    const fixedMs = new RealDate(iso).getTime();
    class FixedDate extends RealDate {
        constructor(...args) {
            super(...(args.length ? args : [fixedMs]));
        }
        static now() {
            return fixedMs;
        }
    }
    global.Date = FixedDate;
    try {
        const res = fn();
        if (res && typeof res.then === 'function') {
            return res.finally(() => {
                global.Date = RealDate;
            });
        }
        global.Date = RealDate;
        return res;
    } catch (err) {
        global.Date = RealDate;
        throw err;
    }
}

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
    push() {}
    updateFlushInterval() {}
}

class FakeRecoveryService {
    constructor(recoveredData = null) {
        this.recoveredData = recoveredData;
    }
    async recover(retentionDays) {
        if (this.recoveredData) {
            return this.recoveredData;
        }
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

class FakeJournalStore {
    constructor(slices = []) {
        this.slices = [...slices];
        this.appendCalls = [];
        this.truncateCalls = 0;
        this.inFlight = 0;
        this.maxConcurrentAppend = 0;
        this.failAppend = false;
    }
    async exists() { return true; }
    async readJournal() { return [...this.slices]; }
    async truncate() {
        this.slices = [];
        this.truncateCalls++;
    }
    async delete() { this.slices = []; }
    async appendBatch(batch) {
        this.inFlight++;
        this.maxConcurrentAppend = Math.max(this.maxConcurrentAppend, this.inFlight);
        if (this.failAppend) {
            this.inFlight--;
            throw new Error('disk full');
        }
        this.slices.push(...batch);
        this.appendCalls.push([...batch]);
        this.inFlight--;
    }
}

class FakeGlobalStore {
    constructor(initial = null) {
        this.data = initial ?? createEmptyGlobalData();
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
    async delete() { this.data = createEmptyGlobalData(); }
}

module.exports = {
    createEmptyTimingData,
    createEmptyGlobalData,
    withFixedNow,
    FakeStorageCoordinator,
    FakeJournalWriter,
    FakeRecoveryService,
    FakeJournalStore,
    FakeGlobalStore,
};

