/**
 * Module: Git Commit Message Style, Imperative Mood & Guardrail Arbiter
 * File Path: scripts/common/commit-style-arbiter.js
 * Architecture Role: Rule-based linguistic arbiter evaluating Git commit messages against
 *   imperative mood contracts (CMG-STY-007), zero-POV objectivity (CMG-STY-008),
 *   controlled project nomenclature, academic test terminology resolution, and information density.
 * Dependencies & Triggers: Consumes commit-tokenizer.js and commit-msg-forbidden-terms.json;
 *   invoked by validate-commit-msg-style.js and validate-commit-msg.js.
 * Responsibilities:
 *   1. Enforce imperative action verb taxonomy on commit header summaries;
 *   2. Intercept first-person pronouns and non-objective narrative perspective;
 *   3. Contextually whitelist formal academic test terminology (e.g. Test Oracle / 测试预言机 / 测试神谕);
 *   4. Evaluate Shannon token information entropy and calculate comprehensive StyleHealthScore;
 *   5. Produce structured actionable remediation payloads for Autonomous Agents.
 * Exit Semantics & Design Rationale: Pure deterministic evaluation; returns structured findings;
 *   execution time < 5ms per message with zero external dependencies.
 */
'use strict';

const {
  normalizeText,
  parseCommitStructure,
  extractLeadingActionVerb,
  extractBilingualTokens,
  buildTrie,
  searchLongestPrefix,
  analyzeEnglishVerbInflection,
} = require('./commit-tokenizer');

/** Standard approved Chinese imperative verbs for commit title summary */
const APPROVED_CHINESE_VERBS = new Set([
  '新增', '实现', '重构', '修复', '优化', '对齐', '消除', '加固', '演进', '登记',
  '消融', '提取', '完善', '升级', '降维', '收口', '支持', '规范', '统一', '引入',
  '删除', '移除', '补充', '初始化', '回滚', '加锁', '解耦', '重写', '配置', '接入',
  '封装', '调度', '清理', '压降', '同步', '导出', '合并', '拆分', '推进', '适配',
  '改进', '构建', '打包', '发布', '归档', '更新', '调整', '集成', '定义', '自愈',
  '拦截', '放行', '裁剪', '替换', '核算', '审计', '校验', '生成', '绑定', '迁移'
]);

/** Standard approved English imperative verbs for commit title summary */
const APPROVED_ENGLISH_VERBS = new Set([
  'add', 'implement', 'refactor', 'fix', 'optimize', 'align', 'eliminate', 'harden',
  'evolve', 'register', 'extract', 'enhance', 'upgrade', 'support', 'standardize',
  'unify', 'introduce', 'remove', 'supplement', 'init', 'revert', 'decouple',
  'rewrite', 'configure', 'integrate', 'encapsulate', 'schedule', 'clean', 'sync',
  'export', 'merge', 'split', 'adapt', 'improve', 'build', 'package', 'release',
  'archive', 'update', 'adjust', 'define', 'heal', 'intercept', 'replace', 'audit',
  'validate', 'generate', 'bind', 'migrate', 'prevent', 'resolve', 'streamline'
]);

/** Narrative and non-imperative leading phrases to intercept in commit title */
const DISALLOWED_LEADING_PREFIXES = [
  '修改了', '增加了', '修复了', '优化了', '完成了', '进行了', '做出了', '做了',
  '已修复', '已完成', '已通过', '已经', '被', '关于', '针对', '通过',
  // Intentional and subjective forward-looking modality (CMG-STY-007)
  '打算', '准备', '计划', '尝试', '开始', '想要', '希望能', '希望', '拟',
  // Narrative meta-subject prefixes
  '本提交', '本次提交', '本次改动', '本次更新', '主要修复', '主要是', '主要'
];

/** First-person pronouns (Zero-POV violation) */
const FIRST_PERSON_PRONOUNS_ZH = ['我', '我们', '本Agent', '笔者', '团队', '俺', '咱', '本人'];
const FIRST_PERSON_PRONOUNS_EN_RE = /\b(?:i|we|my|our|me|us)\b/i;

/** Controlled project nomenclature mapping: [misnomer, canonical] */
const PROJECT_NOMENCLATURE_MAP = new Map([
  ['autorefactor', 'auto-refactor'],
  ['workspacetiming', 'workspace-timing'],
  ['timing扩展', 'workspace-timing'],
  ['网页游戏', 'WebGames'],
]);

