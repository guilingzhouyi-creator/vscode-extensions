/**
 * Module: Verification Harness — Baseline Ratchet Multiplicity & Escalation
 * File Path: scripts/validate-baseline-ratchet.js
 * Architecture Role: Contract lock for the baseline ratchet: one baselined occurrence is one
 *     credit, so growth on a line that already carried findings and a severity escalation above
 *     the baselined severity both stay blocking
 * Dependencies & Triggers: `npm run validate-baseline-ratchet` (part of `npm test`); imports
 *     ../dist/api (scan) and drives synthetic TS projects through real baseline freezes
 * Responsibilities: Assert the 1.2.0 id payload stores one row per distinct id plus a severity
 *     histogram; assert a legacy 1.0.0 id list keeps absorbing the occurrences it recorded; assert
 *     an extra same-line occurrence breaks both an id and a grouped baseline; assert warning->error
 *     escalation breaks both granularities while de-escalation does not; assert a scan without a
 *     baseline annotates nothing
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so CI
 *     fails loudly. Every case freezes a baseline first and then perturbs exactly one dimension
 *     (one extra literal, or one severity step) so a regression points at the comparison rule
 *     rather than at the fixture. The gate-verdict half of the suppression contract lives in
 *     validate-suppression-gate.js so neither file outgrows the large-file threshold.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../dist/api');
const {
  ratchetDownGroups,
  remapGroupKey,
  normalizeGroupsForRename,
  RULE_GOV_RTC_002,
} = require('../dist/core/reporting/baseline-ratchet');

/** Issue id the constants analyzer emits for the first magic number of the fixture line. */
const MAGIC_ID = 'constants:magic-number:src/a.ts:1';
/** Issue id the large-file analyzer emits for the oversized fixture file. */
const BIG_ID = 'large-file:large-file:src/big.ts:1';

/**
 * Write a set of fixture files into a directory tree.
 *
 * @param root - Absolute directory that receives the files.
 * @param files - Map of relative path to UTF-8 content.
 */
