/**
 * Integration Test: Fractal Git Engine TypeScript Lifecycle
 * File Path: tests/ts/fractal-lifecycle.test.ts
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { createFractalGitEngine, verifyPreReviewZone } from '../../ts/index';

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
            fakeWorktree,
            true,
        );

        assert.strictEqual(reclaim.physicalPathRemoved, true);
        assert.strictEqual(fs.existsSync(fakeWorktree), false);
    } finally {
        fs.rmSync(tmpBase, { recursive: true, force: true });
    }
});
