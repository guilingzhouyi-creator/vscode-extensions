/**
 * Module: Commit Message Style, Tone and Text Constraint Verifier
 * File Path: scripts/common/validate-commit-msg-style.js
 * Architecture Role: Validates that Git commit messages strictly convey objective technical
 *   facts and do not contain temporary/casual phrasing, hyperbolic/absolute claims,
 *   derogatory negativity, or promotional slogans (bilingual: Chinese and English).
 * Dependencies & Triggers: Consumes commit-msg-forbidden-terms.json;
 *   invoked by commit-msg-gate.sh, commit-msg-gate.ps1, pre-push gates, and validate-commit-msg.
 * Responsibilities:
 *   1. Tokenize commit header and body sections, stripping code blocks and whitelisted symbols;
 *   2. Scan text against forbidden patterns (temporary, hyperbolic, derogatory, meta-slogans);
 *   3. Enforce technical factual assertions in verification blocks without execution counters;
 *   4. Render detailed diagnostic reports with violation guidance and suggested remediation.
 * Exit Semantics & Design Rationale: Exits 0 on compliance, 1 on prohibited terms.
 *   Maintains immutable, professional, high-density engineering archives without emotional noise.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeText } = require('./commit-tokenizer');
const { auditCommitStyleGuardrails } = require('./commit-style-arbiter');
const { evaluateDebtCorridor } = require('./tech-debt-corridor');
const { recordCommitGuardrailAudit } = require('./commit-guardrail-logger');

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

  // 1. Mask registered/standard rule IDs (e.g. CMG-STY-001, ADV-PRF-002)
  sanitized = sanitized.replace(/\b[A-Z]{2,4}(?:-[A-Z0-9]+){2,}\b/g, ' __RULE_ID__ ');

  // 2. Mask whitelisted technical compound terms only. Quoted spans and code spans
  //    are intentionally NOT masked: blanket masking allowed forbidden wording to
  //    bypass detection by wrapping it in quotes or backticks.
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
    // If the pattern consists exclusively of uppercase letters/boundary symbols (e.g. \bPASS\b),
    // enforce exact-case matching so legitimate lowercase uses are not falsely triggered.
    const unescaped = asciiPat.replace(/\\[a-zA-Z]/g, '');
    const isExactCase = Boolean(
      rule.caseSensitiveAscii || (!/[a-z]/.test(unescaped) && /[A-Z]/.test(unescaped))
    );
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
 * Masks legitimate technical tokens (rule IDs, file paths, command names, flags, Git SHAs,
 * and runtime versions) so they are not mistaken for execution numbers.
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
  // Mask runtime environments & language versions: e.g. Node 24, Python 3.12, PowerShell 7
  masked = masked.replace(
    /\b(?:Node(?:\.js)?|PowerShell|pwsh|Python|Godot|TypeScript|TS|Rust|Go|Java|ES)\s*(?:v)?\d+(?:\.\d+)*\b/gi,
    ' __ENV_VER__ '
  );
  // Mask standard semantic version tags: e.g. v1.2.3, v0.4.0
  masked = masked.replace(/\bv\d+\.\d+(?:\.\d+)?\b/gi, ' __SEMVER__ ');
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
 * Checks a line in the execution section for prohibited execution numbers and statistics.
 */
