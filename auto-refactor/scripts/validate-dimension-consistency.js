/**
 * Module: Validation — Rule Table / Family Routing Consistency
 * File Path: scripts/validate-dimension-consistency.js
 * Architecture Role: Guards the invariant that one finding is charged to one quality axis.
 *   The declarative table (DIMENSION_RULES) and the family map (FAMILY_DIMENSIONS) both decide
 *   which axis a finding belongs to, and they are maintained independently. When they disagree
 *   for the same rule id, the severity fallback charged a second, different axis on top of the
 *   one the table had just charged, so the finding was counted twice across two dimensions.
 *   Two concrete instances this caught: CPX-NEST-001 / CPX-STM-001 (table: maintainability,
 *   family: performanceEfficiency via the bare CPX catch-all) and the GOV-TYP-* and
 *   CMP-* / GOV-PRF-* families (table: modernity + semanticPurity, family: a different axis).
 * Dependencies & Triggers: reads the built `dimensionRuleTable`, `dimensionDeductions` and
 *   `rules/registry` modules, so it checks what actually ships rather than the sources.
 * Responsibilities: fail the build when a registered rule's family route contradicts the axis
 *   its analyzer is charged to by the table, when any analyzer is charged to no axis, when a
 *   bare family prefix cannot resolve, and when an analyzer charges one finding to too many
 *   axes (which would count the same signal repeatedly through the geometric mean).
 * Exit Semantics & Design Rationale: Read-only assertion over the built registry; exits non-zero
 *   on contradiction so the inconsistency cannot reappear silently.
 */
const assert = require('assert');
const path = require('path');

const { DIMENSION_RULES } = require(
  path.join(__dirname, '..', 'dist', 'core', 'scoring', 'dimensionRuleTable.js'),
);
const { familyDimensionOf } = require(
  path.join(__dirname, '..', 'dist', 'core', 'scoring', 'dimensionDeductions.js'),
);
const { RULE_REGISTRY } = require(
  path.join(__dirname, '..', 'dist', 'core', 'rules', 'registry.js'),
);

/**
 * Upper bound on how many quality axes one finding may be charged to.
 *
 * Two is the design intent for most defects: a problem can legitimately be both structural
 * and security related. The stdlib analyzer reaches four because its rule families each map
 * to a different axis, and that is registered deliberately. The bound exists so a future
 * analyzer cannot silently start charging the same signal to many axes and have it counted
 * repeatedly through the geometric mean.
 */
const MAX_AXES_PER_FINDING = 4;

/**
 * Axes each analyzer can be charged to by the declarative table.
 *
 * @returns Analyzer id to the set of axes it deducts.
 */
function axesByAnalyzer() {
  const map = new Map();
  for (const row of DIMENSION_RULES) {
    if (!map.has(row.analyzer)) {
      map.set(row.analyzer, new Set());
    }
    map.get(row.analyzer).add(row.dimension);
  }
  return map;
}

/**
 * Evaluate every registered rule against the table and keep the axes it actually matches.
 *
 * A multi-axis analyzer is not itself a conflict: the governance analyzer legitimately
 * deducts `modernity` for one rule and `semanticPurity` for another. The invariant is
 * per rule, not per analyzer, so the table is evaluated finding by finding and only the
 * axes a given rule id really triggers are compared against its family route.
 *
 * @param analyzer - Analyzer id the rule is emitted by.
 * @param ruleId - Emitted rule id.
 * @param message - Finding message, which some rows match on as a fragment.
 * @returns Axes the table charges this rule to.
 */
function axesForRule(analyzer, ruleId, message) {
  const finding = { analyzer, rule: ruleId, message, severity: 'warning' };
  const axes = new Set();
  for (const row of DIMENSION_RULES) {
    if (row.analyzer !== analyzer) continue;
    if (axes.has(row.dimension)) continue;
    if (row.covers(finding)) axes.add(row.dimension);
  }
  return axes;
}

/**
 * Assert every registered rule's family route is one of the axes its finding is charged to.
 *
 * @returns Nothing; throws on the first contradiction.
 */
