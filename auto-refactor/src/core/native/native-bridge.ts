/**
 * Module: Core Engine - Native Acceleration Bridge & Pure JS Fallback Shim
 * File Path: src/core/native/native-bridge.ts
 * Architecture Role: High-performance execution bridge providing transparent dual-track
 *   dispatch between compiled Rust native core (N-API) and deterministic pure JS algorithms.
 * Dependencies & Triggers: Consumes native-types.ts, edit-diff, and histogram-diff;
 *   invoked by execution schedulers, diff stream processors, and dependency graph analyzers.
 * Responsibilities:
 *   1. Dynamically probe and load optional compiled Rust native bindings;
 *   2. Supply complete, byte-equivalent pure JS implementations for histogram diff,
 *      Tarjan SCC cycle detection, topological sorting, and fast pattern matching;
 *   3. Deliver zero-overhead singleton interface nativeCore and convenience helpers.
 * Exit Semantics & Design Rationale: Never throws during initialization or execution;
 *   guarantees 100% algorithmic parity and platform neutrality across all Node environments.
 */

import type {
    INativeCore,
    NativeBindingInput,
    NativeBraceBalance,
    NativeBumpyRoadResult,
    NativeCloneBlock,
    NativeClonePair,
    NativeCoreEngineType,
    NativeCoreStatus,
    NativeDataflowParams,
    NativeDataflowResult,
    NativeDiffHunk,
    NativeDominatorTreeResult,
    NativeGraphAnalysis,
    NativeMaskConfig,
    NativeMaskedSource,
    NativePatternMatch,
    NativeScopeInput,
    NativeSecretFinding,
    NativeSecretScanOptions,
    NativeShadowingResult,
    NativeStatisticalMoments,
    NativeTemporalCouplingPair,
} from './native-types';
import {
    analyzeScopeShadowingShim,
    analyzeDependencyGraphShim,
    computeDominatorTreeShim,
    computeHistogramDiffShim,
    fastPatternMatchShim,
    hasAnyPatternShim,
    solveDataflowShim,
} from './native-shims-structural';
import { scanSecretsShim } from './native-shims-metrics';
import { countLineStats } from '../../utils/linestats';
import { maskSourceText } from '../policy/source-mask';
import {
    countDuplicateLinesShim,
    detectCloneBlocksShim,
    computeMinHashShim,
    findClonePairsShim,
    computeBitParallelDistanceShim,
    computeSimHash64Shim,
    calculateSimHashHammingSimilarityShim,
    calculateTrigramSimilarityShim,
    computeTemporalCouplingShim,
    evaluateBumpyRoadShim,
    batchProbeTriggersShim,
    HASH_COEFFS,
} from './native-shims-clone';
import {
    computeShannonEntropyShim,
    computeStatisticalMomentsShim,
    calculatePopoviciuPenaltyShim,
    countBracesDetailedShim,
    computeWarshallClosureShim,
    computeVectorDotProductShim,
    computeVectorCosineSimilarityShim,
    computeVectorEuclideanDistanceShim,
    selectBinding,
} from './native-shims-metrics';

export { HASH_COEFFS };

const DEFAULT_CONTEXT_LINES = 3;
const DEFAULT_MINHASH_PERMUTATIONS = 64;
const KIB_FACTOR = 1024;
const LARGE_DIFF_KIB = 4;
const LARGE_DIFF_BYTES_THRESHOLD = LARGE_DIFF_KIB * KIB_FACTOR;
const LARGE_GRAPH_EDGES_THRESHOLD = 128;
const MIN_NATIVE_TRIGRAM_TOKEN_COUNT = 500;

const NATIVE_BINDING_PATH = '../../../crates/auto-refactor-core/index.node';

/**
 * Binding members the assembly layer calls without a shim fallback.
 *
 * Each name here is assigned straight through to the compiled module (no `selectBinding` guard,
 * no size gate, no shim override), so a module that lacks it would hand callers `undefined` and
 * fail only at the first invocation. The list is therefore the contract the loader must verify
 * before accepting a binding: a present-but-incomplete addon has to be refused up front, not
 * discovered later as a `TypeError` on a specific operator.
 */
const REQUIRED_BINDING_FIELDS = [
    'computeHistogramDiff',
    'analyzeDependencyGraph',
    'fastPatternMatch',
    'countDuplicateLines',
    'detectCloneBlocks',
    'findClonePairs',
    'computeDominatorTree',
    'solveDataflow',
] as const;

const ENGINE_PURE_JS: NativeCoreEngineType = 'pure-js-shim';
const ENGINE_RUST_NATIVE: NativeCoreEngineType = 'rust-native';
const VERSION_SHIM = '0.4.0-shim';
const VERSION_NATIVE_FALLBACK = '0.4.0-native';

// Capability names state what the engine actually does, not what it was expected to do. Four
// earlier names advertised facilities that no compiled crate contains: the mask operators run in
// pure JavaScript by design, no crate uses std::arch or target_feature intrinsics, none spawns
// threads or uses a parallel iterator, and only one function ever reinterprets a buffer in place.
// A name is consumed as a promise by callers inspecting the status, so an aspirational name is a
// false one. The names below are limited to what each operator demonstrably performs.
const CAPABILITY_HISTOGRAM_DIFF = 'histogram-diff';
const CAPABILITY_TARJAN_SCC = 'tarjan-scc';
const CAPABILITY_TOPOLOGICAL_SORT = 'topological-sort';
const CAPABILITY_FAST_PATTERN_MATCH = 'fast-pattern-match';
const CAPABILITY_PATTERN_PRESENCE = 'pattern-presence';
const CAPABILITY_SOURCE_MASK = 'source-mask';
const CAPABILITY_SOURCE_MASK_COMPACT = 'source-mask-compact';
const CAPABILITY_CLONE_DETECTION = 'clone-detection';
const CAPABILITY_MINHASH_LSH = 'minhash-lsh';
const CAPABILITY_DOMINATOR_TREE = 'dominator-tree';
const CAPABILITY_DATAFLOW_SOLVER = 'dataflow-solver';
const CAPABILITY_BIT_PARALLEL_MYERS = 'bit-parallel-myers';
const CAPABILITY_SIMHASH_SEMANTIC = 'simhash-semantic';
const CAPABILITY_TRIGRAM_COSINE = 'trigram-cosine';
const CAPABILITY_TEMPORAL_COUPLING = 'temporal-coupling';
const CAPABILITY_BUMPY_ROAD = 'bumpy-road';
const CAPABILITY_BATCH_TRIGGER_PROBE = 'batch-trigger-probe';
const CAPABILITY_SHANNON_ENTROPY = 'shannon-entropy';
const CAPABILITY_STATISTICAL_MOMENTS = 'statistical-moments';
const CAPABILITY_POPOVICIU_DISPERSION = 'popoviciu-dispersion';
const CAPABILITY_BRACE_SCAN = 'brace-scan';
const CAPABILITY_WARSHALL_CLOSURE = 'warshall-closure';
const CAPABILITY_VECTOR_MATH = 'vector-math';
const CAPABILITY_SCOPE_SHADOWING = 'scope-shadowing';

