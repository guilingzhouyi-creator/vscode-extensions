/**
 * Unit tests for the governance score memo.
 *
 * The memo sits on the report's critical path, so the contract pinned here is: keys must change
 * whenever an input that affects `scoreFileQuality` changes, and every malformed payload must
 * degrade to an empty memo instead of throwing or serving a partial record.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    deriveScoreMemoKey,
    loadScoreMemo,
    resolveScoreMemoPath,
    saveScoreMemo,
    SCORE_MEMO_VERSION,
    type ScoreMemoHeader,
} from '../../../src/core/scoring/score-memo';
import type { FileQualityScore } from '../../../src/core/scoring/hierarchicalScorer';
import type { Issue } from '../../../src/core/types';

function issue(overrides: Partial<Issue> = {}): Issue {
    return {
        id: 'analyzer:rule:f.ts:1',
        analyzer: 'complexity',
        rule: 'high-complexity',
        severity: 'warning',
        message: 'Cyclomatic complexity 18 exceeds 15',
        location: { file: 'f.ts', start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        detail: {},
        ...overrides,
    } as Issue;
}

function score(compositeScore: number): FileQualityScore {
    return {
        filePath: 'f.ts',
        domainName: 'core',
        moduleName: 'mod',
        compositeScore,
        eightPillars: { pillars: { architecture: 90 } },
    } as unknown as FileQualityScore;
}

const HEADER: ScoreMemoHeader = { version: SCORE_MEMO_VERSION, configKey: 'cfg-1' };
const SCOPE = { domainName: 'core', moduleName: 'mod' };

describe('score-memo key derivation', () => {
    it('is stable for identical inputs', () => {
        const a = deriveScoreMemoKey('const x = 1;\n', [issue()], SCOPE);
        const b = deriveScoreMemoKey('const x = 1;\n', [issue()], SCOPE);
        expect(a).toBe(b);
    });

    it('changes when the file text changes', () => {
        const a = deriveScoreMemoKey('const x = 1;\n', [issue()], SCOPE);
        const b = deriveScoreMemoKey('const x = 2;\n', [issue()], SCOPE);
        expect(a).not.toBe(b);
    });

    it('changes when a finding changes', () => {
        const a = deriveScoreMemoKey('const x = 1;\n', [issue()], SCOPE);
        const b = deriveScoreMemoKey('const x = 1;\n', [issue({ severity: 'error' })], SCOPE);
        expect(a).not.toBe(b);
    });

    it('changes when a finding disappears', () => {
        expect(deriveScoreMemoKey('x', [issue()], SCOPE)).not.toBe(
            deriveScoreMemoKey('x', [], SCOPE),
        );
    });

    it('changes when the domain label changes', () => {
        const a = deriveScoreMemoKey('x', [issue()], SCOPE);
        const b = deriveScoreMemoKey('x', [issue()], { ...SCOPE, domainName: 'other' });
        expect(a).not.toBe(b);
    });

    it('changes when the module label changes', () => {
        const a = deriveScoreMemoKey('x', [issue()], SCOPE);
        const b = deriveScoreMemoKey('x', [issue()], { ...SCOPE, moduleName: 'other' });
        expect(a).not.toBe(b);
    });

    it('ignores the order findings arrive in', () => {
        const first = issue({ id: 'a:r:f.ts:1' });
        const second = issue({
            id: 'a:r:f.ts:9',
            location: { file: 'f.ts', start: { line: 9, column: 0 }, end: { line: 9, column: 1 } },
        });
        expect(deriveScoreMemoKey('x', [first, second], SCOPE)).toBe(
            deriveScoreMemoKey('x', [second, first], SCOPE),
        );
    });

    it('separates text from findings unambiguously', () => {
        // Concatenating without a separator would let these two collide.
        const a = deriveScoreMemoKey('ab', [], SCOPE);
        const b = deriveScoreMemoKey('a', [], SCOPE);
        expect(a).not.toBe(b);
    });
});

describe('score-memo persistence', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('round-trips scores through disk', () => {
        const memo = new Map([['k1', score(97)]]);
        expect(saveScoreMemo(root, HEADER, memo)).toBe(true);

        const loaded = loadScoreMemo(root, HEADER);
        expect(loaded.size).toBe(1);
        expect(loaded.get('k1')).toEqual(memo.get('k1'));
    });

    it('rejects a payload produced under different scoring configuration', () => {
        saveScoreMemo(root, HEADER, new Map([['k1', score(97)]]));
        expect(loadScoreMemo(root, { ...HEADER, configKey: 'cfg-2' }).size).toBe(0);
    });

    it('rejects a payload written by a different memo version', () => {
        saveScoreMemo(root, HEADER, new Map([['k1', score(97)]]));
        expect(loadScoreMemo(root, { ...HEADER, version: SCORE_MEMO_VERSION + 1 }).size).toBe(0);
    });

    it('returns an empty memo when nothing is on disk', () => {
        expect(loadScoreMemo(root, HEADER).size).toBe(0);
    });

    it('degrades to an empty memo on corrupt JSON', () => {
        const memoPath = resolveScoreMemoPath(root);
        fs.mkdirSync(path.dirname(memoPath), { recursive: true });
        fs.writeFileSync(memoPath, '{broken');
        expect(loadScoreMemo(root, HEADER).size).toBe(0);
    });

    it('drops records that lack the fields the report reads', () => {
        const memoPath = resolveScoreMemoPath(root);
        fs.mkdirSync(path.dirname(memoPath), { recursive: true });
        fs.writeFileSync(
            memoPath,
            JSON.stringify({
                version: SCORE_MEMO_VERSION,
                configKey: HEADER.configKey,
                scores: { good: score(90), bad: { filePath: 'f.ts' } },
            }),
        );

        const loaded = loadScoreMemo(root, HEADER);
        expect(loaded.size).toBe(1);
        expect(loaded.has('good')).toBe(true);
        expect(loaded.has('bad')).toBe(false);
    });

    it('refuses to write an empty memo, so a failed pass cannot erase a good payload', () => {
        saveScoreMemo(root, HEADER, new Map([['k1', score(97)]]));
        expect(saveScoreMemo(root, HEADER, new Map())).toBe(false);
        expect(loadScoreMemo(root, HEADER).size).toBe(1);
    });

    it('leaves no staging files behind', () => {
        saveScoreMemo(root, HEADER, new Map([['k1', score(97)]]));
        const dir = path.dirname(resolveScoreMemoPath(root));
        expect(fs.readdirSync(dir).some((name) => name.includes('.tmp-'))).toBe(false);
    });
});
