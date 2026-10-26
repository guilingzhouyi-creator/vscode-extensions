/**
 * Module: Push-Range Commit Message Verifier
 * File Path: scripts/common/validate-push-range-messages.js
 * Architecture Role: Re-derives the commit message verdict for an entire push range from the
 *   immutable commit objects, so a bypassed or missing local commit-msg hook cannot smuggle a
 *   non-conforming message onto a remote branch. It is the remote-compensation half of the local
 *   hook carrier: the hook stops the mistake locally, this auditor catches it before integration.
 * Dependencies & Triggers: Node.js built-ins (child_process, fs, path) and the Git CLI; the rule
 *   truth source is the validateSingleCommitMessage export of scripts/common/validate-commit-msg.js,
 *   and the commit-history freeze ledger scripts/common/commit-history-baseline.json supplies the
 *   grandfathering that the local pre-push range audit already applies to already-published
 *   history. This module restates no rule table of its own. Triggered by the CI hygiene job for
 *   pushes and pull requests, and runnable locally against any base..head range.
 * Responsibilities:
 *   1. Parse --range (or the GATE_PUSH_RANGE environment variable) and --limit, defaulting to the
 *      merge target range origin/main..HEAD;
 *   2. Enumerate non-merge commits with git log and validate each message through the shared
 *      commit-message contract, printing one PASS or BLOCK line per commit with its reasons;
 *   3. Fail closed when the range cannot be enumerated, and return a blocking exit code when any
 *      commit is not permitted under the corridor.
 * Exit Semantics & Design Rationale: 0 = every examined commit is permitted; 1 = at least one
 *   commit is blocked or the range could not be enumerated; 2 = usage error. Failing closed on an
 *   unknown range is deliberate: a CI push gate whose range silently resolved to nothing would be
 *   indistinguishable from a passing audit.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { validateSingleCommitMessage } = require('./validate-commit-msg');

const GIT_COMMAND = 'git';
const DEFAULT_RANGE = 'origin/main..HEAD';
const RANGE_ENV_NAME = 'GATE_PUSH_RANGE';
const ARG_RANGE = '--range';
const ARG_LIMIT = '--limit';
const HISTORY_BASELINE_FILE = path.join(__dirname, 'commit-history-baseline.json');
const RECORD_SEPARATOR = '\x1e';
const UNIT_SEPARATOR = '\x1f';
const SHORT_SHA_LENGTH = 8;
const ENCODING_UTF8 = 'utf8';
const STDIO_CAPTURED = ['ignore', 'pipe', 'pipe'];
const EXIT_OK = 0;
const EXIT_BLOCK = 1;
const EXIT_USAGE = 2;

/**
 * Runs one Git command inside an explicit working directory.
 *
 * The directory is always passed in so the verifier audits the repository it was pointed at rather
 * than whichever repository happens to be an ancestor of the process working directory.
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
    return '退出码 ' + (result.status === null ? '未知' : result.status);
}

/**
 * Detects whether the process runs inside a Git worktree and resolves its root.
 *
 * @param {string} cwd - Directory to probe.
 * @returns {{ok: boolean, root: string}} Probe outcome; root is empty when unsupported.
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
 * Enumerates the non-merge commits inside one revision range.
 *
 * @param {string} root - Worktree root.
 * @param {string} range - Git revision range such as origin/main..HEAD.
 * @returns {{ok: boolean, stdout: string, error: string}} Enumeration outcome.
 */
function enumerateCommits(root, range) {
    const format = RECORD_SEPARATOR + '%H' + UNIT_SEPARATOR + '%B';
    const result = runGit(['log', '--no-merges', '--format=' + format, range], root);
    if (!result.ok) return { ok: false, stdout: '', error: describeGitFailure(result) };
    return { ok: true, stdout: result.stdout, error: '' };
}

/**
 * Splits the git log output into commit records of sha and raw message body.
 *
 * @param {string} stdout - Raw git log output produced with the record separators.
 * @returns {{sha: string, message: string}[]} Parsed commit records in log order.
 */
function parseCommitRecords(stdout) {
    const records = [];
    for (const chunk of stdout.split(RECORD_SEPARATOR)) {
        const record = chunk.replace(/^[\r\n]+/, '');
        if (record.length === 0) continue;
        const separatorIndex = record.indexOf(UNIT_SEPARATOR);
        if (separatorIndex === -1) continue;
        records.push({
            sha: record.slice(0, separatorIndex).trim(),
            message: record.slice(separatorIndex + 1),
        });
    }
    return records;
}

/**
 * Accepts a revision range only when it is one plain token containing a two-dot separator.
 *
 * @param {string} value - Candidate range.
 * @returns {boolean} True when git can be handed the token as one revision argument.
 */