const SHIM_CAPABILITIES: readonly string[] = Object.freeze([
    CAPABILITY_HISTOGRAM_DIFF,
    CAPABILITY_TARJAN_SCC,
    CAPABILITY_TOPOLOGICAL_SORT,
    CAPABILITY_FAST_PATTERN_MATCH,
    CAPABILITY_PATTERN_PRESENCE,
    CAPABILITY_SOURCE_MASK,
    CAPABILITY_SOURCE_MASK_COMPACT,
    CAPABILITY_CLONE_DETECTION,
    CAPABILITY_MINHASH_LSH,
    CAPABILITY_DOMINATOR_TREE,
    CAPABILITY_DATAFLOW_SOLVER,
    CAPABILITY_BIT_PARALLEL_MYERS,
    CAPABILITY_SIMHASH_SEMANTIC,
    CAPABILITY_TRIGRAM_COSINE,
    CAPABILITY_TEMPORAL_COUPLING,
    CAPABILITY_BUMPY_ROAD,
    CAPABILITY_BATCH_TRIGGER_PROBE,
    CAPABILITY_SHANNON_ENTROPY,
    CAPABILITY_STATISTICAL_MOMENTS,
    CAPABILITY_POPOVICIU_DISPERSION,
    CAPABILITY_BRACE_SCAN,
    CAPABILITY_WARSHALL_CLOSURE,
    CAPABILITY_VECTOR_MATH,
    CAPABILITY_SCOPE_SHADOWING,
]);

// The compiled engine exposes the same operator set as the shim, so its name list is derived from
// the shim list rather than repeated. Adding an operator then reaches both engines at once, and the
// two lists cannot drift into disagreeing about what the layer supports.
const NATIVE_CORE_CAPABILITIES: readonly string[] = Object.freeze([...SHIM_CAPABILITIES]);

/**
 * Pure JavaScript fallback implementation of INativeCore.
 * Provides Git-grade histogram diff, Tarjan strongly connected components,
 * deterministic topological sorting, and MinHash clone detection without native dependencies.
 */
export class PureJsNativeShim implements INativeCore {
    private readonly defaultContextLines: number;

    public constructor(defaultContextLines = DEFAULT_CONTEXT_LINES) {
        this.defaultContextLines = defaultContextLines;
    }

    private maskSource(content: string, config: NativeMaskConfig) {
        return maskSourceText(content, {
            lineComment: config.lineComment,
            blockComment:
                config.blockCommentOpen && config.blockCommentClose
                    ? { open: config.blockCommentOpen, close: config.blockCommentClose }
                    : undefined,
            quoteChars: config.quoteChars,
            multilineTemplates: config.multilineTemplates,
            regexLiterals: config.regexLiterals,
            htmlComment: config.htmlComment,
        });
    }

    /**
     * @override interface implementation
     * Inspects active shim status.
     */
    public getStatus(): NativeCoreStatus {
        return {
            isNativeAvailable: false,
            activeEngine: ENGINE_PURE_JS,
            version: VERSION_SHIM,
            capabilities: [...SHIM_CAPABILITIES],
        };
    }

    /**
     * @override interface implementation
     * Computes line-level histogram diff hunks between oldContent and newContent.
     */
    public computeHistogramDiff(oldContent: string, newContent: string): NativeDiffHunk[] {
        return computeHistogramDiffShim(oldContent, newContent, this.defaultContextLines);
    }

    /**
     * @override interface implementation
     * Analyzes directed dependency graph edges: [from, to] (where `from` depends on `to`).
     * Implements Tarjan's SCC algorithm and topological sort.
     */
    public analyzeDependencyGraph(edges: [string, string][]): NativeGraphAnalysis {
        return analyzeDependencyGraphShim(edges);
    }

    /**
     * @override interface implementation
     * Fast multi-pattern textual scanner locating occurrences with 1-based line and column.
     */
    public fastPatternMatch(sourceText: string, patterns: string[]): NativePatternMatch[] {
        if (!sourceText || !patterns || patterns.length === 0) {
            return [];
        }
        return fastPatternMatchShim(sourceText, patterns);
    }

    /**
     * @override interface implementation
     * Existence check over a pattern set, without building match records.
     */
    public hasAnyPattern(sourceText: string, patterns: string[]): boolean {
        if (!sourceText || !patterns || patterns.length === 0) {
            return false;
        }
        return hasAnyPatternShim(sourceText, patterns);
    }

    /**
     * @override interface implementation
     * Pure JS fallback implementation of the native operator library.
     */
    public maskSourceCode(content: string, config: NativeMaskConfig): NativeMaskedSource {
        const maskedResult = this.maskSource(content, config);
        const stats = countLineStats(content);
        return {
            raw: maskedResult.raw,
            masked: maskedResult.masked,
            lines: stats.lines,
            nonBlankLines: stats.nonBlankLines,
        };
    }

    /**
     * @override interface implementation
     * Pure JS fallback for compact source code masking, emitting a single joined string.
     */
    public maskSourceCodeCompact(content: string, config: NativeMaskConfig): string {
        const maskedResult = this.maskSource(content, config);
        return maskedResult.masked.join('\n');
    }

    /**
     * @override interface implementation
     * Counts duplicated non-blank lines using 32-bit line hashes.
     */
    public countDuplicateLines(content: string): number {
        const textToCount = content ?? '';
        if (textToCount.length === 0) {
            return 0;
        }
        const duplicateCount = countDuplicateLinesShim(textToCount);
        return duplicateCount;
    }

