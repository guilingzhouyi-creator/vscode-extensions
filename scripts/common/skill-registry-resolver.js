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

/** Priority order for ranking domain roles: entry is primary, chain is active step, support is broad. */
const ROLE_PRIORITY = Object.freeze({ entry: 1, chain: 2, support: 3 });

/** Repository root, resolved from this module so the caller cwd never matters. */
const REPO_ROOT = path.resolve(__dirname, '../..');

/** SubAgent catalog, the single source of the preset-to-archetype binding. */
const SUBAGENT_CATALOG_RELATIVE_PATH = '.agents/subagents/subagent-catalog.json';

/** Minimum Dice similarity for a free-text intent to claim an authored scenario. */
const INTENT_MATCH_THRESHOLD = 0.3;

/** Cached preset index; cleared by `resetPresetIndex()` in probes. */
let presetIndexCache = null;

/**
 * Loads the preset index grouped by archetype.
 *
 * The resolver used to carry a second, hand-written copy of this table. It happened to agree with the
 * catalog, but nothing compared them: a new preset or a changed posture would have left the rendered
 * "协作专员" row describing a specialist that no longer exists. Reading the catalog removes the copy;
 * a missing or malformed catalog throws instead of rendering an empty row, because a silently blank
 * cell is indistinguishable from "this domain has no specialist".
 *
 * @returns {Record<string, string[]>} Preset names grouped by archetype.
 */
function presetsByArchetype() {
    if (presetIndexCache) return presetIndexCache;
    const catalogPath = path.join(REPO_ROOT, SUBAGENT_CATALOG_RELATIVE_PATH);
    if (!fs.existsSync(catalogPath)) {
        throw new Error(`subagent catalog not found: ${catalogPath}`);
    }
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const index = {};
    for (const [presetName, preset] of Object.entries(catalog.presets || {})) {
        if (!preset || !preset.archetype) continue;
        (index[preset.archetype] = index[preset.archetype] || []).push(presetName);
    }
    presetIndexCache = index;
    return index;
}

/**
 * Drops the cached preset index so a probe sees its own fixture.
 *
 * @returns {void}
 */
function resetPresetIndex() {
    presetIndexCache = null;
}

/**
 * Normalises an intent phrase for bigram comparison.
 *
 * Whitespace, punctuation and case carry no meaning in these phrases, and keeping them would make
 * "taxis 输出与 git 逐字节不一致" and "taxis输出与git逐字节不一致" compare as different strings.
 *
 * @param {string} text - Raw phrase.
 * @returns {string} Reduced phrase.
 */
function normalizeIntentText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]/gu, '');
}

/**
 * Computes the Sørensen–Dice coefficient over character bigrams.
 *
 * Dice rather than substring containment because an author writes the scenario once and callers
 * paraphrase it: "索引树并发写入崩溃" must still reach "索引树并发写入或崩溃恢复".
 * A single character would make every short phrase match every other short phrase, hence bigrams.
 *
 * @param {string} left - Normalised phrase.
 * @param {string} right - Normalised phrase.
 * @returns {number} Similarity in [0, 1].
 */
function diceSimilarity(left, right) {
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;
    const bigrams = (text) => {
        const out = new Map();
        for (let i = 0; i < text.length - 1; i += 1) {
            const gram = text.slice(i, i + 2);
            out.set(gram, (out.get(gram) || 0) + 1);
        }
        return out;
    };
    const a = bigrams(left);
    const b = bigrams(right);
    let overlap = 0;
    let total = 0;
    for (const [gram, count] of a) {
        const mirror = b.get(gram) || 0;
        overlap += Math.min(count, mirror);
        total += count;
    }
    for (const count of b.values()) total += count;
    return total === 0 ? 0 : (2 * overlap) / total;
}

