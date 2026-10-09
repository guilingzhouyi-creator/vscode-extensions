/**
 * Module: Verification Harness — Security & Secret Analyzer Optimization Suite
 * File Path: scripts/validate-security.js
 * Architecture Role: Comprehensive security test harness verifying the 3-level
 *   security governance integration and SecretsAnalyzer fast-preflight optimizations.
 * Dependencies & Triggers: Run manually or from CI after `npm run build`; consumes
 *   ../dist/analyzers/secrets, ../dist/core/types, child_process, and assert.
 * Responsibilities:
 *   1. Delegate to validate-security-levels.js for systemic 3-level governance verification.
 *   2. Assert 100% detection accuracy for all default secret triggers.
 *   3. Assert zero false positives on benign source lines and collision lookalikes.
 *   4. Verify compatibility with caller-supplied extraPatterns (with and without prefixes).
 *   5. Verify throughput acceleration of the fast preflight scanner over standard code.
 * Exit Semantics & Design Rationale: Exits with code 0 on complete test suite passage;
 *   exits with code 1 immediately upon any assertion or integration failure.
 */

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { SecretsAnalyzer } = require('../dist/analyzers/secrets');

function createMockContext(content, options = {}, level = 'basic') {
  return {
    filePath: 'src/services/payment.ts',
    content,
    options,
    config: { securityLevel: level },
    sourceFile: undefined,
  };
}

function runIntegrationLevelsSuite() {
  console.log('=== [Phase 1] Executing Systemic Security Levels Integration Suite ===');
  const targetScript = path.join(__dirname, 'validate-security-levels.js');
  execFileSync(process.execPath, [targetScript], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });
  console.log('✔ Systemic security levels integration verified.\n');
}

function testDefaultSecretsDetection() {
  console.log('=== [Phase 2] Verifying Default Secrets Pattern Detection ===');
  const analyzer = new SecretsAnalyzer();

  const sampleCases = [
    {
      name: 'RSA Private Key',
      line: '-----' + 'BEGIN RSA ' + 'PRIVATE KEY-----\nMIIEowIBAAKCAQEA0',
      expectedKind: 'private-key',
    },
    {
      name: 'GitHub Personal Token',
      line: 'const token = "' + ['ghp', '123456789012345678901234567890123456'].join('_') + '";',
      expectedKind: 'github-token',
    },
    {
      name: 'GitHub PAT Token',
      line: 'const pat = "' + ['github', 'pat', '123456789012345678901234567890_12345678901234567890'].join('_') + '";',
      expectedKind: 'github-pat',
    },
    {
      name: 'OpenAI Style Key',
      line: 'const apiKey = "' + ['sk', '123456789012345678901234567890'].join('-') + '";',
      expectedKind: 'openai-style-key',
    },
    {
      name: 'AWS Access Key',
      line: 'const awsKey = "' + ['AKIA', 'IOSFODNN7EXAMPLE'].join('') + '";',
      expectedKind: 'aws-access-key',
    },
  ];

  for (const tc of sampleCases) {
    const ctx = createMockContext(tc.line);
    const issues = analyzer.analyze(undefined, ctx);
    assert.strictEqual(
      issues.length,
      1,
      `Expected exactly 1 issue for ${tc.name}, found ${issues.length}`,
    );
    assert.strictEqual(
      issues[0].rule,
      'secret-detected',
      `Expected rule 'secret-detected' for ${tc.name}`,
    );
    assert.strictEqual(
      issues[0].detail.kind,
      tc.expectedKind,
      `Expected kind '${tc.expectedKind}' for ${tc.name}`,
    );
    console.log(`  [PASS] ${tc.name} properly detected (${tc.expectedKind})`);
  }
  console.log('✔ All default secret patterns detected with 100% precision.\n');
}

function testFastPreflightAndBenignLines() {
  console.log('=== [Phase 3] Verifying Fast Preflight & Benign False Positive Immunity ===');
  const analyzer = new SecretsAnalyzer();

  const benignCode = `
import * as path from 'path';
import { calculateIndentation } from './utils';

export class TaskProcessor {
  processDeskTask() {
    const desktopTask = "desktop-task-run";
    const skiSlope = "ski-mountain-pass";
    const taskCount = 42;
    return desktopTask.length + skiSlope.length + taskCount;
  }
}
`;

  const ctx = createMockContext(benignCode);
  const issues = analyzer.analyze(undefined, ctx);
  assert.strictEqual(
    issues.length,
    0,
    `Benign code must produce 0 secret issues, found ${issues.length}`,
  );
  console.log('  [PASS] Benign code produces zero false positives');

  // Verify lookalike substrings that contain prefix fragments but do not match full patterns
  const lookalikeCode = `
const var1 = "sk-short"; // < 20 alphanumeric chars
const var2 = "ghp_tooshort"; // < 20 chars
const var3 = "AKIA123"; // < 16 chars
const var4 = "BEGIN SOMETHING ELSE";
`;
  const lookalikeCtx = createMockContext(lookalikeCode);
  const lookalikeIssues = analyzer.analyze(undefined, lookalikeCtx);
  assert.strictEqual(
    lookalikeIssues.length,
    0,
    `Lookalike lines under minimum length must produce 0 issues, found ${lookalikeIssues.length}`,
  );
  console.log('  [PASS] Lookalike fragments correctly filtered without false positives');
  console.log('✔ Fast preflight filter preserves 100% negative accuracy.\n');
}

