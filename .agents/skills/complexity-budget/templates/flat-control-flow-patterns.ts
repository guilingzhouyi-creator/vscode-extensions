/**
 * Control Flow Flattening Patterns & Guard Clauses Guide
 *
 * Demonstrates standard patterns to eliminate deep nesting (Depth <= 4),
 * excessive cyclomatic complexity (CC <= 15), and transient heap allocations
 * in loops (CPX-SPACE-001).
 */

export interface ValidationContext {
    readonly isReady: boolean;
    readonly payload?: Record<string, unknown>;
    readonly error?: string;
}

export interface TrajectoryStep {
    readonly stepIndex: number;
    readonly type: string;
    readonly content: string;
}

// -----------------------------------------------------------------------------
// Pattern 1: Guard Clauses for Validation (Early Return)
// -----------------------------------------------------------------------------

// ❌ Anti-pattern: Depth = 4, CC = 6
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

// ✅ Refactored: Depth = 1, CC = 3
export function processPayloadFlat(ctx: ValidationContext): boolean {
    if (!ctx.isReady || !ctx.payload) {
        return false;
    }
    const action = ctx.payload.action;
    return typeof action === 'string' && action.length > 0;
}

// -----------------------------------------------------------------------------
// Pattern 2: Stream/Log Parsing Decoupling (Trajectory Record Pattern)
// -----------------------------------------------------------------------------

// Helper parser isolated as a pure function: Depth <= 2, CC <= 4
function parseTrajectoryStep(rawLine: string): TrajectoryStep | null {
    const trimmed = rawLine.trim();
    if (!trimmed || !trimmed.startsWith('{')) {
        return null;
    }

    try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (typeof parsed.step_index !== 'number' || typeof parsed.type !== 'string') {
            return null;
        }
        return {
            stepIndex: parsed.step_index,
            type: parsed.type,
            content: typeof parsed.content === 'string' ? parsed.content : '',
        };
    } catch {
        return null;
    }
}

// Main stream consumer: flat loop with early continue, Depth <= 2, CC <= 3
export function consumeTrajectoryStream(lines: readonly string[]): TrajectoryStep[] {
    const steps: TrajectoryStep[] = [];
    for (const line of lines) {
        const step = parseTrajectoryStep(line);
        if (!step) {
            continue;
        }
        steps.push(step);
    }
    return steps;
}

// -----------------------------------------------------------------------------
// Pattern 3: Strategy Dispatch Map (Eliminating Giant Switch/If-Else)
// -----------------------------------------------------------------------------

type HandlerFn = (data: unknown) => void;

const ACTION_HANDLERS: Readonly<Record<string, HandlerFn>> = Object.freeze({
    INIT: (_d: unknown): void => { /* handle init */ },
    START: (_d: unknown): void => { /* handle start */ },
    PAUSE: (_d: unknown): void => { /* handle pause */ },
    STOP: (_d: unknown): void => { /* handle stop */ },
    RESET: (_d: unknown): void => { /* handle reset */ },
});

export function dispatchActionFlat(actionType: string, data: unknown): void {
    const handler = ACTION_HANDLERS[actionType];
    if (handler) {
        handler(data);
    }
}

// -----------------------------------------------------------------------------
// Pattern 4: Buffer Collection vs String Concatenation in Loops (CPX-SPACE-001)
// -----------------------------------------------------------------------------

// ❌ Anti-pattern: Repeated string allocation += inside high-frequency loop
export function formatStepsAntiPattern(steps: readonly TrajectoryStep[]): string {
    let out = '';
    for (const step of steps) {
        out += `[${step.stepIndex}] ${step.type}: ${step.content}\n`;
    }
    return out;
}

// ✅ Refactored: Pre-sized line buffer array push and join, zero string fragmentation
export function formatStepsBuffer(steps: readonly TrajectoryStep[]): string {
    const lines: string[] = new Array(steps.length);
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        lines[i] = `[${step.stepIndex}] ${step.type}: ${step.content}`;
    }
    return lines.join('\n');
}
