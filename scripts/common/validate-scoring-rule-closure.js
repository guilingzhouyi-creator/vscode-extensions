/**
 * Module: Tooling — Scoring Rule Closure & Orthogonal Dimension Guard
 * File Path: scripts/common/validate-scoring-rule-closure.js
 * Architecture Role: SSOT gate verifying 100% bidirectional closure between rule-catalog.json
 *   and the Ten-Dimensional Quality Scoring System (FAMILY_DIMENSIONS & dimensionRuleTable).
 * Dependencies & Triggers: Consumes scripts/common/rule-catalog.json and
 *   auto-refactor/src/core/scoring/dimensionDeductions.ts; invoked by pre-commit and audit-all gates.
 * Responsibilities:
 *   1. Assert every registered rule ID in SSOT maps deterministically to a Quality Dimension.
 *   2. Guard against rule drift and orphaned rules that would bypass dimension deductions.
 *   3. Enforce valid 10-dimension orthotope distribution across the entire workspace.
 * Exit Semantics & Design Rationale: Exits 0 on 100% closure, 1 on any unmapped rule.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CATALOG_PATH = path.join(REPO_ROOT, 'scripts', 'common', 'rule-catalog.json');
const DEDUCTIONS_TS_PATH = path.join(
  REPO_ROOT,
  'auto-refactor',
  'src',
  'core',
  'scoring',
  'dimensionDeductions.ts',
);

const TEN_DIMENSIONS_CONTRACT = require('./ten-dimensions-contract.json');
const VALID_DIMENSIONS = Object.freeze(
  new Set(TEN_DIMENSIONS_CONTRACT.dimensions.map((dimension) => dimension.key)),
);

/**
 * Extracts the static mapping of rule family prefixes to quality dimensions from TypeScript source.
 *
 * @param {string} tsContent - Raw dimensionDeductions.ts file content.
 * @returns {Record<string, string>} Normalized family prefix to canonical dimension map.
 */
function extractFamilyDimensionsMap(tsContent) {
  const match = tsContent.match(
    /export const FAMILY_DIMENSIONS: Record<string, QualityDimension> = \{([\s\S]*?)\};/,
  );
  if (!match) {
    throw new Error('Could not find FAMILY_DIMENSIONS declaration in dimensionDeductions.ts');
  }

  const map = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const kvMatch = trimmed.match(
      /^(?:'([^']+)'|([a-zA-Z0-9_-]+))\s*:\s*(?:'([^']+)'|([a-zA-Z0-9_]+)),?/,
    );
    if (kvMatch) {
      const key = kvMatch[1] || kvMatch[2];
      const valRaw = kvMatch[3] || kvMatch[4];
      const val = valRaw.startsWith('DIMENSION_')
        ? valRaw
            .replace('DIMENSION_', '')
            .toLowerCase()
            .replace(/_([a-z])/g, (_, l) => l.toUpperCase())
        : valRaw;

      let canonicalDim = val;
      for (const d of VALID_DIMENSIONS) {
        if (d.toLowerCase() === val.toLowerCase()) {
          canonicalDim = d;
          break;
        }
      }
      map[key] = canonicalDim;
    }
  }
  return map;
}

/**
 * Resolves the target quality dimension for a specific rule ID using longest-prefix matching.
 *
 * @param {string} ruleId - Canonical rule identifier (e.g. 'FGT-COR-001', 'ARCH-ABS-001').
 * @param {Record<string, string>} familyMap - Prefix to dimension dictionary.
 * @param {string[]} sortedPrefixes - Prefixes sorted descending by length.
 * @returns {string | null} Target dimension or null if unmapped.
 */
function resolveRuleDimension(ruleId, familyMap, sortedPrefixes) {
  for (const prefix of sortedPrefixes) {
    if (ruleId === prefix || ruleId.startsWith(prefix + '-')) {
      return familyMap[prefix];
    }
  }
  return null;
}

