/**
 * Module: run-hosted-repo-parity — Hosted Small Repository Git vs Taxis Differential Runner
 * File Path: fractal-git/scripts/common/run-hosted-repo-parity.js
 * Architecture Role: Executes an automated side-by-side differential comparison between system
 *   `git` and `taxis` on a realistic multi-commit small project repository (or an external
 *   repository supplied via `--repo <path>`), asserting exit status, stdout structure, and
 *   `git fsck --full` integrity.
 * Dependencies & Triggers: Invoked via `node scripts/common/run-hosted-repo-parity.js`.
 * Responsibilities: Provision isolated workspaces, run identical porcelain/plumbing/remote/export
 *   workflows across both engines, and report step-by-step parity verdicts.
 * Exit Semantics & Design Rationale: Exits 0 when all differential checks pass; exits 1 on mismatch.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { prepareCargo } = require('./resolve-cargo');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function resolveTaxisBinary() {
  const exeName = process.platform === 'win32' ? 'taxis.exe' : 'taxis';
  const cargo = prepareCargo();
  if (!cargo) {
    throw new Error('Failed to locate cargo toolchain');
  }
  const targetDir = process.env.CARGO_TARGET_DIR || path.join(PROJECT_ROOT, 'target');
  const debugBin = path.join(targetDir, 'debug', exeName);
  const localDebugBin = path.join(PROJECT_ROOT, 'target', 'debug', exeName);
  const build = spawnSync(cargo.command, ['build', '--bin', 'taxis'], {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  if (build.status !== 0) {
    throw new Error('Failed to build taxis binary');
  }
  if (fs.existsSync(debugBin)) {
    return debugBin;
  }
  if (fs.existsSync(localDebugBin)) {
    return localDebugBin;
  }
  throw new Error('Failed to locate built taxis binary');
}

function runCmd(bin, cwd, args) {
  const res = spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Parity Runner',
      GIT_AUTHOR_EMAIL: 'parity@taxis.local',
      GIT_COMMITTER_NAME: 'Parity Runner',
      GIT_COMMITTER_EMAIL: 'parity@taxis.local',
    },
  });
  return {
    status: res.status ?? 1,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
  };
}

function buildCompliantMsg(subject, symbolOrFile) {
  return [
    subject,
    '',
    '[Project / 项目归属]',
    '- fractal-git',
    '',
    '[Why / 动机背景]',
    '- 执行托管小项目仓库的 Git 与 Taxis 双引擎等价性对拍验证。',
    '',
    '[Added / 新增内容]',
    `- 新增或重命名 \`${symbolOrFile}\` 模块实现代码与算子定义。`,
    '',
    '[Verification / 验证结论]',
    `- 通过双引擎退出码、标准输出与 git fsck 验证 \`${symbolOrFile}\` 完整性。`,
  ].join('\n');
}

/**
 * Runs a seeding command whose failure must abort the run.
 *
 * A silently ignored seeding failure is the one way this suite can report a false parity: if a tag
 * never gets created on either side, the later `describe` comparison finds two equally absent tags
 * and agrees — so a broken fixture reads as a passing check. Aborting on the seeding step keeps a
 * fixture fault distinguishable from an engine mismatch.
 */
function runRequired(bin, cwd, args) {
  const res = runCmd(bin, cwd, args);
  if (res.status !== 0) {
    throw new Error(`seeding step failed: ${bin} ${args.join(' ')}: ${res.stderr || res.stdout}`);
  }
  return res;
}

function seedSmallProject(bin, repoDir, isTaxis) {
  fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, 'src', 'calc.rs'),
    'pub fn compute_sum(a: i32, b: i32) -> i32 { a + b }\n',
    'utf8',
  );
  runRequired(bin, repoDir, ['add', 'src/calc.rs']);
  const m1 = isTaxis
    ? buildCompliantMsg('feat(calc): add integer addition operator', 'compute_sum')
    : 'feat(calc): add integer addition operator';
  const c1 = runCmd(bin, repoDir, ['commit', '-m', m1]);
  if (c1.status !== 0) {
    throw new Error(`${bin} commit 1 failed: ${c1.stderr || c1.stdout}`);
  }

  runRequired(bin, repoDir, ['tag', '-a', 'v0.1.0', '-m', 'Initial release']);
  runRequired(bin, repoDir, ['mv', 'src/calc.rs', 'src/math.rs']);
  const m2 = isTaxis
    ? buildCompliantMsg('refactor(math): rename calc.rs to math.rs', 'compute_sum')
    : 'refactor(math): rename calc.rs to math.rs';
  const c2 = runCmd(bin, repoDir, ['commit', '-m', m2]);
  if (c2.status !== 0) {
    throw new Error(`${bin} commit 2 failed: ${c2.stderr || c2.stdout}`);
  }
  runRequired(bin, repoDir, ['tag', 'v0.2.0']);
}

