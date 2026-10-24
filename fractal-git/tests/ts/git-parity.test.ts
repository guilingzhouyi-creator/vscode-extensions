/**
 * Test: Git Object Byte-Parity Differential Suite
 * File Path: tests/ts/git-parity.test.ts
 * Architecture Role: Locks the pure-TypeScript object engine to real Git plumbing as an oracle:
 *   identical blobs, trees, and commits prove FGT-ALG-001 Git binary equivalence.
 * Dependencies & Triggers: Requires a git executable on PATH; skips with an explicit reason when
 *   git is unavailable instead of silently claiming parity.
 * Responsibilities: Compare tree/commit object ids produced by materializeCommitPure against
 *   git hash-object, git update-index plus git write-tree, and git commit-tree, and prove the
 *   resulting object database passes git fsck --strict.
 * Exit Semantics & Design Rationale: Fixed identities, timestamps, and TZ make object ids
 *   deterministic; each corpus runs in throwaway repositories so no shared state can mask
 *   divergence.
 */

import * as assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { GIT_FILE_MODE } from '../../ts/constants';
import type {
    FractalCommitMeta,
    GitSignature,
    MaterializeCommitRequest,
    MaterializeCommitResult,
    StagedFileEntry,
} from '../../ts/contracts';
import { materializeCommitPure } from '../../ts/native-binding';

/** One differential corpus consumed by both the TypeScript engine and the git oracle. */
interface ParityCorpus {
    readonly caseName: string;
    readonly files: readonly StagedFileEntry[];
    readonly message: string;
    readonly agentMeta?: FractalCommitMeta;
}

/** Throwaway repository used either by the git oracle or by the TypeScript engine. */
interface ParityRepo {
    readonly root: string;
    readonly gitDir: string;
    readonly env: NodeJS.ProcessEnv;
}

/** Ref advanced by every TypeScript materialization so fsck can reach the produced objects. */
const PARITY_REF = 'refs/fractal/cell/cell-parity/card/card-parity';

/** Fixed identity shared by the TypeScript implementation and the git oracle. */
const PARITY_AUTHOR: GitSignature = {
    name: 'Parity Agent',
    email: 'parity-agent@fractal-git.local',
    timestampSec: 1_700_000_000,
    tzOffset: '+0000',
};

/** Fixed dual-faced metadata so the Praxis trailer bytes are deterministic too. */
const PARITY_META: FractalCommitMeta = {
    cardContext: { cardId: 'card-parity', cellId: 'cell-parity', agentUid: 'agent-parity' },
    qualityScore: 0.98,
    gateStatus: 'approved',
    timestampMs: 1_700_000_000_000,
    astImpactSymbols: ['materializeCommitPure', 'buildCommitPayload'],
};

/**
 * Detects whether the git CLI oracle is runnable in this environment.
 *
 * @returns An explicit skip reason, or false when git is available.
 */
function detectGitSkipReason(): string | false {
    const probe = spawnSync('git', ['--version'], { encoding: 'utf8' });
    if (probe.error) {
        return `git executable unavailable (${probe.error.message}); install git to run the differential parity suite`;
    }
    if (probe.status !== 0) {
        return `git --version exited with code ${String(probe.status)}; install git to run the differential parity suite`;
    }
    return false;
}

/** Explicit skip reason shared by every differential test, or false when runnable. */
const GIT_SKIP_REASON = detectGitSkipReason();

/**
 * Builds the deterministic environment shared by every oracle invocation.
 */
function parityEnv(): NodeJS.ProcessEnv {
    const fixedDate = `@${PARITY_AUTHOR.timestampSec} +0000`;
    return {
        ...process.env,
        TZ: 'UTC',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: PARITY_AUTHOR.name,
        GIT_AUTHOR_EMAIL: PARITY_AUTHOR.email,
        GIT_AUTHOR_DATE: fixedDate,
        GIT_COMMITTER_NAME: PARITY_AUTHOR.name,
        GIT_COMMITTER_EMAIL: PARITY_AUTHOR.email,
        GIT_COMMITTER_DATE: fixedDate,
    };
}

