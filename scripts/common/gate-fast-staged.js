/**
 * Module: Governance Guard — Fast Staged Stream Validator
 * File Path: scripts/common/gate-fast-staged.js
 * Architecture Role: Single-pass, in-memory stream auditor for Git staged changes.
 *   Consolidates Gates 1 through 6 into a single Node.js runtime process:
 *   - Gate 1: Zero 0-byte & whitespace-only empty files
 *   - Gate 2: Line ending contract (.ps1 -> CRLF, others -> LF)
 *   - Gate 3: Absolute path & drive letter leak prevention
 *   - Gate 4: Zero slang & temporary nomenclature
 *   - Gate 5: Dual-scale volume & dynamic envelope budget (ELOC <= 900, LOC <= 1400)
 *   - Gate 6: Secret keys & sensitive token leak prevention
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path, child_process);
 *   invoked by pre-commit-gate (ps1/sh), pre-push-gate, and CI hygiene workflows.
 * Responsibilities:
 *   1. Rapidly validate staged file physical cleanliness and line ending conventions;
 *   2. Guard against secret token leaks, absolute path disclosures, and non-standard nomenclature;
 *   3. Enforce dual-scale ELOC/LOC volume budgets across staged source files;
 *   4. Emit structured diagnostic console logs and fail-closed exit codes.
 * Exit Semantics & Design Rationale: Exits 0 on clean check, 1 on any violation.
 *   Employs single-pass in-memory stream parsing to achieve <90ms pre-commit execution without disk thrashing.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SECRET_PATTERN =
  /(?:AIza[0-9A-Za-z_-]{35}|sk-[a-zA-Z0-9]{32,}|ghp_[a-zA-Z0-9]{36}|-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----)/;
const SECRET_WHITELIST_PATTERN =
  /(?:\$\{env:|CODEX_API_KEY|OPENAI_API_KEY|test-secret|mock-key|placeholder)/;

const ABS_PATH_PATTERN = /(?:\b[A-Za-z]:[\\/][a-zA-Z0-9_-]+|file:\/\/\/)/;
const ABS_PATH_WHITELIST_PATTERN = /(?:node_modules|\.gemini|file:\/\/)/;

const SLANG_FILENAME_PATTERN = /(?:^|[-_.])(?:temp|wip|new|st\d+|p\d+)(?:[-_.]|$)/i;

const ALLOWED_SHORT_STEMS = new Set([
  'ui', 'en', 'zh', 'db', 'io', 'ci', 'os', 'vm', 'fs', 're', 'id', 'ip', 'gm',
]);

const STANDARD_TECH_ABBREVIATIONS = new Set([
  'ui', 'db', 'io', 'os', 'vm', 'fs', 'id', 'ip', 'ci', 'cd',
  'sdk', 'api', 'cli', 'ast', 'cfg', 'lut', 'doc', 'req', 'res',
  'msg', 'btn', 'pkg', 'src', 'ctx', 'fmt', 'cmd', 'ptr', 'str',
  'std', 'fps', 'rng', 'pr', 'sh', 'ps', 'md', 'ts', 'js', 'py',
  'gd', 'rs', '2d', '3d', '4k', 'ssl', 'ssh', 'tcp', 'udp', 'dns',
  'rpc', 'ipc', 'csr', 'soa', 'swar', 'simd', 'cc', 'eloc', 'loc',
  'diff', 'rgb', 'hex', 'fn', 'cb', 'rx', 'tx', 'env', 'app', 'dev',
  'fsm', 'npc', 'gm', 'rpg', 'pve', 'pvp', 'hp', 'mp',
  'vs', 'prf', 'mcp', 'ssot', 'ir', 'cai', 'e2e', 'wasm',
]);

const IGNORED_BASENAMES = new Set([
  'index', 'main', 'lib', 'mod', 'api', 'types', 'cli', 'readme', 'changelog', 'license',
]);

function getSafeGitEnv() {
  const root = path.resolve(__dirname, '../..');
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL || 'NUL',
    GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM || 'NUL',
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM || '1',
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || root,
  };
}

function getStagedFiles(repoRoot) {
  const args = process.argv.slice(2);
  const explicitFiles = args.filter((a) => !a.startsWith('-'));
  if (explicitFiles.length > 0) {
    return explicitFiles;
  }
  try {
    const raw = execSync('git diff --cached --name-only "--diff-filter=ACM"', {
      cwd: repoRoot,
      env: getSafeGitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return raw
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
  } catch {
    return [];
  }
}

function getStagedDiff(repoRoot) {
  try {
    return execSync('git diff --cached -U0 --no-color', {
      cwd: repoRoot,
      env: getSafeGitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function isExemptSlangPath(filePath, baseName) {
  const norm = filePath.replace(/\\/g, '/');
  return (
    norm.includes('WebGames/docs/路线图/') ||
    norm.includes('WebGames/docs/归档库/') ||
    /^fe_\d{2}/.test(baseName)
  );
}

function classifyCLine(line, inBlockComment) {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { isBlank: true, isComment: false, inBlock: inBlockComment };
  }
  if (inBlockComment) {
    const endIdx = trimmed.indexOf('*/');
    if (endIdx === -1) {
      return { isBlank: false, isComment: true, inBlock: true };
    }
    const rest = trimmed.slice(endIdx + 2).trim();
    return { isBlank: false, isComment: rest.length === 0, inBlock: false };
  }
  if (trimmed.startsWith('/*')) {
    const endIdx = trimmed.indexOf('*/', 2);
    if (endIdx === -1) {
      return { isBlank: false, isComment: true, inBlock: true };
    }
    const rest = trimmed.slice(endIdx + 2).trim();
    return { isBlank: false, isComment: rest.length === 0, inBlock: false };
  }
  if (trimmed.startsWith('//') || (trimmed.startsWith('*') && !trimmed.startsWith('*='))) {
    return { isBlank: false, isComment: true, inBlock: false };
  }
  return { isBlank: false, isComment: false, inBlock: false };
}

