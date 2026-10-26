/**
 * Module: Repository Hook Self-Heal Installer
 * File Path: scripts/common/install-hooks.js
 * Architecture Role: Rebuilds the repository-local Git hook wiring that neither a fresh clone nor a
 *   fresh CI checkout carries: `core.hooksPath` lives only in `.git/config`, and an index that lost
 *   its executable bit makes every hook invisible on POSIX. This script is the portable repair path
 *   for both, and its `--check` mode is the read-only assertion CI uses to prove the repair is real.
 * Dependencies & Triggers: Node.js built-ins only (`child_process`, `fs`, `path`) plus the Git CLI.
 *   Triggered by the root `prepare` lifecycle, the portable gate install command, and the CI hygiene
 *   job; reads `.githooks/` and the index, writes only `.git/config` and the index.
 * Responsibilities:
 *   1. Warn and exit 0 outside a Git worktree so packaging and source snapshots never fail;
 *   2. Point `core.hooksPath` at `.githooks` and mark every required hook 100755 in the index;
 *   3. Read the index back, reject missing or non-executable hooks, and refresh the receipt baseline;
 *   4. Offer `--check` (verify without writing) and `--quiet` (suppress per-hook success lines).
 * Exit Semantics & Design Rationale: 0 = repaired or verified, and also the deliberate skip outside
 *   a worktree; 1 = repair or verification failed; 2 = usage error. The installer fails closed once
 *   it commits to a managed worktree because a silent skip is exactly how hooksPath rot returns.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GIT_COMMAND = 'git';
const HOOKS_DIRECTORY = '.githooks';
const HOOKS_PATH_KEY = 'core.hooksPath';
const RECEIPTS_ENGINE = 'scripts/common/gate-receipts.js';
const REQUIRED_HOOKS = Object.freeze([
    'pre-commit',
    'commit-msg',
    'pre-merge-commit',
    'post-commit',
    'post-merge',
    'pre-push',
]);
const MODE_EXECUTABLE = '100755';
const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const ENCODING_UTF8 = 'utf8';
const STDIO_CAPTURED = ['ignore', 'pipe', 'pipe'];

/**
 * Runs one Git command inside an explicit working directory.
 *
 * The working directory is always passed in, never inherited implicitly, so the installer behaves
 * identically whether it is launched from the repository root or from a nested package directory.
 *
 * @param {string[]} args - Git argument vector without the executable name.
 * @param {string} cwd - Working directory the command must run in.
 * @returns {{ok: boolean, status: number|null, stdout: string, stderr: string}} Normalized result.
 */
function runGit(args, cwd) {
    const result = spawnSync(GIT_COMMAND, args, {
        cwd,
        encoding: ENCODING_UTF8,
        stdio: STDIO_CAPTURED,
        windowsHide: true,
    });
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    if (result.error) {
        return { ok: false, status: null, stdout, stderr: result.error.message };
    }
    return { ok: result.status === 0, status: result.status, stdout, stderr };
}

/**
 * Describes a failed Git invocation for an operator-facing BLOCK line.
 *
 * @param {{status: number|null, stderr: string}} result - Failed command result.
 * @returns {string} Short failure description.
 */
function describeGitFailure(result) {
    const detail = result.stderr.trim();
    if (detail.length > 0) return detail;
    return `退出码 ${result.status === null ? '未知' : result.status}`;
}

/**
 * Detects whether the process runs inside a Git worktree and resolves its root.
 *
 * @param {string} cwd - Directory to probe.
 * @returns {{ok: boolean, root: string}} Probe outcome; `root` is empty when unsupported.
 */
function probeWorktree(cwd) {
    const probe = runGit(['rev-parse', '--is-inside-work-tree'], cwd);
    if (!probe.ok || probe.stdout.trim() !== 'true') return { ok: false, root: '' };
    const topLevel = runGit(['rev-parse', '--show-toplevel'], cwd);
    const root = topLevel.stdout.trim();
    if (!topLevel.ok || root.length === 0) return { ok: false, root: '' };
    return { ok: true, root };
}

/**
 * Reads the effective `core.hooksPath` value.
 *
 * @param {string} root - Worktree root.
 * @returns {{ok: boolean, value: string|null, error: string}} Read outcome.
 */
function readHooksPath(root) {
    const result = runGit(['config', '--get', HOOKS_PATH_KEY], root);
    if (result.status === 1) return { ok: true, value: null, error: '' };
    if (!result.ok) return { ok: false, value: null, error: describeGitFailure(result) };
    const values = result.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
    return { ok: true, value: values.length > 0 ? values[values.length - 1] : null, error: '' };
}

/**
 * Compares a configured hooks path against the tracked directory, resolving relative values.
 *
 * @param {string} root - Worktree root.
 * @param {string} candidate - Configured value.
 * @returns {boolean} True when both spellings resolve to the same directory.
 */
function pointsAtHooksDirectory(root, candidate) {
    const expected = path.resolve(root, HOOKS_DIRECTORY);
    const actual = path.resolve(root, candidate);
    if (process.platform === 'win32') return actual.toLowerCase() === expected.toLowerCase();
    return actual === expected;
}

