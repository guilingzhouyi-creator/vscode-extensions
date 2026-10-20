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
 *   Employs single-pass in-memory stream parsing to achieve <90ms pre-commit execution.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getSafeGitEnv, getStagedFiles: queryStagedFiles, readStagedBufferSafe, readStagedBuffersBatch } = require('./git-env');
const {
  evaluateCodeMetrics,
  classifyCStyleLine,
  classifyHashStyleLine,
  classifyPowerShellLine,
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
const GIT_DIFF_COMMAND = 'git diff --cached -U0 --no-color';
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
 */
const DENSITY_RATIO_LIMIT = 3.0;
const PLUMBING_RATIO_LIMIT = 0.6;

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
const ABS_PATH_WHITELIST_PATTERN = /(?:node_modules|\.gemini|file:\/\/)/;

const SLANG_FILENAME_PATTERN = /(?:^|[-_.])(?:temp|wip|new|st\d+|p\d+)(?:[-_.]|$)/i;

const ROOT_DISALLOWED_SCRIPT_EXTS = new Set([
  '.js', '.ts', '.py', '.sh', '.ps1', '.bat', '.cmd',
]);
const CLUTTER_FILE_PATTERN =
  /^(?:Thumbs\.db|desktop\.ini|\.DS_Store|.*\.tmp|.*\.bak|.*\.orig|.*\.swp|.*\.actual\.json|.*\.log)$/i;

const ALLOWED_SHORT_STEMS = new Set(
  'ui en zh db io ci os vm fs re id ip gm'.split(' ')
);

const STANDARD_TECH_ABBREVIATIONS = new Set(
  ('ui db io os vm fs id ip ci cd sdk api cli ast cfg lut doc req res msg btn pkg src ctx fmt cmd ptr str ' +
   'std fps rng pr sh ps md ts js py gd rs 2d 3d 4k ssl ssh tcp udp dns rpc ipc csr soa swar simd cc eloc loc ' +
   'diff rgb hex fn cb rx tx env app dev fsm npc gm rpg pve pvp hp mp cdc vs prf mcp ssot ir cai e2e wasm zh cn mcts vfs').split(' ')
);

const IGNORED_BASENAMES = new Set(
  'index main lib mod api types cli readme changelog license'.split(' ')
);

const RAW_GATE_SPECS = `EMPTY-FILE|暂存区零空文件与零纯注释空壳检查通过||
LINE-ENDING|换行/编码/EOF/缩进契约 (ps1 CRLF, 其余 LF, 无 BOM, 单 EOF, 无 Tab) 检查通过||
PATH-LEAK|绝对路径与协议防泄漏检查通过|5|✖ [BLOCK] PATH-LEAK: 检测到新增代码中包含绝对路径或盘符泄漏:
NOMENCLATURE|零黑话与规范命名检查通过||
VOLUME-BUDGET|双轨体积预算与代码密度守卫 (ELOC<=900, LOC<=1400, 稀释比<=3.5, 接线比<=65%) 检查通过||
SECRET-LEAK|密钥与敏感 Token 防泄漏扫描通过|3|✖ [BLOCK] SECRET-LEAK: 检测到暂存代码中疑似包含未脱敏的真实密钥或私钥！`;

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

const RAW_VIOLATION_TPLS = `SLANG_NAME|零黑话与规范命名 (禁止 temp/wip/new/stN/pN)|重命名文件以移除临时黑话标记
NAME_VOWEL|含元音语素或标准技术缩写|修正文件名单词拼写或使用标准技术缩写
NAME_SEGMENTS|按子目录分层重构文件名，减少连接词段数
NAME_SHORT|>= 3 chars|重命名文件以提供具有领域语义的描述名称
NAME_LONG|<= 55 chars|通过划分清晰子目录解耦超长文件名
EOL_PS1|CRLF|将该 PowerShell 脚本换行符转换为 CRLF
EOL_LF|LF|将该文件换行符转换为 LF
VOL_ELOC|ELOC <= 900|消除冗余实现并提取子模块以控制 ELOC <= 900
VOL_LOC|LOC <= 1400|重构超大文件，按子领域解耦以控制 LOC <= 1400
VOL_RATIO|垂直行稀释比超标 (totalLoc > eloc * 3.5)|消除空行堆叠或将长篇散文注释移至 Markdown 规范文档
ARCH_FAC|接线代码占比过高 (wiringRatio > 65%)|消除空心透传跳板或为门面注入实质领域能力/不可变性冻结
EMPTY_FILE|0 bytes|> 0 bytes with semantic payload|删除该空文件或实现实质代码逻辑
EMPTY_WS|0 non-whitespace characters|实质内容|删除该虚空文件或填充代码
PATH_LEAK|相对路径或环境变量动态解析|替换绝对路径或盘符为相对路径或 path.resolve(__dirname, ...)
SECRET_LEAK|暂存代码包含疑似未脱敏的密钥或私钥|敏感凭证特征串|环境变量或模拟密钥|立即移除真实密钥并配置环境变量注入，严禁提交凭证到版本库
ROOT_SCRIPT|工作区根目录严禁平铺散落代码脚本|scripts/ 规范子目录|将脚本移动至 scripts/common/, scripts/ps1/, scripts/sh/ 或项目 scripts/py/ 并保持根目录整洁 (EXT-DIR-001)
ROOT_CLUTTER|检测到根目录或工作区临时脏文件/日志|工作区洁净无临时脏污|删除临时文件或日志 (HYG-CLT-001)`;

const VIOLATION_TPLS = Object.freeze(
  RAW_VIOLATION_TPLS.split('\n').reduce((acc, row) => {
    const parts = row.split('|');
    const [key, p1, p2, p3, p4] = parts;
    if (parts.length === 5) {
      acc[key] = { message: p1, actual: p2, expected: p3, actionableFix: p4 };
    } else if (parts.length === 4) {
      acc[key] = { actual: p1, expected: p2, actionableFix: p3 };
    } else if (parts.length === 2) {
      acc[key] = { actionableFix: p1 };
    } else {
      acc[key] = { expected: p1, actionableFix: p2 };
    }
    return acc;
  }, {})
);

function getStagedFiles(repoRoot, explicitFiles = []) {
  return queryStagedFiles(repoRoot, explicitFiles);
}

function getStagedDiff(repoRoot, range = '') {
  const command = range ? `git diff -U0 --no-color ${range}` : GIT_DIFF_COMMAND;
  try {
    return execSync(command, {
      cwd: repoRoot,
      env: getSafeGitEnv(),
      encoding: ENCODING_UTF8,
      stdio: STDIO_PIPE,
    });
  } catch {
    return '';
  }
}

function isExemptSlangPath(filePath, baseName) {
  const norm = filePath.replace(/\\/g, '/');
  return RE_EXEMPT_SLANG.test(norm) || /^fe_\d{2}/.test(baseName);
}

const RE_FAST_WIRING = /^(?:import\s+|import\(|from\s+|export\s+(?:\*|type\s+\*|\{[^}]*\}\s*(?:from\s+[^;]+)?;?|default\s+[A-Za-z0-9_$]+;?$)|(?:const|let|var)\s+.*=\s*require\(|module\.exports\s*=|exports\.|source\s+|\.\s+|using\s+|Import-Module\s+|(?:extends\s+|class_name\s+|(?:const|var)\s+\w+\s*=\s*preload\())/;

/**
 * Measures ELOC, physical LOC, and wiring-line count for staged content.
 *
 * Line classification is delegated to evaluate-eloc-budget.js, which is the
 * declared single source of truth for ELOC semantics. Only the wiring-line
 * tally is local, because the fast staged gate is its sole consumer.
 *
 * @param {string} content - File content.
 * @param {string} ext - Lowercase file extension.
 * @returns {{ totalLoc: number, eloc: number, wiringCount: number }} Volume metrics.
 */
function calculateEloc(content, ext) {
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const { eloc, totalLoc } = evaluateCodeMetrics(content, ext, '');
  let wiringCount = 0;
  const effective = collectEffectiveLines(lines, ext);
  for (const line of effective) {
    if (RE_FAST_WIRING.test(line)) {
      wiringCount++;
    }
  }
  return { totalLoc, eloc, wiringCount };
}

/**
 * Returns the trimmed text of every semantically effective line.
 *
 * Runs the SSOT classifiers directly so the wiring tally observes exactly the
 * same line set that produced ELOC.
 *
 * @param {string[]} lines - Physical lines.
 * @param {string} ext - Lowercase file extension.
 * @returns {string[]} Trimmed effective lines.
 */
function collectEffectiveLines(lines, ext) {
  const isPowerShell = ext === '.ps1';
  const isHash = HASH_STYLE_EXTS.has(ext);
  const result = [];
  let inBlock = false;
  let quoteChar = '';

  for (const line of lines) {
    if (isPowerShell) {
      const res = classifyPowerShellLine(line, inBlock);
      inBlock = res.inBlock;
      if (!res.isBlank && !res.isComment) result.push(line.trim());
      continue;
    }
    if (isHash) {
      const res = classifyHashStyleLine(line, inBlock, quoteChar);
      inBlock = res.inBlock;
      quoteChar = res.quoteChar;
      if (!res.isBlank && !res.isComment) result.push(line.trim());
      continue;
    }
    const res = classifyCStyleLine(line, inBlock);
    inBlock = res.inBlock;
    if (!res.isBlank && !res.isComment) result.push(line.trim());
  }
  return result;
}


/**
 * Constructs a structured violation payload adhering to the Agent Directives Protocol.
 *
 * @param {object} violation - Violation parameters.
 * @param {string} violation.ruleId - Unique catalogued rule identifier.
 * @param {string} violation.file - Path to target file with violation.
 * @param {string} violation.message - Factual diagnostic explanation.
 * @param {string} violation.actual - Observed non-compliant state.
 * @param {string} violation.expected - Target compliant invariant.
 * @param {string} violation.actionableFix - Actionable prescription for Agent self-healing.
 * @param {number} [violation.line] - 1-indexed target line number.
 * @returns {object} Structured violation envelope.
 */
function createViolation({ ruleId, file, message, actual, expected, actionableFix, line = undefined }) {
  const item = {
    ruleId,
    severity: SEVERITY_BLOCK,
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
 * @param {Array} nomenclatureViolations - Collector array for NOMENCLATURE findings.
 */
function validateFilenameSlang(file, nomenclatureViolations) {
  const baseName = path.basename(file);
  if (!isExemptSlangPath(file, baseName) && SLANG_FILENAME_PATTERN.test(baseName)) {
    const tpl = VIOLATION_TPLS.SLANG_NAME;
    nomenclatureViolations.push(
      createViolation({
        ruleId: RULE_HYG_NAM_001,
        file,
        message: `文件名包含临时性违规黑话标记: ${file}`,
        actual: baseName,
        expected: tpl.expected,
        actionableFix: tpl.actionableFix,
      }),
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
 * @param {Array} nomenclatureViolations - Collector array for NOMENCLATURE findings.
 */
function validateFilenameSegments(file, stem, nomenclatureViolations) {
  const norm = file.replace(/\\/g, '/');
  const isTest = /(?:tests\/|\.test\.|\.spec\.|test_)/i.test(norm);
  const maxSegments = isTest ? MAX_FILENAME_SEGMENTS_TEST : MAX_FILENAME_SEGMENTS_SRC;
  const cleanStem = stem.replace(/\.(?:test|spec)$/i, '').replace(/^test[_-]/i, '');
  const segments = cleanStem.split(/[-_]+/).filter(Boolean);
  if (segments.length > maxSegments) {
    const tpl = VIOLATION_TPLS.NAME_SEGMENTS;
    nomenclatureViolations.push(
      createViolation({
        ruleId: RULE_HYG_NAM_001,
        file,
        message: `文件名单词段数过多 (> ${maxSegments} 段，过度堆叠): ${file}`,
        actual: `${segments.length} segments`,
        expected: `<= ${maxSegments} segments`,
        actionableFix: tpl.actionableFix,
      }),
    );
  }
  for (const seg of segments) {
    if (!isMorphemeValid(seg)) {
      const tpl = VIOLATION_TPLS.NAME_VOWEL;
      nomenclatureViolations.push(
        createViolation({
          ruleId: RULE_HYG_NAM_001,
          file,
          message: `文件名单词段 '${seg}' 缺乏元音语素且非标准技术缩写: ${file}`,
          actual: seg,
          expected: tpl.expected,
          actionableFix: tpl.actionableFix,
        }),
      );
    }
  }
}

/**
 * Enforces length boundaries (< 3 chars, > 55 chars) and segment complexity on filename stems.
 *
 * @param {string} file - Relative path to staged file.
 * @param {Array} nomenclatureViolations - Collector array for NOMENCLATURE findings.
 */
function validateFilenameLength(file, nomenclatureViolations) {
  const norm = file.replace(/\\/g, '/');
  if (/(?:fixtures\/|testdata\/|\.bench|__mocks__\/|docs\/)/i.test(norm)) return;
  const baseName = path.basename(file);
  const ext = path.extname(baseName);
  if (!/\.(?:ts|js|py|gd|rs|sh|ps1)$/i.test(ext)) return;
  const stem = baseName.slice(0, baseName.length - ext.length);
  const lower = stem.toLowerCase();
  if (IGNORED_BASENAMES.has(lower)) return;
  if (stem.length < MIN_FILENAME_STEM_LENGTH && !ALLOWED_SHORT_STEMS.has(lower)) {
    const tpl = VIOLATION_TPLS.NAME_SHORT;
    nomenclatureViolations.push(
      createViolation({
        ruleId: RULE_HYG_NAM_001,
        file,
        message: `文件名过短 (< ${MIN_FILENAME_STEM_LENGTH} 字符，缺乏语义描述): ${file}`,
        actual: `${stem.length} chars`,
        expected: tpl.expected,
        actionableFix: tpl.actionableFix,
      }),
    );
    return;
  }
  if (stem.length > MAX_FILENAME_STEM_LENGTH) {
    const tpl = VIOLATION_TPLS.NAME_LONG;
    nomenclatureViolations.push(
      createViolation({
        ruleId: RULE_HYG_NAM_001,
        file,
        message: `文件名过长 (> ${MAX_FILENAME_STEM_LENGTH} 字符，建议按子目录解耦): ${file}`,
        actual: `${stem.length} chars`,
        expected: tpl.expected,
        actionableFix: tpl.actionableFix,
      }),
    );
  }
  validateFilenameSegments(file, stem, nomenclatureViolations);
}

/**
 * Validates cross-platform line ending contract (.ps1 must be CRLF, others must be LF).
 *
 * @param {string} file - Relative file path.
 * @param {Buffer} buffer - Raw file byte buffer.
 * @param {Array} lineEndingViolations - Collector array for LINE-ENDING findings.
 */
function validateFileEol(file, buffer, lineEndingViolations) {
  const hasCR = buffer.includes(BYTE_CR);
  if (file.endsWith('.ps1') && !hasCR) {
    lineEndingViolations.push(
      createViolation({
        ruleId: RULE_HYG_EOL_001,
        file,
        message: `PowerShell 脚本必须使用 CRLF 换行符: ${file}`,
        actual: EOL_LF,
        expected: EOL_CRLF,
        actionableFix: VIOLATION_TPLS.EOL_PS1.actionableFix,
      }),
    );
  } else if (hasCR && /\.(?:sh|ts|tsx|js|jsx|mjs|cjs|gd|json|md|py|rs|ya?ml|toml|css|html|svg)$/i.test(file)) {
    lineEndingViolations.push(
      createViolation({
        ruleId: RULE_HYG_EOL_001,
        file,
        message: `代码/文档必须使用 LF 换行符，检测到 CRLF: ${file}`,
        actual: EOL_CRLF,
        expected: EOL_LF,
        actionableFix: VIOLATION_TPLS.EOL_LF.actionableFix,
      }),
    );
  }
}

/**
 * Validates dual-scale volume budgets (ELOC <= 900, LOC <= 1400) on staged source files.
 *
 * @param {string} file - Relative file path.
 * @param {string} content - Raw text content of the file.
 * @param {Array} volumeViolations - Collector array for VOLUME-BUDGET findings.
 */
/**
 * Rejects UTF-8 BOM prefixes on staged text files.
 *
 * @param {Buffer} buffer - Raw staged bytes.
 * @param {string} file - Relative file path.
 * @param {Array} violations - Collector array.
 * @returns {void}
 */
function validateFileBom(buffer, file, violations) {
  const hasBom =
    buffer.length >= 3 &&
    buffer[0] === BYTE_BOM[0] &&
    buffer[1] === BYTE_BOM[1] &&
    buffer[2] === BYTE_BOM[2];
  if (!hasBom) return;
  violations.push(
    createViolation({
      ruleId: 'HYG-BOM-001',
      file,
      message: `检测到 UTF-8 BOM 前缀，必须为 NO-BOM: ${file}`,
      actual: 'UTF-8 with BOM',
      expected: 'UTF-8 without BOM',
      actionableFix: '以 UTF-8 无 BOM 重新保存该文件',
    }),
  );
}

/**
 * Enforces a single POSIX terminal newline without trailing blank lines.
 *
 * @param {string} content - Decoded staged content.
 * @param {string} file - Relative file path.
 * @param {Array} violations - Collector array.
 * @returns {void}
 */
function validateFileTerminalNewline(content, file, violations) {
  const missing = !content.endsWith('\n') && !content.endsWith('\r');
  const multiple = /\n[ \t]*\n[ \t]*$/.test(content);
  if (!missing && !multiple) return;
  violations.push(
    createViolation({
      ruleId: 'HYG-TRL-001',
      file,
      message: missing ? `文件末尾缺少 POSIX 换行: ${file}` : `文件末尾存在多余空行: ${file}`,
      actual: missing ? 'missing terminal newline' : 'multiple trailing newlines',
      expected: 'exactly one terminal newline',
      actionableFix: '保留且仅保留一个文件末尾换行符',
    }),
  );
}

/**
 * Rejects tab indentation outside GDScript and Makefile.
 *
 * @param {string} file - Relative file path.
 * @param {string} content - Decoded staged content.
 * @param {Array} violations - Collector array.
 * @returns {void}
 */
function validateFileIndent(file, content, violations) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.gd' || path.basename(file) === 'Makefile') return;
  if (!content.includes('\t')) return;
  violations.push(
    createViolation({
      ruleId: 'HYG-IND-001',
      file,
      message: `非 GDScript 文件出现 Tab 缩进: ${file}`,
      actual: 'tab indentation',
      expected: 'space indentation only',
      actionableFix: '将 Tab 替换为空格（TS 4 个，其余 2 个）',
    }),
  );
}

/**
 * Detects comment-only hollow files after stripping language comment syntax.
 *
 * @param {string} file - Relative file path.
 * @param {string} content - Decoded staged content.
 * @param {Array} violations - Collector array.
 * @returns {void}
 */
function validateCommentOnly(file, content, violations) {
  const ext = path.extname(file).toLowerCase();
  if (!COMMENT_CHECK_EXTENSIONS.has(ext)) return;
  let text = content;
  if (ext === '.ps1') text = text.replace(/<#[\s\S]*?#>/g, '');
  if (HASH_COMMENT_EXTENSIONS.has(ext) || ext === '.ps1') {
    text = text.replace(/"""[\s\S]*?"""/g, '').replace(/'''[\s\S]*?'''/g, '');
    text = text.replace(/(^|\n)[ \t]*#.*?(?=\n|$)/g, '\n');
  } else {
    text = text.replace(/\/\*[\s\S]*?\*\//g, '');
    text = text.replace(/(^|\n)[ \t]*\/\/.*?(?=\n|$)/g, '\n');
  }
  if (text.trim().length > 0) return;
  violations.push(
    createViolation({
      ruleId: 'HYG-EMP-002',
      file,
      message: `发现纯注释空壳文件（剥离注释后无有效代码）: ${file}`,
      actual: 'comment-only payload',
      expected: 'executable or type declarations',
      actionableFix: '补充实质代码或删除该空壳文件',
    }),
  );
}

/**
 * Collects advisory indent-width warnings for TS/JS files (non-blocking).
 *
 * @param {string} file - Relative file path.
 * @param {string} content - Decoded staged content.
 * @param {Array} warnings - Collector array.
 * @returns {void}
 */
function collectIndentWidthWarnings(file, content, warnings) {
  const ext = path.extname(file).toLowerCase();
  const width = INDENT_WIDTH_BY_EXT[ext];
  if (!width) return;
  const lines = content.split(/\r?\n/);
  let reported = 0;
  for (let index = 0; index < lines.length && reported < MAX_INDENT_WARNINGS_PER_FILE; index += 1) {
    if (/^\s*(?:\*|\/\/|#)/.test(lines[index])) continue;
    const previous = index > 0 ? lines[index - 1].trimEnd() : '';
    if (/[+,[(=?:&|]$/.test(previous)) continue;
    const match = lines[index].match(/^( +)\S/);
    if (!match) continue;
    if (match[1].length % width === 0) continue;
    warnings.push({ file, line: index + 1, actual: `${match[1].length} spaces`, expected: `multiple of ${width}` });
    reported += 1;
  }
}

function isPlumbingExemptFast(file) {
  const norm = file.replace(/\\/g, '/').toLowerCase();
  const base = path.basename(norm);
  if (base.startsWith('index.')) return true;
  if (norm.endsWith('.d.ts')) return true;
  if (base.endsWith('_types.gd') || base.endsWith('_types.ts') || base.endsWith('-types.ts')) return true;
  if (/(?:\/constants\/|\/tokens\/|\/locales\/|\/i18n\/|\/types\/)/.test(norm)) return true;
  if (/(?:tests\/|\.test\.|\.spec\.|test_)/i.test(norm)) return true;
  return false;
}

function validateFileVolume(file, content, volumeViolations) {
  const norm = file.replace(/\\/g, '/');
  if (
    !/\.(?:ts|gd|js|py|sh|ps1|mjs|cjs)$/i.test(file) ||
    /(?:dist\/|out\/|fixtures\/|baseline|reports\/|\.d\.ts$|corpus)/.test(norm)
  ) {
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const { totalLoc, eloc, wiringCount } = calculateEloc(content, ext);
  if (eloc > MAX_ELOC_BUDGET) {
    const tpl = VIOLATION_TPLS.VOL_ELOC;
    volumeViolations.push(
      createViolation({
        ruleId: RULE_VOL_ELOC_001,
        file,
        message: `单文件有效行数超标 (${eloc} > ${MAX_ELOC_BUDGET} ELOC): ${file}`,
        actual: `ELOC = ${eloc}`,
        expected: tpl.expected,
        actionableFix: tpl.actionableFix,
      }),
    );
  }
  if (totalLoc > MAX_LOC_BUDGET) {
    const tpl = VIOLATION_TPLS.VOL_LOC;
    volumeViolations.push(
      createViolation({
        ruleId: RULE_VOL_LOC_001,
        file,
        message: `单文件行数超标 (${totalLoc} > ${MAX_LOC_BUDGET} LOC): ${file}`,
        actual: `LOC = ${totalLoc}`,
        expected: tpl.expected,
        actionableFix: tpl.actionableFix,
      }),
    );
  }

  if (isPlumbingExemptFast(file)) {
    return;
  }

  if (totalLoc >= 250 && eloc > 0 && totalLoc > eloc * DENSITY_RATIO_LIMIT) {
    const actualRatio = (totalLoc / eloc).toFixed(2);
    volumeViolations.push(
      createViolation({
        ruleId: RULE_VOL_RATIO_001,
        file,
        message: `垂直行稀释比超标 (LOC: ${totalLoc} > ELOC: ${eloc} * ${DENSITY_RATIO_LIMIT} = ${Math.round(eloc * DENSITY_RATIO_LIMIT)}, 比例 1:${actualRatio}): ${file}`,
        actual: `1:${actualRatio}`,
        expected: `<= 1:${DENSITY_RATIO_LIMIT.toFixed(2)}`,
        actionableFix: '消除空行堆叠或将长篇散文注释移至 Markdown 规范文档 (VOL-RATIO-001)',
      }),
    );
  }

  if (eloc >= 10 && wiringCount / eloc > PLUMBING_RATIO_LIMIT) {
    const wiringPct = ((wiringCount / eloc) * 100).toFixed(1);
    volumeViolations.push(
      createViolation({
        ruleId: RULE_ARCH_FAC_001,
        file,
        message: `接线代码占比超标 (${wiringPct}% > ${(PLUMBING_RATIO_LIMIT * 100).toFixed(1)}%, ELOC: ${eloc}): ${file}`,
        actual: `${wiringPct}%`,
        expected: `<= ${(PLUMBING_RATIO_LIMIT * 100).toFixed(1)}%`,
        actionableFix: '消除空心透传跳板或为门面注入实质领域能力/不可变性冻结 (ARCH-FAC-001)',
      }),
    );
  }
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
  let eolBuffer = buffer;
  if (useIndex) {
    try {
      eolBuffer = fs.readFileSync(path.resolve(repoRoot, file));
    } catch {
      eolBuffer = buffer;
    }
  }
  validateFileEol(file, eolBuffer, collectors.gate2);
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
    console.log(`  ✔ PASS  ${spec.id}  ${spec.name}`);
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
    logSingleGateResult(GATE_SPECS[i], violationsByGate[i]);
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

function runFastStaged() {
  const { isAgentMode, range, explicitFiles, useIndex } = parseRunArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '../..');
  const stagedFiles = getStagedFiles(repoRoot, explicitFiles);

  const { gate1Violations, lineEndingViolations, nomenclatureViolations, volumeViolations, warnings } =
    checkFileStream(repoRoot, stagedFiles, useIndex);

  if (stagedFiles.length === 0 && gate1Violations.length === 0 && nomenclatureViolations.length === 0) {
    if (isAgentMode) {
      console.log(
        JSON.stringify(
          {
            protocolVersion: PROTOCOL_VERSION,
            status: STATUS_PASS,
            gate: FAST_STAGED_GATE,
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

  const diffText = getStagedDiff(repoRoot, range);
  const { gate3Violations, gate6Violations } = checkDiffStream(diffText);

  const allViolations = [
    ...gate1Violations,
    ...lineEndingViolations,
    ...gate3Violations,
    ...nomenclatureViolations,
    ...volumeViolations,
    ...gate6Violations,
  ];

  if (allViolations.length > 0) {
    const { writeFailureSnapshot } = require('./log-rotator');
    const envelope = {
      gate: FAST_STAGED_GATE,
      step: STEP_NAME,
      failedCommand: SCRIPT_NAME,
      exitCode: 1,
      summary: `Fast staged check blocked commit due to ${allViolations.length} physical hygiene or security violations.`,
      violations: allViolations,
      warnings: warnings.slice(0, 20),
      targetFiles: Array.from(new Set(allViolations.map((v) => v.file).filter(Boolean))),
      verificationCommand: SCRIPT_NAME,
    };
    writeFailureSnapshot(envelope);

    if (isAgentMode) {
      console.log(JSON.stringify(envelope, null, 2));
      process.exit(1);
    }

    reportHumanViolations([
      gate1Violations,
      lineEndingViolations,
      gate3Violations,
      nomenclatureViolations,
      volumeViolations,
      gate6Violations,
    ]);
    process.exit(1);
  }

  if (isAgentMode) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: PROTOCOL_VERSION,
          status: STATUS_PASS,
          gate: FAST_STAGED_GATE,
          summary: 'All fast-staged hygiene and security checks passed.',
          warnings: warnings.slice(0, 20),
        },
        null,
        2,
      ),
    );
  } else {
    for (const spec of GATE_SPECS) {
      console.log(`  ✔ PASS  ${spec.id}  ${spec.name}`);
    }
    if (warnings.length > 0) {
      console.warn(`  ⚠ [WARN] ${warnings.length} 处缩进宽度不符合契约（仅告警，不阻断）`);
      for (const item of warnings.slice(0, 5)) {
        console.warn(`     ${item.file}:${item.line} ${item.actual} != ${item.expected}`);
      }
    }
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