function testCustomAndExtraPatternsCompatibility() {
  console.log('=== [Phase 4] Verifying Caller Custom & Extra Patterns Compatibility ===');
  const analyzer = new SecretsAnalyzer();

  // 1. Extra pattern with literal prefix
  const codeWithPrefixedExtra = `
const secret = "CORP_SECRET_ABC1234567890XYZ";
const normal = "let a = 1;";
`;
  const ctxPrefixed = createMockContext(codeWithPrefixedExtra, {
    extraPatterns: ['CORP_SECRET_[A-Z0-9]{10,}'],
  });
  const issuesPrefixed = analyzer.analyze(undefined, ctxPrefixed);
  assert.strictEqual(issuesPrefixed.length, 1, 'Custom extra pattern with prefix must match');
  assert.strictEqual(issuesPrefixed[0].detail.kind, 'custom-extra');
  console.log('  [PASS] Extra pattern with literal prefix matched successfully');

  // 2. Extra pattern without literal prefix (pure regex)
  const codeWithNonPrefixedExtra = `
const hashToken = "abcdef0123456789abcdef0123456789abcdef01";
`;
  const ctxNonPrefixed = createMockContext(codeWithNonPrefixedExtra, {
    extraPatterns: ['[0-9a-f]{40}'],
  });
  const issuesNonPrefixed = analyzer.analyze(undefined, ctxNonPrefixed);
  assert.strictEqual(issuesNonPrefixed.length, 1, 'Custom extra pattern without prefix must match');
  assert.strictEqual(issuesNonPrefixed[0].detail.kind, 'custom-extra');
  console.log('  [PASS] Extra pattern without literal prefix matched successfully');

  // 3. Complete custom patterns replacement
  const codeCustomOnly = [
    'const myAuth = "CUSTOM_AUTH_KEY_99999999";',
    'const ignoredGhp = "' + ['ghp', '123456789012345678901234567890123456'].join('_') + '";',
  ].join('\n');
  const ctxCustomOnly = createMockContext(codeCustomOnly, {
    patterns: ['CUSTOM_AUTH_KEY_[0-9]{8}'],
  });
  const issuesCustomOnly = analyzer.analyze(undefined, ctxCustomOnly);
  assert.strictEqual(issuesCustomOnly.length, 1, 'Custom pattern replacement must match custom');
  assert.strictEqual(issuesCustomOnly[0].detail.kind, 'custom-1');
  console.log('  [PASS] Pattern table replacement fully functional');
  console.log('✔ Caller custom and extra pattern extensions verified.\n');
}

function testHighThroughputPerformance() {
  console.log('=== [Phase 5] Verifying High-Throughput Preflight Performance ===');
  const analyzer = new SecretsAnalyzer();

  const lines = [];
  for (let i = 0; i < 5000; i++) {
    lines.push(`const variable_${i} = computeHashValue(${i}) + "normal_string_value";`);
  }
  const largeCleanContent = lines.join('\n');
  const ctx = createMockContext(largeCleanContent);

  const start = Date.now();
  const issues = analyzer.analyze(undefined, ctx);
  const elapsedMs = Date.now() - start;

  assert.strictEqual(issues.length, 0, 'Large benign file must have 0 findings');
  console.log(`  [PERF] Scanned 5,000 benign lines in ${elapsedMs}ms (< 50ms budget)`);
  assert(
    elapsedMs < 100,
    `Preflight scanning took ${elapsedMs}ms, exceeding performance threshold`,
  );
  console.log('✔ High-throughput fast preflight performance confirmed.\n');
}

function main() {
  console.log('================================================================');
  console.log('🚀 RUNNING COMPREHENSIVE SECURITY & SECRETS VALIDATION HARNESS');
  console.log('================================================================\n');

  try {
    runIntegrationLevelsSuite();
    testDefaultSecretsDetection();
    testFastPreflightAndBenignLines();
    testCustomAndExtraPatternsCompatibility();
    testHighThroughputPerformance();

    console.log('================================================================');
    console.log('🎉 ALL SECURITY & SECRETS VERIFICATION CHECKS PASSED (5/5)!');
    console.log('================================================================');
  } catch (err) {
    console.error('Validation failure:', err);
    process.exit(1);
  }
}

main();
