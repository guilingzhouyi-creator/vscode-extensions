#!/usr/bin/env node
/**
 * Module: Verification Harness — Gate System & Hooks Architecture Parity
 * File Path: scripts/validate-gate-system.js
 * Architecture Role: Dogfooding verification suite for the workspace gate system
 *     (.githooks/, scripts/ps1/, scripts/sh/, scripts/common/).
 * Dependencies & Triggers: `npm run validate-gate-system`; imports ../dist/analyzers/shell-lint
 *     plus node's assert/fs/path. Registered in test-parallel.js.
 * Responsibilities:
 *     1. Assert 0 ShellLint issues across all gate scripts and git hooks.
 *     2. Assert EOL contract (CRLF for .ps1, LF for .sh/.js/.json).
 *     3. Assert Git hooks routing robustness (exec bash fallback, zero exec sh).
 *     4. Assert audit-all tri-project parity (workspace-timing, auto-refactor, WebGames).
 *     5. Assert every registry-declared gate entry (pre-commit, commit-msg, pre-push, audit-all,
 *        audit-taxis) references each of its registered steps in both the PowerShell and the
 *        Bash implementation, and still covers the project tokens that entry owns.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passed; exits 1 on failure. The
 *     step registry is read once and drives both step identity and implementation paths, so a
 *     relocated script or an unregistered step surfaces as a failing assertion instead of an
 *     unverified gate.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ShellLintAnalyzer } = require('../dist/analyzers/shell-lint');

const ROOT_DIR = path.resolve(__dirname, '../..');

const CRLF_REGEX = /\r\n/;
const CR_REGEX = /\r/;
const FORBIDDEN_EXEC_SH = /exec sh /;
const REQUIRED_EXEC_BASH = /exec bash /;
const AUDIT_ALL_REGEX =
  /(?:workspace-timing|auto-refactor|WebGames|fractal-git|audit_runner\.py|audit_config\.py)/g;
/** Uppercase step identifiers as they appear in gate entry scripts (e.g. `STAGED-HYGIENE-01`). */
const STEP_REFERENCE_RE = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g;

