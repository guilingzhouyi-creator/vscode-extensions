/**
 * @module impact-slice-map
 * @file scripts/common/impact-slice-map.js
 * @architecture Tier 1.5 预测试机与本地推送影响面切片规则单源
 * @dependencies path, child_process
 * @responsibilities
 *   1. 声明改动路径到测试目标的影响面映射表
 *   2. 解析改动集命中的目标，未知 crate 路径保守回退到全部目标
 *   3. 生成逐目标定址的 cargo/vitest 测试命令，并提供工作区四子项目统一影响面路由与 CLI
 * @exit
 *   被 require 时不直接退出；CLI 模式下 0 = 成功，1 = git 失败或参数错误
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const PROJECT_PREFIXES = Object.freeze([
  'auto-refactor/',
  'workspace-timing/',
  'WebGames/',
  'fractal-git/'
]);

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

/**
 * Classifies repository-relative changed paths into per-subproject execution flags.
 *
 * @param {string[]} changedPaths - Repository-relative changed file paths.
 * @param {{ hasRange?: boolean, range?: string }} [options] - Classification options.
 * @returns {object} Impact flags and normalized file list.
 */
function classifyWorkspaceImpact(changedPaths, options = {}) {
  const hasRange = options.hasRange !== false;
  const normalized = (Array.isArray(changedPaths) ? changedPaths : [])
    .map(p => String(p || '').replace(/\\/g, '/').trim())
    .filter(Boolean);

  const touchedAr = normalized.some(p => p.startsWith('auto-refactor/'));
  const touchedWt = normalized.some(p => p.startsWith('workspace-timing/'));
  const touchedWg = normalized.some(p => p.startsWith('WebGames/'));
  const touchedFg = normalized.some(p => p.startsWith('fractal-git/'));
  const touchedShared = normalized.some(
    p => !PROJECT_PREFIXES.some(prefix => p.startsWith(prefix))
  );

  const projectCount = [touchedAr, touchedWt, touchedWg, touchedFg].filter(Boolean).length;
  const changedCount = normalized.length;
  const runAll = !hasRange || touchedShared || projectCount > 1 || changedCount === 0;

  return {
    hasRange,
    range: options.range || '',
    changedCount,
    touchedAr,
    touchedWt,
    touchedWg,
    touchedFg,
    touchedShared,
    projectCount,
    runAll,
    runAr: runAll || touchedAr,
    runWt: runAll || touchedWt,
    runWg: runAll || touchedWg,
    runFg: runAll || touchedFg,
    changedFiles: normalized
  };
}

/**
 * Runs a git diff command in REPO_ROOT and returns changed paths or throws on failure.
 *
 * @param {string[]} gitArgs - Arguments passed to `git`.
 * @returns {string[]} Changed repository-relative paths.
 */
function runGitDiffNames(gitArgs) {
  const res = spawnSync('git', gitArgs, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (res.error) {
    throw new Error(`git ${gitArgs.join(' ')} failed: ${res.error.message}`);
  }
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').trim();
    throw new Error(`git ${gitArgs.join(' ')} exited ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return String(res.stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

/**
 * Formats an impact classification object as shell-safe KEY=VALUE lines.
 *
 * @param {object} impact - Result from `classifyWorkspaceImpact`.
 * @returns {string} Newline-terminated KEY=VALUE lines.
 */
function formatImpactKv(impact) {
  const b = value => (value ? 1 : 0);
  const lines = [
    `HAS_RANGE=${b(impact.hasRange)}`,
    `CHANGED_COUNT=${impact.changedCount}`,
    `TOUCHED_AR=${b(impact.touchedAr)}`,
    `TOUCHED_WT=${b(impact.touchedWt)}`,
    `TOUCHED_WG=${b(impact.touchedWg)}`,
    `TOUCHED_FG=${b(impact.touchedFg)}`,
    `TOUCHED_SHARED=${b(impact.touchedShared)}`,
    `PROJECT_COUNT=${impact.projectCount}`,
    `RUN_ALL=${b(impact.runAll)}`,
    `RUN_AR=${b(impact.runAr)}`,
    `RUN_WT=${b(impact.runWt)}`,
    `RUN_WG=${b(impact.runWg)}`,
    `RUN_FG=${b(impact.runFg)}`
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Parses CLI arguments for the impact-slice-map router.
 *
 * @param {string[]} argv - CLI argument vector excluding node and script path.
 * @returns {object} Parsed CLI options.
 */
function parseImpactCliArgs(argv) {
  const opts = { mode: '', range: '', files: [], format: 'json', help: false, error: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { opts.help = true; continue; }
    if (arg === '--json') { opts.format = 'json'; continue; }
    if (arg === '--kv') { opts.format = 'kv'; continue; }
    if (arg === '--resolve-staged') { opts.mode = 'staged'; continue; }
    if (arg === '--resolve-range') {
      opts.mode = 'range';
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        opts.range = next;
        i += 1;
      }
      continue;
    }
    if (arg === '--files') {
      opts.mode = 'files';
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        i += 1;
        opts.files.push(argv[i]);
      }
      continue;
    }
    return { ...opts, error: `Unknown argument: ${arg}` };
  }
  if (!opts.help && !opts.mode) {
    return { ...opts, error: 'Missing mode (--resolve-range, --resolve-staged, or --files)' };
  }
  return opts;
}

/**
 * Executes the impact router CLI.
 *
 * @returns {void}
 */
function main() {
  const opts = parseImpactCliArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(
      'Usage: node scripts/common/impact-slice-map.js [--resolve-range [range] | --resolve-staged | --files <p1>...] [--json|--kv]\n'
    );
    process.exit(0);
  }
  if (opts.error) {
    process.stderr.write(`✖ impact-slice-map: ${opts.error}\n`);
    process.exit(1);
  }

  let changedPaths = [];
  let hasRange = true;
  if (opts.mode === 'range') {
    if (!opts.range) {
      hasRange = false;
    } else {
      changedPaths = runGitDiffNames(['diff', '--name-only', opts.range]);
    }
  } else if (opts.mode === 'staged') {
    changedPaths = runGitDiffNames(['diff', '--cached', '--name-only', '--diff-filter=ACM']);
  } else {
    changedPaths = opts.files;
  }

  const impact = classifyWorkspaceImpact(changedPaths, { hasRange, range: opts.range });
  const output = opts.format === 'kv' ? formatImpactKv(impact) : `${JSON.stringify(impact, null, 2)}\n`;
  process.stdout.write(output);
  process.exit(0);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`✖ impact-slice-map: ${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

module.exports = {
  TARGET_PACKAGE,
  IMPACT_RULES,
  AUTO_IMPACT_RULES,
  resolveImpactTargets,
  resolveAutoImpactTargets,
  buildImpactTestCommand,
  buildAutoImpactTestCommand,
  classifyWorkspaceImpact
};
