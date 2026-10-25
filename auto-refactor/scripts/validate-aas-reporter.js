/**
 * Module: Test Pipeline — Agent Audit Schema (AAS v1.0) Verification
 * File Path: scripts/validate-aas-reporter.js
 * Architecture Role: Regression gate ensuring the AAS-v1 serialization engine produces
 *   token-frugal, topologically-sorted, file-grouped reports for autonomous AI Agents.
 * Dependencies & Triggers: Consumes compiled dist/api and dist/core/reporting/aas-reporter;
 *   invoked during npm test.
 * Responsibilities:
 *   1. Assert schema contract (AAS_SCHEMA_ID = 'aas-v1', version, timestamp, verdict).
 *   2. Assert topological ordering (L1_CONTRACT files precede L2/L3/L4/L5 files).
 *   3. Assert file-grouped defect structure, eliminating duplicate file path keys.
 *   4. Assert anchor code slice inlining with line context for blocking defects.
 *   5. Assert qualitative verification command generation.
 *   6. Assert token economy and byte compression compared to verbose ScanReport JSON.
 *   7. Assert graceful handling of empty scans and truncation limits.
 * Exit Semantics & Design Rationale: Process exits 0 if all assertions pass, 1 on failure.
 */

'use strict';

const assert = require('assert');
const { buildAasReport, toAasJson, AAS_SCHEMA_ID, render, getReporter } = require('../dist/api');

function createMockScanReport(overrides = {}) {
  return {
    tool: 'auto-refactor',
    version: '0.4.0',
    generatedAt: '2026-10-24T12:00:00.000Z',
    root: '/workspace',
    config: {},
    summary: {
      filesScanned: 10,
      issuesTotal: 4,
      bySeverity: { error: 1, warning: 2, info: 1 },
      byAnalyzer: { architecture: 1, constants: 2, comments: 1 },
      durationMs: 42,
    },
    issues: [
      {
        id: 'constants:hardcoded-string:src/app.ts:3',
        analyzer: 'constants',
        rule: 'hardcoded-string',
        severity: 'warning',
        message: 'Literal string "prod" should be constant.',
        location: {
          file: 'src/app.ts',
          start: { line: 3, column: 10 },
          end: { line: 3, column: 16 },
        },
        detail: {},
        suggestion: 'const ENV_PROD = "prod";',
        actionable: {
          action: 'extract_constant',
          patch: 'replace_line',
          templateSnippet: 'const ENV_PROD = "prod";',
          safeToAutomate: true,
        },
      },
      {
        id: 'architecture:ARCH-CLN-001:src/types/index.ts:2',
        analyzer: 'architecture',
        rule: 'ARCH-CLN-001',
        severity: 'error',
        message: 'Core contract types cannot depend on presentation layer.',
        location: {
          file: 'src/types/index.ts',
          start: { line: 2, column: 1 },
          end: { line: 2, column: 30 },
        },
        detail: {},
        isNew: true,
        actionable: {
          action: 'remove_import',
          safeToAutomate: true,
        },
      },
      {
        id: 'constants:magic-number:src/app.ts:5',
        analyzer: 'constants',
        rule: 'magic-number',
        severity: 'warning',
        message: 'Magic number 42 detected.',
        location: {
          file: 'src/app.ts',
          start: { line: 5, column: 8 },
          end: { line: 5, column: 10 },
        },
        detail: {},
      },
      {
        id: 'comments:CMT-HDR-001:src/utils.ts:1',
        analyzer: 'comments',
        rule: 'CMT-HDR-001',
        severity: 'info',
        message: 'Missing standard module header.',
        location: {
          file: 'src/utils.ts',
          start: { line: 1, column: 1 },
          end: { line: 1, column: 1 },
        },
        detail: {},
      },
    ],
    qualityScore: {
      compositeScore: 92.5,
      grade: 'A',
      confidence: 0.95,
      indices: {
        architectureConsistency: 90,
        semanticPurity: 95,
        codeSecurity: 98,
        performanceEfficiency: 92,
        standardization: 91,
        modernity: 93,
        maintainability: 90,
        commentQuality: 94,
        duplication: 92,
        techDebtRisk: 90,
      },
      weights: {},
      deductionsByDimension: {
        architectureConsistency: {
          points: 10,
          entries: [{ rule: 'ARCH-CLN-001', points: 10 }],
        },
        duplication: {
          points: 5,
          entries: [
            { rule: 'hardcoded-string', points: 3 },
            { rule: 'magic-number', points: 2 },
          ],
        },
      },
      rationales: [],
      evaluatedAt: Date.now(),
    },
    ...overrides,
  };
}

