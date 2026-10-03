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
    if (/^[a-zA-Z\s]+$/.test(term)) {
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
    const match = sanitizedLine.match(new RegExp(asciiPat, 'i'));
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
 * Checks a commit message string for prohibited terms.
 * @param {string} content - Full commit message
 * @returns {{ valid: boolean, findings: Array<{ lineNum: number, rawLine: string, ruleId: string, category: string, term: string, reason: string, guidance: string }> }}
 */
function validateCommitMessageContent(content) {
  const config = loadTermsConfig();
  const rules = config.rules || [];
  const whitelist = config.whitelist || [];

  const lines = content.split(/\r?\n/);
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (/^\s*#/.test(rawLine) || !rawLine.trim()) continue;

    const sanitizedLine = sanitizeLineForChecking(rawLine, whitelist);

    for (const rule of rules) {
      findings.push(...checkPatternMatch(sanitizedLine, rawLine, i + 1, rule));
      findings.push(...checkAsciiMatch(sanitizedLine, rawLine, i + 1, rule));
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
  lines.push('   严禁使用临时性/敷衍用语、绝对化夸大/吹嘘词汇或以“低调中肯/求真务实”等元叙事口号替代具体工作（中英双语同构拦截）。');
  lines.push('=================================================================');
  return lines.join('\n');
}

const TEST_CASES = [
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
    name: 'Whitelist Chinese (绝对路径/临时文件)',
    msg: 'fix(path): 修复跨平台文件查找未能转换为绝对路径的问题\n\n[Why]\n- `createTempFile` 生成的临时文件需支持绝对路径。\n\n[Verification]\n- 单元测试通过。',
    expectValid: true,
  },
  {
    name: 'Whitelist English (absolute path/temporary directory)',
    msg: 'fix(path): resolve absolute path for temporary directory cleanup\n\n[Why]\n- Ensure clean workspace directory removal.',
    expectValid: true,
  },
  {
    name: 'Valid Technical Fact',
    msg: 'docs(readme): 更新各子模块状态标注并补充实验性质说明\n\n[Why]\n- 准确说明模块开发阶段。\n\n[Changed]\n- 更新 README.md 中的项目矩阵说明。\n\n[Verification]\n- 本地预审通过。',
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
  console.log(`✔ 全部 ${TEST_CASES.length} 组中英双语风格自检用例（8 类中英拦截 + 3 类中英合规放行）100% 通过！`);
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

  console.log('  ✔ Rule 8: 提交文本求真务实与禁词审查通过 (中英双语零临时/零夸大/零元叙事口号)');
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
