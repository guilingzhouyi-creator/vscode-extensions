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
  assert.strictEqual(
    aasDoc.usability,
    undefined,
    'A report whose arbitration pass never ran must omit the usability block, not emit zeroes',
  );
  console.log('✔  Test 1: AAS-v1 protocol and executive health block verified');

  // Test 1b: usability block and per-defect tier/confidence projection
  const arbitratedDoc = buildAasReport(
    {
      ...report,
      summary: {
        ...report.summary,
        arbitration: {
          totalEvaluated: 4,
          prescriptiveCount: 1,
          actionableCount: 2,
          advisoryCount: 1,
          suppressedCount: 0,
          prunedBySliceCount: 0,
          blockingCount: 1,
          gateVerdict: 'blocked',
          uncalibratedCount: 3,
          reviewQueueCount: 1,
          advisoryOnlyRules: ['hardcoded-string'],
          ruleTiers: { 'ARCH-CLN-001': 'T1', 'magic-number': 'T2', 'hardcoded-string': 'T3' },
        },
      },
      issues: report.issues.map((issue) =>
        issue.rule === 'magic-number'
          ? { ...issue, evidence: { confidence: 0.873, requiresRuntime: true } }
          : issue,
      ),
    },
    { baseDir: '/workspace', fileReader: (rel) => fileMock[rel], includeInfo: true },
  );
  assert.deepStrictEqual(
    arbitratedDoc.usability,
    { proven: 1, patchable: 2, advisory: 1, uncalibrated: 3, needsHuman: 1 },
    'Usability block must project the arbitration verdict verbatim',
  );
  const arbitrationDefects = Object.values(arbitratedDoc.files).flat();
  const tieredDefect = arbitrationDefects.find((defect) => defect.rule === 'ARCH-CLN-001');
  assert.strictEqual(tieredDefect.tier, 'T1', 'Rule tier must reach the defect record');
  const confidentDefect = arbitrationDefects.find((defect) => defect.rule === 'magic-number');
  assert.strictEqual(
    confidentDefect.conf,
    0.87,
    'Evidence confidence must be projected at two decimals, not dropped',
  );
  const tierlessDefect = arbitrationDefects.find((defect) => defect.rule === 'hardcoded-string');
  assert.strictEqual(
    tierlessDefect.tier,
    'T3',
    'A rule recorded as advisory must reach the defect record as T3',
  );
  const unrecordedDoc = buildAasReport(
    {
      ...report,
      summary: {
        ...report.summary,
        arbitration: {
          totalEvaluated: 4,
          prescriptiveCount: 1,
          actionableCount: 2,
          advisoryCount: 1,
          suppressedCount: 0,
          prunedBySliceCount: 0,
          blockingCount: 1,
          gateVerdict: 'blocked',
          uncalibratedCount: 3,
          reviewQueueCount: 1,
          advisoryOnlyRules: [],
          ruleTiers: {},
        },
      },
    },
    { baseDir: '/workspace', fileReader: (rel) => fileMock[rel], includeInfo: true },
  );
  const unrecordedDefect = Object.values(unrecordedDoc.files)
    .flat()
    .find((defect) => defect.rule === 'ARCH-CLN-001');
  assert.strictEqual(
    unrecordedDefect.tier,
    undefined,
    'A defect whose rule has no recorded tier must omit the field rather than invent one',
  );
  console.log('✔  Test 1b: Usability block, rule tiers and per-defect confidence verified');

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

  // Test 5: Token economy — every saving must be attributable to a named mechanism
  const verboseJson = JSON.stringify(report, null, 2);
  const aasDefaultJson = toAasJson(report, {
    baseDir: '/workspace',
    fileReader: (rel) => fileMock[rel],
  });
  const aasPrettyJson = toAasJson(report, {
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
  const defaultBytes = Buffer.byteLength(aasDefaultJson, 'utf8');
  const prettyBytes = Buffer.byteLength(aasPrettyJson, 'utf8');
  const aasCompactBytes = Buffer.byteLength(aasCompactJson, 'utf8');
  const savingsPercent = Math.round((1 - aasCompactBytes / verboseBytes) * 100);

  console.log(
    `   Verbose JSON: ${verboseBytes}B | AAS default: ${defaultBytes}B | AAS pretty: ${prettyBytes}B | AAS Minified: ${aasCompactBytes}B`,
  );
  console.log(`   Field-projection savings: ${savingsPercent}%`);
  assert.ok(
    savingsPercent >= 30,
    `Field projection should save significant bytes vs verbose (got ${savingsPercent}%)`,
  );
  // Default serialization must be the frugal one; pretty is opt-in.
  assert.strictEqual(
    defaultBytes,
    aasCompactBytes,
    'toAasJson must emit compact JSON unless pretty:true is requested',
  );
  assert.ok(
    prettyBytes > aasCompactBytes,
    'pretty:true must remain available for human-readable output',
  );
  console.log('✔  Test 5: Token economy, compact default, and pretty opt-in verified');

  // Test 6: Reporter registry & CLI render integration
  const plugin = getReporter('aas');
  assert.ok(plugin, 'AAS reporter must be registered in plugin registry');
  assert.strictEqual(plugin.name, 'aas');

  const renderedFromApi = render(report, 'aas');
  const renderedAasDoc = JSON.parse(renderedFromApi);
  assert.strictEqual(
    renderedAasDoc.schema,
    'aas-v1',
    'render(report, "aas") must emit valid AAS JSON',
  );
  assert.ok(
    !renderedFromApi.includes('\n  "'),
    'render(report, "aas") must emit compact JSON so the CLI path stays frugal',
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

  // Test 9: Sentence token compression engine
  const { compressDiagnosticSentence } = require('../dist/core/reporting/aas-reporter');
  assert.strictEqual(
    compressDiagnosticSentence(
      "Identifier 'LOOP_HEADER_RE' contains unapproved truncated abbreviation 'RE'.",
    ),
    "identifier 'LOOP_HEADER_RE' unapproved abbr 'RE'",
  );
  assert.strictEqual(
    compressDiagnosticSentence(
      "Identifier 'val' is vague and uninformative; lacks domain context.",
    ),
    "identifier 'val' lacks domain context",
  );
  assert.strictEqual(
    compressDiagnosticSentence(
      "Cognitive complexity (19) exceeds threshold (15) in function 'dispatchCommand'",
    ),
    "CC 19 > 15 in 'dispatchCommand'",
  );
  assert.strictEqual(
    compressDiagnosticSentence('Effective code volume budget exceeded.'),
    'ELOC budget exceeded',
  );
  assert.strictEqual(
    compressDiagnosticSentence("Synchronous 'fs.readFileSync' blocks event loop."),
    "sync 'fs.readFileSync' blocks event loop",
  );
  assert.strictEqual(compressDiagnosticSentence('Sync I/O in async method'), 'sync IO in async fn');
  assert.strictEqual(
    compressDiagnosticSentence('Zero transient heap allocation in hot loop bodies violated'),
    'loop transient heap allocation',
  );
  assert.strictEqual(
    compressDiagnosticSentence('Control flow nesting depth (5) exceeds limit (4)'),
    'nesting depth 5 > 4',
  );
  assert.strictEqual(
    compressDiagnosticSentence('Procedure line count (120) exceeds limit (80)'),
    'procedure lines 120 > 80',
  );
  assert.strictEqual(
    compressDiagnosticSentence('Magic number 42 detected without semantic constant.'),
    'magic number 42',
  );
  assert.strictEqual(
    compressDiagnosticSentence("Literal string 'prod' should be constant."),
    "literal string 'prod' not constant",
  );
  assert.strictEqual(
    compressDiagnosticSentence('Facade method merely delegates to inner without value-add'),
    'trampoline pass-through',
  );
  assert.strictEqual(
    compressDiagnosticSentence(
      'String literal "\'use strict\'" (len=12) appears to be a hardcoded UI message or config value.',
    ),
    'hardcoded string "\'use strict\'" (12c)',
  );
  assert.strictEqual(
    compressDiagnosticSentence('Numeric literal 42 should be extracted to a named constant.'),
    'magic number 42',
  );
  assert.strictEqual(
    compressDiagnosticSentence(
      'File has 850 lines (max 600); 12 exports. See split suggestions in detail.',
    ),
    'file 850 > 600 lines (12 exports)',
  );
  assert.strictEqual(
    compressDiagnosticSentence(
      "Function 'runTask' declares 5 parameters (limit: 3); pack cohesive options into a parameter object.",
    ),
    "fn 'runTask' 5 > 3 params",
  );
  assert.strictEqual(
    compressDiagnosticSentence(
      "CommonJS 'require(...)' detected in TypeScript module; use ES module 'import' syntax.",
    ),
    'CommonJS require() in ESM',
  );

  // Coverage ratchet: every rule that emits prose must have a compression path. Pathologically
  // long messages used to escape silently (9.8% of a real scan) because no pattern described them.
  // Each pair below is a real message shape taken from a full `--root src` scan.
  const uncompressibleShapes = [
    [
      'File is large; consider splitting (lines 1001 >= warn threshold 400; functions 31 >= warn threshold 15).',
      'file 1001 >= 400 lines, fns 31 >= 15 (split)',
    ],
    [
      'Function "auditImportShadowing" has cyclomatic complexity 11 (threshold 10).',
      'CC 11 > 10 in auditImportShadowing',
    ],
    [
      "Literal 'High' is repeated 3 times in this file; extract it into a shared constant.",
      "dup literal 'High' x3",
    ],
    [
      'Token density floor breached: tau = 2.16 tokens per effective line, below the 2.5 floor across 299.9 ELOC.',
      'tau 2.16 < 2.5 over 299.9 ELOC',
    ],
    [
      'Dynamic dilution imbalance (ratio 1:3.99 > 1:3): dynamic physical envelope for 140.4 ELOC is 422 LOC, actual is 560 LOC.',
      'dilution 1:3.99 > 1:3 at 140.4 ELOC: 422 vs 560 LOC',
    ],
    [
      "Tautological loop traversal detected in 'printAutonomyAssessment': iteration exhibits zero or negligible state mutation entropy delta (deltaEntropy: 0.00).",
      'tautological loop in printAutonomyAssessment (dH=0.00)',
    ],
  ];
  for (const [rawShape, expected] of uncompressibleShapes) {
    const compressed = compressDiagnosticSentence(rawShape);
    assert.strictEqual(compressed, expected, `Compression mismatch for: ${rawShape}`);
    assert.ok(
      compressed.length < rawShape.length,
      `Compression must shorten this message (was ${rawShape.length}c, got ${compressed.length}c)`,
    );
  }
  console.log(
    '✔  Test 9: High-efficiency Token sentence compression engine verified (including coverage shapes)',
  );

  // Test 10: Scale report >= 70% token savings ratchet
  const scaleIssues = [];
  for (let fileIndex = 0; fileIndex < 10; fileIndex++) {
    const targetFilePath = `src/module_${fileIndex}/service.ts`;
    for (let i = 0; i < 6; i++) {
      scaleIssues.push({
        id: `naming:NAM-ABR-001:${targetFilePath}:${i * 10 + 1}`,
        analyzer: 'naming',
        rule: 'NAM-ABR-001',
        severity: 'warning',
        message: `Identifier 'tempItem_${i}' contains unapproved truncated abbreviation 'tempItem_${i}'.`,
        location: {
          file: targetFilePath,
          start: { line: i * 10 + 1, column: 5 },
          end: { line: i * 10 + 1, column: 15 },
        },
        detail: {
          astKind: 'VariableDeclaration',
          scope: 'BlockScope',
          token: `tempItem_${i}`,
          parentDeclaration: 'FunctionDeclaration',
        },
        actionable: {
          action: 'rename_identifier',
          patch: 'replace_identifier',
          safeToAutomate: true,
          templateSnippet: `expand tempItem_${i}`,
        },
        suggestion: `Expand abbreviation 'tempItem_${i}' to full descriptive name.`,
      });
    }
  }
  const scaleReport = createMockScanReport({ issues: scaleIssues });
  const scaleVerbose = JSON.stringify(scaleReport, null, 2);
  const scaleAas = toAasJson(scaleReport, { baseDir: '/workspace' });
  const scaleVerboseBytes = Buffer.byteLength(scaleVerbose, 'utf8');
  const scaleAasBytes = Buffer.byteLength(scaleAas, 'utf8');
  const scaleSavings = Math.round((1 - scaleAasBytes / scaleVerboseBytes) * 100);
  console.log(
    `   Scale report: Verbose ${scaleVerboseBytes}B | AAS compact ${scaleAasBytes}B | Savings: ${scaleSavings}%`,
  );
  // The 70% envelope is validated against the *compact* default (the form agents receive) rather
  // than a hand-picked pretty/minified mix, so the number cannot be met by the serializer alone.
  assert.strictEqual(
    scaleAasBytes,
    Buffer.byteLength(JSON.stringify(JSON.parse(scaleAas)), 'utf8'),
    'Default AAS output must already be compact JSON',
  );
  assert.ok(
    scaleSavings >= 70,
    `Scale report must achieve >= 70% byte savings in its default compact form (got ${scaleSavings}%)`,
  );
  console.log('✔  Test 10: Scale report >= 70% Token savings ratchet verified');

  // Test 11: Ten-Dimensional rich breakdown (AAS v1.1) and complete Markdown coverage
  const test11Report = createMockScanReport();
  const doc11 = buildAasReport(test11Report, { includeDimensionDetails: true });
  assert.ok(doc11.dimensionDetails, 'AAS v1.1 report must include dimensionDetails');
  assert.strictEqual(typeof doc11.dimensionDetails.codeSecurity.score, 'number');
  assert.strictEqual(typeof doc11.dimensionDetails.codeSecurity.grade, 'string');
  assert.strictEqual(typeof doc11.dimensionDetails.codeSecurity.weight, 'number');
  assert.ok(doc11.health.dimensionSummary, 'AAS health block must include dimensionSummary');
  assert.strictEqual(typeof doc11.health.dimensionSummary.healthyCount, 'number');

  const mdReporter = getReporter('markdown');
  assert.ok(mdReporter, 'Markdown reporter plugin must be registered');
  const mdOutput = mdReporter.format(test11Report);
  assert.ok(mdOutput.includes('代码安全'), 'Missing 代码安全');
  assert.ok(mdOutput.includes('架构一致'), 'Missing 架构一致');
  assert.ok(mdOutput.includes('可维护性'), 'Missing 可维护性');
  assert.ok(mdOutput.includes('性能预算'), 'Missing 性能预算');
  assert.ok(mdOutput.includes('技术债风险'), 'Missing 技术债风险');
  assert.ok(mdOutput.includes('语义纯度'), 'Missing 语义纯度');
  assert.ok(mdOutput.includes('重复率'), 'Missing 重复率');
  assert.ok(mdOutput.includes('标准化'), 'Missing 标准化');
  assert.ok(mdOutput.includes('现代化'), 'Missing 现代化');
  assert.ok(mdOutput.includes('注释质量'), 'Missing 注释质量');
  console.log(
    '✔  Test 11: Ten-Dimensional rich metrics (AAS v1.1) & complete Markdown table verified',
  );

  // Test 12: Truthful metrics mapping (SQALE, Polyglot, Gaming defense, and CAI isolation)
  const enrichedReport = createMockScanReport({
    autonomy: { compositeAutonomyIndex: 88.4 },
    qualityScore: {
      ...test11Report.qualityScore,
      technicalDebt: {
        totalRemediationMinutes: 120,
        technicalDebtRatio: 4.5,
        sqaleGrade: 'A',
      },
      polyglotGeneralization: {
        index: 91.2,
        meanScore: 89.5,
        dispersionPenalty: 0.95,
        standardDeviation: 5.2,
        languageCount: 3,
      },
      densityTensorSummary: {
        compositeDensity: 0.85,
        averageTspr: 0.72,
        averagePor: 0.28,
        averageColumnDensity: 0.65,
        averageMahalanobisDistance: 1.42,
        averageFisherSimplexDistance: 0.31,
      },
    },
    summary: {
      ...test11Report.summary,
      arbitration: {
        totalEvaluated: 1,
        prescriptiveCount: 1,
        actionableCount: 0,
        advisoryCount: 0,
        suppressedCount: 0,
        prunedBySliceCount: 0,
        blockingCount: 0,
        gateVerdict: 'pass',
        uncalibratedCount: 0,
        reviewQueueCount: 0,
        advisoryOnlyRules: [],
        ruleTiers: {},
        isGamingBlocked: false,
        semanticChangeRatio: 0.25,
        netDebtDelta: 5,
      },
    },
  });

  const enrichedDoc = buildAasReport(enrichedReport);
  assert.strictEqual(
    enrichedDoc.health.cai,
    88.4,
    'Health CAI must strictly reflect autonomy index',
  );
  assert.deepStrictEqual(
    enrichedDoc.health.sqale,
    { tdr: 4.5, remediationMinutes: 120, grade: 'A' },
    'SQALE technical debt must be populated accurately',
  );
  assert.deepStrictEqual(
    enrichedDoc.health.polyglot,
    {
      index: 91.2,
      meanScore: 89.5,
      dispersionPenalty: 0.95,
      standardDeviation: 5.2,
      languageCount: 3,
    },
    'Polyglot metrics must be preserved in independent health block',
  );
  assert.deepStrictEqual(
    enrichedDoc.health.gamingDefense,
    { isBlocked: false, semanticRatio: 0.25, netDebtDelta: 5 },
    'Anti-gaming defense circuit status must be tracked',
  );
  assert.strictEqual(
    enrichedDoc.health.tensorSummary.averageFisherSimplexDistance,
    0.31,
    '5D tensor must retain Fisher simplex distance',
  );

  // Assert CAI never steals from polyglot when autonomy is undefined
  const nonAutonomyReport = createMockScanReport({
    autonomy: undefined,
    qualityScore: {
      ...test11Report.qualityScore,
      polyglotGeneralization: {
        index: 95.0,
        meanScore: 95.0,
        dispersionPenalty: 1.0,
        standardDeviation: 0,
        languageCount: 1,
      },
    },
  });
  const nonAutonomyDoc = buildAasReport(nonAutonomyReport);
  assert.strictEqual(
    nonAutonomyDoc.health.cai,
    undefined,
    'CAI must remain undefined when autonomy analysis did not run (no falsified metric borrowing)',
  );
  console.log('✔  Test 12: Truthful metrics mapping & CAI isolation verified');

  // Test 13: Same-line anchor deduplication
  const duplicateAnchorReport = createMockScanReport({
    issues: [
      {
        id: 'dup:1',
        analyzer: 'constants',
        rule: 'hardcoded-string',
        severity: 'error',
        message: 'Literal string detected.',
        location: {
          file: 'src/app.ts',
          start: { line: 3, column: 10 },
          end: { line: 3, column: 16 },
        },
      },
      {
        id: 'dup:2',
        analyzer: 'constants',
        rule: 'magic-number',
        severity: 'error',
        message: 'Magic number detected.',
        location: {
          file: 'src/app.ts',
          start: { line: 3, column: 12 },
          end: { line: 3, column: 14 },
        },
      },
      {
        id: 'dup:3',
        analyzer: 'complexity',
        rule: 'high-complexity',
        severity: 'error',
        message: 'High complexity on line 5.',
        location: {
          file: 'src/app.ts',
          start: { line: 5, column: 1 },
          end: { line: 5, column: 10 },
        },
      },
    ],
  });

  const dedupDoc = buildAasReport(duplicateAnchorReport, {
    baseDir: '/workspace',
    fileReader: (rel) => fileMock[rel],
    deduplicateAnchors: true,
  });
  const dedupDefects = dedupDoc.files['src/app.ts'];
  assert.strictEqual(dedupDefects.length, 3);
  assert.ok(dedupDefects[0].anchor, 'First line-3 defect must have anchor');
  assert.strictEqual(
    dedupDefects[1].anchor,
    undefined,
    'Second line-3 defect must omit redundant duplicate anchor slice',
  );
  assert.ok(dedupDefects[2].anchor, 'Line-5 defect must have anchor');

  const nonDedupDoc = buildAasReport(duplicateAnchorReport, {
    baseDir: '/workspace',
    fileReader: (rel) => fileMock[rel],
    deduplicateAnchors: false,
  });
  const nonDedupDefects = nonDedupDoc.files['src/app.ts'];
  assert.ok(nonDedupDefects[0].anchor, 'Both must have anchor when deduplication is disabled');
  assert.ok(nonDedupDefects[1].anchor, 'Both must have anchor when deduplication is disabled');

  const dedupJson = toAasJson(duplicateAnchorReport, {
    baseDir: '/workspace',
    fileReader: (relativeFilePath) => fileMock[relativeFilePath],
    deduplicateAnchors: true,
    pretty: false,
  });
  const nonDedupJson = toAasJson(duplicateAnchorReport, {
    baseDir: '/workspace',
    fileReader: (relativeFilePath) => fileMock[relativeFilePath],
    deduplicateAnchors: false,
    pretty: false,
  });
  assert.ok(
    Buffer.byteLength(dedupJson) < Buffer.byteLength(nonDedupJson),
    'Deduplicated JSON must be strictly smaller in bytes',
  );
  console.log('✔  Test 13: Same-line anchor deduplication and token saving verified');

  // Test 14: Variable naming cleanliness static assertion
  const fs = require('fs');
  const path = require('path');
  const coreReportingFiles = [
    path.join(__dirname, '..', 'src', 'core', 'reporting', 'aas-reporter.ts'),
    path.join(__dirname, '..', 'src', 'core', 'reporters', 'agent-review-reporter.ts'),
  ];
  const forbiddenSingleLetterRe = /\b(?:const|let|var)\s+([a-zA-Z])\s*[:=]/;
  const forbiddenShortAbbrRe = /\b(?:const|let|var)\s+(?:act|rec|def|sev|col|td|doc|ctx)\b/;

  coreReportingFiles.forEach((filePath) => {
    const sourceCode = fs.readFileSync(filePath, 'utf8');
    const singleMatch = sourceCode.match(forbiddenSingleLetterRe);
    assert.strictEqual(
      singleMatch,
      null,
      `Forbidden single-letter variable '${singleMatch ? singleMatch[1] : ''}' in ${path.basename(filePath)}`,
    );
    const abbrMatch = sourceCode.match(forbiddenShortAbbrRe);
    assert.strictEqual(
      abbrMatch,
      null,
      `Forbidden truncated abbreviation in ${path.basename(filePath)}: ${abbrMatch ? abbrMatch[0] : ''}`,
    );
  });
  console.log('✔  Test 14: Variable naming cleanliness and single-letter elimination verified');

  // Test 15: Architecture Dynamics & Resilience (ADR-Q) truthfulness & omission
  const quantTestReport = {
    ...cleanReport,
    qualityScore: {
      compositeScore: 92.5,
      grade: 'A',
      quant: {
        financial: {
          principalHours: 10,
          interestDragHours: 0.8,
          interestCoverageRatio: 2.5,
          rcr: 2.5,
          status: 'de-leveraging',
          clearanceStatus: 'active-clearing',
          deficitStockHours: 10,
          frictionDragHours: 0.8,
        },
        riskRatios: {
          isSampleSufficient: false,
          erq: 1.2,
          qsr: 1.2,
          ddr: 999.0,
          sortino: 999.0,
          // edb95 & ptd are omitted (undefined) due to insufficient sample
        },
        inequality: {
          totalDebtItems: 5,
          dsi: 0.35,
          debtGini: 0.35,
          rcd: 0.25,
          defectEntropy: 0.25,
          topFileDebtShare: 0.1,
          categoryShares: {},
        },
        stochastic: {
          sampleCount: 3,
          isSampleSufficient: false,
          isFatTailed: false,
          ehl: 1.5,
          halfLifeCommits: 1.5,
        },
        debtDynamics: {},
        temporalResilience: {},
        spatialDispersion: {},
      },
    },
  };

  const quantDoc = buildAasReport(quantTestReport);
  assert.ok(quantDoc.health.quant, 'Health block must contain quant when present in qualityScore');
  assert.strictEqual(quantDoc.health.quant.rcr, 2.5);
  assert.strictEqual(quantDoc.health.quant.status, 'de-leveraging');
  assert.strictEqual(
    quantDoc.health.quant.edb95,
    undefined,
    'Omitted risk metric must remain undefined, never defaulted to 0',
  );
  assert.strictEqual(
    quantDoc.health.quant.ptd,
    undefined,
    'Omitted drawdown metric must remain undefined, never defaulted to 0',
  );
  assert.strictEqual(
    quantDoc.health.quant.icr,
    undefined,
    'Legacy alias icr must be omitted by default',
  );
  assert.strictEqual(
    quantDoc.health.quant.debtGini,
    undefined,
    'Legacy alias debtGini must be omitted by default',
  );

  const quantLegacyDoc = buildAasReport(quantTestReport, { includeLegacyQuantAliases: true });
  assert.strictEqual(
    quantLegacyDoc.health.quant.icr,
    2.5,
    'Legacy alias icr included when requested',
  );
  assert.strictEqual(
    quantLegacyDoc.health.quant.debtGini,
    0.35,
    'Legacy alias debtGini included when requested',
  );
  console.log('✔  Test 15: ADR-Q truthfulness, omission discipline, and legacy parity verified');

  // Test 16: Per-finding adjudication stamp, correlated rules (`also`),
  // `moreLines` folding, & healthOverride.dimensions
  const foldingIssues = [];
  for (let idx = 1; idx <= 7; idx++) {
    foldingIssues.push({
      id: `const:hardcoded-string:src/noisy.ts:${idx * 10}`,
      analyzer: 'constants',
      rule: 'hardcoded-string',
      severity: 'warning',
      message: `String literal "msg_${idx}" (len=5) appears to be a hardcoded UI message or config value.`,
      location: {
        file: 'src/noisy.ts',
        start: { line: idx * 10, column: 5 },
        end: { line: idx * 10, column: 12 },
      },
      adjudicatedTier: 'T3',
      adjudicatedConfidence: 0.6123,
      correlatedRules: idx === 1 ? ['GOV-CFG-001'] : undefined,
      actionable: {
        action: 'extract_constant',
        patch: 'HARDCODED_MSG_TEXT',
        safeToAutomate: true,
      },
      suggestion: 'Extract to constant (e.g. MSG_CONST). Avoid inline strings.',
    });
  }
  const foldingReport = createMockScanReport({ issues: foldingIssues });
  const foldingDoc = buildAasReport(foldingReport, {
    maxPerRulePerFile: 5,
    healthOverride: {
      dimensions: {
        architectureConsistency: 94.2,
        codeSecurity: 99.1,
      },
    },
  });
  const noisyDefects = foldingDoc.files['src/noisy.ts'];
  assert.strictEqual(noisyDefects.length, 5, 'Should fold occurrences beyond maxPerRulePerFile=5');
  assert.strictEqual(noisyDefects[0].tier, 'T3', 'Should project per-finding adjudicatedTier');
  assert.strictEqual(noisyDefects[0].conf, 0.61, 'Should project rounded adjudicatedConfidence');
  assert.deepStrictEqual(
    noisyDefects[0].also,
    ['GOV-CFG-001'],
    'Should project correlatedRules into also',
  );
  assert.strictEqual(
    noisyDefects[0].fix.template,
    undefined,
    'Generic placeholder patch (*_TEXT) and prose suggestion must not pollute fix.template',
  );
  const { cleanSuggestion } = require('../dist/core/reporting/aas-remediation');
  assert.strictEqual(
    cleanSuggestion('Extract to constant (e.g. MSG_CONST). Avoid inline strings.'),
    'Extract to constant (e.g. MSG_CONST)',
    'cleanSuggestion must preserve parenthetical e.g. without mid-abbreviation truncation',
  );
  assert.deepStrictEqual(
    noisyDefects[4].moreLines,
    [60, 70],
    '5th occurrence must aggregate folded lines [60, 70] in moreLines',
  );
  assert.strictEqual(
    foldingDoc.dimensions.architectureConsistency,
    94.2,
    'healthOverride.dimensions must override raw scan dimension score',
  );
  console.log(
    '✔  Test 16: Per-finding adjudication, also correlation, moreLines folding, and healthOverride.dimensions verified',
  );

  console.log('\n--- All Agent Audit Schema (AAS v1.0 / v1.1) Tests Passed! ---');
}

runTests().catch((executionError) => {
  console.error('FAIL: validate-aas-reporter.js encountered an error:', executionError);
  process.exit(1);
});
