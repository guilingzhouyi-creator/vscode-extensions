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
        '## 1. Activation Mechanics: How Skills Are Selected',
        '',
        'Each skill frontmatter `description` is the only index line visible to agents before loading:',
        'the agent reads `SKILL.md` only when triggers match, and loads `references/` on demand (JIT).',
        '',
        `Description format: \`${activation.template}\` (separator \`${activation.separator}\`), enforcing:`,
        '',
        `- **${activation.triggerWindow.min}~${activation.triggerWindow.max} triggers**, cross-skill reuse <= ${activation.maxTriggerReuse}.`,
        '- **Multi-class coverage**: mix intent (write/refactor/debug/commit), symptom (crash/leak/drift/slow), and technical IDs (CAS/ELOC/taxis/MoE); >= 3 classes required.',
        '- **Single-source generation**: edit `scripts/common/skill-registry.json`, then run `sync-skill-metadata.js` and `render-skill-catalog.js`.',
        '',
        'Linkage roles by domain: **Predecessor** (upstream entry/constraint), **Successor** (downstream handoff), **Parallel** (top ' + resolver.PARALLEL_LIMIT + ' shared-domain constraints).',
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
    const lines = ['## 2. Three-Layer Skill Topology', '', `Workspace carries \`${registry.skills ? Object.keys(registry.skills).length : 0}\` engineering skills across 3 orthogonal layers:`, ''];
    lines.push('| Layer | Scope | Skills |', '| :--- | :--- | :--- |');
    const layers = (registry.layers || []).slice().sort((left, right) => left.order - right.order);
    for (const layer of layers) {
        const members = resolver.listSkillNames(registry).filter((name) => registry.skills[name].layer === layer.id);
        lines.push(`| **Layer ${layer.order}** ${layer.title} | ${layer.positioning} | ${members.map(renderSkillLink).join(', ')} |`);
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
        `### ${domain.title} (\`${domain.subtitle}\`)`,
        '',
        `- **Chain**: ${(domain.chain || []).map((name) => `\`${name}\``).join(' -> ')}`,
        `- **Supports**: ${(domain.supports || []).map((name) => `\`${name}\``).join(', ') || '—'}`,
        `- **Archetype**: \`${domain.archetype}\``,
        '',
        '| Scenario Intent | Chained Skills |',
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
    const lines = ['## 3. Domain Chains & Intent Scenarios', ''];
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
        const label = record.role === 'entry' ? 'entry' : record.role === 'chain' ? `step ${record.position}` : 'support';
        return `${record.domain.title} (${label})`;
    });
    const lines = [
        `### ${skillName}`,
        '',
        `- **Purpose**: ${skill.purpose}`,
        `- **Description**: \`${description}\``,
        `- **Layer**: ${(resolver.findLayer(registry, skill.layer) || { title: skill.layer }).title}`,
        `- **Roles**: ${roles.join('; ') || 'Universal support'}`,
        `- **Predecessors**: ${linkage.predecessors.map((name) => `\`${name}\``).join(', ') || (linkage.chains.length === 0 ? '— (universal)' : '— (domain entry)')}`,
        `- **Successors**: ${linkage.successors.map((name) => `\`${name}\``).join(', ') || (linkage.chains.length === 0 ? '— (on demand)' : '— (chain tail)')}`,
        `- **Parallel**: ${linkage.parallel.map((name) => `\`${name}\``).join(', ') || '—'}`,
        `- **Specialists**: ${resolver.renderSubagents(registry, skillName, linkage)}`,
        '',
        '**Typical Situations**:',
        '',
    ];
    for (const situation of skill.situations || []) lines.push(`- ${situation}`);
    lines.push('', '**Verification**:', '');
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
        '## 5. Maintenance Loop',
        '',
        '1. Edit `scripts/common/skill-registry.json` (single source for triggers, pitches, chains, and scenarios).',
        '2. Render skill frontmatter & linkage: `node scripts/common/sync-skill-metadata.js`.',
        '3. Re-render this catalog: `node scripts/common/render-skill-catalog.js`.',
        '4. Mirror plugin bundle: `node scripts/common/sync-skills.js`.',
        '5. Validate: `node scripts/common/validate-skills.js` and `pwsh -File scripts/ps1/audit-all.ps1`.',
        '',
        'Guards: `SKILL-METADATA` (bidirectional closure + byte parity), `SKILL-LINKAGE` (chain/archetype closure), `SKILL-CATALOG` (generated byte parity).',
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
        '# Workspace Engineering Skill Catalog',
        '',
        '> Generated from `scripts/common/skill-registry.json` by `scripts/common/render-skill-catalog.js` (do not hand-edit; check via `--check`).',
        '',
        ...renderActivationSection(registry),
        ...renderLayerSection(registry),
        ...renderDomainSection(registry),
        '## 4. Per-Skill Invocation Cards',
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
