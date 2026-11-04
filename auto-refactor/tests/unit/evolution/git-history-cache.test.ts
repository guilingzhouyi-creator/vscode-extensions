/**
 * Unit tests for the git history batch disk cache.
 *
 * The cache exists to skip a `git log` subprocess on a repeat scan, so the contract under test is
 * narrow and strict: a payload may only be served when version, HEAD, top level and commit ceiling
 * all still match; every other condition must degrade to a miss rather than a throw.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    decodeGitHistoryCache,
    loadGitHistoryCache,
    resolveGitHistoryCachePath,
    saveGitHistoryCache,
    GIT_HISTORY_CACHE_VERSION,
    type GitHistoryCacheKey,
} from '../../../src/core/evolution/git-history-cache';
import type { GitFileHistoryProfile } from '../../../src/core/evolution/git-history-miner';

const KEY: GitHistoryCacheKey = {
    topLevel: '/repo',
    head: 'aaaaaaaaaaaaaaaa',
    commitLimit: 100,
};

function profile(filePath: string): GitFileHistoryProfile {
    return {
        filePath,
        isGitAvailable: true,
        totalCommits: 3,
        bugFixCommits: 1,
        authorCommitCounts: { alice: 3 },
        uniqueAuthorsCount: 1,
        firstSeenTimestamp: 1_700_000_000_000,
        lastModifiedTimestamp: 1_700_000_100_000,
        recentCommits: [
            {
                hash: 'abc123',
                author: 'alice',
                timestamp: 1_700_000_100_000,
                subject: 'fix: repair',
                isBugFix: true,
            },
        ],
    };
}

describe('git-history-cache', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'ghc-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('round-trips a profile map through disk', () => {
        const seeded = new Map([['index.ts', profile('index.ts')]]);
        expect(saveGitHistoryCache(root, KEY, seeded)).toBe(true);

        const loaded = loadGitHistoryCache(root, KEY);
        expect(loaded?.size).toBe(1);
        expect(loaded?.get('index.ts')).toEqual(seeded.get('index.ts'));
    });

    it('rejects a payload mined at a different HEAD', () => {
        saveGitHistoryCache(root, KEY, new Map([['index.ts', profile('index.ts')]]));
        const stale = loadGitHistoryCache(root, { ...KEY, head: 'bbbbbbbbbbbbbbbb' });
        expect(stale).toBeNull();
    });

    it('rejects a payload mined with a different commit ceiling', () => {
        saveGitHistoryCache(root, KEY, new Map([['index.ts', profile('index.ts')]]));
        expect(loadGitHistoryCache(root, { ...KEY, commitLimit: 250 })).toBeNull();
    });

    it('rejects a payload from a different repository', () => {
        saveGitHistoryCache(root, KEY, new Map([['index.ts', profile('index.ts')]]));
        expect(loadGitHistoryCache(root, { ...KEY, topLevel: '/other' })).toBeNull();
    });

    it('rejects a payload written by a different cache version', () => {
        saveGitHistoryCache(root, KEY, new Map([['index.ts', profile('index.ts')]]));
        const cachePath = resolveGitHistoryCachePath(root);
        const payload = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        payload.version = GIT_HISTORY_CACHE_VERSION + 1;
        fs.writeFileSync(cachePath, JSON.stringify(payload));

        expect(loadGitHistoryCache(root, KEY)).toBeNull();
    });

    it('degrades to a miss on corrupt JSON instead of throwing', () => {
        const cachePath = resolveGitHistoryCachePath(root);
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(cachePath, '{not json');

        expect(loadGitHistoryCache(root, KEY)).toBeNull();
        expect(decodeGitHistoryCache('{not json', KEY)).toBeNull();
    });

    it('drops structurally invalid records rather than serving them', () => {
        const raw = JSON.stringify({
            version: GIT_HISTORY_CACHE_VERSION,
            key: KEY,
            profiles: {
                good: profile('good.ts'),
                bad: { filePath: 'bad.ts' },
            },
        });

        const decoded = decodeGitHistoryCache(raw, KEY);
        expect(decoded?.size).toBe(1);
        expect(decoded?.has('good')).toBe(true);
        expect(decoded?.has('bad')).toBe(false);
    });

    it('returns null when every record is invalid', () => {
        const raw = JSON.stringify({
            version: GIT_HISTORY_CACHE_VERSION,
            key: KEY,
            profiles: { bad: { filePath: 'bad.ts' } },
        });
        expect(decodeGitHistoryCache(raw, KEY)).toBeNull();
    });

    it('returns null when the payload file does not exist', () => {
        expect(loadGitHistoryCache(root, KEY)).toBeNull();
    });

    it('replaces the previous payload when a new batch is saved', () => {
        saveGitHistoryCache(root, KEY, new Map([['a.ts', profile('a.ts')]]));
        const nextKey: GitHistoryCacheKey = { ...KEY, head: 'cccccccccccccccc' };
        saveGitHistoryCache(root, nextKey, new Map([['b.ts', profile('b.ts')]]));

        expect(loadGitHistoryCache(root, KEY)).toBeNull();
        const latest = loadGitHistoryCache(root, nextKey);
        expect(latest?.size).toBe(1);
        expect(latest?.has('b.ts')).toBe(true);
    });

    it('leaves no staging files behind after a successful save', () => {
        saveGitHistoryCache(root, KEY, new Map([['a.ts', profile('a.ts')]]));
        const dir = path.dirname(resolveGitHistoryCachePath(root));
        const entries = fs.readdirSync(dir);
        expect(entries.some((name) => name.includes('.tmp-'))).toBe(false);
    });
});
