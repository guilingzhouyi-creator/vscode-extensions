#!/usr/bin/env node
/**
 * Module: Verification Harness — YAML Structured-Data Adapter
 * File Path: scripts/validate-yaml-adapter.js
 * Architecture Role: Locks the contract that made `.yml`/`.yaml` discoverable. Before the adapter
 *   existed, pipeline definitions were not discovered at all: `.yml` was absent from the extension
 *   allow-list, so gate feedback vocabulary inside CI workflows was unreachable by every rule that
 *   is supposed to judge it.
 * Dependencies & Triggers: `npm run validate-yaml-adapter` (part of `npm test`); imports
 *   ../dist/api (scan), the extension index, and the adapter itself.
 * Responsibilities:
 *   1. Assert the extension allow-list claims both YAML extensions;
 *   2. Assert a YAML file is discovered by a scan that includes it;
 *   3. Assert no LANG-UNSUPPORTED diagnostic is produced (the fail-closed guard is satisfied);
 *   4. Assert the adapter fabricates no AST nodes, so code-shape rules stay silent on data;
 *   5. Assert a code rule that does read the raw text still fires, proving the file is judged
 *      rather than merely counted;
 *   6. Assert the two YAML extensions behave identically.
 * Exit Semantics & Design Rationale: Exits 0 when every assertion holds, 1 on the first failure.
 *   Assertion 4 and 5 are deliberately paired: without 4 the adapter could be fabricating nodes,
 *   and without 5 "no code findings" would be indistinguishable from "file never read".
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../dist/api');
const { DEFAULT_EXT } = require('../dist/core/file-discovery');
const { EXTENSION_ADAPTER_IDS } = require('../dist/core/ast/adapters');
const { DataAdapter } = require('../dist/core/ast/data-adapter');
const { NodeKind } = require('../dist/core/ast/multilang');
const { runEntry } = require('./common/test-runner-harness');
const { rmSyncWithRetry } = require('./lib/resilient-fs-cleanup');

const RULE_UNSUPPORTED = 'LANG-UNSUPPORTED';

/**
 * A workflow-shaped fixture carrying a credential and a positional gate label.
 *
 * The credential is assembled from two fragments for the same reason `validate-security.js` does:
 * the harness must contain a detectable key to prove text reading works, but a contiguous literal
 * would make this harness itself a Critical finding in the engine's own debt ledger.
 */
const WORKFLOW_FIXTURE = [
  'name: fixture',
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: echo "Gate 3 passed"',
  '      - run: echo "' + ['AKIA', 'IOSFODNN7EXAMPLE'].join('') + '"',
  '',
].join('\n');

/** Line number carrying the credential, which a text-reading rule must report. */
const CREDENTIAL_LINE = 8;

/** Rule a text-oriented analyzer emits for a literal credential. */
const RULE_SECRET = 'secret-detected';

/**
 * Creates a scratch tree holding one YAML fixture.
 *
 * @param fileName - File name to create.
 * @returns Absolute scratch root.
 */
function scratchWithYaml(fileName) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-yaml-'));
  fs.writeFileSync(path.join(root, fileName), WORKFLOW_FIXTURE, 'utf8');
  return root;
}

/**
 * Scans one scratch tree.
 *
 * @param root - Absolute scratch root.
 * @returns The scan report.
 */
function scanRoot(root) {
  return scan({
    root,
    include: ['**/*.yml', '**/*.yaml'],
    exclude: [],
    cache: false,
    daemon: 'off',
    logLevel: 'silent',
    respectGitignore: false,
    unsupportedLanguage: 'error',
  });
}

