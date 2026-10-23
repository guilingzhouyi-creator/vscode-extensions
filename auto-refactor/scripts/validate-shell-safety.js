#!/usr/bin/env node
/**
 * Module: Verification Harness — Shell Safety Analyzer (Destructive Operand Provenance)
 * File Path: scripts/validate-shell-safety.js
 * Architecture Role: Regression suite asserting that the shell-safety analyzer reports a recursive
 *   delete whose operand traces to a root or home expression, reports a PowerShell binding that
 *   shadows a read-only automatic variable, and stays silent on every accounted-for shape.
 * Dependencies & Triggers: `node scripts/validate-shell-safety.js`, part of the test matrix.
 * Responsibilities:
 *   1. Assert GUARD-DESTR-001 fires for a literal root, a home expression and an alias chain;
 *   2. Assert the loop-alias shape that motivated the rule is caught end to end;
 *   3. Assert GUARD-VAR-001 fires on each PowerShell write shape and never on a writable look-alike;
 *   4. Assert scratch and fixture deletes stay silent, so the rule is not a blanket prohibition;
 *   5. Assert a non-recursive delete and a non-script file yield nothing;
 *   6. Assert each rule can be switched off without disabling the analyzer.
 * Exit Semantics & Design Rationale: Exits 0 when every assertion holds; exits 1 on the first
 *   failure. Cases are driven through the analyzer contract rather than the repository
 *   configuration, so the suite states the boundary under test instead of inheriting a moving
 *   default. The negative corpus is the load-bearing half: a guard that fires on every fixture
 *   cleanup is a guard that gets switched off, which is how this defect class survived in the
 *   workspace for as long as it did.
 */
'use strict';

const assert = require('assert');
const { ShellSafetyAnalyzer } = require('../dist/analyzers/shell-safety');

const RULE_DESTR = 'GUARD-DESTR-001';
const RULE_VAR = 'GUARD-VAR-001';

/**
 * Build the analyzer context the engine would supply for one synthetic file.
 *
 * @param {string} filePath - Repository-relative path.
 * @param {string} content - File content.
 * @param {Record<string, unknown>} [options] - Analyzer options.
 * @returns {Record<string, unknown>} Context accepted by the analyzer contract.
 */
function buildContext(filePath, content, options = {}) {
  return {
    filePath,
    content,
    config: { analyzers: {}, archetype: 'business' },
    options,
    root: process.cwd(),
  };
}

/**
 * Run the analyzer and return the findings carrying one rule id.
 *
 * @param {string} filePath - Repository-relative path.
 * @param {string} content - File content.
 * @param {string} rule - Rule id to filter on.
 * @param {Record<string, unknown>} [options] - Analyzer options.
 * @returns {Array<object>} Matching findings.
 */
function runRule(filePath, content, rule, options) {
  return new ShellSafetyAnalyzer()
    .analyze(undefined, buildContext(filePath, content, options))
    .filter((issue) => issue.rule === rule);
}

/**
 * Assert a literal root, a home expression and an alias chain are all rejected.
 */
function testDirectOperands() {
  const cases = [
    ['scripts/sample.ps1', 'Remove-Item -LiteralPath $env:USERPROFILE -Recurse -Force', 'PowerShell home expression'],
    ['scripts/sample.ps1', 'Remove-Item -Path "C:\\" -Recurse -Force', 'PowerShell drive root'],
    ['scripts/sample.sh', 'rm -rf /', 'POSIX filesystem root'],
    ['scripts/sample.sh', 'rm -rf "$HOME"', 'POSIX home expression'],
    ['scripts/sample.sh', 'rm -rf "$HOME/staging"', 'POSIX path joined onto a home root'],
    [
      'src/sample.ts',
      'fs.rmSync(process.env.USERPROFILE, { recursive: true, force: true });',
      'JavaScript home expression',
    ],
  ];
  for (const [filePath, source, label] of cases) {
    const findings = runRule(filePath, source, RULE_DESTR);
    assert.ok(
      findings.length > 0,
      `A recursive delete naming a root or home expression must report ${RULE_DESTR} (${label})`,
    );
  }
  console.log(`  ✔ ${RULE_DESTR} fires on literal roots, home expressions and joined paths`);
}

/**
 * Assert the delete that names no operand is rejected, because the shell decides the target.
 */
function testMissingOperand() {
  const findings = runRule('scripts/sample.ps1', 'Remove-Item -Recurse -Force', RULE_DESTR);
  assert.strictEqual(
    findings.length,
    1,
    'A recursive delete that names no operand must report exactly one finding',
  );
  console.log(`  ✔ ${RULE_DESTR} fires when the delete names no operand`);
}

/**
 * Assert the incident shape is caught: a home root bound, joined, iterated, then deleted through
 * the loop alias. Every hop is a separate alias and the delete names only the last one.
 */
function testTransitiveChain() {
  const content = [
    '$profile = Join-Path $HOME "Low"',
    '$staging = Join-Path $profile "case"',
    'foreach ($d in @($staging)) {',
    '    Remove-Item -LiteralPath $d -Recurse -Force',
    '}',
  ].join('\n');
  const findings = runRule('scripts/incident.ps1', content, RULE_DESTR);
  assert.strictEqual(findings.length, 1, 'The transitive alias chain must report exactly one finding');
  assert.ok(
    String(findings[0].detail.reason).includes('->'),
    'The finding must carry the alias chain, because the fix depends on which hop introduced the taint',
  );
  console.log(`  ✔ ${RULE_DESTR} follows assignments and loop aliases to the taint source`);
}

/**
 * Assert a recursive delete of a script-owned directory stays silent.
 */
