/**
 * Module: Workspace Governance — Subagent JIT Synthesizer Engine
 * File Path: .agents/skills/subagent-orchestration/scripts/synthesize-subagent.js
 * Architecture Role: Single source of truth for synthesizing specialized SubAgent definitions
 *   from orthogonal domain archetypes and action postures, with dynamic SSOT binding.
 * Dependencies & Triggers: Invoked via CLI or Node require; depends on fs, path, subagent-catalog.json, rule-catalog.json.
 * Responsibilities: Deduces (Archetype x Posture) from natural language intent, binds live rule counts from
 *   rule-catalog.json and the DSH governance mode declared by catalog.dshModes, and generates
 *   5-layer system contracts and Zero-Intersection Path Jail task shells.
 * Exit Semantics & Design Rationale: 0 = PASS, 1 = Config/Arg Error; decouples generic posture invariants from workspace-unified SSOT metrics.
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
const RULE_CATALOG_PATH = path.join(REPO_ROOT, 'scripts/common/rule-catalog.json');
const REGISTRY_PATH = path.join(REPO_ROOT, 'scripts/common/skill-registry.json');

const { resolveScenarioIntent, INTENT_MATCH_THRESHOLD } = require(
  path.join(REPO_ROOT, 'scripts/common/skill-registry-resolver.js'),
);
const { validateBranchName } = require(
  path.join(REPO_ROOT, 'scripts/common/validate-branch-governance.js'),
);

/** 技能激活契约最多列出的技能条数；其余仅列名，避免契约退化为技能目录。 */
const SKILL_ACTIVATION_LIMIT = 6;

const MODE_ID_PATTERN = /^wg-[a-z]+$/u;

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getTotalRuleCount() {
  try {
    if (fs.existsSync(RULE_CATALOG_PATH)) {
      const ruleCat = JSON.parse(fs.readFileSync(RULE_CATALOG_PATH, 'utf8'));
      if (typeof ruleCat?.totalRules === 'number') {
        return ruleCat.totalRules;
      }
    }
  } catch (_err) {
    return 0;
  }
  return 0;
}

function resolveDshMode(presetDshMode, cliOptions, catalog) {
  const declared = presetDshMode || (MODE_ID_PATTERN.test(cliOptions.dshMode || '') ? cliOptions.dshMode : null);
  if (!declared) {
    return null;
  }
  const info = (catalog.dshModes || {})[declared];
  if (!info) {
    throw new Error(`Unknown DSH governance mode: ${declared}`);
  }
  return { id: declared, ...info };
}

/**
 * 从自由文本意图解析 (原型, 姿态)。
 *
 * 早期实现在此维护第三套正则映射，与技能注册表的 domains 场景表并行演化：
 * 175 个触发词中 143 个路由不到任何原型，`Rust`/`Clippy` 落到 cli-engine、`对象池` 落到
 * git-kernel，且无人校验这份表 —— 改一次领域名，路由就静默指向不存在的专员。
 * 现在唯一的判定来自 `domains[].scenarios[]`：作者的场景表既描述意图，也声明姿态。
 *
 * @param {string} intent - 自由文本意图。
 * @returns {{ archetype: string|null, posture: string|null, scenario: string|null, score: number }}
 *   命中的原型与姿态；无足够相似场景时为 null。
 */
function resolveIntent(intent) {
  let registry = null;
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (_error) {
    registry = null;
  }
  if (!registry) {
    return { archetype: null, posture: null, scenario: null, score: 0 };
  }
  const matched = resolveScenarioIntent(registry, intent);
  return {
    archetype: matched.archetype,
    posture: matched.posture,
    scenario: matched.scenario ? matched.scenario.intent : null,
    score: matched.score,
  };
}

const VALUE_ARG_MAP = {
  '--preset': 'preset',
  '--archetype': 'archetype',
  '--posture': 'posture',
  '--model': 'model',
  '--intent': 'intent',
  '--name': 'name',
  '--task': 'taskGoal',
  '--files': 'exclusiveFiles',
  '--workspace-mode': 'workspaceMode',
  '--dsh-mode': 'dshMode',
  '--cell': 'cell',
  '--card': 'card',
  '--branch': 'branch',
};

