/**
 * Module: Verification Harness — Staged Differential Exemption Clause Cases
 * File Path: auto-refactor/scripts/lib/exemption-clause-cases.js
 * Architecture Role: Holds the individual clause assertions for the exemption contract, kept
 *   apart from the runner so the runner stays a thin, reviewable skeleton and each clause reads
 *   as a self-contained statement of policy.
 * Dependencies & Triggers: Consumed by scripts/validate-diff-exemption.js through
 *   `registerExemptionCases`; the caller supplies the harness primitives so this module holds no
 *   filesystem fixture of its own.
 * Responsibilities:
 *   1. Assert the band shape: a floor, a target above it, and a relaxed line strictly between them.
 *   2. Assert a grant needs a streak, a new short file, and a measurement above the relaxed line.
 *   3. Assert structural violations and quota overflow are refused.
 *   4. Assert a committed grant is reused after the streak ledger is lost, and expires when the
 *      measurement drops below the relaxed line.
 *   5. Assert the streak clears when an identifier stops failing.
 * Exit Semantics & Design Rationale: Pure registration; this module never exits. Every clause is
 *   written as a paired positive and negative assertion, so a policy that granted everything would
 *   fail the refusals and one that granted nothing would fail the grants. That pairing is what makes
 *   the suite able to detect a crippled threshold rather than only a broken one.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  EXEMPTION_POLICY,
  SUBSTANTIVE_RATIO_BAND,
  TSPR_BAND,
  TSPR_VOUCH_FOR_DENSITY,
  DENSITY_FLOOR_BREACH,
  DENSITY_TARGET_DEFICIT,
  DENSITY_IN_BAND,
  classifyDensity,
  classifyBand,
  isNonExemptible,
  listBands,
  findBandIncoherence,
  describeBand,
  BAND_ABOVE_CEILING,
  BAND_IN_BAND,
} = require('../../../scripts/common/lib/diff-bounds-policy');
const {
  createLedger,
  relaxedLineFor,
  streakKey,
  bandForViolation,
  GRANT_GRANTED,
  GRANT_REUSED,
  GRANT_EXHAUSTED,
  GRANT_INELIGIBLE,
  GRANT_QUOTA_EXHAUSTED,
} = require('../../../scripts/common/lib/diff-exemption-ledger');

const TARGET_DEFICIT = 'SUBSTANTIVE_TARGET_DEFICIT';
const TEST_FILE = 'src/example-short-module.ts';

/**
 * Registers every exemption clause on the caller's harness.
 *
 * @param harness - Harness primitives supplied by the runner.
 * @param harness.check - Runs one named case and records its verdict.
 * @param harness.freshLedger - Creates an isolated ledger pair under a temp directory.
 * @param harness.eligibleRequest - Builds a request that every clause accepts.
 * @param harness.seedStreak - Pushes a streak onto a ledger so a following request sees it.
 */