    /**
     * @override interface implementation
     * Detects repeated code blocks within a single file.
     */
    public detectCloneBlocks(content: string, minCloneLines: number): NativeCloneBlock[] {
        return !content || minCloneLines <= 0 ? [] : detectCloneBlocksShim(content, minCloneLines);
    }

    /**
     * @override interface implementation
     * Computes a MinHash signature vector for a source file.
     */
    public computeMinHash(
        content: string,
        numPermutations = DEFAULT_MINHASH_PERMUTATIONS,
    ): number[] {
        return !content ? [] : computeMinHashShim(content, numPermutations);
    }

    /**
     * @override interface implementation
     * Discovers similar file pairs using Locality Sensitive Hashing (LSH).
     */
    public findClonePairs(signatures: number[][], threshold: number): NativeClonePair[] {
        if (!signatures || signatures.length === 0 || threshold < 0) {
            return [];
        }
        return findClonePairsShim(signatures, threshold);
    }

    /**
     * @override interface implementation
     * Computes the immediate dominator tree and dominance frontiers for a graph.
     */
    public computeDominatorTree(
        entry: string,
        nodes: string[],
        edges: Array<[string, string]>,
    ): NativeDominatorTreeResult {
        if ((!nodes || nodes.length === 0) && (!edges || edges.length === 0)) {
            return {
                entry,
                reachableNodes: [entry],
                idom: {},
                dominanceFrontiers: {},
                loopHeaders: [],
                backEdges: [],
            };
        }
        return computeDominatorTreeShim(entry, nodes || [], edges);
    }

    /**
     * @override interface implementation
     * Solves forward or backward dataflow equations to a fixed point.
     */
    public solveDataflow(params: NativeDataflowParams): NativeDataflowResult {
        if (!params || !params.entry) {
            return { inSets: {}, outSets: {}, iterations: 0 };
        }
        return solveDataflowShim(params);
    }

    /**
     * @override interface implementation
     * Computes the bit-parallel Myers edit distance between two token/line hash arrays.
     */
    public computeBitParallelDistance(pattern: Uint32Array, text: Uint32Array): number {
        return computeBitParallelDistanceShim(pattern, text);
    }

    /**
     * @override interface implementation
     * Computes a 64-bit SimHash fingerprint for an array of tokens.
     */
    public computeSimHash64(tokens: readonly string[]): string {
        return computeSimHash64Shim(tokens);
    }

    /**
     * @override interface implementation
     * Calculates SimHash Hamming similarity [0.0, 1.0] between SimHash fingerprints.
     */
    public calculateSimHashHammingSimilarity(hashA: string, hashB: string): number {
        return calculateSimHashHammingSimilarityShim(hashA, hashB);
    }

    /**
     * @override interface implementation
     * Calculates cosine similarity [0.0, 1.0] between token sequences via 3-gram vectors.
     */
    public calculateTrigramCosineSimilarity(
        tokensA: readonly string[],
        tokensB: readonly string[],
    ): number {
        return calculateTrigramSimilarityShim(tokensA, tokensB);
    }

    /**
     * @override interface implementation
     * Computes pairwise co-change frequencies and Jaccard similarity between files.
     */
    public computeTemporalCoupling(
        changesets: number[][],
        minShared: number,
        minJaccard: number,
    ): NativeTemporalCouplingPair[] {
        return computeTemporalCouplingShim(changesets, minShared, minJaccard);
    }

    /**
     * @override interface implementation
     * Measures structural irregularity and spatial variance of indentation/nesting depth.
     */
    public evaluateBumpyRoad(
        lines: readonly string[],
        startLine: number,
        endLine: number,
    ): NativeBumpyRoadResult {
        return evaluateBumpyRoadShim(lines, startLine, endLine);
    }

    /**
     * @override interface implementation
     * Fast vectorized batch probe testing multiple trigger groups against target content.
     */
    public batchProbeTriggers(
        content: string,
        triggerGroups: readonly (readonly string[])[],
    ): boolean[] {
        return batchProbeTriggersShim(content, triggerGroups);
    }

    /**
     * @override interface implementation
     * Computes Shannon Information Entropy H(X) in bits.
     */
    public computeShannonEntropy(text: string): number {
        return computeShannonEntropyShim(text);
    }

    /**
     * @override interface implementation
     * Computes first and second statistical moments in a single online pass.
     */
    public computeStatisticalMoments(values: readonly number[]): NativeStatisticalMoments {
        return computeStatisticalMomentsShim(values);
    }

    /**
     * @override interface implementation
     * Calculates Popoviciu's inequality dispersion discount factor in [0.0, 1.0].
     */
    public calculatePopoviciuDispersionPenalty(
        standardDeviation: number,
        maxSigma?: number,
        gamma?: number,
    ): number {
        return calculatePopoviciuPenaltyShim(standardDeviation, maxSigma, gamma);
    }

    /**
     * @override interface implementation
     * Counts opening and closing curly braces in a line with detailed breakdown.
     */
    public countBracesDetailed(line: string): NativeBraceBalance {
        return countBracesDetailedShim(line);
    }

    /**
     * @override interface implementation
     * Computes transitive closure over a dense boolean adjacency matrix using Warshall's algorithm.
     */
    public computeWarshallTransitiveClosure(matrix: Uint8Array, size: number): Uint8Array {
        return computeWarshallClosureShim(matrix, size);
    }

    /**
     * @override interface implementation
     * Computes inner dot product between two vector slices.
     */
    public computeVectorDotProduct(vectorA: readonly number[], vectorB: readonly number[]): number {
        return computeVectorDotProductShim(vectorA, vectorB);
    }

    /**
     * @override interface implementation
     * Computes cosine similarity between two vector slices.
     */
    public computeVectorCosineSimilarity(
        vectorA: readonly number[],
        vectorB: readonly number[],
    ): number {
        return computeVectorCosineSimilarityShim(vectorA, vectorB);
    }

    /**
     * @override interface implementation
     * Computes Euclidean distance between two vector slices.
     */
    public computeVectorEuclideanDistance(
        vectorA: readonly number[],
        vectorB: readonly number[],
    ): number {
        return computeVectorEuclideanDistanceShim(vectorA, vectorB);
    }