const BOOLEAN_ARG_MAP = {
  '--all': 'dumpAll',
  '--dump-all': 'dumpAll',
  '--json': 'json',
  '--allow-adhoc': 'allowAdhoc',
};

/**
 * 断言独占文件列表落在原型授权的沙箱内。
 *
 * 派生任务外壳时曾不校验 `--files`，于是 `--preset fg-construct --files WebGames/x.py`
 * 会生成一份把禁区列为「独占」的任务外壳，而外壳是 SubAgent 唯一可见的授权依据。
 * 沙箱在此处是提示词层的最后一道防线，必须与原型 pathJail 同源。
 *
 * @param {object} archetypeObj - 原型配置。
 * @param {string|null} exclusiveFiles - 逗号分隔的独占文件列表。
 * @returns {void}
 * @throws {Error} 任一文件越界时抛出。
 */
function assertExclusiveFilesInJail(archetypeObj, exclusiveFiles) {
  if (!exclusiveFiles || !String(exclusiveFiles).trim()) return;
  const allowed = archetypeObj.pathJail?.allowedPrefixes || [];
  const forbidden = archetypeObj.pathJail?.forbiddenPrefixes || [];
  const files = String(exclusiveFiles)
    .split(',')
    .map((item) => item.trim().replace(/\\/gu, '/').replace(/^\.\//u, ''))
    .filter(Boolean);
  for (const file of files) {
    const hitForbidden = forbidden.find((prefix) => file.startsWith(prefix));
    if (hitForbidden !== undefined) {
      throw new Error(`独占文件越界: '${file}' 命中禁止前缀 '${hitForbidden}' (原型 ${archetypeObj.archetype})`);
    }
    if (allowed.length > 0 && !allowed.some((prefix) => file.startsWith(prefix))) {
      throw new Error(`独占文件越界: '${file}' 不在授权前缀 [${allowed.join(', ')}] 内 (原型 ${archetypeObj.archetype})`);
    }
  }
}

/**
 * 断言显式参数与预置声明不冲突。
 *
 * 姿态曾在冲突时被静默忽略：`--preset fg-review --posture construct` 会悄悄按 review 输出，
 * 调用方以为派了施工专员，实际拿到只读专员。静默择一比报错更危险。
 *
 * @param {object} cliOptions - 解析后的命令行选项。
 * @param {object|null} preset - 命中的预置记录。
 * @returns {void}
 * @throws {Error} 参数冲突时抛出。
 */
function assertNoOverrideConflict(cliOptions, preset) {
  if (!preset) return;
  if (cliOptions.posture && cliOptions.posture !== preset.posture) {
    throw new Error(
      `参数冲突: --preset ${cliOptions.preset} 的姿态是 ${preset.posture}，与 --posture ${cliOptions.posture} 不符`,
    );
  }
  if (cliOptions.archetype && cliOptions.archetype !== preset.archetype) {
    throw new Error(
      `参数冲突: --preset ${cliOptions.preset} 的原型是 ${preset.archetype}，与 --archetype ${cliOptions.archetype} 不符`,
    );
  }
}

function parseCliArgs(argv) {
  const options = {
    preset: null,
    archetype: null,
    posture: null,
    intent: null,
    name: null,
    taskGoal: null,
    exclusiveFiles: null,
    workspaceMode: 'inherit',
    model: 'inherit',
    dshMode: null,
    cell: null,
    card: null,
    branch: null,
    dumpAll: false,
    json: false,
    allowAdhoc: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const valKey = VALUE_ARG_MAP[arg];
    if (valKey && i + 1 < argv.length) {
      options[valKey] = argv[++i];
      continue;
    }
    const boolKey = BOOLEAN_ARG_MAP[arg];
    if (boolKey) {
      options[boolKey] = true;
    }
  }

  return options;
}

function formatExclusiveFilesLine(isReadOnly, exclusiveFiles) {
  if (isReadOnly) {
    return '- Permissions: Read-only mode (enable_write_tools: false; file edits strictly forbidden).';
  }
  if (!exclusiveFiles || !String(exclusiveFiles).trim()) {
    return '- Exclusive Files: <list mutually orthogonal file paths>';
  }
  const items = String(exclusiveFiles)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) {
    return '- Exclusive Files: <list mutually orthogonal file paths>';
  }
  const numbered = items.map((f, idx) => `  ${idx + 1}. ${f}`).join('\n');
  return `- Exclusive Files (Zero-Intersection Path Jail; touching external files forbidden):\n${numbered}`;
}

/**
 * 从技能注册表读出每个技能的一句话职责，用于渲染技能激活契约。
 *
 * 契约曾只把 12 个技能名拼成一行「核心参考技能」，实测 27 份专员模板无一携带技能绑定，
 * 于是 SubAgent 收到的是清单而不是过程知识：它知道自己"参考"哪些技能，却没有任何指令
 * 要求真正读取正文。这正是「委派了却没激活技能」的失效模式。
 *
 * @param {string[]} skillNames - 原型声明的技能名，顺序即加载优先级。
 * @returns {Array<{ name: string, duty: string }>} 技能与职责。
 */
function resolveSkillDuties(skillNames) {
  let registry = null;
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (_error) {
    registry = null;
  }
  return skillNames.map((skillName) => {
    const record = registry?.skills?.[skillName];
    const firstSentence = String(record?.purpose || record?.pitch || '').split(/[。；]/u)[0];
    return { name: skillName, duty: firstSentence.length > 0 ? firstSentence : 'primary domain responsibility' };
  });
}

/**
 * 渲染技能激活契约。
 *
 * 只列前 6 条：关联技能最长 14 条，全列会把契约撑成一份目录，而注意力预算有限。
 * 前 6 条按领域链顺序取，即原型作者声明的优先级。
 *
 * @param {object} archetypeObj - 原型配置。
 * @returns {string} Layer 1.5 正文。
 */
function renderSkillActivationContract(archetypeObj) {
  const duties = resolveSkillDuties(archetypeObj.associatedSkills || []);
  const primary = duties.slice(0, SKILL_ACTIVATION_LIMIT);
  const rest = duties.slice(SKILL_ACTIVATION_LIMIT);
  const lines = primary.map(
    (item, index) => `  ${index + 1}. \`${item.name}\`: ${item.duty}`,
  );
  const restLine = rest.length > 0
    ? `\n  On-demand: ${rest.map((item) => `\`${item.name}\``).join(', ')}`
    : '';
  return `Read required \`SKILL.md\` before execution (Layer 2 rigid axioms take precedence):\n${lines.join('\n')}${restLine}`;
}