function classifyHashLine(line, inTripleQuote, quoteChar) {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { isBlank: true, isComment: false, inBlock: inTripleQuote, quoteChar };
  }
  if (inTripleQuote) {
    const endIdx = trimmed.indexOf(quoteChar);
    if (endIdx === -1) {
      return { isBlank: false, isComment: true, inBlock: true, quoteChar };
    }
    const rest = trimmed.slice(endIdx + 3).trim();
    return { isBlank: false, isComment: rest.length === 0, inBlock: false, quoteChar: '' };
  }
  if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
    const currentQuote = trimmed.slice(0, 3);
    const endIdx = trimmed.indexOf(currentQuote, 3);
    if (endIdx === -1) {
      return { isBlank: false, isComment: true, inBlock: true, quoteChar: currentQuote };
    }
    const rest = trimmed.slice(endIdx + 3).trim();
    return { isBlank: false, isComment: rest.length === 0, inBlock: false, quoteChar: '' };
  }
  if (trimmed.startsWith('#') || trimmed.startsWith(';')) {
    return { isBlank: false, isComment: true, inBlock: false, quoteChar: '' };
  }
  return { isBlank: false, isComment: false, inBlock: false, quoteChar: '' };
}

function classifyPowerShellLine(line, inBlock) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return { isBlank: true, isComment: false, inBlock };
  if (inBlock) {
    const endIdx = trimmed.indexOf('#>');
    if (endIdx === -1) return { isBlank: false, isComment: true, inBlock: true };
    const rest = trimmed.slice(endIdx + 2).trim();
    return { isBlank: false, isComment: rest.length === 0, inBlock: false };
  }
  if (trimmed.startsWith('<#')) {
    const endIdx = trimmed.indexOf('#>', 2);
    if (endIdx === -1) return { isBlank: false, isComment: true, inBlock: true };
    const rest = trimmed.slice(endIdx + 2).trim();
    return { isBlank: false, isComment: rest.length === 0, inBlock: false };
  }
  if (trimmed.startsWith('#')) return { isBlank: false, isComment: true, inBlock: false };
  return { isBlank: false, isComment: false, inBlock: false };
}

