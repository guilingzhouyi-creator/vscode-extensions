/**
 * Module: Review — Required File Execution Coverage
 * File Path: src/core/review/execution-coverage.ts
 * Architecture Role: Reduce scanner observations into neutral per-file capability facts.
 * Dependencies & Triggers: Scanner call observations, snapshot inputs and policy requirements.
 * Responsibilities: Keep missing calls, degraded parsing, version mismatch and failures incomplete.
 * Exit Semantics & Design Rationale: File analysis facts carry no implicit policy exemption,
 *     graph coverage, test execution evidence or publication authority.
 */
import { getLanguageIdFromPath } from '../policy/source-mask';
import { EXPERT_BY_ID } from '../experts/expert-catalog';
import type { FileExecutionObservation, AnalyzerExecutionObservation } from './analyzer-execution';
import type { ReviewCapabilityCoverage } from './review-contracts';
import type { SnapshotRead } from './source-snapshot';

/** Required analyzer names come from existing configuration or an explicit caller policy. */
export interface FileAnalysisRequirement {
    readonly analyzer: string;
    readonly version?: number;
}
/** A file-scoped capability fact retaining observed counts and version expectations. */
export interface FileAnalysisCoverage extends ReviewCapabilityCoverage {
    readonly path: string;
    readonly capability: 'file-analysis';
    readonly required: true;
    readonly calls: number;
    readonly observedVersion: number | null;
    readonly requiredVersion?: number;
}
interface InputObservation {
    readonly path: string;
    readonly kind: SnapshotRead['kind'];
}
interface CoverageInput {
    readonly requirements: readonly FileAnalysisRequirement[];
    readonly inputs: readonly InputObservation[];
    readonly execution: readonly FileExecutionObservation[];
}
/** Per-file/analyzer evidence retaining original failure, invocation and whole-file precedence. */
interface PassSummary {
    readonly first: AnalyzerExecutionObservation;
    calls: number;
    invoked?: AnalyzerExecutionObservation;
    failed?: AnalyzerExecutionObservation;
    invalidCalls: boolean;
    inconsistentVersion: boolean;
    invokedFile?: FileExecutionObservation;
    wholeFile: boolean;
}
type Outcome = Pick<ReviewCapabilityCoverage, 'status' | 'reason'>;

/**
 * Validate and detach policy inputs before starting any awaited scanner work.
 * @param requirements - Configured analyzer names and optional policy-pinned versions.
 * @returns Immutable, validated copies of the requirements.
 */
export function captureFileRequirements(
    requirements: readonly FileAnalysisRequirement[],
): readonly FileAnalysisRequirement[] {
    const names = new Set<string>();
    return Object.freeze(requirements.map((requirement) => {
        if (!requirement || typeof requirement.analyzer !== 'string' || !requirement.analyzer.trim()) {
            throw new Error('Invalid required analyzer name');
        }
        if (names.has(requirement.analyzer)) throw new Error('Duplicate required analyzer');
        if (requirement.version !== undefined &&
            (!Number.isSafeInteger(requirement.version) || requirement.version < 1)) {
            throw new Error('Invalid required analyzer version');
        }
        names.add(requirement.analyzer);
        return Object.freeze({ ...requirement });
    }));
}

/**
 * Stable composite key joining a file path to one analyzer without delimiter ambiguity.
 * @param path - Snapshot-relative source path.
 * @param analyzer - Required analyzer name.
 * @returns Key suitable for map membership and replacement bookkeeping.
 */
export function fileAnalyzerKey(path: string, analyzer: string): string {
    return `${path.length}:${path}${analyzer}`;
}

/**
 * Count only non-negative safe integers so invalid telemetry cannot become evidence.
 * @param analyzer - Observed analyzer entry.
 * @returns The validated call count, or zero when the reported count is unusable.
 */
function validCalls(analyzer: AnalyzerExecutionObservation): number {
    return Number.isSafeInteger(analyzer.calls) && analyzer.calls >= 0 ? analyzer.calls : 0;
}

