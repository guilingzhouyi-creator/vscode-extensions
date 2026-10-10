/**
 * Module: Commit Message Style, Tone and Text Constraint Verifier
 * File Path: scripts/common/validate-commit-msg-style.js
 * Architecture Role: Validates that Git commit messages strictly convey objective technical facts
 *   and do not contain temporary/casual phrasing, hyperbolic/absolute claims, derogatory negativity,
 *   or meta-narrative slogans (bilingual enforcement: Chinese and English).
 * Dependencies & Triggers: Invoked by commit-msg-gate.sh, commit-msg-gate.ps1, pre-push gates, and CI.
 * Exit Semantics: Exits 0 on compliance, 1 on prohibited terms.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const TERMS_FILE = path.join(__dirname, 'commit-msg-forbidden-terms.json');

function loadTermsConfig() {
  if (!fs.existsSync(TERMS_FILE)) {
    throw new Error(`Forbidden terms configuration not found: ${TERMS_FILE}`);
  }
  return JSON.parse(fs.readFileSync(TERMS_FILE, 'utf8'));
}

/**
 * Strips code blocks, quotes, and whitelisted technical terms to prevent false positives.
 * @param {string} line
 * @param {string[]} whitelist
 * @returns {string} Sanitized line for tone/term checking
 */
function sanitizeLineForChecking(line, whitelist) {
  let sanitized = line;

  // 1. Mask inline code blocks `...`
  sanitized = sanitized.replace(/`[^`]+`/g, ' __CODE_SPAN__ ');

  // 2. Mask registered/standard rule IDs (e.g. CMG-STY-001, ADV-PRF-002)
  sanitized = sanitized.replace(/\b[A-Z]{2,4}-[A-Z0-9]+-[0-9]{3}\b/g, ' __RULE_ID__ ');

  // 3. Mask explicit external quotes "..." and “...”
  sanitized = sanitized.replace(/"[^"]+"/g, ' __QUOTE_SPAN__ ');
  sanitized = sanitized.replace(/“[^”]+”/g, ' __QUOTE_SPAN__ ');

  // 4. Mask whitelisted technical compound terms
  for (const term of whitelist) {
    if (!term) continue;
    if (/^[a-zA-Z\s-]+$/.test(term)) {
      const reg = new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}\\b`, 'gi');
      sanitized = sanitized.replace(reg, ' __WHITELIST_TERM__ ');
    } else {
      sanitized = sanitized.split(term).join(' __WHITELIST_TERM__ ');
    }
  }

  return sanitized;
}

/**
 * Checks a sanitized line against literal Chinese/substring patterns of a rule.
 */
function checkPatternMatch(sanitizedLine, rawLine, lineNum, rule) {
  const matches = [];
  if (!Array.isArray(rule.patterns)) return matches;

  for (const pattern of rule.patterns) {
    if (!pattern || !sanitizedLine.includes(pattern)) continue;
    matches.push({
      lineNum,
      rawLine: rawLine.trim(),
      ruleId: rule.id,
      category: rule.category,
      term: pattern,
      reason: rule.reason,
      guidance: rule.guidance,
    });
  }
  return matches;
}

/**
 * Checks a sanitized line against ASCII regex patterns of a rule.
 */
function checkAsciiMatch(sanitizedLine, rawLine, lineNum, rule) {
  const matches = [];
  if (!Array.isArray(rule.asciiPatterns)) return matches;

  for (const asciiPat of rule.asciiPatterns) {
    if (!asciiPat) continue;
    // If the ASCII pattern consists exclusively of uppercase letters/boundary symbols (e.g. \b(PASS|PASSED)\b),
    // enforce exact-case matching so legitimate lowercase uses are not falsely triggered.
    const unescaped = asciiPat.replace(/\\[a-zA-Z]/g, '');
    const isExactCase = Boolean(rule.caseSensitiveAscii || (!/[a-z]/.test(unescaped) && /[A-Z]/.test(unescaped)));
    const flags = isExactCase ? '' : 'i';
    const match = sanitizedLine.match(new RegExp(asciiPat, flags));
    if (!match) continue;
    matches.push({
      lineNum,
      rawLine: rawLine.trim(),
      ruleId: rule.id,
      category: rule.category,
      term: match[0],
      reason: rule.reason,
      guidance: rule.guidance,
    });
  }
  return matches;
}

