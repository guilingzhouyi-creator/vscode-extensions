/**
 * Module: Governance Guard — Fast Staged Nomenclature, Rules & Violation Envelopes
 * File Path: scripts/common/lib/fast-staged-nomenclature.js
 * Architecture Role: Houses the staged rule catalog, violation message templates, Agent-Native
 *   blocking violation envelope builders, and filename/root-clutter validators consumed by
 *   lib/fast-staged-checks.js.
 * Dependencies & Triggers: Uses Node.js `path` and `QUALITY_BUDGET` from `./eloc-line-classifier`;
 *   consumed by scripts/common/lib/fast-staged-checks.js.
 * Responsibilities:
 *   1. Define canonical `RULES`, volume/nomenclature thresholds, and `VIOLATION_TPLS`;
 *   2. Build structured Agent-Native blocking violation payloads (`createViolation`);
 *   3. Enforce nomenclature hygiene (slang ban, morpheme validity, stem length/segments);
 *   4. Detect workspace clutter filenames and disallowed root-level script files.
 * Exit Semantics & Design Rationale: Pure diagnostic library returning or pushing violation
 *   records without mutating process exit state.
 */
'use strict';

const path = require('path');
const { QUALITY_BUDGET } = require('./eloc-line-classifier');

const RULES = Object.freeze({
  HYG_NAM_001: 'HYG-NAM-001',
  HYG_EOL_001: 'HYG-EOL-001',
  HYG_EMP_001: 'HYG-EMP-001',
  HYG_EMP_002: 'HYG-EMP-002',
  HYG_BOM_001: 'HYG-BOM-001',
  HYG_TRL_001: 'HYG-TRL-001',
  HYG_IND_001: 'HYG-IND-001',
  HYG_CLT_001: 'HYG-CLT-001',
  EXT_DIR_001: 'EXT-DIR-001',
  VOL_ELOC_001: 'VOL-ELOC-001',
  VOL_LOC_001: 'VOL-LOC-001',
  VOL_RATIO_001: 'VOL-RATIO-001',
  ARCH_FAC_001: 'ARCH-FAC-001',
  SEC_LEAK_001: 'SEC-LEAK-001',
  SEC_VUL_001: 'SEC-VUL-001',
});

const SEVERITY_BLOCK = 'BLOCK';
const MAX_ELOC_BUDGET = QUALITY_BUDGET.volume.maxEloc;
const MAX_LOC_BUDGET = QUALITY_BUDGET.volume.maxLoc;
const DENSITY_RATIO_LIMIT = QUALITY_BUDGET.volume.targetDensityRatio;
const PLUMBING_RATIO_LIMIT = QUALITY_BUDGET.density.maxPor;
const MIN_FILENAME_STEM_LENGTH = 3;
const MAX_FILENAME_STEM_LENGTH = 55;
const MAX_FILENAME_SEGMENTS_SRC = 5;
const MAX_FILENAME_SEGMENTS_TEST = 8;

const RE_EXEMPT_SLANG = /WebGames\/docs\/(?:路线图|归档库)\//;
const SLANG_FILENAME_PATTERN = /(?:^|[-_.])(?:temp|wip|new|st\d+|p\d+)(?:[-_.]|$)/i;
const CLUTTER_FILE_PATTERN =
  /^(?:Thumbs\.db|desktop\.ini|\.DS_Store|.*\.tmp|.*\.bak|.*\.orig|.*\.swp|.*\.actual\.json|.*\.log)$/i;
const ROOT_DISALLOWED_SCRIPT_EXTS = new Set(['.js', '.ts', '.py', '.sh', '.ps1', '.bat', '.cmd']);
const ALLOWED_SHORT_STEMS = new Set('ui en zh db io ci os vm fs re id ip gm'.split(' '));
const STANDARD_TECH_ABBREVIATIONS = new Set(
  ('ui db io os vm fs id ip ci cd sdk api cli ast cfg lut doc req res msg btn pkg src ctx fmt cmd ptr str ' +
   'std fps rng pr sh ps md ts js py gd rs 2d 3d 4k 5d ssl ssh tcp udp dns rpc ipc csr soa swar simd cc eloc loc gc ' +
   'diff rgb hex fn cb rx tx env app dev fsm npc gm rpg pve pvp hp mp cdc vs prf mcp ssot ir cai e2e wasm zh cn mcts vfs sm2 sm3 sm4 l1 l2 l3').split(' '),
);
const IGNORED_BASENAMES = new Set('index main lib mod api types cli readme changelog license'.split(' '));

