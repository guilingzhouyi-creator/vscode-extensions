/**
 * Module: Core Engine - Multi-Dimensional Tensor-Parallel Partitioner
 * File Path: src/core/scheduler/tensor-partitioner.ts
 * Architecture Role: Decomposes large-scale code review workloads across 3 orthogonal
 *   tensor dimensions: Data, Rules, and Dependency Depth (topological layers).
 * Dependencies & Triggers: Consumes execution scheduler types and topology cache;
 *   invoked by sparse orchestrator.
 * Responsibilities:
 *   1. Slice file corpus into weakly-coupled semantic clusters (Data dimension);
 *   2. Partition rule pyramid into independent review families (Rule dimension);
 *   3. Stratify files into topological dependency depth bands (Dependency Depth dimension);
 *   4. Emit TensorPartitionCell units for parallel dispatch.
 * Exit Semantics & Design Rationale: Pure deterministic computation completing in < 10ms.
 */

/**
 * Single unit of tensor-partitioned execution.
 */
export interface TensorPartitionCell {
    readonly cellId: string;
    readonly dataFiles: string[];
    readonly ruleFamily: string;
    readonly ruleAnalyzers: string[];
    readonly dependencyDepth: number;
    readonly estimatedCost: number;
}

/**
 * Output of tensor-parallel workload partitioning.
 */
export interface TensorPartitionPlan {
    readonly cells: TensorPartitionCell[];
    readonly totalCells: number;
    readonly dataDimensionSize: number;
    readonly ruleDimensionSize: number;
    readonly maxDependencyDepth: number;
    readonly estimatedTotalComputeCost: number;
}

import {
    ANALYZER_COMMENTS,
    ANALYZER_NAMING,
    ANALYZER_STANDARDIZATION,
    ANALYZER_COMPLEXITY,
    ANALYZER_PERFORMANCE,
    ANALYZER_LARGE_FILE,
    ANALYZER_CONSTANTS,
    ANALYZER_SECURITY,
    ANALYZER_ARCHITECTURE,
    ANALYZER_DEPENDENCY_GRAPH,
} from '../constants/rule-codes';

const CHAR_CODE_SLASH = 47;
const CHAR_CODE_BACKSLASH = 92;
const MAX_PATH_SEGMENTS = 3;
const DEFAULT_MAX_FILES_PER_CLUSTER = 15;
const MAX_DEPTH_ITERATIONS = 20;
const MODULE_ROOT = 'root';
const DIR_SRC = 'src';
const DIR_LIB = 'lib';

/**
 * Standard orthogonal rule families for tensor rule dimension.
 */
export const DEFAULT_TENSOR_RULE_FAMILIES: Record<string, string[]> = {
    HYGIENE_AND_STYLE: [ANALYZER_COMMENTS, ANALYZER_NAMING, ANALYZER_STANDARDIZATION],
    LOGIC_AND_PERFORMANCE: [ANALYZER_COMPLEXITY, ANALYZER_PERFORMANCE, ANALYZER_LARGE_FILE],
    SECURITY_AND_SECRETS: [ANALYZER_CONSTANTS, ANALYZER_SECURITY],
    ARCHITECTURE_AND_BOUNDARIES: [ANALYZER_ARCHITECTURE, ANALYZER_DEPENDENCY_GRAPH],
};

/**
 * Context for generating tensor cells for a specific module and depth layer.
 */
interface CellBuilderContext {
    moduleKey: string;
    depth: number;
    ruleFamilyEntries: [string, string[]][];
    cellSeq: { current: number };
}

/**
 * Creates tensor partition cells across rule families for a file chunk.
 */
function createCellsForChunk(
    chunk: string[],
    ctx: CellBuilderContext,
): { cells: TensorPartitionCell[]; cost: number } {
    const cells: TensorPartitionCell[] = [];
    let cost = 0;
    for (const [familyName, analyzers] of ctx.ruleFamilyEntries) {
        const estimatedCost = chunk.length * analyzers.length * (ctx.depth + 1);
        cost += estimatedCost;
        const seq = ctx.cellSeq.current++;
        cells.push({
            cellId: `tensor-${ctx.moduleKey.replace(/[^a-zA-Z0-9_-]/g, '-')}-d${ctx.depth}-r${seq}`,
            dataFiles: chunk,
            ruleFamily: familyName,
            ruleAnalyzers: analyzers,
            dependencyDepth: ctx.depth,
            estimatedCost,
        });
    }
    return { cells, cost };
}

/**
 * Creates tensor partition cells for a single depth band.
 */
function createDepthPartitionCells(
    depthFiles: string[],
    maxChunkSize: number,
    ctx: CellBuilderContext,
    targetCells: TensorPartitionCell[],
): number {
    let addedCost = 0;
    for (let chunkStart = 0; chunkStart < depthFiles.length; chunkStart += maxChunkSize) {
        const chunk = depthFiles.slice(chunkStart, chunkStart + maxChunkSize);
        const sub = createCellsForChunk(chunk, ctx);
        addedCost += sub.cost;
        for (const cell of sub.cells) {
            targetCells.push(cell);
        }
    }
    return addedCost;
}

