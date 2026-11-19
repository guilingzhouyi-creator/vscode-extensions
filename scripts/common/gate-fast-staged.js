/**
 * Module: Governance Guard — Fast Staged Stream Validator
 * File Path: scripts/common/gate-fast-staged.js
 * Architecture Role: Single-pass, in-memory stream auditor for Git staged changes.
 *   Consolidates six staged fragments into a single Node.js runtime process:
 *   - EMPTY-FILE: Zero 0-byte & whitespace-only empty files
 *   - LINE-ENDING: Line ending contract (.ps1 -> CRLF, others -> LF)
 *   - PATH-LEAK: Absolute path & drive letter leak prevention
 *   - NOMENCLATURE: Zero slang & temporary nomenclature
 *   - VOLUME-BUDGET: Dual-scale volume & dynamic envelope budget (ELOC <= 900, LOC <= 1400)
 *   - SECRET-LEAK: Secret keys & sensitive token leak prevention
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path, child_process);
 *   invoked by pre-commit-gate (ps1/sh), pre-push-gate, and CI hygiene workflows.
 * Responsibilities:
 *   1. Rapidly validate staged file physical cleanliness and line ending conventions;
 *   2. Guard against secret token leaks, absolute path disclosures, and non-standard nomenclature;
 *   3. Enforce dual-scale ELOC/LOC volume budgets across staged source files;
 *   4. Emit structured diagnostic console logs and fail-closed exit codes.
 * Exit Semantics & Design Rationale: Exits 0 on clean check, 1 on any violation.
 *   Employs single-pass in-memory stream parsing: the judgement itself measures ~1 ms, while the
 *   end-to-end command costs ~160 ms because a Node process needs ~80 ms to start. Quoting only the
 *   smaller figure would describe a budget the caller never experiences, so both are stated.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  getSafeGitEnv,
  getStagedFiles: queryStagedFiles,
  readStagedBufferSafe,
  readStagedBuffersBatch,
  readStagedEolBufferSafe,
  checkHeadReceipt,
} = require('./git-env');
const checks = require('./lib/fast-staged-checks');
const { calculateEloc, createViolation, validateFilenameSlang, isMorphemeValid, validateFilenameSegments, validateFilenameLength, validateFileEol, validateFileBom, validateFileTerminalNewline, validateFileIndent, validateCommentOnly, collectIndentWidthWarnings, validateFileVolume, VIOLATION_TPLS } = checks;
const {
  evaluateCodeMetrics,
  classifyCStyleLine,
  classifyHashStyleLine,
  classifyPowerShellLine,
  getLanguageVerbosityFactor,
} = require('./evaluate-eloc-budget');

/** Hash-comment languages; mirrors the SSOT classifier's extension set. */
const HASH_STYLE_EXTS = new Set(['.gd', '.py', '.sh', '.bash']);

const RULE_HYG_NAM_001 = 'HYG-NAM-001';
const RULE_HYG_EOL_001 = 'HYG-EOL-001';
const RULE_HYG_EMP_001 = 'HYG-EMP-001';
const RULE_HYG_CLT_001 = 'HYG-CLT-001';
const RULE_EXT_DIR_001 = 'EXT-DIR-001';
const RULE_VOL_ELOC_001 = 'VOL-ELOC-001';
const RULE_VOL_LOC_001 = 'VOL-LOC-001';
const RULE_VOL_RATIO_001 = 'VOL-RATIO-001';
const RULE_ARCH_FAC_001 = 'ARCH-FAC-001';
const RULE_SEC_LEAK_001 = 'SEC-LEAK-001';
const RULE_SEC_VUL_001 = 'SEC-VUL-001';

