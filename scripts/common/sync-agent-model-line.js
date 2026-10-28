/**
 * Module: Governance Tooling — Agent Model Line Sync
 * File Path: scripts/common/sync-agent-model-line.js
 * Architecture Role: 单一写者，把专员模板的「模型要求」行收敛为不含具体模型代号的声明。
 * Dependencies & Triggers: node:fs / node:path；读取 subagent-catalog.json 与 postures/*.json，
 *   写入 `.agents/subagents/agents/*.md`。由 sync-agents-mirror.js 之前调用或独立运行。
 * Responsibilities:
 *   1. 依 catalog 的 model 字段与姿态声明渲染「模型要求」行；
 *   2. --check 模式只报告漂移而不写盘。
 * Exit Semantics & Design Rationale: 0 = 全部一致，1 = 存在漂移或渲染失败。
 *   27 份模板曾统一写着「inherit，Gemini 3.8 Flash，effort=High」。这句话在换模型后立刻
 *   成为模型必须当作前提推理的假事实，而 catalog 已经用 `inherit` 表达了同构继承的意图。
 *   模型标识属会话事实，不属于专员契约，因此该行只保留继承语义。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SUBAGENTS_ROOT = path.join(REPO_ROOT, '.agents/subagents');
const CATALOG_PATH = path.join(SUBAGENTS_ROOT, 'subagent-catalog.json');
const POSTURES_DIR = path.join(SUBAGENTS_ROOT, 'postures');
const AGENTS_DIR = path.join(SUBAGENTS_ROOT, 'agents');

/** 该行的固定前缀；匹配时只认这一前缀，避免误改其他行。 */
const MODEL_LINE_PREFIX = '- **模型要求**：';

/**
 * 渲染「模型要求」行。
 *
 * @param {string} model - catalog 声明的模型策略。
 * @param {string} postureDisplayName - 姿态显示名。
 * @returns {string} 模型要求行。
 */
function renderModelLine(model, postureDisplayName) {
  const strategy = model === 'inherit' ? '同构继承主会话模型 (`inherit`，不锁定具体模型代号)' : `固定使用 \`${model}\``;
  return `${MODEL_LINE_PREFIX}${strategy}；作业姿态为「${postureDisplayName}」`;
}

/**
 * 用渲染行替换模板中既有的模型要求行。
 *
 * @param {string} template - 模板全文。
 * @param {string} line - 渲染行。
 * @returns {string} 期望的模板全文。
 */
function replaceModelLine(template, line) {
  const lines = template.split('\n');
  const index = lines.findIndex((item) => item.startsWith(MODEL_LINE_PREFIX));
  if (index < 0) return template;
  lines[index] = line;
  return lines.join('\n');
}

/**
 * 计算每份模板的期望内容。
 *
 * @returns {Array<{ name: string, filePath: string, expected: string, current: string }>} 渲染结果。
 */
function renderAll() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const postureCache = new Map();
  const rendered = [];
  for (const [presetName, preset] of Object.entries(catalog.presets || {})) {
    if (!postureCache.has(preset.posture)) {
      const posture = JSON.parse(
        fs.readFileSync(path.join(POSTURES_DIR, `${preset.posture}.json`), 'utf8'),
      );
      postureCache.set(preset.posture, posture);
    }
    const posture = postureCache.get(preset.posture);
    const filePath = path.join(AGENTS_DIR, `${presetName}.md`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`agent template missing: .agents/subagents/agents/${presetName}.md`);
    }
    const current = fs.readFileSync(filePath, 'utf8');
    const line = renderModelLine(preset.model || 'inherit', posture.displayName);
    rendered.push({ name: presetName, filePath, expected: replaceModelLine(current, line), current });
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
      process.stdout.write(`✔ All ${rendered.length} agent templates match the model-line render\n`);
      return 0;
    }
    process.stderr.write(`✖ ${drifted.length} agent template(s) drifted from the model-line render:\n`);
    for (const item of drifted) process.stderr.write(`   - .agents/subagents/agents/${item.name}.md\n`);
    process.stderr.write('   → run `node scripts/common/sync-agent-model-line.js` to heal.\n');
    return 1;
  }
  for (const item of drifted) fs.writeFileSync(item.filePath, item.expected, 'utf8');
  process.stdout.write(`✔ Synced ${drifted.length} agent template(s) model line\n`);
  return 0;
}

if (require.main === module) {
  process.exit(run({ checkOnly: process.argv.includes('--check') || process.argv.includes('--check-only') }));
}

module.exports = { MODEL_LINE_PREFIX, renderAll, renderModelLine, replaceModelLine, run };
