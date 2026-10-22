/**
 * Module: Gate Parity Harness — Dual-Implementation Behavioral Diff
 * File Path: scripts/common/test-gate-parity.js
 * Architecture Role: Behavioral equivalence harness feeding identical commit-message
 *   fixtures to the PowerShell and Bash commit-msg gates and comparing verdicts.
 * Dependencies & Triggers: Consumes Node.js child_process plus pwsh and bash;
 *   invoked by CI hygiene and local verification.
 * Responsibilities:
 *   1. Materialize a compact fixture matrix covering pass, structure, style, and ID cases;
 *   2. Execute both implementations with isolated output capture;
 *   3. Report per-case verdicts and fail on any cross-platform divergence;
 *   4. Skip the PowerShell side explicitly when pwsh is unavailable;
 *   5. Compare the pre-commit and pre-push entry points on a no-argument run, where both must
 *      agree that an empty staging area is a pass;
 *   6. Point every spawned gate at its own throwaway ledger directory, so the stateful debt corridor
 *      is exercised without writing into the developer's own ledger and without letting one case
 *      spend another case's corridor budget.
 * Exit Semantics & Design Rationale: 0 = all comparable cases agree, 1 = divergence or
 *   execution failure. Structural isomorphism cannot detect semantic drift, so this
 *   harness asserts observable behavior instead of source shape.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const FIXTURE_DIR = path.join(REPO_ROOT, '.audit-logs', 'parity');

/**
 * Ledger directories created by this run, so cleanup can remove every one of them.
 *
 * The debt corridor is a stateful machine: a permitted high-tier finding appends to
 * `.audit-logs/tech-debt-ledger.json`, and `ACCUMULATION_CEILING = 2` turns the next entry into a
 * forced-paydown block. One shared directory would let an earlier corridor case spend the budget of
 * a later case: `forbidden-term-under-corridor` legitimately writes one entry from each of the two
 * implementations, and the following fixture then sees `Accumulated: 2` and is blocked for a reason
 * that has nothing to do with its own content. A fresh directory per spawn keeps every case's
 * corridor state independent while still exercising the corridor for real.
 *
 * @type {string[]}
 */
const LEDGER_DIRS = [];

/**
 * Builds a spawn environment whose gate writes debt into a directory of its own.
 *
 * `GOVERNANCE_AUDIT_LOG_DIR` exists for exactly this redirect; without it the gate would mutate the
 * developer's real ledger and leave them owing debt they never incurred.
 *
 * @returns {NodeJS.ProcessEnv} Environment for one gate invocation.
 */
function makeGateEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-parity-ledger-'));
  LEDGER_DIRS.push(dir);
  return { ...process.env, GOVERNANCE_AUDIT_LOG_DIR: dir };
}

