import { stepAlpha } from './cycle-a';

/**
 * Completes mutually recursive cycle B -> A.
 *
 * @param depth - Remaining depth budget.
 * @returns Step result.
 */
export function stepBeta(depth: number): number {
    if (depth <= 0) {
        return 1;
    }
    return stepAlpha(depth - 1) + 2;
}
