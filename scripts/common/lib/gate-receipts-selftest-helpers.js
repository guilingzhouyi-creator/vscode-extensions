/**
 * Module: Gate Receipts Self-Test Environment & Assertion Helpers
 * File Path: scripts/common/lib/gate-receipts-selftest-helpers.js
 * Architecture Role: Ephemeral repository builder, Git env isolation, and
 *   assertion/reporting utilities supporting gate-receipts-selftest.
 * Dependencies & Triggers: Node.js built-ins (`fs`, `os`, `path`, `child_process`).
 * Responsibilities:
 *   1. Detach and restore parent Git hook environment variables safely;
 *   2. Spin up isolated scratch Git repositories and invoke gate-receipts CLI;
 *   3. Provide assertion, ref-file generation, JSONL audit, and summary helpers.
 * Exit Semantics & Design Rationale: Helpers throw structured errors captured by
 *   `selftestCase` so all test cases report deterministic PASS/FAIL summaries.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const EXIT_OK = 0;
const EXIT_BLOCK = 1;
const ZERO_SHA = '0'.repeat(40);
const GIT_ENV_KEYS = Object.freeze([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX',
  'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
]);

function detachGitEnvironment() {
  const saved = new Map();
  for (const key of GIT_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  }
  return saved;
}

function restoreGitEnvironment(saved) {
  for (const [key, value] of saved) process.env[key] = value;
}

function expectSelftestGit(dir, args, label) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  const status = result.status === null ? -1 : result.status;
  if (status !== 0) {
    throw new Error(`${label}: git ${args.join(' ')} 失败(${status}): ${(result.stderr || '').trim()}`);
  }
  return (result.stdout || '').trim();
}

function selftestCli(cliPath, repo, args, input) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repo.dir,
    encoding: 'utf8',
    windowsHide: true,
    ...(input !== undefined ? { input } : {}),
  });
}

function expectSelftestExit(result, expected, label) {
  const status = result.status === null ? -1 : result.status;
  if (status !== expected) {
    throw new Error(
      `${label}: 期望 exit ${expected}，实际 ${status}；stdout=${(result.stdout || '').trim()} stderr=${(result.stderr || '').trim()}`,
    );
  }
}

function assertSelftest(condition, message) {
  if (!condition) throw new Error(message);
}

function selftestCase(label, produce) {
  try {
    return { label, ok: true, detail: produce() || 'ok' };
  } catch (error) {
    return { label, ok: false, detail: error.message };
  }
}

function createSelftestRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-receipts-selftest-'));
  expectSelftestGit(dir, ['init', '-q'], '自测初始化临时仓库');
  expectSelftestGit(dir, ['config', 'user.email', 'selftest@example.invalid'], '自测配置邮箱');
  expectSelftestGit(dir, ['config', 'user.name', 'Gate Receipt Selftest'], '自测配置用户名');
  expectSelftestGit(dir, ['config', 'commit.gpgsign', 'false'], '自测关闭提交签名');
  const hookDir = path.join(dir, 'no-hooks').replace(/\\/g, '/');
  expectSelftestGit(dir, ['config', 'core.hooksPath', hookDir], '自测隔离 hooks');
  return { dir };
}

function commitSelftestFile(repo, fileName, content, message) {
  fs.writeFileSync(path.join(repo.dir, fileName), content, 'utf8');
  expectSelftestGit(repo.dir, ['add', fileName], '自测暂存文件');
  expectSelftestGit(repo.dir, ['commit', '-q', '-m', message], '自测创建提交');
  return expectSelftestGit(repo.dir, ['rev-parse', 'HEAD'], '自测读取 HEAD');
}

function writeSelftestRefs(repo, name, lines) {
  const filePath = path.join(repo.dir, `${name}-refs.txt`);
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

function refLine(localRef, localSha, remoteRef, remoteSha) {
  return `${localRef} ${localSha} ${remoteRef} ${remoteSha}`;
}

function shortSha(sha) {
  return typeof sha === 'string' ? sha.slice(0, 8) : '';
}

function readJsonSafe(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function countNonEmptyLines(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  return fs.readFileSync(filePath, 'utf8').split('\n').filter((line) => line.trim().length > 0).length;
}

function readLastJsonLine(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter((line) => line.trim().length > 0);
  return JSON.parse(lines[lines.length - 1]);
}

function createDivergentCommit(repo, baseSha) {
  const branch = expectSelftestGit(repo.dir, ['rev-parse', '--abbrev-ref', 'HEAD'], '自测读取当前分支');
  expectSelftestGit(repo.dir, ['checkout', '-q', '-b', 'selftest-side', baseSha], '自测创建旁支');
  const sha = commitSelftestFile(repo, 'side.txt', 'side\n', 'side commit');
  expectSelftestGit(repo.dir, ['checkout', '-q', branch], '自测切回主分支');
  return sha;
}

function cleanupSelftestRepo(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    process.stderr.write(`WARN 清理自测目录失败: ${error.message}\n`);
  }
}

function reportSelftest(results) {
  console.log('== gate-receipts selftest ==');
  let failures = 0;
  for (const result of results) {
    if (!result.ok) failures += 1;
    console.log(`  ${result.ok ? 'PASS' : 'FAIL'} ${result.label} -> ${result.detail}`);
  }
  console.log(`== selftest ${failures === 0 ? 'PASS' : 'FAIL'}: ${results.length - failures}/${results.length} 条断言通过 ==`);
  return failures === 0 ? EXIT_OK : EXIT_BLOCK;
}

module.exports = {
  EXIT_OK,
  EXIT_BLOCK,
  ZERO_SHA,
  detachGitEnvironment,
  restoreGitEnvironment,
  expectSelftestGit,
  selftestCli,
  expectSelftestExit,
  assertSelftest,
  selftestCase,
  createSelftestRepo,
  commitSelftestFile,
  writeSelftestRefs,
  refLine,
  shortSha,
  readJsonSafe,
  countNonEmptyLines,
  readLastJsonLine,
  createDivergentCommit,
  cleanupSelftestRepo,
  reportSelftest,
};
