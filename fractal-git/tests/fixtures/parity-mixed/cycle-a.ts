import { stepBeta } from './cycle-b';

/**
 * Starts mutually recursive cycle A -> B.
 *
 * @param depth - Remaining depth budget.
 * @returns Step result.
 */
export function stepAlpha(depth: number): number {
    if (depth <= 0) {
        return 0;
    }
    return stepBeta(depth - 1) + 1;
}
