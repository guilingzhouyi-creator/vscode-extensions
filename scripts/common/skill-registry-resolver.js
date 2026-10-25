/**
 * Module: Governance Tooling — Workspace Skill Registry Resolver
 * File Path: scripts/common/skill-registry-resolver.js
 * Architecture Role: Single reader of `scripts/common/skill-registry.json` and the only place that
 *   derives activation lines, domain linkage and trigger classes from it.
 * Dependencies & Triggers: Node.js standard libraries (fs, path); required by
 *   sync-skill-metadata.js, render-skill-catalog.js and validate-skills.js.
 * Responsibilities:
 *   1. Load the authored registry and index its layers, domains and skills.
 *   2. Render the canonical description line and the `## 联动技能` block for one skill.
 *   3. Derive predecessor, successor and parallel-support views from authored domain chains.
 *   4. Classify trigger tokens so the guard can prove the vector covers several intents.
 * Exit Semantics & Design Rationale: The loader throws on a malformed registry and the CLI callers
 *   translate that into exit 1. Derivation lives here so renderer, catalog and guard cannot disagree
 *   about what a linkage means; three independent chain walks is how metadata and documentation drift
 *   apart while every individual file still looks reasonable.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** Registry location, resolved from this module so the caller cwd never matters. */
const REGISTRY_RELATIVE_PATH = 'scripts/common/skill-registry.json';

/** Markers of the generated linkage block; the sync tool owns every byte between them. */
const LINKS_BLOCK = Object.freeze({
    begin: '<!-- SKILL-LINKS:BEGIN -->',
    end: '<!-- SKILL-LINKS:END -->',
    heading: '## 联动技能',
});

/** Rendered role labels for the linkage table. */
const ROLE_LABELS = Object.freeze({ entry: '领域入口', chain: '链上第 {position} 步', support: '领域支援' });

/** Maximum number of parallel support links rendered per skill. */
const PARALLEL_LIMIT = 4;

/** Skills directory, relative to the repository root. */
const SKILLS_RELATIVE_DIR = '.agents/skills';

/**
 * Load the registry and the derived absolute paths every consumer needs.
 *
 * @param {string} repoRoot - Absolute repository root.
 * @returns {{ registry: object, registryPath: string, skillsDir: string }} Loaded registry view.
 */
function loadRegistry(repoRoot) {
    const registryPath = path.join(repoRoot, REGISTRY_RELATIVE_PATH);
    if (!fs.existsSync(registryPath)) {
        throw new Error(`skill registry not found: ${registryPath}`);
    }
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    return { registry, registryPath, skillsDir: path.join(repoRoot, SKILLS_RELATIVE_DIR) };
}

/**
 * Resolve one layer record by id.
 *
 * @param {object} registry - Loaded registry.
 * @param {string} layerId - Layer identifier.
 * @returns {object|undefined} Layer record.
 */
function findLayer(registry, layerId) {
    return (registry.layers || []).find((layer) => layer.id === layerId);
}

/**
 * Order skills by layer position first, then by name so every listing is stable.
 *
 * @param {object} registry - Loaded registry.
 * @returns {string[]} Skill names in canonical order.
 */
function listSkillNames(registry) {
    return Object.keys(registry.skills).sort((left, right) => {
        const leftLayer = findLayer(registry, registry.skills[left].layer) || { order: 99 };
        const rightLayer = findLayer(registry, registry.skills[right].layer) || { order: 99 };
        if (leftLayer.order !== rightLayer.order) return leftLayer.order - rightLayer.order;
        return left.localeCompare(right);
    });
}

/**
 * Build the canonical description line from the activation contract.
 *
 * @param {object} skill - Skill record from the registry.
 * @param {object} activation - Activation contract.
 * @returns {string} Description text, without the YAML wrapper.
 */
function renderDescription(skill, activation) {
    const triggers = (skill.triggers || []).join(activation.separator);
    return String(activation.template).replace('{triggers}', triggers).replace('{pitch}', skill.pitch);
}

