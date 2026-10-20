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
 *   4. Skip the PowerShell side explicitly when pwsh is unavailable.
 * Exit Semantics & Design Rationale: 0 = all comparable cases agree, 1 = divergence or
 *   execution failure. Structural isomorphism cannot detect semantic drift, so this
 *   harness asserts observable behavior instead of source shape.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const FIXTURE_DIR = path.join(REPO_ROOT, '.audit-logs', 'parity');

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
    content:
      'feat(gate): 校验门禁规则正文阈值\n\n[Project / 项目归属]\n- governance\n\n[Why]\n- 甲\n\n[Added]\n- 乙\n\n[Verification]\n- 丙\n',
  },
  {
    name: 'uppercase-type',
    expect: 1,
    content:
      'FEAT(gate): 增加暂存区体积预算的边界校验\n\n[Project / 项目归属]\n- governance\n\n[Why / 动机背景]\n- 现有门禁缺少对单文件物理行数的强制约束，超限文件可以绕过体积红线。\n\n[Added / 新增内容]\n- 新增暂存区体积预算校验与结构化失败信封输出。\n\n[Verification / 验证结论]\n- 本地门禁脚本自测通过，边界样例被正确拦截。\n',
  },
  {
    name: 'quoted-forbidden-term',
    expect: 1,
    content:
      'fix(gate): 修复空指针分支的判定顺序\n\n[Project / 项目归属]\n- governance\n\n[Why / 动机背景]\n- 现有判定在空指针分支上缺少保护，构造边界输入时会抛出异常并中断门禁流程。\n\n[Fixed / 修复缺陷]\n- 这是“临时”方案，先补显式判空与早返回。\n\n[Verification / 验证结论]\n- 以空输入复核，门禁给出结构化阻断而非异常中断。\n',
  },
  {
    name: 'missing-project',
    expect: 1,
    content:
      'feat(gate): 增加暂存区体积预算的边界校验\n\n[Why / 动机背景]\n- 现有门禁缺少对单文件物理行数的强制约束，超限文件可以绕过体积红线。\n\n[Added / 新增内容]\n- 新增暂存区体积预算校验与结构化失败信封输出。\n\n[Verification / 验证结论]\n- 本地门禁脚本自测通过，边界样例被正确拦截。\n',
  },
]);

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

/**
 * Executes one gate implementation on a fixture and returns its exit status.
 *
 * @param {string} command - Executable name.
 * @param {string[]} args - Gate arguments.
 * @param {string} file - Fixture path.
 * @returns {number} Exit status, or -1 on spawn failure.
 */
function runGate(command, args, file) {
  const result = spawnSync(command, [...args, file], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
  if (result.error) return -1;
  return result.status === null ? -1 : result.status;
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
  const shStatus = runGate('bash', ['scripts/sh/commit-msg-gate.sh'], file);
  const psStatus = hasPwsh ? runGate('pwsh', ['-File', 'scripts/ps1/commit-msg-gate.ps1'], file) : null;
  const shOk = shStatus === fixture.expect;
  const psOk = psStatus === null || psStatus === fixture.expect;
  const parity = psStatus === null || shStatus === psStatus;
  const passed = shOk && psOk && parity;
  const pwshTag = psStatus === null ? '' : ` pwsh=${psStatus}`;
  console.log(`${fixture.name}: bash=${shStatus}${pwshTag} expect=${fixture.expect} ${passed ? 'PASS' : 'FAIL'}`);
  return passed;
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
    console.error('FAIL bash is required for parity testing');
    process.exit(1);
  }
  if (!hasPwsh) {
    console.log(
      'SKIP PowerShell implementation unavailable: only the bash expectations can be checked, parity is NOT verified',
    );
    if (requireParity) {
      fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
      console.error('FAIL --require-parity was requested but pwsh is unavailable; parity unverified');
      process.exit(1);
    }
  }
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
  const hasBash = isAvailable('bash', ['--version']);
  assertPrerequisites(hasBash, hasPwsh, requireParity);

  let failures = 0;
  for (const fixture of FIXTURES) {
    if (!evaluateFixture(fixture, hasPwsh)) {
      failures += 1;
    }
  }

  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
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