function buildSystemPrompt(archetypeObj, postureObj) {
  const totalRules = getTotalRuleCount();
  const allowedList = archetypeObj.pathJail.allowedPrefixes.map((p) => `  - ${p}`).join('\n');
  const forbiddenList = archetypeObj.pathJail.forbiddenPrefixes.map((p) => `  - ${p}`).join('\n');
  const axiomList = archetypeObj.rigidAxioms.map((a, idx) => `  ${idx + 1}. ${a}`).join('\n');
  const postureRuleList = postureObj.behaviorRules.map((r, idx) => `  ${idx + 1}. ${r}`).join('\n');
  const isReadOnly = postureObj?.toolPermissions?.enableWriteTools === false;
  const verifyCommands = archetypeObj.localVerification.map((c) => `  $ ${c}`).join('\n');

  const verifySection = isReadOnly
    ? `## Layer 4: Verification (Read-Only)
Write tools stripped. Report factual evidence: exact file paths, line numbers, and registered SSOT rule IDs.`
    : `## Layer 4: Local Verification
Must pass before completion (clean build, test regression, and static rules green):
${verifyCommands}`;

  return `# SubAgent System Contract: [${archetypeObj.archetype}] x [${postureObj.posture}]
## Layer 0: Precedence
\`AGENTS.md\` is supreme. Precedence: Layer 2 Domain Axioms > Contract Layers > Skill Docs; conflicts yield to \`AGENTS.md\`.
## Layer 1: Path Jail Guard
* Allowed prefixes:
${allowedList}
* Forbidden prefixes (strictly blocked):
${forbiddenList}
* SSOT rule closure required; zero fabricated rule IDs (\`RCFG-RULE-DRIFT\`).
## Layer 1.5: Skill Activation
${renderSkillActivationContract(archetypeObj)}
## Layer 2: Domain Rigid Axioms
${axiomList}
## Layer 3: Posture Invariants (${postureObj.posture})
${postureRuleList}
${verifySection}
`;
}