const SEVERITY_BLOCK = 'BLOCK';
const EOL_CRLF = 'CRLF';
const EOL_LF = 'LF';
const FAST_STAGED_GATE = 'pre-commit:fast-staged';
const STATUS_PASS = 'PASS';
const PROTOCOL_VERSION = '1.0.0';
const ENCODING_UTF8 = 'utf8';
const GIT_DIFF_ARGS = Object.freeze(['diff', '--cached', '-U0', '--no-color']);
const MAX_DIFF_BUFFER_BYTES = 64 * 1024 * 1024;
const STDIO_PIPE = Object.freeze(['ignore', 'pipe', 'ignore']);
const SCRIPT_NAME = 'node scripts/common/gate-fast-staged.js';
const STEP_NAME = 'STAGED-HYGIENE-01';
const FLAG_AGENT = '--agent';
const FLAG_JSON = '--json';
const FLAG_SHORT_A = '-a';
const RE_EXEMPT_SLANG = /WebGames\/docs\/(?:路线图|归档库)\//;

const MAX_ELOC_BUDGET = 900;
const MAX_LOC_BUDGET = 1400;
/**
 * Shared with evaluate-eloc-budget DEFAULT_TARGET_DENSITY_RATIO and
 * validate-code-density DEFAULT_POR_LIMIT. Keeping the numbers identical here
 * prevents a file from passing this fast pre-screen and then failing the
 * downstream volume gates for the same measurement.
 *
 * Operator-facing text below interpolates these constants rather than repeating the
 * figures. A literal in the message would silently disagree with the enforced value the
 * next time either number changes, and the person reading the failure would fix the
 * wrong thing.
 */
const DENSITY_RATIO_LIMIT = 3.0;
const PLUMBING_RATIO_LIMIT = 0.6;
const DENSITY_RATIO_LABEL = DENSITY_RATIO_LIMIT.toFixed(1);
const PLUMBING_RATIO_LABEL = `${(PLUMBING_RATIO_LIMIT * 100).toFixed(0)}%`;

const MIN_FILENAME_STEM_LENGTH = 3;
const MAX_FILENAME_STEM_LENGTH = 55;
const MAX_PATH_LEAK_DISPLAY = 5;
const MAX_SECRET_LEAK_DISPLAY = 3;
const BYTE_CR = 0x0d;
const BYTE_BOM = Object.freeze([0xef, 0xbb, 0xbf]);
const HASH_COMMENT_EXTENSIONS = new Set(['.gd', '.py', '.sh', '.bash']);
const COMMENT_CHECK_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.gd', '.py', '.rs', '.sh', '.ps1']);
const INDENT_WIDTH_BY_EXT = Object.freeze({ '.ts': 4, '.tsx': 4, '.js': 2, '.jsx': 2, '.mjs': 2, '.cjs': 2 });
const MAX_INDENT_WARNINGS_PER_FILE = 3;
const BINARY_EXTENSIONS = new Set([
  '.node', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.pdf',
  '.wasm', '.exe', '.dll', '.so', '.dylib', '.bin', '.zip', '.tar', '.gz', '.7z'
]);
const MAX_FILENAME_SEGMENTS_SRC = 5;
const MAX_FILENAME_SEGMENTS_TEST = 8;

const SECRET_PATTERN =
  /(?:AIza[0-9A-Za-z_-]{35}|sk-[a-zA-Z0-9]{32,}|ghp_[a-zA-Z0-9]{36}|-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----)/;