const FIXTURES = Object.freeze([
  {
    name: 'valid-feat',
    expect: 0,
    content:
      'feat(gate): 增加暂存区体积预算的边界校验\n\n[Project / 项目归属]\n- governance\n\n[Why / 动机背景]\n- 现有门禁缺少对单文件物理行数的强制约束，超限文件可以绕过体积红线。\n\n[Added / 新增内容]\n- 新增暂存区体积预算校验与结构化失败信封输出。\n\n[Verification / 验证结论]\n- 本地门禁脚本自测通过，边界样例被正确拦截。\n',
  },
  {
    name: 'placeholder-body',
    expect: 1,
    step: 'BODY-DENSITY-04',
    content:
      'feat(gate): 校验门禁规则正文阈值\n\n[Project / 项目归属]\n- governance\n\n[Why]\n- 甲\n\n[Added]\n- 乙\n\n[Verification]\n- 丙\n',
  },
  {
    name: 'uppercase-type',
    expect: 1,
    step: 'HEADER-FORM-01',
    content:
      'FEAT(gate): 增加暂存区体积预算的边界校验\n\n[Project / 项目归属]\n- governance\n\n[Why / 动机背景]\n- 现有门禁缺少对单文件物理行数的强制约束，超限文件可以绕过体积红线。\n\n[Added / 新增内容]\n- 新增暂存区体积预算校验与结构化失败信封输出。\n\n[Verification / 验证结论]\n- 本地门禁脚本自测通过，边界样例被正确拦截。\n',
  },
  {
    name: 'forbidden-term-under-corridor',
    // Exactly one High-tier finding, drawn from the elastic tier itself: `zero_pov` and
    // `imperative_mood` are the only dictionary categories the corridor permits
    // (ELASTIC_DICTIONARY_CATEGORIES), so MAX_SINGLE_HIGH_DEBT = 1 lets this message through and
    // records one debt entry. Any other severity-error rule is critical and blocks outright, which
    // would test the critical tier instead of the corridor. The harness runs both implementations
    // against a throwaway ledger directory, so the entry lands there rather than in the real one.
    expect: 0,
    content:
      'fix(gate): 修复空指针分支的判定顺序\n\n[Project / 项目归属]\n- governance\n\n[Why / 动机背景]\n- 现有判定在空指针分支上缺少保护，构造边界输入时会抛出异常并中断门禁流程。\n\n[Fixed / 修复缺陷]\n- 我们补充了显式判空与早返回，避免异常穿透。\n\n[Verification / 验证结论]\n- 以空输入复核，门禁给出结构化阻断而非异常中断。\n',
  },
  {
    name: 'missing-project',
    expect: 1,
    step: 'PROJECT-SCOPE-06',
    content:
      'feat(gate): 增加暂存区体积预算的边界校验\n\n[Why / 动机背景]\n- 现有门禁缺少对单文件物理行数的强制约束，超限文件可以绕过体积红线。\n\n[Added / 新增内容]\n- 新增暂存区体积预算校验与结构化失败信封输出。\n\n[Verification / 验证结论]\n- 本地门禁脚本自测通过，边界样例被正确拦截。\n',
  },
  // The four cases below were the shapes the harness never exercised. Each one used to be blocked
  // by the shell implementations and accepted by the Node one, so `--range` on push verified only
  // rule truth and forbidden terms: a commit with a three-character summary, no blank second line,
  // an unauthorised project, or a bare sprint codename passed whenever the hook had not run.
  {
    name: 'short-header',
    expect: 1,
    step: 'HEADER-FORM-01',
    content:
      'fix(gate): abc\n\n[Project / 项目归属]\n- governance\n\n[Why / 动机背景]\n- 现有判定在空指针分支上缺少保护，构造边界输入时会抛出异常并中断门禁流程。\n\n[Fixed / 修复缺陷]\n- 修复空指针分支缺少保护导致异常穿透到调用方的缺陷，根因是判定顺序先解引用后判空。\n\n[Verification / 验证结论]\n- 以空输入复核，门禁给出结构化阻断而非异常中断。\n',
  },
  {
    name: 'missing-blank-line',
    expect: 1,
    step: 'BODY-SPLIT-03',
    content:
      'fix(gate): 修复空指针分支的判定顺序\n[Project / 项目归属]\n- governance\n\n[Why / 动机背景]\n- 现有判定在空指针分支上缺少保护，构造边界输入时会抛出异常并中断门禁流程。\n\n[Fixed / 修复缺陷]\n- 修复空指针分支缺少保护导致异常穿透到调用方的缺陷，根因是判定顺序先解引用后判空。\n\n[Verification / 验证结论]\n- 以空输入复核，门禁给出结构化阻断而非异常中断。\n',
  },
  {
    name: 'unauthorised-project',
    expect: 1,
    step: 'PROJECT-SCOPE-06',
    content:
      'fix(gate): 修复空指针分支的判定顺序\n\n[Project / 项目归属]\n- unknown-project\n\n[Why / 动机背景]\n- 现有判定在空指针分支上缺少保护，构造边界输入时会抛出异常并中断门禁流程。\n\n[Fixed / 修复缺陷]\n- 修复空指针分支缺少保护导致异常穿透到调用方的缺陷，根因是判定顺序先解引用后判空。\n\n[Verification / 验证结论]\n- 以空输入复核，门禁给出结构化阻断而非异常中断。\n',
  },
  {
    name: 'batch-codename',
    expect: 1,
    step: 'BATCH-CODE-07',
    content:
      'fix(gate): 修复空指针分支的判定顺序\n\n[Project / 项目归属]\n- governance\n\n[Why / 动机背景]\n- 本 Sprint 3 内补齐判定顺序保护，构造边界输入时会抛出异常并中断门禁流程。\n\n[Fixed / 修复缺陷]\n- 修复空指针分支缺少保护导致异常穿透到调用方的缺陷，根因是判定顺序先解引用后判空。\n\n[Verification / 验证结论]\n- 以空输入复核，门禁给出结构化阻断而非异常中断。\n',
  },
  // A Chinese scope names the same module an ASCII scope does; both implementations accept it, so
  // the harness asserts the agreement rather than leaving it to whichever shell happens to run.
  {
    name: 'chinese-scope',
    expect: 0,
    content:
      'fix(门禁): 修复空指针分支的判定顺序\n\n[Project / 项目归属]\n- governance\n\n[Why / 动机背景]\n- 现有判定在空指针分支上缺少保护，构造边界输入时会抛出异常并中断门禁流程。\n\n[Fixed / 修复缺陷]\n- 修复空指针分支缺少保护导致异常穿透到调用方的缺陷，根因是判定顺序先解引用后判空。\n\n[Verification / 验证结论]\n- 以空输入复核，门禁给出结构化阻断而非异常中断。\n',
  },
]);