function checkExecutionSectionNumeric(rawLine, lineNum, rule) {
  const matches = [];
  if (!rule) return matches;

  const masked = maskLegitimateTechnicalTokens(rawLine);
  const foundTermsSet = new Set();

  // 1. Ratios: e.g. 1:3, 1:1.78
  const ratioMatches = masked.match(/\b\d+(\.\d+)?\s*:\s*\d+(\.\d+)?\b/g);
  if (ratioMatches) ratioMatches.forEach((m) => foundTermsSet.add(m));

  // 2. Percentages: e.g. 100%, 99.5%
  const pctMatches = masked.match(/\b\d+(\.\d+)?\s*[%％]/g);
  if (pctMatches) pctMatches.forEach((m) => foundTermsSet.add(m));

  // 3. Numbers with units/quantifiers
  const unitMatches = masked.match(/\b\d+(\.\d+)?\s*(?:个|项|套|组|条|行|次|分|秒|s|ms|ELOC|LOC|个文件|个用例|个检查项|套套件|组用例|套测试|大项|个测试|个类|个函数)\b/g);
  if (unitMatches) unitMatches.forEach((m) => foundTermsSet.add(m));

  // 4. Standalone numbers / integers / floats
  const numMatches = masked.match(/\b\d+(\.\d+)?\b/g);
  if (numMatches) {
    for (const n of numMatches) {
      foundTermsSet.add(n);
    }
  }

  // 5. Chinese numbers with execution quantifiers
  const cnMatches = masked.match(/[零一两二三四五六七八九十百千万]+\s*(?:个|项|套|组|条|行|次|套件|用例|检查项|大项|个文件|个用例|个场景|组用例|组边界)/g);
  if (cnMatches) cnMatches.forEach((m) => foundTermsSet.add(m));

  for (const term of foundTermsSet) {
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
 * Scans individual lines of a commit message against lexical patterns and numeric constraints.
 *
 * @param {string[]} lines - Split text lines of the commit message.
 * @param {string[]|undefined} maskedLines - Masked lines with code blocks redacted.
 * @param {Array<object>} rules - Active forbidden rules.
 * @param {string[]} whitelist - Allowed term exceptions.
 * @param {object|undefined} rule6 - Execution numeric forbidden rule (CMG-STY-006).
 * @returns {Array<object>} List of detected rule violation findings.
 */
function auditLinesLexicalRules(lines, maskedLines, rules, whitelist, rule6) {
  const EXECUTION_HEADER_REGEX = /^\s*(?:\[|#{1,4}\s*|\b)(?:Verification|Execution|验证|执行|测试)(?:[\s\/\]:]|$)/i;
  const OTHER_HEADER_REGEX = /^\s*(?:\[|#{1,4}\s*|\b)(?:Project|Why|Added|Changed|Fixed|Removed|Refactor|Docs|Chore|项目|项目归属|动机|背景|新增|变更|修改|修复|删除)(?:[\s\/\]:]|$)/i;

  const activeLexicalRules = rules.filter(
    (r) => r.id !== 'CMG-STY-007' && r.id !== 'CMG-STY-008' && r.id !== 'CMG-STY-006' && r.id !== 'CMG-PRJ-001'
  );

  const findings = [];
  let inExecutionSection = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (/^\s*#/.test(rawLine) || !rawLine.trim()) continue;

    // Skip lines inside multiline Markdown code blocks
    if (maskedLines && maskedLines[i] && maskedLines[i].includes('__CODE_BLOCK__')) {
      continue;
    }

    if (EXECUTION_HEADER_REGEX.test(rawLine)) {
      inExecutionSection = true;
      continue;
    }
    if (OTHER_HEADER_REGEX.test(rawLine)) {
      inExecutionSection = false;
    }

    const sanitizedLine = sanitizeLineForChecking(rawLine, whitelist);

    for (const rule of activeLexicalRules) {
      findings.push(...checkPatternMatch(sanitizedLine, rawLine, i + 1, rule));
      findings.push(...checkAsciiMatch(sanitizedLine, rawLine, i + 1, rule));
    }

    if (inExecutionSection && rule6) {
      findings.push(...checkExecutionSectionNumeric(rawLine, i + 1, rule6));
    }
  }

  return findings;
}

/**
 * Checks a commit message string for prohibited terms, execution numeric rules,
 * imperative mood contracts, and elastic technical debt corridor limits.
 *
 * @param {string} content - Full commit message
 * @param {object} [options={}] - Optional execution options (e.g. logDir, skipLog)
 * @returns {{ valid: boolean, isPermittedUnderCorridor: boolean, findings: Array<object>, guardrail: object, debtVerdict: object }}
 */
function validateCommitMessageContent(content, options = {}) {
  const normalized = normalizeText(content);
  const config = loadTermsConfig();
  const rules = config.rules || config.forbiddenRules || [];
  const whitelist = config.whitelist || [];
  const rule6 = rules.find((r) => r.id === 'CMG-STY-006');

  const lines = normalized.split(/\r?\n/);
  const findings = [];

  // 1. Structural style guardrail auditing (CMG-STY-007 imperative mood, CMG-STY-008 zero-POV, CMG-PRJ-001 nomenclature)
  const guardrailResult = auditCommitStyleGuardrails(normalized);
  findings.push(...guardrailResult.findings);

  // 2. Lexical & numeric constraint verification
  const maskedLines = guardrailResult.parsedStructure?.maskedLines;
  findings.push(...auditLinesLexicalRules(lines, maskedLines, rules, whitelist, rule6));

  // 3. Elastic High-Risk Technical Debt Corridor Evaluation
  const commitType = guardrailResult.parsedStructure?.type || '';
  const debtVerdict = evaluateDebtCorridor({
    findings,
    styleScore: guardrailResult.styleScore,
    commitType,
    logDir: options.logDir,
  });

  // 4. Centralized telemetry & audit logging (persists both clean passes and intercepted blocks)
  if (!options.skipLog) {
    recordCommitGuardrailAudit(
      {
        status: debtVerdict.status,
        styleScore: guardrailResult.styleScore,
        entropy: guardrailResult.entropy,
        tokenStats: {
          totalLines: lines.length,
          highDebtCount: guardrailResult.highDebtCount,
        },
        headerAudit: {
          type: guardrailResult.parsedStructure?.type || '',
          scope: guardrailResult.parsedStructure?.scope || '',
          summary: guardrailResult.parsedStructure?.summary || '',
        },
        debtCorridor: debtVerdict,
        findings,
      },
      options.logDir
    );
  }

  const isPermittedUnderCorridor = debtVerdict.status !== 'BLOCK';

  return {
    valid: findings.length === 0,
    isPermittedUnderCorridor,
    findings,
    guardrail: guardrailResult,
    debtVerdict,
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
  { name: 'CAT-06 Arabic Execution Numbers', msg: 'refactor: 更新\n\n[Verification]\n- 断言 17 组用例覆盖 419 个文件。', expectRule: 'CMG-STY-006', expectValid: false },
  { name: 'CAT-06 Execution Numbers and Ratios', msg: 'refactor: 规则\n\n[Verification]\n- 断言规模 763 ELOC，稀释比 1:1.78。', expectRule: 'CMG-STY-006', expectValid: false },
  { name: 'CAT-06 Chinese Execution Numbers', msg: 'refactor: 规则\n\n[Verification]\n- 验证通过三组用例并覆盖两个场景。', expectRule: 'CMG-STY-006', expectValid: false },
  { name: 'CAT-06 Whitelist Rule IDs & Scripts', msg: 'refactor: 规则\n\n[Verification]\n- 执行 pwsh scripts/ps1/commit-msg-gate.ps1，验证 CMG-STY-005 与 L0~L5 解析成立。', expectValid: true },
  { name: 'CAT-06 Whitelist Runtime Environments', msg: 'refactor: 环境\n\n[Verification]\n- 运行 Node 24 与 PowerShell 7 环境验证，断言模块加载成立。', expectValid: true },
  { name: 'CAT-01 Chinese (临时)', msg: 'fix: 临时修复空指针\n\n[Why]\n- 临时顶一下', expectRule: 'CMG-STY-001', expectValid: false },
  { name: 'CAT-02 Chinese (绝对/完美)', msg: 'feat: 彻底完美解决所有并发崩溃\n\n[Why]\n- 打造工业级架构', expectRule: 'CMG-STY-002', expectValid: false },
  { name: 'CAT-03 Chinese (垃圾)', msg: 'refactor: 重构一团糟的垃圾代码', expectRule: 'CMG-STY-003', expectValid: false },
  { name: 'CAT-04 Chinese (元叙事标语)', msg: 'docs(readme): 调整整体文案语调为低调中肯、求真务实，移除宣扬性词汇', expectRule: 'CMG-STY-004', expectValid: false },
  { name: 'CAT-04 Chinese (完美闭环与彻底清零)', msg: 'feat(gate): 实现完美闭环并将问题彻底清零', expectRule: 'CMG-STY-004', expectValid: false },
  { name: 'CAT-05 Chinese (测试全绿与全部达标)', msg: 'test: 更新测试\n\n[Verification]\n- 测试全绿且全部达标。', expectRule: 'CMG-STY-005', expectValid: false },
  { name: 'CAT-01 English (quick fix/for now)', msg: 'fix(api): quick and dirty hack for now', expectRule: 'CMG-STY-001', expectValid: false },
  { name: 'CAT-02 English (ultimate/bulletproof)', msg: 'feat(core): deliver ultimate bulletproof architecture with 100% reliable engine', expectRule: 'CMG-STY-002', expectValid: false },
  { name: 'CAT-03 English (complete mess/disaster)', msg: 'refactor(db): rewrite complete mess and disaster of old schema', expectRule: 'CMG-STY-003', expectValid: false },
  { name: 'CAT-04 English (tone down/humble)', msg: 'docs(readme): tone down wording to be humble and pragmatic, remove boastful words', expectRule: 'CMG-STY-004', expectValid: false },
  { name: 'CAT-04 English (perfect closed-loop)', msg: 'feat(core): achieve perfect closed-loop and zero violations', expectRule: 'CMG-STY-004', expectValid: false },
  { name: 'CAT-05 Chinese (退出码与项检查流水账)', msg: 'refactor(gate): 更新检查规则\n\n[Verification]\n- 6 项检查均返回退出码 0，双端脚本均返回 0。', expectRule: 'CMG-STY-005', expectValid: false },
  { name: 'CAT-05 English (exit code 0 / all green)', msg: 'refactor(gate): update rules\n\n[Verification]\n- all tests green with exit code 0 without errors.', expectRule: 'CMG-STY-005', expectValid: false },
  { name: 'Whitelist Chinese (绝对路径/临时文件)', msg: 'fix(path): 修复跨平台文件查找未能转换为绝对路径的问题\n\n[Why]\n- `createTempFile` 生成的临时文件需支持绝对路径。\n\n[Verification]\n- 运行单元测试套件。', expectValid: true },
  { name: 'Whitelist English (absolute path/temp dir)', msg: 'fix(path): resolve absolute path for temporary directory cleanup\n\n[Why]\n- Ensure clean workspace directory removal.', expectValid: true },
  { name: 'Whitelist English (two-pass/pass parameters)', msg: 'feat(compiler): implement two-pass syntax analysis and pass parameters by reference\n\n[Verification]\n- Execute test-parallel runner covering regression suites.', expectValid: true },
  { name: 'Whitelist Chinese (单趟扫描与透传参数)', msg: 'feat(core): 实现单趟语法审查并在模块间透传配置上下文\n\n[Verification]\n- 执行 node scripts/test-parallel.js 运行回归套件。', expectValid: true },
  { name: 'Normal Chinese Technical Fact', msg: 'fix(parser): 修复空指针异常\n\n[Why]\n- 防止非法输入导致崩溃。\n\n[Changed]\n- 通过验证配置项的存在性保证系统稳定运行，增加类型守卫。\n- 通过测试用例重现边界情况并修复。\n\n[Verification]\n- 运行 node scripts/test-parallel.js 回归测试。', expectValid: true },
  { name: 'Normal English Technical Fact', msg: 'feat(stream): support passing custom options to worker pool\n\n[Why]\n- Allow configurable buffer sizing。\n\n[Changed]\n- Handle passing options to downstream handlers。\n\n[Verification]\n- Run vitest unit tests across modified worker routines。', expectValid: true },
  { name: 'Valid Technical Fact', msg: 'docs(readme): 更新各子模块状态标注并补充实验性质说明\n\n[Why]\n- 准确说明模块开发阶段。\n\n[Changed]\n- 更新 README.md 中的项目矩阵说明。\n\n[Verification]\n- 运行本地预审脚本。', expectValid: true },
  { name: 'CAT-07 Chinese Imperative Header Violation', msg: 'feat(core): 修改了分词器实现\n\n[Project: governance]\n[Why]\n对齐规范。\n\n[Verification]\n断言测试成立。', expectRule: 'CMG-STY-007', expectValid: false },
  { name: 'CAT-07 English Imperative Header Violation', msg: 'feat(core): modified tokenizer implementation\n\n[Project: governance]\n[Why]\nAlign with specs.\n\n[Verification]\nAssert tests pass.', expectRule: 'CMG-STY-007', expectValid: false },
  { name: 'CAT-08 Chinese First-Person Pronouns Violation', msg: 'feat(core): 重构分词器实现\n\n[Project: governance]\n[Why]\n我们在本次改动中优化了架构。\n\n[Verification]\n断言测试成立。', expectRule: 'CMG-STY-008', expectValid: false },
  { name: 'CAT-08 English First-Person Pronouns Violation', msg: 'feat(core): refactor tokenizer implementation\n\n[Project: governance]\n[Why]\nWe refactored the tokenizer.\n\n[Verification]\nAssert tests pass.', expectRule: 'CMG-STY-008', expectValid: false },
  { name: 'CAT-02 Adversarial Zero-Width Evasion Normalization', msg: 'feat(core): 完\u200B美实现分词器\n\n[Project: governance]\n[Why]\n提高稳定性。\n\n[Verification]\n断言测试成立。', expectRule: 'CMG-STY-002', expectValid: false },
  { name: 'CAT-07 English Verb Participle (-ing)', msg: 'feat(core): adding new features to pipeline\n\n[Project: governance]\n[Why]\nEnhance features.\n\n[Verification]\nAssert tests pass.', expectRule: 'CMG-STY-007', expectValid: false },
  { name: 'CAT-07 English Verb Third Person (-s)', msg: 'fix(core): fixes parser crash on edge cases\n\n[Project: governance]\n[Why]\nPrevent crash.\n\n[Verification]\nAssert tests pass.', expectRule: 'CMG-STY-007', expectValid: false },
  { name: 'CAT-07 Chinese Intentional Modality (打算)', msg: 'feat(core): 打算支持新分词协议\n\n[Project: governance]\n[Why]\n规范演进。\n\n[Verification]\n断言测试成立。', expectRule: 'CMG-STY-007', expectValid: false },
  { name: 'CAT-07 Chinese Intentional Modality (计划)', msg: 'feat(core): 计划重构分词器\n\n[Project: governance]\n[Why]\n规范演进。\n\n[Verification]\n断言测试成立。', expectRule: 'CMG-STY-007', expectValid: false },
  { name: 'Whitelist Multiline Code Block Masking', msg: 'feat(core): 重构分词器实现\n\n[Project: governance]\n[Why]\n代码样例如下：\n```typescript\n// In code block, we use temp variables and subjective words:\nconst we = 1;\nlet temp = "for now";\n```\n\n[Verification]\n运行自测试卷。', expectValid: true },
  { name: 'Whitelist Academic Test Oracle Context', msg: 'feat(rules): 引入脆性断言神谕与差分神谕检测器\n\n[Project: auto-refactor]\n[Why]\n学术测试理论中的测试神谕（Test Oracle）用于判定程序行为。\n\n[Verification]\n运行断言神谕检测套件。', expectValid: true },
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
