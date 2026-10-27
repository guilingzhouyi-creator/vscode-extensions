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
 *   3. Deliver zero-overhead singleton interface `nativeCore` and convenience helpers.
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
import { computeHistogramDiffShim } from './native-diff-shim';
import { analyzeScopeShadowingShim } from './native-scope-shim';
import { scanSecretsShim } from './native-secrets-shim';
import { countLineStats } from '../../utils/linestats';
import { maskSourceTextJs } from '../policy/source-mask';
import {
    countDuplicateLinesShim,
    detectCloneBlocksShim,
    computeMinHashShim,
    findClonePairsShim,
    computeBitParallelDistanceShim,
    computeSimHash64Shim,
    calculateSimHashHammingSimilarityShim,
    calculateTrigramCosineSimilarityShim,
    computeTemporalCouplingShim,
    evaluateBumpyRoadShim,
    batchProbeTriggersShim,
    HASH_COEFFS,
} from './native-clone-shim';
import { computeDominatorTreeShim, solveDataflowShim } from './native-flow-shim';
import { analyzeDependencyGraphShim } from './native-graph-shim';
import { fastPatternMatchShim } from './native-pattern-shim';
import {
    computeShannonEntropyShim,
    computeStatisticalMomentsShim,
    calculatePopoviciuDispersionPenaltyShim,
    countBracesDetailedShim,
    computeWarshallTransitiveClosureShim,
    computeVectorDotProductShim,
    computeVectorCosineSimilarityShim,
    computeVectorEuclideanDistanceShim,
    selectBinding,
} from './native-math-shim';

export { HASH_COEFFS };

const DEFAULT_CONTEXT_LINES = 3;
const DEFAULT_MINHASH_PERMUTATIONS = 64;
const LARGE_GRAPH_EDGES_THRESHOLD = 1500;
const LARGE_DIFF_BYTES_THRESHOLD = 64 * 1024;
const NATIVE_BINDING_PATH = '../../../crates/auto-refactor-core/index.node';
const ENGINE_PURE_JS: NativeCoreEngineType = 'pure-js-shim';
const ENGINE_RUST_NATIVE: NativeCoreEngineType = 'rust-native';
const VERSION_SHIM = '0.4.0-shim';
const VERSION_NATIVE_FALLBACK = '0.4.0-native';

const CAPABILITY_HISTOGRAM_DIFF = 'histogram-diff';
const CAPABILITY_TARJAN_SCC = 'tarjan-scc';
const CAPABILITY_TOPOLOGICAL_SORT = 'topological-sort';
const CAPABILITY_FAST_PATTERN_MATCH = 'fast-pattern-match';
const CAPABILITY_SIMD_SOURCE_MASK = 'simd-source-mask';
const CAPABILITY_SIMD_SOURCE_MASK_COMPACT = 'simd-source-mask-compact';
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

const CAPABILITY_SIMD_HISTOGRAM_DIFF = 'simd-histogram-diff';
const CAPABILITY_PARALLEL_TARJAN_SCC = 'parallel-tarjan-scc';
const CAPABILITY_ZERO_COPY_BUFFER = 'zero-copy-buffer';

