/**
 * @module impact-slice-map
 * @file scripts/common/impact-slice-map.js
 * @architecture Tier 1.5 预测试机影响面切片规则单源
 * @dependencies 无（纯数据与纯函数，便于自校验与复用）
 * @responsibilities
 *   1. 声明改动路径到测试目标的影响面映射表
 *   2. 解析改动集命中的目标，未知 crate 路径保守回退到全部目标
 *   3. 生成逐目标定址的 cargo 测试命令，成员 crate 目标附带所属包名
 * @exit
 *   本模块不直接退出；违规由调用方与自校验器判定
 */

'use strict';

/**
 * Owning package for each cargo test target.
 *
 * A target defined inside a member crate is not addressable from the workspace root without `-p`;
 * cargo reports it as unknown rather than searching members, so the mapping has to be explicit.
 */
const TARGET_PACKAGE = Object.freeze({
  corrected_date_index_unit: 'fg-algorithms',
  integration_algorithms: null,
  integration_storage: null,
  integration_cli: null,
  integration_governance: null
});

/**
 * Maps a changed source path to the narrowest test targets that can observe it.
 *
 * Each entry names the cargo test targets whose assertions actually reach the touched code. A path
 * that no entry recognises falls back to the full target set, because guessing "nothing is
 * affected" would let a regression through.
 *
 * Keys are path prefixes, matched longest-first so a deeper directory can be more specific than
 * its parent crate.
 */
const IMPACT_RULES = Object.freeze([
  Object.freeze({
    prefix: 'crates/fg-algorithms/',
    targets: ['corrected_date_index_unit', 'integration_algorithms'],
    reason: '算法算子被算法套件与算子单测覆盖'
  }),
  Object.freeze({
    prefix: 'crates/fg-storage/',
    targets: ['integration_storage', 'integration_cli'],
    reason: '存储层被存储套件与命令行端到端覆盖'
  }),
  Object.freeze({
    prefix: 'crates/fg-gate/',
    targets: ['integration_governance'],
    reason: '门禁规则被治理套件覆盖'
  }),
  Object.freeze({
    prefix: 'crates/fg-topology/',
    targets: ['integration_governance', 'integration_cli'],
    reason: '引用与拓扑被治理与命令行套件覆盖'
  }),
  Object.freeze({
    prefix: 'crates/fg-core/',
    targets: ['integration_governance', 'integration_algorithms', 'integration_storage'],
    reason: '核心数据模型被治理、算法与存储三方共同覆盖'
  }),
  Object.freeze({
    prefix: 'src/bin/taxis_cmd/',
    targets: ['integration_cli', 'integration_governance'],
    reason: '子命令分发被命令行与治理套件覆盖'
  }),
  Object.freeze({
    prefix: 'tests/',
    targets: [
      'integration_algorithms',
      'integration_cli',
      'integration_governance',
      'integration_storage'
    ],
    reason: '测试脚手架变更可能影响任一测试目标，保守取全部'
  })
]);

/**
 * Resolves the cargo test targets affected by a set of changed paths inside `fractal-git/`.
 *
 * @param {string[]} changedPaths - Repository-relative changed paths.
 * @returns {{targets: string[], unknown: string[]}} Affected targets and paths with no rule.
 */
function resolveImpactTargets(changedPaths) {
  const targets = new Set();
  const unknown = [];
  const sortedRules = [...IMPACT_RULES].sort((a, b) => b.prefix.length - a.prefix.length);

  for (const rawPath of changedPaths) {
    const normalized = rawPath.replace(/\\/g, '/');
    const marker = 'fractal-git/';
    const at = normalized.indexOf(marker);
    if (at < 0) continue;
    const inner = normalized.slice(at + marker.length);

    const rule = sortedRules.find(entry => inner.startsWith(entry.prefix));
    if (rule) {
      for (const target of rule.targets) targets.add(target);
    } else if (inner.startsWith('crates/')) {
      // A crate with no explicit rule may still be a dependency of every suite.
      unknown.push(inner);
    }
  }

  // Unrecognised crate paths widen to everything: a new crate can be linked from anywhere.
  if (unknown.length > 0) {
    for (const rule of IMPACT_RULES) {
      for (const target of rule.targets) targets.add(target);
    }
  }

  return { targets: [...targets].sort(), unknown };
}

/**
 * Builds the impact-scoped test command for the given targets.
 *
 * Commands are grouped by owning package because a member-crate target is invisible to a bare
 * root `cargo test --test <name>` invocation.
 *
 * @param {string[]} targets - Cargo test target names.
 * @returns {string} Shell command.
 */
function buildImpactTestCommand(targets) {
  if (targets.length === 0) {
    return 'echo "impact slice: no fractal-git test target affected"';
  }

  const groups = new Map();
  for (const target of targets) {
    const key = TARGET_PACKAGE[target] || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(target);
  }

  const invocations = [];
  for (const [pkg, names] of groups) {
    const pkgFlag = pkg ? ` -p ${pkg}` : '';
    const testFlags = names.map(name => `--test ${name}`).join(' ');
    invocations.push(`cargo test${pkgFlag} ${testFlags}`);
  }
  return `(cd fractal-git && ${invocations.join(' && ')})`;
}

module.exports = {
  TARGET_PACKAGE,
  IMPACT_RULES,
  resolveImpactTargets,
  buildImpactTestCommand
};
