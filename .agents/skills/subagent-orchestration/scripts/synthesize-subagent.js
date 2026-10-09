/**
 * Module: Workspace Governance — Subagent JIT Synthesizer Engine
 * File Path: .agents/skills/subagent-orchestration/scripts/synthesize-subagent.js
 * Architecture Role: Single source of truth for synthesizing specialized SubAgent definitions
 *   from orthogonal domain archetypes and action postures, with intent deduction and prompt templating.
 * Dependencies: Node.js standard library (fs, path).
 * Exit Semantics: 0 = PASS, 1 = Config/Arg Error.
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

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveIntent(intent) {
  const text = (intent || '').toLowerCase();
  let archKey = null;
  let postKey = null;

  if (/skill|技能|skills/.test(text)) {
    archKey = 'skill-governance';
  } else if (/workspace-timing|timing|\bwt\b|vscode|扩展|插件/.test(text)) {
    archKey = 'vs-extension';
  } else if (/auto-refactor|\bar\b|cli|分析器|静态分析/.test(text)) {
    archKey = 'cli-engine';
  } else if (/webgames|\bwg\b|godot|gdscript|游戏|卡拉尔/.test(text)) {
    archKey = 'game-engine';
  } else if (/infra|scripts|脚本|门禁|发布|package/.test(text)) {
    archKey = 'infra-tool';
  } else if (/workspace|全仓|工作区|治理|audit-all|公理/.test(text)) {
    archKey = 'workspace-meta';
  }

  if (/审查|review|检查|合规|分析|诊断/.test(text)) {
    postKey = 'review';
  } else if (/重构|refactor|消融|解耦|瘦身|优化/.test(text)) {
    postKey = 'refactor';
  } else if (/开发|编码|实现|特性|construct|增量|编写/.test(text)) {
    postKey = 'construct';
  } else if (/探索|调研|排查|explore|探针|调查/.test(text)) {
    postKey = 'explore';
  } else if (/守卫|巡检|guardian|门禁|防御/.test(text)) {
    postKey = 'guardian';
  }

  return { archetype: archKey, posture: postKey };
}

const VALUE_ARG_MAP = {
  '--preset': 'preset',
  '--archetype': 'archetype',
  '--posture': 'posture',
  '--model': 'model',
  '--intent': 'intent',
  '--name': 'name',
  '--task': 'taskGoal',
  '--workspace-mode': 'workspaceMode',
};

const BOOLEAN_ARG_MAP = {
  '--all': 'dumpAll',
  '--dump-all': 'dumpAll',
  '--json': 'json',
};

function parseCliArgs(argv) {
  const options = {
    preset: null,
    archetype: null,
    posture: null,
    intent: null,
    name: null,
    taskGoal: null,
    workspaceMode: 'inherit',
    model: 'inherit',
    dumpAll: false,
    json: false,
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

function buildSystemPrompt(archetypeObj, postureObj) {
  const allowedList = archetypeObj.pathJail.allowedPrefixes.map((p) => `  - ${p}`).join('\n');
  const forbiddenList = archetypeObj.pathJail.forbiddenPrefixes.map((p) => `  - ${p}`).join('\n');
  const axiomList = archetypeObj.rigidAxioms.map((a, idx) => `  ${idx + 1}. ${a}`).join('\n');
  const postureRuleList = postureObj.behaviorRules.map((r, idx) => `  ${idx + 1}. ${r}`).join('\n');
  const verifyCommands = archetypeObj.localVerification.map((c) => `  $ ${c}`).join('\n');
  const skillList = archetypeObj.associatedSkills.join(', ');

  return `# SubAgent System Contract: [${archetypeObj.displayName}] × [${postureObj.displayName}]

> 本提示词由工作区 JIT 合成引擎自动生成，代表当前 SubAgent 必须遵守的刚性执行契约。

## 🏛️ Layer 0: 工作区全局刚性公理 (AGENTS.md)
1. 物理卫生：全仓严禁创建或遗留 0 字节空文件；脚本必须严格保持换行契约（.ps1 CRLF，其他 LF）；
2. 复杂度预算：圈复杂度 CC <= 15，控制流深度 Depth <= 4，单文件双轨体积 ELOC <= 900 / LOC <= 1400；
3. 门面设计：门面层必须满足 ELOC >= 15 或 Object.freeze 不可变保障，严禁 <= 3 行空包跳板 (ARCH-ABS-001)；
4. 真实性纪律：严禁虚构规则 ID (RCFG-RULE-DRIFT)，禁止敷衍/夸大词汇与施工临时黑话；
5. 零高危技术债：全工作区 High/Critical 债务历史性归零 (0 项)，严禁引入任何技术债务反弹 (一票否决)。

## 🛡️ Layer 1: 物理路径沙箱约束 (Path Jail Guard)
* 授权操作路径前缀：
${allowedList}
* 严禁触碰路径前缀（越界操作立即阻断）：
${forbiddenList}
* 核心参考技能 (Skills)：${skillList}

## ⚖️ Layer 2: 领域刚性公理与技术栈规范
${axiomList}

## 🎯 Layer 3: 作业姿态与行为限定 (${postureObj.displayName})
${postureRuleList}

## 🧪 Layer 4: 本地门禁自检契约
交割任务前，必须在所属工作目录下依次执行并通过以下本地验证命令：
${verifyCommands}
`;
}

function buildTaskPromptTemplate(taskGoal, archetypeObj, postureObj) {
  const goalText = taskGoal || '<请在此处填写针对性技术任务描述与预期验收条件>';
  const allowed = archetypeObj.pathJail.allowedPrefixes.join(', ');
  const verifyCommands = archetypeObj.localVerification.map((c) => `  $ ${c}`).join('\n');

  return `[Task Scope & Path Jail]
- 授权操作范围：严格限定在 ${allowed} 内部，严禁越界修改其他目录。

[Objective]
${goalText}

[Quality & Discipline Checklist]
1. 严禁创建 0 字节物理空文件或未实现占位符；
2. 单函数圈复杂度 CC <= 15，嵌套深度 Depth <= 4，消除循环内瞬态堆分配；
3. 提交与汇报严禁使用施工批次代号与非客观黑话，保持纯客观技术事实；
4. 严禁引入任何 High/Critical 技术债务反弹，保持 0 项刚性基线。

[Pre-Delivery Verification]
完成改动后，在提交工作前必须自行执行并通过以下本地自检：
${verifyCommands}
`;
}

function synthesizeSingle(archKey, postKey, cliOptions, catalog, presetKey = null, defaultDesc = '') {
  const archRel = catalog.archetypes[archKey];
  const postRel = catalog.postures[postKey];
  if (!archRel) throw new Error(`Unknown archetype: ${archKey}`);
  if (!postRel) throw new Error(`Unknown posture: ${postKey}`);

  const archetypeObj = readJson(path.join(SUBAGENTS_ROOT, archRel));
  const postureObj = readJson(path.join(SUBAGENTS_ROOT, postRel));

  const subagentName = cliOptions.name || presetKey || `${archKey}-${postKey}`;
  const subagentDesc = defaultDesc || `${archetypeObj.displayName} 的 ${postureObj.displayName}`;
  const systemPrompt = buildSystemPrompt(archetypeObj, postureObj);
  const taskPrompt = buildTaskPromptTemplate(cliOptions.taskGoal, archetypeObj, postureObj);

  const targetModel = cliOptions.model || postureObj.model || catalog.defaultModel || 'inherit';

  return {
    subagentName,
    archetype: archKey,
    posture: postKey,
    displayName: `${archetypeObj.displayName} (${postureObj.displayName})`,
    description: subagentDesc,
    model: targetModel,
    workspaceMode: cliOptions.workspaceMode || 'inherit',
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
  };
}

function matchPresetByKeys(archKey, postKey, catalog) {
  for (const [pKey, pVal] of Object.entries(catalog.presets)) {
    if (pVal.archetype === archKey && pVal.posture === postKey) {
      return { matchedPresetKey: pKey, defaultDesc: pVal.description };
    }
  }
  return { matchedPresetKey: null, defaultDesc: '' };
}

function resolveArchetypeAndPosture(cliOptions, catalog) {
  if (cliOptions.preset) {
    return resolvePresetTarget(cliOptions.preset, catalog);
  }

  let archKey = cliOptions.archetype;
  let postKey = cliOptions.posture;

  if (cliOptions.intent && (!archKey || !postKey)) {
    const deduced = resolveIntent(cliOptions.intent);
    archKey = archKey || deduced.archetype;
    postKey = postKey || deduced.posture;
  }

  if (!archKey || !postKey) {
    throw new Error(
      'Could not resolve both archetype and posture. Specify --preset, --archetype + --posture, or a clear --intent'
    );
  }

  const { matchedPresetKey, defaultDesc } = matchPresetByKeys(archKey, postKey, catalog);
  return { archKey, postKey, defaultDesc, matchedPresetKey };
}

function synthesize(cliOptions) {
  const catalog = readJson(CATALOG_PATH);

  if (cliOptions.dumpAll) {
    const allResults = {};
    for (const [pKey, preset] of Object.entries(catalog.presets)) {
      allResults[pKey] = synthesizeSingle(
        preset.archetype,
        preset.posture,
        cliOptions,
        catalog,
        pKey,
        preset.description
      );
    }
    return { dumpAll: true, presets: allResults };
  }

  const { archKey, postKey, defaultDesc, matchedPresetKey } = resolveArchetypeAndPosture(
    cliOptions,
    catalog
  );
  return synthesizeSingle(archKey, postKey, cliOptions, catalog, matchedPresetKey, defaultDesc);
}

function run() {
  const options = parseCliArgs(process.argv.slice(2));
  try {
    const result = synthesize(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.dumpAll) {
      console.log(`\n======================================================`);
      console.log(`🤖 全工作区预置 SubAgent 批量导出 (${Object.keys(result.presets).length} 专员)`);
      console.log(`======================================================`);
      for (const [k, p] of Object.entries(result.presets)) {
        console.log(`• [${k}]: ${p.displayName} -> WriteTools=${p.defineArgs.enable_write_tools}, Model=flash`);
      }
    } else {
      console.log(`\n======================================================`);
      console.log(`🤖 SubAgent 泛化装配规格: ${result.subagentName}`);
      console.log(`======================================================`);
      console.log(`• 领域原型: ${result.archetype}`);
      console.log(`• 作业姿态: ${result.posture}`);
      console.log(`• 选定模型: ${result.model} (严格锁定 flash)`);
      console.log(`• 工作区模式: ${result.workspaceMode}`);
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
};