const SHIM_CAPABILITIES: readonly string[] = Object.freeze([
    CAPABILITY_HISTOGRAM_DIFF,
    CAPABILITY_TARJAN_SCC,
    CAPABILITY_TOPOLOGICAL_SORT,
    CAPABILITY_FAST_PATTERN_MATCH,
    CAPABILITY_SIMD_SOURCE_MASK,
    CAPABILITY_SIMD_SOURCE_MASK_COMPACT,
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

const NATIVE_CORE_CAPABILITIES: readonly string[] = Object.freeze([
    ...SHIM_CAPABILITIES,
    CAPABILITY_SIMD_HISTOGRAM_DIFF,
    CAPABILITY_PARALLEL_TARJAN_SCC,
    CAPABILITY_ZERO_COPY_BUFFER,
]);

const MICRO_SOURCE_MASK_THRESHOLD = 256;

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

    /**
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
     * Computes line-level histogram diff hunks between oldContent and newContent.
     */
    public computeHistogramDiff(oldContent: string, newContent: string): NativeDiffHunk[] {
        return computeHistogramDiffShim(oldContent, newContent, this.defaultContextLines);
    }

    /**
     * Analyzes directed dependency graph edges: [from, to] (where `from` depends on `to`).
     * Implements Tarjan's SCC algorithm and topological sort.
     */
    public analyzeDependencyGraph(edges: [string, string][]): NativeGraphAnalysis {
        return analyzeDependencyGraphShim(edges);
    }

    /**
     * Fast multi-pattern textual scanner locating occurrences with 1-based line and column.
     */
    public fastPatternMatch(sourceText: string, patterns: string[]): NativePatternMatch[] {
        return fastPatternMatchShim(sourceText, patterns);
    }

    /**
     * Pure JS fallback implementation of the native operator library.
     */
    public maskSourceCode(content: string, config: NativeMaskConfig): NativeMaskedSource {
        const maskedResult = maskSourceTextJs(content, {
            lineComment: config.lineComment,
            blockComment:
                config.blockCommentOpen && config.blockCommentClose
                    ? { open: config.blockCommentOpen, close: config.blockCommentClose }
                    : undefined,
            quoteChars: config.quoteChars,
            multilineTemplates: config.multilineTemplates,
            regexLiterals: config.regexLiterals,
        });
        const stats = countLineStats(content);
        return {
            raw: maskedResult.raw,
            masked: maskedResult.masked,
            lines: stats.lines,
            nonBlankLines: stats.nonBlankLines,
        };
    }

    /**
     * Pure JS fallback for compact source code masking, emitting a single joined string.
     */
    public maskSourceCodeCompact(content: string, config: NativeMaskConfig): string {
        const maskedResult = maskSourceTextJs(content, {
            lineComment: config.lineComment,
            blockComment:
                config.blockCommentOpen && config.blockCommentClose
                    ? { open: config.blockCommentOpen, close: config.blockCommentClose }
                    : undefined,
            quoteChars: config.quoteChars,
            multilineTemplates: config.multilineTemplates,
            regexLiterals: config.regexLiterals,
        });
        return maskedResult.masked.join('\n');
    }

    /**
     * Counts duplicated non-blank lines using 32-bit line hashes.
     */
    public countDuplicateLines(content: string): number {
        return !content ? 0 : countDuplicateLinesShim(content);
    }

    /**
     * Detects repeated code blocks within a single file.
     */
    public detectCloneBlocks(content: string, minCloneLines: number): NativeCloneBlock[] {
        if (!content || minCloneLines <= 0) return [];
        return detectCloneBlocksShim(content, minCloneLines);
    }

    /**
     * Computes a MinHash signature vector for a source file.
     */
    public computeMinHash(
        content: string,
        numPermutations = DEFAULT_MINHASH_PERMUTATIONS,
    ): number[] {
        return !content ? [] : computeMinHashShim(content, numPermutations);
    }

    /**
     * Discovers similar file pairs using Locality Sensitive Hashing (LSH).
     */
    public findClonePairs(signatures: number[][], threshold: number): NativeClonePair[] {
        if (!signatures || signatures.length === 0) return [];
        return findClonePairsShim(signatures, threshold);
    }

    /**
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
     * Solves forward or backward dataflow equations to a fixed point.
     */
    public solveDataflow(params: NativeDataflowParams): NativeDataflowResult {
        if (!params || !params.entry) {
            return { inSets: {}, outSets: {}, iterations: 0 };
        }
        return solveDataflowShim(params);
    }

    /**
     * Computes the bit-parallel Myers edit distance between two token/line hash arrays.
     */
    public computeBitParallelDistance(pattern: Uint32Array, text: Uint32Array): number {
        return computeBitParallelDistanceShim(pattern, text);
    }

    /**
     * Computes a 64-bit SimHash fingerprint for an array of tokens.
     *
     * @param tokens - Token sequence reduced into a single fingerprint.
     * @returns Zero-padded hexadecimal SimHash of fixed width.
     */
    public computeSimHash64(tokens: readonly string[]): string {
        return computeSimHash64Shim(tokens);
    }

    /**
     * Calculates SimHash Hamming similarity [0.0, 1.0] between SimHash fingerprints.
     *
     * @param hashA - Hexadecimal fingerprint of the first document.
     * @param hashB - Hexadecimal fingerprint of the second document.
     * @returns Similarity in `0..1`, where 1 means the fingerprints are identical.
     */
    public calculateSimHashHammingSimilarity(hashA: string, hashB: string): number {
        return calculateSimHashHammingSimilarityShim(hashA, hashB);
    }

    /**
     * Calculates cosine similarity [0.0, 1.0] between token sequences via 3-gram vectors.
     *
     * @param tokensA - First token sequence.
     * @param tokensB - Second token sequence.
     * @returns Cosine similarity of the two trigram vectors in `0..1`.
     */
    public calculateTrigramCosineSimilarity(
        tokensA: readonly string[],
        tokensB: readonly string[],
    ): number {
        return calculateTrigramCosineSimilarityShim(tokensA, tokensB);
    }

    /**
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
     * Fast vectorized batch probe testing multiple trigger groups against target content.
     */
    public batchProbeTriggers(
        content: string,
        triggerGroups: readonly (readonly string[])[],
    ): boolean[] {
        return batchProbeTriggersShim(content, triggerGroups);
    }

    /**
     * Computes Shannon Information Entropy H(X) in bits.
     */
    public computeShannonEntropy(text: string): number {
        return computeShannonEntropyShim(text);
    }

    /**
     * Computes first and second statistical moments in a single online pass.
     */
    public computeStatisticalMoments(values: readonly number[]): NativeStatisticalMoments {
        return computeStatisticalMomentsShim(values);
    }

    /**
     * Calculates Popoviciu's inequality dispersion discount factor in [0.0, 1.0].
     */
    public calculatePopoviciuDispersionPenalty(
        standardDeviation: number,
        maxSigma?: number,
        gamma?: number,
    ): number {
        return calculatePopoviciuDispersionPenaltyShim(standardDeviation, maxSigma, gamma);
    }

    /**
     * Counts opening and closing curly braces in a line with detailed breakdown.
     */
    public countBracesDetailed(line: string): NativeBraceBalance {
        return countBracesDetailedShim(line);
    }

    /**
     * Computes transitive closure over a dense boolean adjacency matrix using Warshall's algorithm.
     */
    public computeWarshallTransitiveClosure(matrix: Uint8Array, size: number): Uint8Array {
        return computeWarshallTransitiveClosureShim(matrix, size);
    }

    /**
     * Computes inner dot product between two vector slices.
     */
    public computeVectorDotProduct(vectorA: readonly number[], vectorB: readonly number[]): number {
        return computeVectorDotProductShim(vectorA, vectorB);
    }

    /**
     * Computes cosine similarity between two vector slices.
     */
    public computeVectorCosineSimilarity(
        vectorA: readonly number[],
        vectorB: readonly number[],
    ): number {
        return computeVectorCosineSimilarityShim(vectorA, vectorB);
    }

    /**
     * Computes Euclidean distance between two vector slices.
     */
    public computeVectorEuclideanDistance(
        vectorA: readonly number[],
        vectorB: readonly number[],
    ): number {
        return computeVectorEuclideanDistanceShim(vectorA, vectorB);
    }

    /**
     * Pure JS fallback analyzing variable scope hierarchy and discovering symbol shadowing.
     */
    public analyzeScopeShadowing(
        scopes: readonly NativeScopeInput[],
        bindings: readonly NativeBindingInput[],
    ): NativeShadowingResult[] {
        return analyzeScopeShadowingShim(scopes, bindings);
    }

    /**
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
    readonly fastPatternMatch: (sourceText: string, patterns: string[]) => NativePatternMatch[];
    readonly maskSourceCode: (content: string, config: NativeMaskConfig) => NativeMaskedSource;
    readonly maskSourceCodeCompact?: (content: string, config: NativeMaskConfig) => string;
    readonly countDuplicateLines: (content: string) => number;
    readonly detectCloneBlocks: (content: string, minCloneLines: number) => NativeCloneBlock[];
    readonly computeMinHash?: (content: string, numPermutations?: number) => number[];
    readonly computeMinhash?: (content: string, numPermutations?: number) => number[];
    readonly findClonePairs: (signatures: number[][], threshold: number) => NativeClonePair[];
    readonly computeDominatorTree: (
        entry: string,
        nodes: string[],
        edges: Array<[string, string]>,
    ) => NativeDominatorTreeResult;
    readonly solveDataflow: (
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

function assembleNativeBindingCore(
    binding: RawNativeBinding,
    jsShim: PureJsNativeShim,
): INativeCore {
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
        fastPatternMatch: binding.fastPatternMatch,
        maskSourceCode: (content: string, config: NativeMaskConfig) => {
            // Performance guard: Returning Vec<String> arrays across N-API incurs thousands of V8
            // string allocations (measured 1.8x slower than JS). jsShim avoids FFI allocation churn.
            // For pure SIMD acceleration, maskSourceCodeCompact provides 1.50x speedup with single string output.
            return jsShim.maskSourceCode(content, config);
        },
        maskSourceCodeCompact: selectBinding(binding.maskSourceCodeCompact, (content, config) =>
            jsShim.maskSourceCodeCompact(content, config),
        ),
        countDuplicateLines: binding.countDuplicateLines,
        detectCloneBlocks: binding.detectCloneBlocks,
        computeMinHash: resolveMinHashBinding(binding, jsShim),
        findClonePairs: binding.findClonePairs,
        computeDominatorTree: binding.computeDominatorTree,
        solveDataflow: (params: NativeDataflowParams) =>
            binding.solveDataflow(
                params.entry,
                params.nodes ?? [],
                params.edges,
                params.forward ?? true,
                params.gen ?? {},
                params.kill ?? {},
            ),
        computeBitParallelDistance: selectBinding(
            binding.computeBitParallelDistance,
            (pattern, text) => jsShim.computeBitParallelDistance(pattern, text),
        ),
        computeSimHash64: selectBinding(binding.computeSimHash64, (tokens) =>
            jsShim.computeSimHash64(tokens),
        ),
        calculateSimHashHammingSimilarity: selectBinding(
            binding.calculateSimHashHammingSimilarity,
            (hashA, hashB) => jsShim.calculateSimHashHammingSimilarity(hashA, hashB),
        ),
        calculateTrigramCosineSimilarity: (tokensA: string[], tokensB: string[]) => {
            // Adaptive threshold: For small-to-medium token arrays (< 500), N-API string
            // array marshaling costs more than JS JIT trigram computation.
            if (tokensA.length < 500 && tokensB.length < 500) {
                return jsShim.calculateTrigramCosineSimilarity(tokensA, tokensB);
            }
            const nativeFn = binding.calculateTrigramCosineSimilarity;
            return typeof nativeFn === 'function'
                ? nativeFn(tokensA, tokensB)
                : jsShim.calculateTrigramCosineSimilarity(tokensA, tokensB);
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
        computeShannonEntropy: selectBinding(binding.computeShannonEntropy, (text) =>
            jsShim.computeShannonEntropy(text),
        ),
        computeStatisticalMoments: selectBinding(binding.computeStatisticalMoments, (values) =>
            jsShim.computeStatisticalMoments(values),
        ),
        calculatePopoviciuDispersionPenalty: selectBinding(
            binding.calculatePopoviciuDispersionPenalty,
            (stdDev, maxSigma, gamma) =>
                jsShim.calculatePopoviciuDispersionPenalty(stdDev, maxSigma, gamma),
        ),
        countBracesDetailed: selectBinding(binding.countBracesDetailed, (line) =>
            jsShim.countBracesDetailed(line),
        ),
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
        analyzeScopeShadowing: (scopes, bindings) => {
            // Performance guard & rollback: Passing hundreds/thousands of individual JS objects across
            // N-API causes heavy FFI property extraction and string conversions (measured 5.2x slower than JS).
            // Pure JS Shim optimizes via in-memory V8 Inline Caches in 0.15ms vs Rust NAPI 0.78ms.
            // Under zero-regression mandate, we route to the 5.2x faster pure JS Shim.
            return jsShim.analyzeScopeShadowing(scopes, bindings);
        },
        scanSecretsNative: selectBinding(binding.scanSecretsNative, (sourceText, options) =>
            jsShim.scanSecretsNative(sourceText, options),
        ),
        getStatus: () => ({
            isNativeAvailable: true,
            activeEngine: ENGINE_RUST_NATIVE,
            version: resolveNativeVersion(binding),
            capabilities: [...NATIVE_CORE_CAPABILITIES],
        }),
    };
}

function loadNativeBindingModule(): RawNativeBinding | null {
    try {
        const modulePath = NATIVE_BINDING_PATH;
        const dynamicLoader = typeof require === 'function' ? require : undefined;
        if (!dynamicLoader) return null;
        const binding = dynamicLoader(modulePath) as RawNativeBinding;
        if (binding && typeof binding.computeHistogramDiff === 'function') {
            return binding;
        }
    } catch (_err) {
        void _err;
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
 * @returns Active native core engine status descriptor.
 */
export function getNativeCoreStatus(): NativeCoreStatus {
    const status = nativeCore.getStatus();
    return Object.freeze({
        isNativeAvailable: status.isNativeAvailable,
        activeEngine: status.activeEngine,
        version: status.version,
        capabilities: Object.freeze([...status.capabilities]) as unknown as string[],
    });
}

/**
 * Computes line-level histogram diffs with identical-content short-circuit optimization.
 *
 * @param oldContent - Original text content.
 * @param newContent - Updated text content.
 * @returns Array of computed NativeDiffHunk elements.
 */
export function computeNativeHistogramDiff(
    oldContent: string,
    newContent: string,
): NativeDiffHunk[] {
    return oldContent === newContent ? [] : nativeCore.computeHistogramDiff(oldContent, newContent);
}

/**
 * Analyzes dependency graph topology with empty edge defensive bypass.
 *
 * @param edges - Array of directed [from, to] dependency edges.
 * @returns Graph analysis result with cycles, topological order, and SCCs.
 */
export function analyzeNativeDependencyGraph(edges: [string, string][]): NativeGraphAnalysis {
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
 *
 * @param sourceText - Target text to search.
 * @param patterns - Pattern strings to match against source.
 * @returns Array of pattern matches with offsets and line numbers.
 */
export function matchNativeFastPatterns(
    sourceText: string,
    patterns: string[],
): NativePatternMatch[] {
    if (!sourceText || !patterns || patterns.length === 0) return [];
    return nativeCore.fastPatternMatch(sourceText, patterns);
}

/**
 * Masks source code comments and literals with blank text guard.
 *
 * @param content - Target source code content.
 * @param config - Lexical masking configuration.
 * @returns Masked source text structure with line metrics.
 */
export function maskNativeSourceCode(
    content: string,
    config: NativeMaskConfig,
): NativeMaskedSource {
    if (!content) {
        return { raw: [], masked: [], lines: 0, nonBlankLines: 0 };
    }
    return nativeCore.maskSourceCode(content, config);
}

/**
 * Counts duplicated non-blank lines with empty content guard.
 *
 * @param content - Target source code content.
 * @returns Number of duplicated occurrences beyond the first.
 */
export function countNativeDuplicateLines(content: string): number {
    return !content ? 0 : nativeCore.countDuplicateLines(content);
}

/**
 * Detects code clone blocks within a file with bounds checks.
 *
 * @param content - Target source code content.
 * @param minCloneLines - Minimum consecutive lines to constitute a clone.
 * @returns Detected clone block descriptors.
 */
export function detectNativeCloneBlocks(
    content: string,
    minCloneLines: number,
): NativeCloneBlock[] {
    if (!content || minCloneLines <= 0) return [];
    return nativeCore.detectCloneBlocks(content, minCloneLines);
}

/**
 * Computes MinHash signature of a file with content presence check.
 *
 * @param content - Target source code content.
 * @param numPermutations - Number of permutations.
 * @returns MinHash signature vector.
 */
export function computeNativeMinHash(content: string, numPermutations?: number): number[] {
    return !content ? [] : nativeCore.computeMinHash(content, numPermutations);
}

/**
 * Discovers similar file pairs using LSH with signature validation.
 *
 * @param signatures - Array of file MinHash signatures.
 * @param threshold - Similarity threshold between 0.0 and 1.0.
 * @returns Array of detected similar file pairs with similarity scores.
 */
export function findNativeClonePairs(signatures: number[][], threshold: number): NativeClonePair[] {
    if (!signatures || signatures.length === 0) {
        return [];
    }
    return nativeCore.findClonePairs(signatures, threshold);
}

/**
 * Computes immediate dominators and dominance frontiers with node list defense.
 *
 * @param entry - Entry node identifier.
 * @param nodes - Node identifiers list.
 * @param edges - Directed edges list.
 * @returns Computed dominator tree result.
 */
export function computeNativeDominatorTree(
    entry: string,
    nodes: string[],
    edges: Array<[string, string]>,
): NativeDominatorTreeResult {
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
}

/**
 * Solves forward or backward dataflow equations to a fixed point.
 *
 * @param params - Dataflow configuration parameters.
 * @returns In and Out sets at fixed-point convergence.
 */
export function solveNativeDataflow(params: NativeDataflowParams): NativeDataflowResult {
    if (!params || !params.entry) {
        return { inSets: {}, outSets: {}, iterations: 0 };
    }
    return nativeCore.solveDataflow(params);
}

/**
 * Computes the bit-parallel Myers edit distance between two token/line hash arrays.
 *
 * @param pattern - Pattern line/token hashes (length <= 64 for native SIMD SWAR).
 * @param text - Text line/token hashes to compare against.
 * @returns Minimum insert/delete edit distance.
 */
export function computeNativeBitParallelDistance(pattern: Uint32Array, text: Uint32Array): number {
    return nativeCore.computeBitParallelDistance(pattern, text);
}

/**
 * Computes a 64-bit SimHash fingerprint for an array of tokens.
 *
 * @param tokens - Ordered token strings.
 * @returns 16-character lowercase hexadecimal 64-bit fingerprint string.
 */
export function computeNativeSimHash64(tokens: readonly string[]): string {
    return nativeCore.computeSimHash64(tokens);
}

/**
 * Calculates SimHash Hamming similarity [0.0, 1.0] between two 64-bit SimHash fingerprints.
 *
 * @param hashA - First 64-bit SimHash (hex or decimal string).
 * @param hashB - Second 64-bit SimHash (hex or decimal string).
 * @returns Similarity score in [0.0, 1.0] rounded to 6 decimal places.
 */
export function calculateNativeSimHashSimilarity(hashA: string, hashB: string): number {
    return nativeCore.calculateSimHashHammingSimilarity(hashA, hashB);
}

/** Backward-compatibility alias for calculateNativeSimHashSimilarity. */
export const calculateNativeSimHashHammingSimilarity = calculateNativeSimHashSimilarity;

/**
 * Calculates cosine similarity [0.0, 1.0] between two token sequences using 3-gram feature vectors.
 *
 * @param tokensA - First token sequence.
 * @param tokensB - Second token sequence, expanded into trigram vectors the same way.
 * @returns Cosine similarity score in [0.0, 1.0] rounded to 6 decimal places.
 */
export function calculateNativeTrigramSimilarity(
    tokensA: readonly string[],
    tokensB: readonly string[],
): number {
    return nativeCore.calculateTrigramCosineSimilarity(tokensA, tokensB);
}

/** Backward-compatibility alias for calculateNativeTrigramSimilarity. */
export const calculateNativeTrigramCosineSimilarity = calculateNativeTrigramSimilarity;

/**
 * Computes pairwise co-change frequencies and Jaccard similarity between files.
 *
 * @param changesets - Commit-sized groups of file ids, each listing files changed together.
 * @param minShared - Floor on how often two files must co-occur before the pair is reported.
 * @param minJaccard - Floor on the Jaccard overlap of the two files' change sets.
 * @returns Co-change pairs that clear both thresholds, as reported by the native miner.
 */
export function computeNativeTemporalCoupling(
    changesets: number[][],
    minShared: number,
    minJaccard: number,
): NativeTemporalCouplingPair[] {
    return nativeCore.computeTemporalCoupling(changesets, minShared, minJaccard);
}

/**
 * Measures structural irregularity and spatial variance of indentation/nesting depth.
 *
 * @param lines - Source lines of the file being inspected.
 * @param startLine - One-based first line of the function region to evaluate.
 * @param endLine - One-based last line of that region, inclusive.
 * @returns Nested-depth profile for the region, including whether it qualifies as bumpy.
 */
export function evaluateNativeBumpyRoad(
    lines: readonly string[],
    startLine: number,
    endLine: number,
): NativeBumpyRoadResult {
    return nativeCore.evaluateBumpyRoad(lines, startLine, endLine);
}

/**
 * Fast vectorized batch probe testing multiple trigger groups against target content.
 *
 * @param content - Text scanned for the trigger groups.
 * @param triggerGroups - One trigger set per probed group; an empty group always matches.
 * @returns One flag per group, in the same order as the input groups.
 */
export function batchProbeNativeTriggers(
    content: string,
    triggerGroups: readonly (readonly string[])[],
): boolean[] {
    return nativeCore.batchProbeTriggers(content, triggerGroups);
}

/**
 * Computes Shannon Information Entropy H(X) in bits.
 *
 * @param text - Input string to measure.
 * @returns Shannon entropy in bits rounded to 2 decimal places.
 */
export function computeNativeShannonEntropy(text: string): number {
    return nativeCore.computeShannonEntropy(text);
}

/**
 * Computes first and second statistical moments in a single online pass.
 *
 * @param values - Array of numerical values.
 * @returns NativeStatisticalMoments summary descriptor.
 */
export function computeNativeStatisticalMoments(
    values: readonly number[],
): NativeStatisticalMoments {
    return nativeCore.computeStatisticalMoments(values);
}

/**
 * Calculates Popoviciu's inequality dispersion discount factor in [0.0, 1.0].
 *
 * @param standardDeviation - Sample standard deviation.
 * @param maxSigma - Theoretical maximum standard deviation (default 50.0).
 * @param gamma - Penalty elasticity factor (default 0.5).
 * @returns Discount multiplier in [0.0, 1.0].
 */
export function calculateNativePopoviciuPenalty(
    standardDeviation: number,
    maxSigma?: number,
    gamma?: number,
): number {
    return nativeCore.calculatePopoviciuDispersionPenalty(standardDeviation, maxSigma, gamma);
}

/** Backward-compatibility alias for calculateNativePopoviciuPenalty. */
export const calculateNativePopoviciuDispersionPenalty = calculateNativePopoviciuPenalty;

/**
 * Counts opening and closing curly braces in a line with detailed breakdown.
 *
 * @param line - Text line to inspect.
 * @returns NativeBraceBalance containing opens, closes, and delta.
 */
export function countNativeBracesDetailed(line: string): NativeBraceBalance {
    return nativeCore.countBracesDetailed(line);
}

/**
 * Computes transitive closure over a dense boolean adjacency matrix using Warshall's algorithm.
 *
 * @param matrix - Row-major Uint8Array flat buffer of size * size.
 * @param size - Number of vertices in the square matrix.
 * @returns In-place mutated matrix with full reachability.
 */
export function computeNativeWarshallClosure(matrix: Uint8Array, size: number): Uint8Array {
    return nativeCore.computeWarshallTransitiveClosure(matrix, size);
}

/** Backward-compatibility alias for computeNativeWarshallClosure. */
export const computeNativeWarshallTransitiveClosure = computeNativeWarshallClosure;

/**
 * Computes inner dot product between two vector slices.
 *
 * @param vectorA - First numerical vector.
 * @param vectorB - Second numerical vector.
 * @returns Dot product scalar value.
 */
export function computeNativeVectorDotProduct(
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
 */
export function computeNativeVectorCosineSimilarity(
    vectorA: readonly number[],
    vectorB: readonly number[],
): number {
    return nativeCore.computeVectorCosineSimilarity(vectorA, vectorB);
}

/**
 * Computes Euclidean distance between two vector slices.
 *
 * @param vectorA - First numerical vector.
 * @param vectorB - Second numerical vector.
 * @returns Euclidean distance scalar.
 */
export function computeNativeVectorDistance(
    vectorA: readonly number[],
    vectorB: readonly number[],
): number {
    return nativeCore.computeVectorEuclideanDistance(vectorA, vectorB);
}

/** Backward-compatibility alias for computeNativeVectorDistance. */
export const computeNativeVectorEuclideanDistance = computeNativeVectorDistance;

// ─── Substantive Backwards-Compatibility Aliases ────────────────────────────

/** Backward compatibility alias for computeNativeHistogramDiff. */
export const nativeHistogramDiff = computeNativeHistogramDiff;

/** Backward compatibility alias for analyzeNativeDependencyGraph. */
export const nativeAnalyzeDependencyGraph = analyzeNativeDependencyGraph;

/** Backward compatibility alias for matchNativeFastPatterns. */
export const nativeFastPatternMatch = matchNativeFastPatterns;

/** Backward compatibility alias for maskNativeSourceCode. */
export const nativeMaskSourceCode = maskNativeSourceCode;

/** Backward compatibility alias for countNativeDuplicateLines. */
export const nativeCountDuplicateLines = countNativeDuplicateLines;

/** Backward compatibility alias for detectNativeCloneBlocks. */
export const nativeDetectCloneBlocks = detectNativeCloneBlocks;

/** Backward compatibility alias for computeNativeMinHash. */
export const nativeComputeMinHash = computeNativeMinHash;

/** Backward compatibility alias for findNativeClonePairs. */
export const nativeFindClonePairs = findNativeClonePairs;

/** Backward compatibility alias for computeNativeDominatorTree. */
export const nativeComputeDominatorTree = computeNativeDominatorTree;

/** Backward compatibility alias for solveNativeDataflow. */
export const nativeSolveDataflow = solveNativeDataflow;

/** Backward compatibility alias for computeNativeBitParallelDistance. */
export const nativeBitParallelMyersDistance = computeNativeBitParallelDistance;

/** Backward compatibility alias for computeNativeSimHash64. */
export const nativeSimHash64 = computeNativeSimHash64;

/** Backward compatibility alias for calculateNativeSimHashHammingSimilarity. */
export const nativeSimHashHammingSimilarity = calculateNativeSimHashHammingSimilarity;
export const nativeSimHashSimilarity = calculateNativeSimHashSimilarity;

/** Backward compatibility alias for calculateNativeTrigramCosineSimilarity. */
export const nativeTrigramCosineSimilarity = calculateNativeTrigramCosineSimilarity;
export const nativeTrigramSimilarity = calculateNativeTrigramSimilarity;

/** Backward compatibility alias for computeNativeShannonEntropy. */
export const nativeShannonEntropy = computeNativeShannonEntropy;

/** Backward compatibility alias for computeNativeStatisticalMoments. */
export const nativeStatisticalMoments = computeNativeStatisticalMoments;

/** Backward compatibility alias for calculateNativePopoviciuDispersionPenalty. */
export const nativePopoviciuDispersionPenalty = calculateNativePopoviciuDispersionPenalty;
export const nativePopoviciuPenalty = calculateNativePopoviciuPenalty;

/** Backward compatibility alias for countNativeBracesDetailed. */
export const nativeCountBracesDetailed = countNativeBracesDetailed;

/** Backward compatibility alias for computeNativeWarshallTransitiveClosure. */
export const nativeWarshallTransitiveClosure = computeNativeWarshallTransitiveClosure;
export const nativeWarshallClosure = computeNativeWarshallClosure;

/** Backward compatibility alias for computeNativeVectorDotProduct. */
export const nativeVectorDotProduct = computeNativeVectorDotProduct;

/** Backward compatibility alias for computeNativeVectorCosineSimilarity. */
export const nativeVectorCosineSimilarity = computeNativeVectorCosineSimilarity;

/** Backward compatibility alias for computeNativeVectorEuclideanDistance. */
export const nativeVectorEuclideanDistance = computeNativeVectorEuclideanDistance;
export const nativeVectorDistance = computeNativeVectorDistance;

/**
 * Scans source code for hardcoded credentials and high-entropy sensitive tokens.
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

/** Exported alias for scanNativeSecrets. */
export const scanSecrets = scanNativeSecrets;