function checkFamilyRoutingAgreement() {
  const conflicts = [];

  for (const rule of RULE_REGISTRY) {
    const routed = familyDimensionOf(rule.id);
    if (!routed) continue;
    const axes = axesForRule(rule.analyzer, rule.id, rule.message ?? rule.id);
    if (axes.size === 0) continue; // this finding is not charged by the table at all
    if (axes.has(routed)) continue;
    conflicts.push(
      `${rule.id} (analyzer=${rule.analyzer}) family-routes to "${routed}" ` +
        `but the table charges it to [${[...axes].join(', ')}]`,
    );
  }

  assert.deepStrictEqual(
    conflicts,
    [],
    `family routing contradicts the deduction table for ${conflicts.length} rule(s):\n  ` +
      conflicts.join('\n  '),
  );
  console.log(
    `  [PASS] ${RULE_REGISTRY.length} rule(s) agree with the deduction table on their axis`,
  );
}

/**
 * Assert every analyzer the table owns deducts at least one axis.
 *
 * @returns Nothing; throws when an analyzer deducts no axis.
 */
function checkAnalyzersAreCharged() {
  const uncharged = [];
  for (const [analyzer, axes] of axesByAnalyzer()) {
    if (axes.size === 0) uncharged.push(analyzer);
  }
  assert.deepStrictEqual(uncharged, [], `analyzers charged to no axis: ${uncharged.join(', ')}`);
  console.log(
    `  [PASS] all ${axesByAnalyzer().size} table-owned analyzer(s) deduct at least one axis`,
  );
}

/**
 * Assert no rule family route is unreachable because a bare family id cannot match.
 *
 * @returns Nothing; throws when a family prefix never resolves.
 */
function checkBareFamilyIdsResolve() {
  const { FAMILY_DIMENSIONS } = require(
    path.join(__dirname, '..', 'dist', 'core', 'scoring', 'dimensionDeductions.js'),
  );
  const unresolved = Object.keys(FAMILY_DIMENSIONS).filter(
    (family) => familyDimensionOf(family) === null,
  );
  assert.deepStrictEqual(
    unresolved,
    [],
    `family ids that never match any rule id: ${unresolved.join(', ')}`,
  );
  console.log(
    `  [PASS] all ${Object.keys(FAMILY_DIMENSIONS).length} family prefix(es) resolve for a bare id`,
  );
}

/**
 * Assert a single finding is charged to a bounded number of quality axes.
 *
 * Multi-axis charging is intentional in places — a leaked credential is both an architecture
 * breach and a security defect — but nothing recorded how far it went. A rule that matched
 * every row of a multi-axis analyzer (stdlib reaches four) would have the same physical
 * signal counted four times through four indices and then a geometric mean, which is not
 * obviously intended and was invisible. This records the current shape so growth is a
 * deliberate change rather than a side effect.
 *
 * @returns Nothing; throws when an analyzer exceeds the axis budget.
 */
function checkMultiAxisChargingIsBounded() {
  const tableAxes = axesByAnalyzer();

  const wide = [...tableAxes.entries()]
    .filter(([, axes]) => axes.size > MAX_AXES_PER_FINDING)
    .map(([analyzer, axes]) => `${analyzer} -> ${axes.size} axes [${[...axes].join(', ')}]`);

  assert.deepStrictEqual(
    wide,
    [],
    `analyzer(s) may charge one finding to more than ${MAX_AXES_PER_FINDING} axes: ` +
      `${wide.join('; ')}. Raise MAX_AXES_PER_FINDING only if the multi-axis charge is intended.`,
  );
  const maxAxes = Math.max(...[...tableAxes.values()].map((a) => a.size));
  console.log(
    `  [PASS] no analyzer charges one finding to more than ${MAX_AXES_PER_FINDING} axes ` +
      `(current maximum: ${maxAxes})`,
  );
}

checkFamilyRoutingAgreement();
checkAnalyzersAreCharged();
checkBareFamilyIdsResolve();
checkMultiAxisChargingIsBounded();
console.log('\nALL DIMENSION CONSISTENCY CHECKS PASSED SUCCESSFULLY!');