/**
 * Masks legitimate technical tokens (rule IDs, file paths, command names, flags, Git SHAs)
 * so they are not mistaken for execution numbers.
 */
function maskLegitimateTechnicalTokens(line) {
  let masked = line;
  // Mask URLs
  masked = masked.replace(/https?:\/\/[^\s)]+/g, ' __URL__ ');
  // Mask registered rule IDs: e.g. CMG-STY-005, ADV-CMP-001, L0-COMPILE, L0~L5
  masked = masked.replace(/\b[A-Z]{2,4}-[A-Z0-9]+-[0-9]{3}\b/g, ' __RULE_ID__ ');
  masked = masked.replace(/\bL[0-5](?:-[A-Z0-9]+)?\b/g, ' __RULE_ID__ ');
  masked = masked.replace(/\bL[0-5]~L[0-5]\b/g, ' __RULE_ID__ ');
  // Mask standard protocol/encodings: e.g. UTF-8, SHA-256, RFC-123
  masked = masked.replace(/\b(?:UTF|SHA|RFC|HTTP|TLS|AES)-\d+\b/g, ' __STD_TOKEN__ ');
  // Mask file paths with extensions or directory paths (e.g. scripts/ps1/pre-commit-gate.ps1)
  masked = masked.replace(/[a-zA-Z0-9_\-\.\/]+\.(?:ps1|sh|ts|js|json|md|py|gd|rs|toml|yaml|yml|html|css|txt)\b/g, ' __FILE_PATH__ ');
  masked = masked.replace(/\bscripts\/(?:ps1|sh|common)\/[a-zA-Z0-9_\-\.\/]+\b/g, ' __FILE_PATH__ ');
  // Mask command binaries: e.g. python3, node.exe
  masked = masked.replace(/\b(?:python|node|pwsh|powershell|bash|sh|git)\d*(?:\.exe)?\b/gi, ' __BIN__ ');
  // Mask CLI flags: e.g. --max-eloc, -F, --test
  masked = masked.replace(/--[a-zA-Z0-9_\-]+/g, ' __FLAG__ ');
  masked = masked.replace(/-[a-zA-Z0-9]\b/g, ' __FLAG__ ');
  // Mask Git commit SHA hashes: e.g. db02361, f990985
  masked = masked.replace(/\b[0-9a-f]{7,40}\b/g, ' __GIT_SHA__ ');
  return masked;
}

/**
 * Checks a line in the execution/verification section for prohibited execution numbers and statistics.
 */
function checkExecutionSectionNumeric(rawLine, lineNum, rule) {
  const matches = [];
  if (!rule) return matches;

  const masked = maskLegitimateTechnicalTokens(rawLine);
  const foundTerms = [];

  // 1. Ratios: e.g. 1:3, 1:1.78
  const ratioMatches = masked.match(/\b\d+(\.\d+)?\s*:\s*\d+(\.\d+)?\b/g);
  if (ratioMatches) foundTerms.push(...ratioMatches);

  // 2. Percentages: e.g. 100%, 99.5%
  const pctMatches = masked.match(/\b\d+(\.\d+)?\s*[%％]/g);
  if (pctMatches) foundTerms.push(...pctMatches);

  // 3. Numbers with units/quantifiers
  const unitMatches = masked.match(/\b\d+(\.\d+)?\s*(?:个|项|套|组|条|行|次|分|秒|s|ms|ELOC|LOC|个文件|个用例|个检查项|套套件|组用例|套测试|大项|个测试|个类|个函数)\b/g);
  if (unitMatches) foundTerms.push(...unitMatches);

  // 4. Standalone numbers / integers / floats
  const numMatches = masked.match(/\b\d+(\.\d+)?\b/g);
  if (numMatches) {
    for (const n of numMatches) {
      if (!foundTerms.includes(n)) foundTerms.push(n);
    }
  }

  // 5. Chinese numbers with execution quantifiers
  const cnMatches = masked.match(/[零一两二三四五六七八九十百千万]+\s*(?:个|项|套|组|条|行|次|套件|用例|检查项|大项|个文件|个用例|个场景|组用例|组边界)/g);
  if (cnMatches) foundTerms.push(...cnMatches);

  for (const term of foundTerms) {
    matches.push({
      lineNum,
      rawLine: rawLine.trim(),
      ruleId: rule.id,
      category: rule.category,
      term,
      reason: rule.reason,
      guidance: rule.guidance,
    });
  }
  return matches;
}