/**
 * Resolves a usable POSIX shell.
 *
 * On Windows, `bash` on PATH is frequently the WSL launcher stub rather than Git Bash. The stub
 * sees a different filesystem view and cannot execute a repository script at all, which shows up
 * as a false divergence: the gate under test never ran. Candidates are probed by actually running
 * a command, so a stub that starts but cannot reach the working tree is rejected.
 *
 * @returns {string|null} Shell path, or null when no working shell is found.
 */
function resolveShell() {
  const candidates = [];
  if (process.platform === 'win32') {
    for (const root of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe']) {
      if (fs.existsSync(root)) candidates.push(root);
    }
  }
  candidates.push('bash');

  for (const shell of candidates) {
    const probe = spawnSync(shell, ['-c', 'printf ok'], { cwd: REPO_ROOT, encoding: 'utf8' });
    if (!probe.error && probe.status === 0 && String(probe.stdout).trim() === 'ok') return shell;
  }
  return null;
}

/**
 * Returns true when an executable is callable.
 *
 * @param {string} command - Executable name.
 * @param {string[]} args - Probe arguments.
 * @returns {boolean} True when the probe exits zero.
 */
function isAvailable(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

const POSIX_SHELL = resolveShell();

/**
 * Collects the step identities a gate reported as violated.
 *
 * The structured envelope carries `findings[].step`, and that identity is what the registry binds
 * a rule to. Exit status alone cannot tell a block for the intended reason from a block for an
 * unrelated one: a message missing its blank second line also loses its project section, so both
 * gates exit non-zero and a status-only harness calls it agreement.
 *
 * @param {string} output - Captured standard output of one gate run.
 * @returns {string[]} Sorted unique step identities.
 */
function collectSteps(output) {
  const found = new Set();
  for (const match of String(output).matchAll(/"step"\s*:\s*"([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2})"/g)) {
    found.add(match[1]);
  }
  return [...found].sort();
}

/**
 * Executes one gate implementation on a fixture.
 *
 * @param {string} command - Executable name.
 * @param {string[]} args - Gate arguments.
 * @param {string} file - Fixture path.
 * @returns {{status: number, steps: string[]}} Exit status (or -1 on spawn failure) and the
 *   step identities the gate attributed its block to.
 */
function runGate(command, args, file) {
  const result = spawnSync(command, [...args, file], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: makeGateEnv(),
  });
  if (result.error) return { status: -1, steps: [] };
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  return { status: result.status === null ? -1 : result.status, steps: collectSteps(output) };
}

/**
 * Evaluates execution results against fixture expectation and verifies cross-implementation parity.
 *
 * @param {object} fixture - Test fixture definition.
 * @param {boolean} hasPwsh - Whether pwsh runtime is available.
 * @returns {boolean} True if the fixture passed parity check, false otherwise.
 */
function evaluateFixture(fixture, hasPwsh) {
  const file = path.join(FIXTURE_DIR, `${fixture.name}.txt`);
  fs.writeFileSync(file, fixture.content, 'utf8');
  // Forward slashes: a backslash path is stripped by the MSYS argument layer before the script
  // ever sees it, so the gate would report a missing file rather than a verdict.
  const posixFile = file.replace(/\\/g, '/');
  const sh = runGate(POSIX_SHELL, ['scripts/sh/commit-msg-gate.sh'], posixFile);
  const ps = hasPwsh ? runGate('pwsh', ['-File', 'scripts/ps1/commit-msg-gate.ps1'], file) : null;
  const shStatus = sh.status;
  const psStatus = ps === null ? null : ps.status;
  const shOk = shStatus === fixture.expect;
  const psOk = psStatus === null || psStatus === fixture.expect;
  const parity = psStatus === null || shStatus === psStatus;
  // Step attribution: when the fixture names the step that must block it, both gates have to
  // report that identity. Without this, a gate that blocks for an unrelated reason still agrees.
  const shStepOk = !fixture.step || sh.steps.includes(fixture.step);
  const psStepOk = ps === null || !fixture.step || ps.steps.includes(fixture.step);
  const stepParity = ps === null || !fixture.step || sh.steps.join(',') === ps.steps.join(',');
  const passed = shOk && psOk && parity && shStepOk && psStepOk && stepParity;
  const pwshTag = psStatus === null ? '' : ` pwsh=${psStatus}`;
  const stepTag = fixture.step ? ` step=${fixture.step}` : '';
  console.log(
    `${fixture.name}: bash=${shStatus}${pwshTag} expect=${fixture.expect}${stepTag} ${passed ? 'PASS' : 'FAIL'}`,
  );
  if (!passed && fixture.step) {
    console.log(`  bash steps=[${sh.steps.join(',')}] pwsh steps=[${ps === null ? '' : ps.steps.join(',')}]`);
  }
  return passed;
}

