/**
 * Module: Governance Tooling — Skill Catalog Renderer
 * File Path: scripts/common/render-skill-catalog.js
 * Architecture Role: Renders the authored registry into the human-facing skill invocation manual
 *   (`docs/skill-catalog.md`), so activation rules, domain linkage and per-skill meaning have one source.
 * Dependencies & Triggers: Node.js standard libraries (fs, path); requires ./skill-registry-resolver.js;
 *   invoked by the SKILL-CATALOG guard inside validate-skills.js and by the skill maintenance loop.
 * Responsibilities:
 *   1. Explain how activation works and what a linkage means.
 *   2. Render the three-layer topology, the domain chains and the domain scenario tables.
 *   3. Render one invocation card per skill with triggers, linkage and verification commands.
 *   4. Support --check so the guard can prove the document is not hand-edited.
 * Exit Semantics & Design Rationale: Exit 1 under --check means the checked-in manual differs from the
 *   registry render. The document is generated rather than curated because a manually kept catalogue
 *   inevitably drifts one skill behind, and a stale catalogue teaches agents the wrong invocation path.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const resolver = require('./skill-registry-resolver.js');

/** Output document, relative to the repository root. */
const CATALOG_RELATIVE_PATH = 'docs/skill-catalog.md';

/**
 * Render one skill link for the manual.
 *
 * @param {string} name - Skill directory name.
 * @returns {string} Markdown link.
 */
function renderSkillLink(name) {
    return `[\`${name}\`](../.agents/skills/${name}/SKILL.md)`;
}

/**
 * Render the activation mechanics section.
 *
 * @param {object} registry - Loaded registry.
 * @returns {string[]} Markdown lines.
 */
function renderActivationSection(registry) {
    const activation = registry.activation;
    return [
        '## 一、激活机制：技能如何被选中',
        '',
        '每个技能的 frontmatter description 是 Agent 侧唯一可见的索引面：Agent 只依据这一行判断是否加载该技能，',
        '命中之后才读取 SKILL.md 正文，正文里的 references 再按需 JIT 读取。因此描述的写法直接决定激活命中率。',
        '',
        `描述行统一形如 \`【触发：${activation.separator}分隔的触发词】调用含义\`，硬约束如下：`,
        '',
        `- **触发词 ${activation.triggerWindow.min}~${activation.triggerWindow.max} 个**，每个同类跨技能复用不超过 ${activation.maxTriggerReuse} 次，避免所有技能抢同一个词。`,
        '- **三类语义覆盖**：意图词（写/重构/排错/提交…）、症状词（崩溃/卡顿/漂移…）、技术标识（CAS、RingBuffer、ELOC、taxis…）；',
        '  单个技能至少覆盖三类中的两类，校验器会拒绝只堆技术名词或只堆口语词的描述。',
        '- **调用含义回答“何时必须使用、看守什么”**，而不是复述技能名；用户据此就能知道调用它意味着什么。',
        '- **描述与联动块都是生成产物**：改 \`scripts/common/skill-registry.json\` 后重新渲染，手改会被校验器判红并还原。',
        '',
        '联动语义由领域（domain）定义，分三种关系：',
        '',
        '- **前置**：链上排在当前技能之前的一项，通常是领域入口或上游约束；',
        '- **接续**：链上的下一项，完成当前职责后必须交棒的对象；',
        '- **并行支援**：与当前技能共同服务多个领域的伙伴技能，按共同领域数排序取前 ' + resolver.PARALLEL_LIMIT + ' 项。',
        '',
        '加载一个领域入口技能后，按它的「联动技能」块依次注入前置、接续与并行支援，就能覆盖该领域的完整作业闭环。',
        '',
    ];
}

/**
 * Render the three-layer topology table.
 *
 * @param {object} registry - Loaded registry.
 * @returns {string[]} Markdown lines.
 */
function renderLayerSection(registry) {
    const lines = ['## 二、三层拓扑', '', `全工作区 \`${registry.skills ? Object.keys(registry.skills).length : 0} 项研发技能\` 按职责分为三层：`, ''];
    lines.push('| 层 | 定位 | 技能 |', '| :--- | :--- | :--- |');
    const layers = (registry.layers || []).slice().sort((left, right) => left.order - right.order);
    for (const layer of layers) {
        const members = resolver.listSkillNames(registry).filter((name) => registry.skills[name].layer === layer.id);
        lines.push(`| **Layer ${layer.order}** ${layer.title} | ${layer.positioning} | ${members.map(renderSkillLink).join('、')} |`);
    }
    lines.push('');
    return lines;
}

/**
 * Render one domain block: chain, supports and scenario table.
 *
 * @param {object} registry - Loaded registry.
 * @param {object} domain - Domain record.
 * @returns {string[]} Markdown lines.
 */
