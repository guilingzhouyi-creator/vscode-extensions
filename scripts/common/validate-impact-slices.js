/**
 * @module validate-impact-slices
 * @file scripts/common/validate-impact-slices.js
 * @architecture Tier 1.5 影响面切片规则自校验器
 * @dependencies child_process, path
 * @responsibilities
 *   1. Assert that the impact map narrows, never widens, for every recognised crate path
 *   2. Assert that an unrecognised crate path falls back to the full target set rather than none
 *   3. Assert that a change outside `fractal-git/` selects no cargo target at all
 * @exit
 *   0 - 影响面切片规则自洽
 *   1 - 存在漏检或越权扩张
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const {
  resolveImpactTargets,
  resolveAutoImpactTargets,
  buildImpactTestCommand,
  classifyWorkspaceImpact,
  IMPACT_RULES
} = require('./impact-slice-map.js');

const REPO_ROOT = path.resolve(__dirname, '../..');
const ROUTER_SCRIPT = path.join(__dirname, 'impact-slice-map.js');

let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✔ ${label}`);
  } else {
    console.error(`  ✖ ${label}${detail ? `: ${detail}` : ''}`);
    failures += 1;
  }
}

const ALL_TARGETS = [...new Set(IMPACT_RULES.flatMap(rule => rule.targets))].sort();

console.log('=== [FGT-IMPACT-001] 影响面切片规则自校验 ===');

// 1. A storage-only change must not drag in the algorithm suite: that is the whole point of the
//    slice, and a rule that expanded to everything would silently recreate the full run.
const storage = resolveImpactTargets(['fractal-git/crates/fg-storage/src/wal_journal.rs']);
check(
  '存储层变更只触及存储与命令行目标',
  storage.targets.length > 0 && !storage.targets.includes('integration_algorithms'),
  `got [${storage.targets.join(', ')}]`
);

// 2. An algorithm-only change must reach the operator unit test, because that is where the
//    corrected-date invariant is pinned.
const algo = resolveImpactTargets([
  'fractal-git/crates/fg-algorithms/src/traverse/corrected_date_index.rs'
]);
check(
  '算法层变更触及算子单测与算法套件',
  algo.targets.includes('corrected_date_index_unit') &&
    algo.targets.includes('integration_algorithms'),
  `got [${algo.targets.join(', ')}]`
);

// 3. A gate change must reach the governance suite, where the commit contract lives.
const gate = resolveImpactTargets(['fractal-git/crates/fg-gate/src/pre_receive.rs']);
check(
  '门禁变更触及治理套件',
  gate.targets.includes('integration_governance'),
  `got [${gate.targets.join(', ')}]`
);

// 4. An unknown crate could be linked from any suite, so the safe answer is every target.
//    Returning a narrow set here would let a regression ship on an optimistic guess.
const unknown = resolveImpactTargets(['fractal-git/crates/fg-brand-new/src/lib.rs']);
check(
  '未登记的 crate 路径放宽到全部目标',
  unknown.unknown.length === 1 && unknown.targets.length === ALL_TARGETS.length,
  `unknown=[${unknown.unknown.join(', ')}] targets=[${unknown.targets.join(', ')}]`
);

// 5. A change outside fractal-git must not run any cargo target at all.
const outside = resolveImpactTargets(['auto-refactor/src/core/engine.ts']);
check(
  'fractal-git 之外的变更不选择任何 cargo 目标',
  outside.targets.length === 0,
  `got [${outside.targets.join(', ')}]`
);

// 6. The generated command must name each target exactly once and never fall back to a bare
//    `cargo test`, which would run the whole workspace.
const command = buildImpactTestCommand(['integration_storage', 'integration_cli']);
check(
  '生成的命令逐一名名目标且不退化全量',
  command.includes('--test integration_storage') &&
    command.includes('--test integration_cli') &&
    !command.trim().endsWith('cargo test'),
  command
);

// 7. An empty target set must produce an explicit no-op rather than a full run.
const emptyCommand = buildImpactTestCommand([]);
check(
  '空目标集生成显式空操作',
  emptyCommand.includes('no fractal-git test target affected'),
  emptyCommand
);

// 7b. A target owned by a member crate must be addressed with `-p`, while workspace-root targets
//     must not be. Cargo refuses an unqualified member target, which was a real failure observed
//     when this slice first ran.
const mixedCommand = buildImpactTestCommand(['corrected_date_index_unit', 'integration_algorithms']);
check(
  '成员 crate 目标附带所属包名',
  mixedCommand.includes('-p fg-algorithms') &&
    mixedCommand.includes('--test corrected_date_index_unit'),
  mixedCommand
);
check(
  '工作区根目标不附带包名',
  !mixedCommand.includes('-p null') && !/ -p \bcorrected_date_index_unit\b/.test(mixedCommand),
  mixedCommand
);

// 8. Windows-style separators must normalise, otherwise a path from `git status` on Windows
//    would match no rule and silently widen.
const windowsPath = resolveImpactTargets(['fractal-git\\crates\\fg-gate\\src\\commit_guard.rs']);
check(
  '反斜杠路径同样命中规则',
  windowsPath.targets.length > 0 && !windowsPath.targets.includes('integration_storage'),
  `got [${windowsPath.targets.join(', ')}]`
);

// 9. Single-project auto-refactor unit test path must resolve without ReferenceError (requires path).
const autoUnit = resolveAutoImpactTargets(['auto-refactor/tests/unit/sample.test.ts']);
check(
  'auto-refactor 单测路径直接命中并无 path 缺失异常',
  autoUnit.testSuites.length === 1 && autoUnit.testSuites[0] === 'sample.test.ts' && autoUnit.unknown.length === 0,
  `got [${autoUnit.testSuites.join(', ')}]`
);

// 10. classifyWorkspaceImpact single-project narrowing.
const singleAr = classifyWorkspaceImpact(['auto-refactor/src/core/ast/parser.ts']);
check(
  '工作区影响面路由对单子项目变更只选中目标子项目',
  singleAr.runAr && !singleAr.runWt && !singleAr.runWg && !singleAr.runFg && !singleAr.runAll && singleAr.projectCount === 1,
  JSON.stringify(singleAr)
);

// 11. classifyWorkspaceImpact multi-project widening.
const multiProj = classifyWorkspaceImpact(['auto-refactor/src/a.ts', 'fractal-git/src/b.rs']);
check(
  '多子项目跨界变更放宽到全量执行',
  multiProj.runAll && multiProj.runAr && multiProj.runWt && multiProj.runWg && multiProj.runFg && multiProj.projectCount === 2,
  JSON.stringify(multiProj)
);

// 12. classifyWorkspaceImpact shared-file widening.
const sharedTouch = classifyWorkspaceImpact(['scripts/common/impact-slice-map.js']);
check(
  '共享治理文件变更放宽到全量执行',
  sharedTouch.touchedShared && sharedTouch.runAll && sharedTouch.runAr && sharedTouch.runWt && sharedTouch.runWg && sharedTouch.runFg,
  JSON.stringify(sharedTouch)
);

// 13. classifyWorkspaceImpact empty-range / no-range widening.
const noRange = classifyWorkspaceImpact([], { hasRange: false });
check(
  '无基线区间时保守放宽到全量执行',
  !noRange.hasRange && noRange.runAll && noRange.runAr && noRange.runWt && noRange.runWg && noRange.runFg,
  JSON.stringify(noRange)
);

// 14. classifyWorkspaceImpact Windows backslash normalization.
const winImpact = classifyWorkspaceImpact(['workspace-timing\\src\\extension.ts', '  ']);
check(
  '工作区影响面路由正确归一化反斜杠并忽略空白项',
  winImpact.changedCount === 1 && winImpact.touchedWt && !winImpact.touchedShared && !winImpact.runAll && winImpact.runWt && !winImpact.runAr,
  JSON.stringify(winImpact)
);

// 15. CLI `--files ... --kv` emits deterministic KEY=VALUE flags.
const kvCli = spawnSync(
  process.execPath,
  [ROUTER_SCRIPT, '--files', 'WebGames/scripts/py/audit_config.py', '--kv'],
  { cwd: REPO_ROOT, encoding: 'utf8' }
);
const kvLines = String(kvCli.stdout || '').trim().split(/\r?\n/);
check(
  'CLI --files --kv 输出精确键值标志',
  kvCli.status === 0 &&
    kvLines.includes('HAS_RANGE=1') &&
    kvLines.includes('CHANGED_COUNT=1') &&
    kvLines.includes('TOUCHED_WG=1') &&
    kvLines.includes('RUN_WG=1') &&
    kvLines.includes('RUN_ALL=0') &&
    kvLines.includes('RUN_AR=0'),
  `status=${kvCli.status} stdout=${kvCli.stdout}`
);

// 16. CLI `--resolve-range invalid-rev-0000..HEAD` must fail closed with exit code 1.
const badRangeCli = spawnSync(
  process.execPath,
  [ROUTER_SCRIPT, '--resolve-range', 'invalid-rev-0000..HEAD'],
  { cwd: REPO_ROOT, encoding: 'utf8' }
);
check(
  'CLI --resolve-range 对无效区间严格 fail-closed 退出码 1',
  badRangeCli.status === 1 && String(badRangeCli.stderr || '').trim().length > 0,
  `status=${badRangeCli.status} stderr=${badRangeCli.stderr}`
);

// 17. CLI `--resolve-range "" --kv` treats empty range as hasRange=0 and widens to RUN_ALL=1 with exit 0.
const emptyRangeCli = spawnSync(
  process.execPath,
  [ROUTER_SCRIPT, '--resolve-range', '--kv'],
  { cwd: REPO_ROOT, encoding: 'utf8' }
);
const emptyKv = String(emptyRangeCli.stdout || '').trim().split(/\r?\n/);
check(
  'CLI --resolve-range 空区间退化为全量并退出码 0',
  emptyRangeCli.status === 0 && emptyKv.includes('HAS_RANGE=0') && emptyKv.includes('RUN_ALL=1'),
  `status=${emptyRangeCli.status} stdout=${emptyRangeCli.stdout}`
);

if (failures > 0) {
  console.error(`\n✖ 影响面切片规则存在 ${failures} 处缺陷`);
  process.exit(1);
}
console.log('\n✔ 影响面切片规则自洽：只收窄不放宽，未知路径保守回退');
process.exit(0);