/**
 * Compares two strings by UTF-16 code unit order (locale independent).
 */
function compareText(left: string, right: string): number {
    if (left < right) {
        return -1;
    }
    return left > right ? 1 : 0;
}

/**
 * Creates a throwaway repository under a fresh temporary directory.
 */
function createParityRepo(label: string): ParityRepo {
    const slug = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `fractal-git-parity-${slug}-`));
    const env = parityEnv();
    const init = spawnSync('git', ['init', '--quiet', '--initial-branch=parity'], {
        cwd: root,
        env,
        encoding: 'utf8',
    });
    if (init.status !== 0) {
        fs.rmSync(root, { recursive: true, force: true });
        throw new Error(`git init failed in '${root}': ${init.stderr}`);
    }
    return { root, gitDir: path.join(root, '.git'), env };
}

/**
 * Removes a throwaway repository, tolerating partial setup failures.
 */
function disposeParityRepo(repo: ParityRepo | undefined): void {
    if (repo) {
        fs.rmSync(repo.root, { recursive: true, force: true });
    }
}

/**
 * Runs one git command in a repository and fails loudly on any non-zero exit.
 *
 * @returns Trimmed standard output.
 */
function runGit(repo: ParityRepo, args: readonly string[], stdin?: string | Buffer): string {
    const result = spawnSync('git', [...args], {
        cwd: repo.root,
        env: repo.env,
        encoding: 'utf8',
        input: stdin,
    });
    if (result.error) {
        throw new Error(`git ${args.join(' ')} failed to start: ${result.error.message}`);
    }
    assert.strictEqual(result.status, 0, `git ${args.join(' ')} exited with code ${String(result.status)}: ${result.stderr}`);
    return result.stdout.trim();
}

/**
 * Hashes and persists one payload through the git oracle.
 *
 * @returns Blob object id computed by git hash-object.
 */
function oracleBlobOid(repo: ParityRepo, content: Uint8Array | string): string {
    const payload = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    return runGit(repo, ['hash-object', '-w', '--stdin'], payload);
}

/**
 * Resolves the index object id for one staged entry (gitlink target vs content blob).
 */
function oracleEntryOid(repo: ParityRepo, file: StagedFileEntry): string {
    if (file.mode === GIT_FILE_MODE.GITLINK) {
        return String(file.content).trim().toLowerCase();
    }
    return oracleBlobOid(repo, file.content);
}

/**
 * Stages every corpus file through the git index and returns the oracle root tree id.
 */
function oracleTreeOid(repo: ParityRepo, files: readonly StagedFileEntry[]): string {
    runGit(repo, ['read-tree', '--empty']);
    for (const file of files) {
        const entryOid = oracleEntryOid(repo, file);
        runGit(repo, ['update-index', '--add', '--cacheinfo', `${file.mode},${entryOid},${file.path}`]);
    }
    return runGit(repo, ['write-tree']);
}

/**
 * Creates the oracle commit for a tree, message section, and parent ids.
 *
 * The message section is fed on stdin followed by exactly one newline, which mirrors the
 * canonical commit payload produced by the TypeScript engine.
 */
function oracleCommitOid(
    repo: ParityRepo,
    treeOid: string,
    parentOids: readonly string[],
    messageSection: string,
): string {
    const args = ['commit-tree', treeOid];
    for (const parentOid of parentOids) {
        args.push('-p', parentOid);
    }
    return runGit(repo, args, `${messageSection}\n`);
}

/**
 * Renders the commit message section the TypeScript engine must hash.
 *
 * Stated independently of the implementation: the message verbatim, then the Praxis trailer
 * after one blank line when agent metadata is present.
 */
function expectedMessageSection(corpus: ParityCorpus): string {
    if (!corpus.agentMeta) {
        return corpus.message;
    }
    return `${corpus.message}\n\nPraxis-Agent-Meta: ${JSON.stringify(corpus.agentMeta)}`;
}

/**
 * Builds one staged file entry for a corpus.
 */
function stagedFile(
    entryPath: string,
    content: string,
    mode: StagedFileEntry['mode'] = GIT_FILE_MODE.REGULAR,
): StagedFileEntry {
    return { path: entryPath, mode, content };
}

