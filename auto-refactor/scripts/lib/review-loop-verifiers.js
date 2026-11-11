/**
 * Module: Verification Harness — Review Loop Stages
 * File Path: scripts/lib/review-loop-verifiers.js
 * Architecture Role: Holds the seven closure stages that prove a human verdict reaches the
 *   corpus and moves the arbiter. Kept apart from the runner so each stage is reviewed as a
 *   statement about the loop rather than buried under fixture construction.
 * Dependencies & Triggers: receives every collaborator through a `runtime` object assembled by
 *   scripts/validate-review-loop.js; never requires the engine build itself, so the module cannot
 *   load a different copy of the corpus schema than the runner asserts against.
 * Responsibilities:
 *   1. Stage 1: a recorded verdict reaches the corpus and lowers the arbiter's confidence.
 *   2. Stage 2: re-running the same review is idempotent and leaves the corpus byte-identical.
 *   3. Stage 3: a corrected verdict replaces the earlier one instead of accumulating.
 *   4. Stage 4: malformed ledgers, bad entries and missing queues are refused.
 *   5. Stage 5: usage errors exit distinctly from an empty queue.
 *   6. Stage 6: the intake and ledger vocabularies stay closed.
 *   7. Stage 7: a cross-rule batch is refused, a dry run writes nothing, a narrow run records.
 * Exit Semantics & Design Rationale: Throws on the first violation; the runner owns the exit code
 *   so one failing stage cannot be mistaken for a passing suite that simply printed less.
 */

'use strict';

/**
 * Runs all stages in order.
 *
 * @param runtime - Collaborators assembled by the runner.
 */
