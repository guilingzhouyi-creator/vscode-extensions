/**
 * Module: Gate Receipts Self-Test Core Lifecycle Cases
 * File Path: scripts/common/lib/gate-receipts-selftest-core.js
 * Architecture Role: Core mark/finalize, baseline exemption, bypass audit log,
 *   and ref/branch-governance verification cases (`a`..`g2`) for gate-receipts.
 * Dependencies & Triggers: `./gate-receipts-selftest-helpers`.
 * Responsibilities:
 *   1. Verify dual-phase mark + finalize receipt creation and pending cleanup;
 *   2. Verify unrecorded bypass detection, baseline exemption, and operator log;
 *   3. Verify protected ref deletion, non-fast-forward blocks, and `FGT-TOP-001`.
 * Exit Semantics & Design Rationale: Returns case result list consumed by
 *   `gate-receipts-selftest.js`.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  ZERO_SHA,
  selftestCli,
  expectSelftestExit,
  assertSelftest,
  selftestCase,
  commitSelftestFile,
  writeSelftestRefs,
  refLine,
  shortSha,
  readJsonSafe,
  countNonEmptyLines,
  readLastJsonLine,
  createDivergentCommit,
} = require('./gate-receipts-selftest-helpers');

function buildCoreSelftestCases(ctx) {
  const { repo, cliPath, receiptsDir, cfg } = ctx;
  const run = (args, input) => selftestCli(cliPath, repo, args, input);
  const cases = [];

  const baseSha = commitSelftestFile(repo, 'note.txt', 'one\n', 'base commit');
  cases.push(selftestCase('a) mark 两阶段 + finalize => verified=true 且 pending 已删除', () => {
    expectSelftestExit(run(['mark', '--phase', 'pre-commit', '--ppid', '4242']), 0, 'mark pre-commit');
    expectSelftestExit(run(['mark', '--phase', 'commit-msg', '--ppid', '4242']), 0, 'mark commit-msg');
    expectSelftestExit(run(['finalize', '--ppid', '4242']), 0, 'finalize');
    const receipt = readJsonSafe(path.join(receiptsDir, `${baseSha}.json`));
    assertSelftest(receipt !== null && receipt.schemaVersion === cfg.schemaVersion && receipt.verified === true, '收据不存在或基础校验失败');
    assertSelftest(receipt.bypass === false && receipt.bypassReason === null && receipt.actor === 'selftest@example.invalid', '绕过或作者不符');
    assertSelftest(receipt.sourceHook === 'post-commit' && typeof receipt.treeSha === 'string' && receipt.treeSha.length > 0, 'sourceHook或treeSha缺失');
    assertSelftest(typeof receipt.indexDigest === 'string' && receipt.indexDigest.length === 40, 'indexDigest 缺失');
    assertSelftest(receipt.phases['pre-commit'] !== undefined && receipt.phases['commit-msg'] !== undefined, 'phases 不完整');
    assertSelftest(!fs.existsSync(path.join(receiptsDir, cfg.pendingDirname, '4242.json')), 'pending 文件未删除');
    return `commitSha=${shortSha(baseSha)} verified=true pending 已删除`;
  }));

  const secondSha = commitSelftestFile(repo, 'note.txt', 'two\n', 'second commit');
  cases.push(selftestCase('b) 无 pending finalize => verified=false, bypass=true, bypassReason 默认值', () => {
    expectSelftestExit(run(['finalize', '--ppid', '4343']), 0, 'finalize 无 pending');
    const receipt = readJsonSafe(path.join(receiptsDir, `${secondSha}.json`));
    assertSelftest(receipt !== null && receipt.verified === false && receipt.bypass === true && receipt.bypassReason === cfg.bypassReason, '收据字段不符');
    return 'verified=false bypass=true bypassReason=no-verify-or-unrecorded';
  }));

  cases.push(selftestCase('c) baseline 之前的提交在 verify-receipts 中被豁免', () => {
    expectSelftestExit(run(['baseline']), 0, 'baseline');
    const baseline = readJsonSafe(path.join(receiptsDir, cfg.baselineFilename));
    assertSelftest(baseline !== null && baseline.commitSha === secondSha, 'baseline commitSha 不符');
    const refsFile = writeSelftestRefs(repo, 'baseline', [refLine('refs/heads/main', secondSha, 'refs/heads/main', ZERO_SHA)]);
    expectSelftestExit(run(['verify-receipts', '--refs-file', refsFile]), 0, 'verify-receipts baseline 豁免');
    return `baseline=${shortSha(secondSha)} 历史提交豁免通过`;
  }));

  const thirdSha = commitSelftestFile(repo, 'note.txt', 'three\n', 'third commit');
  cases.push(selftestCase('d) 新提交无收据 => exit 1；补收据后 exit 0', () => {
    const refsFile = writeSelftestRefs(repo, 'required', [refLine('refs/heads/main', thirdSha, 'refs/heads/main', secondSha)]);
    const blocked = run(['verify-receipts', '--refs-file', refsFile]);
    expectSelftestExit(blocked, 1, 'verify-receipts 缺收据');
    assertSelftest(blocked.stdout.includes('BLOCK 提交'), '缺少 BLOCK 提交行');
    expectSelftestExit(run(['mark', '--phase', 'pre-commit', '--ppid', '5151']), 0, 'mark pre-commit');
    expectSelftestExit(run(['mark', '--phase', 'commit-msg', '--ppid', '5151']), 0, 'mark commit-msg');
    expectSelftestExit(run(['finalize', '--ppid', '5151']), 0, 'finalize');
    expectSelftestExit(run(['verify-receipts', '--refs-file', refsFile]), 0, 'verify-receipts 补收据后');
    return '缺收据 exit=1，补收据 exit=0';
  }));

  const fourthSha = commitSelftestFile(repo, 'note.txt', 'four\n', 'fourth commit');
  cases.push(selftestCase('e) --allow-bypass 缺收据仍 exit 0 且 bypass.log 追加一行', () => {
    const logPath = path.join(receiptsDir, cfg.bypassLogFilename);
    const before = countNonEmptyLines(logPath);
    const refsFile = writeSelftestRefs(repo, 'allow', [refLine('refs/heads/main', fourthSha, 'refs/heads/main', thirdSha)]);
    expectSelftestExit(run(['verify-receipts', '--refs-file', refsFile, '--allow-bypass']), 0, 'verify-receipts --allow-bypass');
    const after = countNonEmptyLines(logPath);
    assertSelftest(after === before + 1, `bypass.log 行数 ${before} -> ${after}`);
    const entry = readLastJsonLine(logPath);
    assertSelftest(entry.commit === fourthSha && entry.ref === 'refs/heads/main' && entry.reason === cfg.operatorBypassReason, 'bypass.log 条目不符');
    assertSelftest(typeof entry.ts === 'string' && entry.ts.length > 0, 'bypass.log ts 缺失');
    return `bypass.log +1 行 reason=${entry.reason}`;
  }));

  const divergentSha = createDivergentCommit(repo, secondSha);
  cases.push(selftestCase('f) verify-refs 受保护分支删除 exit 1，特性分支删除 exit 0', () => {
    const protectedRefs = writeSelftestRefs(repo, 'delete-protected', [refLine('(delete)', ZERO_SHA, 'refs/heads/main', fourthSha)]);
    expectSelftestExit(run(['verify-refs', '--refs-file', protectedRefs]), 1, '删除受保护分支');
    const featureRefs = writeSelftestRefs(repo, 'delete-feature', [refLine('(delete)', ZERO_SHA, 'refs/heads/feature/cleanup', fourthSha)]);
    expectSelftestExit(run(['verify-refs', '--refs-file', featureRefs]), 0, '删除特性分支');
    return '受保护删除 exit=1，特性删除 exit=0';
  }));

  cases.push(selftestCase('g) 非快进推送受保护分支 exit 1，普通快进 exit 0', () => {
    const nonFastForward = writeSelftestRefs(repo, 'non-ff-protected', [refLine('refs/heads/main', fourthSha, 'refs/heads/main', divergentSha)]);
    expectSelftestExit(run(['verify-refs', '--refs-file', nonFastForward]), 1, '非快进受保护分支');
    const fastForward = writeSelftestRefs(repo, 'fast-forward', [refLine('refs/heads/main', fourthSha, 'refs/heads/main', thirdSha)]);
    expectSelftestExit(run(['verify-refs', '--refs-file', fastForward]), 0, '普通快进');
    const featureNonFf = writeSelftestRefs(repo, 'non-ff-feature', [refLine('refs/heads/topic', fourthSha, 'refs/heads/topic', divergentSha)]);
    expectSelftestExit(run(['verify-refs', '--refs-file', featureNonFf]), 0, '非快进特性分支');
    return '非快进受保护 exit=1，快进 exit=0，非快进特性 exit=0';
  }));

  cases.push(selftestCase('g2) 新建分支规范性: 分形规范分支 exit 0，非标分支 exit 1 (FGT-TOP-001)', () => {
    const validBranchRefs = writeSelftestRefs(repo, 'new-valid-branch', [
      refLine('refs/heads/feat/auto-refactor/test-branch', fourthSha, 'refs/heads/feat/auto-refactor/test-branch', ZERO_SHA),
    ]);
    expectSelftestExit(run(['verify-refs', '--refs-file', validBranchRefs]), 0, '新建分形规范分支');
    const invalidBranchRefs = writeSelftestRefs(repo, 'new-invalid-branch', [
      refLine('refs/heads/temp-random-branch', fourthSha, 'refs/heads/temp-random-branch', ZERO_SHA),
    ]);
    expectSelftestExit(run(['verify-refs', '--refs-file', invalidBranchRefs]), 1, '新建非标临时分支');
    return '规范分支 exit=0，非标分支 exit=1';
  }));

  return { baseSha, cases };
}

module.exports = { buildCoreSelftestCases };
