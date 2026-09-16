/**
 * Module: Verification Harness — Advanced Review System Capability Validation
 * File Path: scripts/validate-capabilities.js
 * Architecture Role: End-to-end assertion suite for the advanced review stack,
 *   spanning classification, secrets, cancellation, maturity tuning, impact
 *   analysis, reporter plug-ins, and training-dataset export.
 * Dependencies & Triggers: ../dist/api, ../dist/core/dependencyGraph, and
 *   ../dist/analyzers/secrets; triggered by `npm run validate-capabilities` in the
 *   npm test chain; scans ../samples for maturity detection and cancellation.
 * Responsibilities: Assert literal kinds and reasonable-value suppression; verify
 *   basic-mode secrets exemption on test paths but not production paths; confirm a
 *   pre-aborted AbortSignal rejects scan(); check demo/industrial maturity
 *   thresholds and comment options; validate symbol impact plans, the reporter
 *   registry (json/markdown/sarif/badge plus a custom CSV reporter), Alpaca and
 *   ShareGPT export, and empirical-rule purification.
 * Exit Semantics & Design Rationale: Exits 0 after all seven groups pass and the
 *   final banner prints; any failed assertion is rethrown by main().catch to exit 1.
 *   Explicit assertions are the oracle because capability wiring can regress while
 *   still producing plausible output.
 */

const assert = require('assert');
const path = require('path');

const {
  scan,
  classifyLiteral,
  registerReporter,
  getReporter,
  listReporters,
  detectMaturityTier,
  getMaturityTunedThresholds,
  getMaturityTunedAnalyzerOptions,
  TrainingDatasetExporter,
  ReviewMemoryManager,
} = require('../dist/api');
const { ModuleDependencyGraph } = require('../dist/core/dependencyGraph');
const { SecretsAnalyzer } = require('../dist/analyzers/secrets');

/**
 * Run all seven capability-validation groups in order and reject on the first failed
 * assertion.
 *
 * The `async` entry point awaits every scan and exporter call before advancing, so the
 * shared in-memory reporter registry and dataset state are observed deterministically;
 * no group runs in parallel.
 *
 * @returns A promise that resolves after the final success banner prints; a rejected
 *     assertion propagates to the trailing catch handler and exits with code 1.
 */