const SECRET_WHITELIST_PATTERN =
  /(?:\$\{env:|CODEX_API_KEY|OPENAI_API_KEY|test-secret|mock-key|placeholder)/;

const ABS_PATH_PATTERN = /(?:\b[A-Za-z]:[\\/][a-zA-Z0-9_-]+|file:\/\/\/)/;
const ABS_PATH_WHITELIST_PATTERN = /(?:node_modules|\.gemini)/;

const SLANG_FILENAME_PATTERN = /(?:^|[-_.])(?:temp|wip|new|st\d+|p\d+)(?:[-_.]|$)/i;

const ROOT_DISALLOWED_SCRIPT_EXTS = new Set([
  '.js', '.ts', '.py', '.sh', '.ps1', '.bat', '.cmd',
]);
const CLUTTER_FILE_PATTERN =
  /^(?:Thumbs\.db|desktop\.ini|\.DS_Store|.*\.tmp|.*\.bak|.*\.orig|.*\.swp|.*\.actual\.json|.*\.log)$/i;

const RAW_GATE_SPECS = `EMPTY-FILE|暂存区零空文件与零纯注释空壳检查通过||
LINE-ENDING|换行/编码/EOF/缩进契约 (ps1 CRLF, 其余 LF, 无 BOM, 单 EOF, 无 Tab) 检查通过||
PATH-LEAK|绝对路径与协议防泄漏检查通过|5|✖ BLOCK  PATH-LEAK: 检测到新增代码中包含绝对路径或盘符泄漏:
NOMENCLATURE|零黑话与规范命名检查通过||
VOLUME-BUDGET|双轨体积预算与代码密度守卫 (ELOC<=${MAX_ELOC_BUDGET}, LOC<=${MAX_LOC_BUDGET}, 稀释比<=${DENSITY_RATIO_LABEL}, 接线比<=${PLUMBING_RATIO_LABEL}) 检查通过||
SECRET-LEAK|密钥与敏感 Token 防泄漏扫描通过|3|✖ BLOCK  SECRET-LEAK: 检测到暂存代码中疑似包含未脱敏的真实密钥或私钥！`;

const GATE_SPECS = Object.freeze(
  RAW_GATE_SPECS.split('\n').map((row) => {
    const parts = row.split('|');
    return {
      id: parts[0],
      name: parts[1],
      limit: parts[2] ? parseInt(parts[2], 10) : undefined,
      header: parts[3] || undefined,
    };
  })
);


function getStagedFiles(repoRoot, explicitFiles = []) {
  // Strict on the index read only: when the caller supplied explicit files there is nothing to
  // enumerate, and queryStagedFiles returns them before touching Git.
  return queryStagedFiles(repoRoot, explicitFiles, { strict: true });
}

function getStagedDiff(repoRoot, range = '') {
  const args = range ? ['diff', '-U0', '--no-color', range] : GIT_DIFF_ARGS;
  return execFileSync('git', args, {
    cwd: repoRoot,
    env: getSafeGitEnv(repoRoot),
    encoding: ENCODING_UTF8,
    stdio: STDIO_PIPE,
    maxBuffer: MAX_DIFF_BUFFER_BYTES,
  });
}

function hasViolationForFile(violations, file, ruleId) {
  return violations.some((v) => v.file === file && v.ruleId === ruleId);
}

/**
 * Rapidly audits the root directory for uncontrolled transient clutter or loose scripts.
 *
 * @param {string} repoRoot - Absolute repository root.
 * @param {object} collectors - Bucket collectors for gate violations.
 */
function validateRootDirectoryHygiene(repoRoot, collectors) {
  let entries;
  try {
    entries = fs.readdirSync(repoRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const name = ent.name;
    if (CLUTTER_FILE_PATTERN.test(name)) {
      if (!hasViolationForFile(collectors.gate1, name, RULE_HYG_CLT_001)) {
        const tpl = VIOLATION_TPLS.ROOT_CLUTTER;
        collectors.gate1.push(
          createViolation({
            ruleId: RULE_HYG_CLT_001,
            file: name,
            message: `工作区根目录存在未清理的临时日志/脏文件: ${name}`,
            actual: name,
            expected: tpl.expected,
            actionableFix: tpl.actionableFix,
          }),
        );
      }
    } else if (!name.startsWith('.') && ROOT_DISALLOWED_SCRIPT_EXTS.has(path.extname(name).toLowerCase())) {
      if (!hasViolationForFile(collectors.gate4, name, RULE_EXT_DIR_001)) {
        const tpl = VIOLATION_TPLS.ROOT_SCRIPT;
        collectors.gate4.push(
          createViolation({
            ruleId: RULE_EXT_DIR_001,
            file: name,
            message: `工作区根目录检测到散落代码脚本: ${name}，违反扩展名即领域架构契约 (EXT-DIR-001)`,
            actual: name,
            expected: tpl.expected,
            actionableFix: tpl.actionableFix,
          }),
        );
      }
    }
  }
}

/**
 * Inspects a single staged file across cleanliness, line ending, and volume dimensions.
 *
 * @param {string} repoRoot - Absolute repository root.
 * @param {string} file - Relative file path.
 * @param {object} collectors - Bucket collectors for gate violations.
 */
function inspectStagedFile(repoRoot, file, collectors, useIndex, prefetched = null) {
  const normFile = file.replace(/\\/g, '/');
  const baseName = path.basename(normFile);
  const isRootFile = !normFile.includes('/');

  if (CLUTTER_FILE_PATTERN.test(baseName)) {
    if (!hasViolationForFile(collectors.gate1, file, RULE_HYG_CLT_001)) {
      const tpl = VIOLATION_TPLS.ROOT_CLUTTER;
      collectors.gate1.push(
        createViolation({
          ruleId: RULE_HYG_CLT_001,
          file,
          message: `暂存区包含临时脏文件/日志: ${file}`,
          actual: baseName,
          expected: tpl.expected,
          actionableFix: tpl.actionableFix,
        }),
      );
    }
    return;
  }

  if (isRootFile && !baseName.startsWith('.') && ROOT_DISALLOWED_SCRIPT_EXTS.has(path.extname(baseName).toLowerCase())) {
    if (!hasViolationForFile(collectors.gate4, file, RULE_EXT_DIR_001)) {
      const tpl = VIOLATION_TPLS.ROOT_SCRIPT;
      collectors.gate4.push(
        createViolation({
          ruleId: RULE_EXT_DIR_001,
          file,
          message: `根目录严禁平铺散落代码脚本 (${file})，违反扩展名即领域架构契约 (EXT-DIR-001)`,
          actual: file,
          expected: tpl.expected,
          actionableFix: tpl.actionableFix,
        }),
      );
    }
  }

  validateFilenameSlang(file, collectors.gate4);
  validateFilenameLength(file, collectors.gate4);

  let buffer;
  try {
    if (!useIndex) {
      buffer = fs.readFileSync(path.resolve(repoRoot, file));
    } else if (prefetched && prefetched.has(file)) {
      buffer = prefetched.get(file);
    } else {
      buffer = readStagedBufferSafe(repoRoot, file);
    }
  } catch {
    return;
  }
  if (!buffer) return;

  if (buffer.length === 0) {
    const tpl = VIOLATION_TPLS.EMPTY_FILE;
    collectors.gate1.push(
      createViolation({
        ruleId: RULE_HYG_EMP_001,
        file,
        message: `发现 0 字节物理空文件: ${file}`,
        actual: tpl.actual,
        expected: tpl.expected,
        actionableFix: tpl.actionableFix,
      }),
    );
    return;
  }

  const ext = path.extname(file).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return;
  }

  const content = buffer.toString(ENCODING_UTF8);
  if (content.trim().length === 0) {
    const tpl = VIOLATION_TPLS.EMPTY_WS;
    collectors.gate1.push(
      createViolation({
        ruleId: RULE_HYG_EMP_001,
        file,
        message: `发现仅含空白字符的虚空文件: ${file}`,
        actual: tpl.actual,
        expected: tpl.expected,
        actionableFix: tpl.actionableFix,
      }),
    );
    return;
  }

  validateFileBom(buffer, file, collectors.gate2);
  validateFileEol(file, readStagedEolBufferSafe(repoRoot, file, buffer, useIndex), collectors.gate2);
  validateFileTerminalNewline(content, file, collectors.gate2);
  validateFileIndent(file, content, collectors.gate2);
  validateCommentOnly(file, content, collectors.gate1);
  collectIndentWidthWarnings(file, content, collectors.warnings);
  validateFileVolume(file, content, collectors.gate5);
}

/**
 * Single-pass file stream scanner covering Gates 1, 2, 4, and 5.
 *
 * @param {string} repoRoot - Absolute repository root.
 * @param {string[]} stagedFiles - List of staged file paths.
 * @returns {object} Aggregated violation buckets.
 */
function checkFileStream(repoRoot, stagedFiles, useIndex = true) {
  const collectors = {
    gate1: [],
    gate2: [],
    gate4: [],
    gate5: [],
    warnings: [],
  };

  validateRootDirectoryHygiene(repoRoot, collectors);

  // One `git cat-file --batch` covers every staged blob; the per-file fallback
  // inside inspectStagedFile then only runs for paths missing from the index.
  const prefetched = useIndex ? readStagedBuffersBatch(repoRoot, stagedFiles) : new Map();

  for (const file of stagedFiles) {
    inspectStagedFile(repoRoot, file, collectors, useIndex, prefetched);
  }

  return {
    gate1Violations: collectors.gate1,
    lineEndingViolations: collectors.gate2,
    nomenclatureViolations: collectors.gate4,
    volumeViolations: collectors.gate5,
    warnings: collectors.warnings,
  };
}

/**
 * Single-pass diff stream scanner covering Gates 3 (absolute path leaks) and 6 (credentials).
 *
 * @param {string} diffText - Raw git diff --cached output.
 * @returns {{ gate3Violations: Array, gate6Violations: Array }} Detected leak violations.
 */
function checkDiffStream(diffText) {
  const gate3Violations = [];
  const gate6Violations = [];
  if (!diffText) return { gate3Violations, gate6Violations };

  let currentFile = '';
  let currentLine = 0;
  const lines = diffText.split('\n');

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/b\/(.+)$/);
      currentFile = match ? match[1].trim() : '';
      continue;
    }
    if (line.startsWith('@@ ')) {
      const match = line.match(/\+(\d+)/);
      currentLine = match ? parseInt(match[1], 10) - 1 : 0;
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) {
      if (!line.startsWith('-')) currentLine++;
      continue;
    }

    currentLine++;
    const addedContent = line.slice(1);

    if (
      ABS_PATH_PATTERN.test(addedContent) &&
      !ABS_PATH_WHITELIST_PATTERN.test(addedContent)
    ) {
      const tpl = VIOLATION_TPLS.PATH_LEAK;
      gate3Violations.push(
        createViolation({
          ruleId: RULE_SEC_LEAK_001,
          file: currentFile,
          message: `新增代码包含绝对路径或盘符泄漏: ${addedContent.trim()}`,
          actual: addedContent.trim(),
          expected: tpl.expected,
          actionableFix: tpl.actionableFix,
          line: currentLine,
        }),
      );
    }

    if (
      SECRET_PATTERN.test(addedContent) &&
      !SECRET_WHITELIST_PATTERN.test(addedContent)
    ) {
      const tpl = VIOLATION_TPLS.SECRET_LEAK;
      gate6Violations.push(
        createViolation({
          ruleId: RULE_SEC_VUL_001,
          file: currentFile,
          message: tpl.message,
          actual: tpl.actual,
          expected: tpl.expected,
          actionableFix: tpl.actionableFix,
          line: currentLine,
        }),
      );
    }
  }

  return { gate3Violations, gate6Violations };
}

