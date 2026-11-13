/**
 * Module: Gate Receipts Self-Test Security & Integrity Cases
 * File Path: scripts/common/lib/gate-receipts-selftest-security.js
 * Architecture Role: Adversarial integrity assertions (`h`..`l`) proving forged,
 *   tampered, transplanted, and tree-drifted receipts fail closed.
 * Dependencies & Triggers: Node.js `fs`/`path` and `./gate-receipts-selftest-helpers`.
 * Responsibilities:
 *   1. Reject unsigned receipts and single-byte HMAC signature tampering;
 *   2. Verify post-rewrite recomputation and `rewrittenFrom` metadata continuity;
 *   3. Reject transplanted valid receipts and staged-tree drift mismatches.
 * Exit Semantics & Design Rationale: Returns case result list appended to
 *   the selftest runner report.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  expectSelftestGit,
  selftestCli,
  expectSelftestExit,
  assertSelftest,
  selftestCase,
  commitSelftestFile,
  writeSelftestRefs,
  refLine,
  shortSha,
  readJsonSafe,
} = require('./gate-receipts-selftest-helpers');

function runSignedFinalize(run, ppid) {
  expectSelftestExit(run(['mark', '--phase', 'pre-commit', '--ppid', ppid]), 0, 'mark pre-commit');
  expectSelftestExit(run(['mark', '--phase', 'commit-msg', '--ppid', ppid]), 0, 'mark commit-msg');
  expectSelftestExit(run(['finalize', '--ppid', ppid]), 0, 'finalize');
}

function makeMainRefs(repo, name, newSha, oldSha) {
  return writeSelftestRefs(repo, name, [
    refLine('refs/heads/main', newSha, 'refs/heads/main', oldSha),
  ]);
}

function buildSecuritySelftestCases(ctx, baseSha) {
  const { repo, cliPath, receiptsDir, cfg } = ctx;
  const run = (args, input) => selftestCli(cliPath, repo, args, input);
  const cases = [];

  cases.push(selftestCase('h) 手写 {verified:true} 无签名收据 => verify-receipts exit 1', () => {
    const sha = commitSelftestFile(repo, 'unsigned.txt', 'one\n', 'unsigned target');
    fs.mkdirSync(receiptsDir, { recursive: true });
    const forgedPath = path.join(receiptsDir, `${sha}.json`);
    const forgedBody = {
      schemaVersion: cfg.schemaVersion,
      commitSha: sha,
      verified: true,
      bypass: false,
    };
    fs.writeFileSync(forgedPath, JSON.stringify(forgedBody), 'utf8');
    const parent = expectSelftestGit(repo.dir, ['rev-parse', `${sha}^`], '自测读取父提交');
    const refsFile = makeMainRefs(repo, 'unsigned', sha, parent);
    const blocked = run(['verify-receipts', '--refs-file', refsFile]);
    expectSelftestExit(blocked, 1, 'verify-receipts 无签名收据');
    assertSelftest(blocked.stdout.includes('BLOCK 提交'), '无签名收据未产出 BLOCK 行');
    fs.unlinkSync(forgedPath);
    return '无签名收据 exit=1 且产出 BLOCK 行';
  }));

  cases.push(selftestCase('i) 收据签名改一字节 => verify-receipts exit 1', () => {
    const sha = commitSelftestFile(repo, 'tamper.txt', 'one\n', 'tamper target');
    runSignedFinalize(run, '6161');
    const receiptPath = path.join(receiptsDir, `${sha}.json`);
    const receipt = readJsonSafe(receiptPath);
    assertSelftest(receipt !== null && typeof receipt.signature === 'string', '收据缺少 signature');
    const lead = receipt.signature.startsWith('0') ? '1' : '0';
    const flipped = `${lead}${receipt.signature.slice(1)}`;
    const tampered = `${JSON.stringify({ ...receipt, signature: flipped }, null, 2)}\n`;
    fs.writeFileSync(receiptPath, tampered, 'utf8');
    const parent = expectSelftestGit(repo.dir, ['rev-parse', `${sha}^`], '自测读取父提交');
    const refsFile = makeMainRefs(repo, 'tampered', sha, parent);
    expectSelftestExit(run(['verify-receipts', '--refs-file', refsFile]), 1, 'verify-receipts 被篡改签名');
    fs.unlinkSync(receiptPath);
    return '篡改签名 exit=1';
  }));

  cases.push(selftestCase('j) post-rewrite 把旧收据重算到新 sha 并标 rewrittenFrom', () => {
    const oldSha = commitSelftestFile(repo, 'rewrite.txt', 'one\n', 'rewrite target');
    runSignedFinalize(run, '7171');
    fs.writeFileSync(path.join(repo.dir, 'rewrite.txt'), 'two\n', 'utf8');
    expectSelftestGit(repo.dir, ['add', 'rewrite.txt'], '自测暂存 amend 文件');
    expectSelftestGit(repo.dir, ['commit', '-q', '--amend', '-m', 'rewrite target amended'], '自测 amend');
    const newSha = expectSelftestGit(repo.dir, ['rev-parse', 'HEAD'], '自测读取 amend 后 HEAD');
    assertSelftest(newSha !== oldSha, 'amend 未改变 sha');
    expectSelftestExit(run(['rewrite'], `${oldSha} ${newSha}\n`), 0, 'rewrite');
    const receipt = readJsonSafe(path.join(receiptsDir, `${newSha}.json`));
    const validCore = receipt !== null
      && receipt.rewrittenFrom === oldSha
      && receipt.verified === true;
    assertSelftest(validCore, '重写收据核心字段校验失败');
    const validSig = typeof receipt.signature === 'string'
      && receipt.signature.length === 64
      && receipt.sourceHook === 'post-rewrite';
    assertSelftest(validSig, '重写收据签名或来源不符');
    const parent = expectSelftestGit(repo.dir, ['rev-parse', `${newSha}^`], '自测读取父提交');
    const refsFile = makeMainRefs(repo, 'rewritten', newSha, parent);
    expectSelftestExit(run(['verify-receipts', '--refs-file', refsFile]), 0, 'verify-receipts 重写后');
    return `rewrittenFrom=${shortSha(oldSha)} -> ${shortSha(newSha)} verify exit=0`;
  }));

  cases.push(selftestCase('k) 跨提交移植合法收据文件 => verify-receipts exit 1', () => {
    const forgedSha = commitSelftestFile(repo, 'transplant.txt', 'one\n', 'transplant target');
    const srcPath = path.join(receiptsDir, `${baseSha}.json`);
    const dstPath = path.join(receiptsDir, `${forgedSha}.json`);
    fs.copyFileSync(srcPath, dstPath);
    const parent = expectSelftestGit(repo.dir, ['rev-parse', `${forgedSha}^`], '自测读取父提交');
    const refsFile = makeMainRefs(repo, 'transplant', forgedSha, parent);
    expectSelftestExit(run(['verify-receipts', '--refs-file', refsFile]), 1, 'verify-receipts 移植收据');
    fs.unlinkSync(dstPath);
    return '移植收据 commitSha 不一致 exit=1';
  }));

  cases.push(selftestCase('l) pre-commit 标记后修改暂存树再提交 => staged-tree-mismatch exit 1', () => {
    fs.writeFileSync(path.join(repo.dir, 'drift.txt'), 'before\n', 'utf8');
    expectSelftestGit(repo.dir, ['add', 'drift.txt'], '自测暂存初始树');
    expectSelftestExit(run(['mark', '--phase', 'pre-commit', '--ppid', '8181']), 0, 'mark pre-commit');
    fs.writeFileSync(path.join(repo.dir, 'drift.txt'), 'after\n', 'utf8');
    expectSelftestGit(repo.dir, ['add', 'drift.txt'], '自测篡改暂存树');
    expectSelftestExit(run(['mark', '--phase', 'commit-msg', '--ppid', '8181']), 0, 'mark commit-msg');
    expectSelftestGit(repo.dir, ['commit', '-q', '-m', 'drift commit'], '自测提交篡改树');
    expectSelftestExit(run(['finalize', '--ppid', '8181']), 0, 'finalize drift');
    const driftedSha = expectSelftestGit(repo.dir, ['rev-parse', 'HEAD'], '自测读取 drift HEAD');
    const receipt = readJsonSafe(path.join(receiptsDir, `${driftedSha}.json`));
    const driftMarked = receipt !== null
      && receipt.verified === false
      && receipt.bypassReason === 'staged-tree-mismatch';
    assertSelftest(driftMarked, 'staged-tree-mismatch 未触发');
    const parent = expectSelftestGit(repo.dir, ['rev-parse', `${driftedSha}^`], '自测读取父提交');
    const refsFile = makeMainRefs(repo, 'drift', driftedSha, parent);
    expectSelftestExit(run(['verify-receipts', '--refs-file', refsFile]), 1, 'verify-receipts 树不一致');
    return 'staged-tree-mismatch verified=false verify exit=1';
  }));

  return cases;
}

module.exports = { buildSecuritySelftestCases };