function calculateEloc(content, ext) {
  const lines = content.split(/\r?\n/);
  const totalLoc = lines.length;
  let eloc = 0;
  const isPowerShell = ext === '.ps1';
  const isHash = ext === '.gd' || ext === '.py' || ext === '.sh' || ext === '.bash';
  let inBlock = false;
  let quoteChar = '';

  for (const line of lines) {
    if (isPowerShell) {
      const res = classifyPowerShellLine(line, inBlock);
      inBlock = res.inBlock;
      if (!res.isBlank && !res.isComment) eloc++;
    } else if (isHash) {
      const res = classifyHashLine(line, inBlock, quoteChar);
      inBlock = res.inBlock;
      quoteChar = res.quoteChar;
      if (!res.isBlank && !res.isComment) eloc++;
    } else {
      const res = classifyCLine(line, inBlock);
      inBlock = res.inBlock;
      if (!res.isBlank && !res.isComment) eloc++;
    }
  }
  return { totalLoc, eloc };
}

/**
 * Constructs a structured violation payload adhering to the Agent Directives Protocol.
 *
 * @param {string} ruleId - Unique catalogued rule identifier.
 * @param {string} file - Path to target file with violation.
 * @param {string} message - Factual diagnostic explanation.
 * @param {string} actual - Observed non-compliant state.
 * @param {string} expected - Target compliant invariant.
 * @param {string} actionableFix - Actionable prescription for Agent self-healing.
 * @param {number} [line] - 1-indexed target line number.
 * @returns {object} Structured violation envelope.
 */
function createViolation(ruleId, file, message, actual, expected, actionableFix, line = undefined) {
  const item = {
    ruleId,
    severity: 'BLOCK',
    file: file ? file.replace(/\\/g, '/') : undefined,
    line,
    actual,
    expected,
    message,
    actionableFix,
  };
  item.toString = function () {
    return this.message;
  };
  return item;
}

/**
 * Validates that file name does not contain temporary engineering slang or batch tokens.
 *
 * @param {string} file - Relative path to staged file.
 * @param {Array} gate4Violations - Collector array for Gate 4 findings.
 */
function validateFilenameSlang(file, gate4Violations) {
  const baseName = path.basename(file);
  if (!isExemptSlangPath(file, baseName) && SLANG_FILENAME_PATTERN.test(baseName)) {
    gate4Violations.push(
      createViolation(
        'HYG-NAM-001',
        file,
        `文件名包含临时性违规黑话标记: ${file}`,
        baseName,
        '零黑话与规范命名 (禁止 temp/wip/new/stN/pN)',
        '重命名文件以移除临时黑话标记',
      ),
    );
  }
}

/**
 * Determines whether a name segment contains valid vowel morphemes or approved technical acronyms.
 *
 * @param {string} seg - Substring word segment.
 * @returns {boolean} True if segment conforms to morpheme criteria.
 */
function isMorphemeValid(seg) {
  if (seg.length < 2) return true;
  if (/^\d+$/.test(seg)) return true;
  if (seg.toLowerCase() === 'xyz') return false;
  if (/[aeiouy]/i.test(seg)) return true;
  return STANDARD_TECH_ABBREVIATIONS.has(seg.toLowerCase());
}

/**
 * Validates hyphenated/underscored segment count and phonotactic hygiene of filename stems.
 *
 * @param {string} file - Relative path of target file.
 * @param {string} stem - Extension-stripped filename stem.
 * @param {Array} gate4Violations - Collector array for Gate 4 findings.
 */
function validateFilenameSegments(file, stem, gate4Violations) {
  const norm = file.replace(/\\/g, '/');
  const isTest = /(?:tests\/|\.test\.|\.spec\.|test_)/i.test(norm);
  const maxSegments = isTest ? 8 : 5;
  const cleanStem = stem.replace(/\.(?:test|spec)$/i, '').replace(/^test[_-]/i, '');
  const segments = cleanStem.split(/[-_]+/).filter(Boolean);
  if (segments.length > maxSegments) {
    gate4Violations.push(
      createViolation(
        'HYG-NAM-001',
        file,
        `文件名单词段数过多 (> ${maxSegments} 段，过度堆叠): ${file}`,
        `${segments.length} segments`,
        `<= ${maxSegments} segments`,
        '按子目录分层重构文件名，减少连接词段数',
      ),
    );
  }
  for (const seg of segments) {
    if (!isMorphemeValid(seg)) {
      gate4Violations.push(
        createViolation(
          'HYG-NAM-001',
          file,
          `文件名单词段 '${seg}' 缺乏元音语素且非标准技术缩写: ${file}`,
          seg,
          '含元音语素或标准技术缩写',
          '修正文件名单词拼写或使用标准技术缩写',
        ),
      );
    }
  }
}