function logSingleGateResult(spec, items) {
  if (items.length === 0) {
    console.log(`  ✔  ${spec.id}  ${spec.name}`);
    return;
  }
  if (spec.header) {
    console.error(spec.header);
  }
  const slice = spec.limit && spec.limit > 0 ? items.slice(0, spec.limit) : items;
  for (const v of slice) {
    const loc = v.file ? `${v.file}${v.line ? ':' + v.line : ''} - ` : '';
    console.error(spec.header ? `   ${loc}${v.message}` : `✖ BLOCK  ${spec.id}  ${v.message}`);
  }
}

function reportHumanViolations(violationsByGate) {
  for (let i = 0; i < GATE_SPECS.length; i++) {
    logSingleGateResult(GATE_SPECS[i], violationsByGate[i] || []);
  }
  for (let i = GATE_SPECS.length; i < violationsByGate.length; i++) {
    for (const v of violationsByGate[i] || []) {
      console.error(`✖ BLOCK  ${v.ruleId || STEP_NAME}  ${v.message}`);
    }
  }
}

/**
 * Parses CLI arguments into execution mode, revision range, and explicit file targets.
 *
 * @param {string[]} args - Raw process arguments.
 * @returns {{isAgentMode: boolean, range: string, explicitFiles: string[], useIndex: boolean}} Parsed run options.
 */