    /**
     * @override interface implementation
     * Pure JS fallback analyzing variable scope hierarchy and discovering symbol shadowing.
     */
    public analyzeScopeShadowing(
        scopes: readonly NativeScopeInput[],
        bindings: readonly NativeBindingInput[],
    ): NativeShadowingResult[] {
        return analyzeScopeShadowingShim(scopes, bindings);
    }

    /**
     * @override interface implementation
     * Pure JS fallback scanning source text for hardcoded secrets and credentials.
     */
    public scanSecretsNative(
        sourceText: string,
        options?: NativeSecretScanOptions,
    ): NativeSecretFinding[] {
        return scanSecretsShim(sourceText, options);
    }
}

interface RawNativeBinding {
    readonly scanSecretsNative?: (
        sourceText: string,
        options?: NativeSecretScanOptions,
    ) => NativeSecretFinding[];
    readonly computeHistogramDiff: (oldContent: string, newContent: string) => NativeDiffHunk[];
    readonly analyzeDependencyGraph: (edges: [string, string][]) => NativeGraphAnalysis;
    readonly fastPatternMatch?: (sourceText: string, patterns: string[]) => NativePatternMatch[];
    readonly hasAnyPattern?: (sourceText: string, patterns: string[]) => boolean;
    /**
     * Present in the compiled addon but never dereferenced by this module: masking always routes to
     * the shim because returning structured line arrays across N-API costs more than the masking
     * itself. Kept optional so the type matches how the layer actually uses it.
     */
    readonly maskSourceCode?: (content: string, config: NativeMaskConfig) => NativeMaskedSource;
    readonly maskSourceCodeCompact?: (content: string, config: NativeMaskConfig) => string;
    readonly countDuplicateLines?: (content: string) => number;
    readonly detectCloneBlocks?: (content: string, minCloneLines: number) => NativeCloneBlock[];
    readonly computeMinHash?: (content: string, numPermutations?: number) => number[];
    readonly computeMinhash?: (content: string, numPermutations?: number) => number[];
    readonly findClonePairs?: (signatures: number[][], threshold: number) => NativeClonePair[];
    readonly computeDominatorTree?: (
        entry: string,
        nodes: string[],
        edges: Array<[string, string]>,
    ) => NativeDominatorTreeResult;
    readonly solveDataflow?: (
        entry: string,
        nodes: string[],
        edges: Array<[string, string]>,
        forward: boolean,
        gen: Record<string, string[]>,
        kill: Record<string, string[]>,
    ) => NativeDataflowResult;
    readonly computeBitParallelDistance?: (pattern: Uint32Array, text: Uint32Array) => number;
    readonly computeSimHash64?: (tokens: readonly string[]) => string;
    readonly calculateSimHashHammingSimilarity?: (hashA: string, hashB: string) => number;
    readonly calculateTrigramCosineSimilarity?: (
        tokensA: readonly string[],
        tokensB: readonly string[],
    ) => number;
    readonly computeTemporalCoupling?: (
        changesets: number[][],
        minShared: number,
        minJaccard: number,
    ) => NativeTemporalCouplingPair[];
    readonly evaluateBumpyRoad?: (
        lines: readonly string[],
        startLine: number,
        endLine: number,
    ) => NativeBumpyRoadResult;
    readonly batchProbeTriggers?: (
        content: string,
        triggerGroups: readonly (readonly string[])[],
    ) => boolean[];
    readonly computeShannonEntropy?: (text: string) => number;
    readonly computeStatisticalMoments?: (values: readonly number[]) => NativeStatisticalMoments;
    readonly calculatePopoviciuDispersionPenalty?: (
        standardDeviation: number,
        maxSigma?: number,
        gamma?: number,
    ) => number;
    readonly countBracesDetailed?: (line: string) => NativeBraceBalance;
    readonly computeWarshallTransitiveClosure?: (matrix: Uint8Array, size: number) => Uint8Array;
    readonly computeVectorDotProduct?: (
        vectorA: readonly number[],
        vectorB: readonly number[],
    ) => number;
    readonly computeVectorCosineSimilarity?: (
        vectorA: readonly number[],
        vectorB: readonly number[],
    ) => number;
    readonly computeVectorEuclideanDistance?: (
        vectorA: readonly number[],
        vectorB: readonly number[],
    ) => number;
    readonly analyzeScopeShadowing?: (
        scopes: readonly NativeScopeInput[],
        bindings: readonly NativeBindingInput[],
    ) => NativeShadowingResult[];
    readonly version?: string;
    readonly VERSION?: string;
}

function resolveMinHashBinding(
    binding: RawNativeBinding,
    jsShim: PureJsNativeShim,
): (content: string, numPermutations?: number) => number[] {
    if (typeof binding.computeMinHash === 'function') {
        return binding.computeMinHash;
    }
    if (typeof binding.computeMinhash === 'function') {
        return binding.computeMinhash;
    }
    return (content, permutations) => jsShim.computeMinHash(content, permutations);
}

function resolveNativeVersion(binding: RawNativeBinding): string {
    return binding.version || binding.VERSION || VERSION_NATIVE_FALLBACK;
}

function assembleDiffAndGraphOps(
    binding: RawNativeBinding,
    jsShim: PureJsNativeShim,
): Pick<
    INativeCore,
    | 'computeHistogramDiff'
    | 'analyzeDependencyGraph'
    | 'fastPatternMatch'
    | 'hasAnyPattern'
    | 'computeDominatorTree'
    | 'solveDataflow'
    | 'analyzeScopeShadowing'