/**
 * Verifies 100% bidirectional closure between catalog rules and 10-dimensional space.
 *
 * @param {object} [options] - Optional override parameters.
 * @param {string} [options.catalogPath] - Path to rule-catalog.json.
 * @param {string} [options.deductionsTsPath] - Path to dimensionDeductions.ts.
 * @returns {{
 *   ok: boolean,
 *   totalRules: number,
 *   mappedRules: number,
 *   unmapped: string[],
 *   invalidDims: Array<{ rule: string, dim: string }>,
 *   dimCounts: Record<string, number>,
 *   familyCount: number
 * }}
 */
function verifyScoringRuleClosure(options = {}) {
  const catPath = options.catalogPath || CATALOG_PATH;
  const dedPath = options.deductionsTsPath || DEDUCTIONS_TS_PATH;

  if (!fs.existsSync(catPath)) {
    throw new Error(`Rule catalog not found: ${catPath}`);
  }
  if (!fs.existsSync(dedPath)) {
    throw new Error(`dimensionDeductions.ts not found: ${dedPath}`);
  }

  const catalog = JSON.parse(fs.readFileSync(catPath, 'utf8'));
  const rules = catalog.rules || [];
  const tsContent = fs.readFileSync(dedPath, 'utf8');
  const familyMap = extractFamilyDimensionsMap(tsContent);
  const sortedPrefixes = Object.keys(familyMap).sort((a, b) => b.length - a.length);

  const dimCounts = {};
  for (const d of VALID_DIMENSIONS) {
    dimCounts[d] = 0;
  }

  const unmapped = [];
  const invalidDims = [];

  for (const r of rules) {
    const dim = resolveRuleDimension(r.id, familyMap, sortedPrefixes);
    if (!dim) {
      unmapped.push(r.id);
    } else if (!VALID_DIMENSIONS.has(dim)) {
      invalidDims.push({ rule: r.id, dim });
    } else {
      dimCounts[dim]++;
    }
  }

  const ok = unmapped.length === 0 && invalidDims.length === 0;
  return {
    ok,
    totalRules: rules.length,
    mappedRules: rules.length - unmapped.length,
    unmapped,
    invalidDims,
    dimCounts,
    familyCount: Object.keys(familyMap).length,
  };
}

function main() {
  const result = verifyScoringRuleClosure();

  console.log('===============================================================');
  console.log(' 🛡️  Ten-Dimensional Rule Closure & Orthogonal Space Audit');
  console.log('===============================================================');
  console.log(` • Total SSOT Catalog Rules : ${result.totalRules}`);
  console.log(` • Registered Family Prefixes: ${result.familyCount}`);
  console.log(
    ` • Successfully Mapped Rules : ${result.mappedRules} (${((result.mappedRules / result.totalRules) * 100).toFixed(1)}%)`,
  );
  console.log('---------------------------------------------------------------');
  console.log(' 📊 Ten-Dimensional Rule Allocation Breakdown:');
  for (const [dim, count] of Object.entries(result.dimCounts)) {
    const pct = ((count / result.totalRules) * 100).toFixed(1);
    console.log(`   - ${dim.padEnd(25)}: ${String(count).padStart(3)} rules (${pct.padStart(5)}%)`);
  }
  console.log('---------------------------------------------------------------');

  if (result.invalidDims.length > 0) {
    console.error(`✖ Found ${result.invalidDims.length} rules mapped to invalid dimensions:`);
    for (const item of result.invalidDims.slice(0, 10)) {
      console.error(`   • ${item.rule} -> ${item.dim}`);
    }
    process.exit(1);
  }

  if (result.unmapped.length > 0) {
    console.error(`✖ Found ${result.unmapped.length} unmapped rules bypassing Ten-Dimensional routing:`);
    for (const rule of result.unmapped.slice(0, 15)) {
      console.error(`   • ${rule}`);
    }
    process.exit(1);
  }

  console.log('✔ PASS: 100% Rule Closure Achieved - All rules strictly routed to Ten-Dimensional space.');
  console.log('===============================================================\n');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  extractFamilyDimensionsMap,
  resolveRuleDimension,
  verifyScoringRuleClosure,
  VALID_DIMENSIONS,
};