/** Academic test theory terms permitted under formal verification context */
const ACADEMIC_TEST_ORACLE_PHRASES = [
  '测试神谕', '断言神谕', '脆性神谕', '差分神谕', '神谕基准', '神谕验证',
  '测试预言机', '断言预言机', '差分预言机',
  'test oracle', 'brittle oracle', 'assertion oracle', 'differential oracle'
];

const ACADEMIC_ORACLE_TRIE = buildTrie(ACADEMIC_TEST_ORACLE_PHRASES);

/** Unified frozen vocabulary Trie for zero-allocation Forward Maximum Matching (FMM) */
const GLOBAL_VOCABULARY_LIST = [
  ...APPROVED_CHINESE_VERBS,
  ...DISALLOWED_LEADING_PREFIXES,
  ...FIRST_PERSON_PRONOUNS_ZH,
  ...ACADEMIC_TEST_ORACLE_PHRASES,
];
const GLOBAL_VOCABULARY_TRIE = Object.freeze(buildTrie(GLOBAL_VOCABULARY_LIST));

/**
 * Checks if a match on "神谕" is an academic software testing term rather than mythical hyperbole.
 *
 * @param {string} text - Surrounding context line
 * @param {number} charIndex - Index where "神谕" was matched
 * @returns {boolean} True if legitimate academic term
 */
function isAcademicTestOracleContext(text, charIndex) {
  if (!text) return false;
  const start = Math.max(0, charIndex - 4);
  const slice = text.substring(start, charIndex + 8);
  for (const phrase of ACADEMIC_TEST_ORACLE_PHRASES) {
    if (slice.includes(phrase)) return true;
  }
  return false;
}

/** English past-tense and non-imperative verbs to intercept in commit title */
const DISALLOWED_ENGLISH_PAST_TENSE = new Set([
  'added', 'modified', 'fixed', 'optimized', 'completed', 'done', 'did', 'was', 'were',
  'updated', 'refactored', 'implemented', 'removed', 'deleted', 'changed', 'enhanced',
  'resolved', 'improved', 'created', 'adjusted', 'configured', 'integrated',
  'standardized', 'unified', 'introduced', 'extracted', 'simplified', 'decoupled'
]);

function findDisallowedNarrativePrefix(normalized) {
  for (const dis of DISALLOWED_LEADING_PREFIXES) {
    if (normalized.startsWith(dis)) return dis;
  }
  return null;
}

function checkEnglishVerbImperative(lowerVerb, verb, summary, lineNum) {
  if (APPROVED_ENGLISH_VERBS.has(lowerVerb)) return null;

  // 1. Check explicit past tense list
  if (DISALLOWED_ENGLISH_PAST_TENSE.has(lowerVerb)) {
    const base = lowerVerb.endsWith('ed') ? lowerVerb.slice(0, -2) : lowerVerb;
    return {
      lineNum,
      rawLine: summary,
      ruleId: 'CMG-STY-007',
      category: 'imperative_mood',
      term: verb,
      isHighDebt: true,
      reason: 'Commit title summary must use the imperative mood (e.g. "add", "fix", "refactor"), not past tense.',
      guidance: `Replace past-tense '${verb}' with the base imperative verb '${base}'.`,
    };
  }

  // 2. Check general inflection (-ing, -s, -es, -ed)
  const inflection = analyzeEnglishVerbInflection(lowerVerb);
  if (inflection) {
    let suggested = inflection.baseForm;
    if (!APPROVED_ENGLISH_VERBS.has(suggested) && APPROVED_ENGLISH_VERBS.has(suggested + 'e')) {
      suggested = suggested + 'e';
    }

    const tenseDesc = inflection.tense === 'participle'
      ? 'present participle (-ing)'
      : inflection.tense === 'third_singular'
        ? 'third-person singular (-s/-es)'
        : 'past tense (-ed)';

    return {
      lineNum,
      rawLine: summary,
      ruleId: 'CMG-STY-007',
      category: 'imperative_mood',
      term: verb,
      isHighDebt: true,
      reason: `Commit title summary must use the base imperative verb, not ${tenseDesc}.`,
      guidance: `Replace '${verb}' with the base imperative verb '${suggested}'.`,
    };
  }

  return null;
}

function isApprovedChineseVerb(verb) {
  if (APPROVED_CHINESE_VERBS.has(verb)) return true;
  if (verb.length >= 2 && APPROVED_CHINESE_VERBS.has(verb.substring(0, 2))) return true;
  if (verb.length >= 3 && APPROVED_CHINESE_VERBS.has(verb.substring(0, 3))) return true;
  return false;
}

