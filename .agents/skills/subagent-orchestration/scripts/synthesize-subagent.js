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
    return '- 权限与模式：只读审查模式（enable_write_tools: false，严禁创建或修改任何文件）';
  }
  if (!exclusiveFiles || !String(exclusiveFiles).trim()) {
    return '- 独占文件列表：<请在此列出两两正交的独占文件路径>';
  }
  const items = String(exclusiveFiles)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) {
    return '- 独占文件列表：<请在此列出两两正交的独占文件路径>';
  }
  const numbered = items.map((f, idx) => `  ${idx + 1}. ${f}`).join('\n');
  return `- 独占文件列表 (Zero-Intersection Path Jail，严禁触碰列表外任何文件)：\n${numbered}`;
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
    return { name: skillName, duty: firstSentence.length > 0 ? firstSentence : '（未登记职责，按技能名判断）' };
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
    (item, index) => `  ${index + 1}. \`${item.name}\` — ${item.duty}`,
  );
  const restLine = rest.length > 0
    ? `\n  其余关联技能（命中具体问题时再加载）：${rest.map((item) => `\`${item.name}\``).join('、')}`
    : '';
  return `行动前必须先读取下列技能的 \`SKILL.md\` 正文并遵守其约束；仅知道技能名不算遵守。
${lines.join('\n')}${restLine}

禁止加载本契约未列出的技能。技能内容与本契约 Layer 2 冲突时，以 Layer 2 为准。`;
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
    ? `## 🧪 Layer 4: 本地门禁自检契约 (只读审查姿态)
只读姿态已物理剥夺写权限，严禁执行产物编译或写入测试；向主 Agent 汇报时必须提供基于 ${totalRules} 规则库与所属领域刚性公理的纯客观文件路径、起始行号与质性技术依据。`
    : `## 🧪 Layer 4: 本地门禁自检契约 (构建 + 测试 + 静态规则三重闭环)
交割任务前，必须在所属工作目录下依次执行并通过以下本地验证命令（测试全绿仅为必要底线，绝不等同于符合审查或通过门禁，必须确保编译、测试与静态规则全部绿色）：
${verifyCommands}`;

  return `# SubAgent System Contract: [${archetypeObj.displayName}] × [${postureObj.displayName}]

> 本提示词由工作区 JIT 合成引擎自动生成，代表当前 SubAgent 必须遵守的刚性执行契约。

## 🏛️ Layer 0: 公理来源与优先级
平台已无条件注入 \`AGENTS.md\`（工作区治理总枢），其中含物理卫生、复杂度预算、门面设计、
规则真实性、零高危技术债与会话隔离公理。本契约不重复其条款，仅补充本专员特有约束。
优先级：Layer 2 领域公理 > 本契约其余各层 > 技能正文；与 \`AGENTS.md\` 冲突时以 \`AGENTS.md\` 为准。

## 🛡️ Layer 1: 物理路径沙箱约束 (Path Jail Guard)
* 授权操作路径前缀：
${allowedList}
* 严禁触碰路径前缀（越界操作立即阻断）：
${forbiddenList}
* 单源规则目录权威收录 ${totalRules} 条规则，严禁虚构规则 ID (\`RCFG-RULE-DRIFT\`)。

## 🧠 Layer 1.5: 技能激活契约 (Skill Activation)
${renderSkillActivationContract(archetypeObj)}

## ⚖️ Layer 2: 领域刚性公理与技术栈规范
${axiomList}

## 🎯 Layer 3: 作业姿态与行为限定 (${postureObj.displayName})
${postureRuleList}

${verifySection}
`;
}

function buildTaskPromptTemplate(params) {
  const { taskGoal, archetypeObj, postureObj, exclusiveFiles = null } = params;
  const goalText = taskGoal || '<请在此处填写针对性技术任务描述与预期验收条件>';
  const isReadOnly = postureObj?.toolPermissions?.enableWriteTools === false;
  const exclusiveFilesLine = formatExclusiveFilesLine(isReadOnly, exclusiveFiles);

  const verifyDirective = isReadOnly
    ? `[Pre-Delivery Verification]
只读审查模式，严禁写操作；汇报时必须对照 System Contract Layer 4 提供纯客观文件路径、起始行号与质性技术依据。`
    : `[Pre-Delivery Verification]
交割前必须执行并通过 System Contract Layer 4 规定的本地自检命令（构建 + 测试 + 静态规则三重闭环），确保全量通过且零 High/Critical 技术债务。`;

  return `[Task Scope & Zero-Intersection Path Jail]
${exclusiveFilesLine}

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
  const subagentDesc = defaultDesc || `${archetypeObj.displayName} 的 ${postureObj.displayName}`;
  const systemPrompt = buildSystemPrompt(archetypeObj, postureObj);
  const taskPrompt = buildTaskPromptTemplate({
    taskGoal: cliOptions.taskGoal,
    archetypeObj,
    postureObj,
    exclusiveFiles: cliOptions.exclusiveFiles,
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
    workspaceMode: cliOptions.workspaceMode || 'inherit',
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
  runSelfProbes,
};