async function main() {
  console.log('=== [1/7] Testing Semantic Literal Classification ===');
  // URLs
  const urlRes = classifyLiteral('https://api.example.com/v1/users', false);
  assert.strictEqual(urlRes.kind, 'url');
  assert.strictEqual(urlRes.isReasonable, false);

  // File Paths
  const pathRes = classifyLiteral('/etc/config/app.json', false);
  assert.strictEqual(pathRes.kind, 'file-path');

  // Inline SVG
  const svgRes = classifyLiteral(
    '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>',
    false,
  );
  assert.strictEqual(svgRes.kind, 'inline-svg');

  // HTTP Status
  const statusRes = classifyLiteral('404', true);
  assert.strictEqual(statusRes.kind, 'http-status');
  assert.strictEqual(statusRes.suggestedConstPrefix, 'HTTP_STATUS_404');

  // Ports
  const portRes = classifyLiteral('8080', true);
  assert.strictEqual(portRes.kind, 'port');
  assert.strictEqual(portRes.suggestedConstPrefix, 'PORT_8080');

  // Reasonable delimiter literals (must be suppressed)
  const commaRes = classifyLiteral(',', false);
  assert.strictEqual(commaRes.isReasonable, true);
  const zeroRes = classifyLiteral('0', true);
  assert.strictEqual(zeroRes.isReasonable, true);
  console.log('✔ Semantic literal classification and reasonable value suppression verified.');

  console.log('\n=== [2/7] Testing Secrets Context-Aware Exemption ===');
  const secretsAnalyzer = new SecretsAnalyzer();
  const dummyCtx = {
    filePath: 'tests/unit/test_api_client.ts',
    content: 'const testToken = "ghp_123456789012345678901234567890123456";',
    config: { securityLevel: 'basic' },
  };
  const testIssues = secretsAnalyzer.analyze(null, dummyCtx);
  assert.strictEqual(testIssues.length, 0, 'Secrets in test paths must be exempted in basic mode');

  const prodCtx = {
    filePath: 'src/services/api_client.ts',
    content: 'const prodToken = "ghp_123456789012345678901234567890123456";',
    config: { securityLevel: 'basic' },
  };
  const prodIssues = secretsAnalyzer.analyze(null, prodCtx);
  assert.strictEqual(prodIssues.length, 1, 'Secrets in production code must be detected');
  console.log('✔ Secrets test-path context exemption verified.');

  console.log('\n=== [3/7] Testing AbortSignal Cooperative Cancellation ===');
  const controller = new AbortController();
  controller.abort(); // Pre-aborted

  let abortedCaught = false;
  try {
    await scan({
      root: path.join(__dirname, '../samples'),
      signal: controller.signal,
      logLevel: 'silent',
    });
  } catch (err) {
    if (err.message.includes('aborted')) {
      abortedCaught = true;
    }
  }
  assert.strictEqual(abortedCaught, true, 'Scanner must abort when AbortSignal is triggered');
  console.log('✔ AbortSignal cooperative cancellation verified.');

  console.log('\n=== [4/7] Testing Maturity Tiers Dynamic Tuning ===');
  // Demo tier
  const demoTier = detectMaturityTier(path.join(__dirname, '../samples'));
  assert.strictEqual(demoTier, 'demo');

  const baseThresholds = {
    fileLinesWarn: 400,
    fileLinesFail: 800,
    fileFunctionsWarn: 15,
    complexityWarn: 8,
    complexityFail: 12,
    magicNumberMin: 2,
    duplicateLiteralThreshold: 3,
    hardcodedStringMinLength: 3,
  };
  const demoThresholds = getMaturityTunedThresholds('demo', baseThresholds);
  assert.strictEqual(demoThresholds.fileLinesWarn, 800);
  assert.strictEqual(demoThresholds.complexityWarn, 20);

  const industrialThresholds = getMaturityTunedThresholds('industrial', baseThresholds);
  assert.strictEqual(industrialThresholds.fileLinesWarn, 350);
  assert.strictEqual(industrialThresholds.complexityWarn, 8);

  const demoCommentOpts = getMaturityTunedAnalyzerOptions('demo', 'comments', {
    requireHeader: true,
  });
  assert.strictEqual(demoCommentOpts.requireHeader, false);
  assert.strictEqual(demoCommentOpts.level, 'off');

  const indCommentOpts = getMaturityTunedAnalyzerOptions('industrial', 'comments', {
    requireHeader: false,
  });
  assert.strictEqual(indCommentOpts.requireHeader, true);
  assert.strictEqual(indCommentOpts.level, 'strict');
  console.log('✔ Maturity Tiers dynamic tuning verified.');

  console.log('\n=== [5/7] Testing Symbol-Level Dependency Impact Analysis ===');
  const graph = new ModuleDependencyGraph();
  const serviceCode = `
/** Fixture: payment service whose exported symbol is traced by impact analysis. */
export class PaymentService {
  process() {}
}
/** Fixture: invoice factory imported under an alias by the controller fixture. */
export function createInvoice() {}
`;
  const controllerCode = `
import { PaymentService, createInvoice as makeBill } from '../services/paymentService';
/** Fixture: controller importing PaymentService to exercise import-site impact. */
export class PaymentController {
  constructor(private service: PaymentService) {}
}
`;
  graph.registerFromContent('src/services/paymentService.ts', serviceCode);
  graph.registerFromContent('src/controllers/paymentController.ts', controllerCode);

  const impact = graph.getSymbolImpact('src/services/paymentService.ts', ['PaymentService']);
  assert.strictEqual(impact.affectedFiles.length, 1);
  assert.strictEqual(impact.impactedImportSites.length, 1);
  assert.strictEqual(
    impact.impactedImportSites[0].importerFile,
    'src/controllers/paymentController',
  );
  assert.strictEqual(impact.impactedImportSites[0].importedSymbol, 'PaymentService');
  assert.strictEqual(impact.suggestedRefactorPlan.length, 3);
  console.log('Impact Refactor Plan:');
  for (const step of impact.suggestedRefactorPlan) {
    console.log(`  - ${step}`);
  }
  console.log('✔ Symbol-level dependency impact analysis verified.');

  console.log('\n=== [6/7] Testing Pluggable Reporter Registry ===');
  const availableReporters = listReporters();
  assert.ok(availableReporters.includes('json'));
  assert.ok(availableReporters.includes('markdown'));
  assert.ok(availableReporters.includes('sarif'));
  assert.ok(availableReporters.includes('badge'));

  // Custom reporter registration
  registerReporter({
    name: 'custom-csv',
    format(rep) {
      return `file,issues\n${rep.fileMetrics.map((m) => `${m.file},${m.lines}`).join('\n')}`;
    },
  });
  const custom = getReporter('custom-csv');
  assert.ok(custom);
  console.log('✔ Pluggable reporter registry verified.');

  console.log('\n=== [7/7] Testing Closed-Loop Training Dataset Exporter ===');
  const memory = new ReviewMemoryManager();
  memory.put({
    filePath: 'src/core/auth.ts',
    fileHash: 'hash123',
    astDigest: 'ast123',
    codeDomains: [
      {
        domainId: 'func:login',
        kind: 'function',
        name: 'login',
        span: { startLine: 1, endLine: 10, startCol: 1, endCol: 1 },
        semanticHash: 'sem123',
        cyclomaticComplexity: 3,
        ruleViolations: [],
      },
    ],
    ruleHits: [
      {
        id: '1',
        analyzer: 'security',
        rule: 'SEC-VUL-001',
        severity: 'error',
        line: 5,
        message: 'Eval injection detected',
      },
      {
        id: '2',
        analyzer: 'comments',
        rule: 'CMT-DOC-001',
        severity: 'info',
        line: 1,
        message: 'Missing doc',
      },
    ],
    qualityScores: {
      compositeScore: 65,
      grade: 'C',
      confidence: 0.9,
      indices: {},
      weights: {},
      rationales: [],
      evaluatedAt: Date.now(),
    },
    lastAudited: Date.now(),
    revisionId: 'rev1',
    contextWindows: { imports: [], exports: [] },
    fixResults: [],
  });

  const exporter = new TrainingDatasetExporter(memory);
  const alpacaData = exporter.exportAlpaca({ includeEmpirical: false });
  assert.strictEqual(alpacaData.length, 1);
  assert.ok(alpacaData[0].output.includes('SEC-VUL-001'));
  // Empirical rule should be filtered out by purification
  assert.ok(!alpacaData[0].metadata.ruleIds.includes('CMT-DOC-001'));

  const shareGptData = exporter.exportShareGpt();
  assert.strictEqual(shareGptData.length, 1);
  assert.strictEqual(shareGptData[0].conversations.length, 2);
  console.log('✔ Training dataset exporter with rule purification verified.');

  console.log('\n================================================================');
  console.log('🎉 ALL ADVANCED SYSTEM CAPABILITIES VALIDATED SUCCESSFULLY (7/7)!');
  console.log('================================================================');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
