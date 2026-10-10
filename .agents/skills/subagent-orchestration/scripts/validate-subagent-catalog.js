/**
 * Module: Workspace Governance — Subagent Catalog Validator
 * File Path: .agents/skills/subagent-orchestration/scripts/validate-subagent-catalog.js
 * Architecture Role: Verifies the integrity of subagent schemas, archetypes, postures,
 *   associated skills, presets, and detects orphan configs across the workspace.
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

function validateArchetypeSkills(key, arch, errors) {
  for (const skill of arch.associatedSkills || []) {
    const skillPath = path.join(SKILLS_ROOT, skill, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      errors.push(`原型 [${key}] 关联的 Skill 不存在: ${skill} (${skillPath})`);
    }
  }
}

function validateArchetypePathJail(key, arch, errors) {
  const allowed = arch.pathJail?.allowedPrefixes;
  if (!Array.isArray(allowed) || allowed.length === 0) {
    errors.push(`原型 [${key}] 缺失合法的 pathJail.allowedPrefixes 配置`);
  }
  if (!Array.isArray(arch.pathJail?.forbiddenPrefixes)) {
    errors.push(`原型 [${key}] 缺失合法的 pathJail.forbiddenPrefixes 配置`);
  }
}

function validateArchetypeArrays(key, arch, errors) {
  if (!Array.isArray(arch.rigidAxioms) || arch.rigidAxioms.length === 0) {
    errors.push(`原型 [${key}] 缺失非空的 rigidAxioms 数组`);
  }
  if (!Array.isArray(arch.localVerification) || arch.localVerification.length === 0) {
    errors.push(`原型 [${key}] 缺失非空的 localVerification 数组`);
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

  if (arch.rootDirectory && arch.rootDirectory !== '.') {
    const rootPath = path.join(REPO_ROOT, arch.rootDirectory);
    if (!fs.existsSync(rootPath)) {
      errors.push(`原型 [${key}] 声明的 rootDirectory 不存在: ${arch.rootDirectory}`);
    }
  }

  validateArchetypeSkills(key, arch, errors);
  validateArchetypePathJail(key, arch, errors);
  validateArchetypeArrays(key, arch, errors);
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

  const perms = post.toolPermissions;
  if (!perms || typeof perms !== 'object') {
    errors.push(`姿态 [${key}] 缺失 toolPermissions 配置`);
  } else {
    if (typeof perms.enableWriteTools !== 'boolean') {
      errors.push(`姿态 [${key}] toolPermissions.enableWriteTools 必须为 boolean`);
    }
    if (typeof perms.enableMcpTools !== 'boolean') {
      errors.push(`姿态 [${key}] toolPermissions.enableMcpTools 必须为 boolean`);
    }
    if (typeof perms.enableSubagentTools !== 'boolean') {
      errors.push(`姿态 [${key}] toolPermissions.enableSubagentTools 必须为 boolean`);
    }

    if ((key === 'review' || key === 'explore') && perms.enableWriteTools !== false) {
      errors.push(`姿态 [${key}] 为审查/探索只读姿态，enableWriteTools 必须强制为 false`);
    }
  }

  if (!Array.isArray(post.behaviorRules) || post.behaviorRules.length === 0) {
    errors.push(`姿态 [${key}] 缺失非空的 behaviorRules 数组`);
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

function detectOrphanConfigs(catalog, errors) {
  const archetypesDir = path.join(SUBAGENTS_ROOT, 'archetypes');
  const posturesDir = path.join(SUBAGENTS_ROOT, 'postures');

  if (fs.existsSync(archetypesDir)) {
    const archFiles = fs.readdirSync(archetypesDir).filter((f) => f.endsWith('.json'));
    const registered = new Set(Object.values(catalog.archetypes || {}).map((rel) => path.basename(rel)));
    for (const f of archFiles) {
      if (!registered.has(f)) {
        errors.push(`检测到未在 subagent-catalog.json 登记的孤儿原型配置: archetypes/${f}`);
      }
    }
  }

  if (fs.existsSync(posturesDir)) {
    const postFiles = fs.readdirSync(posturesDir).filter((f) => f.endsWith('.json'));
    const registered = new Set(Object.values(catalog.postures || {}).map((rel) => path.basename(rel)));
    for (const f of postFiles) {
      if (!registered.has(f)) {
        errors.push(`检测到未在 subagent-catalog.json 登记的孤儿姿态配置: postures/${f}`);
      }
    }
  }
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
  detectOrphanConfigs(catalog, errors);

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
