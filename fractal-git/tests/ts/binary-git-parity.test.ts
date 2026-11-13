/**
 * Test: Real Binary Taxis vs Git Plumbing Parity Suite
 * File Path: tests/ts/binary-git-parity.test.ts
 * Architecture Role: Exercises the compiled `taxis` binary alongside system `git` in
 *   independent isolated repositories and verifies fail-closed semantics of `validate-git-parity.js`.
 * Dependencies & Triggers: Requires `node:test`, `git`, and a compiled `taxis` executable
 *   (unless absent without `TAXIS_REQUIRE_TAXIS=1`); invoked via `npm --prefix fractal-git test`.
 * Responsibilities:
 *   1. Prove `validate-git-parity.js` fails closed on invalid `--taxis-bin` or missing `--require-taxis`.
 *   2. Drive `taxis` and `git` independently across blob, tree, commit, and tag plumbing objects.
 *   3. Assert OID parity, decompressed loose-object byte parity, `ls-tree` order parity, and `git fsck --strict`.
 */

import * as assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import * as zlib from 'node:zlib';

const PARITY_SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'common', 'validate-git-parity.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function resolveTaxisBinary(): string | null {
    const exeName = process.platform === 'win32' ? 'taxis.exe' : 'taxis';
    const bases = [
        process.env.CARGO_TARGET_DIR,
        path.join(os.tmpdir(), 'taxis-cargo-target'),
        path.join(REPO_ROOT, 'fractal-git', 'target'),
        path.join(REPO_ROOT, 'target'),
    ].filter((x): x is string => Boolean(x));
    const candidates = bases.flatMap((b) => [path.join(b, 'release', exeName), path.join(b, 'debug', exeName)]);
    if (process.env.TAXIS_BIN) candidates.unshift(path.resolve(process.env.TAXIS_BIN));
    return candidates.find((c) => fs.existsSync(c) && spawnSync(c, ['version'], { stdio: 'ignore' }).status === 0) ?? null;
}

function runPlumbing(bin: string, gitDir: string, args: string[], input?: Buffer, env?: NodeJS.ProcessEnv): string {
    return execFileSync(bin, ['--git-dir', gitDir, ...args], { input, env }).toString('utf8').trim();
}

function readLooseInflated(gitDir: string, oid: string): Buffer {
    const objPath = path.join(gitDir, 'objects', oid.slice(0, 2), oid.slice(2));
    assert.ok(fs.existsSync(objPath), `expected loose object at ${objPath}`);
    return zlib.inflateSync(fs.readFileSync(objPath));
}

test('validate-git-parity.js fails closed when --taxis-bin points to a missing path', () => {
    const missing = path.join(os.tmpdir(), `nonexistent-taxis-${process.pid}-${Date.now()}`);
    const res = spawnSync(process.execPath, [PARITY_SCRIPT, '--taxis-bin', missing], { encoding: 'utf8' });
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /BLOCK:/);
});

test('validate-git-parity.js refuses silent skip when --require-taxis is passed without binary', () => {
    const res = spawnSync(process.execPath, [PARITY_SCRIPT, '--require-taxis', '--no-auto-target'], {
        encoding: 'utf8',
        env: { ...process.env, TAXIS_BIN: undefined },
    });
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /BLOCK: --require-taxis/);
});

