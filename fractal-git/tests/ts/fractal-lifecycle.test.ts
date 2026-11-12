/**
 * Integration Test: Fractal Git Engine TypeScript Lifecycle
 * File Path: tests/ts/fractal-lifecycle.test.ts
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import {
    createFractalGitEngine,
    FGT_RULES,
    FRACTAL_REF,
    LayerVfsAdapter,
    PraxisGitClient,
    verifyPreReviewZone,
} from '../../ts/index';

test('verifyPreReviewZone rejects conflict markers and empty files', () => {
    const badFiles = [
        { path: 'a.ts', mode: '100644' as const, content: '<<<<<<< HEAD\nfoo\n=======\nbar\n>>>>>>>' },
        { path: 'b.ts', mode: '100644' as const, content: '   ' },
    ];

    const verdict = verifyPreReviewZone(badFiles);
    assert.strictEqual(verdict.passed, false);
    assert.strictEqual(verdict.violations.length, 2);
    assert.strictEqual(verdict.shouldEscalateToL3A, true);
});

test('verifyPreReviewZone approves clean code', () => {
    const cleanFiles = [
        { path: 'clean.ts', mode: '100644' as const, content: 'export const PI = 3.14159;\n' },
    ];

    const verdict = verifyPreReviewZone(cleanFiles);
    assert.strictEqual(verdict.passed, true);
    assert.strictEqual(verdict.score, 100);
});

test('FractalGitEngine materializes commit and updates ref in temp git repo', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'fractal-git-test-'));
    const gitDir = path.join(tmpBase, '.git');
    fs.mkdirSync(gitDir, { recursive: true });

    try {
        const engine = createFractalGitEngine(gitDir);
        const result = engine.materializeCommit({
            targetRef: {
                tier: 'card_worktree',
                gitRef: 'refs/fractal/cell/cell-alpha/card/card-101',
            },
            parentCommitOids: [],
            files: [
                {
                    path: 'src/main.ts',
                    mode: '100644',
                    content: 'console.log("Hello from Fractal Git");\n',
                },
            ],
            message: 'feat(core): initial card commit\n\n[Project: fractal-git]',
            authorName: 'Agent-42',
            authorEmail: 'agent-42@cell-alpha.praxis.local',
        });

        assert.strictEqual(result.commitOid.length, 40);
        assert.strictEqual(result.treeOid.length, 40);

        // Verify ref file written on disk
        const refFile = path.join(gitDir, 'refs/fractal/cell/cell-alpha/card/card-101');
        assert.strictEqual(fs.existsSync(refFile), true);
        const refContent = fs.readFileSync(refFile, 'utf8').trim();
        assert.strictEqual(refContent, result.commitOid);

        // Verify physical workspace reclamation
        const fakeWorktree = path.join(tmpBase, 'worktree-sub');
        fs.mkdirSync(fakeWorktree, { recursive: true });
        assert.strictEqual(fs.existsSync(fakeWorktree), true);

        const reclaim = engine.reclaimWorkspace(
            'ws-sub-1',
            {
                tier: 'subagent_worktree',
                gitRef: 'refs/fractal/cell/cell-alpha/card/card-101/sub/sub-1',
            },
            { physicalDir: fakeWorktree, deleteRef: true },
        );

        assert.strictEqual(reclaim.physicalPathRemoved, true);
        assert.strictEqual(fs.existsSync(fakeWorktree), false);
    } finally {
        fs.rmSync(tmpBase, { recursive: true, force: true });
    }
});

test('PraxisGitClient uses refs/fractal/cells/, resolves parent commit OID, and writes workspace-strict message', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'praxis-client-test-'));
    const gitDir = path.join(tmpBase, '.git');
    fs.mkdirSync(gitDir, { recursive: true });

    try {
        const engine = createFractalGitEngine(gitDir);
        const seedCommit = engine.materializeCommit({
            targetRef: { tier: 'trunk', gitRef: 'refs/heads/main' },
            parentCommitOids: [],
            files: [{ path: 'seed.ts', mode: '100644', content: 'export const seed = 1;\n' }],
            message: 'feat(core): seed trunk commit',
            authorName: 'Seed',
            authorEmail: 'seed@example.invalid',
        });
        fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n', 'utf8');

        const client = new PraxisGitClient(gitDir);
        const handle = client.spawnSubAgentWorktree('cell-1', 'card-2', 'sub-3');
        assert.ok(handle.fractalRef.gitRef.startsWith(FRACTAL_REF.CELLS_PREFIX));

        handle.stageFile('src/feature.ts', 'export const feature = 42;\n');
        const firstResult = handle.submitForPreReview();
        assert.strictEqual(firstResult.targetRef, `${FRACTAL_REF.CELLS_PREFIX}cell-1/card/card-2/sub/sub-3`);

        const rawFirst = execFileSync('git', ['--git-dir', gitDir, 'cat-file', '-p', firstResult.commitOid], {
            encoding: 'utf8',
        });
        assert.ok(rawFirst.includes(`parent ${seedCommit.commitOid}`));
        assert.ok(rawFirst.includes('[Project / 项目归属]'));
        assert.ok(rawFirst.includes('[Why / 动机背景]'));
        assert.ok(rawFirst.includes('[Added / 新增内容]'));
        assert.ok(rawFirst.includes('[Verification / 验证结论]'));

        const secondHandle = client.spawnSubAgentWorktree('cell-1', 'card-2', 'sub-3');
        secondHandle.stageFile('src/feature.ts', 'export const feature = 99;\n');
        const secondResult = secondHandle.submitForPreReview();
        const rawSecond = execFileSync('git', ['--git-dir', gitDir, 'cat-file', '-p', secondResult.commitOid], {
            encoding: 'utf8',
        });
        assert.ok(rawSecond.includes(`parent ${firstResult.commitOid}`));
    } finally {
        fs.rmSync(tmpBase, { recursive: true, force: true });
    }
});

test('LayerVfsAdapter preserves empty string files, deletion tombstones, and exports 36 FGT_RULES', () => {
    const adapter = new LayerVfsAdapter();
    const ingested = adapter.ingestLayerVfsEntries(
        [
            { path: 'src/empty.ts', content: '' },
            { path: 'src/live.ts', content: 'export const ok = true;\n' },
            { path: 'src/removed.ts', content: null },
            { path: 'src/deleted-flag.ts', deleted: true },
            { path: 'outside/skip.ts', content: '' },
        ],
        ['src'],
    );
    assert.strictEqual(ingested, 4);

    const staged = adapter.toStagedCandidates();
    assert.deepStrictEqual(
        staged.map((item) => [item.path, item.content]),
        [
            ['src/empty.ts', ''],
            ['src/live.ts', 'export const ok = true;\n'],
        ],
    );
    assert.deepStrictEqual(adapter.toScopedTombstones(['src']).sort(), ['src/deleted-flag.ts', 'src/removed.ts']);

    // Re-writing a deleted path removes its tombstone
    adapter.writeVirtualFile('src/removed.ts', 'restored\n');
    assert.deepStrictEqual(adapter.toTombstones(), ['src/deleted-flag.ts']);
    assert.strictEqual(Object.keys(FGT_RULES).length, 36);
});