/**
 * Retrieves an existing bucket array from a Map, or allocates and registers a new one.
 */
function getOrCreateBucket<K, V>(map: Map<K, V[]>, key: K): V[] {
    let bucket = map.get(key);
    if (!bucket) {
        bucket = [];
        map.set(key, bucket);
    }
    return bucket;
}

/**
 * Groups files of a single cluster by their dependency depth.
 */
function collectFilesByDepth(
    clusterFiles: string[],
    depthMap: Map<string, number>,
): Map<number, string[]> {
    const filesByDepthMap = new Map<number, string[]>();
    for (const file of clusterFiles) {
        const depth = depthMap.get(file) ?? 0;
        getOrCreateBucket(filesByDepthMap, depth).push(file);
    }
    return filesByDepthMap;
}

/**
 * Builds dependency adjacency list without per-iteration heap container instantiation.
 */
function buildImportsGraph(edges: [string, string][]): Map<string, string[]> {
    const importsByFile = new Map<string, string[]>();
    for (const [fromFile, toFile] of edges) {
        getOrCreateBucket(importsByFile, fromFile).push(toFile);
    }
    return importsByFile;
}

/**
 * Computes maximum dependency depth among all imported predecessors.
 */
function computeMaxPredecessorDepth(importedFiles: string[], depths: Map<string, number>): number {
    let currentMax = 0;
    for (const imp of importedFiles) {
        const impDepth = depths.get(imp) ?? 0;
        if (impDepth > currentMax) {
            currentMax = impDepth;
        }
    }
    return currentMax;
}

/** Checks whether character code is a path separator */
function isSlash(code: number): boolean {
    return code === CHAR_CODE_SLASH || code === CHAR_CODE_BACKSLASH;
}

/** Advances index past contiguous path separators */
function advancePastSlashes(pathStr: string, fromIndex: number, totalLength: number): number {
    let cursorIndex = fromIndex;
    while (cursorIndex < totalLength && isSlash(pathStr.charCodeAt(cursorIndex))) {
        cursorIndex++;
    }
    return cursorIndex;
}

/** Finds index of next path separator */
function findNextSlash(pathStr: string, fromIndex: number, totalLength: number): number {
    let cursorIndex = fromIndex;
    while (cursorIndex < totalLength && !isSlash(pathStr.charCodeAt(cursorIndex))) {
        cursorIndex++;
    }
    return cursorIndex;
}

/** Intermediate decomposed path segments */
interface ExtractedPathParts {
    readonly primarySegment: string;
    readonly secondarySegment: string;
    readonly partsCount: number;
}

/**
 * Parses leading path segments into prefix elements.
 */
function parsePathPrefixSegments(filePath: string): ExtractedPathParts {
    const totalLength = filePath.length;
    let cursorIndex = advancePastSlashes(filePath, 0, totalLength);
    if (cursorIndex >= totalLength) {
        return { primarySegment: '', secondarySegment: '', partsCount: 0 };
    }

    const segments: string[] = [];
    while (cursorIndex < totalLength && segments.length < MAX_PATH_SEGMENTS) {
        const next = findNextSlash(filePath, cursorIndex, totalLength);
        segments.push(filePath.substring(cursorIndex, next));
        cursorIndex = advancePastSlashes(filePath, next, totalLength);
    }

    const hasRemaining = cursorIndex < totalLength ? 1 : 0;
    const isSrcOrLib = segments[0] === DIR_SRC || segments[0] === DIR_LIB;
    const startIndex = isSrcOrLib ? 1 : 0;
    const partsCount = segments.length - startIndex + hasRemaining;
    const primarySegment = segments[startIndex] ?? '';
    const secondarySegment = segments[startIndex + 1] ?? '';

    return { primarySegment, secondarySegment, partsCount };
}

/**
 * Fast low-allocation extraction of module group key.
 * Avoids split/filter/slice arrays by tokenizing path segments on the fly.
 *
 * @param filePath - Path to cluster
 * @returns Semantic module group key
 */
export function extractModuleGroupKeyFast(filePath: string): string {
    const { primarySegment, secondarySegment, partsCount } = parsePathPrefixSegments(filePath);
    if (partsCount <= 1) {
        return MODULE_ROOT;
    }
    return partsCount === 2 ? primarySegment : `${primarySegment}/${secondarySegment}`;
}

interface ClusterCellParams {
    moduleKey: string;
    clusterFiles: string[];
    depthMap: Map<string, number>;
    ruleFamilyEntries: [string, string[]][];
    cellSeq: { current: number };
    targetCells: TensorPartitionCell[];
}

/**
 * Multi-dimensional Tensor-Parallel Partitioner.
 */
export class TensorPartitioner {
    private readonly maxFilesPerDataCluster: number;

