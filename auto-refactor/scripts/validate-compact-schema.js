/**
 * Module: Validation — Compact Agent Schema (CAS v3) Projection & Migration
 * File Path: scripts/validate-compact-schema.js
 * Architecture Role: Guards the contract between the verbose ScanReport model and the
 *   token-frugal positional wire format, including the migration of historical artifacts that
 *   were written before the compact schema existed.
 * Dependencies & Triggers: Consumes ../dist/api; executed by the parallel suite runner.
 * Responsibilities:
 *   1. Assert the projection preserves verdict, counters, dimension scores and bottlenecks.
 *   2. Assert positional vectors round-trip back into canonical issue records.
 *   3. Assert the compact document is materially smaller than the verbose JSON for a bulk
 *      finding set, since token frugality is the reason the format exists.
 *   4. Assert each historical artifact shape normalizes, and an unrecognized shape is rejected.
 * Exit Semantics & Design Rationale: Exits non-zero on any contract breach. Size is asserted as a
 *   ratio rather than a byte count so the check cannot rot as message lengths evolve, and the
 *   rejection case is asserted explicitly because silently coercing an unknown payload into an
 *   empty document would read to a consumer as a clean scan.
 */
'use strict';

const assert = require('assert');
const {
  buildCompactReport,
  hydrateCompactReport,
  migrateLegacyReport,
  isCompactReport,
  toCompactReportJson,
  render,
} = require('../dist/api');

const BULK_FINDING_COUNT = 240;
const ANALYZER_CYCLE = ['performance', 'governance', 'complexity', 'comments'];
const RULE_CYCLE = ['PRF-IO-001', 'GOV-TYP-006', 'high-complexity', 'CMT-DOC-001'];
const SEVERITY_CYCLE = ['error', 'warning', 'warning', 'info'];
const TOPOLOGY_CYCLE = ['src/core/cache.ts', 'src/core/report.ts', 'src/api.ts', 'src/index.ts'];

/**
 * Build one finding for the synthetic bulk report.
 *
 * @param {number} index - Position in the synthetic finding list.
 * @returns {object} Issue-shaped record.
 */
function bulkIssue(index) {
  const file = TOPOLOGY_CYCLE[index % TOPOLOGY_CYCLE.length];
  const line = 20 + index;
  const analyzer = ANALYZER_CYCLE[index % ANALYZER_CYCLE.length];
  const rule = RULE_CYCLE[index % RULE_CYCLE.length];
  return {
    id: `${analyzer}:${rule}:${file}:${line}`,
    analyzer,
    rule,
    severity: SEVERITY_CYCLE[index % SEVERITY_CYCLE.length],
    message: `Synthetic diagnostic ${index}: detected a condition that requires an explicit remediation step`,
    location: {
      file,
      start: { line, column: 3 },
      end: { line, column: 40 },
    },
    detail: {},
    suggestion: 'Extract the branch into a named predicate and return early.',
    actionable: {
      action: 'apply_guard_clause',
      code: 'AR:CPX:001',
      safeToAutomate: true,
    },
  };
}

/**
 * Compose a verbose scan report carrying a scored quality breakdown.
 *
 * @returns {object} ScanReport-shaped payload.
 */
function createBulkReport() {
  const issues = Array.from({ length: BULK_FINDING_COUNT }, (_unused, index) => bulkIssue(index));
  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byAnalyzer = {};
  for (const issue of issues) {
    bySeverity[issue.severity] += 1;
    byAnalyzer[issue.analyzer] = (byAnalyzer[issue.analyzer] || 0) + 1;
  }

  return {
    tool: 'auto-refactor',
    version: '0.4.0',
    generatedAt: '2026-10-24T00:00:00.000Z',
    root: '/synthetic/root',
    config: { format: 'compact', thresholds: {}, analyzers: {} },
    summary: {
      filesScanned: 240,
      issuesTotal: issues.length,
      bySeverity,
      byAnalyzer,
      durationMs: 1234,
      suppressedCount: 4,
      warnings: ['cache disabled'],
    },
    issues,
    fileMetrics: [],
    qualityScore: {
      indices: {
        architectureConsistency: 97.5,
        semanticPurity: 96.4,
        codeSecurity: 99.1,
        performanceEfficiency: 94.8,
        standardization: 91.2,
        modernity: 98.7,
        maintainability: 93.3,
        commentQuality: 88.6,
        duplication: 90.4,
        techDebtRisk: 99.5,
      },
      compositeScore: 95.14,
      grade: 'A+',
      confidence: 0.92,
      coverage: 1,
      weights: {},
      rationales: [],
      evaluatedAt: 1,
      deductionsByDimension: {
        standardization: {
          points: 22,
          effectivePoints: 8.8,
          entries: [
            { rule: 'CMT-DOC-001', points: 12, reason: 'missing doc contract' },
            { rule: 'GOV-TYP-006', points: 10, reason: 'missing return type' },
          ],
        },
        maintainability: {
          points: 15,
          effectivePoints: 6.7,
          entries: [{ rule: 'high-complexity', points: 15, reason: 'branch fan-out' }],
        },
      },
    },
    autonomy: { compositeAutonomyIndex: 76.44 },
  };
}

