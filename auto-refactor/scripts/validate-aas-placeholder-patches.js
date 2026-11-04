/**
 * Module: Gate — Agent-Facing Patch Adjudication Validation
 * File Path: scripts/validate-aas-placeholder-patches.js
 * Architecture Role: Standalone gate for the rule that mechanical and contentless names never reach
 *   an agent-facing patch. Split out of `validate-aas-reporter.js` to keep that script inside the
 *   dual-scale code volume budget.
 * Dependencies & Triggers: `dist/api.js` (buildAasReport) and `node:assert`; run directly or from
 *   the parallel test lane.
 * Responsibilities:
 *   1. Assert placeholder-patch fixtures lose their replacement template and any safety flag.
 *   2. Assert domain-derived names, single-word vocabulary names and positional numeric names keep
 *      both their template and their flag.
 *   3. Assert the preserved name is longer than the welded one, proving length is not the signal.
 * Exit Semantics & Design Rationale: Any failed assertion aborts with a non-zero exit code so the
 *   gate lane fails loudly; a passing run prints one confirmation line.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const { buildAasReport } = require(path.join(REPO_ROOT, 'dist', 'api.js'));

/**
 * Minimal report shape the AAS projection reads.
 *
 * @param overrides - Fields replacing the neutral defaults.
 * @returns Report object accepted by `buildAasReport`.
 */
function createMockScanReport(overrides = {}) {
  return {
    tool: 'auto-refactor',
    version: '0.4.0',
    generatedAt: '2026-10-24T12:00:00.000Z',
    root: '/workspace',
    config: {},
    summary: {
      filesScanned: 1,
      issuesTotal: 0,
      bySeverity: { error: 0, warning: 0, info: 0 },
      byAnalyzer: { constants: 0 },
      durationMs: 42,
    },
    fileMetrics: [],
    issues: [],
    ...overrides,
  };
}

/**
 * Builds one finding carrying a replacement patch for a suggested constant name.
 *
 * @param fixture - Suggested name, originating literal, line index and the rule it belongs to.
 * @returns Issue object carrying a templateSnippet patch.
 */
function buildPlaceholderIssue({ placeholderName, literal, index, rule = 'hardcoded-string' }) {
  return {
    id: `constants:${rule}:src/placeholder.ts:${index}`,
    analyzer: 'constants',
    rule,
    severity: 'warning',
    message: 'Hardcoded string should be extracted into a named constant.',
    location: {
      file: 'src/placeholder.ts',
      start: { line: index, column: 3 },
      end: { line: index, column: 12 },
    },
    detail: { value: literal, suggestedName: placeholderName },
    suggestion: `const ${placeholderName} = ${JSON.stringify(String(literal))};`,
    actionable: {
      action: 'extract_constant',
      patch: 'replace_line',
      templateSnippet: placeholderName,
      safeToAutomate: true,
    },
  };
}

/**
 * Asserts placeholder findings are still reported but stripped of any agent-facing patch.
 *
 * @param placeholderIssues - Findings whose suggested names are mechanical.
 */
function assertPlaceholdersAreStripped(placeholderIssues) {
  const doc = buildAasReport(createMockScanReport({ issues: placeholderIssues }));
  const defects = doc.files['src/placeholder.ts'];
  assert.strictEqual(
    defects.length,
    placeholderIssues.length,
    'All placeholder findings must still be reported',
  );
  for (const defect of defects) {
    assert.strictEqual(
      defect.fix.template,
      undefined,
      `Mechanical patch must drop its template, got ${JSON.stringify(defect.fix.template)}`,
    );
  }
}

/**
 * Asserts one legitimate name survives into the patch with its flag intact.
 *
 * @param issue - Finding whose suggested name is a genuine identifier.
 * @param expected - Template the reporter must preserve.
 * @param reason - Assertion message describing why this name is legitimate.
 * @returns The preserved template.
 */
function assertDomainNameSurvives(issue, expected, reason) {
  const doc = buildAasReport(createMockScanReport({ issues: [issue] }));
  const defect = doc.files['src/placeholder.ts'][0];
  assert.strictEqual(defect.fix.template, expected, reason);
  assert.strictEqual(
    defect.fix.safeToAutomate,
    true,
    'A domain-derived or vocabulary name must keep its automation flag',
  );
  return defect.fix.template;
}

function runTests() {
  const placeholderIssues = [
    { name: 'EXTRACTED_STRING', literal: 'a' },
    { name: 'EXTRACTED_NUMBER', literal: '7' },
    { name: 'INVALIDNAME_TEXT', literal: 'invalid name' },
  ].map(({ name: placeholderName, literal }, index) =>
    buildPlaceholderIssue({ placeholderName, literal, index: index + 1 }),
  );
  assertPlaceholdersAreStripped(placeholderIssues);

  const domainIssue = buildPlaceholderIssue({
    placeholderName: 'DEFAULT_RETRY_BUDGET',
    literal: 'default retry budget',
    index: 99,
  });
  assertDomainNameSurvives(
    domainIssue,
    'DEFAULT_RETRY_BUDGET',
    'A domain-derived constant name must survive into the patch',
  );

  const singleWordIssue = buildPlaceholderIssue({
    placeholderName: 'DIALOG_TEXT',
    literal: 'dialog',
    index: 100,
  });
  assertDomainNameSurvives(
    singleWordIssue,
    'DIALOG_TEXT',
    'A single-word domain name ending in _TEXT must keep its patch',
  );

  // Length is not the weld signal: `UNCONDITIONAL_TEXT` is longer than the welded `INVALIDNAME_TEXT`
  // and must survive. An earlier guard keyed on the length of the upper-case run rejected 120
  // legitimate patches exactly like this one.
  const longVocabularyIssue = buildPlaceholderIssue({
    placeholderName: 'UNCONDITIONAL_TEXT',
    literal: 'unconditional',
    index: 101,
  });
  const preservedName = assertDomainNameSurvives(
    longVocabularyIssue,
    'UNCONDITIONAL_TEXT',
    'A long single-word name is vocabulary, not a weld, and must keep its patch',
  );
  assert.strictEqual(
    preservedName.length > 'INVALIDNAME_TEXT'.length,
    true,
    'The preserved name must be longer than the welded name, proving length is not the signal',
  );

  console.log('✔  Mechanical placeholder patches are stripped, domain names preserved');
}

try {
  runTests();
} catch (executionError) {
  console.error(
    'FAIL: validate-aas-placeholder-patches.js encountered an error:',
    executionError,
  );
  process.exitCode = 1;
}