function registerExemptionCases(harness) {
  const { check, freshLedger, eligibleRequest, seedStreak } = harness;

  check('bands declare a floor below a target and a relaxed line strictly between them', () => {
    for (const band of [SUBSTANTIVE_RATIO_BAND, TSPR_BAND]) {
      assert.ok(band.target > band.floor, 'target must sit above the floor');
      const relaxed = relaxedLineFor(band);
      assert.ok(
        relaxed >= band.floor,
        `the relaxed line ${relaxed} must not undercut the floor ${band.floor}`,
      );
      assert.ok(relaxed < band.target, 'the relaxed line must stay below the target');
    }
    assert.strictEqual(
      relaxedLineFor(SUBSTANTIVE_RATIO_BAND),
      Math.max(
        SUBSTANTIVE_RATIO_BAND.floor,
        SUBSTANTIVE_RATIO_BAND.target - EXEMPTION_POLICY.maxDrop,
      ),
    );
  });

  check('every declared band is internally coherent, and the table is enumerable', () => {
    assert.deepStrictEqual(findBandIncoherence(), [], 'no band may contradict itself');
    const names = listBands().map((entry) => entry.name);
    assert.ok(names.includes('substantiveRatio'), 'the substantive band must be enumerable');
    assert.ok(names.includes('tspr'), 'the payload band must be enumerable');
    for (const { name, band } of listBands()) {
      assert.ok(describeBand(band).length > 0, `${name} must render a readable range`);
    }
  });

  check('density classification separates a floor breach from a target deficit', () => {
    assert.strictEqual(
      classifyDensity(SUBSTANTIVE_RATIO_BAND.floor - 0.01, SUBSTANTIVE_RATIO_BAND),
      DENSITY_FLOOR_BREACH,
    );
    assert.strictEqual(
      classifyDensity(SUBSTANTIVE_RATIO_BAND.floor + 0.01, SUBSTANTIVE_RATIO_BAND),
      DENSITY_TARGET_DEFICIT,
    );
    assert.strictEqual(
      classifyDensity(SUBSTANTIVE_RATIO_BAND.target, SUBSTANTIVE_RATIO_BAND),
      DENSITY_IN_BAND,
    );
    assert.strictEqual(classifyBand(400, { ceiling: 360 }), BAND_ABOVE_CEILING);
    assert.strictEqual(classifyBand(200, { ceiling: 360 }), BAND_IN_BAND);
  });

  check('a high payload ratio lifts only the substantive target, never its floor', () => {
    assert.strictEqual(TSPR_VOUCH_FOR_DENSITY, 0.85, 'the voucher point is a committed contract');
    assert.ok(
      TSPR_VOUCH_FOR_DENSITY > TSPR_BAND.target,
      'the voucher must sit above the payload target it replaces',
    );
    const floors = [
      [0.5, 0.98],
      [0.44, 0.98],
      [0.9, 0.1],
    ];
    for (const [substantive, tspr] of floors) {
      const expected =
        substantive < SUBSTANTIVE_RATIO_BAND.floor
          ? DENSITY_FLOOR_BREACH
          : substantive < SUBSTANTIVE_RATIO_BAND.target
            ? DENSITY_TARGET_DEFICIT
            : DENSITY_IN_BAND;
      assert.strictEqual(
        classifyDensity(substantive, SUBSTANTIVE_RATIO_BAND),
        expected,
        `substantive ${substantive} must still be read against its own band`,
      );
      assert.strictEqual(
        classifyDensity(tspr, TSPR_BAND),
        tspr < TSPR_BAND.floor ? DENSITY_FLOOR_BREACH : DENSITY_IN_BAND,
      );
    }
  });

  check('structural violations carry no exemption band', () => {
    assert.strictEqual(isNonExemptible('BATCH_ADD_OVERFLOW'), true);
    assert.strictEqual(isNonExemptible('CAPABILITY_EROSION'), true);
    assert.strictEqual(bandForViolation('BATCH_ADD_OVERFLOW'), null);
    assert.strictEqual(bandForViolation(TARGET_DEFICIT), SUBSTANTIVE_RATIO_BAND);
  });

  check('the third consecutive block is the earliest grant, and two blocks never suffice', () => {
    assert.strictEqual(
      EXEMPTION_POLICY.minStreak,
      3,
      'the streak threshold is a committed contract, not a tunable',
    );
    const ledger = freshLedger();
    seedStreak(ledger, 2);
    assert.strictEqual(
      ledger.requestExemption(eligibleRequest({ streak: 2 })).outcome,
      GRANT_INELIGIBLE,
      'two blocks must never grant',
    );
    seedStreak(ledger, 1);
    const granted = ledger.requestExemption(eligibleRequest());
    assert.strictEqual(granted.outcome, GRANT_GRANTED);
    assert.strictEqual(granted.record.relaxedLine, relaxedLineFor(SUBSTANTIVE_RATIO_BAND));
    assert.strictEqual(ledger.loadExemptions().size, 1);
  });

  check('a fresh checkout reuses the committed grant without a new streak', () => {
    const ledger = freshLedger();
    const first = ledger.requestExemption(eligibleRequest());
    assert.strictEqual(first.outcome, GRANT_GRANTED);

    const reopened = createLedger(ledger.ledgerPaths);
    reopened.recordRunStreaks([{ file: TEST_FILE, type: TARGET_DEFICIT }]);
    const replay = reopened.requestExemption(eligibleRequest({ streak: 1 }));
    assert.strictEqual(replay.outcome, GRANT_REUSED);
  });

  check('a grant expires once the measurement falls below the relaxed line', () => {
    const ledger = freshLedger();
    ledger.requestExemption(eligibleRequest({ measured: 0.58, eligibilityValue: 0.58 }));
    const dropped = ledger.requestExemption(
      eligibleRequest({
        measured: SUBSTANTIVE_RATIO_BAND.floor - 0.01,
        eligibilityValue: SUBSTANTIVE_RATIO_BAND.floor - 0.01,
      }),
    );
    assert.strictEqual(dropped.outcome, GRANT_EXHAUSTED);
  });

  check('a block below the rigid streak threshold is refused', () => {
    const ledger = freshLedger();
    const outcome = ledger.requestExemption(
      eligibleRequest({ streak: EXEMPTION_POLICY.minStreak - 1 }),
    );
    assert.strictEqual(outcome.outcome, GRANT_INELIGIBLE);
    assert.ok(outcome.reasons.some((reason) => reason.includes('streak')));
  });

  check('the exemption scope is a fixed short-new-file contract', () => {
    assert.strictEqual(EXEMPTION_POLICY.maxNewFilePhysAdd, 60, 'the scope is a committed contract');
    assert.strictEqual(
      EXEMPTION_POLICY.maxPerBatch,
      1,
      'one grant per commit is a committed contract',
    );
    assert.strictEqual(EXEMPTION_POLICY.maxDrop, 0.15, 'the relaxation is a committed contract');
  });

  check('an existing file and a long file are both refused', () => {
    const ledger = freshLedger();
    const notNew = ledger.requestExemption(eligibleRequest({ isNew: false }));
    assert.strictEqual(notNew.outcome, GRANT_INELIGIBLE);
    assert.ok(notNew.reasons.some((reason) => reason.includes('newly added')));

    const tooLong = ledger.requestExemption(
      eligibleRequest({ physAdd: EXEMPTION_POLICY.maxNewFilePhysAdd }),
    );
    assert.strictEqual(tooLong.outcome, GRANT_INELIGIBLE);
    assert.ok(tooLong.reasons.some((reason) => reason.includes('physical lines')));
  });

  check('a second identifier beyond the batch quota is refused', () => {
    const ledger = freshLedger();
    const first = ledger.requestExemption(eligibleRequest({ batchGrantedCount: 0 }));
    assert.strictEqual(first.outcome, GRANT_GRANTED);
    const second = ledger.requestExemption(
      eligibleRequest({
        file: 'src/second-short-module.ts',
        batchGrantedCount: EXEMPTION_POLICY.maxPerBatch,
      }),
    );
    assert.strictEqual(second.outcome, GRANT_QUOTA_EXHAUSTED);
  });

  check('a measurement below the relaxed line is refused even with a full streak', () => {
    const ledger = freshLedger();
    const outcome = ledger.requestExemption(
      eligibleRequest({
        measured: SUBSTANTIVE_RATIO_BAND.floor - 0.02,
        eligibilityValue: SUBSTANTIVE_RATIO_BAND.floor - 0.02,
      }),
    );
    assert.strictEqual(outcome.outcome, GRANT_INELIGIBLE);
    assert.ok(outcome.reasons.some((reason) => reason.includes('relaxed line')));
  });

  check('a streak clears when its identifier stops failing', () => {
    const ledger = freshLedger();
    for (let i = 0; i < 4; i += 1) {
      ledger.recordRunStreaks([{ file: TEST_FILE, type: TARGET_DEFICIT }]);
    }
    const key = streakKey(TEST_FILE, TARGET_DEFICIT);
    assert.strictEqual(ledger.loadStreaks().get(key), 4);
    ledger.recordRunStreaks([{ file: 'src/other.ts', type: TARGET_DEFICIT }]);
    assert.strictEqual(
      ledger.loadStreaks().get(key),
      undefined,
      'an identifier that stops failing must leave no counter behind',
    );
  });

  check('an unreadable ledger degrades to no grant rather than an exception', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-exemption-bad-'));
    const streakFile = path.join(dir, 'streaks.json');
    const exemptionFile = path.join(dir, 'exemptions.json');
    fs.writeFileSync(streakFile, '{ this is not json', 'utf8');
    fs.writeFileSync(exemptionFile, '{ neither is this', 'utf8');
    const ledger = createLedger({ streakFile, exemptionFile });
    assert.strictEqual(ledger.loadStreaks().size, 0);
    assert.strictEqual(ledger.loadExemptions().size, 0);
    assert.strictEqual(
      ledger.requestExemption(eligibleRequest({ streak: 1 })).outcome,
      GRANT_INELIGIBLE,
      'a corrupt ledger must read as zero streak, so the first block is refused rather than granted',
    );
    assert.strictEqual(ledger.requestExemption(eligibleRequest()).outcome, GRANT_GRANTED);
  });
}

module.exports = { registerExemptionCases };