function writeFiles(root, files) {
  for (const [name, content] of Object.entries(files)) {
    const abs = path.join(root, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/**
 * Build a syntactically flat TypeScript file of an exact length.
 *
 * Named const initializers are exempt from the constants analyzer, so only the large-file rule can
 * fire on a fixture built this way and the case stays about file size alone.
 *
 * @param lines - Number of filler declarations to emit.
 * @returns File content with a trailing export so the module is never empty.
 */
function bigFile(lines) {
  const body = [];
  for (let i = 1; i <= lines; i += 1) body.push(`const v${i} = ${i};`);
  body.push('export const end = 1;');
  return body.join('\n') + '\n';
}

/**
 * Build scan options for one fixture root.
 *
 * @param root - Synthetic project root.
 * @param extra - Additional `scan()` options (baseline knobs).
 * @returns Options object accepted by the library entry point.
 */
function optionsFor(root, extra) {
  return {
    root,
    configFile: path.join(root, 'auto-refactor.config.json'),
    cache: false,
    daemon: 'off',
    workers: 1,
    respectGitignore: false,
    logLevel: 'silent',
    ...extra,
  };
}

/**
 * Collect the newly flagged findings of one rule.
 *
 * @param report - Ratcheted scan report.
 * @param rule - Rule key to filter on.
 * @returns Newly flagged findings of that rule.
 */
function newOfRule(report, rule) {
  const flagged = [];
  for (const issue of report.issues) {
    if (issue.rule === rule && issue.isNew === true) flagged.push(issue);
  }
  return flagged;
}

/**
 * Assert a frozen payload keeps distinct ids plus the severity histogram.
 *
 * @param baselineId - Frozen id-granularity baseline file.
 * @param baselineGrouped - Frozen grouped-granularity baseline file.
 */
function checkFrozenPayload(baselineId, baselineGrouped) {
  const frozenId = JSON.parse(fs.readFileSync(baselineId, 'utf8'));
  assert.strictEqual(frozenId.version, '1.2.0', 'a freeze must record the current payload version');
  assert.deepStrictEqual(
    frozenId.issues.filter((id) => id === MAGIC_ID),
    [MAGIC_ID],
    'the id payload must store one row per distinct id, not one row per occurrence',
  );
  assert.deepStrictEqual(
    frozenId.severities[MAGIC_ID],
    { warning: 3 },
    'the severity histogram must keep the occurrence multiplicity the id list no longer carries',
  );
  const grouped = JSON.parse(fs.readFileSync(baselineGrouped, 'utf8'));
  assert.deepStrictEqual(
    grouped.groups.find((group) => group.key === 'constants|magic-number|src/a.ts'),
    { key: 'constants|magic-number|src/a.ts', count: 3, severities: { warning: 3 } },
    'a grouped row must carry both the count and the severity histogram',
  );
  console.log('  [PASS] freeze records distinct ids plus severity histograms');
}

/**
 * Assert multiplicity survives freezing, both granularities, and legacy id baselines.
 *
 * @param root - Fixture root holding the config and `src/a.ts`.
 */
async function checkSameLineGrowth(root) {
  const baselineId = path.join(root, 'id-baseline.json');
  const baselineGrouped = path.join(root, 'grouped-baseline.json');
  writeFiles(root, { 'src/a.ts': 'export const table = [11, 7, 500];\n' });

  const seed = await scan(optionsFor(root, {}));
  assert.ok(!seed.summary.ratchetBaselineUsed, 'no baseline means no ratchet annotation');
  assert.strictEqual(
    seed.issues.filter((issue) => issue.isNew === true).length,
    0,
    'without a baseline no finding may be flagged as new',
  );
  await scan(optionsFor(root, { updateBaseline: baselineId, baselineGranularity: 'id' }));
  await scan(optionsFor(root, { updateBaseline: baselineGrouped, baselineGranularity: 'grouped' }));
  checkFrozenPayload(baselineId, baselineGrouped);

  writeFiles(root, { 'src/a.ts': 'export const table = [11, 7, 500, 999];\n' });

  const ratchetOptions = { baseline: baselineId, baselineGranularity: 'id' };
  const idRatchet = await scan(optionsFor(root, ratchetOptions));
  const idNew = newOfRule(idRatchet, 'magic-number');
  assert.strictEqual(idRatchet.summary.ratchetBaselineUsed, true, 'the baseline must be applied');
  assert.strictEqual(idNew.length, 1, 'an extra same-line occurrence must break an id baseline');
  assert.ok(idNew[0].message.includes('999'), 'the new credit must go to the added literal');

  const groupedRatchet = await scan(
    optionsFor(root, { baseline: baselineGrouped, baselineGranularity: 'grouped' }),
  );
  assert.strictEqual(
    newOfRule(groupedRatchet, 'magic-number').length,
    1,
    'an extra same-line occurrence must break a grouped baseline too',
  );
  console.log('  [PASS] same-line growth breaks the ratchet under both granularities');

  const legacyPath = path.join(root, 'legacy-baseline.json');
  fs.writeFileSync(
    legacyPath,
    JSON.stringify({ version: '1.0.0', issues: [MAGIC_ID, MAGIC_ID, MAGIC_ID] }, null, 2),
  );
  const legacyNew = newOfRule(
    await scan(optionsFor(root, { baseline: legacyPath, baselineGranularity: 'id' })),
    'magic-number',
  );
  assert.strictEqual(
    legacyNew.length,
    1,
    'a legacy id list must absorb the three occurrences it recorded and flag only the fourth',
  );
  assert.ok(legacyNew[0].message.includes('999'), 'the fourth occurrence is the new one');
  console.log('  [PASS] legacy id baselines keep occurrence counting (multiplicity fallback)');
}

/**
 * Assert that a severity escalation above the baselined severity breaks the ratchet.
 *
 * @param root - Fixture root for the oversized file.
 */
async function checkSeverityEscalation(root) {
  const baselineId = path.join(root, 'big-id-baseline.json');
  const baselineGrouped = path.join(root, 'big-grouped-baseline.json');
  writeFiles(root, { 'src/big.ts': bigFile(450) });
  await scan(optionsFor(root, { updateBaseline: baselineId, baselineGranularity: 'id' }));
  await scan(optionsFor(root, { updateBaseline: baselineGrouped, baselineGranularity: 'grouped' }));

  writeFiles(root, { 'src/big.ts': bigFile(952) });
  const oversized = await scan(
    optionsFor(root, { baseline: baselineId, baselineGranularity: 'id' }),
  );
  const grew = newOfRule(oversized, 'large-file');
  assert.strictEqual(grew.length, 1, 'the fixture must produce exactly one large-file row');
  assert.strictEqual(grew[0].id, BIG_ID, 'the row must keep the id the baseline recorded');
  assert.strictEqual(grew[0].severity, 'error', '952 lines is past the fail threshold');
  const grouped = newOfRule(
    await scan(optionsFor(root, { baseline: baselineGrouped, baselineGranularity: 'grouped' })),
    'large-file',
  );
  assert.strictEqual(
    grouped.length,
    1,
    'a warning->error escalation must break the grouped baseline too',
  );
  console.log('  [PASS] severity escalation breaks the ratchet under both granularities');

  const shrunkPath = path.join(root, 'shrunk-baseline.json');
  await scan(optionsFor(root, { updateBaseline: shrunkPath, baselineGranularity: 'id' }));
  writeFiles(root, { 'src/big.ts': bigFile(450) });
  const shrunk = await scan(optionsFor(root, { baseline: shrunkPath, baselineGranularity: 'id' }));
  assert.strictEqual(
    newOfRule(shrunk, 'large-file').length,
    0,
    'a baselined error absorbs a warning',
  );
  assert.strictEqual(
    shrunk.issues.filter((issue) => issue.rule === 'large-file')[0].severity,
    'warning',
    '450 lines is back to the warn band',
  );
  console.log('  [PASS] de-escalation is not reported as a new finding');
}

function checkRenamePathShiftNormalization() {
  assert.strictEqual(RULE_GOV_RTC_002, 'GOV-RTC-002');

  const oldGroups = [
    {
      key: 'constants|hardcoded-string|src/legacy/old-util.ts',
      count: 5,
      severities: { warning: 5 },
    },
    {
      key: 'simplify|SIM-LONG-001|src/unchanged.ts',
      count: 1,
      severities: { warning: 1 },
    },
  ];

  const pathRemap = {
    'src/legacy/old-util.ts': 'src/core/new-util.ts',
  };

  const remappedKey = remapGroupKey(oldGroups[0].key, pathRemap);
  assert.strictEqual(remappedKey, 'constants|hardcoded-string|src/core/new-util.ts');

  const normalized = normalizeGroupsForRename(oldGroups, pathRemap);
  assert.strictEqual(normalized[0].key, 'constants|hardcoded-string|src/core/new-util.ts');
  assert.strictEqual(normalized[1].key, 'simplify|SIM-LONG-001|src/unchanged.ts');

  // When files are renamed, ratchetDownGroups with pathRemap prevents false-positive debt expansion
  const currentIssues = [
    {
      rule: 'hardcoded-string',
      analyzer: 'constants',
      location: {
        file: 'src/core/new-util.ts',
        start: { line: 10, column: 1 },
        end: { line: 10, column: 1 },
      },
      severity: 'warning',
    },
    {
      rule: 'SIM-LONG-001',
      analyzer: 'simplify',
      location: {
        file: 'src/unchanged.ts',
        start: { line: 1, column: 1 },
        end: { line: 1, column: 1 },
      },
      severity: 'warning',
    },
  ];

  // Without pathRemap: old-util.ts debt is pruned, new-util.ts is considered a new expansion
  const withoutRemap = ratchetDownGroups(oldGroups, currentIssues, false);
  assert.ok(
    withoutRemap.expandedKeys.length > 0,
    'without remap, rename triggers expansion rejection',
  );

  // With pathRemap: new-util.ts matches prior baseline, debt count decreased from 5 to 1
  const withRemap = ratchetDownGroups(oldGroups, currentIssues, false, pathRemap);
  assert.strictEqual(
    withRemap.expandedKeys.length,
    0,
    'with remap, rename does not cause expansion rejection',
  );
  assert.strictEqual(withRemap.decreasedCount, 4, 'debt decreased from 5 to 1');
  assert.strictEqual(withRemap.groups[0].key, 'constants|hardcoded-string|src/core/new-util.ts');
  assert.strictEqual(withRemap.groups[0].count, 1);

  console.log('  [PASS] GOV-RTC-002: baseline refactoring rename path normalization validated');
}

async function main() {
  const smallRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-ratchet-'));
  const bigRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-ratchet-big-'));
  try {
    writeFiles(smallRoot, {
      'auto-refactor.config.json': JSON.stringify(
        {
          include: ['src/**/*.ts'],
          analyzers: { constants: { enabled: true, options: { magicNumberMin: 3 } } },
        },
        null,
        2,
      ),
    });
    writeFiles(bigRoot, {
      'auto-refactor.config.json': JSON.stringify(
        {
          include: ['src/**/*.ts'],
          thresholds: { fileLinesWarn: 400, fileLinesFail: 900 },
          analyzers: {
            'large-file': { enabled: true },
            constants: { enabled: false },
            complexity: { enabled: false },
          },
        },
        null,
        2,
      ),
    });

    await checkSameLineGrowth(smallRoot);
    await checkSeverityEscalation(bigRoot);
    checkRenamePathShiftNormalization();
    console.log('  [PASS] ratchet credits cover multiplicity, escalation and legacy payloads');
  } finally {
    fs.rmSync(smallRoot, { recursive: true, force: true });
    fs.rmSync(bigRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[validate-baseline-ratchet] FAILED:', error && error.message);
  process.exit(1);
});
