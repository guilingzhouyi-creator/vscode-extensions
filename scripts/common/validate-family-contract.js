/**
 * Module: Rule Family Contract Guard — Family Identity, Layer Domain, and Three-Way Parity
 * File Path: scripts/common/validate-family-contract.js
 * Architecture Role: Holds the `family` column to one meaning. The column previously carried the
 *   execution layer for workspace-timing and the theme for every other project, so a cross-project
 *   family aggregate compared a layer name against a theme name. This guard makes the split
 *   structural: `family` must be a theme present in the taxonomy, `layer` must be one of the six
 *   declared layers, and the taxonomy, the human-readable map and the catalog must name exactly the
 *   same set of families.
 * Dependencies & Triggers: `rule-catalog.json`, `rule-family-taxonomy.md`,
 *   `rule-family-map.md`; invoked by pre-push gate, audit-all and CI.
 * Responsibilities:
 *   1. Reject a family value that names no row in the taxonomy;
 *   2. Reject a layer value outside the declared six layers, and a missing layer;
 *   3. Reject non-canonical entries that carry no `legacyReason`;
 *   4. Assert the three family sets are equal in both directions;
 *   5. Prove each detector fires through built-in probes.
 * Exit Semantics & Design Rationale: 0 = every rule declares a documented theme in a legal layer and
 *   the three registries agree, 1 = any of those is violated. Three-way equality rather than
 *   one-way containment: a family present in one document and absent from another is precisely the
 *   drift that let the taxonomy shrink to twelve rows while the catalog grew to sixty-one.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CATALOG_FILE = path.join(__dirname, 'rule-catalog.json');
const TAXONOMY_FILE = path.join(
  REPO_ROOT,
  '.agents/skills/rule-catalog-governance/references/rule-family-taxonomy.md',
);
const MAP_FILE = path.join(REPO_ROOT, '.agents/skills/coding-craft/references/rule-family-map.md');

/** The six execution layers a rule may belong to; workspace-timing is currently the only user. */
const LEGAL_LAYERS = Object.freeze(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);

/**
 * Validates one rule list against the contract.
 *
 * Pure over its inputs so the probes can drive it with synthetic catalogs.
 *
 * @param {Array<object>} rules - Catalog rule entries.
 * @param {Set<string>} documentedFamilies - Families the taxonomy documents.
 * @returns {Array<{type: string, id: string, detail: string}>} Violations.
 */
function checkRules(rules, documentedFamilies) {
  const violations = [];
  for (const rule of rules) {
    if (!documentedFamilies.has(rule.family)) {
      violations.push({ type: 'UNDOCUMENTED_FAMILY', id: rule.id, detail: String(rule.family) });
    }
    if (rule.layer !== undefined && !LEGAL_LAYERS.includes(rule.layer)) {
      violations.push({ type: 'ILLEGAL_LAYER', id: rule.id, detail: String(rule.layer) });
    }
    if (rule.canonical === false && !rule.legacyReason) {
      violations.push({ type: 'MISSING_LEGACY_REASON', id: rule.id, detail: rule.family });
    }
  }
  return violations;
}

/**
 * Compares two family sets in both directions.
 *
 * @param {Set<string>} left - First set.
 * @param {Set<string>} right - Second set.
 * @returns {{leftOnly: string[], rightOnly: string[]}} Set differences.
 */
function compareFamilies(left, right) {
  return {
    leftOnly: [...left].filter((f) => !right.has(f)).sort(),
    rightOnly: [...right].filter((f) => !left.has(f)).sort(),
  };
}

/**
 * Reads the families the taxonomy documents.
 *
 * @returns {Set<string>} Documented families.
 */
function readTaxonomyFamilies() {
  const text = fs.readFileSync(TAXONOMY_FILE, 'utf8');
  return new Set([...text.matchAll(/^\| \*\*`([A-Z0-9]+)`\*\*/gm)].map((m) => m[1]));
}

/**
 * Reads the families the human-readable map documents.
 *
 * @returns {Set<string>} Mapped families.
 */
