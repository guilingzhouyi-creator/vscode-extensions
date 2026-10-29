/**
 * Review Queue Intake — Unit Contract
 *
 * Guards the read-back arm. The failing implementation this suite is written against is the one
 * that parses the file into rich objects and then answers "yes" to everything, so the assertions
 * focus on the pairing being total and on already-judged occurrences being skipped.
 */

import { describe, expect, it } from 'vitest';
import {
    judgedKeys,
    occurrenceKey,
    parseReviewQueueBody,
    toVerdictRecords,
    unjudged,
} from '../../../src/core/reporting/review-queue-intake';
import {
    VERDICT_FALSE_POSITIVE,
    VERDICT_TRUE_POSITIVE,
    type ReviewVerdictRecord,
} from '../../../src/core/scoring/review-verdict-ledger';

/**
 * Builds one NDJSON queue line.
 *
 * @param overrides - Fields to override.
 * @returns Single-line JSON string.
 */
function line(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        category: 'needs-human',
        rule: 'hardcoded-string',
        analyzer: 'constants',
        file: 'src/a.ts',
        line: 10,
        severity: 'warning',
        tier: 'advisory',
        conf: 0.4,
        calibrationSampleSize: 0,
        requiresRuntime: true,
        rationale: 'no automated tier could settle it',
        ...overrides,
    });
}

/**
 * Builds a recorded verdict.
 *
 * @param overrides - Fields to override.
 * @returns Ledger record.
 */
function recorded(overrides: Partial<ReviewVerdictRecord> = {}): ReviewVerdictRecord {
    return {
        rule: 'hardcoded-string',
        file: 'src/a.ts',
        line: 10,
        verdict: VERDICT_FALSE_POSITIVE,
        at: 1000,
        ...overrides,
    };
}

describe('review queue intake', () => {
    it('parses a queue written by the exporter', () => {
        const result = parseReviewQueueBody(line() + '\n');
        expect(result.rejections).toEqual([]);
        expect(result.occurrences).toEqual([
            { rule: 'hardcoded-string', file: 'src/a.ts', line: 10 },
        ]);
    });

    it('skips blank lines instead of calling them defects', () => {
        const result = parseReviewQueueBody(`${line()}\n\n${line({ line: 20 })}\n\n`);
        expect(result.rejections).toEqual([]);
        expect(result.occurrences).toHaveLength(2);
    });

    it('reads an empty body as an empty queue', () => {
        expect(parseReviewQueueBody('')).toEqual({ occurrences: [], rejections: [] });
    });

    it('rejects a line that is not valid JSON', () => {
        const result = parseReviewQueueBody('{not json\n');
        expect(result.occurrences).toEqual([]);
        expect(result.rejections[0]).toContain('not valid JSON');
    });

    it('rejects a line missing the fields an answer needs', () => {
        const result = parseReviewQueueBody(
            [
                line({ rule: '' }),
                line({ file: '' }),
                line({ line: 0 }),
                line({ line: 2.5 }),
                line({ line: '10' }),
                JSON.stringify(['not', 'an', 'object']),
            ].join('\n'),
        );
        expect(result.occurrences).toEqual([]);
        expect(result.rejections).toHaveLength(6);
    });

    it('tolerates a record from an older exporter that lacks advisory fields', () => {
        const minimal = JSON.stringify({ rule: 'magic-number', file: 'src/b.ts', line: 3 });
        const result = parseReviewQueueBody(minimal);
        expect(result.occurrences).toEqual([{ rule: 'magic-number', file: 'src/b.ts', line: 3 }]);
    });

    it('normalizes backslashes so one file keeps one identity', () => {
        const windows = JSON.stringify({ rule: 'r', file: 'src\\a.ts', line: 1 });
        const posix = JSON.stringify({ rule: 'r', file: 'src/a.ts', line: 1 });
        expect(parseReviewQueueBody(windows).occurrences[0].file).toBe('src/a.ts');
        expect(occurrenceKey(parseReviewQueueBody(windows).occurrences[0])).toBe(
            occurrenceKey(parseReviewQueueBody(posix).occurrences[0]),
        );
    });

    it('pairs every occurrence with the answer it was given', () => {
        const { occurrences } = parseReviewQueueBody(
            `${line()}\n${line({ line: 20 })}\n`,
        );
        const records = toVerdictRecords(occurrences, VERDICT_TRUE_POSITIVE, 5000);
        expect(records).toHaveLength(2);
        expect(records.every((record) => record.verdict === VERDICT_TRUE_POSITIVE)).toBe(true);
        expect(records.every((record) => record.at === 5000)).toBe(true);
        expect(records.map((record) => record.line)).toEqual([10, 20]);
    });

    it('produces no records for an empty queue, so an empty run writes nothing', () => {
        expect(toVerdictRecords([], VERDICT_FALSE_POSITIVE, 1)).toEqual([]);
    });

    it('identifies occurrences that already carry a verdict', () => {
        const { occurrences } = parseReviewQueueBody(`${line()}\n${line({ line: 20 })}\n`);
        const judged = judgedKeys(occurrences, [recorded()]);
        expect(judged.size).toBe(1);
        expect(judged.has(occurrenceKey({ rule: 'hardcoded-string', file: 'src/a.ts', line: 10 })))
            .toBe(true);
    });

    it('returns only the unjudged occurrences, in queue order', () => {
        const { occurrences } = parseReviewQueueBody(
            `${line({ line: 10 })}\n${line({ line: 20 })}\n${line({ line: 30 })}\n`,
        );
        const pending = unjudged(occurrences, [recorded({ line: 20 })]);
        expect(pending.map((occurrence) => occurrence.line)).toEqual([10, 30]);
    });

    it('treats a verdict on a different rule as unrelated', () => {
        const { occurrences } = parseReviewQueueBody(line());
        expect(unjudged(occurrences, [recorded({ rule: 'magic-number' })])).toHaveLength(1);
    });

    it('leaves an unjudged queue untouched when the ledger is empty', () => {
        const { occurrences } = parseReviewQueueBody(`${line()}\n`);
        expect(unjudged(occurrences, [])).toEqual(occurrences);
    });
});