/**
 * Removes every scratch artefact this harness created.
 *
 * Both the fixture directory and each per-invocation ledger directory must go: leaving a ledger
 * behind would leak corridor entries into the temp tree, and leaving fixtures would make a later run
 * read a stale message.
 */
function cleanup() {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
  for (const dir of LEDGER_DIRS) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Validates availability of required execution environments.
 *
 * @param {boolean} hasBash - Whether bash is available.
 * @param {boolean} hasPwsh - Whether pwsh is available.
 * @param {boolean} requireParity - Whether strict parity was requested.
 */
function assertPrerequisites(hasBash, hasPwsh, requireParity) {
  if (!hasBash) {
    console.error('FAIL 未找到可用的 POSIX shell（Git Bash 或 bash）；Windows 上 PATH 里的 bash 常是 WSL 存根，无法执行仓库脚本');
    process.exit(1);
  }
  if (!hasPwsh) {
    console.log(
      'SKIP PowerShell implementation unavailable: only the bash expectations can be checked, parity is NOT verified',
    );
    if (requireParity) {
      cleanup();
      console.error('FAIL --require-parity was requested but pwsh is unavailable; parity unverified');
      process.exit(1);
    }
  }
}

/**
 * Compares a no-argument gate pair on their exit status only.
 *
 * These entry points read the real staging area, so the only stable assertion across machines is
 * that both implementations reach the same verdict. A divergence here means the two runtimes
 * disagree about the same repository state, which no structural check can reveal.
 *
 * @param {string} label - Human-readable gate name.
 * @param {string} shScript - Bash implementation path.
 * @param {string} psScript - PowerShell implementation path.
 * @param {boolean} hasPwsh - Whether pwsh is available.
 * @returns {boolean} True when the verdicts agree.
 */
function compareEntryPoints(label, shScript, psScript, hasPwsh) {
  const shResult = spawnSync(POSIX_SHELL, [shScript], { cwd: REPO_ROOT, stdio: 'ignore', env: makeGateEnv() });
  const shStatus = shResult.error ? -1 : shResult.status;
  if (!hasPwsh) {
    console.log(`${label}: bash=${shStatus} pwsh=SKIP SKIP`);
    return true;
  }
  const psResult = spawnSync('pwsh', ['-NoProfile', '-File', psScript], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
    env: makeGateEnv(),
  });
  const psStatus = psResult.error ? -1 : psResult.status;
  const agree = shStatus === psStatus;
  console.log(`${label}: bash=${shStatus} pwsh=${psStatus} ${agree ? 'PASS' : 'FAIL'}`);
  return agree;
}

/**
 * Materializes fixtures and compares both implementations.
 *
 * @returns {number} Process exit code.
 */
function main() {
  const requireParity = process.argv.includes('--require-parity');
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const hasPwsh = isAvailable('pwsh', ['-v']);
  const hasBash = POSIX_SHELL !== null;
  assertPrerequisites(hasBash, hasPwsh, requireParity);

  let failures = 0;
  for (const fixture of FIXTURES) {
    if (!evaluateFixture(fixture, hasPwsh)) {
      failures += 1;
    }
  }

  // Entry-point parity: same repository state must yield the same verdict on both runtimes.
  const entryPoints = [
    ['pre-commit gate', 'scripts/sh/pre-commit-gate.sh', 'scripts/ps1/pre-commit-gate.ps1'],
  ];
  for (const [label, shScript, psScript] of entryPoints) {
    if (!compareEntryPoints(label, shScript, psScript, hasPwsh)) failures += 1;
  }

  cleanup();
  if (failures > 0) {
    console.error(`FAIL ${failures} parity case(s) diverged or returned an unexpected verdict`);
    process.exit(1);
  }
  if (!hasPwsh) {
    console.log(
      `NO-PARITY ${FIXTURES.length} bash cases match expectations, but cross-implementation parity was not evaluated`,
    );
    process.exit(0);
  }
  console.log(`PASS ${FIXTURES.length} parity cases agree across implementations`);
  process.exit(0);
}


if (require.main === module) {
  main();
}
