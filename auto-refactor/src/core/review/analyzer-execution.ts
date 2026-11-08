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

const REASON_ROUTING_FILTER = 'routing-filter';
const REASON_NOT_INVOKED = 'not-invoked';
const REASON_ANALYZER_EXCEPTION = 'analyzer-exception';
const REASON_LINE_WINDOW = 'line-window';
const STATUS_COMPLETE = 'complete';
const STATUS_DEGRADED = 'degraded';
const STATUS_UNAVAILABLE = 'unavailable';
const STATUS_UNSUPPORTED = 'unsupported';
const STATUS_PARTIAL = 'partial';
const STATUS_FAILED = 'failed';
const STATUS_NOT_RUN = 'not-run';
const PRECISION_AST = 'ast';
const PRECISION_LEXICAL = 'lexical';
const PRECISION_UNSPECIFIED = 'unspecified';

function formatFailureMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function wrapObservedHook(
    hook: StreamingVisitHook | undefined,
    analyzer: StreamingEntry['analyzer'],
    calls: AnalyzerCalls,
): StreamingVisitHook | undefined {
    if (!hook) return undefined;
    return function (...args: Parameters<StreamingVisitHook>): void {
        calls.calls++;
        try {
            hook.apply(analyzer, args);
        } catch (error) {
            calls.failure ??= formatFailureMessage(error);
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
                analyzer: item.name,
                version: item.instance.version ?? null,
                calls: 0,
                reason:
                    scope.activeAnalyzers && !scope.activeAnalyzers.has(item.name)
                        ? REASON_ROUTING_FILTER
                        : REASON_NOT_INVOKED,
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
        if (calls) calls.failure ??= formatFailureMessage(error);
    }

    /** Wrap each entry once; hook calls allocate no argument arrays or event objects. */
    streaming(name: string, analyzer: StreamingEntry['analyzer']): StreamingEntry['analyzer'] {
        const calls = this.calls.get(name);
        if (!calls) throw new Error(`Unregistered execution observation: ${name}`);
        const finalize = analyzer.finalize;
        return {
            name: analyzer.name,
            exemptFromPruning: analyzer.exemptFromPruning,
            visit: wrapObservedHook(analyzer.visit, analyzer, calls),
            leave: wrapObservedHook(analyzer.leave, analyzer, calls),
            finalize: !finalize
                ? undefined
                : (ctx) => {
                      calls.calls++;
                      try {
                          return finalize.call(analyzer, ctx);
                      } catch (error) {
                          calls.failure ??= formatFailureMessage(error);
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
        if (!supported) return STATUS_UNSUPPORTED;
        if (adapter.precision === PRECISION_LEXICAL) return STATUS_DEGRADED;
        if (adapter.precision === PRECISION_AST && diagnostics) {
            return diagnostics.length === 0 ? STATUS_COMPLETE : STATUS_DEGRADED;
        }
        return STATUS_UNAVAILABLE;
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
            precision: adapter.precision ?? PRECISION_UNSPECIFIED,
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
            return Object.freeze({
                ...calls,
                status: STATUS_FAILED,
                reason: REASON_ANALYZER_EXCEPTION,
            });
        }
        if (calls.calls === 0) return Object.freeze({ ...calls, status: STATUS_NOT_RUN });
        const complete = parser.status === STATUS_COMPLETE && !this.scope.lineBounds;
        const reason =
            parser.status === STATUS_COMPLETE ? REASON_LINE_WINDOW : `parser-${parser.status}`;
        return Object.freeze({
            analyzer: calls.analyzer,
            version: calls.version,
            calls: calls.calls,
            status: complete ? STATUS_COMPLETE : STATUS_PARTIAL,
            ...(complete ? {} : { reason }),
        });
    }
}
