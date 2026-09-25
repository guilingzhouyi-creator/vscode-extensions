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
        let cellSeq = 1;

        const ruleFamilyEntries = Object.entries(ruleFamilies);

        for (const [moduleKey, clusterFiles] of dataClusters.entries()) {
            // Further partition cluster files by dependency depth
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

            for (const [depth, depthFiles] of depthGroups.entries()) {
                // Chunk files if larger than maxFilesPerDataCluster
                for (let i = 0; i < depthFiles.length; i += this.maxFilesPerDataCluster) {
                    const chunk = depthFiles.slice(i, i + this.maxFilesPerDataCluster);

                    // Cross with Rule Families
                    for (const [familyName, analyzers] of ruleFamilyEntries) {
                        const estimatedCost = chunk.length * analyzers.length * (depth + 1);
                        totalCost += estimatedCost;

                        cells.push({
                            cellId: `tensor-${moduleKey.replace(/[^a-zA-Z0-9_-]/g, '-')}-d${depth}-r${cellSeq++}`,
                            dataFiles: chunk,
                            ruleFamily: familyName,
                            ruleAnalyzers: analyzers,
                            dependencyDepth: depth,
                            estimatedCost,
                        });
                    }
                }
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
        const imports = new Map<string, Set<string>>();

        for (const f of files) {
            depths.set(f, 0);
            imports.set(f, new Set());
        }

        for (const [from, to] of edges) {
            let set = imports.get(from);
            if (!set) {
                set = new Set();
                imports.set(from, set);
            }
            set.add(to);
        }

        // Iterative relaxation of depths up to max depth bound
        let changed = true;
        let iteration = 0;
        const maxIterations = Math.min(20, files.length);

        while (changed && iteration < maxIterations) {
            changed = false;
            iteration++;

            for (const file of files) {
                const importedFiles = imports.get(file);
                if (importedFiles && importedFiles.size > 0) {
                    let currentMax = 0;
                    for (const imp of importedFiles) {
                        const impDepth = depths.get(imp) ?? 0;
                        if (impDepth > currentMax) {
                            currentMax = impDepth;
                        }
                    }
                    const newDepth = currentMax + 1;
                    if (newDepth !== depths.get(file)) {
                        depths.set(file, newDepth);
                        changed = true;
                    }
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
            const normalized = file.replace(/\\/g, '/').replace(/^\/+/, '');
            const segments = normalized.split('/').filter(Boolean);
            const startIdx = segments[0] === 'src' || segments[0] === 'lib' ? 1 : 0;
            const parts = segments.slice(startIdx);

            let key = 'root';
            if (parts.length === 2) {
                key = parts[0];
            } else if (parts.length > 2) {
                key = `${parts[0]}/${parts[1]}`;
            }

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