    public constructor(maxFilesPerDataCluster = DEFAULT_MAX_FILES_PER_CLUSTER) {
        this.maxFilesPerDataCluster = Math.max(1, maxFilesPerDataCluster);
    }

    /**
     * Appends tensor partition cells for a specific module cluster across all its depth bands.
     */
    private appendClusterCells(params: ClusterCellParams): number {
        const { moduleKey, clusterFiles, depthMap, ruleFamilyEntries, cellSeq, targetCells } =
            params;
        let clusterCost = 0;
        const filesByDepthMap = collectFilesByDepth(clusterFiles, depthMap);
        for (const [depth, depthFiles] of filesByDepthMap.entries()) {
            const ctx: CellBuilderContext = {
                moduleKey,
                depth,
                ruleFamilyEntries,
                cellSeq,
            };
            clusterCost += createDepthPartitionCells(
                depthFiles,
                this.maxFilesPerDataCluster,
                ctx,
                targetCells,
            );
        }
        return clusterCost;
    }

    /**
     * Partitions workload across (Data × Rule × DependencyDepth) 3D tensor grid.
     *
     * @param files - List of file paths to review
     * @param edges - Dependency graph edges: [from, to] (where `from` imports `to`)
     * @param ruleFamilies - Optional custom rule families mapping
     * @returns Complete tensor partition plan
     */
    public partitionWorkload(
        files: string[],
        edges: [string, string][] = [],
        ruleFamilies: Record<string, string[]> = DEFAULT_TENSOR_RULE_FAMILIES,
    ): TensorPartitionPlan {
        if (!files || files.length === 0) {
            return {
                cells: [],
                totalCells: 0,
                dataDimensionSize: 0,
                ruleDimensionSize: 0,
                maxDependencyDepth: 0,
                estimatedTotalComputeCost: 0,
            };
        }

        // 1. Compute Topological Dependency Depth for each file
        const depthMap = this.computeDependencyDepths(files, edges);
        let maxDepth = 0;
        for (const d of depthMap.values()) {
            if (d > maxDepth) {
                maxDepth = d;
            }
        }

        // 2. Data Clustering: Group by module directory prefix
        const dataClusters = this.groupFilesByModuleAffinity(files);

        // 3. Assemble 3D Tensor Cells: (DataCluster × Depth × RuleFamily)
        const cells: TensorPartitionCell[] = [];
        let totalCost = 0;
        const cellSeq = { current: 1 };
        const ruleFamilyEntries = Object.entries(ruleFamilies);

        for (const [moduleKey, clusterFiles] of dataClusters.entries()) {
            totalCost += this.appendClusterCells({
                moduleKey,
                clusterFiles,
                depthMap,
                ruleFamilyEntries,
                cellSeq,
                targetCells: cells,
            });
        }

        return {
            cells,
            totalCells: cells.length,
            dataDimensionSize: dataClusters.size,
            ruleDimensionSize: ruleFamilyEntries.length,
            maxDependencyDepth: maxDepth,
            estimatedTotalComputeCost: totalCost,
        };
    }

    /**
     * Backward-compatible delegation to {@link partitionWorkload}.
     */
    public partition(
        files: string[],
        edges: [string, string][] = [],
        ruleFamilies: Record<string, string[]> = DEFAULT_TENSOR_RULE_FAMILIES,
    ): TensorPartitionPlan {
        return this.partitionWorkload(files, edges, ruleFamilies);
    }

    /**
     * Computes topological depth layer for files based on directed dependency edges.
     * Leaf / independent modules get depth 0; importers get max(depth of imported) + 1.
     */
    private computeDependencyDepths(
        files: string[],
        edges: [string, string][],
    ): Map<string, number> {
        const depthsByFile = new Map<string, number>();
        for (const f of files) {
            depthsByFile.set(f, 0);
        }

        const importsByFile = buildImportsGraph(edges);

        // Iterative relaxation of depths up to max depth bound
        let changed = true;
        let iteration = 0;
        const maxIterations = Math.min(MAX_DEPTH_ITERATIONS, files.length);

        while (changed && iteration < maxIterations) {
            changed = false;
            iteration++;

            for (const file of files) {
                const importedFiles = importsByFile.get(file);
                if (!importedFiles || importedFiles.length === 0) {
                    continue;
                }
                const newDepth = computeMaxPredecessorDepth(importedFiles, depthsByFile) + 1;
                if (newDepth !== depthsByFile.get(file)) {
                    depthsByFile.set(file, newDepth);
                    changed = true;
                }
            }
        }

        return depthsByFile;
    }

    /**
     * Groups files into cohesive semantic clusters by normalized directory path prefix.
     */
    private groupFilesByModuleAffinity(files: string[]): Map<string, string[]> {
        const clustersByModule = new Map<string, string[]>();

        for (const file of files) {
            const key = extractModuleGroupKeyFast(file);
            getOrCreateBucket(clustersByModule, key).push(file);
        }

        return clustersByModule;
    }
}

/** Singleton default instance */
export const defaultTensorPartitioner = new TensorPartitioner();