> {
    return {
        computeHistogramDiff: (oldContent: string, newContent: string) => {
            if (oldContent.length + newContent.length < LARGE_DIFF_BYTES_THRESHOLD) {
                return jsShim.computeHistogramDiff(oldContent, newContent);
            }
            return binding.computeHistogramDiff(oldContent, newContent);
        },
        analyzeDependencyGraph: (edges: [string, string][]) => {
            if (edges.length < LARGE_GRAPH_EDGES_THRESHOLD) {
                return jsShim.analyzeDependencyGraph(edges);
            }
            return binding.analyzeDependencyGraph(edges);
        },
        fastPatternMatch: selectBinding(binding.fastPatternMatch, (sourceText, patterns) =>
            jsShim.fastPatternMatch(sourceText, patterns),
        ),
        // No size gate: the existence check is cheaper than the record scan on every payload, so a
        // threshold would only add a branch that can never pay for itself.
        hasAnyPattern: selectBinding(binding.hasAnyPattern, (sourceText, patterns) =>
            jsShim.hasAnyPattern(sourceText, patterns),
        ),
        computeDominatorTree: selectBinding(binding.computeDominatorTree, (entry, nodes, edges) =>
            jsShim.computeDominatorTree(entry, nodes, edges),
        ),
        solveDataflow: (params: NativeDataflowParams) => {
            // The compiled operator takes positional arguments while the shim takes the params
            // object, so this pair cannot share one `selectBinding` type. The handler is resolved
            // per call instead of at assembly time; without the guard a binding that lacks the
            // operator would dereference `undefined` here.
            const nativeSolver = binding.solveDataflow;
            if (typeof nativeSolver !== 'function') {
                return jsShim.solveDataflow(params);
            }
            return nativeSolver(
                params.entry,
                params.nodes ?? [],
                params.edges,
                params.forward ?? true,
                params.gen ?? {},
                params.kill ?? {},
            );
        },
        analyzeScopeShadowing: (scopes, bindings) => {
            // Guard: Passing objects across N-API causes FFI property extraction churn.
            // Under zero-regression mandate, route to optimized pure JS shim.
            return jsShim.analyzeScopeShadowing(scopes, bindings);
        },
    };
}

function assembleCloneOps(
    binding: RawNativeBinding,
    jsShim: PureJsNativeShim,
): Pick<
    INativeCore,
    | 'maskSourceCode'
    | 'maskSourceCodeCompact'
    | 'countDuplicateLines'
    | 'detectCloneBlocks'
    | 'computeMinHash'
    | 'findClonePairs'
    | 'computeBitParallelDistance'
> {
    return {
        maskSourceCode: (content: string, config: NativeMaskConfig) => {
            // Guard: Vec<String> arrays across N-API incur heavy V8 string allocations.
            // jsShim avoids FFI allocation churn for structured line returns.
            return jsShim.maskSourceCode(content, config);
        },
        maskSourceCodeCompact: (content: string, config: NativeMaskConfig) => {
            if (
                content.length < LARGE_DIFF_BYTES_THRESHOLD ||
                typeof binding.maskSourceCodeCompact !== 'function'
            ) {
                return jsShim.maskSourceCodeCompact(content, config);
            }
            return binding.maskSourceCodeCompact(content, config);
        },
        countDuplicateLines: selectBinding(binding.countDuplicateLines, (content) =>
            jsShim.countDuplicateLines(content),
        ),
        detectCloneBlocks: selectBinding(binding.detectCloneBlocks, (content, minCloneLines) =>
            jsShim.detectCloneBlocks(content, minCloneLines),
        ),
        computeMinHash: resolveMinHashBinding(binding, jsShim),
        findClonePairs: selectBinding(binding.findClonePairs, (signatures, threshold) =>
            jsShim.findClonePairs(signatures, threshold),
        ),
        computeBitParallelDistance: selectBinding(
            binding.computeBitParallelDistance,
            (pattern, text) => jsShim.computeBitParallelDistance(pattern, text),
        ),
    };
}

function assembleHashingOps(
    binding: RawNativeBinding,
    jsShim: PureJsNativeShim,
): Pick<
    INativeCore,
    | 'computeSimHash64'
    | 'calculateSimHashHammingSimilarity'
    | 'calculateTrigramCosineSimilarity'
    | 'computeTemporalCoupling'
    | 'evaluateBumpyRoad'
    | 'batchProbeTriggers'
> {
    return {
        computeSimHash64: selectBinding(binding.computeSimHash64, (tokens) =>
            jsShim.computeSimHash64(tokens),
        ),
        calculateSimHashHammingSimilarity: selectBinding(
            binding.calculateSimHashHammingSimilarity,
            (hashA, hashB) => jsShim.calculateSimHashHammingSimilarity(hashA, hashB),
        ),
        calculateTrigramCosineSimilarity: (tokensA: string[], tokensB: string[]) => {
            if (
                tokensA.length < MIN_NATIVE_TRIGRAM_TOKEN_COUNT &&
                tokensB.length < MIN_NATIVE_TRIGRAM_TOKEN_COUNT
            ) {
                return jsShim.calculateTrigramCosineSimilarity(tokensA, tokensB);
            }
            const nativeTrigramHandler = binding.calculateTrigramCosineSimilarity;
            if (typeof nativeTrigramHandler === 'function') {
                return nativeTrigramHandler(tokensA, tokensB);
            }
            return jsShim.calculateTrigramCosineSimilarity(tokensA, tokensB);
        },
        computeTemporalCoupling: selectBinding(
            binding.computeTemporalCoupling,
            (changesets, minShared, minJaccard) =>
                jsShim.computeTemporalCoupling(changesets, minShared, minJaccard),
        ),
        evaluateBumpyRoad: selectBinding(binding.evaluateBumpyRoad, (lines, startLine, endLine) =>
            jsShim.evaluateBumpyRoad(lines, startLine, endLine),
        ),
        batchProbeTriggers: selectBinding(binding.batchProbeTriggers, (content, groups) =>
            jsShim.batchProbeTriggers(content, groups),
        ),
    };
}

function assembleVectorAndMathOps(
    binding: RawNativeBinding,
    jsShim: PureJsNativeShim,
): Pick<
    INativeCore,
    | 'computeShannonEntropy'
    | 'computeStatisticalMoments'
    | 'calculatePopoviciuDispersionPenalty'
    | 'countBracesDetailed'
    | 'computeWarshallTransitiveClosure'
    | 'computeVectorDotProduct'
    | 'computeVectorCosineSimilarity'
    | 'computeVectorEuclideanDistance'
    | 'scanSecretsNative'