/**
 * Assert the projection carries the report's triage facts unchanged.
 */
function testProjectionFidelity() {
  console.log('1. Testing projection fidelity...');
  const report = createBulkReport();
  const compact = buildCompactReport(report, { maxVectors: 10 });
  const infoCount = report.summary.bySeverity.info;
  const actionable = BULK_FINDING_COUNT - infoCount;

  assert.strictEqual(compact.schema, 'cas-v3');
  assert.strictEqual(compact.verdict, 'BLOCK', 'error-tier findings must force a blocking verdict');
  assert.strictEqual(compact.counts.files, 240);
  assert.strictEqual(compact.counts.issues, BULK_FINDING_COUNT);
  assert.strictEqual(compact.counts.suppressed, 4);
  assert.strictEqual(compact.health.score, 95.14);
  assert.strictEqual(compact.health.grade, 'A+');
  assert.strictEqual(compact.health.cai, 76.44);
  assert.strictEqual(compact.dimensions.arch, 97.5, 'dimension keys must use compact aliases');
  assert.strictEqual(compact.dimensions.debt, 99.5);

  assert.strictEqual(compact.bottlenecks[0].rule, 'high-complexity');
  assert.strictEqual(compact.bottlenecks[0].dim, 'maint');
  assert.strictEqual(compact.bottlenecks[0].loss, 15);
  assert.strictEqual(compact.bottlenecks[1].rule, 'CMT-DOC-001');
  assert.strictEqual(compact.bottlenecks[1].dim, 'std');

  assert.strictEqual(compact.vectors.length, 10);
  assert.strictEqual(
    compact.truncated,
    actionable - 10,
    'info-tier findings are excluded from the vector budget by default',
  );
  const vectorRules = new Set(compact.vectors.map((vector) => vector[1]));
  assert.ok(!vectorRules.has(0), 'the default emission policy must omit info-tier findings');
  console.log('  ✔ verdict, counters, dimensions, bottlenecks and truncation preserved');
}

/**
 * Assert the info-tier policy can be lifted when a caller asks for the full set.
 */
function testInfoInclusionPolicy() {
  console.log('\n2. Testing info-tier inclusion policy...');  const report = createBulkReport();
  const withInfo = buildCompactReport(report, { includeInfo: true, maxVectors: 400 });
  assert.strictEqual(withInfo.vectors.length, BULK_FINDING_COUNT);
  assert.strictEqual(withInfo.truncated, undefined);
  assert.ok(
    withInfo.vectors.some((vector) => vector[1] === 0),
    'includeInfo must emit info-tier findings',
  );
  console.log('  ✔ includeInfo lifts the default info-tier exclusion');
}

/**
 * Assert vectors are ordered by urgency and use the positional layout.
 */
function testVectorOrderingAndShape() {
  console.log('\n3. Testing vector ordering and positional shape...');
  const compact = buildCompactReport(createBulkReport(), { maxVectors: 8 });
  assert.ok(compact.pal.length > 0, 'palette must reference at least one analyzer');
  assert.ok(compact.vectors.length > 0);

  for (const vector of compact.vectors) {
    assert.strictEqual(vector.length, 6, 'a vector carries exactly six positions');
    const [rule, rank, location, message, , analyzerIndex] = vector;
    assert.strictEqual(typeof rule, 'string');
    assert.ok(rank >= 0 && rank <= 2, 'severity rank must stay inside the closed range');
    assert.match(location, /^.+:\d+$/, 'location must be file:line');
    assert.strictEqual(typeof message, 'string');
    assert.ok(
      typeof analyzerIndex === 'number' && analyzerIndex < compact.pal.length,
      'analyzer index must resolve inside the palette',
    );
  }

  const ranks = compact.vectors.map((vector) => vector[1]);
  const sorted = [...ranks].sort((left, right) => right - left);
  assert.deepStrictEqual(ranks, sorted, 'vectors must be emitted highest severity first');
  console.log('  ✔ vectors are positional, palette-indexed and severity ordered');
}

/**
 * Assert a compact document hydrates back into canonical issue records.
 */
