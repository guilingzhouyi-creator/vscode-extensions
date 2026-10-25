/**
 * Module: Governance Tooling — Skill Metadata Sync
 * File Path: scripts/common/sync-skill-metadata.js
 * Architecture Role: Sole writer that renders registry-authored activation lines and linkage blocks into
 *   every `.agents/skills/<name>/SKILL.md`, keeping entry metadata and authored topology in lockstep.
 * Dependencies & Triggers: Node.js standard libraries (fs, path); requires ./skill-registry-resolver.js;
 *   invoked by the SKILL-METADATA guard inside validate-skills.js and by the skill maintenance loop.
 * Responsibilities:
 *   1. Replace the YAML frontmatter with the registry-rendered block so descriptions stop drifting.
 *   2. Replace or insert the `## 联动技能` block bounded by the SKILL-LINKS markers.
 *   3. Report every drifted file and fail under --check instead of writing.
 *   4. Expose the pure renderer so the guard and the writer cannot disagree about expected bytes.
 * Exit Semantics & Design Rationale: Exit 0 means every entry file matches the registry render. The tool
 *   never guesses: a missing frontmatter or missing skill directory aborts the run, because silently skipping
 *   one skill is how a hand-edited description survives a whole release cycle.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const resolver = require('./skill-registry-resolver.js');

/** Frontmatter envelope at the head of a skill entry file. */
const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n/;

/** First level-two heading, used as the insertion anchor when no linkage block exists yet. */
const SECTION_HEADING = /^## /m;

/**
 * Split one skill entry document into its frontmatter envelope and body.
 *
 * @param {string} raw - Current file content.
 * @returns {{ frontmatter: string, body: string }} Split parts.
 */
function splitSkillDocument(raw) {
    const match = FRONTMATTER_PATTERN.exec(raw);
    if (!match) {
        throw new Error('skill entry file has no frontmatter envelope');
    }
    return { frontmatter: match[0], body: raw.slice(match[0].length) };
}

/**
 * Escape a literal marker so it can be embedded in a regular expression.
 *
 * @param {string} literal - Marker text.
 * @returns {string} Escaped literal.
 */
function escapeRegExp(literal) {
    return literal.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
}

/**
 * Replace the generated linkage block, inserting it before the first section when absent.
 *
 * @param {string} body - Document body without frontmatter.
 * @param {string} block - Rendered linkage block.
 * @returns {string} Body carrying exactly one fresh block.
 */
function applyLinksBlock(body, block) {
    const pattern = new RegExp(
        `${escapeRegExp(resolver.LINKS_BLOCK.begin)}[\\s\\S]*?${escapeRegExp(resolver.LINKS_BLOCK.end)}\\n?`,
    );
    if (pattern.test(body)) {
        return body.replace(pattern, `${block}\n`);
    }
    const anchor = SECTION_HEADING.exec(body);
    if (!anchor) {
        return `${body.replace(/\n*$/, '')}\n\n${block}\n`;
    }
    const head = body.slice(0, anchor.index).replace(/\n*$/, '');
    const tail = body.slice(anchor.index);
    return `${head}\n\n${block}\n\n${tail}`;
}

/**
 * Render the complete expected entry file for one skill.
 *
 * @param {object} registry - Loaded registry.
 * @param {string} skillName - Skill directory name.
 * @param {string} raw - Current file content used as the body source.
 * @returns {string} Expected file content.
 */
function renderSkillDocument(registry, skillName, raw) {
    const { body } = splitSkillDocument(raw);
    const frontmatter = `${resolver.renderFrontmatter(registry, skillName)}\n`;
    return frontmatter + applyLinksBlock(body, resolver.renderSkillLinks(registry, skillName));
}

/**
 * Synchronise every skill entry file with the registry, or report drift under --check.
 *
 * @param {{ checkOnly?: boolean, repoRoot?: string }} options - Run options.
 * @returns {number} Process exit code.
 */
function main(options) {
    const settings = options || {};
    const checkOnly = settings.checkOnly === true;
    const repoRoot = settings.repoRoot || path.resolve(__dirname, '../..');
    const { registry, skillsDir } = resolver.loadRegistry(repoRoot);
    const drifted = [];
    let written = 0;
    for (const skillName of resolver.listSkillNames(registry)) {
        const filePath = path.join(skillsDir, skillName, 'SKILL.md');
        if (!fs.existsSync(filePath)) {
            throw new Error(`skill entry file missing: ${filePath}`);
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        const expected = renderSkillDocument(registry, skillName, raw);
        if (expected === raw) continue;
        drifted.push(path.relative(repoRoot, filePath));
        if (!checkOnly) {
            fs.writeFileSync(filePath, expected);
            written += 1;
        }
    }
    if (checkOnly) {
        if (drifted.length > 0) {
            console.error(`✘ ${drifted.length} skill entry file(s) drifted from scripts/common/skill-registry.json`);
            for (const file of drifted) console.error(`  - ${file}`);
            return 1;
        }
        console.log(`✔ All ${resolver.listSkillNames(registry).length} skill entry files match the registry`);
        return 0;
    }
    console.log(`✔ Synced ${written} skill entry file(s) from scripts/common/skill-registry.json`);
    return 0;
}

if (require.main === module) {
    const argv = process.argv.slice(2);
    process.exit(main({ checkOnly: argv.includes('--check') || argv.includes('--check-only') }));
}

module.exports = { applyLinksBlock, main, renderSkillDocument, splitSkillDocument };