> {
    return {
        computeShannonEntropy: (text: string) => {
            if (
                text.length < LARGE_DIFF_BYTES_THRESHOLD ||
                typeof binding.computeShannonEntropy !== 'function'
            ) {
                return jsShim.computeShannonEntropy(text);
            }
            return binding.computeShannonEntropy(text);
        },
        computeStatisticalMoments: selectBinding(binding.computeStatisticalMoments, (values) =>
            jsShim.computeStatisticalMoments(values),
        ),
        calculatePopoviciuDispersionPenalty: selectBinding(
            binding.calculatePopoviciuDispersionPenalty,
            (stdDev, maxSigma, gamma) =>
                jsShim.calculatePopoviciuDispersionPenalty(stdDev, maxSigma, gamma),
        ),
        countBracesDetailed: (line: string) => {
            if (
                line.length < LARGE_DIFF_BYTES_THRESHOLD ||
                typeof binding.countBracesDetailed !== 'function'
            ) {
                return jsShim.countBracesDetailed(line);
            }
            return binding.countBracesDetailed(line);
        },
        computeWarshallTransitiveClosure: selectBinding(
            binding.computeWarshallTransitiveClosure,
            (matrix, size) => jsShim.computeWarshallTransitiveClosure(matrix, size),
        ),
        computeVectorDotProduct: selectBinding(
            binding.computeVectorDotProduct,
            (vectorA, vectorB) => jsShim.computeVectorDotProduct(vectorA, vectorB),
        ),
        computeVectorCosineSimilarity: selectBinding(
            binding.computeVectorCosineSimilarity,
            (vectorA, vectorB) => jsShim.computeVectorCosineSimilarity(vectorA, vectorB),
        ),
        computeVectorEuclideanDistance: selectBinding(
            binding.computeVectorEuclideanDistance,
            (vectorA, vectorB) => jsShim.computeVectorEuclideanDistance(vectorA, vectorB),
        ),
        scanSecretsNative: selectBinding(binding.scanSecretsNative, (sourceText, options) =>
            jsShim.scanSecretsNative(sourceText, options),
        ),
    };
}

function assembleNativeBindingCore(
    binding: RawNativeBinding,
    jsShim: PureJsNativeShim,
): INativeCore {
    return {
        ...assembleDiffAndGraphOps(binding, jsShim),
        ...assembleCloneOps(binding, jsShim),
        ...assembleHashingOps(binding, jsShim),
        ...assembleVectorAndMathOps(binding, jsShim),
        getStatus: () => ({
            isNativeAvailable: true,
            activeEngine: ENGINE_RUST_NATIVE,
            version: resolveNativeVersion(binding),
            capabilities: [...NATIVE_CORE_CAPABILITIES],
        }),
    };
}

/**
 * Records why the last compiled binding was rejected, so a degraded run can be distinguished from
 * an absent addon.
 *
 * Falls back to the pure JS shim in both cases, and `isNativeAvailable: false` alone cannot tell
 * the two apart: an operator that quietly runs slower looks identical to a deployment mistake.
 * Keeping the rejected member names lets the status surface name them.
 */
let rejectedBindingReason: string | null = null;

/**
 * Verifies that every member the assembly layer dereferences without a guard is callable.
 *
 * Exported because it is the admission contract itself, not an implementation detail: a deployment
 * check can ask whether a candidate addon satisfies the layer without constructing the bridge, and
 * the unit suite asserts the two outcomes on synthetic candidates rather than relying on whichever
 * binary happens to be present on the machine running the tests.
 *
 * @param binding - Candidate object loaded from the compiled addon.
 * @returns Names of required members that are not callable; empty when the binding is usable.
 */
export function findUnsatisfiedBindingFields(binding: unknown): string[] {
    if (!binding || typeof binding !== 'object') {
        return [...REQUIRED_BINDING_FIELDS];
    }
    const candidate = binding as Record<string, unknown>;
    return REQUIRED_BINDING_FIELDS.filter((name) => typeof candidate[name] !== 'function');
}

function loadNativeBindingModule(): RawNativeBinding | null {
    try {
        const modulePath = NATIVE_BINDING_PATH;
        const dynamicLoader = typeof require === 'function' ? require : undefined;
        if (!dynamicLoader) {
            rejectedBindingReason = 'no dynamic module loader is available in this runtime';
            return null;
        }
        const binding = dynamicLoader(modulePath) as RawNativeBinding;
        if (!binding || typeof binding !== 'object') {
            rejectedBindingReason = 'the addon did not export an object';
            return null;
        }
        const missing = findUnsatisfiedBindingFields(binding);
        if (missing.length > 0) {
            rejectedBindingReason = `addon exports ${missing.join(', ')} as non-callable`;
            return null;
        }
        const declaredVersion = binding.version || binding.VERSION;
        if (typeof declaredVersion === 'string' && !declaredVersion.startsWith('0.4.0')) {
            rejectedBindingReason = `addon version mismatch: expected 0.4.0*, got ${declaredVersion}`;
            return null;
        }
        return binding;
    } catch (err) {
        rejectedBindingReason = `addon failed to load: ${(err as Error).message}`;
    }
    return null;
}

function probeNativeBinding(): INativeCore | null {
    const binding = loadNativeBindingModule();
    if (!binding) return null;
    const jsShim = new PureJsNativeShim();
    return assembleNativeBindingCore(binding, jsShim);
}

/**
 * Global singleton native acceleration instance.
 * Automatically delegates to compiled Rust native core when present, or pure JS shim fallback.
 */
export const nativeCore: INativeCore = probeNativeBinding() || new PureJsNativeShim();

/**
 * Retrieves the status and capabilities of the active acceleration engine with immutable defense.
 *
 * The rejection reason is carried through only when the shim is active, so a caller can separate
 * "no compiled addon was shipped" from "an addon was shipped but refused". Both report
 * `isNativeAvailable: false`; without the reason they are indistinguishable from the outside.
 *
 * @returns Active native core engine status descriptor.
 */
export function getNativeCoreStatus(): NativeCoreStatus {
    const status = nativeCore.getStatus();
    const degradedReason =
        status.isNativeAvailable === false && rejectedBindingReason !== null
            ? rejectedBindingReason
            : undefined;
    return Object.freeze({
        isNativeAvailable: status.isNativeAvailable,
        activeEngine: status.activeEngine,
        version: status.version,
        capabilities: Object.freeze([...status.capabilities]) as unknown as string[],
        degradedReason,
    });
}

/**
 * Computes line-level histogram diffs with short-circuit optimization.
 * @override interface implementation vtable proxy
 *
 * @param oldContent - Original text content.
 * @param newContent - Updated text content.
 * @returns Array of computed NativeDiffHunk elements.
 */