function collectFiles(dir, extensions, extSet) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const targetSet = extSet || new Set(extensions);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, extensions, targetSet));
    } else {
      const ext = path.extname(entry.name);
      if (targetSet.has(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function verifyShellLintRules(analyzer, fileList) {
  let totalViolations = 0;
  const violationSummary = [];
  for (const filePath of fileList) {
    const content = fs.readFileSync(filePath, 'utf8');
    const issues = analyzer.analyze(null, { filePath, content });
    if (issues.length > 0) {
      totalViolations += issues.length;
      const relPath = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
      violationSummary.push(`${relPath}: ${issues.map((i) => i.rule).join(', ')}`);
    }
  }
  assert.strictEqual(
    totalViolations,
    0,
    `Expected 0 ShellLint violations in gate system, found ${totalViolations}:\n${violationSummary.join('\n')}`,
  );
}

function verifyLineEndings(psFiles, lfFiles) {
  for (const psFile of psFiles) {
    const content = fs.readFileSync(psFile, 'utf8');
    const rel = path.relative(ROOT_DIR, psFile).replace(/\\/g, '/');
    assert(CRLF_REGEX.test(content), `PowerShell script must use CRLF line endings: ${rel}`);
  }
  for (const lfFile of lfFiles) {
    const content = fs.readFileSync(lfFile, 'utf8');
    const rel = path.relative(ROOT_DIR, lfFile).replace(/\\/g, '/');
    assert(!CR_REGEX.test(content), `Script/code must use LF line endings, found CR: ${rel}`);
  }
}

function verifyHookRouting(hookFiles) {
  for (const hookFile of hookFiles) {
    const content = fs.readFileSync(hookFile, 'utf8');
    const rel = path.relative(ROOT_DIR, hookFile).replace(/\\/g, '/');
    assert(
      !FORBIDDEN_EXEC_SH.test(content),
      `Git hook must not downgrade to POSIX sh (dash crash risk): ${rel}`,
    );
    assert(REQUIRED_EXEC_BASH.test(content), `Git hook must route fallback to bash: ${rel}`);
  }
}

function verifyAuditAllParity() {
  const auditPs = path.join(ROOT_DIR, 'scripts/ps1/audit-all.ps1');
  const auditSh = path.join(ROOT_DIR, 'scripts/sh/audit-all.sh');
  assert(fs.existsSync(auditPs), 'audit-all.ps1 must exist');
  assert(fs.existsSync(auditSh), 'audit-all.sh must exist');

  const psContent = fs.readFileSync(auditPs, 'utf8');
  const shContent = fs.readFileSync(auditSh, 'utf8');

  for (const [name, content] of [
    ['audit-all.ps1', psContent],
    ['audit-all.sh', shContent],
  ]) {
    const tokens = new Set(content.match(AUDIT_ALL_REGEX) || []);
    assert(tokens.has('workspace-timing'), `${name} must cover workspace-timing`);
    assert(tokens.has('auto-refactor'), `${name} must cover auto-refactor`);
    assert(tokens.has('WebGames'), `${name} must cover WebGames`);
    assert(tokens.has('fractal-git'), `${name} must cover fractal-git`);
    assert(
      tokens.has('audit_runner.py') || tokens.has('audit_config.py'),
      `${name} must run WebGames config audit`,
    );
  }
}

/**
 * Project tokens every gate entry script must verify, keyed by gate entry id.
 *
 * Contract: the token list is the executable statement of "which projects does this gate own".
 * A gate that silently drops a project would otherwise keep passing step-parity checks, so each
 * entry declares its required tokens here and the check fails when one disappears from either
 * the PowerShell or the Bash implementation.
 */
const REQUIRED_PROJECT_TOKENS = Object.freeze({
  'pre-commit': ['workspace-timing', 'auto-refactor', 'WebGames', 'fractal-git'],
  'commit-msg': [
    'workspace-timing',
    'auto-refactor',
    'WebGames',
    'fractal-git',
    'validate-commit-msg',
  ],
  'pre-push': [
    'workspace-timing',
    'auto-refactor',
    'WebGames',
    'fractal-git',
    'validate-commit-msg',
  ],
  'audit-all': ['workspace-timing', 'auto-refactor', 'WebGames', 'fractal-git', 'audit_runner.py'],
  'audit-taxis': ['fractal-git', 'cargo'],
});

/** Path of the single-source gate step registry. */
const STEP_REGISTRY_PATH = path.join(ROOT_DIR, 'scripts/common/gate-step-registry.json');

/**
 * Load the single-source gate step registry.
 *
 * @returns Parsed registry document with an `entries` map.
 */
function loadStepRegistry() {
  assert(fs.existsSync(STEP_REGISTRY_PATH), 'gate-step-registry.json must exist');
  return JSON.parse(fs.readFileSync(STEP_REGISTRY_PATH, 'utf8'));
}

/**
 * Resolve the PowerShell and Bash implementations declared for one gate entry.
 *
 * Contract: implementation paths come from the registry rather than being hardcoded here, so a
 * relocated or renamed gate script is caught as a missing file instead of silently going
 * unverified.
 *
 * @param entryId - Gate entry key.
 * @param entry - Registry entry record.
 * @returns Ordered `[name, absolutePath]` pairs for the declared implementations.
 */
function resolveGateScripts(entryId, entry) {
  const scripts = (entry && entry.scripts) || {};
  const pairs = [];
  for (const [kind, relative] of Object.entries(scripts)) {
    pairs.push([`${entryId} (${kind}): ${relative}`, path.join(ROOT_DIR, relative)]);
  }
  assert(pairs.length > 0, `${entryId} entry must declare its implementation scripts`);
  return pairs;
}

/**
 * Collect the project tokens present in a script in one pass.
 *
 * Contract: the alternation is bounded by `[A-Za-z0-9_-]` on both sides, so `workspace-timing`
 * matches inside `workspace-timing/README.md` while a longer identifier that merely contains the
 * token does not. Matching once keeps the check linear in the script size instead of rescanning
 * the file per required token.
 *
 * @param content - Script source text.
 * @param requiredTokens - Project tokens the entry must verify.
 * @returns Set of required tokens actually present in the script.
 */
function collectPresentTokens(content, requiredTokens) {
  if (requiredTokens.length === 0) return new Set();
  const alternation = requiredTokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const tokenRe = new RegExp(`(?<![A-Za-z0-9_-])(${alternation})(?![A-Za-z0-9_-])`, 'g');
  return new Set(content.match(tokenRe) || []);
}

/**
 * Assert one gate entry script references every registered step and every required project token.
 *
 * @param name - Human-readable file name for diagnostics.
 * @param content - Script source text.
 * @param steps - Registered step records that must be referenced.
 * @param requiredTokens - Project tokens the entry must verify.
 */
function assertScriptCoversGateContract(name, content, steps, requiredTokens) {
  const referenced = new Set(content.match(STEP_REFERENCE_RE) || []);
  for (const step of steps) {
    assert(referenced.has(step.id), `${name} must reference registered step ${step.id}`);
  }

  const presentTokens = collectPresentTokens(content, requiredTokens);
  for (const token of requiredTokens) {
    assert(presentTokens.has(token), `${name} must verify ${token}`);
  }
}

/**
 * Verify one gate entry: both implementations exist, reference every registered step, and cover
 * every project token the entry owns.
 *
 * Contract: the step registry is the single source of truth for both step identity and
 * implementation paths, so a step added to the registry without a matching reference — or a
 * script moved away from its declared location — fails here rather than silently skipping a gate.
 * Step ids and project tokens are each collected once into a set, keeping the check linear in the
 * script size instead of rescanning the file once per required token.
 *
 * @param entryId - Gate entry key declared in the registry.
 * @param registry - Parsed step registry document.
 * @returns The number of registered steps that were verified.
 */
function verifyGateParity(entryId, registry) {
  const entry = registry.entries && registry.entries[entryId];
  assert(entry, `${entryId} must be declared in gate-step-registry.json`);

  const steps = entry.steps || [];
  assert(steps.length > 0, `${entryId} entry in registry must declare steps`);

  const requiredTokens = REQUIRED_PROJECT_TOKENS[entryId] || [];
  for (const [name, filePath] of resolveGateScripts(entryId, entry)) {
    assert(fs.existsSync(filePath), `${name} must exist`);
    assertScriptCoversGateContract(name, fs.readFileSync(filePath, 'utf8'), steps, requiredTokens);
  }
  return steps.length;
}

/**
 * Verify every gate entry declared in the registry.
 *
 * @param registry - Parsed step registry document.
 * @returns Per-entry verified step counts, keyed by entry id.
 */
function verifyAllGateEntries(registry) {
  const verified = new Map();
  for (const entryId of Object.keys(registry.entries || {})) {
    verified.set(entryId, verifyGateParity(entryId, registry));
  }
  return verified;
}

function runAll() {
  console.log('=== Dogfooding Gate System & Hooks Verification ===');

  const analyzer = new ShellLintAnalyzer();
  const githooksDir = path.join(ROOT_DIR, '.githooks');
  const hookFiles = fs
    .readdirSync(githooksDir)
    .filter((f) => !f.endsWith('.sample'))
    .map((f) => path.join(githooksDir, f));

  const psFiles = collectFiles(path.join(ROOT_DIR, 'scripts/ps1'), ['.ps1']);
  const shFiles = collectFiles(path.join(ROOT_DIR, 'scripts/sh'), ['.sh']);
  const jsFiles = collectFiles(path.join(ROOT_DIR, 'scripts/common'), ['.js']);

  console.log(
    `1. ShellLint scanning ${hookFiles.length} hooks + ${psFiles.length} ps1 + ${shFiles.length} sh files...`,
  );
  verifyShellLintRules(analyzer, [...hookFiles, ...psFiles, ...shFiles]);
  console.log('  ✔ ShellLint: 0 violations across all gate scripts.');

  console.log('2. Verifying line ending (EOL) contracts...');
  verifyLineEndings(psFiles, [...shFiles, ...hookFiles, ...jsFiles]);
  console.log('  ✔ EOL Contract: .ps1 strictly CRLF, .sh/.js strictly LF.');

  console.log('3. Verifying Git hook routing fallbacks...');
  verifyHookRouting(hookFiles);
  console.log('  ✔ Hook Routing: 100% bash fallback, zero POSIX dash crash vulnerability.');

  console.log('4. Verifying audit-all multi-project parity...');
  verifyAuditAllParity();
  console.log(
    '  ✔ Audit-All: 6 pillars covering workspace-timing, auto-refactor, WebGames, fractal-git.',
  );

  const registry = loadStepRegistry();
  console.log('5. Verifying every gate entry against the step registry...');
  const verifiedEntries = verifyAllGateEntries(registry);
  for (const [entryId, stepCount] of verifiedEntries) {
    console.log(
      `  ✔ ${entryId}: ${stepCount} registered steps referenced by both implementations.`,
    );
  }

  console.log('\n✅ All gate system verification checks passed successfully.');
}

runAll();