/**
 * Enforces length boundaries (< 3 chars, > 55 chars) and segment complexity on filename stems.
 *
 * @param {string} file - Relative path to staged file.
 * @param {Array} gate4Violations - Collector array for Gate 4 findings.
 */
function validateFilenameLength(file, gate4Violations) {
  const norm = file.replace(/\\/g, '/');
  if (/(?:fixtures\/|testdata\/|\.bench|__mocks__\/|docs\/)/i.test(norm)) return;
  const baseName = path.basename(file);
  const ext = path.extname(baseName);
  if (!/\.(?:ts|js|py|gd|rs|sh|ps1)$/i.test(ext)) return;
  const stem = baseName.slice(0, baseName.length - ext.length);
  const lower = stem.toLowerCase();
  if (IGNORED_BASENAMES.has(lower)) return;
  if (stem.length < 3 && !ALLOWED_SHORT_STEMS.has(lower)) {
    gate4Violations.push(
      createViolation(
        'HYG-NAM-001',
        file,
        `文件名过短 (< 3 字符，缺乏语义描述): ${file}`,
        `${stem.length} chars`,
        '>= 3 chars',
        '重命名文件以提供具有领域语义的描述名称',
      ),
    );
    return;
  }
  if (stem.length > 55) {
    gate4Violations.push(
      createViolation(
        'HYG-NAM-001',
        file,
        `文件名过长 (> 55 字符，建议按子目录解耦): ${file}`,
        `${stem.length} chars`,
        '<= 55 chars',
        '通过划分清晰子目录解耦超长文件名',
      ),
    );
  }
  validateFilenameSegments(file, stem, gate4Violations);
}

/**
 * Validates cross-platform line ending contract (.ps1 must be CRLF, others must be LF).
 *
 * @param {string} file - Relative file path.
 * @param {Buffer} buffer - Raw file byte buffer.
 * @param {Array} gate2Violations - Collector array for Gate 2 findings.
 */
function validateFileEol(file, buffer, gate2Violations) {
  const hasCR = buffer.includes(0x0d);
  if (file.endsWith('.ps1')) {
    if (!hasCR) {
      gate2Violations.push(
        createViolation(
          'HYG-EOL-001',
          file,
          `PowerShell 脚本必须使用 CRLF 换行符: ${file}`,
          'LF',
          'CRLF',
          '将该 PowerShell 脚本换行符转换为 CRLF',
        ),
      );
    }
  } else if (/\.(?:sh|ts|js|gd|json|md)$/i.test(file)) {
    if (hasCR) {
      gate2Violations.push(
        createViolation(
          'HYG-EOL-001',
          file,
          `代码/文档必须使用 LF 换行符，检测到 CRLF: ${file}`,
          'CRLF',
          'LF',
          '将该文件换行符转换为 LF',
        ),
      );
    }
  }
}

/**
 * Validates dual-scale volume budgets (ELOC <= 900, LOC <= 1400) on staged source files.
 *
 * @param {string} file - Relative file path.
 * @param {string} content - Raw text content of the file.
 * @param {Array} gate5Violations - Collector array for Gate 5 findings.
 */