export function nativeHistogramDiff(oldContent: string, newContent: string): NativeDiffHunk[] {
    return oldContent === newContent ? [] : nativeCore.computeHistogramDiff(oldContent, newContent);
}

/**
 * Analyzes dependency graph topology with empty edge defensive bypass.
 * @override interface implementation vtable proxy
 *
 * @param edges - Array of directed [from, to] dependency edges.
 * @returns Graph analysis result with cycles, topological order, and SCCs.
 */
export function nativeAnalyzeDependencyGraph(edges: [string, string][]): NativeGraphAnalysis {
    if (!edges || edges.length === 0) {
        return {
            cycles: [],
            topologicalOrder: [],
            stronglyConnectedComponents: [],
            isAcyclic: true,
        };
    }
    return nativeCore.analyzeDependencyGraph(edges);
}

/**
 * Performs fast pattern matching across source text.
 * @override interface implementation vtable proxy
 *
 * @param sourceText - Target text to search.
 * @param patterns - Pattern strings to match against source.
 * @returns Array of pattern matches with offsets and line numbers.
 */
export function nativeFastPatternMatch(
    sourceText: string,
    patterns: string[],
): NativePatternMatch[] {
    if (!sourceText || !patterns || patterns.length === 0) return [];
    return nativeCore.fastPatternMatch(sourceText, patterns);
}

/**
 * Reports whether any pattern occurs in the source text.
 *
 * Answers the same question as `nativeFastPatternMatch` without materialising the match records,
 * which is what a gate that only branches on "did anything match" needs.
 *
 * @param sourceText - Target text to search.
 * @param patterns - Pattern strings to probe.
 * @returns True when at least one pattern occurs.
 */
export function nativeHasAnyPattern(sourceText: string, patterns: string[]): boolean {
    if (!sourceText || !patterns || patterns.length === 0) return false;
    return nativeCore.hasAnyPattern(sourceText, patterns);
}

/**
 * Masks source code comments and literals with blank text guard.
 * @override interface implementation vtable proxy
 *
 * @param content - Target source code content.
 * @param config - Lexical masking configuration.
 * @returns Masked source text structure with line metrics.
 */
export function nativeMaskSourceCode(
    content: string,
    config: NativeMaskConfig,
): NativeMaskedSource {
    if (!content) {
        return { raw: [], masked: [], lines: 0, nonBlankLines: 0 };
    }
    return nativeCore.maskSourceCode(content, config);
}

/**
 * Computes Shannon Information Entropy H(X) in bits.
 * @override interface implementation vtable proxy
 *
 * @param text - Input string to measure.
 * @returns Shannon entropy in bits rounded to 2 decimal places.
 */
export function nativeShannonEntropy(text: string): number {
    if (!text || text.length === 0) {
        return 0.0;
    }
    return nativeCore.computeShannonEntropy(text);
}

/**
 * Computes first and second statistical moments in a single online pass.
 *
 * @param values - Array of numerical values.
 * @returns NativeStatisticalMoments summary descriptor.
 * @override interface implementation vtable proxy
 */
export function nativeStatisticalMoments(values: readonly number[]): NativeStatisticalMoments {
    return nativeCore.computeStatisticalMoments(values);
}

/**
 * Calculates Popoviciu's inequality dispersion discount factor in [0.0, 1.0].
 * @override interface implementation vtable proxy
 *
 * @param standardDeviation - Sample standard deviation.
 * @param maxSigma - Theoretical maximum standard deviation (default 50.0).
 * @param gamma - Penalty elasticity factor (default 0.5).
 * @returns Discount multiplier in [0.0, 1.0].
 */
export function nativePopoviciuPenalty(
    standardDeviation: number,
    maxSigma?: number,
    gamma?: number,
): number {
    return nativeCore.calculatePopoviciuDispersionPenalty(standardDeviation, maxSigma, gamma);
}

/**
 * Counts opening and closing curly braces in a line with detailed breakdown.
 *
 * @param line - Text line to inspect.
 * @returns NativeBraceBalance containing opens, closes, and delta.
 * @override interface implementation vtable proxy
 */
export function nativeCountBracesDetailed(line: string): NativeBraceBalance {
    if (!line || line.length === 0) {
        return { opens: 0, closes: 0, delta: 0 };
    }
    return nativeCore.countBracesDetailed(line);
}

/**
 * Computes transitive closure over a dense boolean adjacency matrix using Warshall's algorithm.
 *
 * @param matrix - Row-major Uint8Array flat buffer of size * size.
 * @param size - Number of vertices in the square matrix.
 * @returns In-place mutated matrix with full reachability.
 * @override interface implementation vtable proxy
 */
export function nativeWarshallClosure(matrix: Uint8Array, size: number): Uint8Array {
    return nativeCore.computeWarshallTransitiveClosure(matrix, size);
}

/**
 * Computes inner dot product between two vector slices.
 *
 * @param vectorA - First numerical vector.
 * @param vectorB - Second numerical vector.
 * @returns Dot product scalar value.
 * @override interface implementation vtable proxy
 */
export function nativeVectorDotProduct(
    vectorA: readonly number[],
    vectorB: readonly number[],
): number {
    return nativeCore.computeVectorDotProduct(vectorA, vectorB);
}

/**
 * Computes cosine similarity between two vector slices.
 *
 * @param vectorA - First numerical vector.
 * @param vectorB - Second numerical vector.
 * @returns Cosine similarity bounded in [-1.0, 1.0].
 * @override interface implementation vtable proxy
 */
export function nativeVectorCosineSimilarity(
    vectorA: readonly number[],
    vectorB: readonly number[],
): number {
    return nativeCore.computeVectorCosineSimilarity(vectorA, vectorB);
}

/**
 * Computes Euclidean distance between two vector slices.
 * @override interface implementation vtable proxy
 *
 * @param vectorA - First numerical vector.
 * @param vectorB - Second numerical vector.
 * @returns Euclidean distance scalar.
 */
export function nativeVectorDistance(
    vectorA: readonly number[],
    vectorB: readonly number[],
): number {
    return nativeCore.computeVectorEuclideanDistance(vectorA, vectorB);
}

