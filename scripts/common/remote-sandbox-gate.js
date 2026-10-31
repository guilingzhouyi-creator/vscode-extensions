/**
 * @module remote-sandbox-gate
 * @file scripts/common/remote-sandbox-gate.js
 * @architecture Tier 1.5 预测试机（Instabox Linux MicroVM）切片与全量审查执行器
 * @dependencies child_process, fs, path
 * @responsibilities
 *   1. 统一管理预测试机（Tier 1.5）与 GitHub CI（Tier 2）的门禁分层调度
 *   2. 支持定向切片（hygiene, rust, timing, auto-refactor, webgames, staged）与全量（all）审查
 *   3. 支持本地直连（--local）与 SSH 远程下发（--remote），流式回传判定与退出状态
 *   4. 支持与 staggered-push 细水长流推进器无缝联动，提供远端 Linux 原生预审保障
 * @exit
 *   0 - 所有指定切片/全量审查 100% 绿色通行
 *   1 - 存在切片违规或命令执行失败
 *   2 - 参数配置或连接协议错误
 */

'use strict';

const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');

const DEFAULT_SSH_HOST = 'ssh.instabox.sh';
const DEFAULT_SSH_PORT = '2222';
const DEFAULT_SSH_USER = 'ibssh_jgzat7ocfg4cmtio5kha7mkj2m';
const DEFAULT_REMOTE_WORKSPACE = '/data/workspace/vscode-extensions';

/**
 * SSOT map of pretest slices and their corresponding shell commands.
 */
const SLICE_DEFINITIONS = Object.freeze({
  hygiene: Object.freeze({
    title: '仓库物理卫生与文档规则单源一致性',
    commands: [
      'node scripts/common/validate-physical-hygiene.js',
      'node scripts/common/validate-docs-consistency.js',
      'node scripts/common/validate-rule-id-closure.js',
      'node scripts/common/validate-gate-feedback.js',
      'node scripts/common/validate-shell-parity.js'
    ]
  }),
  rust: Object.freeze({
    title: 'fractal-git Rust 拓扑与内核子系统门禁',
    commands: [
      'node fractal-git/scripts/common/validate-crate-topology.js',
      'node fractal-git/scripts/common/check-zero-alloc-boundary.js',
      '(cd fractal-git && cargo fmt --all -- --check)',
      '(cd fractal-git && cargo check --all-targets)',
      '(cd fractal-git && cargo clippy --workspace --all-targets -- -D warnings)'
    ]
  }),
  timing: Object.freeze({
    title: 'workspace-timing 编译与轻量单元测试',
    commands: [
      '(cd workspace-timing && npm run compile)',
      '(cd workspace-timing && npm run test:fast)'
    ]
  }),
  'auto-refactor': Object.freeze({
    title: 'auto-refactor 静态引擎与 AST 单元测试',
    commands: [
      '(cd auto-refactor && npm run build)',
      '(cd auto-refactor && npx vitest run tests/unit)'
    ]
  }),
  webgames: Object.freeze({
    title: 'WebGames 游戏配置与文档架构审查',
    commands: [
      'python3 WebGames/scripts/py/audit_config.py --strict',
      'node WebGames/scripts/js/validate-mermaid.mjs'
    ]
  }),
  all: Object.freeze({
    title: 'Tier 1.5 Linux 全工作区统一质量审查 (audit-all)',
    commands: [
      'bash scripts/sh/audit-all.sh --fast'
    ]
  })
});

/**
 * Parses command line options into a normalized configuration object.
 *
 * @param {string[]} args - Process argv array.
 * @returns {object} Normalized options.
 */
