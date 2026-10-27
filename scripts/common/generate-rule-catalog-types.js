/**
 * Module: Rule Catalog Code Generator — SSOT to TypeScript Types & Constants
 * File Path: scripts/common/generate-rule-catalog-types.js
 * Architecture Role: Generates strongly-typed TypeScript constants, metadata maps,
 *   and union types for auto-refactor from scripts/common/rule-catalog.json, partitioned
 *   into six high-cohesion subdomains (architecture, governance, automation, languages,
 *   quality, security-hygiene) and aggregated via a central facade to comply with ELOC budgets.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path);
 *   invoked manually, during pre-commit gates, or build workflows.
 * Responsibilities:
 *   1. Parse scripts/common/rule-catalog.json SSOT;
 *   2. Filter rules belonging to project 'auto-refactor';
 *   3. Partition rules across six bounded domain submodules;
 *   4. Emit generated subdomain TypeScript files and the aggregated facade.
 * Exit Semantics & Design Rationale: Exits with 0 on clean code generation, 1 on failure.
 *   Ensures 100% type-level alignment with the workspace SSOT rule catalog.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CATALOG_PATH = path.join(__dirname, 'rule-catalog.json');
const TARGET_DIR = path.join(REPO_ROOT, 'auto-refactor', 'src', 'core', 'constants');
const PACKAGE_ANCHOR = path.join(REPO_ROOT, 'auto-refactor', 'package.json');

/**
 * Loads the formatter through the subproject that declares it.
 *
 * The workspace root has no dependency manifest of its own, so a bare `require('prettier')` from
 * this file resolves against directories that contain no modules. Anchoring the lookup at the
 * subproject manifest keeps this generator and the subproject's format check on one formatter
 * instance and one configuration file: resolving from the root would silently fall back to the
 * formatter defaults, which disagree with the subproject on quote style and line width.
 */
function loadFormatter() {
    const subprojectRequire = createRequire(PACKAGE_ANCHOR);
    return subprojectRequire('prettier');
}

/**
 * Formats generated text the way the subproject's own format check will read it.
 *
 * The configuration is resolved explicitly: this formatter version treats the options object as
 * the whole truth and uses `filepath` only to pick a parser, so passing the path alone would format
 * against the built-in defaults. Those defaults differ from the subproject on quote style and line
 * width, which is precisely how the generated files drifted away from the check in the first place.
 *
 * @param content - Unformatted generated source text.
 * @param filePath - Absolute destination path, used for configuration and parser selection.
 * @returns Formatted source text.
 */
async function formatGenerated(content, filePath) {
    const prettier = loadFormatter();
    const config = (await prettier.resolveConfig(filePath)) ?? {};
    return prettier.format(content, { ...config, filepath: filePath });
}

const SUBDOMAINS = [
    'architecture',
    'governance',
    'automation',
    'languages',
    'quality',
    'security-hygiene',
];

/**
 * Maps each rule family prefix to its generated constants subdomain.
 * Declared as data rather than a switch so adding a family is a one-line edit
 * that cannot introduce a new branch (and cannot raise the function's CC).
 */
const FAMILY_SUBDOMAIN = new Map(
    Object.entries({
        architecture: ['ARCH', 'DEP', 'DAT', 'CONST', 'VOL', 'CMP', 'EXT', 'VSC'],
        governance: ['GOV', 'GUARD', 'ENG', 'ERR', 'MOD', 'NUM', 'PROD'],
        automation: ['PS', 'SH', 'UI'],
        languages: ['GDM', 'GOM', 'PYM', 'RSM', 'TSM', 'STDLIB'],
        quality: ['CPX', 'SIM', 'PRF', 'NAM', 'BIG'],
    }).flatMap(([subdomain, families]) => families.map((family) => [family, subdomain])),
);

/**
 * Resolves the constants subdomain that owns a rule family prefix.
 *
 * @param family - Rule family prefix such as ARCH or CPX.
 * @returns Subdomain name; hygiene, security, comment and test families all
 *   fall back to the shared security-hygiene bucket by design.
 */
function getDomainGroup(family) {
    return FAMILY_SUBDOMAIN.get(family) ?? 'security-hygiene';
}

function wrapComment(text, maxWidth = 80) {
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
        if (!cur) {
            cur = w;
        } else if (cur.length + 1 + w.length <= maxWidth) {
            cur += ' ' + w;
        } else {
            lines.push(cur);
            cur = w;
        }
    }
    if (cur) lines.push(cur);
    return lines;
}