/**
 * Classify one trigger token into the activation vocabulary classes.
 *
 * @param {string} token - Single trigger token.
 * @param {object} activation - Activation contract carrying the class lexicons.
 * @returns {string} One of intent, technical, symptom or topic.
 */
function classifyTrigger(token, activation) {
    const classes = activation.classes || {};
    const includesAny = (words) => (words || []).some((word) => token.includes(word));
    if (includesAny(classes.symptom)) return 'symptom';
    if (includesAny(classes.intent)) return 'intent';
    if (/[A-Za-z]/.test(token) || includesAny(classes.technical)) return 'technical';
    return 'topic';
}

/**
 * Derive the ordered set of roles one skill plays across every domain.
 *
 * @param {object} registry - Loaded registry.
 * @param {string} skillName - Skill directory name.
 * @returns {Array<{ domain: object, role: string, position: number }>} Role records in domain order.
 */
function domainRoles(registry, skillName) {
    const roles = [];
    for (const domain of registry.domains || []) {
        const chain = domain.chain || [];
        const index = chain.indexOf(skillName);
        if (index >= 0) {
            roles.push({ domain, role: index === 0 ? 'entry' : 'chain', position: index + 1 });
            continue;
        }
        if ((domain.supports || []).includes(skillName)) {
            roles.push({ domain, role: 'support', position: 0 });
        }
    }
    return roles;
}

/**
 * Rank the parallel-support partners of a skill by how many domains both serve.
 *
 * @param {object} registry - Loaded registry.
 * @param {Array<object>} roles - Role records of the skill.
 * @param {Set<string>} excluded - Names already rendered as predecessor or successor.
 * @returns {string[]} Partner skill names, most entangled first.
 */
function collectParallel(registry, roles, excluded) {
    const ownDomains = new Set(roles.map((record) => record.domain.id));
    const shared = new Map();
    for (const domain of registry.domains || []) {
        if (!ownDomains.has(domain.id)) continue;
        const members = [...(domain.chain || []), ...(domain.supports || [])];
        for (const member of members) {
            if (excluded.has(member)) continue;
            shared.set(member, (shared.get(member) || 0) + 1);
        }
    }
    const order = listSkillNames(registry);
    return [...shared.entries()]
        .sort((left, right) => {
            if (left[1] !== right[1]) return right[1] - left[1];
            return order.indexOf(left[0]) - order.indexOf(right[0]);
        })
        .slice(0, PARALLEL_LIMIT)
        .map((entry) => entry[0]);
}

/**
 * Build the full linkage view of one skill from the authored domain chains.
 *
 * @param {object} registry - Loaded registry.
 * @param {string} skillName - Skill directory name.
 * @returns {{ roles: Array<object>, predecessors: string[], successors: string[],
 *   parallel: string[], chains: object[] }} Linkage view.
 */
function buildLinkage(registry, skillName, roleRecords) {
    const roles = roleRecords || domainRoles(registry, skillName);
    const predecessors = [];
    const successors = [];
    const chains = [];
    for (const record of roles) {
        const chain = record.domain.chain || [];
        const index = chain.indexOf(skillName);
        if (index > 0) predecessors.push(chain[index - 1]);
        if (index >= 0 && index < chain.length - 1) successors.push(chain[index + 1]);
        chains.push(record.domain);
    }
    const excluded = new Set([skillName, ...predecessors, ...successors]);
    const parallel = collectParallel(registry, roles, excluded);
    return {
        roles,
        predecessors: [...new Set(predecessors)],
        successors: [...new Set(successors)],
        parallel,
        chains,
    };
}

/**
 * Render one human-readable linkage target list as Markdown links.
 *
 * @param {string[]} names - Target skill names.
 * @param {string} fallback - Text used when the list is empty.
 * @returns {string} Markdown cell content.
 */
function renderLinkList(names, fallback) {
    if (names.length === 0) return fallback;
    return names.map((name) => `[${name}](../${name}/SKILL.md)`).join('、');
}

