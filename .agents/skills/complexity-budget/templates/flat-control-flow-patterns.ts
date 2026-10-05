/**
 * Control Flow Flattening Patterns & Guard Clauses Guide
 *
 * Demonstrates standard patterns to eliminate deep nesting (Depth <= 4)
 * and high cyclomatic complexity (CC <= 15).
 */

export interface ValidationContext {
    readonly isReady: boolean;
    readonly payload?: Record<string, unknown>;
    readonly error?: string;
}

// -----------------------------------------------------------------------------
// Pattern 1: Guard Clauses for Validation (Early Return)
// -----------------------------------------------------------------------------

// Before (Anti-pattern): Depth = 4, CC = 6
export function processPayloadDeep(ctx: ValidationContext): boolean {
    if (ctx.isReady) {
        if (ctx.payload) {
            if (typeof ctx.payload.action === 'string') {
                if (ctx.payload.action.length > 0) {
                    return true;
                }
            }
        }
    }
    return false;
}

// After (Refactored): Depth = 1, CC = 3
export function processPayloadFlat(ctx: ValidationContext): boolean {
    if (!ctx.isReady || !ctx.payload) {
        return false;
    }
    const action = ctx.payload.action;
    return typeof action === 'string' && action.length > 0;
}

// -----------------------------------------------------------------------------
// Pattern 2: Strategy Dispatch Map (Eliminating Giant Switch/If-Else)
// -----------------------------------------------------------------------------

type HandlerFn = (data: unknown) => void;

const ACTION_HANDLERS: Readonly<Record<string, HandlerFn>> = Object.freeze({
    INIT: (d) => { /* handle init */ },
    START: (d) => { /* handle start */ },
    PAUSE: (d) => { /* handle pause */ },
    STOP: (d) => { /* handle stop */ },
    RESET: (d) => { /* handle reset */ },
});

export function dispatchActionFlat(actionType: string, data: unknown): void {
    const handler = ACTION_HANDLERS[actionType];
    if (handler) {
        handler(data);
    }
}