/**
 * Resolves a free-text intent against the authored domain scenarios.
 *
 * Intent routing used to be a third hard-coded source: a chain of regular expressions living next to
 * the registry and the catalog. It agreed with neither — 143 of its 175 trigger words routed nowhere
 * and none of them were validated, so a renamed domain left the router silently pointing at a specialist
 * that no longer existed. Deriving the answer from `domains[].scenarios[]` makes the authored scenario
 * table the only place that decides what an intent means.
 *
 * @param {object} registry - Loaded registry.
 * @param {string} intentText - Free-text intent, typically `--intent`.
 * @returns {{ domain: object|null, scenario: object|null, archetype: string|null,
 *   posture: string|null, score: number }} Best matching scenario, or an all-null result.
 */
function resolveScenarioIntent(registry, intentText) {
    const text = normalizeIntentText(intentText);
    const empty = Object.freeze({ domain: null, scenario: null, archetype: null, posture: null, score: 0 });
    if (!text) return empty;
    let best = { domain: null, scenario: null, archetype: null, posture: null, score: 0 };
    for (const domain of registry.domains || []) {
        for (const scenario of domain.scenarios || []) {
            const score = diceSimilarity(normalizeIntentText(scenario.intent), text);
            if (score > best.score) {
                best = {
                    domain,
                    scenario,
                    archetype: domain.archetype || null,
                    posture: scenario.posture || null,
                    score,
                };
            }
        }
    }
    return best.score >= INTENT_MATCH_THRESHOLD ? best : empty;
}

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
    return roles.sort((a, b) => {
        const pA = ROLE_PRIORITY[a.role] || 99;
        const pB = ROLE_PRIORITY[b.role] || 99;
        if (pA !== pB) return pA - pB;
        return (a.domain.order || 99) - (b.domain.order || 99);
    });
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
        if (record.role === 'entry' || record.role === 'chain') {
            const chain = record.domain.chain || [];
            const index = chain.indexOf(skillName);
            if (index > 0) predecessors.push(chain[index - 1]);
            if (index >= 0 && index < chain.length - 1) successors.push(chain[index + 1]);
            chains.push(record.domain);
        }
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
 * Render a constraint list as inline code spans rather than links.
 *
 * Parallel support is not a navigation target: it is the set of constraints that the same change must
 * satisfy at once. Rendering it as links implied "go read these next", which is the opposite of what the
 * list means, and each link cost roughly three times the characters of the bare name.
 *
 * @param {string[]} names - Skill names.
 * @param {string} fallback - Text used when the list is empty.
 * @returns {string} Inline code spans.
 */
function renderConstraintList(names, fallback) {
    if (names.length === 0) return fallback;
    return names.map((name) => `\`${name}\``).join('、');
}

/**
 * Render the role cell describing where the skill sits in the domain topology.
 *
 * @param {Array<object>} roles - Role records.
 * @param {object|null} primaryChain - Domain the skill's chain step belongs to, if any.
 * @returns {string} Compact position text.
 */
function renderPosition(roles, primaryChain) {
    if (roles.length === 0) return '通用方法论，无专属领域链';
    const chainRole = roles.find((record) => record.role !== 'support');
    const supportCount = roles.filter((record) => record.role === 'support').length;
    const parts = [];
    if (chainRole) {
        const label = ROLE_LABELS[chainRole.role].replace('{position}', String(chainRole.position));
        parts.push(`${primaryChain ? primaryChain.title : chainRole.domain.title}（${label}）`);
    }
    if (supportCount > 0) parts.push(`另 ${supportCount} 个领域支援`);
    return parts.join('；');
}

/**
 * Render the generated linkage block for one skill entry file.
 *
 * Compacted from a six-row table to three lines. The table form cost roughly 1.4k characters per skill
 * and the bulk of it was table chrome plus a "定位" row that repeated every supporting domain title,
 * while the same information is already one click away in the generated catalogue. Three lines keep the
 * navigation targets (predecessor, successor, parallel support) and drop the restatement.
 *
 * @param {object} registry - Loaded registry.
 * @param {string} skillName - Skill directory name.
 * @returns {string} Markdown block bounded by the SKILL-LINKS markers.
 */