test('real taxis and git binaries produce byte-identical blob, tree, commit, and tag objects', (t) => {
    if (spawnSync('git', ['--version'], { stdio: 'ignore' }).status !== 0) {
        assert.strictEqual(process.env.TAXIS_REQUIRE_GIT, undefined, 'git is required');
        t.skip('git binary unavailable');
        return;
    }
    const taxisBin = resolveTaxisBinary();
    if (!taxisBin) {
        assert.strictEqual(process.env.TAXIS_REQUIRE_TAXIS, undefined, 'taxis is required');
        t.skip('taxis binary not built');
        return;
    }

    const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-bin-git-'));
    const taxisDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-bin-taxis-'));
    const fixedEnv: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_AUTHOR_NAME: 'Parity Author',
        GIT_AUTHOR_EMAIL: 'parity@example.com',
        GIT_AUTHOR_DATE: '1700000000 +0800',
        GIT_COMMITTER_NAME: 'Parity Committer',
        GIT_COMMITTER_EMAIL: 'parity@example.com',
        GIT_COMMITTER_DATE: '1700000000 +0800',
    };

    try {
        execFileSync('git', ['init', '--quiet', '--bare', gitDir], { stdio: 'ignore' });
        execFileSync('git', ['init', '--quiet', '--bare', taxisDir], { stdio: 'ignore' });
        const files = [
            { name: 'foo-bar', mode: '100644', content: 'dash\n' },
            { name: 'foo.c', mode: '100644', content: 'int main(void) { return 0; }\n' },
            { name: 'run.sh', mode: '100755', content: '#!/bin/sh\necho ok\n' },
            { name: '阶段.md', mode: '100644', content: '# 阶段测试\n' },
        ];
        const mktreeLines: string[] = [];
        for (const f of files) {
            const payload = Buffer.from(f.content, 'utf8');
            const gitBlob = runPlumbing('git', gitDir, ['hash-object', '-w', '--stdin'], payload);
            const taxisBlob = runPlumbing(taxisBin, taxisDir, ['hash-object', '-w', '--stdin'], payload);
            assert.strictEqual(taxisBlob, gitBlob, `blob OID parity for ${f.name}`);
            assert.deepStrictEqual(readLooseInflated(taxisDir, taxisBlob), readLooseInflated(gitDir, gitBlob));
            mktreeLines.push(`${f.mode} blob ${gitBlob}\t${f.name}\n`);
        }

        const gitTree = runPlumbing('git', gitDir, ['mktree'], Buffer.from(mktreeLines.join(''), 'utf8'));
        const taxisTree = runPlumbing(taxisBin, taxisDir, ['mktree'], Buffer.from(mktreeLines.slice().reverse().join(''), 'utf8'));
        assert.strictEqual(taxisTree, gitTree, 'tree OID parity');
        assert.deepStrictEqual(readLooseInflated(taxisDir, taxisTree), readLooseInflated(gitDir, gitTree));
        assert.strictEqual(
            runPlumbing(taxisBin, taxisDir, ['ls-tree', taxisTree]),
            runPlumbing('git', gitDir, ['-c', 'core.quotepath=false', 'ls-tree', gitTree]),
            'ls-tree order parity'
        );

        const commitMsg = Buffer.from('test(parity): binary commit equivalence\n', 'utf8');
        const gitCommit = runPlumbing('git', gitDir, ['commit-tree', gitTree], commitMsg, fixedEnv);
        const taxisCommit = runPlumbing(taxisBin, taxisDir, ['commit-tree', taxisTree], commitMsg, fixedEnv);
        assert.strictEqual(taxisCommit, gitCommit, 'commit OID parity');
        assert.deepStrictEqual(readLooseInflated(taxisDir, taxisCommit), readLooseInflated(gitDir, gitCommit));

        const tagBuf = Buffer.from(`object ${gitCommit}\ntype commit\ntag v1.0.0\ntagger Parity Tagger <parity@example.com> 1700000000 +0800\n\nbinary tag\n`, 'utf8');
        const gitTag = runPlumbing('git', gitDir, ['mktag'], tagBuf);
        const taxisTag = runPlumbing(taxisBin, taxisDir, ['mktag'], tagBuf);
        assert.strictEqual(taxisTag, gitTag, 'tag OID parity');
        assert.deepStrictEqual(readLooseInflated(taxisDir, taxisTag), readLooseInflated(gitDir, gitTag));
        execFileSync('git', ['--git-dir', taxisDir, 'fsck', '--strict', '--full'], { stdio: 'pipe' });
    } finally {
        fs.rmSync(gitDir, { recursive: true, force: true });
        fs.rmSync(taxisDir, { recursive: true, force: true });
    }
});
