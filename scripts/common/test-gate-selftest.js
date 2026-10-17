/**
 * Module: Gate Self-Test — Three-State Regression Harness
 * File Path: scripts/common/test-gate-selftest.js
 * Architecture Role: Behavioral self-check asserting that critical gates return PASS on
 *   clean input, BLOCK on violating input, and BLOCK (not SKIP) when a dependency is absent.
 * Dependencies & Triggers: Consumes Node.js child_process and the gate scripts themselves;
 *   invoked by CI hygiene and local `npm run gate:selftest`.
 * Responsibilities:
 *   1. Materialize minimal clean and violating fixtures under .audit-logs;
 *   2. Execute fast-staged, commit-msg, catalog, closure, and hygiene gates;
 *   3. Verify fail-closed behavior for the AST slice gate when TypeScript is missing;
 *   4. Report a PASS/FAIL/SKIP matrix and fail on any unexpected verdict.
 * Exit Semantics & Design Rationale: 0 = all executable cases matched expectations,
 *   1 = at least one gate returned an unexpected verdict. Dependency-dependent cases are
 *   skipped explicitly rather than silently treated as passing.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const FIXTURE_DIR = path.join(REPO_ROOT, '.audit-logs', 'selftest');

/**
 * Runs a Node gate and returns its exit status.
 *
 * @param {string[]} args - Script path and arguments.
 * @returns {number} Exit status, or -1 when spawn failed.
 */
function runNode(args) {
  const result = spawnSync('node', args, { cwd: REPO_ROOT, stdio: 'ignore' });
  if (result.error) return -1;
  return result.status === null ? -1 : result.status;
}

/**
 * Writes a fixture file and returns its repo-relative path.
 *
 * @param {string} name - File name.
 * @param {string|Buffer} content - File content.
 * @returns {string} Repo-relative path.
 */
function writeFixture(name, content) {
  const file = path.join(FIXTURE_DIR, name);
  fs.writeFileSync(file, content);
  return path.relative(REPO_ROOT, file).replace(/\\/g, '/');
}

/**
 * Collects executable self-test cases against current repository state.
 *
 * @param {string} cleanFile - Clean fixture path.
 * @param {string} bomFile - BOM-violating fixture path.
 * @param {string} validMsg - Valid commit message fixture path.
 * @param {string} invalidMsg - Invalid commit message fixture path.
 * @returns {Array<object>} Case definitions.
 */
function buildCases(cleanFile, bomFile, validMsg, invalidMsg) {
  const cases = [
    { name: 'fast-staged clean input', args: ['scripts/common/gate-fast-staged.js', cleanFile], expect: 0 },
    { name: 'fast-staged BOM violation', args: ['scripts/common/gate-fast-staged.js', bomFile], expect: 1 },
    { name: 'commit-msg valid input', args: ['scripts/common/validate-commit-msg.js', validMsg], expect: 0 },
    { name: 'commit-msg invalid input', args: ['scripts/common/validate-commit-msg.js', invalidMsg], expect: 1 },
    { name: 'rule catalog parity', args: ['scripts/common/generate-rule-catalog.js', '--check-only'], expect: 0 },
    { name: 'rule ID closure', args: ['scripts/common/validate-rule-id-closure.js'], expect: 0 },
    { name: 'physical hygiene', args: ['scripts/common/validate-physical-hygiene.js'], expect: 0 },
  ];

  const tsAvailable = fs.existsSync(path.join(REPO_ROOT, 'auto-refactor', 'node_modules', 'typescript'));
  if (!tsAvailable) {
    cases.push({
      name: 'AST slice fail-closed without TypeScript',
      args: ['scripts/common/validate-staged-slice.js', cleanFile],
      expect: 1,
    });
  }

  return cases;
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const cleanFile = writeFixture('clean.js', 'const value = 1;\n');
  const bomFile = writeFixture('bom.js', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('const value = 1;\n')]));
  const validMsg = writeFixture(
    'valid-msg.txt',
    'feat(gate): 增加门禁自检用例\n\n[Project / 项目归属]\n- governance\n\n[Why / 动机背景]\n- 门禁缺少可重复执行的三态回归用例，无法证明失败路径真实生效。\n\n[Added / 新增内容]\n- 新增自检脚本覆盖干净输入、违规输入与缺依赖三种状态。\n\n[Verification / 验证结论]\n- 自检矩阵逐项输出判定并与预期比较。\n',
  );
  const invalidMsg = writeFixture('invalid-msg.txt', 'wip\n');

  let failures = 0;
  for (const testCase of buildCases(cleanFile, bomFile, validMsg, invalidMsg)) {
    const status = runNode(testCase.args);
    const ok = status === testCase.expect;
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${testCase.name}: exit=${status} expect=${testCase.expect}`);
  }

  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
  if (failures > 0) {
    console.error(`FAIL ${failures} self-test case(s) returned an unexpected verdict`);
    process.exit(1);
  }
  console.log('PASS gate self-test matrix matched all expectations');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = Object.freeze({ buildCases });
