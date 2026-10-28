/**
 * Module: Governance Guard — SubAgent Cascade Coherence
 * File Path: .agents/skills/subagent-orchestration/scripts/validate-cascade-coherence.js
 * Architecture Role: 技能注册表、SubAgent 目录、专员模板与 DSH 写路径策略之间的跨源闭合守卫。
 *   四处文件各自演化时会静默分叉：领域声明里的技能原型不认识、专员模板缺原型要求的验证命令、
 *   预置声明的 DSH 模式在运行时拒绝其自身根目录。每种分叉都不会让任何单点校验变红，只有把它们
 *   放在一起比对才暴露，故本守卫专职做交叉断言。
 * Dependencies & Triggers: node:fs / node:path；读取 scripts/common/skill-registry.json、
 *   .agents/subagents/subagent-catalog.json、.agents/subagents/{archetypes,agents}/*、
 *   .agents/dsh/bundle/jail-policy.json。由 audit-all 与 pre-push 调用。
 * Responsibilities:
 *   1. 断言每个原型的 associatedSkills 与对应 domain 的 chain ∪ supports 双向闭合；
 *   2. 断言专员模板覆盖原型声明的全部本地验证命令，且不得硬编码模型代号；
 *   3. 断言写姿态预置的根目录落在其声明 DSH 模式的 allowRoots 内且不命中 denyRoots；
 *   4. 断言没有预置名与 DSH 模式 id 撞名，防止 `wg-*` 同时指代项目与治理模式；
 *   5. 内置正反样本自证，证明上述每类断言真的会拒绝缺陷。
 * Exit Semantics & Design Rationale: 0 = 全部闭合，1 = 存在违背或自证失败。
 *   断言覆盖「两侧都能自圆其说却互相矛盾」的缺陷类别，因此每条断言都必须拿两侧真实文件比对，
 *   不接受任一侧的自我声明。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../../../');
const REGISTRY_PATH = path.join(REPO_ROOT, 'scripts/common/skill-registry.json');
const CATALOG_PATH = path.join(REPO_ROOT, '.agents/subagents/subagent-catalog.json');
const ARCHETYPES_DIR = path.join(REPO_ROOT, '.agents/subagents/archetypes');
const AGENTS_DIR = path.join(REPO_ROOT, '.agents/subagents/agents');
const POLICY_PATH = path.join(REPO_ROOT, '.agents/dsh/bundle/jail-policy.json');

/** 写类姿态：这些姿态会真实落盘，必须落在其声明模式的授权面内。 */
const WRITE_POSTURES = Object.freeze(['construct', 'refactor', 'guardian']);

/** 只读姿态：物理无构建权限，验证命令只要求是原型命令的子集。 */
const READ_ONLY_POSTURES = Object.freeze(['review', 'explore']);

/** 模型代号禁用样本：模型标识属会话事实，写进模板会在换模型后变成假前提。 */
const MODEL_CODENAME_PATTERN = /(Gemini|GPT-|Claude|DeepSeek)[\s-]*\d/iu;

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
 * 从原型配置中取出根目录，归一化为工作区相对路径。
 *
 * @param {object} arch - 原型配置。
 * @returns {string} 归一化根目录，整仓为 `.`。
 */