/** 原型到单元 cell-id 的标准化映射，避免各自拼出漂移分支前缀。 */
const ARCHETYPE_CELL_MAP = Object.freeze({
  'vs-extension': 'workspace-timing',
  'cli-engine': 'auto-refactor',
  'game-engine': 'webgames',
  'git-kernel': 'fractal-git',
  'infra-tool': 'infra',
  'workspace-meta': 'governance',
  'skill-governance': 'governance',
});

/**
 * 将自由文本规范化为小写 kebab-case 片段。
 *
 * @param {string} raw - 原始字符串。
 * @param {string} fallback - 清洗后为空时的兜底片段。
 * @returns {string} 合规 kebab-case 片段。
 */
function sanitizeSlug(raw, fallback) {
  const cleaned = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 28)
    .replace(/-+$/u, '');
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * 推导并校验 SubAgent 对应的五级分形分支坐标。
 *
 * @param {object} params - 原型、姿态与命令行参数。
 * @returns {object} 分支拓扑坐标摘要。
 * @throws {Error} 显式传入的分支不满足五级分形命名或单元格白名单时抛出。
 */
function deriveBranchTopology({ archKey, postKey, cliOptions = {} }) {
  const cellId = sanitizeSlug(cliOptions.cell || ARCHETYPE_CELL_MAP[archKey] || 'core', 'core');
  const cardSeed = cliOptions.card || cliOptions.taskGoal || `${archKey}-${postKey}`;
  const cardId = sanitizeSlug(cardSeed, `${postKey}-task`);
  const subagentId = sanitizeSlug(cliOptions.name || `${archKey}-${postKey}`, 'worker');
  const candidate = cliOptions.branch
    ? String(cliOptions.branch).trim()
    : `cell/${cellId}/card/${cardId}/sub/${subagentId}`;
  const check = validateBranchName(candidate);
  if (!check.valid) {
    throw new Error(`分支坐标不合规 (FGT-TOP-001): ${check.error}`);
  }
  return {
    cellId,
    cardId,
    subagentId,
    recommendedBranch: candidate,
    parentCardBranch: `cell/${cellId}/card/${cardId}/main`,
    parentCellBranch: `cell/${cellId}/main`,
    tier: check.tier,
    facadeFor: check.facadeFor || null,
  };
}

function buildTaskPromptTemplate(params) {
  const {
    taskGoal,
    archetypeObj,
    postureObj,
    exclusiveFiles = null,
    branchTopology = null,
    workspaceMode = 'inherit',
    hasExplicitBranchOpts = false,
  } = params;
  const goalText = taskGoal || '<targeted technical task description and acceptance criteria>';
  const isReadOnly = postureObj?.toolPermissions?.enableWriteTools === false;
  const exclusiveFilesLine = formatExclusiveFilesLine(isReadOnly, exclusiveFiles);
  const includeBranchLine = branchTopology && (workspaceMode !== 'inherit' || hasExplicitBranchOpts);
  const branchLine = includeBranchLine
    ? `\n- Fractal Branch (FGT-TOP-001): \`${branchTopology.recommendedBranch}\` (strict parent: \`${branchTopology.parentCardBranch}\`)`
    : '';

  const verifyDirective = isReadOnly
    ? `[Pre-Delivery Verification]
Read-only mode. Provide factual file paths, line numbers, and rule IDs based on Layer 4.`
    : `[Pre-Delivery Verification]
Execute and pass all Layer 4 verification commands with zero High/Critical debt before delivery.`;

  return `[Task Scope & Zero-Intersection Path Jail]
${exclusiveFilesLine}${branchLine}

[Objective]
${goalText}

${verifyDirective}
`;
}