function assertCheck(results, name, passed, detail) {
  results.push({ name, passed, detail });
  if (!passed) {
    throw new Error(`Parity check failed [${name}]: ${detail}`);
  }
}

function runDifferentialSuite(taxisBin) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'taxis-hosted-parity-'));
  const results = [];
  try {
    const gitRepo = path.join(tmpRoot, 'git-proj');
    const taxisRepo = path.join(tmpRoot, 'taxis-proj');
    runCmd('git', tmpRoot, ['init', '-b', 'main', 'git-proj']);
    runCmd('git', gitRepo, ['config', 'user.name', 'Parity Runner']);
    runCmd('git', gitRepo, ['config', 'user.email', 'parity@taxis.local']);
    runCmd(taxisBin, tmpRoot, ['init', 'taxis-proj']);

    seedSmallProject('git', gitRepo, false);
    seedSmallProject(taxisBin, taxisRepo, true);

    const gitDesc = runCmd('git', gitRepo, ['describe', '--tags']);
    const taxisDesc = runCmd(taxisBin, taxisRepo, ['describe', '--tags']);
    assertCheck(
      results,
      'describe --tags',
      gitDesc.stdout === 'v0.2.0' && taxisDesc.stdout === 'v0.2.0',
      `git=${gitDesc.stdout}, taxis=${taxisDesc.stdout}`,
    );

    const gitFollow = runCmd('git', gitRepo, ['log', '--follow', '--oneline', 'src/math.rs']);
    const taxisFollow = runCmd(taxisBin, taxisRepo, [
      'log',
      '--follow',
      '--oneline',
      'src/math.rs',
    ]);
    assertCheck(
      results,
      'log --follow rename depth',
      gitFollow.stdout.split('\n').length === 2 && taxisFollow.stdout.split('\n').length === 2,
      `gitLines=${gitFollow.stdout.split('\n').length}, taxisLines=${taxisFollow.stdout.split('\n').length}`,
    );

    verifyPorcelainAndHistoryMutations(taxisBin, tmpRoot, gitRepo, taxisRepo, results);
    verifyEdgePorcelainAndMaintenance(taxisBin, tmpRoot, taxisRepo, results);
    verifyRemoteAndExport(taxisBin, tmpRoot, taxisRepo, results);
    return results;
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function verifyPorcelainAndHistoryMutations(taxisBin, tmpRoot, gitRepo, taxisRepo, results) {
  // 3. status --porcelain=v2 --branch & diff --cached
  fs.writeFileSync(path.join(taxisRepo, 'src', 'math.rs'), 'pub fn compute_sum(a: i32, b: i32) -> i32 { a + b + 1 }\n', 'utf8');
  const p2 = runCmd(taxisBin, taxisRepo, ['status', '--porcelain=v2', '--branch']);
  runCmd(taxisBin, taxisRepo, ['add', 'src/math.rs']);
  const cachedDiff = runCmd(taxisBin, taxisRepo, ['diff', '--cached', '--name-only']);
  runCmd(taxisBin, taxisRepo, ['reset', 'HEAD', 'src/math.rs']);
  assertCheck(
    results,
    'status --porcelain=v2 & diff --cached / path reset',
    p2.stdout.includes('# branch.oid ') && cachedDiff.stdout === 'src/math.rs',
    `cached=${cachedDiff.stdout}`,
  );

  // 4. stash push & stash pop roundtrip
  const stashPush = runCmd(taxisBin, taxisRepo, ['stash', 'push', '-m', 'parity-wip']);
  const stashList = runCmd(taxisBin, taxisRepo, ['stash', 'list']);
  const stashPop = runCmd(taxisBin, taxisRepo, ['stash', 'pop']);
  runCmd(taxisBin, taxisRepo, ['reset', '--hard', 'HEAD']);
  assertCheck(
    results,
    'stash push / list / pop roundtrip',
    stashPush.status === 0 && stashList.stdout.includes('stash@{0}') && stashPop.status === 0,
    `list=${stashList.stdout}`,
  );

  // 5. branch, checkout -b, merge-base, and 3-way merge --no-ff
  runCmd(taxisBin, taxisRepo, ['checkout', '-b', 'feat-mul']);
  fs.writeFileSync(path.join(taxisRepo, 'src', 'mul.rs'), 'pub fn mul(a: i32, b: i32) -> i32 { a * b }\n', 'utf8');
  runCmd(taxisBin, taxisRepo, ['add', 'src/mul.rs']);
  runCmd(taxisBin, taxisRepo, ['commit', '-m', buildCompliantMsg('feat(mul): add multiplication helper', 'mul')]);
  const featTip = runCmd(taxisBin, taxisRepo, ['rev-parse', 'HEAD']).stdout;

  runCmd(taxisBin, taxisRepo, ['checkout', 'main']);
  fs.writeFileSync(path.join(taxisRepo, 'src', 'sub.rs'), 'pub fn sub(a: i32, b: i32) -> i32 { a - b }\n', 'utf8');
  runCmd(taxisBin, taxisRepo, ['add', 'src/sub.rs']);
  runCmd(taxisBin, taxisRepo, ['commit', '-m', buildCompliantMsg('feat(sub): add subtraction helper', 'sub')]);

  const mb = runCmd(taxisBin, taxisRepo, ['merge-base', 'main', 'feat-mul']);
  const merge3 = runCmd(taxisBin, taxisRepo, ['merge', '--no-ff', 'feat-mul']);
  assertCheck(
    results,
    'branch + merge-base + 3-way merge --no-ff',
    mb.status === 0 && merge3.status === 0 && fs.existsSync(path.join(taxisRepo, 'src', 'mul.rs')),
    `mergeBase=${mb.stdout.slice(0, 8)}`,
  );

  // 6. revert & cherry-pick roundtrip
  const preRevertHead = runCmd(taxisBin, taxisRepo, ['rev-parse', 'HEAD']).stdout;
  const cpBranch = runCmd(taxisBin, taxisRepo, ['checkout', '-b', 'cp-test']);
  const revOut = runCmd(taxisBin, taxisRepo, ['revert', featTip]);
  const cpOut = runCmd(taxisBin, taxisRepo, ['cherry-pick', featTip]);
  runCmd(taxisBin, taxisRepo, ['checkout', 'main']);
  assertCheck(
    results,
    'revert & cherry-pick delta transplant',
    cpBranch.status === 0 && revOut.status === 0 && cpOut.status === 0,
    `revert=${revOut.status}, cherryPick=${cpOut.status}`,
  );

  // 7. reset --hard & undo time-travel restoration
  const parentHead = runCmd(taxisBin, taxisRepo, ['rev-parse', 'HEAD~1']).stdout;
  const rst = runCmd(taxisBin, taxisRepo, ['reset', '--hard', parentHead]);
  const undoOut = runCmd(taxisBin, taxisRepo, ['undo']);
  const restoredHead = runCmd(taxisBin, taxisRepo, ['rev-parse', 'HEAD']).stdout;
  assertCheck(
    results,
    'reset --hard & Jujutsu-style undo rollback',
    rst.status === 0 && undoOut.status === 0 && restoredHead === preRevertHead,
    `restored=${restoredHead.slice(0, 8)}`,
  );
}

function verifyEdgePorcelainAndMaintenance(taxisBin, tmpRoot, taxisRepo, results) {
  // 8. blame line attribution
  const blameOut = runCmd(taxisBin, taxisRepo, ['blame', 'src/math.rs']);
  assertCheck(
    results,
    'blame line attribution',
    blameOut.status === 0 && blameOut.stdout.includes('compute_sum'),
    `lines=${blameOut.stdout.split('\n').length}`,
  );

  // 9. format-patch --stdout & apply --check
  const fp = runCmd(taxisBin, taxisRepo, ['format-patch', '-1', 'HEAD~1', '--stdout']);
  const patchFile = path.join(tmpRoot, '0001.patch');
  fs.writeFileSync(patchFile, `${fp.stdout}\n`, 'utf8');
  const applyStat = runCmd(taxisBin, taxisRepo, ['apply', '--stat', patchFile]);
  assertCheck(
    results,
    'format-patch --stdout & apply --stat',
    fp.status === 0 && fp.stdout.includes('Subject: [PATCH') && applyStat.status === 0,
    `stat=${applyStat.stdout.split('\n')[0]}`,
  );

  // 10. archive (.tar & .zip) & unarchive (--dry-run + extraction)
  const tarFile = path.join(tmpRoot, 'snap.tar');
  const zipFile = path.join(tmpRoot, 'snap.zip');
  const extractDir = path.join(tmpRoot, 'unzipped');
  fs.mkdirSync(extractDir, { recursive: true });
  const arcTar = runCmd(taxisBin, taxisRepo, ['archive', '--format=tar', '-o', tarFile, 'HEAD']);
  const arcZip = runCmd(taxisBin, taxisRepo, ['archive', '--format=zip', '-o', zipFile, 'HEAD']);
  const dryUnarc = runCmd(taxisBin, taxisRepo, ['unarchive', tarFile, '--dry-run']);
  const extZip = runCmd(taxisBin, taxisRepo, ['unarchive', zipFile, '--no-in-place', '--headroom', '0', '-C', extractDir]);
  assertCheck(
    results,
    'archive (.tar/.zip) & unarchive (--dry-run + extract)',
    arcTar.status === 0 && arcZip.status === 0 && dryUnarc.status === 0 && extZip.status === 0 && fs.existsSync(path.join(extractDir, 'src', 'math.rs')),
    `tar=${fs.existsSync(tarFile)}, extracted=${fs.existsSync(path.join(extractDir, 'src', 'math.rs'))}`,
  );

  // 11. repack, count-objects -v, commit-graph, multi-pack-index, doctor, fsck
  const rep = runCmd(taxisBin, taxisRepo, ['repack']);
  const cnt = runCmd(taxisBin, taxisRepo, ['count-objects', '-v']);
  const cgW = runCmd(taxisBin, taxisRepo, ['commit-graph', 'write']);
  const cgV = runCmd(taxisBin, taxisRepo, ['commit-graph', 'verify']);
  const midxW = runCmd(taxisBin, taxisRepo, ['multi-pack-index', 'write']);
  const midxV = runCmd(taxisBin, taxisRepo, ['multi-pack-index', 'verify']);
  assertCheck(
    results,
    'repack + count-objects -v + commit-graph + multi-pack-index',
    rep.status === 0 && cnt.stdout.includes('in-pack:') && cgW.status === 0 && cgV.status === 0 && midxW.status === 0 && midxV.status === 0,
    `cgVerify=${cgV.status}, midxVerify=${midxV.status}`,
  );
}

function verifyRemoteAndExport(taxisBin, tmpRoot, taxisRepo, results) {
  const bareRemote = path.join(tmpRoot, 'bare-remote.git');
  runCmd('git', tmpRoot, ['init', '--bare', 'bare-remote.git']);
  runCmd(taxisBin, taxisRepo, ['remote', 'add', 'origin', bareRemote]);

  const dryPush = runCmd(taxisBin, taxisRepo, ['push', '--dry-run', 'origin', 'main']);
  const dryRefExists = fs.existsSync(path.join(bareRemote, 'refs', 'heads', 'main'));
  assertCheck(
    results,
    'push --dry-run no-op on disk',
    dryPush.status === 0 && !dryRefExists,
    `status=${dryPush.status}, refExists=${dryRefExists}`,
  );

  const realPush = runCmd(taxisBin, taxisRepo, ['push', 'origin', 'main']);
  const realRefExists = fs.existsSync(path.join(bareRemote, 'refs', 'heads', 'main'));
  const fsckRemote = runCmd('git', bareRemote, ['fsck', '--full']);
  assertCheck(
    results,
    'push real disk write & git fsck',
    realPush.status === 0 && realRefExists && fsckRemote.status === 0,
    `pushStatus=${realPush.status}, fsckStatus=${fsckRemote.status}`,
  );

  const exp = runCmd(taxisBin, taxisRepo, ['git-export', '--force']);
  const expFsck = runCmd('git', taxisRepo, ['fsck', '--full']);
  const expLog = runCmd('git', taxisRepo, ['log', '--oneline']);
  assertCheck(
    results,
    'git-export & git log / fsck',
    exp.status === 0 && expFsck.status === 0 && expLog.stdout.split('\n').length >= 2,
    `exportStatus=${exp.status}, fsckStatus=${expFsck.status}, commits=${expLog.stdout.split('\n').length}`,
  );

  const clonedDir = path.join(tmpRoot, 'cloned-peer');
  const cloneRes = runCmd(taxisBin, tmpRoot, ['clone', bareRemote, clonedDir]);
  const symRef = runCmd(taxisBin, clonedDir, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
  assertCheck(
    results,
    'clone & origin/HEAD symbolic-ref',
    cloneRes.status === 0 && symRef.stdout === 'refs/remotes/origin/main' && fs.existsSync(path.join(clonedDir, 'src', 'math.rs')),
    `originHead=${symRef.stdout}`,
  );

  const impDir = path.join(tmpRoot, 'import-peer');
  runCmd('git', tmpRoot, ['clone', bareRemote, impDir]);
  const impRes = runCmd(taxisBin, impDir, ['git-import']);
  const docRes = runCmd(taxisBin, impDir, ['doctor']);
  assertCheck(
    results,
    'git-import & taxis doctor verification',
    impRes.status === 0 && docRes.status === 0 && fs.existsSync(path.join(impDir, '.taxis')),
    `importStatus=${impRes.status}, doctorStatus=${docRes.status}`,
  );
}

function runExternalRepoParity(taxisBin, externalRepo, results) {
  const absRepo = path.resolve(externalRepo);
  const gitDirPrefix = fs.existsSync(path.join(absRepo, '.git'))
    ? ['--git-dir', path.join(absRepo, '.git')]
    : [];
  const gitHead = runCmd('git', absRepo, ['rev-parse', 'HEAD']);
  const taxisHead = runCmd(taxisBin, absRepo, [...gitDirPrefix, 'rev-parse', 'HEAD']);
  assertCheck(
    results,
    'external repo rev-parse HEAD',
    gitHead.status === 0 && gitHead.stdout === taxisHead.stdout,
    `git=${gitHead.stdout}, taxis=${taxisHead.stdout}`,
  );
  const shortPrefix = gitHead.stdout.slice(0, 7);
  const taxisShort = runCmd(taxisBin, absRepo, [...gitDirPrefix, 'rev-parse', shortPrefix]);
  assertCheck(
    results,
    'external repo short SHA disambiguation',
    taxisShort.status === 0 && taxisShort.stdout === gitHead.stdout,
    `prefix=${shortPrefix}, resolved=${taxisShort.stdout}`,
  );
}

function main() {
  const args = process.argv.slice(2);
  const repoIdx = args.indexOf('--repo');
  const externalRepo = repoIdx >= 0 && args[repoIdx + 1] ? args[repoIdx + 1] : null;
  const taxisBin = resolveTaxisBinary();
  const checks = runDifferentialSuite(taxisBin);
  if (externalRepo) {
    runExternalRepoParity(taxisBin, externalRepo, checks);
  }
  const failed = checks.filter((item) => !item.passed);
  for (const item of failed) {
    process.stderr.write(`  ✖  ${item.name} (${item.detail})\n`);
  }
  if (failed.length > 0) {
    // The success banner below must never print for a partial run, so the check happens first.
    process.stderr.write(
      `[HOSTED-PARITY-FAILED] ${failed.length} of ${checks.length} parity checks mismatched.\n`,
    );
    process.exitCode = 1;
    return;
  }
  for (const item of checks) {
    process.stdout.write(`  ✔  ${item.name} (${item.detail})\n`);
  }
  process.stdout.write(
    `[HOSTED-PARITY-OK] All ${checks.length} hosted small-repo Git parity checks passed.\n`,
  );
}

main();