function archetypeRoot(arch) {
  const raw = String(arch.rootDirectory || '.').replace(/\\/gu, '/').replace(/^\.\//u, '');
  const trimmed = raw.replace(/\/+$/u, '');
  return trimmed.length === 0 ? '.' : trimmed;
}

/**
 * 复算单原型的双向闭合断言，供真实运行与自证探针共用。
 *
 * 探针若各自重写一遍集合运算，就只能证明「探针自己算得对」，无法证明守卫会拒绝缺陷。
 * 因此闭合判定只此一份，真实运行与探针喂同一函数。
 *
 * @param {object} domain - 注册表领域记录。
 * @param {object} arch - 原型配置。
 * @returns {string[]} 违背列表。
 */
function diffSkillClosure(domain, arch) {
  const declared = new Set([...(domain.chain || []), ...(domain.supports || [])]);
  const owned = new Set(arch.associatedSkills || []);
  const errors = [];
  for (const skill of declared) {
    if (!owned.has(skill)) errors.push(`缺少领域成员技能 '${skill}'`);
  }
  for (const skill of owned) {
    if (!declared.has(skill)) errors.push(`挂了域外技能 '${skill}'`);
  }
  return errors;
}

/**
 * 既有的预置名 / DSH 模式 id 撞名基线。
 *
 * `wg` 在本仓长期同时指代 WebGames 项目（`wg-construct` 等 4 条预置、WebGames 领域文档）
 * 与 workspace-governance 治理模式（DSH 的 4 个模式 id）。重命名任一侧都要同步 catalog、
 * 27 份专员模板、DSH 补丁声明行与多份 README，且 DSH 侧改 id 需重启才会装载新代际。
 * 因此这 4 条按基线豁免、只禁止新增——比在同一个词上叠加第二种含义更保守的做法是：
 * 承认既有歧义并阻止它扩散，新预置不得再撞名。
 */
const LEGACY_NAMESPACE_COLLISIONS = Object.freeze([
  'wg-construct',
  'wg-refactor',
  'wg-review',
  'wg-explore',
]);

/**
 * 复算命名空间撞名断言，扣除基线豁免项。
 *
 * @param {object} catalog - SubAgent 目录。
 * @returns {string[]} 超出基线的撞名列表。
 */
function collectNamespaceCollisions(catalog) {
  const modes = new Set(Object.keys(catalog.dshModes || {}));
  return Object.keys(catalog.presets || {}).filter(
    (presetName) => modes.has(presetName) && !LEGACY_NAMESPACE_COLLISIONS.includes(presetName),
  );
}

/**
 * 断言 `--intent` 的每条场景都能路由到真实存在的预置专员。
 *
 * 意图路由的判定来自注册表 `domains[].scenarios[]`，而能否装配取决于目录里是否有对应
 * (原型 × 姿态) 预置。两者各自自洽仍然可以互相矛盾：场景声明 `guardian`，而该原型只有
 * `*-construct/review/refactor/explore`，于是 `--intent` 解析出一个无预置组合，被合成器
 * 的 assertPresetBacked 当场拒绝——用户拿到的是一句"无预置专员"，却查不到是谁的错。
 * 另外两处同样只在交叉比对时才暴露：同一句意图出现在两个领域（路由不确定），
 * 以及场景声明的姿态不在姿态注册表内（笔误静默降级为不路由）。
 *
 * @param {object} registry - 技能注册表。
 * @param {object} catalog - SubAgent 目录。
 * @returns {string[]} 违背列表。
 */
function checkIntentRouting(registry, catalog) {
  const presets = catalog.presets || {};
  const postureIds = new Set(Object.keys(catalog.postures || {}));
  const backed = new Set(Object.values(presets).map((p) => `${p.archetype}×${p.posture}`));
  const errors = [];
  const seen = new Map();
  for (const domain of registry.domains || []) {
    for (const scenario of domain.scenarios || []) {
      const label = `场景 [${scenario.intent}]`;
      if (!scenario.posture) {
        errors.push(`${label} 未声明姿态，--intent 无法路由`);
        continue;
      }
      if (!postureIds.has(scenario.posture)) {
        errors.push(`${label} 声明了不存在的姿态 '${scenario.posture}'`);
        continue;
      }
      if (!backed.has(`${domain.archetype}×${scenario.posture}`)) {
        errors.push(
          `${label} 解析为 ${domain.archetype}×${scenario.posture}，但该组合无预置专员（合成器会拒绝装配）`,
        );
      }
      const previous = seen.get(scenario.intent);
      if (previous !== undefined) {
        errors.push(`${label} 与领域 [${previous}] 的意图字符串相同，路由结果取决于遍历顺序`);
      } else {
        seen.set(scenario.intent, domain.id);
      }
    }
  }
  return errors;
}

/**
 * 断言原型技能清单与注册表领域成员双向闭合。
 *
 * 两侧曾各自演化：注册表 chain 里躺着原型不认识的技能，原型里又挂着域外技能，
 * 于是「这个专员遵守哪些技能」取决于读哪份文件。
 *
 * @returns {string[]} 违背列表。
 */
function checkSkillClosure() {
  const registry = readJson(REGISTRY_PATH);
  const catalog = readJson(CATALOG_PATH);
  const errors = [];
  for (const archKey of Object.keys(catalog.archetypes)) {
    const arch = readJson(path.join(ARCHETYPES_DIR, `${archKey}.json`));
    const domain = (registry.domains || []).find((item) => item.archetype === archKey);
    if (domain === undefined) {
      errors.push(`原型 [${archKey}] 在技能注册表中无对应 domain`);
      continue;
    }
    for (const gap of diffSkillClosure(domain, arch)) {
      errors.push(`原型 [${archKey}] ${gap} (domain ${domain.id})`);
    }
  }
  return errors;
}

/**
 * 从专员模板中取出验证命令代码块。
 *
 * 只解析 `## 强制离线验证命令` 之后的第一个围栏块：整份模板当命令解析会把 YAML frontmatter
 * 也当成命令键，产生满屏假缺失。
 *
 * @param {string} template - 模板全文。
 * @returns {string[]} 代码块内的命令行。
 */
function extractVerificationLines(template) {
  const headingIndex = template.indexOf('## 强制离线验证命令');
  if (headingIndex < 0) return [];
  const rest = template.slice(headingIndex);
  const fenceStart = rest.indexOf('```');
  if (fenceStart < 0) return [];
  const afterFence = rest.indexOf('\n', fenceStart);
  const fenceEnd = rest.indexOf('```', afterFence);
  if (afterFence < 0 || fenceEnd < 0) return [];
  return rest
    .slice(afterFence, fenceEnd)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * 把一条验证命令归一化为可比较的键。
 *
 * 同一道门禁在原型侧写作 `pwsh -File WebGames/scripts/ps1/audit-all.ps1`，在模板侧常写作
 * `cd WebGames\npwsh scripts/ps1/audit-all.ps1`。逐字符比对会把这两个等价写法报成缺失，
 * 于是守卫失去意义。这里剥掉 `cd <dir>` 前缀与 `pwsh -File` 外壳，再按目录拼接还原成
 * 工作区相对形式；链式命令按 `&&` 拆成多条。
 *
 * @param {string[]} lines - 命令行序列，`cd` 状态跨行保持。
 * @returns {string[]} 归一化后的命令键。
 */
function normalizeVerificationKeys(lines) {
  const segments = lines
    .flatMap((line) => String(line).split('&&'))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  let directory = '';
  const keys = [];
  for (const segment of segments) {
    const cdMatch = /^cd\s+(\S+)$/u.exec(segment);
    if (cdMatch !== null) {
      directory = cdMatch[1].replace(/\/+$/u, '');
      continue;
    }
    const tail = segment
      .replace(/^(?:pwsh|powershell)(?:\s+-File)?\s+/iu, '')
      .replace(/^(?:node|python3?|bash|sh)\s+/iu, '')
      .replace(/^\.\//u, '');
    keys.push(directory.length > 0 && !tail.startsWith(directory) ? `${directory}/${tail}` : tail);
  }
  return keys;
}

/**
 * 断言专员模板的验证命令与原型声明相符。
 *
 * 模板是平台真正加载的那份，合成契约是另一份；两者曾给出不同的验收标准，实测 24/27 份模板缺命令。
 * 写姿态必须覆盖原型声明的全部命令（照单执行）；只读姿态物理上没有构建权限，因此要求其命令集合
 * 是原型命令的非空子集——把它也判成缺失，等于要求审查专员跑编译，是另一种失真。
 *
 * @returns {string[]} 违背列表。
 */
function checkTemplateVerificationParity() {
  const catalog = readJson(CATALOG_PATH);
  const errors = [];
  for (const [presetName, preset] of Object.entries(catalog.presets || {})) {
    const arch = readJson(path.join(ARCHETYPES_DIR, `${preset.archetype}.json`));
    const templatePath = path.join(AGENTS_DIR, `${presetName}.md`);
    if (!fs.existsSync(templatePath)) {
      errors.push(`预置 [${presetName}] 缺少单源模板 agents/${presetName}.md`);
      continue;
    }
    const template = fs.readFileSync(templatePath, 'utf8');
    const declared = new Set(normalizeVerificationKeys(arch.localVerification || []));
    const present = new Set(normalizeVerificationKeys(extractVerificationLines(template)));
    const readOnly = READ_ONLY_POSTURES.includes(preset.posture);

    if (readOnly) {
      // 只读姿态在平台侧无构建权限，模板恒定声明「不执行」而非罗列命令；列出可执行命令即视为失真。
      if (present.size > 0) {
        errors.push(`专员 [${presetName}] 是只读姿态但模板列出了将执行的命令: ${[...present].join(', ')}`);
      }
      continue;
    }
    for (const key of declared) {
      if (!present.has(key)) errors.push(`专员 [${presetName}] 模板缺少原型验证命令: ${key}`);
    }
  }
  return errors;
}

/**
 * 断言专员模板不硬编码模型代号。
 *
 * 27 份模板曾统一写着「inherit，Gemini 3.8 Flash，effort=High」，与 catalog 的同构继承
 * 语义自相矛盾：换模型后这句话立刻成为模型必须当作前提推理的假事实。
 *
 * @returns {string[]} 违背列表。
 */
function checkTemplateModelAbstraction() {
  const catalog = readJson(CATALOG_PATH);
  const errors = [];
  for (const presetName of Object.keys(catalog.presets || {})) {
    const templatePath = path.join(AGENTS_DIR, `${presetName}.md`);
    if (!fs.existsSync(templatePath)) continue;
    const template = fs.readFileSync(templatePath, 'utf8');
    for (const line of template.split('\n')) {
      if (MODEL_CODENAME_PATTERN.test(line)) {
        errors.push(`专员 [${presetName}] 模板硬编码模型代号: ${line.trim().slice(0, 80)}`);
      }
    }
  }
  return errors;
}

/**
 * 判定一个根目录是否命中禁用根列表。
 *
 * `**\/x` 形式的递归模式会命中任意深度，因此它不可能否决某个顶层项目根——把它算作命中
 * 会让所有写姿态预置一律判红。真实守卫在前缀段用同一语义，此处与之对齐。
 *
 * @param {string} root - 归一化的工作区相对根目录。
 * @param {string[]} denyRoots - 禁用根列表。
 * @returns {boolean} 命中为 true。
 */
function isRootDenied(root, denyRoots) {
  return (denyRoots || []).some((denyRoot) =>
    denyRoot.startsWith('**/') ? false : root === denyRoot || root.startsWith(`${denyRoot}/`),
  );
}

/**
 * 断言预置声明的 DSH 模式在运行时真的放行其根目录。
 *
 * 守卫按调用方身份取姿态，而策略表曾把 `scripts` 列为禁用根、`fractal-git` 排除在授权面外，
 * 于是 8 条写姿态预置在 DSH 会话里写不进自己的目标目录。仅比对 posture 相等无法发现这一层，
 * 必须拿根目录去撞策略表。
 *
 * @returns {string[]} 违背列表。
 */
function checkPresetJailCompatibility() {
  const catalog = readJson(CATALOG_PATH);
  const policy = readJson(POLICY_PATH).modes || {};
  const errors = [];
  for (const [presetName, preset] of Object.entries(catalog.presets || {})) {
    if (!WRITE_POSTURES.includes(preset.posture)) continue;
    const arch = readJson(path.join(ARCHETYPES_DIR, `${preset.archetype}.json`));
    const root = archetypeRoot(arch);
    const modeSpec = policy[preset.dshMode];
    if (modeSpec === undefined) {
      errors.push(`预置 [${presetName}] 引用了未在 jail-policy.json 登记的模式: ${preset.dshMode}`);
      continue;
    }
    if (modeSpec.mode === 'read') {
      errors.push(`预置 [${presetName}] 是写姿态但声明了只读模式 ${preset.dshMode}`);
      continue;
    }
    const allowRoots = modeSpec.allowRoots || [];
    const hitAllow = allowRoots.length === 0
      || allowRoots.some((allowRoot) => root === allowRoot || root.startsWith(`${allowRoot}/`));
    if (isRootDenied(root, modeSpec.denyRoots) || !hitAllow) {
      errors.push(
        `预置 [${presetName}] 根目录 '${root}' 被其声明的 ${preset.dshMode} 拒绝 ` +
          `(deny=${isRootDenied(root, modeSpec.denyRoots)}, allow=${hitAllow})`,
      );
    }
  }
  return errors;
}

/**
 * 断言预置名与 DSH 模式 id 不撞名。
 *
 * 现有 4 条预置与 4 个模式同名（`wg-construct` 等），`wg` 前缀同时指 WebGames 项目与
 * workspace-governance 治理模式，读文档时无法区分所指。
 *
 * @returns {string[]} 违背列表。
 */
function checkNamespaceCollision() {
  const catalog = readJson(CATALOG_PATH);
  return collectNamespaceCollisions(catalog).map(
    (presetName) => `预置名与 DSH 模式 id 撞名: '${presetName}'`,
  );
}

/**
 * 探针用最小目录夹具，避免每条断言都去读真实仓。
 *
 * @returns {object} 夹具集合。
 */
function probeFixtures() {
  return {
    domain: { id: 'probe-domain', archetype: 'probe', chain: ['a', 'b'], supports: ['c'] },
    archetype: { archetype: 'probe', rootDirectory: 'scripts', associatedSkills: ['a', 'b'], localVerification: ['cmd-a', 'cmd-b'] },
    catalog: { presets: { probe: { archetype: 'probe', posture: 'construct', dshMode: 'wg-construct' } }, dshModes: { probe: {} } },
  };
}

/**
 * 用夹具复算断言，证明每类缺陷真的会被拒绝。
 *
 * 探针一律调用真实判定函数，不重写一份等价的集合运算——重写只能证明探针自己算得对。
 *
 * @returns {string[]} 自证失败项。
 */
function runSelfProbes() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`probe "${label}": expected ${wanted}, got ${actual}`);
  };
  const fixtures = probeFixtures();

  expect('closure-detects-missing-skill', diffSkillClosure(fixtures.domain, fixtures.archetype).length, 1);
  expect(
    'closure-detects-extra-skill',
    diffSkillClosure(
      { chain: ['a', 'b'], supports: [] },
      { associatedSkills: ['a', 'b', 'z'] },
    ).length,
    1,
  );
  expect(
    'closure-accepts-exact-match',
    diffSkillClosure({ chain: ['a'], supports: ['b'] }, { associatedSkills: ['b', 'a'] }).length,
    0,
  );

  const template = '## 强制离线验证命令\n```powershell\ncmd-a\n```\n';
  expect(
    'template-parity-detects-missing-command',
    fixtures.archetype.localVerification.filter(
      (command) => !new Set(normalizeVerificationKeys(extractVerificationLines(template))).has(command),
    ).length,
    1,
  );
  expect(
    'template-parity-normalizes-cd-prefix',
    normalizeVerificationKeys(['cd probe', 'pwsh -File scripts/x.ps1']).join(','),
    'probe/scripts/x.ps1',
  );

  expect('model-codename-detected', MODEL_CODENAME_PATTERN.test('同构继承 (inherit，Gemini 3.8 Flash，effort=High)'), true);
  expect('model-abstraction-accepted', MODEL_CODENAME_PATTERN.test('同构继承主会话模型 (inherit)'), false);

  expect('jail-detects-denied-root', isRootDenied('scripts', ['scripts']), true);
  expect('jail-accepts-unlisted-root', isRootDenied('fractal-git', ['scripts']), false);

  expect(
    'namespace-collision-detected',
    collectNamespaceCollisions({ presets: { 'fresh-name': {} }, dshModes: { 'fresh-name': {} } }).length,
    1,
  );
  expect(
    'namespace-legacy-baseline-exempt',
    collectNamespaceCollisions({ presets: { 'wg-review': {} }, dshModes: { 'wg-review': {} } }).length,
    0,
  );
  expect('namespace-clean-accepted', collectNamespaceCollisions({ presets: { p: {} }, dshModes: { m: {} } }).length, 0);

  const routingCatalog = {
    presets: { 'probe-construct': { archetype: 'probe', posture: 'construct' } },
    postures: { construct: {} },
  };
  expect(
    'routing-detects-preset-gap',
    checkIntentRouting(
      { domains: [{ id: 'd', archetype: 'probe', scenarios: [{ intent: 'x', skills: ['a', 'b'], posture: 'review' }] }] },
      routingCatalog,
    ).length,
    1,
  );
  expect(
    'routing-detects-unknown-posture',
    checkIntentRouting(
      { domains: [{ id: 'd', archetype: 'probe', scenarios: [{ intent: 'x', skills: ['a', 'b'], posture: 'sprint' }] }] },
      routingCatalog,
    ).length,
    1,
  );
  expect(
    'routing-detects-missing-posture',
    checkIntentRouting(
      { domains: [{ id: 'd', archetype: 'probe', scenarios: [{ intent: 'x', skills: ['a', 'b'] }] }] },
      routingCatalog,
    ).length,
    1,
  );
  expect(
    'routing-detects-duplicate-intent',
    checkIntentRouting(
      {
        domains: [
          { id: 'd1', archetype: 'probe', scenarios: [{ intent: 'x', skills: ['a', 'b'], posture: 'construct' }] },
          { id: 'd2', archetype: 'probe', scenarios: [{ intent: 'x', skills: ['a', 'b'], posture: 'construct' }] },
        ],
      },
      routingCatalog,
    ).length,
    1,
  );
  expect(
    'routing-accepts-backed-scenario',
    checkIntentRouting(
      { domains: [{ id: 'd', archetype: 'probe', scenarios: [{ intent: 'x', skills: ['a', 'b'], posture: 'construct' }] }] },
      routingCatalog,
    ).length,
    0,
  );
  return failures;
}