function isValidRange(value) {
    if (typeof value !== 'string' || value.length === 0) return false;
    if (value.startsWith('-')) return false;
    if (/[\s\u0000-\u001f\u007f]/.test(value)) return false;
    return value.includes('..');
}

/**
 * Parses a positive integer limit argument.
 *
 * @param {string} value - Candidate limit token.
 * @returns {number|null} Parsed limit, or null when the token is not a positive integer.
 */
function parseLimit(value) {
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Parses command-line switches into an audited range and an optional commit cap.
 *
 * @param {string[]} argv - Arguments after the executable.
 * @param {Record<string, string|undefined>} environment - Process environment.
 * @returns {{ok: true, range: string, limit: number}|{ok: false, message: string}} Parse outcome.
 */
function parseArguments(argv, environment) {
    let range = null;
    let limit = Number.POSITIVE_INFINITY;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === ARG_RANGE) {
            const value = argv[index + 1];
            if (value === undefined) return { ok: false, message: ARG_RANGE + ' 需要一个提交区间' };
            range = value;
            index += 1;
            continue;
        }
        if (argument === ARG_LIMIT) {
            const value = argv[index + 1];
            const parsed = value === undefined ? null : parseLimit(value);
            if (parsed === null) return { ok: false, message: ARG_LIMIT + ' 需要正整数' };
            limit = parsed;
            index += 1;
            continue;
        }
        return { ok: false, message: '未知参数 ' + argument };
    }
    const fromEnvironment = environment === undefined ? undefined : environment[RANGE_ENV_NAME];
    const candidate = range === null ? fromEnvironment : range;
    const effective = candidate === undefined || candidate === null || candidate === '' ? DEFAULT_RANGE : candidate;
    if (!isValidRange(effective)) return { ok: false, message: '非法提交区间 ' + effective };
    return { ok: true, range: effective, limit };
}

/**
 * Chooses the first non-blank line of a commit message as its display subject.
 *
 * @param {string} message - Raw commit message body.
 * @returns {string} Subject line, or a placeholder for an empty message.
 */
function formatSubject(message) {
    for (const line of message.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0) return trimmed;
    }
    return '(空提交信息)';
}

/**
 * Truncates a commit hash for display.
 *
 * @param {string} sha - Full commit hash.
 * @returns {string} Abbreviated hash.
 */
function shortSha(sha) {
    return sha.slice(0, SHORT_SHA_LENGTH);
}

/**
 * Loads the commit-history freeze ledger keyed by commit SHA.
 *
 * The ledger records the rule IDs that an already-published commit predates. A frozen commit is
 * reported but never blocked on those rules, exactly as the local pre-push range audit decides it:
 * a push must not be failed by rules that only tightened after the commit was written. A malformed
 * ledger is warned about and treated as empty so it can never silently re-arm every old block.
 *
 * @returns {Map<string, Set<string>>} Commit SHA to frozen rule IDs.
 */
function loadFrozenRules() {
    if (!fs.existsSync(HISTORY_BASELINE_FILE)) return new Map();
    try {
        const parsed = JSON.parse(fs.readFileSync(HISTORY_BASELINE_FILE, ENCODING_UTF8));
        const entries = Array.isArray(parsed.frozenCommits) ? parsed.frozenCommits : [];
        return new Map(entries.map((entry) => [entry.sha, new Set(entry.ruleIds || [])]));
    } catch (error) {
        console.error('▲ WARN push-range 提交历史冻结清单不可读，按无冻结记录继续: ' + error.message);
        return new Map();
    }
}

/**
 * Renders the reasons behind a blocked commit message.
 *
 * @param {{structureFindings: object[], hallucinatedRules: string[], batchFindings: object[],
 *   styleFindings: object[]}} result - Validator result for one message.
 * @returns {string[]} Human-readable reason lines in reporting priority order.
 */
function describeFindings(result) {
    const reasons = [];
    for (const finding of result.structureFindings) {
        const detail = finding.detail ? ' — ' + finding.detail : '';
        reasons.push('[' + finding.step + '] ' + finding.message + detail);
    }
    for (const ruleId of result.hallucinatedRules) {
        reasons.push('未登记的规则 ID: ' + ruleId);
    }
    for (const finding of result.batchFindings) {
        reasons.push('[批次代号] ' + finding.term);
    }
    if (reasons.length === 0) {
        for (const finding of result.styleFindings) {
            const guidance = finding.guidance ? ' — ' + finding.guidance : '';
            reasons.push('[' + finding.category + '] ' + finding.term + guidance);
        }
    }
    return reasons;
}