function synthesizeSingle(params) {
  const {
    archKey,
    postKey,
    cliOptions,
    catalog,
    presetKey = null,
    defaultDesc = '',
    presetDshMode = null,
  } = params;
  const archRel = catalog.archetypes[archKey];
  const postRel = catalog.postures[postKey];
  if (!archRel) throw new Error(`Unknown archetype: ${archKey}`);
  if (!postRel) throw new Error(`Unknown posture: ${postKey}`);

  const archetypeObj = readJson(path.join(SUBAGENTS_ROOT, archRel));
  const postureObj = readJson(path.join(SUBAGENTS_ROOT, postRel));
  assertExclusiveFilesInJail(archetypeObj, cliOptions.exclusiveFiles);

  const subagentName = cliOptions.name || presetKey || `${archKey}-${postKey}`;
  const subagentDesc = defaultDesc || `${archetypeObj.displayName} (${postureObj.displayName})`;
  const workspaceMode = cliOptions.workspaceMode || 'inherit';
  const branchTopology = deriveBranchTopology({ archKey, postKey, cliOptions });
  const hasExplicitBranchOpts = Boolean(cliOptions.cell || cliOptions.card || cliOptions.branch);
  const systemPrompt = buildSystemPrompt(archetypeObj, postureObj);
  const taskPrompt = buildTaskPromptTemplate({
    taskGoal: cliOptions.taskGoal,
    archetypeObj,
    postureObj,
    exclusiveFiles: cliOptions.exclusiveFiles,
    branchTopology,
    workspaceMode,
    hasExplicitBranchOpts,
  });

  const targetModel = cliOptions.model || postureObj.model || catalog.defaultModel || 'inherit';
  const dshMode = resolveDshMode(presetDshMode, cliOptions, catalog);

  return {
    subagentName,
    archetype: archKey,
    posture: postKey,
    displayName: `${archetypeObj.displayName} (${postureObj.displayName})`,
    description: subagentDesc,
    model: targetModel,
    workspaceMode,
    branchTopology,
    dshMode,
    defineArgs: {
      name: subagentName,
      description: subagentDesc,
      system_prompt: systemPrompt,
      enable_write_tools: postureObj.toolPermissions.enableWriteTools,
      enable_mcp_tools: postureObj.toolPermissions.enableMcpTools,
      enable_subagent_tools: postureObj.toolPermissions.enableSubagentTools,
    },
    invokeArgs: {
      TypeName: subagentName,
      Role: `${archetypeObj.displayName} (${postureObj.displayName})`,
      Model: targetModel,
      Workspace: cliOptions.workspaceMode || 'inherit',
      Prompt: taskPrompt,
    },
  };
}

function resolvePresetTarget(presetKey, catalog) {
  const preset = catalog.presets[presetKey];
  if (!preset) {
    throw new Error(`Preset "${presetKey}" not found in subagent catalog`);
  }
  return {
    archKey: preset.archetype,
    postKey: preset.posture,
    defaultDesc: preset.description,
    matchedPresetKey: presetKey,
    dshMode: preset.dshMode || null,
  };
}

function matchPresetByKeys(archKey, postKey, catalog) {
  for (const [pKey, pVal] of Object.entries(catalog.presets)) {
    if (pVal.archetype === archKey && pVal.posture === postKey) {
      return { matchedPresetKey: pKey, defaultDesc: pVal.description, dshMode: pVal.dshMode || null };
    }
  }
  return { matchedPresetKey: null, defaultDesc: '', dshMode: null };
}

function resolveArchetypeAndPosture(cliOptions, catalog) {
  if (cliOptions.preset) {
    return resolvePresetTarget(cliOptions.preset, catalog);
  }

  let archKey = cliOptions.archetype;
  let postKey = cliOptions.posture;
  let intentNote = '';

  if (cliOptions.intent && (!archKey || !postKey)) {
    const deduced = resolveIntent(cliOptions.intent);
    archKey = archKey || deduced.archetype;
    postKey = postKey || deduced.posture;
    if (!deduced.archetype) {
      intentNote =
        `\n--intent "${cliOptions.intent}" 未匹配任何领域场景（最高相似度 ${deduced.score.toFixed(2)} < ${INTENT_MATCH_THRESHOLD}）。` +
        '\n可用场景见 `scripts/common/skill-registry.json` 的 `domains[].scenarios[]`；' +
        '也可直接传 --preset 或 --archetype + --posture。';
    } else if (deduced.scenario) {
      intentNote = `\n--intent 命中场景「${deduced.scenario}」（相似度 ${deduced.score.toFixed(2)}）。`;
    }
  }

  if (!archKey || !postKey) {
    throw new Error(
      'Could not resolve both archetype and posture. Specify --preset, --archetype + --posture, or a clear --intent'
      + intentNote
    );
  }

  const { matchedPresetKey, defaultDesc, dshMode } = matchPresetByKeys(archKey, postKey, catalog);
  return { archKey, postKey, defaultDesc, matchedPresetKey, dshMode };
}
/**
 * 断言 (archetype × posture) 有预置支撑。
 *
 * 7 原型 × 5 姿态的笛卡尔积是 35 组，而预置只有 27 条。缺预置的组合会被当场合成出一个
 * 无审计过的专员（如 `workspace-meta-construct`，可开写权限），其描述、红线与门禁命令
 * 都不在任何单源目录中登记过。确需临时装配时必须显式声明，让调用点留痕。
 *
 * @param {object} resolved - 解析结果。
 * @param {object} cliOptions - 命令行选项。
 * @returns {void}
 * @throws {Error} 无预置支撑且未显式放行时抛出。
 */
