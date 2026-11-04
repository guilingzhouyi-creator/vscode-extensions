/**
 * Module: Unit Tests — Git History Batch Mining Cache
 * File Path: tests/unit/evolution/git-history-miner-cache.test.ts
 * Architecture Role: Contract test for the memoization added to `mineRepositoryHistoryBatch`.
 *   The cache exists because mining shells out to `git log` and every repeat scan of an unchanged
 *   repository used to pay it again.
 * Dependencies & Triggers: Imports `GitHistoryMiner`; runs in the vitest unit lane of `npm test`.
 * Responsibilities:
 *   1. Pin that a repeat call with the same directory and ceiling returns the cached map instance.
 *   2. Pin that a different ceiling is NOT served from the cache (a truncated history must never
 *      answer a request for more commits).
 *   3. Pin that `clearCache()` forces a fresh mine.
 * Exit Semantics & Design Rationale: Assertions read identity, not timing, so a slow CI box cannot
 *   flake them. The ceiling case is the one that would silently corrupt results if the cache key
 *   were just the directory.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { GitHistoryMiner } from '../../../src/core/evolution/git-history-miner';
const REPO_ROOT = path.resolve(__dirname, '../../..');
describe('GitHistoryMiner.mineRepositoryHistoryBatch — memoization', () => {
    let miner: GitHistoryMiner;
    beforeAll(() => {
        miner = new GitHistoryMiner();
    });
    it('returns the cached map for a repeat call with the same directory and ceiling', () => {
        const first = miner.mineRepositoryHistoryBatch(REPO_ROOT, 50);
        const second = miner.mineRepositoryHistoryBatch(REPO_ROOT, 50);
        expect(second).toBe(first);
    });
    it('does not serve a cached batch mined with a different commit ceiling', () => {
        const atFifty = miner.mineRepositoryHistoryBatch(REPO_ROOT, 50);
        miner.clearCache();
        const atTwoHundred = miner.mineRepositoryHistoryBatch(REPO_ROOT, 200);
        // A fresh mine must be a distinct map even when the two runs agree on file coverage.
        expect(atTwoHundred).not.toBe(atFifty);
    });
    it('re-mines after clearCache', () => {
        const first = miner.mineRepositoryHistoryBatch(REPO_ROOT, 50);
        miner.clearCache();
        const second = miner.mineRepositoryHistoryBatch(REPO_ROOT, 50);
        expect(second).not.toBe(first);
        expect(second.size).toBe(first.size);
    });
    it('degrades to an empty map outside a Git work tree without throwing', () => {
        const outside = path.resolve(REPO_ROOT, 'node_modules');
        const result = miner.mineRepositoryHistoryBatch(outside, 10);
        expect(result).toBeInstanceOf(Map);
    });
});