function checkExtensionAllowList() {
  assert.ok(DEFAULT_EXT.includes('.yml'), '.yml must be in the discovery allow-list');
  assert.ok(DEFAULT_EXT.includes('.yaml'), '.yaml must be in the discovery allow-list');
  assert.strictEqual(EXTENSION_ADAPTER_IDS['.yml'], 'yaml', '.yml must index the yaml adapter');
  assert.strictEqual(EXTENSION_ADAPTER_IDS['.yaml'], 'yaml', '.yaml must index the yaml adapter');
  console.log('  ✔ both YAML extensions are discovered and indexed to one adapter');
}

function checkAdapterClaimsNoNodes() {
  const adapter = new DataAdapter();
  const ast = adapter.parse(WORKFLOW_FIXTURE, 'fixture.yml');
  const root = adapter.root(ast);
  assert.deepStrictEqual(
    adapter.children(root),
    [],
    'the adapter must expose no traversable nodes: YAML is data, not a program',
  );
  assert.strictEqual(root.kind, NodeKind.SourceFile, 'the root must be a source file node');
  console.log('  ✔ the adapter fabricates no AST nodes (code-shape rules stay silent)');
}

async function checkDiscoveryWithoutFailOpen() {
  const root = scratchWithYaml('workflow.yml');
  try {
    const report = await scanRoot(root);
    assert.strictEqual(report.summary.filesScanned, 1, 'the YAML file must be discovered');
    const unsupported = report.issues.filter((issue) => issue.rule === RULE_UNSUPPORTED);
    assert.deepStrictEqual(
      unsupported,
      [],
      'a claimed extension must not produce LANG-UNSUPPORTED',
    );
    console.log('  ✔ a YAML file is discovered and carries no unsupported-language diagnostic');
  } finally {
    rmSyncWithRetry(root, { recursive: true, force: true });
  }
}

async function checkTextRulesStillReadIt() {
  const root = scratchWithYaml('workflow.yml');
  try {
    const report = await scanRoot(root);
    // A text-oriented analyzer reads the raw lines. If the file were counted but never read, this
    // would be empty and the previous assertion would pass for the wrong reason.
    const onCredentialLine = report.issues.filter(
      (issue) =>
        issue.location.file === 'workflow.yml' && issue.location.start.line === CREDENTIAL_LINE,
    );
    assert.ok(
      onCredentialLine.length > 0,
      'the credential on the declared line must be judged, proving the raw text is read',
    );
    assert.ok(
      onCredentialLine.some((issue) => issue.rule === RULE_SECRET),
      `a literal credential must be reported as ${RULE_SECRET}`,
    );
    console.log('  ✔ text-oriented rules still read the raw YAML lines');
  } finally {
    rmSyncWithRetry(root, { recursive: true, force: true });
  }
}

async function checkBothExtensionsBehaveIdentically() {
  const ymlRoot = scratchWithYaml('workflow.yml');
  const yamlRoot = scratchWithYaml('workflow.yaml');
  try {
    const [ymlReport, yamlReport] = await Promise.all([scanRoot(ymlRoot), scanRoot(yamlRoot)]);
    assert.strictEqual(ymlReport.summary.filesScanned, 1, '.yml must be discovered');
    assert.strictEqual(yamlReport.summary.filesScanned, 1, '.yaml must be discovered');
    assert.strictEqual(
      ymlReport.issues.length,
      yamlReport.issues.length,
      'the two YAML extensions must produce the same finding count',
    );
    console.log('  ✔ .yml and .yaml produce identical results');
  } finally {
    rmSyncWithRetry(ymlRoot, { recursive: true, force: true });
    rmSyncWithRetry(yamlRoot, { recursive: true, force: true });
  }
}

async function main() {
  checkExtensionAllowList();
  checkAdapterClaimsNoNodes();
  await checkDiscoveryWithoutFailOpen();
  await checkTextRulesStillReadIt();
  await checkBothExtensionsBehaveIdentically();
  console.log('  ✔  yaml adapter: pipeline definitions are discoverable and judged, not skipped');
}

if (require.main === module) {
  runEntry('validate-yaml-adapter.js', main);
}

module.exports = Object.freeze({ main });
