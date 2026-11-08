/**
 * Module: Review — File Analyzer Execution Observation
 * File Path: src/core/review/analyzer-execution.ts
 * Architecture Role: Observe existing parser and analyzer calls without a second registry.
 * Dependencies & Triggers: Resolved analyzer plan and the scanner's streaming hook contract.
 * Responsibilities: Preserve real calls, failures, routing skips, and parser uncertainty.
 * Exit Semantics & Design Rationale: These execution facts carry no gate or issuer authority.
 */
import type { ResolvedAnalyzer } from '../analyzer-registry';
import type { StreamingEntry, StreamingVisitHook } from '../ast/traverse';
import type { LanguageAdapter, NormalizedAst, NodeProjector } from '../ast/multilang';

/** Recorded parser adapter invocation state and diagnostic precision for one file. */
export interface ParserExecutionObservation {
    readonly adapter: string;
    readonly precision: 'ast' | 'lexical' | 'unspecified';
    readonly status: 'complete' | 'degraded' | 'unavailable' | 'unsupported';
    readonly diagnostics: number | null;
}
/** Observed execution outcome for a single analyzer against one file. */
export interface AnalyzerExecutionObservation {
    readonly analyzer: string;
    readonly version: number | null;
    readonly status: 'complete' | 'partial' | 'failed' | 'not-run';
    readonly calls: number;
    readonly reason?: string;
    readonly failure?: string;
}
/** Aggregated parser and per-analyzer execution observations for one scanned file. */
export interface FileExecutionObservation {
    readonly path: string;
    readonly parser: ParserExecutionObservation;
    readonly lineBounds?: readonly [number, number];
    readonly analyzers: readonly AnalyzerExecutionObservation[];
}
interface AnalyzerCalls {
    analyzer: string;
    version: number | null;
    calls: number;
    reason?: string;
    failure?: string;
}

function failureMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function observedHook(
    hook: StreamingVisitHook | undefined,
    analyzer: StreamingEntry['analyzer'],
    calls: AnalyzerCalls,
): StreamingVisitHook | undefined {
    if (!hook) return undefined;
    return (node, ctx, parent, grandparent, depth, className, binding) => {
        calls.calls++;
        try {
            hook.call(analyzer, node, ctx, parent, grandparent, depth, className, binding);
        } catch (error) {
            calls.failure ??= failureMessage(error);
            throw error;
        }
    };
}

/** One file's optional recorder; normal scans retain their original analyzer instances. */
export class FileExecutionObserver {
    private readonly calls = new Map<string, AnalyzerCalls>();

    constructor(
        private readonly file: string,
        plan: readonly ResolvedAnalyzer[],
        private readonly scope: {
            activeAnalyzers?: ReadonlySet<string>;
            lineBounds?: readonly [number, number];
        } = {},
    ) {
        for (const item of plan) {
            this.calls.set(item.name, {
                analyzer: item.name, version: item.instance.version ?? null,
                calls: 0,
                reason: scope.activeAnalyzers && !scope.activeAnalyzers.has(item.name)
                    ? 'routing-filter' : 'not-invoked',
            });
        }
    }

    skip(name: string, reason: string): void {
        const calls = this.calls.get(name);
        if (calls && calls.calls === 0) calls.reason = reason;
    }

    begin(name: string): void {
        const calls = this.calls.get(name);
        if (calls) calls.calls++;
    }

    fail(name: string, error: unknown): void {
        const calls = this.calls.get(name);
        if (calls) calls.failure ??= failureMessage(error);
    }

    /** Wrap each entry once; hook calls allocate no argument arrays or event objects. */
    streaming(name: string, analyzer: StreamingEntry['analyzer']): StreamingEntry['analyzer'] {
        const calls = this.calls.get(name);
        if (!calls) throw new Error(`Unregistered execution observation: ${name}`);
        const finalize = analyzer.finalize;
        return {
            name: analyzer.name,
            exemptFromPruning: analyzer.exemptFromPruning,
            visit: observedHook(analyzer.visit, analyzer, calls),
            leave: observedHook(analyzer.leave, analyzer, calls),
            finalize: !finalize ? undefined : (ctx) => {
                calls.calls++;
                try {
                    return finalize.call(analyzer, ctx);
                } catch (error) {
                    calls.failure ??= failureMessage(error);
                    throw error;
                }
            },
        };
    }

    private resolveParserStatus(
        adapter: LanguageAdapter,
        diagnostics: readonly unknown[] | undefined,
        supported: boolean,
    ): ParserExecutionObservation['status'] {
        if (!supported) return 'unsupported';
        if (adapter.precision === 'lexical') return 'degraded';
        if (adapter.precision === 'ast' && diagnostics) {
            return diagnostics.length === 0 ? 'complete' : 'degraded';
        }
        return 'unavailable';
    }

    /** Freeze completed observations after all streaming/batch calls and any parser fallback. */
    finish(
        adapter: LanguageAdapter,
        parsed: NormalizedAst | NodeProjector,
        supported: boolean,
    ): FileExecutionObservation {
        const native = parsed.sourceFile as { parseDiagnostics?: readonly unknown[] } | undefined;
        const candidate = parsed.parseDiagnostics ?? native?.parseDiagnostics;
        const diagnostics = Array.isArray(candidate) ? candidate : undefined;
        const status = this.resolveParserStatus(adapter, diagnostics, supported);
        const parser: ParserExecutionObservation = Object.freeze({
            adapter: adapter.id,
            precision: adapter.precision ?? 'unspecified',
            status,
            diagnostics: diagnostics?.length ?? null,
        });
        const analyzers: AnalyzerExecutionObservation[] = [];
        for (const calls of this.calls.values()) analyzers.push(this.finishAnalyzer(calls, parser));
        const bounds = this.scope.lineBounds;
        return Object.freeze({
            path: this.file,
            parser,
            analyzers: Object.freeze(analyzers),
            ...(bounds ? { lineBounds: Object.freeze([bounds[0], bounds[1]] as const) } : {}),
        });
    }

    private finishAnalyzer(
        calls: AnalyzerCalls,
        parser: ParserExecutionObservation,
    ): AnalyzerExecutionObservation {
        if (calls.failure !== undefined) {
            return Object.freeze({ ...calls, status: 'failed', reason: 'analyzer-exception' });
        }
        if (calls.calls === 0) return Object.freeze({ ...calls, status: 'not-run' });
        const complete = parser.status === 'complete' && !this.scope.lineBounds;
        const reason = parser.status === 'complete' ? 'line-window' : `parser-${parser.status}`;
        return Object.freeze({
            analyzer: calls.analyzer, version: calls.version, calls: calls.calls,
            status: complete ? 'complete' : 'partial',
            ...(complete ? {} : { reason }),
        });
    }
}