const RAW_VIOLATION_TPLS = `SLANG_NAME|零黑话与规范命名 (禁止 temp/wip/new/stN/pN)|重命名文件以移除临时黑话标记
NAME_VOWEL|含元音语素或标准技术缩写|修正文件名单词拼写或使用标准技术缩写
NAME_SEGMENTS|按子目录分层重构文件名，减少连接词段数
NAME_SHORT|>= 3 chars|重命名文件以提供具有领域语义的描述名称
NAME_LONG|<= 55 chars|通过划分清晰子目录解耦超长文件名
EOL_PS1|CRLF|将该 PowerShell 脚本换行符转换为 CRLF
EOL_LF|LF|将该文件换行符转换为 LF
VOL_ELOC|ELOC <= ${MAX_ELOC_BUDGET}|消除冗余实现并提取子模块以控制 ELOC <= ${MAX_ELOC_BUDGET}
VOL_LOC|LOC <= ${MAX_LOC_BUDGET}|重构超大文件，按子领域解耦以控制 LOC <= ${MAX_LOC_BUDGET}
VOL_RATIO|垂直行稀释比超标 (totalLoc > eloc * ${DENSITY_RATIO_LIMIT.toFixed(1)})|消除空行堆叠或将长篇散文注释移至 Markdown 规范文档
ARCH_FAC|接线代码占比过高 (wiringRatio > ${(PLUMBING_RATIO_LIMIT * 100).toFixed(0)}%)|消除空心透传跳板或为门面注入实质领域能力/不可变性冻结
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
    if (parts.length === 5) acc[key] = { message: p1, actual: p2, expected: p3, actionableFix: p4 };
    else if (parts.length === 4) acc[key] = { actual: p1, expected: p2, actionableFix: p3 };
    else if (parts.length === 2) acc[key] = { actionableFix: p1 };
    else acc[key] = { expected: p1, actionableFix: p2 };
    return acc;
  }, {}),
);

/**
 * Constructs a structured violation payload adhering to the Agent Directives Protocol.
 *
 * @param {object} violation - Violation parameters.
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
 * Appends a violation backed by a registered template entry.
 *
 * @param {Array} bucket - Target violation collector array.
 * @param {{ ruleId: string, file: string, tpl: object, message: string, actual: string, expected?: string }} spec
 */
function pushTemplateViolation(bucket, { ruleId, file, tpl, message, actual, expected }) {
  bucket.push(createViolation({
    ruleId,
    file,
    message,
    actual,
    expected: expected !== undefined ? expected : tpl.expected,
    actionableFix: tpl.actionableFix,
  }));
}

function isExemptSlangPath(filePath, baseName) {
  const norm = filePath.replace(/\\/g, '/');
  return RE_EXEMPT_SLANG.test(norm) || /^fe_\d{2}/.test(baseName);
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
    pushTemplateViolation(nomenclatureViolations, {
      ruleId: RULES.HYG_NAM_001,
      file,
      tpl: VIOLATION_TPLS.SLANG_NAME,
      message: `文件名包含临时性违规黑话标记: ${file}`,
      actual: baseName,
    });
  }
}

/**
 * Determines whether a name segment contains valid vowel morphemes or approved technical acronyms.
 *
 * @param {string} seg - Substring word segment.
 * @returns {boolean} True if segment conforms to morpheme criteria.
 */
function isMorphemeValid(seg) {
  if (seg.length < 2 || /^\d+$/.test(seg)) return true;
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
  const maxSegments = /(?:tests\/|\.test\.|\.spec\.|test_)/i.test(norm) ? MAX_FILENAME_SEGMENTS_TEST : MAX_FILENAME_SEGMENTS_SRC;
  const cleanStem = stem.replace(/\.(?:test|spec)$/i, '').replace(/^test[_-]/i, '');
  const segments = cleanStem.split(/[-_]+/).filter(Boolean);
  if (segments.length > maxSegments) {
    pushTemplateViolation(nomenclatureViolations, {
      ruleId: RULES.HYG_NAM_001,
      file,
      tpl: VIOLATION_TPLS.NAME_SEGMENTS,
      message: `文件名单词段数过多 (> ${maxSegments} 段，过度堆叠): ${file}`,
      actual: `${segments.length} segments`,
      expected: `<= ${maxSegments} segments`,
    });
  }
  for (const seg of segments) {
    if (!isMorphemeValid(seg)) {
      pushTemplateViolation(nomenclatureViolations, {
        ruleId: RULES.HYG_NAM_001,
        file,
        tpl: VIOLATION_TPLS.NAME_VOWEL,
        message: `文件名单词段 '${seg}' 缺乏元音语素且非标准技术缩写: ${file}`,
        actual: seg,
      });
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
    pushTemplateViolation(nomenclatureViolations, {
      ruleId: RULES.HYG_NAM_001,
      file,
      tpl: VIOLATION_TPLS.NAME_SHORT,
      message: `文件名过短 (< ${MIN_FILENAME_STEM_LENGTH} 字符，缺乏语义描述): ${file}`,
      actual: `${stem.length} chars`,
    });
    return;
  }
  if (stem.length > MAX_FILENAME_STEM_LENGTH) {
    pushTemplateViolation(nomenclatureViolations, {
      ruleId: RULES.HYG_NAM_001,
      file,
      tpl: VIOLATION_TPLS.NAME_LONG,
      message: `文件名过长 (> ${MAX_FILENAME_STEM_LENGTH} 字符，建议按子目录解耦): ${file}`,
      actual: `${stem.length} chars`,
    });
  }
  validateFilenameSegments(file, stem, nomenclatureViolations);
}

/**
 * Checks clutter filenames and disallowed root-level script files uniformly.
 *
 * @param {string} file - File path or root file name.
 * @param {string} baseName - Basename of target file.
 * @param {boolean} isRootFile - Whether file resides directly in repo root.
 * @param {object} collectors - Violation bucket collectors.
 * @param {string} clutterMsg - Localized clutter violation message.
 * @param {string} rootScriptMsg - Localized root-script violation message.
 * @returns {boolean} True when file was flagged as clutter (caller should skip content reads).
 */
function checkClutterAndRootScript(file, baseName, isRootFile, collectors, clutterMsg, rootScriptMsg) {
  if (CLUTTER_FILE_PATTERN.test(baseName)) {
    if (!collectors.gate1.some((v) => v.file === file && v.ruleId === RULES.HYG_CLT_001)) {
      pushTemplateViolation(collectors.gate1, {
        ruleId: RULES.HYG_CLT_001, file, tpl: VIOLATION_TPLS.ROOT_CLUTTER, message: clutterMsg, actual: baseName,
      });
    }
    return true;
  }
  if (isRootFile && !baseName.startsWith('.') && ROOT_DISALLOWED_SCRIPT_EXTS.has(path.extname(baseName).toLowerCase())) {
    if (!collectors.gate4.some((v) => v.file === file && v.ruleId === RULES.EXT_DIR_001)) {
      pushTemplateViolation(collectors.gate4, {
        ruleId: RULES.EXT_DIR_001, file, tpl: VIOLATION_TPLS.ROOT_SCRIPT, message: rootScriptMsg, actual: file,
      });
    }
  }
  return false;
}

module.exports = Object.freeze({
  RULES,
  SEVERITY_BLOCK,
  MAX_ELOC_BUDGET,
  MAX_LOC_BUDGET,
  DENSITY_RATIO_LIMIT,
  PLUMBING_RATIO_LIMIT,
  RE_EXEMPT_SLANG,
  SLANG_FILENAME_PATTERN,
  CLUTTER_FILE_PATTERN,
  ROOT_DISALLOWED_SCRIPT_EXTS,
  ALLOWED_SHORT_STEMS,
  STANDARD_TECH_ABBREVIATIONS,
  IGNORED_BASENAMES,
  RAW_VIOLATION_TPLS,
  VIOLATION_TPLS,
  createViolation,
  pushTemplateViolation,
  validateFilenameSlang,
  isMorphemeValid,
  validateFilenameSegments,
  validateFilenameLength,
  checkClutterAndRootScript,
});