/**
 * Validates header imperative mood and verb taxonomy (CMG-STY-007).
 *
 * @param {string} summary - Commit title summary
 * @param {number} lineNum - Header line number (usually 1)
 * @returns {object | null} Finding if invalid
 */
/**
 * Validates header imperative mood and verb taxonomy (CMG-STY-007).
 *
 * @param {string} summary - Commit title summary
 * @param {number} lineNum - Header line number (usually 1)
 * @returns {object | null} Finding if invalid
 */
function checkHeaderImperativeMood(summary, lineNum = 1) {
  if (!summary) return null;
  const normalized = normalizeText(summary).trim();

  // 1. Check for disallowed narrative prefixes (including intent modality like '打算', '准备', '计划')
  const disallowedPrefix = findDisallowedNarrativePrefix(normalized);
  if (disallowedPrefix) {
    return {
      lineNum,
      rawLine: summary,
      ruleId: 'CMG-STY-007',
      category: 'imperative_mood',
      term: disallowedPrefix,
      isHighDebt: true,
      reason: '提交标题必须使用祈使句（以标准祈使动词开头），严禁使用陈述句、过去式、未决意图词（如打算/准备/计划）或被动描述。',
      guidance: `将前缀 '${disallowedPrefix}' 改写为明确的祈使动词（如 '新增'、'修复'、'重构'、'优化'）。`,
    };
  }

  // 2. Extract leading action verb
  const { verb } = extractLeadingActionVerb(normalized);
  if (!verb) {
    return {
      lineNum,
      rawLine: summary,
      ruleId: 'CMG-STY-007',
      category: 'imperative_mood',
      term: summary.substring(0, 6),
      isHighDebt: true,
      reason: '提交标题摘要缺少清晰的祈使句开头动词。',
      guidance: '标题摘要首词应使用标准祈使动词（如 新增、修复、重构、对齐、加固、消除 等）。',
    };
  }

  // 3. English verb verification
  const lowerVerb = verb.toLowerCase();
  const enFinding = checkEnglishVerbImperative(lowerVerb, verb, summary, lineNum);
  if (enFinding) return enFinding;

  // 4. Chinese verb verification
  if (isApprovedChineseVerb(verb)) return null;

  if (verb.includes('的') || verb.includes('了') || verb.includes('进行')) {
    return {
      lineNum,
      rawLine: summary,
      ruleId: 'CMG-STY-007',
      category: 'imperative_mood',
      term: verb,
      isHighDebt: true,
      reason: '提交标题使用了非祈使句叙述口吻。',
      guidance: `建议使用标准祈使动词（如 '新增'、'修复'、'重构'、'对齐' 等）替换 '${verb}'。`,
    };
  }

  return null;
}

/**
 * Checks for first-person pronouns and non-objective narrative perspective (CMG-STY-008).
 *
 * @param {string} line - Source line (already masked for code blocks)
 * @param {number} lineNum - Line index
 * @param {string} [rawDisplayLine] - Original unmasked line for diagnostic rendering
 * @returns {Array<object>} Findings
 */