function renderSkillLinks(registry, skillName) {
    const linkage = buildLinkage(registry, skillName);
    const isUniversal = linkage.chains.length === 0;
    const predecessor = renderLinkList(linkage.predecessors, isUniversal ? '无（通用方法论）' : '—');
    const successor = renderLinkList(linkage.successors, isUniversal ? '无（通用方法论）' : '—');
    const parallel = renderConstraintList(linkage.parallel, '—');
    const chainTail = linkage.chains.length > 1 ? `；其余 ${linkage.chains.length - 1} 条领域链见 \`docs/skill-catalog.md\`` : '';
    return [
        LINKS_BLOCK.begin,
        LINKS_BLOCK.heading,
        '',
        '> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。',
        '',
        `- **链路**：${predecessor} → **本技能** → ${successor}；并行支援 ${parallel}。`,
        `- **领域**：${renderPosition(linkage.roles, linkage.chains[0] || null)}${chainTail}`,
        `- **协作专员**：${renderSubagents(registry, skillName, linkage)}`,
        `- **何时联动**：${renderScenarios(linkage.roles, skillName)}`,
        LINKS_BLOCK.end,
    ].join('\n');
}

/**
 * Render the SubAgent preset binding describing which autonomous specialist to dispatch.
 *
 * A universal-methodology skill is deliberately rendered as "do not delegate": the eleven skills on that
 * layer are constraints the main loop applies while working, not work that can be handed off. The earlier
 * wording told the reader to "dynamically assemble a specialist by domain", which invited exactly the
 * delegation the orchestration skill warns against — a delegated agent that only carries a constraint
 * cannot enforce it on the change it is not making.
 *
 * @param {object} registry - Loaded registry.
 * @param {string} skillName - Skill directory name.
 * @param {object} [linkage] - Linkage view.
 * @returns {string} Human-readable specialist dispatch guidance.
 */
function renderSubagents(registry, skillName, linkage) {
    const skill = (registry.skills || {})[skillName];
    if (skillName === 'subagent-orchestration') {
        return '全领域调度总枢（7 原型 × 5 姿态 × 27 预置）';
    }
    if (skill && skill.layer === 'universal-methodology') {
        return '不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）';
    }
    const currentLinkage = linkage || buildLinkage(registry, skillName);
    const primaryDomain = currentLinkage.chains[0] || (currentLinkage.roles[0] ? currentLinkage.roles[0].domain : null);
    if (!primaryDomain || !primaryDomain.archetype) return '—';

    const arch = primaryDomain.archetype;
    const presets = (presetsByArchetype()[arch] || []).map((p) => `\`${p}\``).join('、');
    if (!presets) return `原型 \`${arch}\`（预置目录中无专员）`;
    return `原型 \`${arch}\`：${presets}`;
}

/**
 * Render the "when to chain" cell from the authored domain scenarios.
 * Prioritizes scenarios where the skill itself participates; falls back to domain-wide scenarios.
 *
 * @param {Array<object>} roles - Role records carrying their domain scenarios.
 * @param {string} [skillName] - Skill directory name used for filtering.
 * @returns {string} Human-readable scenario text.
 */
function renderScenarios(roles, skillName) {
    const matching = [];
    const fallback = [];
    for (const record of roles) {
        for (const scenario of record.domain.scenarios || []) {
            const formatted = `${scenario.intent} → ${scenario.skills.map((name) => `\`${name}\``).join(' + ')}`;
            if (skillName && Array.isArray(scenario.skills) && scenario.skills.includes(skillName)) {
                if (matching.length < 2) matching.push(formatted);
            } else {
                if (fallback.length < 2) fallback.push(formatted);
            }
        }
    }
    if (matching.length > 0) return matching.join('；');
    if (fallback.length > 0) return fallback.join('；');
    return '—';
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
    SUBAGENT_CATALOG_RELATIVE_PATH,
    INTENT_MATCH_THRESHOLD,
    buildLinkage,
    classifyTrigger,
    diceSimilarity,
    domainRoles,
    findLayer,
    listSkillNames,
    loadRegistry,
    normalizeIntentText,
    presetsByArchetype,
    renderLinkList,
    renderConstraintList,
    renderDescription,
    renderFrontmatter,
    renderPosition,
    renderSkillLinks,
    renderSubagents,
    resetPresetIndex,
    resolveScenarioIntent,
};
