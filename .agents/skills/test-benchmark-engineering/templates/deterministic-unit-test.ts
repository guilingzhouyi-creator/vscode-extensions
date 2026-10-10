/**
 * Module: Test Engineering — Deterministic Unit Test Template
 * File Path: templates/deterministic-unit-test.ts
 * Architecture Role: Standard blueprint for deterministic unit test suites with
 *   time virtualization, pseudo-random seed isolation, and sandbox resource cleanup.
 * Dependencies & Triggers: Zero external runtime dependencies; uses standard Node.js test runner.
 * Responsibilities:
 *   1. Demonstrate time-mock encapsulation using withFixedNow pattern.
 *   2. Demonstrate PRNG seed reproducibility across test cycles.
 *   3. Enforce deterministic assertion without relying on wall-clock drift.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passing; self-cleaning.
 */

import * as assert from 'assert';

/**
 * Executes a callback with Date.now() pinned to a fixed timestamp.
 *
 * @param fixedTimestampMs - Desired fixed Unix epoch in milliseconds.
 * @param callback - Test logic to execute under fixed time.
 */
export async function withFixedNow<T>(
    fixedTimestampMs: number,
    callback: () => Promise<T> | T,
): Promise<T> {
    const originalNow = Date.now;
    try {
        Date.now = () => fixedTimestampMs;
        return await callback();
    } finally {
        Date.now = originalNow;
    }
}

/**
 * Mulberry32 deterministic 32-bit pseudo-random number generator.
 *
 * @param seed - Seed integer.
 * @returns PRNG function returning float in [0, 1).
 */
export function createSeededRng(seed: number): () => number {
    let state = seed >>> 0;
    return function nextRandom(): number {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Example deterministic test runner demonstrating time and RNG isolation.
 */
export async function runDeterministicSuiteExample(): Promise<void> {
    // 1. Time isolation assertion
    const targetTimeMs = 1700000000000;
    await withFixedNow(targetTimeMs, () => {
        assert.strictEqual(Date.now(), targetTimeMs, 'Clock must exactly equal fixed timestamp');
    });

    // 2. RNG reproducibility assertion
    const rng1 = createSeededRng(12345);
    const rng2 = createSeededRng(12345);
    const val1 = rng1();
    const val2 = rng2();
    assert.strictEqual(val1, val2, 'Identical seed must produce identical PRNG sequence');

    // 3. Wall clock restored
    assert.notStrictEqual(Date.now(), targetTimeMs, 'Original clock must be restored after isolation block');
}

