/**
 * Review Verdict Ledger — Unit Contract
 *
 * Guards the write-back arm of the adjudication loop. Every property asserted here has a plausible
 * wrong implementation that leaves the posterior looking healthy: an incrementing writer that
 * double-counts a re-run, a line-keyed identity that splits one defect on every re-scan, an
 * unvalidated reader that turns a typo into a fabricated observation.
 */

import { describe, expect, it } from 'vitest';
import {
    REVIEW_VERDICT_LEDGER_SCHEMA,
    VERDICT_FALSE_POSITIVE,
    VERDICT_TRUE_POSITIVE,
    aggregateVerdicts,
    coveredRules,
    parseReviewVerdictLedger,
    serializeCorpus,
    type ReviewVerdictRecord,
} from '../../../src/core/scoring/review-verdict-ledger';

/**
 * Builds a ledger entry with a deterministic identity.
 *
 * @param overrides - Fields to override.
 * @returns Ledger entry record.
 */
function entry(overrides: Partial<ReviewVerdictRecord> = {}): ReviewVerdictRecord {
    return {
        rule: 'hardcoded-string',
        file: 'src/a.ts',
        line: 10,
        verdict: VERDICT_FALSE_POSITIVE,
        at: 1000,
        ...overrides,
    };
}

/**
 * Wraps entries in a ledger document.
 *
 * @param verdicts - Entries to wrap.
 * @param schema - Schema tag to declare.
 * @returns Ledger document.
 */
function ledger(verdicts: unknown[], schema: unknown = REVIEW_VERDICT_LEDGER_SCHEMA): unknown {
    return { schema, verdicts };
}

describe('review verdict ledger', () => {
    it('accepts a well-formed ledger', () => {
        const parsed = parseReviewVerdictLedger(ledger([entry()]));
        expect(parsed.rejections).toEqual([]);
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0].verdict).toBe(VERDICT_FALSE_POSITIVE);
    });

    it('tolerates a missing schema tag and an empty verdicts field', () => {
        expect(parseReviewVerdictLedger({ verdicts: [entry()] }).records).toHaveLength(1);
        expect(parseReviewVerdictLedger({ schema: REVIEW_VERDICT_LEDGER_SCHEMA }).records).toEqual(
            [],
        );
    });

    it('rejects a foreign schema tag outright', () => {
        const parsed = parseReviewVerdictLedger(ledger([entry()], 'other/v9'));
        expect(parsed.records).toEqual([]);
        expect(parsed.rejections[0]).toContain('schema tag');
    });

    it('rejects a non-object root and a non-array verdicts field', () => {
        expect(parseReviewVerdictLedger(null).rejections[0]).toContain('not an object');
        expect(parseReviewVerdictLedger({ verdicts: {} }).rejections[0]).toContain('not an array');
    });

    it('rejects every malformed field instead of coercing it', () => {
        const parsed = parseReviewVerdictLedger(
            ledger([
                { ...entry(), rule: '' },
                { ...entry(), file: '' },
                { ...entry(), line: 0 },
                { ...entry(), line: 1.5 },
                { ...entry(), line: '10' },
                { ...entry(), verdict: 'maybe' },
                { ...entry(), at: Number.NaN },
                { ...entry(), at: -1 },
                'not-an-object',
            ]),
        );
        expect(parsed.records).toEqual([]);
        expect(parsed.rejections).toHaveLength(9);
    });

    it('keeps exactly one verdict per occurrence when a reviewer corrects a decision', () => {
        const parsed = parseReviewVerdictLedger(
            ledger([
                entry({ verdict: VERDICT_FALSE_POSITIVE, at: 1000 }),
                entry({ verdict: VERDICT_TRUE_POSITIVE, at: 2000 }),
            ]),
        );
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0].verdict).toBe(VERDICT_TRUE_POSITIVE);
    });

    it('lets a hand-appended correction win when timestamps tie', () => {
        const parsed = parseReviewVerdictLedger(
            ledger([
                entry({ verdict: VERDICT_FALSE_POSITIVE, at: 1000 }),
                entry({ verdict: VERDICT_TRUE_POSITIVE, at: 1000 }),
            ]),
        );
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0].verdict).toBe(VERDICT_TRUE_POSITIVE);
    });

    it('treats the same rule on a different line as a separate occurrence', () => {
        const parsed = parseReviewVerdictLedger(
            ledger([entry({ line: 10 }), entry({ line: 20 })]),
        );
        expect(parsed.records).toHaveLength(2);
    });

    it('normalizes backslashes so one file cannot produce two identities', () => {
        const parsed = parseReviewVerdictLedger(
            ledger([
                entry({ file: 'src\\a.ts', at: 1000 }),
                entry({ file: 'src/a.ts', at: 2000, verdict: VERDICT_TRUE_POSITIVE }),
            ]),
        );
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0].file).toBe('src/a.ts');
    });

    it('aggregates occurrences, not reviewer actions', () => {
        const stats = aggregateVerdicts([
            entry({ line: 10, verdict: VERDICT_FALSE_POSITIVE }),
            entry({ line: 20, verdict: VERDICT_FALSE_POSITIVE }),
            entry({ rule: 'high-complexity', verdict: VERDICT_TRUE_POSITIVE }),
        ]);
        expect(stats).toEqual([
            { rule: 'hardcoded-string', truePositives: 0, falsePositives: 2 },
            { rule: 'high-complexity', truePositives: 1, falsePositives: 0 },
        ]);
    });

    it('reports no statistics for an empty ledger', () => {
        expect(aggregateVerdicts([])).toEqual([]);
        expect(coveredRules([])).toEqual([]);
    });

    it('lists covered rules in ascending order regardless of input order', () => {
        const stats = aggregateVerdicts([
            entry({ rule: 'zeta' }),
            entry({ rule: 'alpha' }),
            entry({ rule: 'mid' }),
        ]);
        expect(coveredRules(stats)).toEqual(['alpha', 'mid', 'zeta']);
    });

    it('is idempotent: replaying the same ledger yields identical counts', () => {
        const body = ledger([entry({ line: 10 }), entry({ line: 20 })]);
        const once = aggregateVerdicts(parseReviewVerdictLedger(body).records);
        const twice = aggregateVerdicts(parseReviewVerdictLedger(body).records);
        expect(twice).toEqual(once);
    });

    it('serializes a corpus document the loader can read back verbatim', () => {
        const stats = aggregateVerdicts([entry({ verdict: VERDICT_TRUE_POSITIVE })]);
        const text = serializeCorpus(stats, 'confidence-calibration-corpus/v1');
        expect(text.endsWith('\n')).toBe(true);
        const parsed = JSON.parse(text) as {
            schema: string;
            rules: { rule: string; truePositives: number; falsePositives: number }[];
        };
        expect(parsed.schema).toBe('confidence-calibration-corpus/v1');
        expect(parsed.rules).toEqual([
            { rule: 'hardcoded-string', truePositives: 1, falsePositives: 0 },
        ]);
    });

    it('serializes an empty ledger as an empty rule list, not a missing field', () => {
        const text = serializeCorpus([], 'confidence-calibration-corpus/v1');
        const parsed = JSON.parse(text) as { rules: unknown[] };
        expect(parsed.rules).toEqual([]);
    });
});
