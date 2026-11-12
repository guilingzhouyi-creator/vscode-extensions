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
    prefix: 'crates/fg-pools/',
    targets: ['integration_storage', 'integration_cli'],
    reason: '对象池与沙箱隔离被存储与命令行套件覆盖'
  }),
  Object.freeze({
    prefix: 'crates/fg-transport/',
    targets: ['integration_cli', 'integration_governance'],
    reason: '网络传输与协议封包被命令行与治理套件覆盖'
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

/**
 * Maps auto-refactor changed source path to narrowest unit tests and slice analyzers.
 */
const AUTO_IMPACT_RULES = Object.freeze([
  Object.freeze({
    prefix: 'src/core/ast/',
    testSuites: ['ast-slice-cfg-scoring.test.ts', 'fast-path-analyzers.test.ts'],
    reason: 'AST 语法单元与切片提取被切片与快速路径套件覆盖'
  }),
  Object.freeze({
    prefix: 'src/core/router/',
    testSuites: ['ast-slice-cfg-scoring.test.ts', 'fast-path-analyzers.test.ts', 'grouped-dispatcher-bitmask.test.ts'],
    reason: 'MoE 稀疏路由与切片提取被位掩码分发与切片套件覆盖'
  }),
  Object.freeze({
    prefix: 'src/core/scoring/',
    testSuites: ['ast-slice-cfg-scoring.test.ts', 'elastic-compatibility-arbiter.test.ts'],
    reason: '评分器与自治度模型被打分与仲裁套件覆盖'
  }),
  Object.freeze({
    prefix: 'src/core/cfg/',
    testSuites: ['ast-slice-cfg-scoring.test.ts', 'cfg-inline-guard.test.ts'],
    reason: '控制流图与支配边构建被 CFG 守卫套件覆盖'
  }),
  Object.freeze({
    prefix: 'src/core/cache/',
    testSuites: ['cache-arc2-l1-recovery.test.ts', 'cache-flush-concurrency.test.ts', 'cache-store-wal.test.ts'],
    reason: '多级缓存与 WAL 预写日志被缓存系列套件覆盖'
  }),
  Object.freeze({
    prefix: 'src/core/intelligence/',
    testSuites: ['codemod-anchor-and-rules.test.ts', 'fast-path-analyzers.test.ts'],
    reason: '符号索引与调用图被符号分析与代码修改套件覆盖'
  }),
  Object.freeze({
    prefix: 'src/core/diff/',
    testSuites: ['density-vector-space.test.ts', 'bounded-corridor.test.ts'],
    reason: '差分引擎与语义分类被向量空间与有界廊道套件覆盖'
  }),
  Object.freeze({
    prefix: 'src/core/praxis/',
    testSuites: ['praxis-vfs-taxis-bridge.test.ts'],
    reason: 'Praxis 门禁与 VFS 沙箱被桥接单测套件覆盖'
  }),
  Object.freeze({
    prefix: 'src/analyzers/',
    testSuites: ['density-analyzers-integration.test.ts', 'fast-path-analyzers.test.ts', 'layer1-rules.test.ts'],
    reason: '静态分析器被集成分析与快速路径套件覆盖'
  })
]);

/**
 * Resolves affected auto-refactor unit test suites based on changed paths.
 *
 * @param {string[]} changedPaths - Repository-relative changed paths.
 * @returns {{testSuites: string[], unknown: string[]}}
 */
function resolveAutoImpactTargets(changedPaths) {
  const testSuites = new Set();
  const unknown = [];
  const sortedRules = [...AUTO_IMPACT_RULES].sort((a, b) => b.prefix.length - a.prefix.length);

  for (const rawPath of changedPaths) {
    const normalized = rawPath.replace(/\\/g, '/');
    const marker = 'auto-refactor/';
    const at = normalized.indexOf(marker);
    if (at < 0) continue;
    const inner = normalized.slice(at + marker.length);

    if (inner.startsWith('tests/unit/') && inner.endsWith('.test.ts')) {
      testSuites.add(path.basename(inner));
      continue;
    }

    const rule = sortedRules.find(entry => inner.startsWith(entry.prefix));
    if (rule) {
      for (const suite of rule.testSuites) testSuites.add(suite);
    } else if (inner.startsWith('src/')) {
      unknown.push(inner);
    }
  }

  if (unknown.length > 0) {
    testSuites.add('ast-slice-cfg-scoring.test.ts');
    testSuites.add('fast-path-analyzers.test.ts');
    testSuites.add('density-analyzers-integration.test.ts');
  }

  return { testSuites: [...testSuites].sort(), unknown };
}

/**
 * Builds the test command for impacted auto-refactor targets.
 *
 * @param {string[]} testSuites - Impacted unit test file names.
 * @param {string[]} [changedPaths] - Changed files for slice gate detection.
 * @returns {string} Shell command string.
 */
function buildAutoImpactTestCommand(testSuites, changedPaths = []) {
  const parts = [];
  if (testSuites.length > 0) {
    const testArgs = testSuites.map(s => `tests/unit/${s}`).join(' ');
    parts.push(`npx vitest run ${testArgs}`);
  }
  const hasCodeChanges = changedPaths.some(p => /\.(ts|js|rs|py|gd)$/.test(p));
  if (hasCodeChanges) {
    parts.push('node scripts/gate-self-slice.js');
  }
  if (parts.length === 0) {
    return 'echo "impact slice: no auto-refactor test target affected"';
  }
  return `(cd auto-refactor && ${parts.join(' && ')})`;
}

module.exports = {
  TARGET_PACKAGE,
  IMPACT_RULES,
  AUTO_IMPACT_RULES,
  resolveImpactTargets,
  resolveAutoImpactTargets,
  buildImpactTestCommand,
  buildAutoImpactTestCommand
};