function renderDomainBlock(registry, domain) {
    const lines = [
        `### ${domain.title}（\`${domain.subtitle}\`）`,
        '',
        `- **领域链**：${(domain.chain || []).map((name) => `\`${name}\``).join(' → ')}`,
        `- **领域支援**：${(domain.supports || []).map((name) => `\`${name}\``).join('、') || '—'}`,
        `- **对应 SubAgent 原型**：\`${domain.archetype}\``,
        '',
        '| 我遇到的场景 | 联动技能 |',
        '| :--- | :--- |',
    ];
    for (const scenario of domain.scenarios || []) {
        lines.push(`| ${scenario.intent} | ${scenario.skills.map((name) => `\`${name}\``).join(' + ')} |`);
    }
    lines.push('');
    return lines;
}

/**
 * Render the domain linkage section.
 *
 * @param {object} registry - Loaded registry.
 * @returns {string[]} Markdown lines.
 */
function renderDomainSection(registry) {
    const lines = ['## 三、领域联动：调用一个技能会带出哪些技能', ''];
    const domains = (registry.domains || []).slice().sort((left, right) => left.order - right.order);
    for (const domain of domains) lines.push(...renderDomainBlock(registry, domain));
    return lines;
}

/**
 * Render one skill invocation card.
 *
 * @param {object} registry - Loaded registry.
 * @param {string} skillName - Skill directory name.
 * @returns {string[]} Markdown lines.
 */
function renderSkillCard(registry, skillName) {
    const skill = registry.skills[skillName];
    const linkage = resolver.buildLinkage(registry, skillName);
    const description = resolver.renderDescription(skill, registry.activation);
    const roles = linkage.roles.map((record) => {
        const label = record.role === 'entry' ? '领域入口' : record.role === 'chain' ? `链上第 ${record.position} 步` : '领域支援';
        return `${record.domain.title}（${label}）`;
    });
    const lines = [
        `### ${skillName}`,
        '',
        `- **调用含义**：${skill.purpose}`,
        `- **描述行**：\`${description}\``,
        `- **所属层**：${(resolver.findLayer(registry, skill.layer) || { title: skill.layer }).title}`,
        `- **联动定位**：${roles.join('；') || '通用方法论支撑'}`,
        `- **前置**：${linkage.predecessors.map((name) => `\`${name}\``).join('、') || '—（领域入口）'}`,
        `- **接续**：${linkage.successors.map((name) => `\`${name}\``).join('、') || '—（链路末端）'}`,
        `- **并行支援**：${linkage.parallel.map((name) => `\`${name}\``).join('、') || '—'}`,
        '',
        '**典型情形**：',
        '',
    ];
    for (const situation of skill.situations || []) lines.push(`- ${situation}`);
    lines.push('', '**验证命令**：', '');
    for (const command of skill.verification || []) lines.push(`- \`${command}\``);
    lines.push('');
    return lines;
}

/**
 * Render the maintenance loop section.
 *
 * @returns {string[]} Markdown lines.
 */
function renderMaintenanceSection() {
    return [
        '## 五、维护闭环',
        '',
        '1. 修改 \`scripts/common/skill-registry.json\`：描述含义、触发词、领域链或场景只在这一个文件里改。',
        '2. 渲染入口元数据：\`node scripts/common/sync-skill-metadata.js\`。',
        '3. 重渲染本说明书：\`node scripts/common/render-skill-catalog.js\`。',
        '4. 同步插件镜像：\`node scripts/common/sync-skills.js\`。',
        '5. 本地校验：\`node scripts/common/validate-skills.js\`，随后按工作区门禁执行 \`pwsh -File scripts/ps1/audit-all.ps1\`。',
        '',
        '三项校验看守上述闭环：\`SKILL-METADATA\` 校验注册表与磁盘双向闭包及描述渲染一致，',
        '\`SKILL-LINKAGE\` 校验联动关系存在性与领域链完整性，\`SKILL-CATALOG\` 校验本说明书与注册表同源。',
        '',
    ];
}

/**
 * Render the complete catalogue document.
 *
 * @param {object} registry - Loaded registry.
 * @returns {string} Markdown document.
 */
function renderCatalog(registry) {
    const skillNames = resolver.listSkillNames(registry);
    const lines = [
        '# 研发技能调用说明书',
        '',
        '> 本文件由 \`scripts/common/render-skill-catalog.js\` 依 \`scripts/common/skill-registry.json\` 渲染生成，禁止手改；',
        '> 运行 \`node scripts/common/render-skill-catalog.js --check\` 校验漂移。',
        '',
        '本说明书回答三个问题：技能靠什么被激活、调用一个技能意味着什么、调用一个领域技能会联动哪些技能。',
        '',
        ...renderActivationSection(registry),
        ...renderLayerSection(registry),
        ...renderDomainSection(registry),
        '## 四、技能调用卡片',
        '',
    ];
    for (const skillName of skillNames) lines.push(...renderSkillCard(registry, skillName));
    lines.push(...renderMaintenanceSection());
    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '')}\n`;
}

/**
 * Render the catalogue and compare or write it.
 *
 * @param {{ checkOnly?: boolean, repoRoot?: string }} options - Run options.
 * @returns {number} Process exit code.
 */
function main(options) {
    const settings = options || {};
    const checkOnly = settings.checkOnly === true;
    const repoRoot = settings.repoRoot || path.resolve(__dirname, '../..');
    const { registry } = resolver.loadRegistry(repoRoot);
    const catalogPath = path.join(repoRoot, CATALOG_RELATIVE_PATH);
    const expected = renderCatalog(registry);
    const current = fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, 'utf8') : '';
    if (expected === current) {
        console.log(`✔ ${CATALOG_RELATIVE_PATH} matches the registry render`);
        return 0;
    }
    if (checkOnly) {
        console.error(`✘ ${CATALOG_RELATIVE_PATH} drifted from scripts/common/skill-registry.json`);
        return 1;
    }
    fs.writeFileSync(catalogPath, expected);
    console.log(`✔ Rendered ${CATALOG_RELATIVE_PATH} from scripts/common/skill-registry.json`);
    return 0;
}

if (require.main === module) {
    const argv = process.argv.slice(2);
    process.exit(main({ checkOnly: argv.includes('--check') || argv.includes('--check-only') }));
}

module.exports = { CATALOG_RELATIVE_PATH, main, renderCatalog };
