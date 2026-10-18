/**
 * Module: Git Commit History Terminology & High-Frequency Jargon Analyzer
 * File Path: scripts/common/analyze-commit-terminology.js
 * Architecture Role: Historical commit terminology extractor, frequency statistical modeler,
 *   and emerging jargon risk detector adhering to the Agent Directives Protocol.
 * Dependencies & Triggers: Consumes commit-msg-forbidden-terms.json; reads git log;
 *   invoked by audit-all.ps1, pre-push verification, and autonomous Agent diagnostic routines.
 * Responsibilities:
 *   1. Extract and parse structured git commit messages (subjects, bodies, verification blocks);
 *   2. Tokenize and tally bi-lingual terms (Chinese n-grams and English technical tokens);
 *   3. Cross-reference terms against forbidden rule dictionaries (CMG-STY-001 ~ CMG-STY-006);
 *   4. Isolate project-dimension terminology distributions (workspace-timing, auto-refactor, WebGames, governance);
 *   5. Generate machine-readable JSON payloads and human-readable Markdown diagnostics for Agent inspection.
 * Exit Semantics & Design Rationale: Exits 0 on completion; never throws uncaught exceptions;
 *   persists snapshots to .audit-logs/commit-terminology-analysis.{json,md}.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const TERMS_FILE = path.join(__dirname, 'commit-msg-forbidden-terms.json');
const DEFAULT_LOG_DIR = path.join(REPO_ROOT, '.audit-logs');
const OUTPUT_JSON = path.join(DEFAULT_LOG_DIR, 'commit-terminology-analysis.json');
const OUTPUT_MD = path.join(DEFAULT_LOG_DIR, 'commit-terminology-analysis.md');

const CHINESE_STOPWORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '与', '及', '以', '中', '对', '将', '并', '从', '等', '进行', '该',
  '使用', '为', '已', '通过', '于', '由', '向', '按', '所', '其', '经', '根据',
  '有关', '关于', '且', '或', '而', '被', '让', '把', '个', '项', '处', '条', '次',
  '套', '张', '本', '此', '即', '若', '如', '但', '因', '故', '之', '所', '者',
  '可', '能', '应', '当', '须', '必', '无', '非', '未', '更', '越', '已', '曾',
  '正', '将', '便', '即', '方', '才', '刚', '复', '再', '重', '仅', '只', '单',
  '各', '诸', '每', '某', '同', '共', '相', '互', '自', '彼此', '谁', '何', '孰',
  '哪', '甚', '怎', '么', '样', '几', '许', '多', '少', '全', '总', '整', '凡'
]);

const ENGLISH_STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'aren', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'but', 'by', 'can', 'cannot', 'could', 'did', 'do',
  'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had',
  'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself',
  'his', 'how', 'i', 'if', 'in', 'into', 'is', 'isn', 'it', 'its', 'itself', 'let',
  'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once',
  'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their',
  'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn', 'we', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'won', 'would',
  'you', 'your', 'yours', 'yourself', 'yourselves', 'feat', 'fix', 'refactor', 'chore',
  'docs', 'test', 'style', 'perf', 'why', 'added', 'changed', 'fixed', 'verification'
]);

function loadForbiddenTerms() {
  if (!fs.existsSync(TERMS_FILE)) {
    return { rules: [], whitelist: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(TERMS_FILE, 'utf8'));
  } catch {
    return { rules: [], whitelist: [] };
  }
}

function parseCliArgs(argv) {
  const options = {
    maxCommits: 500,
    since: '',
    project: '',
    json: false,
    minCount: 3,
    top: 40,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '-n' || arg === '--max-commits' || arg === '--limit') {
      options.maxCommits = parseInt(argv[++i], 10) || 500;
    } else if (arg === '--since') {
      options.since = argv[++i] || '';
    } else if (arg === '--project') {
      options.project = argv[++i] || '';
    } else if (arg === '--min-count') {
      options.minCount = parseInt(argv[++i], 10) || 3;
    } else if (arg === '--top') {
      options.top = parseInt(argv[++i], 10) || 40;
    }
  }
  return options;
}

function inferCommitProject(body, subject) {
  const projMatch = body.match(/\[Project:\s*([^\]]+)\]/i);
  if (projMatch) return projMatch[1].trim().toLowerCase();
  const subjMatch = subject.match(/^[a-z]+\(([^)]+)\):/i);
  if (subjMatch) return subjMatch[1].trim().toLowerCase();
  return 'unassigned';
}

function parseGitCommitEntry(entry, targetProject) {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('\x1f');
  if (parts.length < 4) return null;

  const hash = parts[0]?.trim() || '';
  const author = parts[1]?.trim() || '';
  const date = parts[2]?.trim() || '';
  const subject = parts[3]?.trim() || '';
  const body = parts[4]?.trim() || '';
  const project = inferCommitProject(body, subject);

  if (targetProject && project !== targetProject.toLowerCase()) {
    return null;
  }
  return { hash, author, date, subject, body, project };
}

function fetchGitCommits(options) {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: 'NUL' };
  let cmd = 'git log --format="---COMMIT_DELIM---%H%x1f%an%x1f%ad%x1f%s%x1f%b" --date=short';
  if (options.maxCommits > 0) {
    cmd += ` -n ${options.maxCommits}`;
  }
  if (options.since) {
    cmd += ` --since="${options.since}"`;
  }

  let rawLog = '';
  try {
    rawLog = execSync(cmd, { cwd: REPO_ROOT, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    return [];
  }

  const rawEntries = rawLog.split('---COMMIT_DELIM---');
  const commits = [];

  for (const entry of rawEntries) {
    const parsed = parseGitCommitEntry(entry, options.project);
    if (parsed) commits.push(parsed);
  }

  return commits;
}

function cleanCommitText(text) {
  return text
    .replace(/\[Project:[^\]]*\]/gi, ' ')
    .replace(/\[(?:Why|Added|Changed|Fixed|Verification)\]/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/https?:\/\/[^\s]+/g, ' ')
    .replace(/[a-zA-Z0-9_\-\.\/]+\.(?:ts|js|ps1|sh|json|gd|md|rs|toml)\b/g, ' ')
    .replace(/\b[A-Z]{2,4}(?:-[A-Z0-9]+){2,}\b/g, ' ')
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9_\-\s]/g, ' ');
}

function extractTokensFromText(text) {
  const cleaned = cleanCommitText(text);
  const terms = [];

  // 1. English technical words
  const engWords = cleaned.match(/[a-zA-Z]{3,}/g) || [];
  for (const w of engWords) {
    const lower = w.toLowerCase();
    if (!ENGLISH_STOPWORDS.has(lower)) {
      terms.push(lower);
    }
  }

  // 2. Chinese phrases via contiguous CJK extraction and n-grams
  const cjkBlocks = cleaned.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  for (const block of cjkBlocks) {
    const len = block.length;
    if (len >= 2 && len <= 6 && !CHINESE_STOPWORDS.has(block)) {
      terms.push(block);
    }
    // Sub 2-grams and 3-grams
    if (len >= 3) {
      for (let i = 0; i <= len - 2; i++) {
        const biGram = block.slice(i, i + 2);
        if (!CHINESE_STOPWORDS.has(biGram)) {
          terms.push(biGram);
        }
      }
    }
    if (len >= 4) {
      for (let i = 0; i <= len - 3; i++) {
        const triGram = block.slice(i, i + 3);
        if (!CHINESE_STOPWORDS.has(triGram)) {
          terms.push(triGram);
        }
      }
    }
  }

  return terms;
}

function compileForbiddenPatternMap(forbiddenConfig) {
  const map = [];
  for (const rule of forbiddenConfig.rules || []) {
    for (const pat of rule.patterns || []) {
      if (pat) map.push({ pattern: pat, ruleId: rule.id, title: rule.title, reason: rule.reason });
    }
  }
  return map;
}

function checkCommitViolations(commit, fullText, forbiddenPatternMap, violations) {
  for (const item of forbiddenPatternMap) {
    if (fullText.includes(item.pattern)) {
      violations.push({
        commit: commit.hash.substring(0, 8),
        date: commit.date,
        author: commit.author,
        project: commit.project,
        subject: commit.subject,
        term: item.pattern,
        ruleId: item.ruleId,
        ruleTitle: item.title,
        reason: item.reason,
      });
    }
  }
}

function tallyCommitTokens(commit, tokens, termCounts, commitOccurrences, projectDistributions) {
  const seenInCommit = new Set();
  for (const token of tokens) {
    termCounts.set(token, (termCounts.get(token) || 0) + 1);

    if (!seenInCommit.has(token)) {
      seenInCommit.add(token);
      commitOccurrences.set(token, (commitOccurrences.get(token) || 0) + 1);

      if (!projectDistributions.has(token)) {
        projectDistributions.set(token, new Map());
      }
      const pMap = projectDistributions.get(token);
      pMap.set(commit.project, (pMap.get(commit.project) || 0) + 1);
    }
  }
}

function buildSortedTerms(termCounts, commitOccurrences, projectDistributions, commitsLength, options) {
  return Array.from(termCounts.entries())
    .filter(([_, count]) => count >= options.minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, options.top)
    .map(([term, count], index) => {
      const commitCount = commitOccurrences.get(term) || 0;
      const pct = ((commitCount / Math.max(1, commitsLength)) * 100).toFixed(1);
      const projMap = projectDistributions.get(term) || new Map();
      const projectBreakdown = {};
      for (const [proj, pCount] of projMap.entries()) {
        projectBreakdown[proj] = pCount;
      }
      return {
        rank: index + 1,
        term,
        totalOccurrences: count,
        commitsMentioned: commitCount,
        commitPercentage: `${pct}%`,
        projectBreakdown,
      };
    });
}

function analyzeTerminology(commits, forbiddenConfig, options) {
  const termCounts = new Map();
  const commitOccurrences = new Map();
  const projectDistributions = new Map();
  const forbiddenViolations = [];
  const forbiddenPatternMap = compileForbiddenPatternMap(forbiddenConfig);

  for (const commit of commits) {
    const fullText = `${commit.subject}\n${commit.body}`;
    const tokens = extractTokensFromText(fullText);
    checkCommitViolations(commit, fullText, forbiddenPatternMap, forbiddenViolations);
    tallyCommitTokens(commit, tokens, termCounts, commitOccurrences, projectDistributions);
  }

  const sortedTerms = buildSortedTerms(termCounts, commitOccurrences, projectDistributions, commits.length, options);

  return {
    totalCommits: commits.length,
    analyzedSince: commits[commits.length - 1]?.date || 'N/A',
    analyzedUntil: commits[0]?.date || 'N/A',
    uniqueTermsTotal: termCounts.size,
    topKeywords: sortedTerms,
    forbiddenViolations,
  };
}

function generateAgentDirectives(analysisResult) {
  const directives = [];

  if (analysisResult.forbiddenViolations.length > 0) {
    const forbiddenSummary = new Map();
    for (const v of analysisResult.forbiddenViolations) {
      forbiddenSummary.set(v.term, (forbiddenSummary.get(v.term) || 0) + 1);
    }
    directives.push({
      priority: 'HIGH',
      category: 'FORBIDDEN_VOCABULARY_DETECTION',
      summary: `检测到 ${analysisResult.forbiddenViolations.length} 次历史提交中使用了禁词（涉及 ${forbiddenSummary.size} 种违规词汇）。`,
      action: 'enforce_forbidden_terms_gate',
      violatingTerms: Array.from(forbiddenSummary.entries()).map(([term, count]) => ({ term, count })),
      recommendation: '确保 pre-commit 与 commit-msg 门禁严格阻断此类词汇；对历史词汇设立高频拦截清单。',
    });
  }

  directives.push({
    priority: 'MEDIUM',
    category: 'TERMINOLOGY_FREQUENCY_CONSISTENCY',
    summary: `分析了 ${analysisResult.totalCommits} 次提交，提炼出 ${analysisResult.topKeywords.length} 个高频领域词汇。`,
    action: 'maintain_terminology_ssot',
    dominantTechnicalKeywords: analysisResult.topKeywords.slice(0, 10).map((k) => k.term),
    recommendation: '高频专业词汇（如门禁、重构、审查、契约）体现了工作区主干架构演进方向，建议在 commit-msg 模板与 rule-catalog 中保持单源对齐。',
  });

  return directives;
}

function persistReports(analysisResult, directives) {
  if (!fs.existsSync(DEFAULT_LOG_DIR)) {
    fs.mkdirSync(DEFAULT_LOG_DIR, { recursive: true });
  }

  const payload = {
    protocolVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    metrics: {
      totalCommits: analysisResult.totalCommits,
      dateRange: `${analysisResult.analyzedSince} ~ ${analysisResult.analyzedUntil}`,
      uniqueTermsCount: analysisResult.uniqueTermsTotal,
      forbiddenViolationsCount: analysisResult.forbiddenViolations.length,
    },
    topKeywords: analysisResult.topKeywords,
    forbiddenViolations: analysisResult.forbiddenViolations,
    agentDirectives: directives,
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(payload, null, 2), 'utf8');

  // Generate Markdown report
  const lines = [
    '# 历史提交高频词汇与禁词检测全景报告',
    '',
    `> **生成时间**: ${new Date().toISOString()} | **分析提交数**: ${analysisResult.totalCommits} | **时间跨度**: ${analysisResult.analyzedSince} 至 ${analysisResult.analyzedUntil}`,
    '',
    '## 一、 高频核心词汇排行榜 (Top Keywords)',
    '',
    '| 排名 | 核心词汇 | 总频次 | 提及提交数 | 提交覆盖率 | 项目主要分布 |',
    '| :---: | :--- | :---: | :---: | :---: | :--- |',
  ];

  for (const item of analysisResult.topKeywords.slice(0, 30)) {
    const projSummary = Object.entries(item.projectBreakdown)
      .map(([p, c]) => `${p}(${c})`)
      .join(', ');
    lines.push(`| ${item.rank} | **${item.term}** | ${item.totalOccurrences} | ${item.commitsMentioned} | ${item.commitPercentage} | ${projSummary} |`);
  }

  lines.push('', '## 二、 历史违规词与神话/黑话拦截追踪 (Forbidden Term Findings)', '');
  if (analysisResult.forbiddenViolations.length === 0) {
    lines.push('✔ 未在检索范围内检测到违规禁词。');
  } else {
    lines.push('| 提交哈希 | 提交日期 | 命中禁词 | 违规规则 | 提交摘要 | 原因说明 |');
    lines.push('| :---: | :---: | :---: | :---: | :--- | :--- |');
    for (const v of analysisResult.forbiddenViolations.slice(0, 50)) {
      lines.push(`| \`${v.commit}\` | ${v.date} | **\`${v.term}\`** | ${v.ruleId} | ${v.subject.replace(/\|/g, '\\|')} | ${v.reason.replace(/\|/g, '\\|')} |`);
    }
  }

  lines.push('', '## 三、 面向智能体与研发人员的改进建议 (Agent Directives)', '');
  for (const d of directives) {
    lines.push(`- **[${d.priority}] ${d.category}**: ${d.summary}`);
    lines.push(`  - 推荐动作: \`${d.action}\``);
    lines.push(`  - 指引: ${d.recommendation}`);
  }
  lines.push('');

  fs.writeFileSync(OUTPUT_MD, lines.join('\n'), 'utf8');
}

function run() {
  const options = parseCliArgs(process.argv.slice(2));
  const forbiddenConfig = loadForbiddenTerms();
  const commits = fetchGitCommits(options);

  if (commits.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ protocolVersion: '1.0.0', error: 'No commits matched criteria' }, null, 2));
    } else {
      console.log('未检测到符合条件的 Git 历史提交。');
    }
    return;
  }

  const analysisResult = analyzeTerminology(commits, forbiddenConfig, options);
  const directives = generateAgentDirectives(analysisResult);
  persistReports(analysisResult, directives);

  if (options.json) {
    console.log(JSON.stringify({
      protocolVersion: '1.0.0',
      metrics: {
        totalCommits: analysisResult.totalCommits,
        dateRange: `${analysisResult.analyzedSince} ~ ${analysisResult.analyzedUntil}`,
        uniqueTermsCount: analysisResult.uniqueTermsTotal,
      },
      topKeywords: analysisResult.topKeywords,
      forbiddenViolations: analysisResult.forbiddenViolations,
      agentDirectives: directives,
    }, null, 2));
    return;
  }

  console.log(`\n=================================================================`);
  console.log(`📊 历史提交词汇频次与黑话治理分析器 (Commit Terminology Engine)`);
  console.log(`=================================================================`);
  console.log(`  ▶ 扫描提交: ${analysisResult.totalCommits} 次 (${analysisResult.analyzedSince} ~ ${analysisResult.analyzedUntil})`);
  console.log(`  ▶ 词汇总量: ${analysisResult.uniqueTermsTotal} 个不同词元`);
  console.log(`  ▶ 禁词拦截: 检出 ${analysisResult.forbiddenViolations.length} 处历史违规\n`);

  console.log(`【前 20 核心高频词】:`);
  for (const item of analysisResult.topKeywords.slice(0, 20)) {
    console.log(`  ${String(item.rank).padStart(2, ' ')}. [${item.term}] - 出现 ${item.totalOccurrences} 次 (覆盖 ${item.commitPercentage} 提交)`);
  }

  if (analysisResult.forbiddenViolations.length > 0) {
    console.log(`\n【⚠️ 历史提交命中禁词示例 (前 5 处)】:`);
    for (const v of analysisResult.forbiddenViolations.slice(0, 5)) {
      console.log(`  - [${v.commit}] ${v.date} 命中 '${v.term}' (${v.ruleId}): ${v.subject}`);
    }
  }

  console.log(`\n💡 完整分析快照已落盘至:`);
  console.log(`   - JSON: ${OUTPUT_JSON}`);
  console.log(`   - Markdown: ${OUTPUT_MD}\n`);
}

if (require.main === module) {
  run();
}

module.exports = {
  fetchGitCommits,
  cleanCommitText,
  extractTokensFromText,
  analyzeTerminology,
  generateAgentDirectives,
};