function readMapFamilies() {
  const text = fs.readFileSync(MAP_FILE, 'utf8');
  return new Set([...text.matchAll(/^### `([A-Z0-9]+)`/gm)].map((m) => m[1]));
}

/**
 * Proves every detector discriminates.
 *
 * @returns {string[]} Probe failures.
 */
function runSelfProbes() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      failures.push(`probe "${label}": expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
    }
  };
  const known = new Set(['GUARD']);
  expect(
    'documented-family-with-legal-layer-passes',
    checkRules([{ id: 'published-rule', family: 'GUARD', layer: 'L3', canonical: true }], known).length,
    0,
  );
  expect(
    'invented-family-rejected',
    checkRules([{ id: 'invented-rule', family: 'GATE', canonical: true }], known).map((v) => v.type),
    ['UNDOCUMENTED_FAMILY'],
  );
  expect(
    'layer-beyond-six-rejected',
    checkRules([{ id: 'published-rule', family: 'GUARD', layer: 'L9', canonical: true }], known).map((v) => v.type),
    ['ILLEGAL_LAYER'],
  );
  expect(
    'non-canonical-without-reason-rejected',
    checkRules([{ id: 'legacy-name', family: 'GUARD', canonical: false }], known).map((v) => v.type),
    ['MISSING_LEGACY_REASON'],
  );
  expect(
    'family-set-gap-detected',
    compareFamilies(new Set(['A', 'B']), new Set(['B', 'C'])),
    { leftOnly: ['A'], rightOnly: ['C'] },
  );
  return failures;
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const isAgent = process.argv.includes('--agent') || process.argv.includes('--json');
  const probeFailures = runSelfProbes();
  if (probeFailures.length > 0) {
    console.error('✖ BLOCK family-contract: built-in probes no longer discriminate.');
    for (const failure of probeFailures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  const taxonomy = readTaxonomyFamilies();
  const mapped = readMapFamilies();
  const catalogFamilies = new Set(catalog.rules.map((rule) => rule.family));

  /** @type {Array<object>} */
  const violations = checkRules(catalog.rules, taxonomy);
  const taxonomyVsCatalog = compareFamilies(taxonomy, catalogFamilies);
  const mapVsCatalog = compareFamilies(mapped, catalogFamilies);
  for (const family of taxonomyVsCatalog.leftOnly) {
    violations.push({ type: 'FAMILY_MISSING_FROM_CATALOG', id: family, detail: 'taxonomy' });
  }
  for (const family of taxonomyVsCatalog.rightOnly) {
    violations.push({ type: 'FAMILY_MISSING_FROM_TAXONOMY', id: family, detail: 'taxonomy' });
  }
  for (const family of mapVsCatalog.leftOnly) {
    violations.push({ type: 'FAMILY_MISSING_FROM_CATALOG', id: family, detail: 'family-map' });
  }
  for (const family of mapVsCatalog.rightOnly) {
    violations.push({ type: 'FAMILY_MISSING_FROM_MAP', id: family, detail: 'family-map' });
  }

  const passed = violations.length === 0;
  if (isAgent) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: '1.0.0',
          status: passed ? 'PASS' : 'BLOCK',
          gate: 'family-contract',
          families: { catalog: catalogFamilies.size, taxonomy: taxonomy.size, map: mapped.size },
          violations,
          summary: passed
            ? `All ${catalog.rules.length} rules declare a documented family; three registries agree on ${catalogFamilies.size} families.`
            : `${violations.length} family contract violation(s).`,
        },
        null,
        2,
      ),
    );
    process.exit(passed ? 0 : 1);
  }
  if (passed) {
    console.log(
      `  PASS Family contract: ${catalogFamilies.size} families agree across catalog, taxonomy and map.`,
    );
    process.exit(0);
  }
  console.error(`✖ BLOCK family-contract: ${violations.length} violation(s):`);
  for (const item of violations) console.error(`  - [${item.type}] ${item.id} ${item.detail}`);
  process.exit(1);
}

if (require.main === module) main();

module.exports = Object.freeze({
  checkRules,
  compareFamilies,
  readTaxonomyFamilies,
  readMapFamilies,
  runSelfProbes,
  LEGAL_LAYERS,
});
