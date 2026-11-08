/**
 * Module: Analyzer Template — Sparse MoE Pooled & Tape-Gated Analyzer
 * File Path: .agents/skills/sparse-moe-and-ast-routing/templates/moe-pooled-analyzer-template.ts
 * Architecture Role: Reference scaffold for a Stage 2/3 built-in analyzer implementing
 *   LineFeatureTape O(1) pre-gating, WeakMap option caching, lazy ctx.sourceFile evaluation,
 *   and zero-allocation resetState() pooling.
 * Dependencies & Triggers: Consumed as a JIT template when authoring or refactoring analyzers
 *   under auto-refactor/src/analyzers/.
 * Responsibilities:
 *   1. Pre-screen raw text via fast substring triggers before line iteration;
 *   2. Gate per-line inspection using LineFeatureTape bitflags (LINE_FLAG_HAS_CALL_PAREN);
 *   3. Cache compiled configuration patterns in a WeakMap keyed on the options object;
 *   4. Implement resetState() for AnalyzerPool reuse and access ctx.sourceFile lazily.
 * Design Rationale: Eliminates per-file regex compilation and eager TypeScript AST parsing
 *   on files that contain no candidate tokens, keeping hot-path scan latency sub-millisecond.
 */

export interface TapeSampleContext {
    readonly filePath: string;
    readonly rawText: string;
    readonly lines: readonly string[];
    readonly lineFlags: Uint32Array;
    readonly options?: Readonly<Record<string, unknown>>;
    readonly sourceFile?: unknown;
}

export interface TapeSampleFinding {
    readonly ruleId: string;
    readonly line: number;
    readonly message: string;
}

const LINE_FLAG_HAS_CALL_PAREN = 1 << 6;
const FAST_TRIGGER_TOKEN = 'dispatchEvent(';
const PATTERN_CACHE = new WeakMap<object, RegExp>();
const DEFAULT_CALL_RE = /\bdispatchEvent\s*\(\s*['"`]\s*['"`]\s*\)/;

/**
 * Resolves a cached RegExp for the given analyzer options object.
 *
 * @param options - Optional analyzer configuration object.
 * @returns Precompiled regular expression.
 */
function resolveMatcher(options?: Readonly<Record<string, unknown>>): RegExp {
    if (!options) {
        return DEFAULT_CALL_RE;
    }
    const cached = PATTERN_CACHE.get(options);
    if (cached) {
        return cached;
    }
    PATTERN_CACHE.set(options, DEFAULT_CALL_RE);
    return DEFAULT_CALL_RE;
}

/**
 * Reference pooled analyzer demonstrating Sparse MoE internal gating invariants.
 */
export class MoePooledSampleAnalyzer {
    private readonly findingsBuffer: TapeSampleFinding[] = [];

    /**
     * Resets per-file mutable state in place for AnalyzerPool reuse.
     */
    public resetState(): void {
        this.findingsBuffer.length = 0;
    }

    /**
     * Analyzes a single file using fast trigger and LineFeatureTape gating.
     *
     * @param ctx - Scan context with precomputed line feature flags.
     * @returns Array of detected findings.
     */
    public analyze(ctx: TapeSampleContext): readonly TapeSampleFinding[] {
        this.resetState();
        if (!ctx.rawText.includes(FAST_TRIGGER_TOKEN)) {
            return this.findingsBuffer;
        }
        const matcher = resolveMatcher(ctx.options);
        const lineCount = ctx.lines.length;
        for (let i = 0; i < lineCount; i += 1) {
            if ((ctx.lineFlags[i] & LINE_FLAG_HAS_CALL_PAREN) === 0) {
                continue;
            }
            if (matcher.test(ctx.lines[i])) {
                this.findingsBuffer.push({
                    ruleId: 'ARCH-FAC-001',
                    line: i + 1,
                    message: 'Empty event name in dispatchEvent call.',
                });
            }
        }
        return this.findingsBuffer;
    }
}