function runReviewLoopVerifications(runtime) {
  const {
    assert,
    fs,
    reviewCommand,
    intake,
    ledger,
    corpusModule,
    FindingConfidenceArbiter,
    queueLine,
    finding,
    scratch,
    run,
  } = runtime;

  /** Stage 1: a recorded verdict must reach the corpus and move the arbiter. */
  function verifyVerdictReachesArbiter() {
    console.log('\n1. Verifying a recorded verdict reaches the corpus and the arbiter...');
    const dir = scratch();
    try {
      fs.writeFileSync(dir.queue, queueLine() + '\n');
      const before = new FindingConfidenceArbiter().arbitrateFinding(finding());
      assert.strictEqual(before.confidenceSource, 'uncalibrated');

      const result = run(dir, 'false-positive');
      assert.strictEqual(result.code, 0, result.text);
      assert.ok(fs.existsSync(dir.corpus));
      assert.ok(fs.existsSync(dir.ledger));

      const body = JSON.parse(fs.readFileSync(dir.corpus, 'utf8'));
      assert.strictEqual(body.schema, corpusModule.CALIBRATION_CORPUS_SCHEMA);
      assert.deepStrictEqual(body.rules, [
        { rule: 'hardcoded-string', truePositives: 0, falsePositives: 1 },
      ]);

      const stats = corpusModule.parseCalibrationCorpus(body).stats;
      const after = new FindingConfidenceArbiter({ ruleCalibrationStats: stats }).arbitrateFinding(
        finding(),
      );
      assert.strictEqual(after.confidenceSource, 'calibrated');
      assert.ok(
        after.confidence < before.confidence,
        `a single false positive must lower confidence: ${after.confidence} < ${before.confidence}`,
      );
      console.log(
        `  ✔ verdict recorded, corpus written, arbiter ${before.confidence} -> ${after.confidence}.`,
      );
    } finally {
      dir.cleanup();
    }
  }

  /** Stage 2: re-running the same review must not double the evidence. */
  function verifyIdempotentRerun() {
    console.log('\n2. Verifying a repeated review does not inflate the evidence...');
    const dir = scratch();
    try {
      fs.writeFileSync(dir.queue, `${queueLine()}\n${queueLine({ line: 20 })}\n`);
      assert.strictEqual(run(dir, 'false-positive').code, 0);
      const first = JSON.parse(fs.readFileSync(dir.corpus, 'utf8'));
      const second = run(dir, 'false-positive');
      assert.strictEqual(second.code, 0);
      assert.ok(second.text.includes('Nothing to record'), second.text);
      const after = JSON.parse(fs.readFileSync(dir.corpus, 'utf8'));
      assert.deepStrictEqual(after, first, 'a second run must leave the corpus byte-identical');
      const ledgerBody = JSON.parse(fs.readFileSync(dir.ledger, 'utf8'));
      assert.strictEqual(ledgerBody.verdicts.length, 2);
      console.log('  ✔ re-run recorded nothing and left the corpus byte-identical.');
    } finally {
      dir.cleanup();
    }
  }

  /** Stage 3: a corrected verdict must replace the earlier one. */
  function verifyCorrectionReplaces() {
    console.log('\n3. Verifying a corrected verdict replaces rather than accumulates...');
    const dir = scratch();
    try {
      fs.writeFileSync(dir.queue, queueLine() + '\n');
      assert.strictEqual(run(dir, 'false-positive').code, 0);
      const wrong = JSON.parse(fs.readFileSync(dir.corpus, 'utf8'));
      assert.deepStrictEqual(wrong.rules[0], {
        rule: 'hardcoded-string',
        truePositives: 0,
        falsePositives: 1,
      });

      const corrected = run(dir, 'true-positive', ['--rule', 'hardcoded-string']);
      assert.strictEqual(corrected.code, 0, corrected.text);
      const body = JSON.parse(fs.readFileSync(dir.corpus, 'utf8'));
      assert.deepStrictEqual(body.rules[0], {
        rule: 'hardcoded-string',
        truePositives: 1,
        falsePositives: 0,
      });
      console.log('  ✔ correction flipped the count instead of adding to it.');
    } finally {
      dir.cleanup();
    }
  }

  /** Stage 4: unusable input must be refused, not partially applied. */
  function verifyMalformedInputRefused() {
    console.log('\n4. Verifying unusable input is refused rather than partially applied...');
    const dir = scratch();
    try {
      fs.writeFileSync(dir.queue, queueLine() + '\n');
      fs.writeFileSync(dir.ledger, '{ not json');
      const badLedger = run(dir, 'false-positive');
      assert.strictEqual(badLedger.code, 1, badLedger.text);
      assert.ok(!fs.existsSync(dir.corpus), 'a refused run must not write a corpus');

      fs.unlinkSync(dir.ledger);
      fs.writeFileSync(
        dir.ledger,
        JSON.stringify({
          schema: ledger.REVIEW_VERDICT_LEDGER_SCHEMA,
          verdicts: [{ rule: 42 }],
        }),
      );
      const badEntry = run(dir, 'false-positive');
      assert.strictEqual(badEntry.code, 1, badEntry.text);
      assert.ok(badEntry.text.includes('unusable'), badEntry.text);

      fs.unlinkSync(dir.ledger);
      fs.unlinkSync(dir.queue);
      const absent = run(dir, 'false-positive');
      assert.strictEqual(absent.code, 1);
      assert.ok(absent.text.includes('not found'), absent.text);
      console.log('  ✔ unreadable ledger, bad entry and missing queue are all refused.');
    } finally {
      dir.cleanup();
    }
  }

  /** Stage 5: usage errors and the empty-queue case must be distinguishable. */
  function verifyUsageAndEmpty() {
    console.log('\n5. Verifying usage errors are separate from an empty queue...');
    const dir = scratch();
    try {
      assert.strictEqual(reviewCommand([]).code, 2);
      assert.strictEqual(reviewCommand(['--queue', dir.queue]).code, 2);
      assert.strictEqual(
        reviewCommand(['--queue', dir.queue, '--corpus', dir.corpus, '--verdict', 'maybe']).code,
        2,
      );
      fs.writeFileSync(dir.queue, '');
      const empty = run(dir, 'false-positive');
      assert.strictEqual(empty.code, 0, empty.text);
      assert.ok(empty.text.includes('Nothing to record'), empty.text);
      console.log('  ✔ usage errors exit distinct from an empty queue, which writes nothing.');
    } finally {
      dir.cleanup();
    }
  }

  /** Stage 6: the intake and ledger vocabularies must stay closed. */
  function verifyVocabulary() {
    console.log('\n6. Verifying the vocabulary stays inside its declared union...');
    const kinds = new Set([ledger.VERDICT_TRUE_POSITIVE, ledger.VERDICT_FALSE_POSITIVE]);
    assert.strictEqual(kinds.size, 2);
    assert.notStrictEqual(ledger.VERDICT_TRUE_POSITIVE, ledger.VERDICT_FALSE_POSITIVE);
    assert.ok(intake.occurrenceKey({ rule: 'r', file: 'f', line: 1 }).includes('\u0000'));
    console.log('  ✔ two distinct verdicts, and one occurrence identity shape.');
  }

  /** Stage 7: one answer must not cover unrelated rules, and a dry run writes nothing. */
  function verifyCrossRuleGuardAndDryRun() {
    console.log('\n7. Verifying a cross-rule batch is refused and a dry run writes nothing...');
    const dir = scratch();
    try {
      const three = [
        queueLine({ rule: 'large-file', file: 'a.ts', line: 1 }),
        queueLine({ rule: 'hardcoded-string', file: 'b.ts', line: 5 }),
        queueLine({ rule: 'magic-number', file: 'c.ts', line: 9 }),
      ].join('\n');
      fs.writeFileSync(dir.queue, three + '\n');

      const refused = run(dir, 'false-positive');
      assert.strictEqual(refused.code, 2, refused.text);
      assert.ok(refused.text.includes('distinct rules'), refused.text);
      assert.ok(!fs.existsSync(dir.corpus), 'a refused batch must not write a corpus');
      assert.ok(!fs.existsSync(dir.ledger), 'a refused batch must not write a ledger');

      const preview = run(dir, 'false-positive', ['--any-rule', '--dry-run']);
      assert.strictEqual(preview.code, 0, preview.text);
      assert.ok(preview.text.includes('Nothing was written'), preview.text);
      assert.ok(!fs.existsSync(dir.corpus), 'a dry run must not write a corpus');
      assert.ok(!fs.existsSync(dir.ledger), 'a dry run must not write a ledger');

      const narrowed = run(dir, 'false-positive', ['--rule', 'magic-number', '--dry-run']);
      assert.strictEqual(narrowed.code, 0, narrowed.text);
      assert.ok(narrowed.text.includes('1 verdict'), narrowed.text);
      assert.ok(
        narrowed.text.includes('queued record(s) would still need a decision'),
        narrowed.text,
      );

      const committed = run(dir, 'false-positive', ['--rule', 'magic-number']);
      assert.strictEqual(committed.code, 0, committed.text);
      const body = JSON.parse(fs.readFileSync(dir.corpus, 'utf8'));
      assert.deepStrictEqual(body.rules, [
        { rule: 'magic-number', truePositives: 0, falsePositives: 1 },
      ]);
      console.log(
        '  ✔ cross-rule batch refused, flagged batch allowed, dry run silent, narrow run recorded.',
      );
    } finally {
      dir.cleanup();
    }
  }

  verifyVerdictReachesArbiter();
  verifyIdempotentRerun();
  verifyCorrectionReplaces();
  verifyMalformedInputRefused();
  verifyUsageAndEmpty();
  verifyVocabulary();
  verifyCrossRuleGuardAndDryRun();
}

module.exports = { runReviewLoopVerifications };