/**
 * Lists every required hook whose on-disk carrier file is absent.
 *
 * @param {string} root - Worktree root.
 * @returns {string[]} Missing hook names in declaration order.
 */
function findMissingHookFiles(root) {
    return REQUIRED_HOOKS.filter((hook) => !isRegularFile(path.join(root, HOOKS_DIRECTORY, hook)));
}

/**
 * Tests whether a path is a regular file without letting a missing path throw.
 *
 * @param {string} target - Absolute file path.
 * @returns {boolean} True for a readable regular file.
 */
function isRegularFile(target) {
    try {
        return fs.statSync(target).isFile();
    } catch {
        return false;
    }
}

/**
 * Parses `git ls-files -s .githooks` into an index-mode map.
 *
 * @param {string} root - Worktree root.
 * @returns {{ok: boolean, modes: Map<string, string>, error: string}} Read outcome.
 */
function readIndexModes(root) {
    const result = runGit(['ls-files', '-s', HOOKS_DIRECTORY], root);
    if (!result.ok) return { ok: false, modes: new Map(), error: describeGitFailure(result) };
    const modes = new Map();
    for (const line of result.stdout.split('\n')) {
        const tabIndex = line.indexOf('\t');
        const spaceIndex = line.indexOf(' ');
        if (tabIndex === -1 || spaceIndex === -1) continue;
        modes.set(line.slice(tabIndex + 1).trim(), line.slice(0, spaceIndex));
    }
    return { ok: true, modes, error: '' };
}

/**
 * Projects a hooks-path value onto operator-facing problems.
 *
 * @param {string} root - Worktree root.
 * @param {string|null} value - Configured value.
 * @returns {string[]} Problem descriptions.
 */
function evaluateHooksPath(root, value) {
    if (value === null) return [`${HOOKS_PATH_KEY} 未设置，需要指向 ${HOOKS_DIRECTORY}`];
    if (pointsAtHooksDirectory(root, value)) return [];
    return [`${HOOKS_PATH_KEY} 为 ${value}，需要指向 ${HOOKS_DIRECTORY}`];
}

/**
 * Projects an index-mode map onto operator-facing problems.
 *
 * @param {Map<string, string>} modes - Index modes keyed by repository-relative path.
 * @returns {string[]} Problem descriptions.
 */
function evaluateIndexModes(modes) {
    const problems = [];
    for (const hook of REQUIRED_HOOKS) {
        const entry = `${HOOKS_DIRECTORY}/${hook}`;
        const mode = modes.get(entry);
        if (mode !== MODE_EXECUTABLE) {
            problems.push(`${entry} 索引模式为 ${mode || '缺失'}，需要 ${MODE_EXECUTABLE}`);
        }
    }
    return problems;
}

/**
 * Verifies the local hook wiring without writing anything.
 *
 * @param {string} root - Worktree root.
 * @returns {{problems: string[], hooksPath: string|null}} Verification outcome.
 */
function verifyInstallation(root) {
    const configuration = readHooksPath(root);
    if (!configuration.ok) return { problems: [`读取 ${HOOKS_PATH_KEY} 失败: ${configuration.error}`], hooksPath: null };
    const index = readIndexModes(root);
    if (!index.ok) return { problems: [`读取索引模式失败: ${index.error}`], hooksPath: configuration.value };
    const problems = [
        ...evaluateHooksPath(root, configuration.value),
        ...evaluateIndexModes(index.modes),
        ...findMissingHookFiles(root).map((hook) => `缺少钩子载体 ${HOOKS_DIRECTORY}/${hook}`),
    ];
    return { problems, hooksPath: configuration.value };
}

/**
 * Writes the hooks path and records the executable bit for every required hook.
 *
 * @param {string} root - Worktree root.
 * @returns {string[]} One problem description per failed write.
 */
function applyHookWiring(root) {
    const configuration = runGit(['config', HOOKS_PATH_KEY, HOOKS_DIRECTORY], root);
    if (!configuration.ok) {
        return [`写入 ${HOOKS_PATH_KEY} 失败: ${describeGitFailure(configuration)}`];
    }
    const problems = [];
    for (const hook of REQUIRED_HOOKS) {
        const entry = `${HOOKS_DIRECTORY}/${hook}`;
        const chmod = runGit(['update-index', '--chmod=+x', entry], root);
        if (!chmod.ok) problems.push(`设置 ${entry} 索引可执行位失败: ${describeGitFailure(chmod)}`);
    }
    return problems;
}

/**
 * Refreshes the gate receipt baseline that exempts pre-install commits from push auditing.
 *
 * @param {string} root - Worktree root.
 * @returns {{status: 'refreshed'|'skipped'|'failed', detail: string}} Baseline outcome.
 */
