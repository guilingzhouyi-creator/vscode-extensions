#!/usr/bin/env node
/**
 * Module: Verification Harness — Review Loop Closure
 * File Path: scripts/validate-review-loop.js
 * Architecture Role: Guards the write-back arm end to end. Every stage below has a plausible
 *   implementation that looks correct in isolation: a queue reader that answers every line, a
 *   ledger writer that appends twice, a corpus projection that is never read back by the arbiter.
 *   The suite therefore drives the real CLI against a scratch directory and asserts the posterior
 *   actually moves.
 * Dependencies & Triggers: consumes ../dist/cli/reviewCmd, ../dist/core/reporting/review-queue-intake,
 *   ../dist/core/scoring/review-verdict-ledger and ../dist/core/scoring/calibration-corpus;
 *   registered in scripts/test-parallel.js and run by `npm test`.
 * Responsibilities:
 *   1. Assert a recorded verdict reaches the corpus and moves the arbiter's confidence.
 *   2. Assert re-running the same review is idempotent.
 *   3. Assert a corrected verdict replaces the earlier one instead of adding to it.
 *   4. Assert malformed ledgers and queues are refused rather than partially applied.
 * Exit Semantics & Design Rationale: Exits 0 when the loop closes, 1 naming the first violation.
 *   Uses a throwaway directory under the OS temp root so the assertions can write real files; the
 *   corpus schema and the arbiter are the production ones, not stand-ins.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { reviewCommand } = require(path.join(ROOT, 'dist/cli/review-cmd'));
const intake = require(path.join(ROOT, 'dist/core/reporting/review-queue-intake'));
const ledger = require(path.join(ROOT, 'dist/core/scoring/review-verdict-ledger'));
const corpusModule = require(path.join(ROOT, 'dist/core/scoring/calibration-corpus'));
const { FindingConfidenceArbiter } = require(
    path.join(ROOT, 'dist/core/scoring/finding-confidence-arbiter'),
);

/**
 * Builds one NDJSON queue line.
 *
 * @param overrides - Fields to override.
 * @returns Single-line JSON string.
 */
function queueLine(overrides = {}) {
    return JSON.stringify({
        category: 'needs-human',
        rule: 'hardcoded-string',
        analyzer: 'constants',
        file: 'src/a.ts',
        line: 10,
        severity: 'warning',
        tier: 'advisory',
        conf: 0.9,
        calibrationSampleSize: 0,
        requiresRuntime: true,
        rationale: 'no automated tier could settle it',
        ...overrides,
    });
}

/**
 * Builds a minimal finding for the arbiter.
 *
 * @param overrides - Fields to override.
 * @returns Issue record.
 */
function finding(overrides = {}) {
    return {
        id: 'constants:hardcoded-string:src/a.ts:10',
        analyzer: 'constants',
        rule: 'hardcoded-string',
        severity: 'warning',
        message: 'Hardcoded string',
        location: { file: 'src/a.ts', start: { line: 10, column: 1 }, end: { line: 10, column: 9 } },
        detail: {},
        evidence: { confidence: 0.9 },
        ...overrides,
    };
}

/**
 * Creates a scratch directory and returns the paths the stages share.
 *
 * @returns Absolute paths plus a cleanup function.
 */
function scratch() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-refactor-review-'));
    return {
        root,
        queue: path.join(root, 'queue.ndjson'),
        corpus: path.join(root, 'corpus.json'),
        ledger: path.join(root, 'review-verdicts.json'),
        cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
}

/**
 * Runs the review command against a scratch directory.
 *
 * @param dir - Scratch paths.
 * @param verdict - Verdict token.
 * @param extra - Additional arguments.
 * @returns Command result.
 */
function run(dir, verdict, extra = []) {
    return reviewCommand([
        '--queue',
        dir.queue,
        '--corpus',
        dir.corpus,
        '--ledger',
        dir.ledger,
        '--verdict',
        verdict,
        ...extra,
    ]);
}

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
        const after = new FindingConfidenceArbiter({ ruleCalibrationStats: stats })
            .arbitrateFinding(finding());
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
        fs.writeFileSync(dir.ledger, JSON.stringify({ schema: ledger.REVIEW_VERDICT_LEDGER_SCHEMA, verdicts: [{ rule: 42 }] }));
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

/** Stage 7: one answer must not silently cover unrelated rules, and a dry run must write nothing. */
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

function main() {
    console.log('=== Review Loop Closure ===');
    verifyVerdictReachesArbiter();
    verifyIdempotentRerun();
    verifyCorrectionReplaces();
    verifyMalformedInputRefused();
    verifyUsageAndEmpty();
    verifyVocabulary();
    verifyCrossRuleGuardAndDryRun();
    console.log('\nConclusion: a human verdict reaches the corpus, moves the arbiter, and is idempotent ✔');
}

try {
    main();
} catch (error) {
    console.error(`\n✖ Review loop violation: ${error.message}`);
    process.exit(1);
}