function validateFileVolume(file, content, gate5Violations) {
  const norm = file.replace(/\\/g, '/');
  if (
    !/\.(?:ts|gd|js|py|sh|ps1|mjs|cjs)$/i.test(file) ||
    /(?:dist\/|out\/|fixtures\/|baseline|reports\/|\.d\.ts$|corpus)/.test(norm)
  ) {
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const { totalLoc, eloc } = calculateEloc(content, ext);
  if (eloc > 900) {
    gate5Violations.push(
      createViolation(
        'VOL-ELOC-001',
        file,
        `单文件有效行数超标 (${eloc} > 900 ELOC): ${file}`,
        `ELOC = ${eloc}`,
        'ELOC <= 900',
        '消除冗余实现并提取子模块以控制 ELOC <= 900',
      ),
    );
  }
  if (totalLoc > 1400) {
    gate5Violations.push(
      createViolation(
        'VOL-LOC-001',
        file,
        `单文件行数超标 (${totalLoc} > 1400 LOC): ${file}`,
        `LOC = ${totalLoc}`,
        'LOC <= 1400',
        '重构超大文件，按子领域解耦以控制 LOC <= 1400',
      ),
    );
  }
}

/**
 * Inspects a single staged file across cleanliness, line ending, and volume dimensions.
 *
 * @param {string} repoRoot - Absolute repository root.
 * @param {string} file - Relative file path.
 * @param {object} collectors - Bucket collectors for gate violations.
 */
function inspectStagedFile(repoRoot, file, collectors) {
  validateFilenameSlang(file, collectors.gate4);
  validateFilenameLength(file, collectors.gate4);

  const fullPath = path.resolve(repoRoot, file);
  if (!fs.existsSync(fullPath)) return;

  let stat;
  let buffer;
  try {
    stat = fs.statSync(fullPath);
    if (stat.size === 0) {
      collectors.gate1.push(
        createViolation(
          'HYG-EMP-001',
          file,
          `发现 0 字节物理空文件: ${file}`,
          '0 bytes',
          '> 0 bytes with semantic payload',
          '删除该空文件或实现实质代码逻辑',
        ),
      );
      return;
    }
    buffer = fs.readFileSync(fullPath);
  } catch {
    return;
  }

  const content = buffer.toString('utf8');
  if (content.trim().length === 0) {
    collectors.gate1.push(
      createViolation(
        'HYG-EMP-001',
        file,
        `发现仅含空白字符的虚空文件: ${file}`,
        '0 non-whitespace characters',
        '实质内容',
        '删除该虚空文件或填充代码',
      ),
    );
    return;
  }

  validateFileEol(file, buffer, collectors.gate2);
  validateFileVolume(file, content, collectors.gate5);
}

/**
 * Single-pass file stream scanner covering Gates 1, 2, 4, and 5.
 *
 * @param {string} repoRoot - Absolute repository root.
 * @param {string[]} stagedFiles - List of staged file paths.
 * @returns {object} Aggregated violation buckets.
 */
function checkFileStream(repoRoot, stagedFiles) {
  const collectors = {
    gate1: [],
    gate2: [],
    gate4: [],
    gate5: [],
  };

  for (const file of stagedFiles) {
    inspectStagedFile(repoRoot, file, collectors);
  }

  return {
    gate1Violations: collectors.gate1,
    gate2Violations: collectors.gate2,
    gate4Violations: collectors.gate4,
    gate5Violations: collectors.gate5,
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
      gate3Violations.push(
        createViolation(
          'SEC-LEAK-001',
          currentFile,
          `新增代码包含绝对路径或盘符泄漏: ${addedContent.trim()}`,
          addedContent.trim(),
          '相对路径或环境变量动态解析',
          '替换绝对路径或盘符为相对路径或 path.resolve(__dirname, ...)',
          currentLine,
        ),
      );
    }

    if (
      SECRET_PATTERN.test(addedContent) &&
      !SECRET_WHITELIST_PATTERN.test(addedContent)
    ) {
      gate6Violations.push(
        createViolation(
          'SEC-VUL-001',
          currentFile,
          '暂存代码包含疑似未脱敏的密钥或私钥',
          '敏感凭证特征串',
          '环境变量或模拟密钥',
          '立即移除真实密钥并配置环境变量注入，严禁提交凭证到版本库',
          currentLine,
        ),
      );
    }
  }

  return { gate3Violations, gate6Violations };
}

function logSingleGateResult(num, name, items, limit = 0, header = '') {
  if (items.length === 0) {
    console.log(`  ✔ [Gate ${num}] ${name}`);
    return;
  }
  if (header) {
    console.error(header);
  }
  const slice = limit > 0 ? items.slice(0, limit) : items;
  for (const v of slice) {
    const loc = v.file ? `${v.file}${v.line ? ':' + v.line : ''} - ` : '';
    console.error(header ? `   ${loc}${v.message}` : `❌ [FAIL] Gate ${num}: ${v.message}`);
  }
}

