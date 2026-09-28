/**
 * Module: Validation — Report Schema Conformance
 * File Path: scripts/validate-report-schema.js
 * Architecture Role: Asserts that the report this engine produces actually satisfies the
 *   schema this engine publishes. The two had drifted: `report.schema.json` set
 *   `additionalProperties: false` while listing only eight top-level fields, yet the report
 *   builder also emits `qualityScore`, `fileQualityScores`, `triPlaneQuality` and
 *   `autonomy`. Every report the tool produced therefore failed its own schema, and because
 *   nothing validated it, the drift went unnoticed. The MoE routing spec claimed a "report
 *   schema gate" existed; it did not.
 * Dependencies & Triggers: ajv (already present transitively) plus the built dist, so the
 *   schema is checked against a real report rather than a hand-written sample.
 * Responsibilities: compile the published schema, validate a real full-analysis report,
 *   validate the same report after a JSON round trip (NaN becomes null), and validate the
 *   unmeasured shape where compositeScore is null and the grade is 'N/A'.
 * Exit Semantics & Design Rationale: Read-only assertion; exits non-zero on any violation.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Ajv = require('ajv');

const ROOT = path.join(__dirname, '..');
const SCHEMA_PATH = path.join(ROOT, 'report.schema.json');

/**
 * Build a compiler for the published report schema.
 *
 * @returns ajv validate function.
 */
function buildValidator() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

/**
 * Assert every error path in a validation result is rendered readably.
 *
 * @param validate - Compiled ajv validator.
 * @param report - Report to validate.
 * @param label - Human label for the report under test.
 * @returns Nothing; throws with the first few validation errors.
 */
function assertValid(validate, report, label) {
  const valid = validate(report);
  if (valid) {
    console.log(`  [PASS] ${label} conforms to report.schema.json`);
    return;
  }
  const detail = (validate.errors || [])
    .slice(0, 8)
    .map((e) => `      ${e.instancePath || '/'} ${e.message} (${e.keyword})`)
    .join('\n');
  assert.fail(
    `${label} violates report.schema.json:\n${detail}` +
      `\n      ...${Math.max(0, (validate.errors || []).length - 8)} more`,
  );
}

async function run() {
  console.log('--- Validating report schema conformance ---');
  const validate = buildValidator();

  // 1. A real full-analysis report, taken from a temp fixture so the check exercises the
  //    production report builder rather than a synthetic object.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-schema-'));
  const src = path.join(dir, 'sample.ts');
  fs.writeFileSync(
    src,
    [
      'export function connect(host: string, port: number): string {',
      '    const password = "hardcoded-secret";',
      '    return host + ":" + port + password;',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  const { scan } = require(path.join(ROOT, 'dist', 'api.js'));
  try {
    const report = await scan({
      root: dir,
      include: ['**/*.ts'],
      logLevel: 'silent',
      cache: false,
      workers: 1,
    });
    assertValid(validate, report, 'full-analysis report');

    // The report must survive a JSON round trip: NaN becomes null on serialisation, which
    // is exactly the case the schema has to allow.
    const roundTripped = JSON.parse(JSON.stringify(report));
    assertValid(validate, roundTripped, 'report after JSON round trip');

    if (roundTripped.qualityScore) {
      const score = roundTripped.qualityScore;
      console.log(
        `         composite=${score.compositeScore} grade=${score.grade} ` +
          `coverage=${score.coverage}`,
      );
      assert.ok(
        typeof score.compositeScore === 'number' || score.compositeScore === null,
        'compositeScore must serialise as a number or null, never a string',
      );
      assert.ok(
        ['A+', 'A', 'B', 'C', 'D', 'F', 'N/A'].includes(score.grade),
        `grade must be one of the published labels, got ${score.grade}`,
      );
    }

    // 2. The unmeasured case: a scan whose analyzers witness no quality dimension must
    //    serialise to null with an N/A grade, and the schema has to accept that shape. The
    //    real envelope is reused so only the quality payload differs.
    const unmeasured = {
      ...report,
      qualityScore: {
        indices: {},
        compositeScore: null,
        grade: 'N/A',
        confidence: 0.6,
        coverage: 0,
        weights: {},
        notEvaluated: [],
        evaluatedBy: {},
        deductionsByDimension: {},
      },
      fileQualityScores: {},
    };
    assertValid(validate, unmeasured, 'unmeasured quality score');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('\nALL REPORT SCHEMA CHECKS PASSED SUCCESSFULLY!');
}

run().catch((err) => {
  console.error('\n[FAIL]', err && err.message ? err.message : err);
  process.exit(1);
});
