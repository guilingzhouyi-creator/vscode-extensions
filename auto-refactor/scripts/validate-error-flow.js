#!/usr/bin/env node
/**
 * Module: Verification Harness - Error Propagation Chains
 * File Path: scripts/validate-error-flow.js
 * Architecture Role: Key-point lock for the error-taxonomy pass: a duplicated error code and a
 *     three-hop propagation chain must be reported from the shared literal plus call-graph facts,
 *     with the static limits of the inference stated in the finding
 * Dependencies & Triggers: `npm run validate-error-flow` (part of `npm test`); imports ../dist/api
 *     (scan) and drives a four-file fixture through the materialized traversal
 * Responsibilities: Assert the duplicate raisers are grouped into one finding, that the chain
 *     reaches three hops and ends at the static boundary, that the finding states `staticOnly`, and
 *     that the pass stays opt-in
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1, so a pass
 *     that silently stops walking callers (or claims verified handling) fails the build; temporary
 *     fixture roots are removed in a `finally` block.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../dist/api.js');

const PLUGIN = path.join(__dirname, '..', 'samples', 'analyzers', 'noConsole.js');

/** chain b -> c -> d raises ERR_TIMEOUT twice (b and d); a is the static entry boundary. */
const FIXTURE = {
  'src/a.ts': ["import { b } from './b';", 'export function a(): void {', '  b();', '}', ''].join(
    '\n',
  ),
  'src/b.ts': [
    "import { c } from './c';",
    'export function b(): void {',
    '  if (ready()) {',
    "    throw new Error('ERR_TIMEOUT');",
    '  }',
    '  c();',
    '}',
    '',
  ].join('\n'),
  'src/c.ts': ["import { d } from './d';", 'export function c(): void {', '  d();', '}', ''].join(
    '\n',
  ),
  'src/d.ts': ['export function d(): void {', "  throw new Error('ERR_TIMEOUT');", '}', ''].join(
    '\n',
  ),
};

/**
 * Write the fixture tree and scan it with or without the error-propagation option.
 *
 * @param root - Fixture project root.
 * @param enabled - Whether the hygiene analyzer opts into the pass.
 * @returns Scan report.
 */
async function scanFixture(root, enabled) {
  for (const [name, content] of Object.entries(FIXTURE)) {
    const absolute = path.join(root, name);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  const config = {
    include: ['**/*.ts'],
    analyzers: {
      'no-console': { enabled: true },
      hygiene: { enabled: true, options: enabled ? { errorPropagation: true } : {} },
    },
    customAnalyzers: [
      { name: 'no-console', module: PLUGIN, enabled: true, signals: ['LITERAL'], track: 'fast' },
    ],
  };
  const configFile = path.join(root, 'auto-refactor.config.json');
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  return scan({ root, configFile, logLevel: 'silent', cache: false, workers: 1 });
}

/**
 * Select the error-propagation findings from a report.
 *
 * @param report - Scan report.
 * @returns Findings emitted under the ERR-PRP-001 rule.
 */
function errorFindings(report) {
  return report.issues.filter((issue) => issue.rule === 'ERR-PRP-001');
}

(async () => {
  const enabledRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-errorflow-on-'));
  const disabledRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-errorflow-off-'));
  try {
    const findings = errorFindings(await scanFixture(enabledRoot, true));
    assert.strictEqual(
      findings.length,
      1,
      `expected one error-code finding, got ${findings.length}`,
    );
    const finding = findings[0];
    assert.strictEqual(finding.detail.code, 'ERR_TIMEOUT', 'the finding must name the code');
    assert.strictEqual(
      finding.detail.duplicate,
      true,
      'two raisers must count as a duplicate code',
    );
    assert.deepStrictEqual(
      finding.detail.raisers,
      ['b', 'd'],
      'both raising declarations must be listed',
    );
    assert.strictEqual(finding.detail.raiseSites.length, 2, 'both raise sites must be evidence');
    assert.deepStrictEqual(
      finding.detail.chain,
      ['d', 'c', 'b', 'a'],
      'the deepest static chain must be reported',
    );
    assert.strictEqual(finding.detail.hops, 3, 'the chain must span three hops');
    assert.strictEqual(finding.detail.boundary, 'a', 'the static walk must name its boundary');
    assert.strictEqual(finding.detail.boundaryIsEntryPoint, true, 'a has no static caller');
    assert.strictEqual(
      finding.detail.staticOnly,
      true,
      'the finding must not claim verified handling',
    );
    console.log(
      `  [PASS] duplicate code reported with a ${finding.detail.hops}-hop chain ` +
        `(${finding.detail.chain.join(' <- ')}) and its boundary`,
    );

    const offFindings = errorFindings(await scanFixture(disabledRoot, false));
    assert.strictEqual(offFindings.length, 0, 'the pass must stay opt-in');
    console.log('  [PASS] the error-propagation pass stays opt-in');
  } finally {
    fs.rmSync(enabledRoot, { recursive: true, force: true });
    fs.rmSync(disabledRoot, { recursive: true, force: true });
  }

  console.log('\n ALL ERROR FLOW CHECKS PASSED SUCCESSFULLY!\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