/**
 * Render the role cell describing where the skill sits in the domain topology.
 *
 * @param {object} registry - Loaded registry.
 * @param {Array<object>} roles - Role records.
 * @returns {string} Human-readable position text.
 */
function renderPosition(registry, roles) {
    if (roles.length === 0) return '通用方法论支撑，无专属领域链';
    return roles
        .map((record) => {
            const label = ROLE_LABELS[record.role].replace('{position}', String(record.position));
            return `${record.domain.title}（${label}）`;
        })
        .join('；');
}

/**
 * Render the primary domain chain, capped so a long chain cannot dominate the entry file.
 *
 * @param {object} registry - Loaded registry.
 * @param {object[]} chains - Domains the skill belongs to.
 * @returns {string} Markdown cell content.
 */
function renderChains(chains) {
    if (chains.length === 0) return '—';
    const primary = chains[0];
    const pathText = (primary.chain || []).map((name) => name).join(' → ');
    const tail = chains.length > 1 ? '；其余领域链见 `docs/skill-catalog.md`' : '';
    return `${primary.title}：${pathText}${tail}`;
}

/**
 * Render the "when to chain" cell from the authored domain scenarios.
 *
 * @param {Array<object>} roles - Role records carrying their domain scenarios.
 * @returns {string} Human-readable scenario text.
 */
function renderScenarios(roles) {
    const lines = [];
    for (const record of roles) {
        for (const scenario of record.domain.scenarios || []) {
            if (lines.length >= 2) break;
            lines.push(`${scenario.intent} → ${scenario.skills.map((name) => `\`${name}\``).join(' + ')}`);
        }
    }
    return lines.length > 0 ? lines.join('；') : '—';
}

/**
 * Render the generated linkage block for one skill entry file.
 *
 * @param {object} registry - Loaded registry.
 * @param {string} skillName - Skill directory name.
 * @returns {string} Markdown block bounded by the SKILL-LINKS markers.
 */
function renderSkillLinks(registry, skillName) {
    const skill = registry.skills[skillName];
    const linkage = buildLinkage(registry, skillName);
    const rows = [
        `| **定位** | ${renderPosition(registry, linkage.roles)} |`,
        `| **前置** | ${renderLinkList(linkage.predecessors, '—（作为领域入口，无前置）')} |`,
        `| **接续** | ${renderLinkList(linkage.successors, '—（链路末端，交回提交与验收）')} |`,
        `| **并行支援** | ${renderLinkList(linkage.parallel, '—')} |`,
        `| **领域链** | ${renderChains(linkage.chains)} |`,
    ];
    return [
        LINKS_BLOCK.begin,
        LINKS_BLOCK.heading,
        '',
        '> 本节由 `scripts/common/sync-skill-metadata.js` 依 `scripts/common/skill-registry.json` 生成，禁止手改。',
        '',
        '| 联动关系 | 技能 |',
        '| :--- | :--- |',
        ...rows,
        '',
        `**何时联动**：${renderScenarios(linkage.roles)}`,
        LINKS_BLOCK.end,
    ].join('\n');
}

/**
 * Render the YAML frontmatter block a skill entry file must carry.
 *
 * @param {object} registry - Loaded registry.
 * @param {string} skillName - Skill directory name.
 * @returns {string} Frontmatter block including both fences.
 */
function renderFrontmatter(registry, skillName) {
    const description = renderDescription(registry.skills[skillName], registry.activation);
    return ['---', `name: ${skillName}`, 'description: >-', `  ${description}`, '---'].join('\n');
}

module.exports = {
    LINKS_BLOCK,
    PARALLEL_LIMIT,
    REGISTRY_RELATIVE_PATH,
    SKILLS_RELATIVE_DIR,
    buildLinkage,
    classifyTrigger,
    domainRoles,
    findLayer,
    listSkillNames,
    loadRegistry,
    renderDescription,
    renderFrontmatter,
    renderSkillLinks,
};
