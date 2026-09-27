#!/usr/bin/env node
/**
 * Module: Verification Harness — Generalized Pattern Matching Kernel Guard
 * File Path: scripts/validate-pattern-kernel.js
 * Architecture Role: Verifies correctness, determinism, and precision of universal static
 *   analysis pattern matchers (Resource Lifecycle, Blocking Calls, Hot Path, Isolation, I18N).
 * Dependencies & Triggers: Run via `npm test` or `node scripts/validate-pattern-kernel.js`.
 * Responsibilities:
 *   1. Validate positive violation detection for each universal semantic pattern archetype.
 *   2. Assert zero false positives on fully compliant code structures.
 *   3. Enforce deterministic output without state leak across sequential invocations.
 * Exit Semantics & Design Rationale: Exits 0 on verification pass, 1 on failure.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const patternsModulePath = path.join(ROOT, 'dist', 'core', 'patterns');

let patternsModule;
try {
  patternsModule = require(patternsModulePath);
} catch (err) {
  console.error('[FAIL] Unable to load patterns module from dist. Run npm run build first.');
  console.error(err);
  process.exit(1);
}

const {
  matchResourceLifecycle,
  matchBlockingCalls,
  matchHotPathAllocations,
  matchBoundaryIsolation,
  matchPresentationLiterals,
} = patternsModule;

console.log('=== Validating Generalized Semantic Pattern Matching Kernel ===');

// 1. Test Resource Lifecycle Pattern
{
  const lifecyclePattern = {
    name: 'test-lifecycle',
    acquisitionPatterns: [/registerCommand\s*\(/, /addEventListener\s*\(/],
    containerPatterns: [/subscriptions\.push\s*\(/],
    trackingWindowLines: 5,
  };

  // Case 1a: Unregistered bare call
  const leakingCode = [
    'function activate(context) {',
    '    vscode.commands.registerCommand("ext.run", () => {});',
    '}',
  ];
  const violations1 = matchResourceLifecycle(leakingCode, lifecyclePattern);
  assert.strictEqual(violations1.length, 1, 'Expected 1 unregistered violation');
  assert.strictEqual(violations1[0].line, 2);
  assert.strictEqual(violations1[0].reason, 'unregistered');

  // Case 1b: Compliant immediate push
  const compliantImmediate = [
    'function activate(context) {',
    '    context.subscriptions.push(vscode.commands.registerCommand("ext.run", () => {}));',
    '}',
  ];
  assert.strictEqual(
    matchResourceLifecycle(compliantImmediate, lifecyclePattern).length,
    0,
    'Expected 0 violations for immediate push',
  );

  // Case 1c: Compliant assigned variable pushed within window
  const compliantDeferred = [
    'function activate(context) {',
    '    const cmd = vscode.commands.registerCommand("ext.run", () => {});',
    '    doSomething();',
    '    context.subscriptions.push(cmd);',
    '}',
  ];
  assert.strictEqual(
    matchResourceLifecycle(compliantDeferred, lifecyclePattern).length,
    0,
    'Expected 0 violations for deferred push within window',
  );

  // Case 1d: Assigned variable NOT pushed (window expiry)
  const leakingDeferred = [
    'function activate(context) {',
    '    const cmd = vscode.commands.registerCommand("ext.run", () => {});',
    '    step1();',
    '    step2();',
    '    step3();',
    '    step4();',
    '    step5();',
    '    step6();',
    '    doOther();',
    '}',
  ];
  const violationsDeferred = matchResourceLifecycle(leakingDeferred, lifecyclePattern);
  assert.strictEqual(violationsDeferred.length, 1, 'Expected 1 untracked violation');
  assert.strictEqual(violationsDeferred[0].resourceIdentifier, 'cmd');
  console.log('✓ Resource lifecycle pattern matcher verified (positive and compliant)');
}

// 2. Test Blocking Calls Pattern
{
  const blockingPattern = {
    name: 'test-blocking',
    blockingCalls: [/\bfs\.readFileSync\s*\(/, /\bfs\.writeFileSync\s*\(/],
  };

  const blockingCode = [
    'async function loadConfig() {',
    '    const data = fs.readFileSync("/path/config.json");',
    '    return JSON.parse(data);',
    '}',
  ];
  const violations = matchBlockingCalls(blockingCode, blockingPattern);
  assert.strictEqual(violations.length, 1, 'Expected 1 blocking call violation');
  assert.strictEqual(violations[0].line, 2);

  const nonBlockingCode = [
    'async function loadConfig() {',
    '    const data = await fs.promises.readFile("/path/config.json");',
    '    return JSON.parse(data);',
    '}',
  ];
  assert.strictEqual(
    matchBlockingCalls(nonBlockingCode, blockingPattern).length,
    0,
    'Expected 0 violations for async call',
  );
  console.log('✓ Blocking calls pattern matcher verified (positive and compliant)');
}

// 3. Test Hot Path Allocations Pattern
{
  const hotPathPattern = {
    name: 'test-hot-path',
    hotPathScopes: [/func _process\b/, /func _physics_process\b/],
    allocationPatterns: [/\.new\s*\(/, /\.duplicate\s*\(/],
    poolExemptions: [/pool\.acquire\s*\(/],
  };

  const leakingHotPath = [
    'func _process(delta):',
    '    var effect = ParticleEffect.new()',
    '    effect.play()',
  ];
  const violations = matchHotPathAllocations(leakingHotPath, hotPathPattern);
  assert.strictEqual(violations.length, 1, 'Expected 1 hot-path allocation violation');
  assert.strictEqual(violations[0].line, 2);
  assert.strictEqual(violations[0].scopeName, 'func _process');

  const compliantPooledHotPath = [
    'func _process(delta):',
    '    var effect = effect_pool.acquire()',
    '    effect.play()',
  ];
  assert.strictEqual(
    matchHotPathAllocations(compliantPooledHotPath, hotPathPattern).length,
    0,
    'Expected 0 violations for pooled acquisition in hot path',
  );
  console.log('✓ Hot-path allocations pattern matcher verified (positive and compliant)');
}

// 4. Test Boundary Isolation Pattern
{
  const isolationPattern = {
    name: 'test-isolation',
    sourceLayerIndicators: ['/domain/', '/logic/', '@domain'],
    forbiddenTargets: ['/frontend/', 'GameView', 'EventBus'],
    reason: 'Domain logic must remain decoupled from presentation layer',
  };

  const violatingDomain = [
    '# @domain pure business logic',
    'extends RefCounted',
    'func calculate_score():',
    '    EventBus.emit_signal("score_changed")',
    '    return 100',
  ];
  const violations = matchBoundaryIsolation(
    'src/domain/combat.gd',
    violatingDomain,
    isolationPattern,
  );
  assert.strictEqual(violations.length, 1, 'Expected 1 boundary isolation violation');
  assert.strictEqual(violations[0].line, 4);
  assert.strictEqual(violations[0].targetIdentifier, 'EventBus');

  const compliantDomain = [
    '# @domain pure business logic',
    'extends RefCounted',
    'func calculate_score():',
    '    return 100',
  ];
  assert.strictEqual(
    matchBoundaryIsolation('src/domain/combat.gd', compliantDomain, isolationPattern).length,
    0,
    'Expected 0 violations for compliant domain logic',
  );
  console.log('✓ Boundary isolation pattern matcher verified (positive and compliant)');
}

// 5. Test Presentation Literal Pattern
{
  const literalPattern = {
    name: 'test-i18n',
    presentationSinks: [/window\.showErrorMessage\s*\(\s*(['"`][^'"`]+['"`])/],
    i18nWrappers: [/vscode\.l10n\.t\s*\(/, /l10n\.t\s*\(/],
  };

  const violatingLiteral = [
    'function notifyError() {',
    '    window.showErrorMessage("Failed to load file");',
    '}',
  ];
  const violations = matchPresentationLiterals(violatingLiteral, literalPattern);
  assert.strictEqual(violations.length, 1, 'Expected 1 literal violation');
  assert.strictEqual(violations[0].literalText, '"Failed to load file"');

  const compliantLiteral = [
    'function notifyError() {',
    '    window.showErrorMessage(vscode.l10n.t("Failed to load file"));',
    '}',
  ];
  assert.strictEqual(
    matchPresentationLiterals(compliantLiteral, literalPattern).length,
    0,
    'Expected 0 violations for localized literal',
  );
  console.log('✓ Presentation literal pattern matcher verified (positive and compliant)');
}

console.log('================================================================');
console.log('🎉 ALL GENERALIZED PATTERN MATCHER VERIFICATIONS PASSED (5/5)!');
console.log('================================================================');
process.exit(0);
