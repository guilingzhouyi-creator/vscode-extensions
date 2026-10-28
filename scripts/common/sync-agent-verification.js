/**
 * Module: Governance Tooling — Agent Verification Section Sync
 * File Path: scripts/common/sync-agent-verification.js
 * Architecture Role: 单一写者，把 `.agents/subagents/archetypes/*.json` 的 `localVerification`
 *   渲染进每份专员模板的「强制离线验证命令」章节，使模板与原型不再各自维护一份命令清单。
 * Dependencies & Triggers: node:fs / node:path；读取 subagent-catalog.json 与 archetypes/*.json，
 *   写入 `.agents/subagents/agents/*.md`。由 sync-agents-mirror.js 之前调用或独立运行。
 * Responsibilities:
 *   1. 写姿态（construct/refactor/guardian）逐条渲染原型声明的验证命令；
 *   2. 只读姿态（review/explore）渲染「不执行构建」的声明，不再罗列其无权运行的命令；
 *   3. --check 模式只报告漂移而不写盘。
 * Exit Semantics & Design Rationale: 0 = 全部与原型渲染一致，1 = 存在漂移（--check）或渲染失败。
 *   命令清单曾由人手工抄进 27 份模板，实测 20 条与原型不符：有的模板引用原型未声明的脚本，
 *   有的漏掉原型要求必跑的门禁。这类漂移不会让任何单点校验变红——模板自洽、原型也自洽，
 *   只有把两者放在一起才暴露。让模板的该章节成为生成产物，是唯一能长期闭合的做法。
 *   只读姿态不渲染命令，因为其在平台侧物理没有构建与写盘权限：列出一串跑不了的命令，
 *   既浪费上下文，也让审查专员误以为自己应当产出编译结果。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SUBAGENTS_ROOT = path.join(REPO_ROOT, '.agents/subagents');
const CATALOG_PATH = path.join(SUBAGENTS_ROOT, 'subagent-catalog.json');
const ARCHETYPES_DIR = path.join(SUBAGENTS_ROOT, 'archetypes');
const AGENTS_DIR = path.join(SUBAGENTS_ROOT, 'agents');

/** 章节标题：模板与守卫共用同一锚点。 */
const SECTION_HEADING = '## 强制离线验证命令';

/** 写姿态：这些姿态会真实落盘，必须逐条执行原型声明的门禁。 */
const WRITE_POSTURES = Object.freeze(['construct', 'refactor', 'guardian']);

/** 只读姿态在平台侧无构建与写盘权限。 */
const READ_ONLY_NOTICE = [
  '> 本姿态为只读：平台已物理剥夺写入与构建权限，下列命令不在此会话执行。',
  '> 客观依据为文件路径、起始行号与已登记规则 ID；门禁与回归由主 Agent 或写姿态会话执行。',
].join('\n');

/**
 * 读取并解析一个 JSON 文件。
 *
 * @param {string} filePath - 绝对路径。
 * @returns {object} 解析结果。
 */
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * 渲染某预置应携带的验证章节正文（不含标题）。
 *
 * @param {string} posture - 作业姿态。
 * @param {string[]} commands - 原型声明的验证命令。
 * @returns {string} 章节正文。
 */
function renderSectionBody(posture, commands) {
  if (!WRITE_POSTURES.includes(posture)) return `\n${READ_ONLY_NOTICE}\n`;
  const listing = commands.map((command) => command).join('\n');
  return `\n\`\`\`powershell\n${listing}\n\`\`\`\n`;
}

/**
 * 用生成正文替换模板中既有章节，缺失章节时追加到文末。
 *
 * 该章节恒为文末最后一节，因此替换范围是从标题到文件末尾——模板里没有任何内容排在它之后。
 *
 * @param {string} template - 模板全文。
 * @param {string} body - 生成正文。
 * @returns {string} 期望的模板全文。
 */
function renderTemplate(template, body) {
  const headingIndex = template.indexOf(SECTION_HEADING);
  const head = headingIndex < 0 ? `${template.replace(/\n*$/u, '')}\n\n` : template.slice(0, headingIndex);
  return `${head}${SECTION_HEADING}\n${body}`;
}

/**
 * 计算每份模板的期望内容。
 *
 * @returns {Array<{ name: string, filePath: string, expected: string, current: string }>} 渲染结果。
 */
function renderAll() {
  const catalog = readJson(CATALOG_PATH);
  const rendered = [];
  for (const [presetName, preset] of Object.entries(catalog.presets || {})) {
    const archetype = readJson(path.join(ARCHETYPES_DIR, `${preset.archetype}.json`));
    const filePath = path.join(AGENTS_DIR, `${presetName}.md`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`agent template missing: .agents/subagents/agents/${presetName}.md`);
    }
    const current = fs.readFileSync(filePath, 'utf8');
    const body = renderSectionBody(preset.posture, archetype.localVerification || []);
    rendered.push({ name: presetName, filePath, expected: renderTemplate(current, body), current });
  }
  return rendered;
}

/**
 * 同步全部模板或在 --check 下报告漂移。
 *
 * @param {{ checkOnly: boolean }} options - 运行选项。
 * @returns {number} 退出码。
 */
function run({ checkOnly }) {
  const rendered = renderAll();
  const drifted = rendered.filter((item) => item.expected !== item.current);
  if (checkOnly) {
    if (drifted.length === 0) {
      process.stdout.write(`✔ All ${rendered.length} agent templates match the archetype verification render\n`);
      return 0;
    }
    process.stderr.write(`✖ ${drifted.length} agent template(s) drifted from archetype verification:\n`);
    for (const item of drifted) {
      process.stderr.write(`   - .agents/subagents/agents/${item.name}.md\n`);
    }
    process.stderr.write('   → run `node scripts/common/sync-agent-verification.js` to heal.\n');
    return 1;
  }
  for (const item of drifted) fs.writeFileSync(item.filePath, item.expected, 'utf8');
  process.stdout.write(`✔ Synced ${drifted.length} agent template(s) from archetype verification\n`);
  return 0;
}

if (require.main === module) {
  process.exit(run({ checkOnly: process.argv.includes('--check') || process.argv.includes('--check-only') }));
}

module.exports = { READ_ONLY_NOTICE, SECTION_HEADING, renderAll, renderSectionBody, renderTemplate, run };