/**
 * Checks a commit message string for prohibited terms and execution numeric rules.
 * @param {string} content - Full commit message
 * @returns {{ valid: boolean, findings: Array<{ lineNum: number, rawLine: string, ruleId: string, category: string, term: string, reason: string, guidance: string }> }}
 */
function validateCommitMessageContent(content) {
  const config = loadTermsConfig();
  const rules = config.rules || config.forbiddenRules || [];
  const whitelist = config.whitelist || [];
  const rule6 = rules.find((r) => r.id === 'CMG-STY-006');

  const lines = content.split(/\r?\n/);
  const findings = [];
  let inExecutionSection = false;

  const EXECUTION_HEADER_REGEX = /^\s*(?:\[|#{1,4}\s*|\b)(?:Verification|Execution|验证|执行|测试)(?:[\s\/\]:]|$)/i;
  const OTHER_HEADER_REGEX = /^\s*(?:\[|#{1,4}\s*|\b)(?:Project|Why|Added|Changed|Fixed|Removed|Refactor|Docs|Chore|项目|项目归属|动机|背景|新增|变更|修改|修复|删除)(?:[\s\/\]:]|$)/i;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (/^\s*#/.test(rawLine) || !rawLine.trim()) continue;

    if (EXECUTION_HEADER_REGEX.test(rawLine)) {
      inExecutionSection = true;
      continue;
    } else if (OTHER_HEADER_REGEX.test(rawLine)) {
      inExecutionSection = false;
    }

    const sanitizedLine = sanitizeLineForChecking(rawLine, whitelist);

    for (const rule of rules) {
      findings.push(...checkPatternMatch(sanitizedLine, rawLine, i + 1, rule));
      findings.push(...checkAsciiMatch(sanitizedLine, rawLine, i + 1, rule));
    }

    if (inExecutionSection && rule6) {
      findings.push(...checkExecutionSectionNumeric(rawLine, i + 1, rule6));
    }
  }

  return {
    valid: findings.length === 0,
    findings,
  };
}

/**
 * Formats findings into an informative diagnostic block.
 * @param {Array} findings
 * @returns {string}
 */
function formatDiagnosticReport(findings) {
  const lines = [];
  lines.push('=================================================================');
  lines.push('❌ [COMMIT-MSG-GATE] 命中提交信息文本约束违规 (Style & Tone Violation)');
  lines.push('=================================================================');

  const seen = new Set();
  for (const f of findings) {
    const key = `${f.lineNum}:${f.ruleId}:${f.term}`;
    if (seen.has(key)) continue;
    seen.add(key);

    lines.push(`📍 违规位置: 第 ${f.lineNum} 行 [规则 ${f.ruleId} / ${f.category}]`);
    lines.push(`🔍 所在行内容: "${f.rawLine}"`);
    lines.push(`🚫 命中禁用词: [${f.term}]`);
    lines.push(`💡 违规原因: ${f.reason}`);
    lines.push(`✏️ 推荐修改: ${f.guidance}`);
    lines.push('-----------------------------------------------------------------');
  }

  lines.push('📌 核心准则: 提交说明是长期技术档案，必须纯粹陈述客观技术事实与具体文件逻辑改动。');
  lines.push('   严禁使用临时性/敷衍用语、绝对化夸大/吹嘘词汇或“低调中肯/求真务实”等元叙事口号（中英双语同构拦截）。');
  lines.push('   执行标签区域（[Verification]）严禁出现任何形式的执行数字、用例计数、行数、比例或百分比流水账（CMG-STY-006）。');
  lines.push('=================================================================');
  return lines.join('\n');
}

const TEST_CASES = [
  {
    name: 'CAT-06 Arabic Execution Numbers in Verification (17 组用例 / 419 个文件)',
    msg: 'refactor(gate): 更新检查规则\n\n[Verification]\n- 执行 node test.js，断言 17 组用例成立并覆盖 419 个文件。',
    expectRule: 'CMG-STY-006',
    expectValid: false,
  },
  {
    name: 'CAT-06 Execution Numbers and Ratios in Verification (763 ELOC / 1:1.78)',
    msg: 'refactor(gate): 更新规则\n\n[Verification]\n- 断言单文件规模为 763 ELOC，平均稀释比 1:1.78。',
    expectRule: 'CMG-STY-006',
    expectValid: false,
  },
  {
    name: 'CAT-06 Chinese Execution Numbers with Quantifiers (三组用例与两个场景)',
    msg: 'refactor(gate): 更新规则\n\n[Verification]\n- 验证通过三组用例并覆盖两个边界场景。',
    expectRule: 'CMG-STY-006',
    expectValid: false,
  },
  {
    name: 'CAT-06 Whitelist in Verification (Rule IDs and .ps1 extension)',
    msg: 'refactor(gate): 更新规则\n\n[Verification]\n- 执行 pwsh scripts/ps1/commit-msg-gate.ps1，验证 CMG-STY-005 与 L0~L5 规则解析成立。',
    expectValid: true,
  },
  {
    name: 'CAT-01 Chinese (临时)',
    msg: 'fix: 临时修复空指针\n\n[Why]\n- 临时顶一下',
    expectRule: 'CMG-STY-001',
    expectValid: false,
  },
  {
    name: 'CAT-02 Chinese (绝对/完美)',
    msg: 'feat: 彻底完美解决所有并发崩溃\n\n[Why]\n- 打造工业级架构',
    expectRule: 'CMG-STY-002',
    expectValid: false,
  },
  {
    name: 'CAT-03 Chinese (垃圾)',
    msg: 'refactor: 重构一团糟的垃圾代码',
    expectRule: 'CMG-STY-003',
    expectValid: false,
  },
  {
    name: 'CAT-04 Chinese (元叙事标语)',
    msg: 'docs(readme): 调整整体文案语调为低调中肯、求真务实，移除宣扬性词汇',
    expectRule: 'CMG-STY-004',
    expectValid: false,
  },
  {
    name: 'CAT-01 English (quick fix/for now)',
    msg: 'fix(api): quick and dirty hack for now',
    expectRule: 'CMG-STY-001',
    expectValid: false,
  },
  {
    name: 'CAT-02 English (ultimate/bulletproof)',
    msg: 'feat(core): deliver ultimate bulletproof architecture with 100% reliable engine',
    expectRule: 'CMG-STY-002',
    expectValid: false,
  },
  {
    name: 'CAT-03 English (complete mess/disaster)',
    msg: 'refactor(db): rewrite complete mess and disaster of old schema',
    expectRule: 'CMG-STY-003',
    expectValid: false,
  },
  {
    name: 'CAT-04 English (tone down/humble/pragmatic)',
    msg: 'docs(readme): tone down wording to be humble and pragmatic, remove boastful words',
    expectRule: 'CMG-STY-004',
    expectValid: false,
  },
  {
    name: 'CAT-05 Chinese (退出码与项检查流水账)',
    msg: 'refactor(gate): 更新检查规则\n\n[Verification]\n- 6 项检查均返回退出码 0，双端脚本均返回 0。',
    expectRule: 'CMG-STY-005',
    expectValid: false,
  },
  {
    name: 'CAT-05 English (exit code 0 / all checks passed)',
    msg: 'refactor(gate): update rules\n\n[Verification]\n- all 9 checks passed with exit code 0 without errors.',
    expectRule: 'CMG-STY-005',
    expectValid: false,
  },
  {
    name: 'Whitelist Chinese (绝对路径/临时文件)',
    msg: 'fix(path): 修复跨平台文件查找未能转换为绝对路径的问题\n\n[Why]\n- `createTempFile` 生成的临时文件需支持绝对路径。\n\n[Verification]\n- 运行单元测试套件。',
    expectValid: true,
  },
  {
    name: 'Whitelist English (absolute path/temporary directory)',
    msg: 'fix(path): resolve absolute path for temporary directory cleanup\n\n[Why]\n- Ensure clean workspace directory removal.',
    expectValid: true,
  },
  {
    name: 'Whitelist English (two-pass/pass parameters/pass through)',
    msg: 'feat(compiler): implement two-pass syntax analysis and pass parameters by reference\n\n[Verification]\n- Execute test-parallel runner covering regression suites.',
    expectValid: true,
  },
  {
    name: 'Whitelist Chinese (单趟扫描与透传参数)',
    msg: 'feat(core): 实现单趟语法审查并在模块间透传配置上下文\n\n[Verification]\n- 执行 node scripts/test-parallel.js 运行回归套件。',
    expectValid: true,
  },
  {
    name: 'Normal Chinese Technical Fact (通过验证与测试复现)',
    msg: 'fix(parser): 修复空指针异常\n\n[Why]\n- 防止非法输入导致崩溃。\n\n[Changed]\n- 通过验证配置项的存在性保证系统稳定运行，增加类型守卫。\n- 通过测试用例重现边界情况并修复。\n\n[Verification]\n- 运行 node scripts/test-parallel.js 回归测试。',
    expectValid: true,
  },
  {
    name: 'Normal English Technical Fact (passing options and arguments)',
    msg: 'feat(stream): support passing custom options to worker pool\n\n[Why]\n- Allow configurable buffer sizing.\n\n[Changed]\n- Handle passing options to downstream handlers.\n\n[Verification]\n- Run vitest unit tests across modified worker routines.',
    expectValid: true,
  },
  {
    name: 'Valid Technical Fact',
    msg: 'docs(readme): 更新各子模块状态标注并补充实验性质说明\n\n[Why]\n- 准确说明模块开发阶段。\n\n[Changed]\n- 更新 README.md 中的项目矩阵说明。\n\n[Verification]\n- 运行本地预审脚本。',
    expectValid: true,
  },
];

function runSingleTestCase(tc) {
  const res = validateCommitMessageContent(tc.msg);
  if (tc.expectValid && !res.valid) {
    throw new Error(`自检失败: 合法用例 [${tc.name}] 被误拦截: ` + JSON.stringify(res.findings));
  }
  if (!tc.expectValid) {
    const hasExpectedRule = res.findings.some((f) => f.ruleId === tc.expectRule);
    if (res.valid || !hasExpectedRule) {
      throw new Error(`自检失败: 违规用例 [${tc.name}] 未被预期规则 [${tc.expectRule}] 拦截`);
    }
  }
}

function runSelfTest() {
  console.log('🧪 运行 validate-commit-msg-style 自检测试套件...');
  for (const tc of TEST_CASES) {
    runSingleTestCase(tc);
  }
  console.log(`✔ 全部 ${TEST_CASES.length} 组中英双语风格自检用例验证通过`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--test')) {
    runSelfTest();
    process.exit(0);
  }

  if (args.length === 0) {
    console.error('用法: node validate-commit-msg-style.js <commit-msg-file-path> 或 --test');
    process.exit(1);
  }

  const filePath = args[0];
  let content = '';

  if (filePath === '-') {
    content = fs.readFileSync(0, 'utf8');
  } else {
    if (!fs.existsSync(filePath)) {
      console.error(`❌ [FAIL] 提交信息文件不存在: ${filePath}`);
      process.exit(1);
    }
    content = fs.readFileSync(filePath, 'utf8');
  }
  const result = validateCommitMessageContent(content);

  if (!result.valid) {
    console.error(formatDiagnosticReport(result.findings));
    process.exit(1);
  }

  console.log('  ✔ Rule 8: 提交文本求真务实与禁词审查合规 (中英双语零临时/零夸大/零贬损/零元叙事口号)');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  validateCommitMessageContent,
  formatDiagnosticReport,
  runSelfTest,
};