function parseArgs(args) {
  const options = {
    slice: 'staged',
    mode: 'remote',
    sync: false,
    deep: false,
    quiet: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--slice' || arg === '-s') {
      options.slice = args[++i];
    } else if (arg === '--local' || arg === '-l') {
      options.mode = 'local';
    } else if (arg === '--remote' || arg === '-r') {
      options.mode = 'remote';
    } else if (arg === '--sync') {
      options.sync = true;
    } else if (arg === '--deep' || arg === '-d') {
      options.deep = true;
    } else if (arg === '--quiet' || arg === '-q') {
      options.quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

/**
 * Resolves changed files in the working directory or between HEAD and target base.
 *
 * @returns {string[]} List of changed relative file paths.
 */
function detectChangedFiles() {
  try {
    const statusOut = execFileSync('git', ['status', '--porcelain'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const unstaged = statusOut
      .split('\n')
      .map(line => line.slice(3).trim())
      .filter(f => f.length > 0);

    const diffHead = execFileSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).split('\n').map(f => f.trim()).filter(f => f.length > 0);

    const merged = Array.from(new Set([...unstaged, ...diffHead]));
    return merged;
  } catch (err) {
    return [];
  }
}

/**
 * Maps a list of changed file paths to corresponding slice identifiers.
 *
 * @param {string[]} changedFiles - Array of relative file paths.
 * @returns {string[]} Selected slice identifiers.
 */
function resolveDynamicSlices(changedFiles) {
  const slices = new Set();

  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, '/');
    if (normalized.startsWith('fractal-git/')) {
      slices.add('rust');
    } else if (normalized.startsWith('auto-refactor/')) {
      slices.add('auto-refactor');
    } else if (normalized.startsWith('workspace-timing/')) {
      slices.add('timing');
    } else if (normalized.startsWith('WebGames/')) {
      slices.add('webgames');
    } else {
      slices.add('hygiene');
    }
  }

  if (slices.size === 0) {
    slices.add('hygiene');
  }

  return Array.from(slices);
}

/**
 * Builds the SSH remote command payload for the selected slices.
 *
 * @param {string[]} sliceKeys - Array of slice keys.
 * @param {boolean} isDeep - Whether to run deep all audit.
 * @returns {string} Shell command string to be executed in remote workspace.
 */
function buildRemoteScript(sliceKeys, isDeep) {
  const cmdList = [];
  const remoteRoot = process.env.INSTABOX_WORKSPACE || DEFAULT_REMOTE_WORKSPACE;

  cmdList.push(`cd "${remoteRoot}"`);

  for (const key of sliceKeys) {
    const def = SLICE_DEFINITIONS[key];
    if (!def) continue;

    cmdList.push(`echo "=== [Tier 1.5 Slice] ${def.title} (${key}) ==="`);
    for (let cmd of def.commands) {
      if (key === 'all' && isDeep) {
        cmd = 'bash scripts/sh/audit-all.sh';
      }
      cmdList.push(cmd);
    }
  }

  return cmdList.join(' && ');
}

/**
 * Executes a remote command via SSH on the Instabox sandbox.
 *
 * @param {string} remoteScript - Full bash command to run.
 * @returns {number} Process exit code.
 */
function executeRemoteSsh(remoteScript) {
  const host = process.env.INSTABOX_SSH_HOST || DEFAULT_SSH_HOST;
  const port = process.env.INSTABOX_SSH_PORT || DEFAULT_SSH_PORT;
  const user = process.env.INSTABOX_SSH_USER || DEFAULT_SSH_USER;

  const sshArgs = [
    '-p', port,
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    `${user}@${host}`,
    `bash -c ${JSON.stringify(remoteScript)}`
  ];

  console.log(`📡 [Tier 1.5] 正在向预测试机 (${host}:${port}) 下发切片门禁指令...`);
  const result = spawnSync('ssh', sshArgs, {
    stdio: 'inherit',
    encoding: 'utf8'
  });

  return result.status !== null ? result.status : 1;
}

/**
 * Executes the slice commands locally.
 *
 * @param {string[]} sliceKeys - Array of slice keys.
 * @param {boolean} isDeep - Deep all mode.
 * @returns {number} Process exit code.
 */
function executeLocalCommands(sliceKeys, isDeep) {
  console.log(`💻 [Tier 1.5] 正在本地执行切片门禁...`);
  for (const key of sliceKeys) {
    const def = SLICE_DEFINITIONS[key];
    if (!def) continue;

    console.log(`\n▶ [Slice: ${key}] ${def.title}`);
    for (let cmd of def.commands) {
      if (key === 'all' && isDeep) {
        cmd = 'bash scripts/sh/audit-all.sh';
      }
      console.log(`  $ ${cmd}`);
      const shellCmd = process.platform === 'win32' ? 'pwsh' : 'bash';
      const shellArg = process.platform === 'win32' ? '-Command' : '-c';
      const res = spawnSync(shellCmd, [shellArg, cmd], {
        cwd: REPO_ROOT,
        stdio: 'inherit'
      });
      if (res.status !== 0) {
        console.error(`✖ BLOCK [${key}] 命令执行失败: ${cmd}`);
        return res.status || 1;
      }
    }
  }
  return 0;
}

/**
 * Prints help message.
 */
function printHelp() {
  console.log(`
用法: node scripts/common/remote-sandbox-gate.js [选项]

架构定位:
  预测试机 (Tier 1.5 Instabox MicroVM) 专属切片与全量审查中枢，
  在提交推送到 GitHub Actions (Tier 2 二测试机) 前进行确定性 Linux 原生预审。

选项:
  --slice, -s <name>    切片名称 (hygiene|rust|timing|auto-refactor|webgames|staged|all)
                        默认: staged (根据当前改动智能推断)
  --remote, -r          在预测试机 (Linux Sandbox) 上执行 [默认]
  --local, -l           在当前本地环境中执行
  --deep, -d            深度全量审查模式 (audit-all 包含全部深层用例)
  --quiet, -q           静默模式
  --help, -h            显示本帮助信息

切片定义:
  hygiene        物理卫生八维、文档规模、规则单源与 Shell 命令面对齐
  rust           fractal-git Rust 拓扑、零堆分配边界、fmt、check 与 clippy
  timing         workspace-timing 编译与轻量单元测试
  auto-refactor  auto-refactor 静态引擎与 AST 单元测试
  webgames       WebGames 游戏配置与文档架构审查
  staged         动态切片：自动扫描改动集并定向触发受影响领域的切片
  all            全工作区统一质量审查 (audit-all.sh)
`);
}

/**
 * Main entry point.
 */
function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  let targetSlices = [];
  if (options.slice === 'staged' || options.slice === 'diff') {
    const changed = detectChangedFiles();
    targetSlices = resolveDynamicSlices(changed);
    console.log(`🔍 [Tier 1.5] 变更集检测: 触及 ${changed.length} 个文件 -> 命中切片 [${targetSlices.join(', ')}]`);
  } else if (SLICE_DEFINITIONS[options.slice]) {
    targetSlices = [options.slice];
  } else {
    console.error(`✖ 错误: 未知切片名称 "${options.slice}"。可选值: ${Object.keys(SLICE_DEFINITIONS).join(', ')}, staged`);
    process.exit(2);
  }

  let exitCode = 0;
  if (options.mode === 'remote') {
    const remoteScript = buildRemoteScript(targetSlices, options.deep);
    exitCode = executeRemoteSsh(remoteScript);
  } else {
    exitCode = executeLocalCommands(targetSlices, options.deep);
  }

  if (exitCode === 0) {
    console.log(`\n✔ PASS [Tier 1.5 预测试机] 所选切片 [${targetSlices.join(', ')}] 100% 验证通过！`);
  } else {
    console.error(`\n✖ BLOCK [Tier 1.5 预测试机] 切片审查未通过 (ExitCode: ${exitCode})`);
  }

  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  SLICE_DEFINITIONS,
  parseArgs,
  resolveDynamicSlices,
  buildRemoteScript
};