function refreshReceiptBaseline(root) {
    const engine = path.join(root, RECEIPTS_ENGINE);
    if (!isRegularFile(engine)) return { status: 'skipped', detail: '未找到门禁收据引擎' };
    const result = spawnSync(process.execPath, [engine, 'baseline'], {
        cwd: root,
        encoding: ENCODING_UTF8,
        stdio: STDIO_CAPTURED,
        windowsHide: true,
    });
    if (result.error) return { status: 'failed', detail: result.error.message };
    if (result.status !== 0) {
        const detail = typeof result.stderr === 'string' ? result.stderr.trim() : '';
        return { status: 'failed', detail: detail.length > 0 ? detail : `退出码 ${result.status}` };
    }
    return { status: 'refreshed', detail: '' };
}

/**
 * Prints the per-hook success lines that describe a verified installation.
 *
 * @param {string|null} hooksPath - Verified configured value.
 * @returns {void}
 */
function printInstallationSummary(hooksPath) {
    console.log(`✔ PASS install-hooks ${HOOKS_PATH_KEY}=${hooksPath === null ? HOOKS_DIRECTORY : hooksPath}`);
    for (const hook of REQUIRED_HOOKS) {
        console.log(`✔ PASS ${HOOKS_DIRECTORY}/${hook} mode=${MODE_EXECUTABLE}`);
    }
}

/**
 * Reports verification problems and the repair hint.
 *
 * @param {string[]} problems - Problem descriptions.
 * @returns {void}
 */
function reportProblems(problems) {
    for (const problem of problems) console.error(`✖ BLOCK install-hooks ${problem}`);
}

/**
 * Runs read-only verification for `--check`.
 *
 * @param {string} root - Worktree root.
 * @param {boolean} quiet - Whether success detail lines stay silent.
 * @returns {number} Process exit code.
 */
function runCheck(root, quiet) {
    const verification = verifyInstallation(root);
    if (verification.problems.length > 0) {
        reportProblems(verification.problems);
        console.error('▲ WARN install-hooks 去掉 --check 重新运行即可自愈上述问题');
        return EXIT_FAILURE;
    }
    if (!quiet) printInstallationSummary(verification.hooksPath);
    return EXIT_OK;
}

/**
 * Runs the idempotent repair path.
 *
 * @param {string} root - Worktree root.
 * @param {boolean} quiet - Whether success detail lines stay silent.
 * @returns {number} Process exit code.
 */
function runInstall(root, quiet) {
    const missing = findMissingHookFiles(root);
    if (missing.length > 0) {
        reportProblems(missing.map((hook) => `缺少钩子载体 ${HOOKS_DIRECTORY}/${hook}`));
        return EXIT_FAILURE;
    }
    const writeProblems = applyHookWiring(root);
    if (writeProblems.length > 0) {
        reportProblems(writeProblems);
        return EXIT_FAILURE;
    }
    const verification = verifyInstallation(root);
    if (verification.problems.length > 0) {
        reportProblems(verification.problems);
        return EXIT_FAILURE;
    }
    const baseline = refreshReceiptBaseline(root);
    if (baseline.status === 'failed') {
        reportProblems([`门禁收据基线写入失败: ${baseline.detail}`]);
        return EXIT_FAILURE;
    }
    if (!quiet) {
        printInstallationSummary(verification.hooksPath);
        if (baseline.status === 'refreshed') console.log('✔ PASS gate-receipts baseline=refreshed');
        else console.log(`↷ SKIP gate-receipts baseline ${baseline.detail}`);
    }
    return EXIT_OK;
}

/**
 * Parses the supported command-line switches.
 *
 * @param {string[]} argv - Arguments after the executable.
 * @returns {{ok: true, check: boolean, quiet: boolean}|{ok: false, argument: string}} Parse result.
 */
function parseArguments(argv) {
    let check = false;
    let quiet = false;
    for (const argument of argv) {
        if (argument === '--check') {
            check = true;
            continue;
        }
        if (argument === '--quiet') {
            quiet = true;
            continue;
        }
        return { ok: false, argument };
    }
    return { ok: true, check, quiet };
}

/**
 * Prints the command usage block.
 *
 * @returns {void}
 */
function printUsage() {
    console.error('用法: node scripts/common/install-hooks.js [--check] [--quiet]');
    console.error('  --check   只校验 core.hooksPath 与索引模式，不写入任何配置');
    console.error('  --quiet   通过时不输出逐项明细');
}

/**
 * CLI entry point.
 *
 * @param {string[]} argv - Arguments after the executable.
 * @returns {number} Process exit code.
 */
function main(argv) {
    const parsed = parseArguments(argv);
    if (!parsed.ok) {
        reportProblems([`未知参数 ${parsed.argument}`]);
        printUsage();
        return EXIT_USAGE;
    }
    const worktree = probeWorktree(process.cwd());
    if (!worktree.ok) {
        console.warn('▲ WARN install-hooks 当前目录不在 Git 工作树内，跳过钩子自愈');
        return EXIT_OK;
    }
    return parsed.check ? runCheck(worktree.root, parsed.quiet) : runInstall(worktree.root, parsed.quiet);
}

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}

module.exports = {
    main,
    parseArguments,
    pointsAtHooksDirectory,
    evaluateHooksPath,
    evaluateIndexModes,
};