/**
 * Runs the pure-TypeScript engine against one corpus.
 */
function materializeWithTs(
    repo: ParityRepo,
    corpus: ParityCorpus,
    parentOids: readonly string[],
): MaterializeCommitResult {
    return materializeCommitPure(repo.gitDir, {
        targetRef: { tier: 'card_worktree', gitRef: PARITY_REF },
        parentCommitOids: parentOids,
        files: corpus.files,
        message: corpus.message,
        authorName: PARITY_AUTHOR.name,
        authorEmail: PARITY_AUTHOR.email,
        authorSignature: PARITY_AUTHOR,
        committerSignature: PARITY_AUTHOR,
        agentMeta: corpus.agentMeta,
    });
}

/**
 * Asserts the produced tree lists exactly the corpus paths with their declared modes.
 */
function assertTreeStructure(repo: ParityRepo, treeOid: string, files: readonly StagedFileEntry[]): void {
    const listing = runGit(repo, ['-c', 'core.quotePath=false', 'ls-tree', '-r', treeOid]);
    const rows = listing.length === 0 ? [] : listing.split('\n');
    const observed = rows.map((row) => {
        const match = /^([0-7]{5,6}) \w+ ([0-9a-f]{40})\t(.+)$/.exec(row);
        assert.ok(match, `unexpected ls-tree row: ${row}`);
        return `${match[1]} ${match[3]}`;
    });
    const expected = files.map((file) => `${file.mode} ${file.path}`);
    assert.deepStrictEqual(observed.sort(compareText), expected.sort(compareText), 'ls-tree projection diverged from corpus');
}

/**
 * Asserts the repository passes git fsck --strict with no integrity findings.
 */
function assertFsckClean(repo: ParityRepo): void {
    runGit(repo, ['fsck', '--strict', '--no-progress']);
}

/**
 * Asserts git prints the same commit object for the oracle and TypeScript repositories.
 */
function assertCommitDisplayParity(oracleRepo: ParityRepo, tsRepo: ParityRepo, commitOid: string): void {
    const oracleDisplay = runGit(oracleRepo, ['cat-file', '-p', commitOid]);
    const tsDisplay = runGit(tsRepo, ['cat-file', '-p', commitOid]);
    assert.strictEqual(tsDisplay, oracleDisplay, 'git cat-file rendering diverged from the oracle');
}

/**
 * Asserts full object-id, tree-shape, and fsck parity for one corpus.
 */
function assertCorpusParity(corpus: ParityCorpus): void {
    let oracleRepo: ParityRepo | undefined;
    let tsRepo: ParityRepo | undefined;
    try {
        oracleRepo = createParityRepo(`oracle-${corpus.caseName}`);
        tsRepo = createParityRepo(`ts-${corpus.caseName}`);
        const treeOid = oracleTreeOid(oracleRepo, corpus.files);
        const tsResult = materializeWithTs(tsRepo, corpus, []);
        assert.strictEqual(tsResult.treeOid, treeOid, `root tree id diverged for '${corpus.caseName}'`);
        const commitOid = oracleCommitOid(oracleRepo, treeOid, [], expectedMessageSection(corpus));
        assert.strictEqual(tsResult.commitOid, commitOid, `commit id diverged for '${corpus.caseName}'`);
        assertTreeStructure(tsRepo, tsResult.treeOid, corpus.files);
        assertCommitDisplayParity(oracleRepo, tsRepo, commitOid);
        assertFsckClean(tsRepo);
    } finally {
        disposeParityRepo(oracleRepo);
        disposeParityRepo(tsRepo);
    }
}

/**
 * Asserts parity for a merge-shaped commit whose header carries two parent lines.
 */