function languageOutcome(analyzer: string, language: string): Outcome | undefined {
    const languages = EXPERT_BY_ID.get(analyzer)?.affinities.languages;
    if (languages?.length && !languages.includes(language)) {
        return { status: 'unsupported', reason: 'analyzer-language-unsupported' };
    }
    return undefined;
}

function versionOutcome(
    requirement: FileAnalysisRequirement,
    analyzer: AnalyzerExecutionObservation,
): Outcome | undefined {
    if (analyzer.version === null || !Number.isSafeInteger(analyzer.version) ||
        analyzer.version < 1) {
        return { status: 'degraded', reason: 'analyzer-version-unknown' };
    }
    if (requirement.version !== undefined && requirement.version !== analyzer.version) {
        return { status: 'degraded', reason: 'analyzer-version-mismatch' };
    }
    return undefined;
}

function parserOutcome(
    file: FileExecutionObservation,
    analyzer: AnalyzerExecutionObservation,
): Outcome {
    if (file.parser.status === 'unsupported') return { status: 'unsupported', reason: 'parser-unsupported' };
    if (file.parser.status !== 'complete' || file.parser.precision !== 'ast' ||
        file.parser.diagnostics !== 0) {
        return { status: 'degraded', reason: `parser-${file.parser.status}` };
    }
    if (file.lineBounds) return { status: 'degraded', reason: 'line-window' };
    if (analyzer.status !== 'complete') {
        return { status: 'degraded', reason: analyzer.reason ?? 'analyzer-partial' };
    }
    return { status: 'executed' };
}

/**
 * Decide a requirement from a single-pass summary; failures retain observation order.
 * @param requirement - Required analyzer and optional pinned version.
 * @param observed - Summary for one file/analyzer, absent when never observed.
 * @param language - Language inferred from the snapshot path.
 * @returns A single outcome describing the file as a whole.
 */
function passOutcome(
    requirement: FileAnalysisRequirement,
    observed: PassSummary | undefined,
    language: string,
): Outcome {
    if (observed?.failed) {
        return { status: 'failed', reason: observed.failed.reason ?? 'analyzer-failed' };
    }
    const declaration = languageOutcome(requirement.analyzer, language);
    if (declaration) return declaration;
    if (!observed?.invoked || !observed.invokedFile) {
        return { status: 'supported', reason: observed?.first.reason ?? 'analyzer-not-run' };
    }
    if (observed.invalidCalls) return { status: 'failed', reason: 'invalid-call-count' };
    if (observed.inconsistentVersion) return { status: 'failed', reason: 'inconsistent-analyzer-version' };
    const version = versionOutcome(requirement, observed.invoked);
    if (version) return version;
    if (observed.wholeFile) return { status: 'executed' };
    return parserOutcome(observed.invokedFile, observed.invoked);
}

function reduceRequirement(
    source: InputObservation,
    requirement: FileAnalysisRequirement,
    observed: PassSummary | undefined,
): FileAnalysisCoverage {
    const language = getLanguageIdFromPath(source.path) ?? 'unknown';
    const calls = observed?.calls ?? 0;
    const outcome: Outcome = source.kind === 'text'
        ? passOutcome(requirement, observed, language)
        : { status: 'unsupported', reason: `input-${source.kind}` };
    return Object.freeze({
        path: source.path,
        analyzer: requirement.analyzer,
        capability: 'file-analysis',
        language,
        required: true,
        calls,
        observedVersion: observed?.first.version ?? null,
        ...(requirement.version === undefined ? {} : { requiredVersion: requirement.version }),
        ...outcome,
    });
}

/**
 * Accumulate first-observation and invocation evidence without retaining per-pass wrappers.
 * @param summary - Persistent summary for one file/analyzer pair.
 * @param pass - Current original pass.
 * @param analyzer - First matching analyzer observation in that pass.
 */
