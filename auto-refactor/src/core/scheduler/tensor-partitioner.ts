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

/**
 * Standard orthogonal rule families for tensor rule dimension.
 */
export const DEFAULT_TENSOR_RULE_FAMILIES: Record<string, string[]> = {
    HYGIENE_AND_STYLE: ['comments', 'naming', 'standardization'],
    LOGIC_AND_PERFORMANCE: ['complexity', 'performance', 'large-file'],
    SECURITY_AND_SECRETS: ['constants', 'security'],
    ARCHITECTURE_AND_BOUNDARIES: ['architecture', 'dependency-graph'],
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
 * Partitions files of a single depth band into chunked tensor cells.
 */
function partitionDepthFiles(
    depthFiles: string[],
    maxChunkSize: number,
    ctx: CellBuilderContext,
    targetCells: TensorPartitionCell[],
): number {
    let addedCost = 0;
    for (let i = 0; i < depthFiles.length; i += maxChunkSize) {
        const chunk = depthFiles.slice(i, i + maxChunkSize);
        const sub = createCellsForChunk(chunk, ctx);
        addedCost += sub.cost;
        for (const c of sub.cells) {
            targetCells.push(c);
        }
    }
    return addedCost;
}

/**
 * Groups files of a single cluster by their dependency depth.
 */
function groupFilesByDepth(
    clusterFiles: string[],
    depthMap: Map<string, number>,
): Map<number, string[]> {
    const depthGroups = new Map<number, string[]>();
    for (const file of clusterFiles) {
        const depth = depthMap.get(file) ?? 0;
        let grp = depthGroups.get(depth);
        if (!grp) {
            grp = [];
            depthGroups.set(depth, grp);
        }
        grp.push(file);
    }
    return depthGroups;
}

/**
 * Builds dependency adjacency list without per-iteration heap container instantiation.
 */
function buildImportsGraph(edges: [string, string][]): Map<string, string[]> {
    const imports = new Map<string, string[]>();
    for (const [from, to] of edges) {
        let list = imports.get(from);
        if (!list) {
            list = [];
            imports.set(from, list);
        }
        list.push(to);
    }
    return imports;
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
    return code === 47 || code === 92;
}

/** Advances index past contiguous path separators */
function skipSlashes(p: string, from: number, len: number): number {
    let i = from;
    while (i < len && isSlash(p.charCodeAt(i))) {
        i++;
    }
    return i;
}

/** Finds index of next path separator */
function findNextSlash(p: string, from: number, len: number): number {
    let i = from;
    while (i < len && !isSlash(p.charCodeAt(i))) {
        i++;
    }
    return i;
}

/** Intermediate decomposed path segments */
interface ExtractedPathParts {
    readonly p0: string;
    readonly p1: string;
    readonly partsCount: number;
}

/**
 * Tokenizes leading path segments into prefix elements.
 */
function tokenizePathPrefix(filePath: string): ExtractedPathParts {
    const len = filePath.length;
    let i = skipSlashes(filePath, 0, len);
    if (i >= len) {
        return { p0: '', p1: '', partsCount: 0 };
    }

    const segments: string[] = [];
    while (i < len && segments.length < 3) {
        const next = findNextSlash(filePath, i, len);
        segments.push(filePath.substring(i, next));
        i = skipSlashes(filePath, next, len);
    }

    const hasRemaining = i < len ? 1 : 0;
    const isSrcOrLib = segments[0] === 'src' || segments[0] === 'lib';
    const start = isSrcOrLib ? 1 : 0;
    const partsCount = segments.length - start + hasRemaining;
    const p0 = segments[start] ?? '';
    const p1 = segments[start + 1] ?? '';

    return { p0, p1, partsCount };
}

/**
 * Fast low-allocation extraction of module group key.
 * Avoids split/filter/slice arrays by tokenizing path segments on the fly.
 *
 * @param filePath - Path to cluster
 * @returns Semantic module group key
 */
export function extractModuleGroupKeyFast(filePath: string): string {
    const { p0, p1, partsCount } = tokenizePathPrefix(filePath);
    if (partsCount <= 1) {
        return 'root';
    }
    if (partsCount === 2) {
        return p0;
    }
    return `${p0}/${p1}`;
}

/**
 * Multi-dimensional Tensor-Parallel Partitioner.
 */
export class TensorPartitioner {
    private readonly maxFilesPerDataCluster: number;

    public constructor(maxFilesPerDataCluster = 15) {
        this.maxFilesPerDataCluster = Math.max(1, maxFilesPerDataCluster);
    }

    /**
     * Partitions workload across (Data × Rule × DependencyDepth) 3D tensor grid.
     *
     * @param files - List of file paths to review
     * @param edges - Dependency graph edges: [from, to] (where `from` imports `to`)
     * @param ruleFamilies - Optional custom rule families mapping
     * @returns Complete tensor partition plan
     */
    public partition(
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
        const dataClusters = this.clusterByModuleAffinity(files);

        // 3. Assemble 3D Tensor Cells: (DataCluster × Depth × RuleFamily)
        const cells: TensorPartitionCell[] = [];
        let totalCost = 0;
        const cellSeq = { current: 1 };
        const ruleFamilyEntries = Object.entries(ruleFamilies);

        for (const [moduleKey, clusterFiles] of dataClusters.entries()) {
            const depthGroups = groupFilesByDepth(clusterFiles, depthMap);
            for (const [depth, depthFiles] of depthGroups.entries()) {
                const ctx: CellBuilderContext = {
                    moduleKey,
                    depth,
                    ruleFamilyEntries,
                    cellSeq,
                };
                totalCost += partitionDepthFiles(
                    depthFiles,
                    this.maxFilesPerDataCluster,
                    ctx,
                    cells,
                );
            }
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
     * Computes topological depth layer for files based on directed dependency edges.
     * Leaf / independent modules get depth 0; importers get max(depth of imported) + 1.
     */
    private computeDependencyDepths(
        files: string[],
        edges: [string, string][],
    ): Map<string, number> {
        const depths = new Map<string, number>();
        for (const f of files) {
            depths.set(f, 0);
        }

        const imports = buildImportsGraph(edges);

        // Iterative relaxation of depths up to max depth bound
        let changed = true;
        let iteration = 0;
        const maxIterations = Math.min(20, files.length);

        while (changed && iteration < maxIterations) {
            changed = false;
            iteration++;

            for (const file of files) {
                const importedFiles = imports.get(file);
                if (!importedFiles || importedFiles.length === 0) {
                    continue;
                }
                const newDepth = computeMaxPredecessorDepth(importedFiles, depths) + 1;
                if (newDepth !== depths.get(file)) {
                    depths.set(file, newDepth);
                    changed = true;
                }
            }
        }

        return depths;
    }

    /**
     * Groups files into cohesive semantic clusters by normalized directory path prefix.
     */
    private clusterByModuleAffinity(files: string[]): Map<string, string[]> {
        const clusters = new Map<string, string[]>();

        for (const file of files) {
            const key = extractModuleGroupKeyFast(file);
            let group = clusters.get(key);
            if (!group) {
                group = [];
                clusters.set(key, group);
            }
            group.push(file);
        }

        return clusters;
    }
}

/** Singleton default instance */
export const defaultTensorPartitioner = new TensorPartitioner();