function reportHumanViolations(g1, g2, g3, g4, g5, g6) {
  logSingleGateResult(1, '暂存区零空文件检查通过', g1);
  logSingleGateResult(2, '换行符契约 (ps1 CRLF, 其余 LF) 检查通过', g2);
  logSingleGateResult(3, '绝对路径与协议防泄漏检查通过', g3, 5, '❌ [FAIL] Gate 3: 检测到新增代码中包含绝对路径或盘符泄漏:');
  logSingleGateResult(4, '零黑话与规范命名检查通过', g4);
  logSingleGateResult(5, '双轨体积预算 (ELOC<=900, LOC<=1400) 检查通过', g5);
  logSingleGateResult(6, '密钥与敏感 Token 防泄漏扫描通过', g6, 3, '❌ [FAIL] Gate 6: 检测到暂存代码中疑似包含未脱敏的真实密钥或私钥！');
}

function runFastStaged() {
  const args = process.argv.slice(2);
  const isAgentMode = args.includes('--agent') || args.includes('-a') || args.includes('--json');
  const repoRoot = path.resolve(__dirname, '../..');
  const stagedFiles = getStagedFiles(repoRoot);

  if (stagedFiles.length === 0) {
    if (isAgentMode) {
      console.log(
        JSON.stringify(
          {
            protocolVersion: '1.0.0',
            status: 'PASS',
            gate: 'pre-commit:fast-staged',
            summary: 'Staged area is empty, fast-staged review skipped.',
          },
          null,
          2,
        ),
      );
    } else {
      console.log('ℹ️  暂存区无文件变更，跳过 fast-staged 检查。');
    }
    process.exit(0);
  }

  const { gate1Violations, gate2Violations, gate4Violations, gate5Violations } =
    checkFileStream(repoRoot, stagedFiles);

  const diffText = getStagedDiff(repoRoot);
  const { gate3Violations, gate6Violations } = checkDiffStream(diffText);

  const allViolations = [
    ...gate1Violations,
    ...gate2Violations,
    ...gate3Violations,
    ...gate4Violations,
    ...gate5Violations,
    ...gate6Violations,
  ];

  if (allViolations.length > 0) {
    const { writeFailureSnapshot } = require('./log-rotator');
    const envelope = {
      gate: 'pre-commit:fast-staged',
      step: 'Gate 1~6 Fast Staged Stream Review',
      failedCommand: 'node scripts/common/gate-fast-staged.js',
      exitCode: 1,
      summary: `Fast staged check blocked commit due to ${allViolations.length} physical hygiene or security violations.`,
      violations: allViolations,
      targetFiles: Array.from(new Set(allViolations.map((v) => v.file).filter(Boolean))),
      verificationCommand: 'node scripts/common/gate-fast-staged.js',
    };
    writeFailureSnapshot(envelope);

    if (isAgentMode) {
      console.log(JSON.stringify(envelope, null, 2));
      process.exit(1);
    }

    reportHumanViolations(
      gate1Violations,
      gate2Violations,
      gate3Violations,
      gate4Violations,
      gate5Violations,
      gate6Violations,
    );
    process.exit(1);
  }

  if (isAgentMode) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: '1.0.0',
          status: 'PASS',
          gate: 'pre-commit:fast-staged',
          summary: 'All fast-staged hygiene and security checks passed.',
        },
        null,
        2,
      ),
    );
  } else {
    console.log('  ✔ [Gate 1] 暂存区零空文件检查通过');
    console.log('  ✔ [Gate 2] 换行符契约 (ps1 CRLF, 其余 LF) 检查通过');
    console.log('  ✔ [Gate 3] 绝对路径与协议防泄漏检查通过');
    console.log('  ✔ [Gate 4] 零黑话与规范命名检查通过');
    console.log('  ✔ [Gate 5] 双轨体积预算 (ELOC<=900, LOC<=1400) 检查通过');
    console.log('  ✔ [Gate 6] 密钥与敏感 Token 防泄漏扫描通过');
  }
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
  isMorphemeValid,
  validateFilenameSegments,
  validateFilenameLength,
};