function parseRunArgs(args) {
  const isAgentMode = args.includes(FLAG_AGENT) || args.includes(FLAG_SHORT_A) || args.includes(FLAG_JSON);
  const rangeIndex = args.indexOf('--range');
  const rangeValueIndex = rangeIndex === -1 ? -1 : rangeIndex + 1;
  const range = rangeValueIndex !== -1 && args[rangeValueIndex] ? args[rangeValueIndex] : '';
  if (range && !/^[A-Za-z0-9_./~^@{}:-]+$/.test(range)) {
    console.error(`Invalid --range value: ${range}`);
    process.exit(2);
  }
  const explicitFiles = args.filter((arg, index) => !arg.startsWith('-') && index !== rangeValueIndex);
  return { isAgentMode, range, explicitFiles, useIndex: explicitFiles.length === 0 };
}

/**
 * Collects lease-frozen violations for the staged file set.
 *
 * @param repoRoot - Repository root (unused by the resolver but kept for symmetry).
 * @param stagedFiles - Staged file paths relative to the repository root.
 * @returns Violation records for every staged file owned by a frozen project.
 */
function collectProjectViolations(repoRoot, stagedFiles) {
  const violations = [];
  try {
    const resolver = require('./project-registry-resolver');
    const leases = resolver.resolveProjectLeases();
    for (const lease of leases) {
      if (lease.status !== 'Frozen') continue;
      const root = (lease.root_path || '').replace(/\\/g, '/').replace(/^\.\/?/, '');
      const hit = root === ''
        ? stagedFiles.find((f) => !f.startsWith('scripts/'))
        : stagedFiles.find((f) => f.startsWith(root + '/') || f === root);
      if (!hit) continue;
      violations.push({
        ruleId: 'CMG-PRJ-001',
        severity: SEVERITY_BLOCK,
        file: hit,
        message: `受控项目 '${lease.id}' TTL 租约已过期，提交权限已被锁定 (Commit Lockdown)。运行 'taxis project renew ${lease.id}' 续约解冻。`,
      });
    }
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') {
      console.warn(`WARN project-registry-resolver failed: ${err.message}`);
    }
  }
  return violations;
}