function assertPresetBacked(resolved, cliOptions) {
  if (resolved.matchedPresetKey || cliOptions.allowAdhoc) return;
  throw new Error(
    `${resolved.archKey} × ${resolved.postKey} 无预置专员；若确需临时装配，请显式传 --allow-adhoc`,
  );
}

function synthesize(cliOptions) {
  const catalog = readJson(CATALOG_PATH);

  if (cliOptions.dumpAll) {
    const allResults = {};
    for (const [pKey, preset] of Object.entries(catalog.presets)) {
      allResults[pKey] = synthesizeSingle({
        archKey: preset.archetype,
        postKey: preset.posture,
        cliOptions,
        catalog,
        presetKey: pKey,
        defaultDesc: preset.description,
        presetDshMode: preset.dshMode || null,
      });
    }
    return { dumpAll: true, presets: allResults };
  }

  if (cliOptions.preset) {
    assertNoOverrideConflict(cliOptions, catalog.presets[cliOptions.preset] || null);
  }
  const { archKey, postKey, defaultDesc, matchedPresetKey, dshMode } = resolveArchetypeAndPosture(
    cliOptions,
    catalog
  );
  assertPresetBacked({ archKey, postKey, matchedPresetKey }, cliOptions);
  return synthesizeSingle({
    archKey,
    postKey,
    cliOptions,
    catalog,
    presetKey: matchedPresetKey,
    defaultDesc,
    presetDshMode: dshMode,
  });
}

/**
 * 自证：每类守卫必须真的拒绝其声称拦截的缺陷。
 *
 * 这些断言平时都跑在合法输入上，全绿的结果与「守卫是死代码」无法区分。每条探针喂入
 * 一份携带单一缺陷的输入，断言它确实被拒；再补一条合法输入断言它被接受，
 * 否则「拒绝一切」也能让所有探针通过。
 *
 * @returns {string[]} 探针失败项。
 */
function runSelfProbes() {
  const failures = [];
  const expect = (label, fn, wanted) => {
    let outcome;
    try {
      fn();
      outcome = 'ACCEPTED';
    } catch (_error) {
      outcome = 'REJECTED';
    }
    if (outcome !== wanted) failures.push(`probe "${label}": expected ${wanted}, got ${outcome}`);
  };
  const jail = {
    archetype: 'probe',
    pathJail: { allowedPrefixes: ['proj/'], forbiddenPrefixes: ['other/'] },
    rigidAxioms: ['axiom'],
    localVerification: ['cmd'],
    associatedSkills: ['skill-a'],
    displayName: 'Probe',
  };

  expect(
    'out-of-jail-file-rejected',
    () => assertExclusiveFilesInJail(jail, 'other/secret.py'),
    'REJECTED',
  );
  expect(
    'out-of-prefix-file-rejected',
    () => assertExclusiveFilesInJail(jail, 'elsewhere/x.ts'),
    'REJECTED',
  );
  expect('in-jail-file-accepted', () => assertExclusiveFilesInJail(jail, 'proj/a.ts'), 'ACCEPTED');
  expect('empty-file-list-accepted', () => assertExclusiveFilesInJail(jail, null), 'ACCEPTED');

  expect(
    'posture-conflict-rejected',
    () => assertNoOverrideConflict({ preset: 'p', posture: 'construct' }, { posture: 'review', archetype: 'a' }),
    'REJECTED',
  );
  expect(
    'matching-posture-accepted',
    () => assertNoOverrideConflict({ preset: 'p', posture: 'review' }, { posture: 'review', archetype: 'a' }),
    'ACCEPTED',
  );

  expect('adhoc-without-flag-rejected', () => assertPresetBacked({ archKey: 'a', postKey: 'b', matchedPresetKey: null }, {}), 'REJECTED');
  expect(
    'adhoc-with-flag-accepted',
    () => assertPresetBacked({ archKey: 'a', postKey: 'b', matchedPresetKey: null }, { allowAdhoc: true }),
    'ACCEPTED',
  );
  expect(
    'preset-backed-accepted',
    () => assertPresetBacked({ archKey: 'a', postKey: 'b', matchedPresetKey: 'p' }, {}),
    'ACCEPTED',
  );
  expect(
    'default-fractal-branch-accepted',
    () => deriveBranchTopology({ archKey: 'git-kernel', postKey: 'construct', cliOptions: {} }),
    'ACCEPTED',
  );
  expect(
    'explicit-subagent-branch-accepted',
    () => deriveBranchTopology({
      archKey: 'git-kernel',
      postKey: 'construct',
      cliOptions: { branch: 'cell/fractal-git/card/k1/sub/fg-construct' },
    }),
    'ACCEPTED',
  );
  expect(
    'adhoc-branch-rejected',
    () => deriveBranchTopology({
      archKey: 'git-kernel',
      postKey: 'construct',
      cliOptions: { branch: 'adhoc/random-branch' },
    }),
    'REJECTED',
  );
  return failures;
}