/**
 * Calculates SimHash Hamming similarity [0.0, 1.0] between two 64-bit SimHash fingerprints.
 *
 * @param hashA - First 64-bit SimHash (hex or decimal string).
 * @param hashB - Second 64-bit SimHash (hex or decimal string).
 * @returns Similarity score in [0.0, 1.0] rounded to 6 decimal places.
 * @override interface implementation vtable proxy
 */
export function nativeSimHashSimilarity(hashA: string, hashB: string): number {
    return nativeCore.calculateSimHashHammingSimilarity(hashA, hashB);
}

/**
 * Calculates cosine similarity [0.0, 1.0] between two token sequences using 3-gram feature vectors.
 * @override interface implementation vtable proxy
 *
 * @param tokensA - First token sequence.
 * @param tokensB - Second token sequence, expanded into trigram vectors the same way.
 * @returns Cosine similarity score in [0.0, 1.0] rounded to 6 decimal places.
 */
export function nativeTrigramSimilarity(
    tokensA: readonly string[],
    tokensB: readonly string[],
): number {
    return nativeCore.calculateTrigramCosineSimilarity(tokensA, tokensB);
}

/**
 * Scans source code for hardcoded credentials and high-entropy sensitive tokens.
 * @override interface implementation vtable proxy
 *
 * @param sourceText - Target code text.
 * @param options - Scanning options.
 * @returns Array of detected NativeSecretFinding items.
 */
export function scanNativeSecrets(
    sourceText: string,
    options?: NativeSecretScanOptions,
): NativeSecretFinding[] {
    if (typeof nativeCore.scanSecretsNative === 'function') {
        return nativeCore.scanSecretsNative(sourceText, options);
    }
    return scanSecretsShim(sourceText, options);
}

/**
 * Counts lines that repeat within one source text.
 *
 * @param content - Source text whose lines are compared.
 * @returns Number of lines that appear more than once; zero for empty input.
 */
export const nativeCountDuplicateLines = (content: string): number =>
    !content ? 0 : nativeCore.countDuplicateLines(content);

/**
 * Detects contiguous clone blocks inside one source text.
 *
 * @param content - Source text scanned for repeated line windows.
 * @param minCloneLines - Shortest run that still counts as a clone block.
 * @returns Detected clone blocks; empty for empty input or a non-positive window.
 */
export const nativeDetectCloneBlocks = (
    content: string,
    minCloneLines: number,
): NativeCloneBlock[] =>
    !content || minCloneLines <= 0 ? [] : nativeCore.detectCloneBlocks(content, minCloneLines);

/**
 * Builds a MinHash signature for the token stream of one source text.
 *
 * @param content - Source text whose token stream is reduced.
 * @param numPermutations - Signature width; the engine default applies when omitted.
 * @returns Signature vector; empty for empty input.
 */
export const nativeComputeMinHash = (content: string, numPermutations?: number): number[] =>
    !content ? [] : nativeCore.computeMinHash(content, numPermutations);

/**
 * Groups MinHash signatures into clone pairs by locality-sensitive hashing.
 *
 * @param signatures - Signature vectors, one per candidate file.
 * @param threshold - Minimum Jaccard similarity for a pair to be reported.
 * @returns Clone pairs above the threshold; empty when no signatures are supplied.
 */
export const nativeFindClonePairs = (
    signatures: number[][],
    threshold: number,
): NativeClonePair[] =>
    !signatures || signatures.length === 0 ? [] : nativeCore.findClonePairs(signatures, threshold);

/**
 * Computes the immediate-dominator tree of a control flow graph.
 *
 * @param entry - Name of the graph entry node.
 * @param nodes - All node names in the graph.
 * @param edges - Directed `[from, to]` edges.
 * @returns Dominator tree with idom, dominance frontiers, loop headers and back edges; every
 *     mapping is empty when no nodes are supplied.
 */
export const nativeComputeDominatorTree = (
    entry: string,
    nodes: string[],
    edges: Array<[string, string]>,
): NativeDominatorTreeResult => {
    if (!nodes || nodes.length === 0) {
        return {
            entry,
            reachableNodes: [],
            idom: {},
            dominanceFrontiers: {},
            loopHeaders: [],
            backEdges: [],
        };
    }
    return nativeCore.computeDominatorTree(entry, nodes, edges);
};

/**
 * Solves dataflow equations to a fixed point.
 *
 * @param params - Dataflow query carrying the entry node, direction and gen/kill sets.
 * @returns In/out sets per node plus the iteration count; empty when no entry is supplied.
 */
export const nativeSolveDataflow = (params: NativeDataflowParams): NativeDataflowResult =>
    !params || !params.entry
        ? { inSets: {}, outSets: {}, iterations: 0 }
        : nativeCore.solveDataflow(params);

/**
 * Computes the exact Myers edit distance between two symbol sequences.
 *
 * @param pattern - First sequence, one code point per slot.
 * @param text - Second sequence, one code point per slot.
 * @returns Insert/delete distance between the sequences.
 */
export const nativeBitParallelMyersDistance = (pattern: Uint32Array, text: Uint32Array): number =>
    nativeCore.computeBitParallelDistance(pattern, text);

/**
 * Computes the 64-bit SimHash fingerprint of a token sequence.
 *
 * @param tokens - Token sequence to fingerprint.
 * @returns Fingerprint as a lowercase hexadecimal string.
 */
export const nativeSimHash64 = (tokens: readonly string[]): string =>
    nativeCore.computeSimHash64(tokens);

/**
 * Masks source code comments and literals into a single compact joined string.
 *
 * @param content - Target source code content.
 * @param config - Lexical masking configuration.
 * @returns Masked single-string payload.
 */
export const nativeMaskSourceCodeCompact = (content: string, config: NativeMaskConfig): string =>
    !content ? '' : nativeCore.maskSourceCodeCompact(content, config);

/**
 * Analyzes variable scope bindings for shadowing across nested lexical scopes.
 *
 * @param scopes - Array of lexical scope descriptors.
 * @param bindings - Array of variable binding descriptors.
 * @returns Detected shadowing pairs.
 */
export const nativeAnalyzeScopeShadowing = (
    scopes: readonly NativeScopeInput[],
    bindings: readonly NativeBindingInput[],
): NativeShadowingResult[] =>
    !scopes || !bindings || scopes.length === 0 || bindings.length === 0
        ? []
        : nativeCore.analyzeScopeShadowing(scopes, bindings);