async function runTests() {
  console.log('--- Validating Agent Audit Schema (AAS v1.0) Reporter ---');

  // Test 1: Basic generation & Schema ID
  const report = createMockScanReport();
  const fileMock = {
    'src/types/index.ts': [
      'export interface State {}',
      'import { View } from "../view";',
      'export const X = 1;',
    ].join('\n'),
    'src/app.ts': 'const a = 1;\n// comment\nconst env = "prod";\n\nconst val = 42;',
    'src/utils.ts': 'export function helper() {}',
  };

  const aasDoc = buildAasReport(report, {
    baseDir: '/workspace',
    fileReader: (rel) => fileMock[rel],
    includeInfo: true,
  });

  assert.strictEqual(aasDoc.schema, AAS_SCHEMA_ID, 'Must emit aas-v1 schema discriminator');
  assert.strictEqual(aasDoc.tool, 'auto-refactor');
  assert.strictEqual(aasDoc.verdict, 'BLOCK', 'Must evaluate to BLOCK due to error-level finding');
  assert.strictEqual(aasDoc.health.score, 92.5, 'Health score must match composite');
  assert.strictEqual(aasDoc.health.grade, 'A', 'Health grade must match');
  assert.strictEqual(aasDoc.health.counts.files, 10);
  assert.strictEqual(aasDoc.health.counts.errors, 1);
  assert.strictEqual(aasDoc.health.counts.warns, 2);
  assert.strictEqual(aasDoc.health.counts.info, 1);
  assert.ok(aasDoc.dimensions, 'AAS report must carry dimensions when present');
  assert.strictEqual(aasDoc.dimensions.architectureConsistency, 90);
  assert.strictEqual(aasDoc.dimensions.codeSecurity, 98);
  console.log('✔  Test 1: AAS-v1 protocol and executive health block verified');

  // Test 2: Topological ordering of files
  // src/types/index.ts has ARCH-CLN-001 (L1_CONTRACT) -> must precede src/app.ts and src/utils.ts
  const fileKeys = Object.keys(aasDoc.files);
  assert.strictEqual(fileKeys[0], 'src/types/index.ts', 'L1_CONTRACT file must be ranked first');
  assert.ok(fileKeys.includes('src/app.ts'));
  assert.ok(fileKeys.includes('src/utils.ts'));
  assert.ok(Array.isArray(aasDoc.topology.L1_CONTRACT), 'Topology L1_CONTRACT array must exist');
  assert.strictEqual(aasDoc.topology.L1_CONTRACT[0], 'src/types/index.ts');
  console.log('✔  Test 2: Topological file ordering (L1 -> L5) verified');

  // Test 3: File-grouped structure & inlined anchors
  assert.strictEqual(
    aasDoc.defaultVerify,
    'npm test',
    'Top-level defaultVerify must be set to npm test',
  );
  const typeDefects = aasDoc.files['src/types/index.ts'];
  assert.strictEqual(typeDefects.length, 1);
  assert.strictEqual(typeDefects[0].rule, 'ARCH-CLN-001');
  assert.strictEqual(typeDefects[0].sev, 'BLOCK');
  assert.strictEqual(typeDefects[0].isNew, true, 'isNew must be preserved for baseline triage');
  assert.ok(typeDefects[0].anchor, 'Blocking defect must carry inline anchor code slice');
  assert.ok(typeDefects[0].anchor.includes('> '), 'Anchor must contain target line highlight (> )');
  // verify is omitted when identical to top-level defaultVerify
  // (saving thousands of repeated tokens across report)
  assert.strictEqual(
    typeDefects[0].verify,
    undefined,
    'Defect verify omitted when matching top-level defaultVerify',
  );
  assert.strictEqual(typeDefects[0].fix.action, 'remove_import');

  const appDefects = aasDoc.files['src/app.ts'];
  assert.strictEqual(appDefects.length, 2, 'src/app.ts must group both warnings');
  assert.strictEqual(appDefects[0].line, 3);
  assert.strictEqual(appDefects[0].fix.action, 'extract_constant');
  assert.strictEqual(appDefects[1].line, 5);
  console.log('✔  Test 3: File-grouped defects, anchor slicing, and fixes verified');

  // Test 4: Top quality bottlenecks
  assert.ok(Array.isArray(aasDoc.bottlenecks), 'Bottlenecks must be an array');
  assert.ok(aasDoc.bottlenecks.length >= 2, 'Must list top deduction sources');
  assert.strictEqual(aasDoc.bottlenecks[0].rule, 'ARCH-CLN-001');
  assert.strictEqual(aasDoc.bottlenecks[0].loss, 10);
  console.log('✔  Test 4: Quality deduction bottlenecks verified');

  // Test 5: Token economy & compression comparison
  const verboseJson = JSON.stringify(report, null, 2);
  const aasJson = toAasJson(report, {
    baseDir: '/workspace',
    fileReader: (rel) => fileMock[rel],
    pretty: true,
  });
  const aasCompactJson = toAasJson(report, {
    baseDir: '/workspace',
    fileReader: (rel) => fileMock[rel],
    pretty: false,
  });

  const verboseBytes = Buffer.byteLength(verboseJson, 'utf8');
  const aasBytes = Buffer.byteLength(aasJson, 'utf8');
  const aasCompactBytes = Buffer.byteLength(aasCompactJson, 'utf8');
  const savingsPercent = Math.round((1 - aasCompactBytes / verboseBytes) * 100);

  console.log(
    `   Verbose JSON: ${verboseBytes}B | AAS: ${aasBytes}B | AAS Minified: ${aasCompactBytes}B`,
  );
  console.log(`   Byte savings: ${savingsPercent}%`);
  assert.ok(
    savingsPercent >= 30,
    `AAS format should save significant bytes vs verbose (got ${savingsPercent}%)`,
  );
  console.log('✔  Test 5: Token economy and compression bounds verified');

  // Test 6: Reporter registry & CLI render integration
  const plugin = getReporter('aas');
  assert.ok(plugin, 'AAS reporter must be registered in plugin registry');
  assert.strictEqual(plugin.name, 'aas');

  const renderedFromApi = render(report, 'aas');
  assert.ok(
    renderedFromApi.includes('"schema": "aas-v1"'),
    'render(report, "aas") must emit valid AAS JSON',
  );
  console.log('✔  Test 6: Registry and render dispatch integration verified');

  // Test 7: Empty scan report handling
  const cleanReport = createMockScanReport({
    issues: [],
    summary: {
      filesScanned: 5,
      issuesTotal: 0,
      bySeverity: { error: 0, warning: 0, info: 0 },
      durationMs: 1,
    },
    qualityScore: { compositeScore: 100, grade: 'A+' },
  });
  const cleanAas = buildAasReport(cleanReport);
  assert.strictEqual(cleanAas.verdict, 'PASS');
  assert.strictEqual(cleanAas.health.counts.total, 0);
  assert.strictEqual(Object.keys(cleanAas.files).length, 0);
  console.log('✔  Test 7: Clean zero-defect scan report verified');

  // Test 8: Truncation policy
  const truncatedAas = buildAasReport(report, {
    maxTotalDefects: 2,
    includeInfo: true,
  });
  assert.strictEqual(truncatedAas.truncated, 2, 'Must record omitted defects in truncated count');
  console.log('✔  Test 8: Defect budget and truncation tracking verified');

  console.log('\n--- All Agent Audit Schema (AAS v1.0) Tests Passed! ---');
}

runTests().catch((err) => {
  console.error('FAIL: validate-aas-reporter.js encountered an error:', err);
  process.exit(1);
});