function assertParentChainParity(): void {
    let oracleRepo: ParityRepo | undefined;
    let tsRepo: ParityRepo | undefined;
    const baseCorpus: ParityCorpus = {
        caseName: 'parent base',
        files: [stagedFile('base.txt', 'base payload\n')],
        message: 'test(parity): base commit',
    };
    const sideCorpus: ParityCorpus = {
        caseName: 'parent side',
        files: [stagedFile('side.txt', 'side payload\n')],
        message: 'test(parity): side commit',
    };
    const mergeCorpus: ParityCorpus = {
        caseName: 'parent merge',
        files: [stagedFile('README.md', 'merge payload\n'), stagedFile('src/main.ts', 'export const merged = true;\n')],
        message: 'test(parity): merge commit',
        agentMeta: PARITY_META,
    };
    try {
        oracleRepo = createParityRepo('oracle-parents');
        tsRepo = createParityRepo('ts-parents');
        const baseTreeOid = oracleTreeOid(oracleRepo, baseCorpus.files);
        const baseCommitOid = oracleCommitOid(oracleRepo, baseTreeOid, [], expectedMessageSection(baseCorpus));
        const sideTreeOid = oracleTreeOid(oracleRepo, sideCorpus.files);
        const sideCommitOid = oracleCommitOid(oracleRepo, sideTreeOid, [], expectedMessageSection(sideCorpus));

        const tsBase = materializeWithTs(tsRepo, baseCorpus, []);
        assert.strictEqual(tsBase.treeOid, baseTreeOid, 'base tree id diverged');
        assert.strictEqual(tsBase.commitOid, baseCommitOid, 'base commit id diverged');
        const tsSide = materializeWithTs(tsRepo, sideCorpus, []);
        assert.strictEqual(tsSide.treeOid, sideTreeOid, 'side tree id diverged');
        assert.strictEqual(tsSide.commitOid, sideCommitOid, 'side commit id diverged');

        const mergeTreeOid = oracleTreeOid(oracleRepo, mergeCorpus.files);
        const mergeCommitOid = oracleCommitOid(
            oracleRepo,
            mergeTreeOid,
            [baseCommitOid, sideCommitOid],
            expectedMessageSection(mergeCorpus),
        );
        const tsMerge = materializeWithTs(tsRepo, mergeCorpus, [baseCommitOid, sideCommitOid]);
        assert.strictEqual(tsMerge.treeOid, mergeTreeOid, 'merge tree id diverged');
        assert.strictEqual(tsMerge.commitOid, mergeCommitOid, 'merge commit id diverged');
        assertCommitDisplayParity(oracleRepo, tsRepo, mergeCommitOid);
        assertFsckClean(tsRepo);
    } finally {
        disposeParityRepo(oracleRepo);
        disposeParityRepo(tsRepo);
    }
}

/**
 * Builds a minimal commit request used by staged-path validation tests.
 */
function validationRequest(files: readonly StagedFileEntry[]): MaterializeCommitRequest {
    return {
        targetRef: { tier: 'card_worktree', gitRef: PARITY_REF },
        parentCommitOids: [],
        files,
        message: 'test(parity): validation',
        authorName: PARITY_AUTHOR.name,
        authorEmail: PARITY_AUTHOR.email,
        authorSignature: PARITY_AUTHOR,
        committerSignature: PARITY_AUTHOR,
    };
}