function run() {
  const options = parseCliArgs(process.argv.slice(2));
  const probeFailures = runSelfProbes();
  if (probeFailures.length > 0) {
    console.error('❌ [FAIL] 合成器自证失败（守卫不再具备区分能力）:');
    for (const failure of probeFailures) console.error(`   - ${failure}`);
    process.exit(1);
  }
  try {
    const result = synthesize(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.dumpAll) {
      console.log(`\n======================================================`);
      console.log(`🤖 全工作区预置 SubAgent 批量导出 (${Object.keys(result.presets).length} 专员)`);
      console.log(`======================================================`);
      for (const [k, p] of Object.entries(result.presets)) {
        console.log(`• [${k}]: ${p.displayName} -> WriteTools=${p.defineArgs.enable_write_tools}, Model=${p.model}, DshMode=${p.dshMode ? p.dshMode.id : '无'}`);
      }
    } else {
      console.log(`\n======================================================`);
      console.log(`🤖 SubAgent 泛化装配规格: ${result.subagentName}`);
      console.log(`======================================================`);
      console.log(`• 领域原型: ${result.archetype}`);
      console.log(`• 作业姿态: ${result.posture}`);
      console.log(`• 选定模型: ${result.model} (同构继承主会话 ${result.model})`);
      console.log(`• 工作区模式: ${result.workspaceMode}`);
      if (result.branchTopology) {
        console.log(`• 分形分支坐标: ${result.branchTopology.recommendedBranch} (parent=${result.branchTopology.parentCardBranch})`);
      }
      const modeLine = result.dshMode
        ? `${result.dshMode.id} (${result.dshMode.name}, posture=${result.dshMode.posture}, order=${result.dshMode.order}, terminal=${result.dshMode.terminal})`
        : '未绑定 (请显式传入 --dsh-mode wg-construct|wg-refactor|wg-review|wg-explore)';
      console.log(`• DSH 治理模式: ${modeLine}`);
      console.log(`• 权限开关: 写入/命令=${result.defineArgs.enable_write_tools}, MCP=${result.defineArgs.enable_mcp_tools}, SubAgent=${result.defineArgs.enable_subagent_tools}`);
      console.log(`\n--- 组装完成的 define_subagent 元数据 ---`);
      console.log(JSON.stringify(result.defineArgs, null, 2));
      console.log(`\n--- 推荐的 invoke_subagent 调用参数 ---`);
      console.log(JSON.stringify(result.invokeArgs, null, 2));
    }
    process.exit(0);
  } catch (err) {
    console.error(`❌ [Synthesizer Error] ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  synthesize,
  buildSystemPrompt,
  buildTaskPromptTemplate,
  resolveIntent,
  parseCliArgs,
  assertExclusiveFilesInJail,
  assertNoOverrideConflict,
  assertPresetBacked,
  deriveBranchTopology,
  runSelfProbes,
};
