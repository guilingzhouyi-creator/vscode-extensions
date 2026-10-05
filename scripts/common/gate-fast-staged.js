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
 * Exit Semantics: Exits 0 on clean check, 1 on any violation.
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
  const explicitFiles = args.filter((a) => !a.startsWith('--'));
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

function calculateEloc(content, ext) {
  const lines = content.split(/\r?\n/);
  const totalLoc = lines.length;
  let eloc = 0;
  const isHash = ext === '.gd' || ext === '.py' || ext === '.sh';
  let inBlock = false;
  let quoteChar = '';

  for (const line of lines) {
    if (isHash) {
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

function validateFilenameSlang(file, gate4Violations) {
  const baseName = path.basename(file);
  if (!isExemptSlangPath(file, baseName) && SLANG_FILENAME_PATTERN.test(baseName)) {
    gate4Violations.push(`文件名包含临时性违规黑话标记: ${file}`);
  }
}

function validateFileEol(file, buffer, gate2Violations) {
  const hasCR = buffer.includes(0x0d);
  if (file.endsWith('.ps1')) {
    if (!hasCR) {
      gate2Violations.push(`PowerShell 脚本必须使用 CRLF 换行符: ${file}`);
    }
  } else if (/\.(?:sh|ts|js|gd|json|md)$/i.test(file)) {
    if (hasCR) {
      gate2Violations.push(`代码/文档必须使用 LF 换行符，检测到 CRLF: ${file}`);
    }
  }
}

function validateFileVolume(file, content, gate5Violations) {
  const norm = file.replace(/\\/g, '/');
  if (
    !/\.(?:ts|gd|js|py)$/i.test(file) ||
    /(?:dist\/|out\/|fixtures\/|baseline|reports\/|\.d\.ts$)/.test(norm)
  ) {
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const { totalLoc, eloc } = calculateEloc(content, ext);
  if (eloc > 900) {
    gate5Violations.push(`单文件有效行数超标 (${eloc} > 900 ELOC): ${file}`);
  }
  if (totalLoc > 1400) {
    gate5Violations.push(`单文件行数超标 (${totalLoc} > 1400 LOC): ${file}`);
  }
}

function inspectStagedFile(repoRoot, file, collectors) {
  validateFilenameSlang(file, collectors.gate4);

  const fullPath = path.resolve(repoRoot, file);
  if (!fs.existsSync(fullPath)) return;

  let stat;
  let buffer;
  try {
    stat = fs.statSync(fullPath);
    if (stat.size === 0) {
      collectors.gate1.push(`发现 0 字节物理空文件: ${file}`);
      return;
    }
    buffer = fs.readFileSync(fullPath);
  } catch {
    return;
  }

  const content = buffer.toString('utf8');
  if (content.trim().length === 0) {
    collectors.gate1.push(`发现仅含空白字符的虚空文件: ${file}`);
    return;
  }

  validateFileEol(file, buffer, collectors.gate2);
  validateFileVolume(file, content, collectors.gate5);
}

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

function checkDiffStream(diffText) {
  const gate3Violations = [];
  const gate6Violations = [];
  if (!diffText) return { gate3Violations, gate6Violations };

  const lines = diffText.split('\n');
  for (const line of lines) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const addedContent = line.slice(1);

    if (
      ABS_PATH_PATTERN.test(addedContent) &&
      !ABS_PATH_WHITELIST_PATTERN.test(addedContent)
    ) {
      gate3Violations.push(addedContent.trim());
    }

    if (
      SECRET_PATTERN.test(addedContent) &&
      !SECRET_WHITELIST_PATTERN.test(addedContent)
    ) {
      gate6Violations.push(addedContent.trim());
    }
  }

  return { gate3Violations, gate6Violations };
}

function runFastStaged() {
  const repoRoot = path.resolve(__dirname, '../..');
  const stagedFiles = getStagedFiles(repoRoot);

  if (stagedFiles.length === 0) {
    console.log('ℹ️  暂存区无文件变更，跳过 fast-staged 检查。');
    process.exit(0);
  }

  const { gate1Violations, gate2Violations, gate4Violations, gate5Violations } =
    checkFileStream(repoRoot, stagedFiles);

  const diffText = getStagedDiff(repoRoot);
  const { gate3Violations, gate6Violations } = checkDiffStream(diffText);

  let failed = false;

  if (gate1Violations.length > 0) {
    failed = true;
    for (const v of gate1Violations) {
      console.error(`❌ [FAIL] Gate 1: ${v}`);
    }
  } else {
    console.log('  ✔ [Gate 1] 暂存区零空文件检查通过');
  }

  if (gate2Violations.length > 0) {
    failed = true;
    for (const v of gate2Violations) {
      console.error(`❌ [FAIL] Gate 2: ${v}`);
    }
  } else {
    console.log('  ✔ [Gate 2] 换行符契约 (ps1 CRLF, 其余 LF) 检查通过');
  }

  if (gate3Violations.length > 0) {
    failed = true;
    console.error('❌ [FAIL] Gate 3: 检测到新增代码中包含绝对路径或盘符泄漏:');
    for (const v of gate3Violations.slice(0, 5)) {
      console.error(`   ${v}`);
    }
  } else {
    console.log('  ✔ [Gate 3] 绝对路径与协议防泄漏检查通过');
  }

  if (gate4Violations.length > 0) {
    failed = true;
    for (const v of gate4Violations) {
      console.error(`❌ [FAIL] Gate 4: ${v}`);
    }
  } else {
    console.log('  ✔ [Gate 4] 零黑话与规范命名检查通过');
  }

  if (gate5Violations.length > 0) {
    failed = true;
    for (const v of gate5Violations) {
      console.error(`❌ [FAIL] Gate 5: ${v}`);
    }
  } else {
    console.log('  ✔ [Gate 5] 双轨体积预算 (ELOC<=900, LOC<=1400) 检查通过');
  }

  if (gate6Violations.length > 0) {
    failed = true;
    console.error('❌ [FAIL] Gate 6: 检测到暂存代码中疑似包含未脱敏的真实密钥或私钥！');
    for (const v of gate6Violations.slice(0, 3)) {
      console.error(`   ${v}`);
    }
  } else {
    console.log('  ✔ [Gate 6] 密钥与敏感 Token 防泄漏扫描通过');
  }

  if (failed) {
    process.exit(1);
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
};
