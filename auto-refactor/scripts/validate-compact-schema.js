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
const fs = require('fs');
const os = require('os');
const path = require('path');
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
  // The two counters answer different questions; conflating them is the error this pins down.
  assert.strictEqual(
    compact.counts.issues,
    BULK_FINDING_COUNT,
    'counts.issues reports the whole report, including info-tier and suppressed findings',
  );
  assert.notStrictEqual(
    compact.vectors.length + compact.truncated,
    compact.counts.issues,
    'counts.issues must not be derived from the vector budget once the info tier is excluded',
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
  testHydrationPartiality(report);
  console.log('  ✔ ids, rules, severities and locations survive the round trip');
}

/**
 * Assert a truncated document hydrates into a report that admits it is incomplete.
 *
 * `partial` is the only signal separating "this document described the whole scan" from "this
 * document described part of it", and the whole round trip passes without ever setting it. A
 * consumer that reads `summary.issuesTotal` as the length of `issues` would then treat a capped
 * sidecar as a complete inventory — the failure this compat layer exists to prevent, silently
 * reproduced by the compat layer itself.
 */
function testHydrationPartiality(report) {
  const capped = buildCompactReport(report, { maxVectors: 2, maxMessageChars: 500 });
  const hydrated = hydrateCompactReport(capped);
  assert.strictEqual(capped.truncated > 0, true, 'the fixture must actually truncate');
  assert.strictEqual(hydrated.partial, true, 'a truncated document must report partiality');
  assert.strictEqual(
    hydrated.report.issues.length,
    2,
    'hydration returns only the vectors the document carried',
  );
  assert.strictEqual(
    hydrated.report.summary.issuesTotal,
    report.summary.issuesTotal,
    'the summary total still reflects the whole scan, which is why partial must be honoured',
  );
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
 * Assert the overlap-collapsed claim set is additive and correctly scoped.
 *
 * Two properties matter and neither is observable from `vectors` alone: a claim must reference
 * only findings the consumer actually received, and two findings at *different* lines must never
 * be collapsed even when their rules share a cluster — otherwise the compact view would report
 * one defect where the code has two repair sites.
 */
function testOverlapClaimProjection() {
  console.log('\n7. Testing overlap claim projection...');

  const at = (rules, lines) =>
    rules.map((rule, index) => ({
      id: `analyzer:${rule}:src/core/report.ts:${lines[index]}`,
      analyzer: 'complexity',
      rule,
      severity: 'warning',
      message: `${rule} fired`,
      location: {
        file: 'src/core/report.ts',
        start: { line: lines[index], column: 1 },
        end: { line: lines[index], column: 20 },
      },
      detail: {},
    }));

  // One coordinate carrying three members of the nested-control-flow cluster.
  const report = createBulkReport();
  report.issues = at(['CPX-NEST-001', 'CPX-NEST-002', 'SIM-GUARD-001'], [40, 40, 40]);
  report.summary.issuesTotal = report.issues.length;
  report.summary.bySeverity = { error: 0, warning: 3, info: 0 };

  const compact = buildCompactReport(report, { includeInfo: true });
  assert.ok(Array.isArray(compact.clusters), 'a same-coordinate cluster must produce a claim');
  assert.strictEqual(compact.clusters.length, 1, 'one cluster explains the one coordinate');
  const claim = compact.clusters[0];
  assert.strictEqual(claim.at, 'src/core/report.ts:40');
  assert.strictEqual(claim.cluster, 'nested-control-flow');
  assert.strictEqual(claim.rules.length, 3);
  assert.ok(claim.rules.includes(claim.primary), 'the primary rule must be one of the members');

  // Additivity: collapsing must not remove any vector.
  assert.strictEqual(
    compact.vectors.length,
    3,
    'claim projection is additive; every finding stays in vectors',
  );

  // Scope: the same rules on different lines are distinct repair sites and must stay unmerged.
  const splitReport = createBulkReport();
  splitReport.issues = at(['CPX-NEST-001', 'CPX-NEST-002'], [10, 90]);
  splitReport.summary.issuesTotal = 2;
  splitReport.summary.bySeverity = { error: 0, warning: 2, info: 0 };
  const splitCompact = buildCompactReport(splitReport, { includeInfo: true });
  assert.strictEqual(
    splitCompact.clusters,
    undefined,
    'findings on different lines must not be collapsed into one claim',
  );

  // Scope: same coordinate but rules from unrelated clusters must not merge.
  const unrelatedReport = createBulkReport();
  unrelatedReport.issues = at(['CPX-NEST-001', 'PRF-MEM-001'], [55, 55]);
  unrelatedReport.summary.issuesTotal = 2;
  unrelatedReport.summary.bySeverity = { error: 0, warning: 2, info: 0 };
  const unrelatedCompact = buildCompactReport(unrelatedReport, { includeInfo: true });
  assert.strictEqual(
    unrelatedCompact.clusters,
    undefined,
    'rules from unrelated clusters must not be collapsed',
  );

  testClaimSurvivesEmissionCap();
  console.log('  ✔ claims are additive, coordinate-scoped and cluster-scoped');
}

/**
 * Assert a claim is derived from the eligible set rather than the surviving vector window.
 *
 * This is the property that separates a useful claim from a decorative one. Deriving claims from
 * the capped window makes them vanish under any realistic budget: an overlap sits at one
 * coordinate, so its members are adjacent in the sorted order and a small `maxVectors` either
 * drops all of them or keeps only the first — in both cases the report shows no overlap at all.
 * Asserting only the uncapped path would pass while the shipped budget emitted nothing.
 */
function testClaimSurvivesEmissionCap() {
  const report = createBulkReport();
  const bulk = [];
  // Distinct files keep the filler ahead of the overlap in severity-then-file ordering.
  for (let index = 0; index < 40; index += 1) {
    const file = `src/filler/${String(index).padStart(2, '0')}.ts`;
    bulk.push({
      id: `analyzer:NAM-FUN-001:${file}:1`,
      analyzer: 'naming',
      rule: 'NAM-FUN-001',
      severity: 'warning',
      message: 'filler',
      location: { file, start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
      detail: {},
    });
  }
  const overlapFile = 'src/zz-tail.ts';
  const overlap = ['GOV-SAN-001', 'HYG-STB-002'].map((rule) => ({
    id: `analyzer:${rule}:${overlapFile}:9`,
    analyzer: 'hygiene',
    rule,
    severity: 'warning',
    message: 'overlap',
    location: {
      file: overlapFile,
      start: { line: 9, column: 1 },
      end: { line: 9, column: 2 },
    },
    detail: {},
  }));
  report.issues = [...bulk, ...overlap];
  report.summary.issuesTotal = report.issues.length;
  report.summary.bySeverity = { error: 0, warning: report.issues.length, info: 0 };

  // Budget lands strictly between the overlapping members, so only the first one survives.
  const capped = buildCompactReport(report, { includeInfo: true, maxVectors: 41 });
  assert.strictEqual(capped.truncated, 1, 'the cap must drop exactly the trailing member');
  assert.ok(
    !capped.vectors.some((vector) => vector[2] === `${overlapFile}:9` && vector[0] === 'HYG-STB-002'),
    'the fixture must actually withhold the trailing member',
  );
  assert.ok(
    Array.isArray(capped.clusters) && capped.clusters.length === 1,
    'a claim whose members straddle the cap must still be reported',
  );
  assert.deepStrictEqual(
    capped.clusters[0].rules.slice().sort(),
    ['GOV-SAN-001', 'HYG-STB-002'],
    'the claim must name both members even though only one vector survived',
  );
}

/**
 * Assert the CLI render path resolves the compact format.
 */
function testRenderDispatch() {
  console.log('\n8. Testing render dispatch for the compact format...');
  const rendered = render(createBulkReport(), 'compact');
  const parsed = JSON.parse(rendered);
  assert.strictEqual(parsed.schema, 'cas-v3');
  assert.ok(Array.isArray(parsed.vectors));
  console.log('  ✔ render(report, "compact") emits a parseable CAS v3 document');
}

/**
 * Assert the offline backfill refuses to replace a sidecar a producer wrote.
 *
 * This is the one asymmetry in the migrator that a unit-level assertion cannot reach: the
 * migrator only ever sees an aggregate artifact, so its projection is always vector-free, while
 * the producer that ran the scan emits vectors and claims. Running the documented maintenance
 * command over the reports directory therefore hits both kinds of file at once, and an
 * unconditional write would silently replace the richer sidecar with a hollow grade. The children
 * run against a throwaway directory so the real reports tree is never mutated by a test.
 */
function testMigratorPreservesProducerSidecar() {
  console.log('\n9. Testing offline migrator sidecar preservation...');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cas-migrator-'));
  const scriptsDir = path.join(__dirname);
  try {
    // Aggregate artifact: has metrics but no findings, which is all the migrator ever sees.
    const aggregatePath = path.join(sandbox, 'aggregate.json');
    fs.writeFileSync(
      aggregatePath,
      JSON.stringify({
        metrics: { totalIssues: 12, compositeScore: 91.5, grade: 'A' },
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
      'utf8',
    );
    const sidecarPath = path.join(sandbox, 'aggregate.cas.json');
    const producerSidecar = {
      schema: 'cas-v3',
      tool: 'auto-refactor',
      version: '0.4.0',
      ts: '2026-01-01T00:00:00.000Z',
      root: '.',
      verdict: 'WARN',
      counts: { files: 1, issues: 12, errors: 0, warns: 12, info: 0 },
      health: { score: 91.5, grade: 'A' },
      dimensions: {},
      bottlenecks: [],
      pal: ['governance'],
      vectors: [['NAM-LEN-001', 1, 'src/a.ts:1', 'kept', null, 0]],
      clusters: [{ at: 'src/a.ts:1', cluster: 'stub-and-sanitize', rules: ['NAM-LEN-001', 'GOV-SAN-001'], primary: 'NAM-LEN-001' }],
    };
    fs.writeFileSync(sidecarPath, JSON.stringify(producerSidecar), 'utf8');

    const result = require('child_process').spawnSync(
      process.execPath,
      [path.join(scriptsDir, 'migrate-report-artifacts.js'), sandbox, '--write'],
      { encoding: 'utf8' },
    );
    assert.strictEqual(result.status, 0, `migrator must exit cleanly: ${result.stderr}`);

    const survived = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    assert.deepStrictEqual(
      survived.vectors,
      producerSidecar.vectors,
      'a producer sidecar must not be replaced by a vector-free projection',
    );
    assert.deepStrictEqual(
      survived.clusters,
      producerSidecar.clusters,
      'claims the producer derived must survive a backfill run',
    );

    // A sidecar with no vectors carries nothing worth protecting, so the migrator replaces it and
    // stays idempotent instead of reporting the same file as preserved forever.
    fs.writeFileSync(
      sidecarPath,
      JSON.stringify({ ...producerSidecar, vectors: [], clusters: undefined }),
      'utf8',
    );
    const rerun = require('child_process').spawnSync(
      process.execPath,
      [path.join(scriptsDir, 'migrate-report-artifacts.js'), sandbox, '--write'],
      { encoding: 'utf8' },
    );
    assert.strictEqual(rerun.status, 0);
    assert.match(rerun.stdout, /1 migrated/, 'a hollow sidecar must be replaceable');
    console.log('  ✔ empty-sidecar artifacts still backfill; producer sidecars are preserved');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function main() {
  console.log('=== [CAS v3] Validating compact agent schema and legacy migration ===\n');
  testProjectionFidelity();
  testInfoInclusionPolicy();
  testVectorOrderingAndShape();
  testHydrationRoundTrip();
  testTokenFrugality();
  testLegacyMigration();
  testOverlapClaimProjection();
  testRenderDispatch();
  testMigratorPreservesProducerSidecar();
  console.log('\n================================================================');
  console.log('🎉 ALL COMPACT AGENT SCHEMA CHECKS PASSED!');
  console.log('================================================================');
}

main();