function testHydrationRoundTrip() {
  console.log('\n4. Testing hydration round trip...');
  const report = createBulkReport();
  const compact = buildCompactReport(report, { maxMessageChars: 500 });
  const hydrated = hydrateCompactReport(compact);

  assert.strictEqual(hydrated.partial, false, 'an untruncated document must not report partiality');
  assert.strictEqual(hydrated.report.issues.length, compact.vectors.length);
  assert.strictEqual(hydrated.report.summary.issuesTotal, report.summary.issuesTotal);

  const original = new Map(report.issues.map((issue) => [issue.id, issue]));
  for (const issue of hydrated.report.issues) {
    const source = original.get(issue.id);
    assert.ok(source, `hydrated id ${issue.id} must match a source finding`);
    assert.strictEqual(issue.rule, source.rule);
    assert.strictEqual(issue.severity, source.severity);
    assert.strictEqual(issue.analyzer, source.analyzer);
    assert.strictEqual(issue.location.file, source.location.file);
    assert.strictEqual(issue.location.start.line, source.location.start.line);
  }
  console.log('  ✔ ids, rules, severities and locations survive the round trip');
}

/**
 * Assert the compact wire format is materially smaller than verbose JSON.
 */
function testTokenFrugality() {
  console.log('\n5. Testing token frugality...');
  const report = createBulkReport();
  const verboseBytes = Buffer.byteLength(JSON.stringify(report, null, 2), 'utf8');
  const compactBytes = Buffer.byteLength(toCompactReportJson(report), 'utf8');
  const ratio = compactBytes / verboseBytes;

  assert.ok(
    compactBytes < verboseBytes,
    `compact output (${compactBytes}B) must be smaller than verbose JSON (${verboseBytes}B)`,
  );
  assert.ok(ratio <= 0.25, `compact output must stay under a quarter of verbose JSON, got ${ratio}`);
  console.log(
    `  ✔ compact projection is ${Math.round((1 - ratio) * 100)}% smaller than verbose JSON`,
  );
}

/**
 * Assert each historical artifact shape normalizes into the compact schema.
 */
function testLegacyMigration() {
  console.log('\n6. Testing historical artifact migration...');
  const report = createBulkReport();
  const fromScanReport = migrateLegacyReport(report, { maxVectors: 5 });
  assert.strictEqual(fromScanReport.schema, 'cas-v3');
  assert.strictEqual(fromScanReport.vectors.length, 5);

  const workspaceSnapshot = {
    protocolVersion: '1.0.0',
    recordedAt: '2026-10-24T03:37:50Z',
    gitRevision: 'dca0361f',
    status: 'PASS',
    workspaceHealthScore: 97.94,
    grade: 'A+',
    autonomyRate: 76.44,
    totalDebt: 4752,
    tenDimensions: { architectureConsistency: 99.74, standardization: 95.37 },
  };
  const fromSnapshot = migrateLegacyReport(workspaceSnapshot);
  assert.strictEqual(fromSnapshot.health.score, 97.94);
  assert.strictEqual(fromSnapshot.verdict, 'PASS');
  assert.strictEqual(fromSnapshot.dimensions.arch, 99.74);
  assert.strictEqual(fromSnapshot.truncated, 4752, 'a findings-free snapshot must declare the gap');

  const baseline = {
    timestamp: '2026-10-24T03:37:43.069Z',
    versions: { engineVersion: '0.4.0' },
    scope: { root: 'auto-refactor', filesScanned: 717 },
    metrics: { compositeScore: 99.03, grade: 'A+', totalIssues: 4752, autonomyRate: 78.63 },
    tenDimensions: { maintainability: 97.71 },
  };
  const fromBaseline = migrateLegacyReport(baseline);
  assert.strictEqual(fromBaseline.health.score, 99.03);
  assert.strictEqual(fromBaseline.counts.files, 717);
  assert.strictEqual(fromBaseline.dimensions.maint, 97.71);

  const passthrough = migrateLegacyReport(fromBaseline);
  assert.strictEqual(passthrough, fromBaseline, 'a compact document must pass through unchanged');
  assert.strictEqual(isCompactReport(passthrough), true);

  assert.throws(
    () => migrateLegacyReport({ unrelated: true }),
    /Unrecognized report artifact/,
    'an unknown shape must be rejected rather than coerced into an empty document',
  );
  console.log('  ✔ scan report, workspace snapshot and baseline all normalize; unknown rejected');
}

/**
 * Assert the CLI render path resolves the compact format.
 */
function testRenderDispatch() {
  console.log('\n7. Testing render dispatch for the compact format...');
  const rendered = render(createBulkReport(), 'compact');
  const parsed = JSON.parse(rendered);
  assert.strictEqual(parsed.schema, 'cas-v3');
  assert.ok(Array.isArray(parsed.vectors));
  console.log('  ✔ render(report, "compact") emits a parseable CAS v3 document');
}

function main() {
  console.log('=== [CAS v3] Validating compact agent schema and legacy migration ===\n');
  testProjectionFidelity();
  testInfoInclusionPolicy();
  testVectorOrderingAndShape();
  testHydrationRoundTrip();
  testTokenFrugality();
  testLegacyMigration();
  testRenderDispatch();
  console.log('\n================================================================');
  console.log('🎉 ALL COMPACT AGENT SCHEMA CHECKS PASSED!');
  console.log('================================================================');
}

main();
