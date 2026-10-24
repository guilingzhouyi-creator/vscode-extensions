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

function resolveIntent(intent) {
  const text = (intent || '').toLowerCase();
  let archKey = null;
  let postKey = null;

  if (/skill|技能|skills/.test(text)) {
    archKey = 'skill-governance';
  } else if (/fractal-git|taxis|\bfg\b|微\s*crate|plumbing|cargo|\bunsafe\b|\bcas\b|对象池|索引拓扑/.test(text)) {
    archKey = 'git-kernel';
  } else if (/workspace-timing|timing|\bwt\b|vscode|扩展|插件|时钟|计时|双语|webview|i18n/.test(text)) {
    archKey = 'vs-extension';
  } else if (/auto-refactor|\bar\b|cli|分析器|静态分析|rust|算子|praxis|cai|diff|n-api/.test(text)) {
    archKey = 'cli-engine';
  } else if (/webgames|\bwg\b|godot|gdscript|游戏|卡拉尔/.test(text)) {
    archKey = 'game-engine';
  } else if (/(?:全仓|工作区).*(?:门禁|统一审查|audit-all)|单源规则|规则目录|元治理|元数据|(?:五大|六大|全量)支柱|顶层蓝图/.test(text)) {
    archKey = 'workspace-meta';
  } else if (/infra|scripts|脚本|门禁|发布|package|powershell|pwsh|bash|流水线|\bci\b|hook/.test(text)) {
    archKey = 'infra-tool';
  } else if (/workspace|全仓|工作区|治理|公理/.test(text)) {
    archKey = 'workspace-meta';
  }

  if (/重构|refactor|消融|解耦|瘦身|优化|降重|平铺|收敛|精简|simplif|跳板|算法|算子|lut|swar|位并行|csr|soa|第一性原理/.test(text)) {
    postKey = 'refactor';
  } else if (/开发|编码|实现|特性|construct|增量|编写|生产|新建|新增|创建|tdd|测试驱动|spec|规格|契约|cdd|约束驱动/.test(text)) {
    postKey = 'construct';
  } else if (/守卫|巡检|guardian|门禁裁决|看守|防反弹|防御|约束|constraint|底线|floor|ratchet|棘轮/.test(text)) {
    postKey = 'guardian';
  } else if (/探索|调研|排查|explore|探针|调查|勘测|拓扑|调用链|排错|debug|质询|interview|缺陷|故障|context|上下文/.test(text)) {
    postKey = 'explore';
  } else if (/审查|review|检查|合规|诊断|(?:^|[^态])分析|doubt|怀疑|对抗|证伪|挑刺|cross-review/.test(text)) {
    postKey = 'review';
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
  '--files': 'exclusiveFiles',
  '--workspace-mode': 'workspaceMode',
  '--dsh-mode': 'dshMode',
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
    exclusiveFiles: null,
    workspaceMode: 'inherit',
    model: 'inherit',
    dshMode: null,
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

function buildSystemPrompt(archetypeObj, postureObj) {
  const totalRules = getTotalRuleCount();
  const allowedList = archetypeObj.pathJail.allowedPrefixes.map((p) => `  - ${p}`).join('\n');
  const forbiddenList = archetypeObj.pathJail.forbiddenPrefixes.map((p) => `  - ${p}`).join('\n');
  const axiomList = archetypeObj.rigidAxioms.map((a, idx) => `  ${idx + 1}. ${a}`).join('\n');
  const postureRuleList = postureObj.behaviorRules.map((r, idx) => `  ${idx + 1}. ${r}`).join('\n');
  const skillList = archetypeObj.associatedSkills.join(', ');
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

## 🏛️ Layer 0: 工作区全局刚性公理 (AGENTS.md)
1. 物理卫生：全仓严禁创建或遗留 0 字节空文件；脚本必须严格保持换行契约（.ps1 CRLF，其他 LF）；纯空格缩进且单 EOF 换行；
2. 复杂度预算：圈复杂度 CC <= 15，控制流深度 Depth <= 4，单行噪声比 Noise <= 4.0；单文件双轨体积 ELOC <= 900 / LOC <= 1400；循环体与高频调度消除瞬态堆分配 (CPX-SPACE-001)；
3. 门面设计：门面层必须满足 ELOC >= 15 或 Object.freeze 不可变保障，严禁 <= 3 行空包跳板 (ARCH-ABS-001 / ARCH-FAC-001)；
4. 真实性纪律：单源规则目录 (rule-catalog.json) 权威收录 ${totalRules} 条规则，严禁虚构规则 ID (RCFG-RULE-DRIFT)，禁止敷衍/夸大词汇与施工临时黑话；
5. 零高危技术债：全工作区 High/Critical 债务历史性归零 (0 项)，严禁引入任何技术债务反弹 (一票否决)；
6. 会话隔离与并行避让：严格以自身任务独占 Path Jail 为界；工作区出现非本任务改动时判定为外部并行会话活动，坚决保持零触碰、零清理、零越界修复；严禁执行全局破坏性还原（git restore . / git clean -fd）；严禁通配暂存（git add . / -A）；
7. 六大高级编程规范性思维约束：
  - 状态空间闭合：先用判别联合/Type-State 让非法状态不可表示，状态扫描成对声明进入与退出归位条件；
  - 单源派生与双向闭包：修改枚举/注册表时同步闭环 SSOT 真源、自动派生投影与双向差集守卫；
  - 反机械应付 (Anti-Gaming)：靠控制流代数化简降复杂度，严禁删注释或拆出 <= 3 行透传跳板凑指标；
  - 负空间与污点防御：先写退化短路、超时强杀与路径三步污点守卫 (GUARD-DESTR-001)，再写主干逻辑；
  - 对称生命周期与零分配：获取与释放 (off/disconnect/flush/teardown) 同级对称，循环体零瞬态堆分配；
  - 可证伪自检探针：编写门禁或校验器必须内置 runSelfProbes() 正反样本自证检出能力。

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

  const { matchedPresetKey, defaultDesc, dshMode } = matchPresetByKeys(archKey, postKey, catalog);
  return { archKey, postKey, defaultDesc, matchedPresetKey, dshMode };
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

  const { archKey, postKey, defaultDesc, matchedPresetKey, dshMode } = resolveArchetypeAndPosture(
    cliOptions,
    catalog
  );
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
};