function collectBranchViolations(repoRoot) {
  let gov;
  try { gov = require('./validate-branch-governance'); } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') return [];
    return [{ ruleId: 'FGT-TOP-001', severity: SEVERITY_BLOCK, file: '.git/HEAD', message: `分支治理模块加载失败（Fail-Closed）: ${err.message}` }];
  }
  try { return gov.collectCurrentBranchViolation(repoRoot, SEVERITY_BLOCK); } catch (err) {
    return [{ ruleId: 'FGT-TOP-001', severity: SEVERITY_BLOCK, file: '.git/HEAD', message: `分支治理校验失败（Fail-Closed）: ${err.message}` }];
  }
}

/**
 * Reports the empty-staging pass in either agent or human form.
 *
 * @param isAgentMode - Whether the caller wants the structured protocol envelope.
 */
function reportEmptyStaging(isAgentMode) {
  if (isAgentMode) {
    const payload = {
      protocolVersion: PROTOCOL_VERSION, status: STATUS_PASS, gate: FAST_STAGED_GATE,
      summary: 'Staged area is empty, fast-staged review skipped.',
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('ℹ️  暂存区无文件变更，跳过 fast-staged 检查。');
  }
  process.exit(0);
}

/**
 * Emits the pass verdict in either agent or human form.
 *
 * @param isAgentMode - Whether the caller wants the structured protocol envelope.
 * @param warnings - Indentation warnings collected during the file stream pass.
 */
function reportPassingVerdict(isAgentMode, warnings) {
  if (isAgentMode) {
    const payload = {
      protocolVersion: PROTOCOL_VERSION, status: STATUS_PASS, gate: FAST_STAGED_GATE,
      summary: 'All fast-staged hygiene and security checks passed.', warnings: warnings.slice(0, 20),
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  for (const spec of GATE_SPECS) console.log(`  ✔  ${spec.id}  ${spec.name}`);
  if (warnings.length > 0) {
    console.warn(`  ⚠ [WARN] ${warnings.length} 处缩进宽度不符合契约（仅告警，不阻断）`);
    for (const item of warnings.slice(0, 5)) {
      console.warn(`     ${item.file}:${item.line} ${item.actual} != ${item.expected}`);
    }
  }
}

/**
 * Emits the blocking verdict: snapshot for the workbench, envelope for agents.
 *
 * @param isAgentMode - Whether the caller wants the structured protocol envelope.
 * @param buckets - Violation buckets grouped by the check that produced them.
 * @param warnings - Indentation warnings collected during the file stream pass.
 */
function reportBlockingVerdict(isAgentMode, buckets, warnings) {
  const allViolations = buckets.flat();
  const { writeFailureSnapshot } = require('./log-rotator');
  const envelope = {
    gate: FAST_STAGED_GATE, step: STEP_NAME, failedCommand: SCRIPT_NAME, exitCode: 1,
    summary: `Fast staged check blocked commit due to ${allViolations.length} physical hygiene or security violations.`,
    violations: allViolations, warnings: warnings.slice(0, 20),
    targetFiles: Array.from(new Set(allViolations.map((v) => v.file).filter(Boolean))),
    verificationCommand: SCRIPT_NAME,
  };
  writeFailureSnapshot(envelope);
  if (isAgentMode) {
    console.log(JSON.stringify(envelope, null, 2));
    process.exit(1);
  }
  reportHumanViolations(buckets);
  process.exit(1);
}

function runFastStaged() {
  const { isAgentMode, range, explicitFiles, useIndex } = parseRunArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '../..');

  let stagedFiles;
  try {
    stagedFiles = getStagedFiles(repoRoot, explicitFiles);
  } catch (err) {
    // Fail closed: an unreadable index examined nothing, so the empty-staging PASS below would lie.
    console.error(`✖ BLOCK  STAGED-HYGIENE-01  ${err.message}`);
    process.exit(1);
  }

  const { gate1Violations, lineEndingViolations, nomenclatureViolations, volumeViolations, warnings } =
    checkFileStream(repoRoot, stagedFiles, useIndex);

  if (stagedFiles.length === 0 && gate1Violations.length === 0 && nomenclatureViolations.length === 0) {
    reportEmptyStaging(isAgentMode);
  }

  let diffText;
  try {
    diffText = getStagedDiff(repoRoot, range);
  } catch (err) {
    console.error(`✖ BLOCK  STAGED-HYGIENE-01  无法读取暂存 diff（${err.message}），拒绝放行`);
    process.exit(1);
  }
  const { gate3Violations, gate6Violations } = checkDiffStream(diffText);
  const projectViolations = collectProjectViolations(repoRoot, stagedFiles);
  const headViolations = !range ? checkHeadReceipt(repoRoot) : [];
  const branchViolations = !range ? collectBranchViolations(repoRoot) : [];

  const buckets = [
    gate1Violations, lineEndingViolations, gate3Violations, nomenclatureViolations,
    volumeViolations, gate6Violations, projectViolations, headViolations, branchViolations,
  ];

  if (buckets.some((bucket) => bucket.length > 0)) {
    reportBlockingVerdict(isAgentMode, buckets, warnings);
  }
  reportPassingVerdict(isAgentMode, warnings);
  process.exit(0);
}

if (require.main === module) {
  runFastStaged();
}

module.exports = {
  getSafeGitEnv,
  checkFileStream,
  checkDiffStream,
  calculateEloc,
  runFastStaged,
  checkHeadReceipt,
  isMorphemeValid,
  validateFilenameSegments,
  validateFilenameLength,
};