/**
 * Prints one blocked commit with the reasons that blocked it.
 *
 * @param {{sha: string, message: string}} commit - Blocked commit record.
 * @param {string[]} reasons - Reason lines.
 * @returns {void}
 */
function printBlock(commit, reasons) {
    console.error('✖ BLOCK ' + shortSha(commit.sha) + ' ' + formatSubject(commit.message));
    for (const reason of reasons) console.error('    - ' + reason);
}

/**
 * Validates every commit message and prints one line per commit.
 *
 * A commit present in the freeze ledger passes when every style finding it carries names a frozen
 * rule ID; any finding from a rule the commit postdates stays live and can still block the push.
 *
 * @param {{sha: string, message: string}[]} commits - Commits to audit in log order.
 * @param {Map<string, Set<string>>} frozenRules - Freeze ledger keyed by commit SHA.
 * @returns {{blocked: number, frozen: number}} Blocked and grandfathered commit counts.
 */
function evaluateCommits(commits, frozenRules) {
    let blocked = 0;
    let frozen = 0;
    for (const commit of commits) {
        let result;
        try {
            result = validateSingleCommitMessage(commit.message);
        } catch (error) {
            blocked += 1;
            printBlock(commit, ['校验器异常: ' + error.message]);
            continue;
        }
        const frozenRuleIds = frozenRules.get(commit.sha);
        if (frozenRuleIds) {
            const liveFindings = result.styleFindings.filter((finding) => !frozenRuleIds.has(finding.ruleId));
            if (liveFindings.length === 0) {
                frozen += 1;
                console.log('✔ PASS ' + shortSha(commit.sha) + ' ' + formatSubject(commit.message) + '（冻结清单放行）');
                continue;
            }
        }
        if (result.isPermittedUnderCorridor) {
            console.log('✔ PASS ' + shortSha(commit.sha) + ' ' + formatSubject(commit.message));
            continue;
        }
        blocked += 1;
        printBlock(commit, describeFindings(result));
    }
    return { blocked, frozen };
}

/**
 * Prints the command usage block.
 *
 * @returns {void}
 */
function printUsage() {
    console.error('用法: node scripts/common/validate-push-range-messages.js [--range <base..head>] [--limit <n>]');
    console.error('  --range   提交区间，默认 ' + DEFAULT_RANGE + '，也可用环境变量 ' + RANGE_ENV_NAME);
    console.error('  --limit   最多审查的提交笔数，便于本地单点自测');
}

/**
 * CLI entry point.
 *
 * @param {string[]} argv - Arguments after the executable.
 * @param {Record<string, string|undefined>} environment - Process environment.
 * @returns {number} Process exit code.
 */
function main(argv, environment) {
    const parsed = parseArguments(argv, environment);
    if (!parsed.ok) {
        console.error('✖ BLOCK push-range ' + parsed.message);
        printUsage();
        return EXIT_USAGE;
    }
    const worktree = probeWorktree(process.cwd());
    if (!worktree.ok) {
        console.error('✖ BLOCK push-range 当前目录不在 Git 工作树内');
        return EXIT_BLOCK;
    }
    const enumeration = enumerateCommits(worktree.root, parsed.range);
    if (!enumeration.ok) {
        console.error('✖ BLOCK push-range 无法枚举区间 ' + parsed.range + ': ' + enumeration.error);
        return EXIT_BLOCK;
    }
    const commits = parseCommitRecords(enumeration.stdout);
    const selected = Number.isFinite(parsed.limit) ? commits.slice(0, parsed.limit) : commits;
    if (selected.length < commits.length) {
        console.log('▲ WARN push-range 受 --limit 约束，仅审查 ' + selected.length + ' 笔提交，区间共 ' + commits.length + ' 笔');
    }
    if (selected.length === 0) {
        console.log('✔ PASS push-range 区间 ' + parsed.range + ' 内无待审提交');
        return EXIT_OK;
    }
    console.log('INFO push-range 区间 ' + parsed.range + ' 待审提交 ' + selected.length + ' 笔');
    const outcome = evaluateCommits(selected, loadFrozenRules());
    if (outcome.blocked > 0) {
        console.error('✖ BLOCK push-range ' + outcome.blocked + ' 笔提交未通过提交信息契约');
        return EXIT_BLOCK;
    }
    const frozenNote = outcome.frozen > 0 ? '，其中 ' + outcome.frozen + ' 笔按冻结清单放行' : '';
    console.log('✔ PASS push-range 全部 ' + selected.length + ' 笔提交通过提交信息契约' + frozenNote);
    return EXIT_OK;
}

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2), process.env);
}

module.exports = {
    main,
    parseArguments,
    parseCommitRecords,
    isValidRange,
};