function accumulatePass(
    summary: PassSummary, pass: FileExecutionObservation, analyzer: AnalyzerExecutionObservation,
): void {
    summary.calls += validCalls(analyzer);
    if (analyzer.status === 'failed' && !summary.failed) summary.failed = analyzer;
    if (!(analyzer.calls > 0)) return;
    if (!summary.invoked) {
        summary.invoked = analyzer;
        summary.invokedFile = pass;
    }
    const version = summary.invoked.version;
    const sameVersion = version === analyzer.version ||
        (Number.isNaN(version) && Number.isNaN(analyzer.version));
    if (!sameVersion) {
        summary.inconsistentVersion = true;
    }
    if (validCalls(analyzer) !== analyzer.calls) summary.invalidCalls = true;
    if (!summary.wholeFile && !pass.lineBounds) {
        summary.wholeFile = parserOutcome(pass, analyzer).status === 'executed';
    }
}

/**
 * Index passes by file and analyzer in O(observed calls), preserving first duplicate semantics.
 * @param execution - Every observed pass, including bounded rework and compensation runs.
 * @param scope - Paths accepted by the enclosing snapshot request.
 * @returns Reduced evidence retaining no per-pass arrays or wrappers.
 */
function groupObservedPasses(
    execution: readonly FileExecutionObservation[],
    scope: ReadonlySet<string>,
): Map<string, Map<string, PassSummary>> {
    const passes = new Map<string, Map<string, PassSummary>>(
        Array.from(scope, (path) => [path, new Map<string, PassSummary>()]),
    );
    const names = new Set<string>();
    for (const pass of execution) {
        const file = passes.get(pass.path);
        if (!file) {
            throw new Error('Execution observation outside the captured input scope');
        }
        names.clear();
        for (const analyzer of pass.analyzers) {
            if (names.has(analyzer.analyzer)) continue;
            names.add(analyzer.analyzer);
            let summary = file.get(analyzer.analyzer);
            if (!summary) {
                summary = { first: analyzer, calls: 0, invalidCalls: false,
                    inconsistentVersion: false, wholeFile: false };
                file.set(analyzer.analyzer, summary);
            }
            accumulatePass(summary, pass, analyzer);
        }
    }
    return passes;
}

/**
 * Join requirements to every real per-file call, keeping repeated passes separate.
 * Inputs and outputs remain bound to their enclosing snapshot result; empty scope yields no
 * executed facts. Consumers must retain snapshot/configuration identity when persisting them.
 * @param input - Required analyzers, input outcomes and all observed passes.
 * @returns Immutable per-file capability facts with observed versions and call counts.
 */
export function collectReviewPassCoverage(input: CoverageInput): readonly FileAnalysisCoverage[] {
    const requirements = captureFileRequirements(input.requirements);
    const scope = new Set(input.inputs.map((source) => source.path));
    if (scope.size !== input.inputs.length) throw new Error('Duplicate snapshot input observation');
    const passes = groupObservedPasses(input.execution, scope);
    const coverage: FileAnalysisCoverage[] = [];
    for (const source of input.inputs) {
        for (const requirement of requirements) {
            const observed = passes.get(source.path)?.get(requirement.analyzer);
            coverage.push(reduceRequirement(
                source, requirement, observed,
            ));
        }
    }
    return Object.freeze(coverage);
}

/**
 * Single-pass entry point retaining strict duplicate rejection for snapshot scans.
 * @param input - Required analyzers, input outcomes and one pass per scanned file.
 * @returns Immutable per-file capability facts.
 */
export function collectExecutionCoverage(input: CoverageInput): readonly FileAnalysisCoverage[] {
    const files = new Set<string>();
    const names = new Set<string>();
    for (const pass of input.execution) {
        if (files.has(pass.path)) throw new Error('Duplicate file execution observation');
        files.add(pass.path);
        names.clear();
        for (const analyzer of pass.analyzers) {
            if (names.has(analyzer.analyzer)) throw new Error('Duplicate analyzer execution observation');
            names.add(analyzer.analyzer);
        }
    }
    return collectReviewPassCoverage(input);
}
