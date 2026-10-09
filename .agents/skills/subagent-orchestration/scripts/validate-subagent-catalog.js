/**
 * Module: Workspace Governance — Subagent Catalog Validator
 * File Path: .agents/skills/subagent-orchestration/scripts/validate-subagent-catalog.js
 * Architecture Role: Verifies the integrity of subagent schemas, archetypes, postures,
 *   associated skills, and presets across the workspace.
 * Dependencies: Node.js standard library (fs, path).
 * Exit Semantics: 0 = PASS, 1 = FAIL.
 */
'use strict';

const fs = require('fs');
const path = require('path');

function findRepoRoot(startDir) {
  let curr = path.resolve(startDir);
  while (curr !== path.dirname(curr)) {
    if (fs.existsSync(path.join(curr, 'AGENTS.md')) && fs.existsSync(path.join(curr, '.agents'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return path.resolve(startDir, '../../../../');
}

const REPO_ROOT = findRepoRoot(__dirname);
const SUBAGENTS_ROOT = path.join(REPO_ROOT, '.agents/subagents');
const CATALOG_PATH = path.join(SUBAGENTS_ROOT, 'subagent-catalog.json');
const SKILLS_ROOT = path.join(REPO_ROOT, '.agents/skills');

function validateDefaultModel(catalog, errors) {
  if (catalog.defaultModel !== 'inherit' && catalog.defaultModel !== 'flash') {
    errors.push(`catalog.defaultModel 必须声明为 "inherit" 或 "flash"，当前为 "${catalog.defaultModel}"`);
  }
}

function validateSingleArchetype(key, relPath, errors) {
  const fullPath = path.join(SUBAGENTS_ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    errors.push(`原型 [${key}] 指向的文件不存在: ${relPath}`);
    return;
  }
  const arch = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  if (arch.archetype !== key) {
    errors.push(`原型文件内部 archetype 字段 ("${arch.archetype}") 与 catalog key ("${key}") 不匹配`);
  }

  for (const skill of arch.associatedSkills || []) {
    const skillPath = path.join(SKILLS_ROOT, skill, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      errors.push(`原型 [${key}] 关联的 Skill 不存在: ${skill} (${skillPath})`);
    }
  }

  if (!arch.pathJail || !Array.isArray(arch.pathJail.allowedPrefixes)) {
    errors.push(`原型 [${key}] 缺失合法的 pathJail.allowedPrefixes 配置`);
  }
}

function validateArchetypes(catalog, errors) {
  const archKeys = Object.keys(catalog.archetypes || {});
  if (archKeys.length === 0) {
    errors.push('未定义任何领域原型 (archetypes)');
    return archKeys;
  }
  for (const [key, relPath] of Object.entries(catalog.archetypes)) {
    validateSingleArchetype(key, relPath, errors);
  }
  return archKeys;
}

function validateSinglePosture(key, relPath, errors) {
  const fullPath = path.join(SUBAGENTS_ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    errors.push(`姿态 [${key}] 指向的文件不存在: ${relPath}`);
    return;
  }
  const post = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  if (post.posture !== key) {
    errors.push(`姿态文件内部 posture 字段 ("${post.posture}") 与 catalog key ("${key}") 不匹配`);
  }
  if (post.model !== 'inherit' && post.model !== 'flash') {
    errors.push(`姿态 [${key}] 声明的模型必须为 "inherit" 或 "flash"，当前为 "${post.model}"`);
  }
}

function validatePostures(catalog, errors) {
  const postKeys = Object.keys(catalog.postures || {});
  if (postKeys.length === 0) {
    errors.push('未定义任何作业姿态 (postures)');
    return postKeys;
  }
  for (const [key, relPath] of Object.entries(catalog.postures)) {
    validateSinglePosture(key, relPath, errors);
  }
  return postKeys;
}

function validatePresets(catalog, errors) {
  const presets = Object.entries(catalog.presets || {});
  for (const [name, p] of presets) {
    if (!catalog.archetypes[p.archetype]) {
      errors.push(`预置 [${name}] 引用了未知的 archetype: ${p.archetype}`);
    }
    if (!catalog.postures[p.posture]) {
      errors.push(`预置 [${name}] 引用了未知的 posture: ${p.posture}`);
    }
    if (p.model && p.model !== 'inherit' && p.model !== 'flash') {
      errors.push(`预置 [${name}] 的模型覆盖必须为 "inherit" 或 "flash"，当前为 "${p.model}"`);
    }
  }
  return presets;
}

function validate() {
  console.log('▶ [SubAgent 验证] 检查全工作区通用 SubAgent 注册表与配置完整性...');

  if (!fs.existsSync(CATALOG_PATH)) {
    console.error(`❌ [FAIL] 未找到 subagent-catalog.json: ${CATALOG_PATH}`);
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const errors = [];

  validateDefaultModel(catalog, errors);
  const archKeys = validateArchetypes(catalog, errors);
  const postKeys = validatePostures(catalog, errors);
  const presets = validatePresets(catalog, errors);

  if (errors.length > 0) {
    console.error(`\n❌ [FAIL] 检测到 ${errors.length} 项 SubAgent 配置违背:`);
    errors.forEach((e) => console.error(`   - ${e}`));
    process.exit(1);
  }

  console.log(`  ✔ [PASS] SubAgent 体系校验通过: ${archKeys.length} 领域原型, ${postKeys.length} 姿态, ${presets.length} 预置全量合规 (模型同构继承 inherit / flash)`);
  process.exit(0);
}

if (require.main === module) {
  validate();
}

module.exports = { validate };