function checkZeroPOV(line, lineNum, rawDisplayLine = '') {
  const findings = [];
  if (!line || line.trim().startsWith('#') || line.includes('__CODE_BLOCK__')) return findings;

  const displayLine = (rawDisplayLine || line).trim();

  // Mask inline code blocks and URLs
  const sanitized = line.replace(/`[^`]+`/g, ' ').replace(/https?:\/\/[^\s]+/g, ' ');

  // Chinese first-person pronouns: sort by length descending to match longest first
  const sortedZhPronouns = [...FIRST_PERSON_PRONOUNS_ZH].sort((a, b) => b.length - a.length);
  let prose = sanitized;
  for (const pronoun of sortedZhPronouns) {
    if (prose.includes(pronoun)) {
      findings.push({
        lineNum,
        rawLine: displayLine,
        ruleId: 'CMG-STY-008',
        category: 'zero_pov',
        term: pronoun,
        isHighDebt: true,
        reason: 'Git 提交信息属于长期客观技术档案，必须使用零人称/客观第三人称视角，严禁使用第一人称主观代词。',
        guidance: `移除第一人称代词 '${pronoun}'，采用直接陈述客观技术事实的祈使句或无主语句。`,
      });
      // Mask matched pronoun to avoid sub-pronoun double match (e.g. '我们' triggering '我')
      prose = prose.split(pronoun).join(' __POV__ ');
    }
  }

  // English first-person pronouns
  const enMatch = FIRST_PERSON_PRONOUNS_EN_RE.exec(sanitized);
  if (enMatch) {
    findings.push({
      lineNum,
      rawLine: displayLine,
      ruleId: 'CMG-STY-008',
      category: 'zero_pov',
      term: enMatch[0],
      isHighDebt: true,
      reason: 'Commit messages must maintain an objective third-person / zero-POV tone; first-person pronouns are forbidden.',
      guidance: `Replace first-person pronoun '${enMatch[0]}' with objective declarative or imperative phrasing.`,
    });
  }

  return findings;
}

/**
 * Checks for non-standard project nomenclature drifts.
 *
 * @param {string} line - Source line
 * @param {number} lineNum - Line index
 * @param {string} [rawDisplayLine] - Original unmasked line
 * @returns {Array<object>} Findings
 */
function checkProjectNomenclature(line, lineNum, rawDisplayLine = '') {
  const findings = [];
  if (!line || line.includes('__CODE_BLOCK__')) return findings;

  const displayLine = (rawDisplayLine || line).trim();
  for (const [misnomer, canonical] of PROJECT_NOMENCLATURE_MAP.entries()) {
    if (line.toLowerCase().includes(misnomer) && !line.includes(canonical)) {
      findings.push({
        lineNum,
        rawLine: displayLine,
        ruleId: 'CMG-PRJ-001',
        category: 'nomenclature_drift',
        term: misnomer,
        isHighDebt: false,
        reason: `检测到非标准项目名称标识 '${misnomer}'，项目专有名词应严格保持单源一致。`,
        guidance: `将 '${misnomer}' 规范化为官方标准名称 '${canonical}'。`,
      });
    }
  }

  return findings;
}

/**
 * Computes Shannon information entropy across bilingual token stream.
 *
 * @param {string[]} tokens - Extracted word tokens
 * @returns {number} Shannon entropy in bits
 */
function calculateShannonEntropy(tokens) {
  if (!tokens || tokens.length === 0) return 0;
  const freqMap = new Map();
  for (const t of tokens) {
    freqMap.set(t, (freqMap.get(t) || 0) + 1);
  }
  const total = tokens.length;
  let entropy = 0;
  for (const count of freqMap.values()) {
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return Number(entropy.toFixed(2));
}

/**
 * Performs full guardrail analysis on a structured commit message.
 *
 * @param {string} content - Full commit message
 * @returns {{ findings: Array<object>, styleScore: number, entropy: number, highDebtCount: number, parsedStructure: object }}
 */
function auditCommitStyleGuardrails(content) {
  const parsed = parseCommitStructure(content);
  const findings = [];

  // 1. Header imperative mood check (CMG-STY-007)
  if (parsed.summary) {
    const moodFinding = checkHeaderImperativeMood(parsed.summary, 1);
    if (moodFinding) {
      findings.push(moodFinding);
    }
  }

  // 2. Line-by-line Zero-POV (CMG-STY-008) & Project Nomenclature using masked code blocks
  const auditLines = parsed.maskedLines || parsed.allLines;
  for (let i = 0; i < auditLines.length; i++) {
    const line = auditLines[i];
    const rawLine = parsed.allLines[i] || line;

    const povFindings = checkZeroPOV(line, i + 1, rawLine);
    findings.push(...povFindings);

    const nomFindings = checkProjectNomenclature(line, i + 1, rawLine);
    findings.push(...nomFindings);
  }

  // 3. Information entropy evaluation using single-pass FMM with global Trie
  const tokenData = extractBilingualTokens(content, GLOBAL_VOCABULARY_TRIE);
  const entropy = calculateShannonEntropy(tokenData.allTokens);

  // 4. Composite Style Score & High Debt quantification
  let deductions = 0;
  let highDebtCount = 0;
  for (const f of findings) {
    if (f.ruleId === 'CMG-STY-007') {
      deductions += 15;
      highDebtCount += 1;
    } else if (f.ruleId === 'CMG-STY-008') {
      deductions += 10;
      highDebtCount += 1;
    } else if (f.ruleId === 'CMG-PRJ-001') {
      deductions += 5;
    }
  }
  const styleScore = Math.max(0, 100 - deductions);

  return {
    findings,
    styleScore,
    entropy,
    highDebtCount,
    parsedStructure: parsed,
  };
}

module.exports = {
  APPROVED_CHINESE_VERBS,
  APPROVED_ENGLISH_VERBS,
  isAcademicTestOracleContext,
  checkHeaderImperativeMood,
  checkZeroPOV,
  checkProjectNomenclature,
  calculateShannonEntropy,
  auditCommitStyleGuardrails,
};