function buildSubdomainFile(domainName, rules) {
    const lines = [];
    const titleDomain = domainName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const upperDomain = domainName.replace(/-/g, '_').toUpperCase();
    lines.push('/**');
    lines.push(` * Module: Core Constants — Auto-Refactor SSOT Rules (${titleDomain})`);
    lines.push(` * File Path: src/core/constants/rules-${domainName}.generated.ts`);
    lines.push(' * Architecture Role: Partitioned domain rule constants generated from SSOT.');
    lines.push(' * Dependencies & Triggers: Generated by scripts/common/generate-rule-catalog-types.js.');
    lines.push(` * Responsibilities: Declare canonical string constants for ${rules.length} ${domainName} rules.`);
    lines.push(' * Exit Semantics & Design Rationale: Immutable compile-time literals preventing rule drift.');
    lines.push(' */');
    lines.push('');
    lines.push("import type { RuleCatalogMeta } from './rule-catalog-types';");
    lines.push('');

    const constNames = [];
    for (const rule of rules) {
        const safeId = rule.id.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
        const constName = `RULE_${safeId}`;
        const summary = (rule.summary || '')
            .replace(/\r?\n/g, ' ')
            .replace(/\*\//g, '* /')
            .replace(/eslint-disable/g, 'eslint-[disable]')
            .replace(/@ts-ignore/g, '@ts-[ignore]')
            .replace(/@ts-nocheck/g, '@ts-[nocheck]')
            .replace(/# noqa/g, '# [noqa]');
        lines.push('/**');
        lines.push(` * Canonical ID for rule ${rule.id}.`);
        if (summary) {
            const wrapped = wrapComment(summary, 80);
            for (const wl of wrapped) {
                lines.push(` * ${wl}`);
            }
        }
        lines.push(' */');
        lines.push(`export const ${constName} = '${rule.id}' as const;`);
        lines.push('');
        constNames.push({ constName, rule });
    }

    lines.push(`/** All ${domainName} rule constants as an array. */`);
    lines.push(`export const ALL_${upperDomain}_RULE_IDS = Object.freeze([`);
    for (const item of constNames) {
        lines.push(`    ${item.constName},`);
    }
    lines.push('] as const);');
    lines.push('');

    lines.push(`/** Metadata map for ${domainName} domain rules. */`);
    lines.push(`export const ${upperDomain}_RULE_METADATA: Readonly<Record<string, RuleCatalogMeta>> =`);
    lines.push('    Object.freeze({');
    for (const item of constNames) {
        const rule = item.rule;
        const constName = item.constName;
        const escapedSummary = JSON.stringify(rule.summary || '');
        lines.push(`    [${constName}]: {`);
        lines.push(`        id: ${constName},`);
        lines.push(`        family: ${JSON.stringify(rule.family || '')},`);
        lines.push(`        severity: ${JSON.stringify(rule.severity || 'warning')},`);
        lines.push(`        summary: ${escapedSummary},`);
        lines.push(`        canonical: ${rule.canonical ? 'true' : 'false'},`);
        lines.push(`    },`);
    }
    lines.push('});');
    lines.push('');

    return { content: lines.join('\n'), constNames };
}

function buildTypesFile() {
    const lines = [];
    lines.push('/**');
    lines.push(' * Module: Core Constants — Auto-Refactor SSOT Rule Catalog Common Types');
    lines.push(' * File Path: src/core/constants/rule-catalog-types.ts');
    lines.push(' * Architecture Role: Foundational types for rule catalog metadata.');
    lines.push(' * Dependencies & Triggers: Consumed by subdomain rule modules and rule catalog facade.');
    lines.push(' * Responsibilities: Declare RuleCatalogMeta contract.');
    lines.push(' * Exit Semantics & Design Rationale: Pure type definitions with zero runtime overhead.');
    lines.push(' */');
    lines.push('');
    lines.push('/** Metadata entry for a registered rule in auto-refactor. */');
    lines.push('export interface RuleCatalogMeta {');
    lines.push('    readonly id: string;');
    lines.push('    readonly family: string;');
    lines.push('    readonly severity: string;');
    lines.push('    readonly summary: string;');
    lines.push('    readonly canonical: boolean;');
    lines.push('}');
    lines.push('');
    return lines.join('\n');
}

function buildFacadeFile() {
    const lines = [];
    lines.push('/**');
    lines.push(' * Module: Core Constants — Auto-Refactor SSOT Rule Catalog Facade');
    lines.push(' * File Path: src/core/constants/rule-catalog.generated.ts');
    lines.push(' * Architecture Role: Aggregated facade for all 374 auto-refactor rules across subdomains.');
    lines.push(' * Dependencies & Triggers: Generated by scripts/common/generate-rule-catalog-types.js.');
    lines.push(' * Responsibilities: Re-export partitioned rule constants, union types, and metadata maps.');
    lines.push(' * Exit Semantics & Design Rationale: Immutable facade providing single point of access.');
    lines.push(' */');
    lines.push('');
    lines.push("export * from './rule-catalog-types';");
    lines.push("import type { RuleCatalogMeta } from './rule-catalog-types';");
    lines.push('');

    for (const domain of SUBDOMAINS) {
        const upperDomain = domain.replace(/-/g, '_').toUpperCase();
        lines.push(`import { ALL_${upperDomain}_RULE_IDS, ${upperDomain}_RULE_METADATA } from './rules-${domain}.generated';`);
    }
    lines.push('');

    for (const domain of SUBDOMAINS) {
        lines.push(`export * from './rules-${domain}.generated';`);
    }
    lines.push('');

    lines.push('/** Union of all auto-refactor rule identifiers registered in SSOT. */');
    lines.push('export type AutoRefactorRuleId =');
    for (let i = 0; i < SUBDOMAINS.length; i++) {
        const domain = SUBDOMAINS[i];
        const upperDomain = domain.replace(/-/g, '_').toUpperCase();
        const isLast = i === SUBDOMAINS.length - 1;
        lines.push(`    | (typeof ALL_${upperDomain}_RULE_IDS)[number]${isLast ? ';' : ''}`);
    }
    lines.push('');

    lines.push('/** Immutable lookup map of rule metadata by rule identifier. */');
    lines.push('export const AUTO_REFACTOR_RULE_METADATA: Readonly<Record<string, RuleCatalogMeta>> = Object.freeze({');
    for (const domain of SUBDOMAINS) {
        const upperDomain = domain.replace(/-/g, '_').toUpperCase();
        lines.push(`    ...${upperDomain}_RULE_METADATA,`);
    }
    lines.push('});');
    lines.push('');

    lines.push('/** All auto-refactor rule identifiers as an immutable array. */');
    lines.push('export const ALL_AUTO_REFACTOR_RULE_IDS: readonly AutoRefactorRuleId[] = Object.freeze([');
    for (const domain of SUBDOMAINS) {
        const upperDomain = domain.replace(/-/g, '_').toUpperCase();
        lines.push(`    ...ALL_${upperDomain}_RULE_IDS,`);
    }
    lines.push(']);');
    lines.push('');

    return lines.join('\n');
}

/**
 * Collects every generated artifact as a path plus unformatted content pair.
 *
 * Emission and writing are separated so the whole set can be formatted before any file is touched:
 * a partially formatted directory would leave the tree in a state where the format check fails,
 * which is exactly the drift this generator must not create.
 *
 * @returns Artifact descriptors in a stable order.
 */
function collectArtifacts() {
    if (!fs.existsSync(CATALOG_PATH)) {
        console.error(`[BLOCK] Rule catalog SSOT not found: ${CATALOG_PATH}`);
        process.exit(1);
    }

    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    const catalog = JSON.parse(raw);

    const arRules = (catalog.rules || []).filter((r) => r.project === 'auto-refactor');
    arRules.sort((a, b) => a.id.localeCompare(b.id));

    const domainBuckets = {};
    for (const domain of SUBDOMAINS) {
        domainBuckets[domain] = [];
    }

    for (const rule of arRules) {
        const domain = getDomainGroup(rule.family);
        domainBuckets[domain].push(rule);
    }

    const artifacts = [
        {
            filePath: path.join(TARGET_DIR, 'rule-catalog-types.ts'),
            content: buildTypesFile(),
        },
    ];

    for (const domain of SUBDOMAINS) {
        const rules = domainBuckets[domain];
        const { content } = buildSubdomainFile(domain, rules);
        artifacts.push({
            filePath: path.join(TARGET_DIR, `rules-${domain}.generated.ts`),
            content,
        });
    }

    artifacts.push({
        filePath: path.join(TARGET_DIR, 'rule-catalog.generated.ts'),
        content: buildFacadeFile(),
    });

    return { artifacts, ruleCount: arRules.length };
}

/**
 * Reports whether each artifact on disk already matches its formatted generation.
 *
 * Comparison is against the formatted text, not the raw builder output: the contract is that a
 * clean tree stays clean after regeneration, which only holds if the on-disk form is the formatted
 * one.
 *
 * @param artifacts - Artifact descriptors produced by the builder pass.
 * @returns Relative paths of files whose content differs from the formatted generation.
 */
async function findDriftedArtifacts(artifacts) {
    const drifted = [];
    for (const artifact of artifacts) {
        const expected = await formatGenerated(artifact.content, artifact.filePath);
        const actual = fs.existsSync(artifact.filePath)
            ? fs.readFileSync(artifact.filePath, 'utf8')
            : null;
        if (actual !== expected) {
            drifted.push(path.relative(REPO_ROOT, artifact.filePath));
        }
    }
    return drifted;
}

async function writeArtifacts(artifacts) {
    for (const artifact of artifacts) {
        const formatted = await formatGenerated(artifact.content, artifact.filePath);
        fs.writeFileSync(artifact.filePath, formatted, 'utf8');
    }
}

async function main() {
    const checkOnly = process.argv.includes('--check');
    const { artifacts, ruleCount } = collectArtifacts();

    if (checkOnly) {
        const drifted = await findDriftedArtifacts(artifacts);
        if (drifted.length > 0) {
            console.error('[BLOCK] Generated artifacts are out of sync with the SSOT:');
            for (const file of drifted) {
                console.error(`  - ${file}`);
            }
            console.error('Run node scripts/common/generate-rule-catalog-types.js to regenerate.');
            process.exit(1);
        }
        console.log(`PASS: ${artifacts.length} generated artifacts match the SSOT.`);
        return;
    }

    await writeArtifacts(artifacts);
    console.log(
        `PASS: Generated ${ruleCount} rules across ${SUBDOMAINS.length} subdomains in ${TARGET_DIR}`,
    );
}

main().catch((err) => {
    console.error(`[BLOCK] Rule catalog generation failed: ${err.message}`);
    process.exit(1);
});