function testScratchDeletesPass() {
  const sources = [
    ['scripts/cleanup.sh', 'rm -rf "$WORKDIR/out"'],
    ['scripts/cleanup.sh', 'rm -rf "${CACHE_DIR}"'],
    ['src/cli/selfTestCmd.ts', 'fs.rmSync(fixtureRoot, { recursive: true, force: true });'],
    ['scripts/cleanup.ps1', 'Remove-Item -LiteralPath $stagingDir -Recurse -Force'],
    ['scripts/cleanup.ps1', 'Remove-Item -Path ./dist -Recurse -Force'],
  ];
  for (const [filePath, source] of sources) {
    const findings = runRule(filePath, source, RULE_DESTR);
    assert.strictEqual(
      findings.length,
      0,
      `A delete of a script-owned or literal relative path must stay silent: ${source}`,
    );
  }
  console.log(`  ✔ ${RULE_DESTR} stays silent on script-owned and literal relative paths`);
}

/**
 * Assert a non-recursive delete and an unrelated file are never reported.
 */
function testDiscrimination() {
  assert.strictEqual(
    runRule('scripts/sample.sh', 'rm -f "$LOG"', RULE_DESTR).length,
    0,
    'A non-recursive delete must not be judged by this rule',
  );
  assert.strictEqual(
    runRule('src/sample.ts', 'fs.rmSync(file, { force: true });', RULE_DESTR).length,
    0,
    'A non-recursive JavaScript delete must not be judged by this rule',
  );
  assert.strictEqual(
    runRule('src/sample.md', 'rm -rf /', RULE_DESTR).length,
    0,
    'A file with no judged dialect must yield nothing',
  );
  console.log(`  ✔ ${RULE_DESTR} discriminates on recursion and dialect`);
}

/**
 * Assert each PowerShell write shape that shadows a read-only automatic variable is reported.
 */
function testAutomaticVariableShadows() {
  const cases = [
    ['$home = "x"', 1],
    ['foreach ($PID in @(1)) { }', 1],
    ['[string]$Host = "x"', 1],
    ['$Error, $ShellId = $null, $null', 2],
    ['$ExecutionContext = $null', 1],
  ];
  for (const [source, expected] of cases) {
    const findings = runRule('scripts/sample.ps1', source, RULE_VAR);
    assert.strictEqual(
      findings.length,
      expected,
      `Every read-only automatic variable written on a line must be reported: ${source}`,
    );
  }
  console.log(`  ✔ ${RULE_VAR} fires on every write shape for a read-only automatic variable`);
}

/**
 * Assert writable look-alikes are not reported, because the write succeeds and is idiomatic.
 */
function testWritableLookAlikesPass() {
  const sources = [
    '$Profile = "x"',
    '$PWD = "x"',
    '$Args = @()',
    '$LastExitCode = 0',
    '$PSItem = 1',
    '$Matches = @()',
    '$OutputEncoding = [Text.UTF8Encoding]::new($false)',
  ];
  for (const source of sources) {
    const findings = runRule('scripts/sample.ps1', source, RULE_VAR);
    assert.strictEqual(
      findings.length,
      0,
      `A write to a writable look-alike must stay silent: ${source}`,
    );
  }
  console.log(`  ✔ ${RULE_VAR} stays silent on writable and type-constrained look-alikes`);
}

/**
 * Assert the automatic-variable rule is confined to the PowerShell dialect.
 */
function testShadowRuleIsDialectScoped() {
  assert.strictEqual(
    runRule('scripts/sample.sh', '$home = "x"', RULE_VAR).length,
    0,
    'The automatic-variable rule must not fire outside PowerShell',
  );
  console.log(`  ✔ ${RULE_VAR} is confined to the PowerShell dialect`);
}

/**
 * Assert each rule can be switched off without disabling the analyzer.
 */
function testRuleSwitches() {
  const psContent = ['$home = "x"', 'Remove-Item -LiteralPath $env:USERPROFILE -Recurse -Force'].join(
    '\n',
  );
  assert.strictEqual(
    runRule('scripts/sample.ps1', psContent, RULE_DESTR, { checkDestructiveOperands: false }).length,
    0,
    'Disabling the destructive-operand rule must silence it',
  );
  assert.strictEqual(
    runRule('scripts/sample.ps1', psContent, RULE_VAR, { checkAutomaticVariables: false }).length,
    0,
    'Disabling the automatic-variable rule must silence it',
  );
  assert.strictEqual(
    runRule('scripts/sample.ps1', psContent, RULE_VAR).length,
    1,
    'Enabling the analyzer without options must keep both rules active',
  );
  console.log('  ✔ each rule can be switched off independently');
}

/**
 * Assert the analyzer declares the id the engine routes to and the registries agree on.
 */
function testAnalyzerIdentity() {
  const analyzer = new ShellSafetyAnalyzer();
  assert.strictEqual(analyzer.name, 'shell-safety', 'The analyzer must declare its routed id');
  const findings = runRule(
    'scripts/sample.ps1',
    'Remove-Item -LiteralPath $env:USERPROFILE -Recurse -Force',
    RULE_DESTR,
  );
  assert.strictEqual(
    findings[0].analyzer,
    'shell-safety',
    'Findings must be attributed to the shell-safety analyzer',
  );
  assert.strictEqual(findings[0].severity, 'error', 'A root-targeting delete must block');
  console.log('  ✔ analyzer identity and severity are declared consistently');
}

console.log('=== Validating shell-safety analyzer (GUARD-DESTR-001, GUARD-VAR-001) ===');
testDirectOperands();
testMissingOperand();
testTransitiveChain();
testScratchDeletesPass();
testDiscrimination();
testAutomaticVariableShadows();
testWritableLookAlikesPass();
testShadowRuleIsDialectScoped();
testRuleSwitches();
testAnalyzerIdentity();
console.log('✔ validate-shell-safety passed all assertions.');