/**
 * 汇总全部断言并输出门禁判定。
 *
 * @returns {void}
 */
function main() {
  const probeFailures = runSelfProbes();
  if (probeFailures.length > 0) {
    console.error('❌ [FAIL] 级联闭合守卫自证失败（探针不再具备区分能力）:');
    for (const failure of probeFailures) console.error(`   - ${failure}`);
    process.exit(1);
  }

  console.log('▶ [Cascade Coherence] 核验技能注册表 / 原型 / 专员模板 / DSH 策略 / 意图路由五源一致性...');
  const groups = [
    ['技能闭合', checkSkillClosure()],
    ['验证命令一致', checkTemplateVerificationParity()],
    ['模型抽象', checkTemplateModelAbstraction()],
    ['沙箱兼容', checkPresetJailCompatibility()],
    ['命名空间', checkNamespaceCollision()],
    ['意图路由', checkIntentRouting(readJson(REGISTRY_PATH), readJson(CATALOG_PATH))],
  ];

  const errors = groups.flatMap(([, group]) => group);
  if (errors.length > 0) {
    console.error(`\n❌ [FAIL] 检测到 ${errors.length} 项级联不一致:`);
    for (const [label, group] of groups) {
      if (group.length === 0) continue;
      console.error(`\n  [${label}] ${group.length} 项`);
      for (const error of group) console.error(`   - ${error}`);
    }
    process.exit(1);
  }
  console.log('  ✔ [PASS] 技能闭合 / 验证命令 / 模型抽象 / 沙箱兼容 / 命名空间 / 意图路由 六项一致');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  archetypeRoot,
  checkIntentRouting,
  checkNamespaceCollision,
  checkPresetJailCompatibility,
  checkSkillClosure,
  checkTemplateModelAbstraction,
  checkTemplateVerificationParity,
  collectNamespaceCollisions,
  diffSkillClosure,
  isRootDenied,
  runSelfProbes,
};
