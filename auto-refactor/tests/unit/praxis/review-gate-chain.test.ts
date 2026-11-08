/**
 * Module: Praxis review-to-merge regression tests
 * File Path: tests/unit/praxis/review-gate-chain.test.ts
 * Architecture Role: Verify verdicts through the public review and gate path.
 * Dependencies & Triggers: Vitest, PraxisReviewClient, and the production default gatekeeper.
 * Responsibilities: Preserve hunk decisions and reject incomplete or blocked reviews.
 * Exit Semantics & Design Rationale: Tests exercise production defaults rather than a mock approval.
 */
import { describe, expect, it } from 'vitest';
import { PraxisReviewClient } from '../../../src/core/praxis/praxis-review-client';
import { DefaultPraxisRollbackGatekeeper } from '../../../src/core/praxis/defaults';

function client(): PraxisReviewClient {
    return new PraxisReviewClient({ includeDualFacedPresentation: false });
}

describe('Praxis review-to-merge decision chain', () => {
    it('retains hunk decisions and blocks a major change', async () => {
        const sdk = client();
        const content = Array.from({ length: 120 }, (_, i) => `export const item${i} = ${i};`).join(
            '\n',
        );
        const review = await sdk.reviewDiff({
            filePath: 'src/quality-example.ts',
            oldContent: '',
            newContent: content,
        });
        expect(review.verdict.status).toBe('major_rework_needed');
        expect(review.hunks.length).toBeGreaterThan(0);
        expect(review.hunks.every((hunk) => hunk.reviewVerdict !== undefined)).toBe(true);
        const gate = await sdk.evaluateMergeGate('feature', 'main', review.hunks);
        expect(gate.approved).toBe(false);
        expect(gate.status).toBe('major_rework_needed');
    });

    it('does not turn an empty legacy review into authority to merge', async () => {
        const gate = await client().evaluateMergeGate('feature', 'main', []);
        expect(gate.approved).toBe(false);
        expect(gate.violations.length).toBeGreaterThan(0);
    });

    it('defaults to an unavailable gate without a configured review backend', () => {
        const gate = new DefaultPraxisRollbackGatekeeper().checkMergeGate('feature', 'main', []);
        expect(gate.approved).toBe(false);
        expect(gate.reason).toMatch(/unsupported|unavailable|not configured/i);
    });

    it('does not report that an unsupported hunk rollback succeeded', () => {
        const rollback = new DefaultPraxisRollbackGatekeeper().revertDiffHunk('file.ts', 'hunk');
        expect(rollback.success).toBe(false);
    });

    it('rejects task rollback when no checkpoint backend exists', () => {
        expect(() => new DefaultPraxisRollbackGatekeeper().revertTaskCard('card')).toThrow(
            /unsupported|unavailable|not configured/i,
        );
    });
});