/** Differential corpora covering nesting, ordering, encodings, and every leaf mode. */
const PARITY_CORPORA: readonly ParityCorpus[] = [
    {
        caseName: 'nested directories',
        files: [
            stagedFile('README.md', '# Fractal Git parity\n'),
            stagedFile('src/main.ts', 'export const entryPoint = "main";\n'),
            stagedFile('src/lib/util.ts', 'export function add(a: number, b: number): number {\n    return a + b;\n}\n'),
            stagedFile('docs/guide/intro.md', '# Intro\n\nNested tree guidance.\n'),
        ],
        message: 'test(parity): nested directory tree',
    },
    {
        caseName: 'mixed case ordering',
        files: [
            stagedFile('README.md', 'root readme\n'),
            stagedFile('Zebra.txt', 'zebra\n'),
            stagedFile('apple.txt', 'apple\n'),
            stagedFile('Banana.txt', 'banana\n'),
            stagedFile('zoo/animals.txt', 'animals\n'),
        ],
        message: 'test(parity): mixed-case byte ordering',
    },
    {
        caseName: 'non-ascii paths',
        files: [
            stagedFile('École.txt', 'école\n'),
            stagedFile('café.md', 'café\n'),
            stagedFile('日本語/ノート.md', 'ノート\n'),
            stagedFile('docs/Übersicht.md', 'übersicht\n'),
        ],
        message: 'test(parity): non-ASCII path and message — école 日本語',
    },
    {
        caseName: 'same prefix siblings',
        files: [
            stagedFile('foo/child.txt', 'child payload\n'),
            stagedFile('foo/bar/deep.txt', 'deep payload\n'),
            stagedFile('foo-bar', 'dashed payload\n'),
            stagedFile('foo.c', 'c source payload\n'),
            stagedFile('foobar', 'concatenated payload\n'),
            stagedFile('foo.txt', 'dotted payload\n'),
        ],
        message: 'test(parity): same-prefix sibling ordering',
    },
    {
        caseName: 'symlink entries',
        files: [
            stagedFile('target.txt', 'link target payload\n'),
            stagedFile('link.txt', 'target.txt', GIT_FILE_MODE.SYMLINK),
            stagedFile('dir/target.txt', 'nested target payload\n'),
            stagedFile('dir/link-up', '../target.txt', GIT_FILE_MODE.SYMLINK),
        ],
        message: 'test(parity): symlink tree entries',
    },
    {
        caseName: 'executable entries',
        files: [
            stagedFile('bin/run.sh', '#!/bin/sh\necho parity\n', GIT_FILE_MODE.EXECUTABLE),
            stagedFile('README.md', 'executable parity\n'),
        ],
        message: 'test(parity): executable bit preservation',
    },
    {
        caseName: 'agent metadata trailer',
        files: [
            stagedFile('src/main.ts', 'export const ok = true;\n'),
            stagedFile('notes/todo.md', '- parity checklist\n'),
        ],
        message: 'test(parity): Praxis trailer\n\n[Project: fractal-git]',
        agentMeta: PARITY_META,
    },
    {
        caseName: 'message trailing newline',
        files: [stagedFile('src/main.ts', 'export const ok = true;\n')],
        message: 'test(parity): trailing newline preserved\n',
    },
    {
        caseName: 'gitlink entry',
        files: [
            stagedFile('README.md', 'gitlink parity\n'),
            stagedFile('vendor/lib', '1111111111111111111111111111111111111111', GIT_FILE_MODE.GITLINK),
        ],
        message: 'test(parity): gitlink entry',
    },
];

if (GIT_SKIP_REASON !== false) {
    console.warn(`[git-parity] skipping differential suite: ${GIT_SKIP_REASON}`);
}

for (const corpus of PARITY_CORPORA) {
    test(`git differential: ${corpus.caseName}`, { skip: GIT_SKIP_REASON }, () => {
        assertCorpusParity(corpus);
    });
}

test('git differential: parent chain and merge header order', { skip: GIT_SKIP_REASON }, () => {
    assertParentChainParity();
});

test('materializeCommitPure rejects duplicate and conflicting staged paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fractal-git-parity-validation-'));
    try {
        const gitDir = path.join(root, '.git');
        fs.mkdirSync(gitDir, { recursive: true });
        assert.throws(
            () => materializeCommitPure(gitDir, validationRequest([stagedFile('dup.txt', 'first\n'), stagedFile('dup.txt', 'second\n')])),
            /Duplicate staged path/,
        );
        assert.throws(
            () => materializeCommitPure(gitDir, validationRequest([stagedFile('foo', 'file body\n'), stagedFile('foo/bar.txt', 'nested body\n')])),
            /both a file and a directory/,
        );
        assert.throws(
            () => materializeCommitPure(gitDir, validationRequest([stagedFile('foo/bar.txt', 'nested body\n'), stagedFile('foo', 'file body\n')])),
            /both a file and a directory/,
        );
        assert.throws(
            () => materializeCommitPure(gitDir, validationRequest([stagedFile('', 'empty path\n')])),
            /Cannot stage an empty path/,
        );
        assert.throws(
            () => materializeCommitPure(gitDir, validationRequest([stagedFile('../escape.txt', 'escape\n')])),
            /not a legal tree entry name/,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
