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
const { resolveImpactTargets, buildImpactTestCommand, IMPACT_RULES } =
  require('./impact-slice-map.js');

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

if (failures > 0) {
  console.error(`\n✖ 影响面切片规则存在 ${failures} 处缺陷`);
  process.exit(1);
}
console.log('\n✔ 影响面切片规则自洽：只收窄不放宽，未知路径保守回退');
process.exit(0);
