/**
 * Module: Core Reporting — Agent Audit Pipeline Micro-Kernel
 * File Path: src/core/reporting/agent-audit-pipeline.ts
 * Architecture Role: High-cohesion topological partitioner and issue grouping pipeline
 *   shared across Agent review reporters (AAS v1.1, Directives, CAPP).
 * Dependencies & Triggers: Consumes ../types and ../guidance/agentConstraintGenerator;
 *   invoked by aas-reporter.ts and agent-review-reporter.ts.
 * Responsibilities:
 *   1. Normalize file paths consistently to repository-relative POSIX format.
 *   2. Group diagnostic issues by file path with zero transient heap allocation in loops.
 *   3. Determine dominant architectural topology layer per file (L1_CONTRACT -> L5_GOVERNANCE).
 *   4. Order impacted files topologically with deterministic alphabetical tie-breaking.
 *   5. Assemble strongly-typed topology buckets for Agent multi-stage orchestration.
 * Exit Semantics & Design Rationale: Pure, synchronous, non-throwing transformation adhering
 *   strictly to CC <= 10, Depth <= 3, and zero transient loop allocations.
 */

import * as path from 'path';
import type { Issue } from '../types';
import {
    resolveTopologyLayer,
    type AgentTopologyLayer,
} from '../guidance/agentConstraintGenerator';

/**
 * Standard topological layer ordering from foundation to boundary.
 */
export const ORDERED_TOPOLOGY_LAYERS: readonly AgentTopologyLayer[] = [
    'L1_CONTRACT',
    'L2_OPERATOR',
    'L3_CONFIG',
    'L4_PRESENTATION',
    'L5_GOVERNANCE',
] as const;

/**
 * Priority rank assigned to each architectural topology layer (1 is highest priority).
 */
export const TOPOLOGY_LAYER_PRIORITY: Readonly<Record<AgentTopologyLayer, number>> = {
    L1_CONTRACT: 1,
    L2_OPERATOR: 2,
    L3_CONFIG: 3,
    L4_PRESENTATION: 4,
    L5_GOVERNANCE: 5,
};

const UNRANKED_PRIORITY = 99;

/**
 * Normalizes a file path to repository-relative POSIX format.
 *
 * @param filePath - Input file path (absolute or relative)
 * @param baseDir - Repository or workspace root directory
 * @returns Normalized POSIX path string
 */
export function normalizeRepoRelativePath(filePath: string, baseDir?: string): string {
    let normalizedPath = filePath.replace(/\\/g, '/');
    if (baseDir && path.isAbsolute(normalizedPath)) {
        normalizedPath = path.relative(baseDir, normalizedPath).replace(/\\/g, '/');
    }
    return normalizedPath;
}

/**
 * Retrieves an existing array bucket or creates and stores a new one outside loop body.
 */
function getOrCreateFileBucket<KeyType, ValueType>(
    targetMap: Map<KeyType, ValueType[]>,
    lookupKey: KeyType,
): ValueType[] {
    const existingBucket = targetMap.get(lookupKey);
    if (existingBucket) return existingBucket;
    const freshBucket: ValueType[] = [];
    targetMap.set(lookupKey, freshBucket);
    return freshBucket;
}

/**
 * Partitions diagnostic findings by repository-relative file path.
 *
 * @param issues - Diagnostic findings
 * @param baseDir - Repository root directory
 * @param includeInfo - Whether to include info-level findings
 * @returns Map of file paths to their diagnostic findings
 */
export function partitionIssuesByFile(
    issues: readonly Issue[],
    baseDir: string = '',
    includeInfo: boolean = false,
): Map<string, Issue[]> {
    const partitionedFileMap = new Map<string, Issue[]>();
    for (const diagnosticIssue of issues) {
        if (!includeInfo && diagnosticIssue.severity === 'info') continue;
        const normalizedFile = normalizeRepoRelativePath(diagnosticIssue.location?.file || 'unknown', baseDir);
        getOrCreateFileBucket(partitionedFileMap, normalizedFile).push(diagnosticIssue);
    }
    return partitionedFileMap;
}

/**
 * Resolves the primary architectural topology layer across all findings in a file.
 *
 * @param issues - Findings located in the target file
 * @param filePath - File path for secondary rule inspection
 * @returns Dominant architectural topology layer
 */
export function resolveFileDominantLayer(
    issues: readonly Issue[],
    filePath: string,
): AgentTopologyLayer {
    let bestLayer: AgentTopologyLayer = 'L5_GOVERNANCE';
    let bestRank = UNRANKED_PRIORITY;

    for (const currentIssue of issues) {
        const candidateLayer = resolveTopologyLayer(currentIssue.rule, filePath);
        const candidateRank = TOPOLOGY_LAYER_PRIORITY[candidateLayer] ?? UNRANKED_PRIORITY;
        if (candidateRank < bestRank) {
            bestRank = candidateRank;
            bestLayer = candidateLayer;
        }
    }
    return bestLayer;
}

/**
 * Maps each partitioned file to its dominant architectural layer.
 *
 * @param fileMap - Partitioned issues map
 * @returns Map of file paths to dominant layers
 */
export function buildFileDominantLayerMap(
    fileMap: Map<string, Issue[]>,
): Map<string, AgentTopologyLayer> {
    const dominantLayerMap = new Map<string, AgentTopologyLayer>();
    for (const [filePath, issueList] of fileMap.entries()) {
        dominantLayerMap.set(filePath, resolveFileDominantLayer(issueList, filePath));
    }
    return dominantLayerMap;
}

/**
 * Sorts file paths by topological priority (L1 -> L5), breaking ties alphabetically.
 *
 * Implements an O(N) Radix Bucket partition followed by local bucket sorting to eliminate
 * redundant Map lookups in comparator loops.
 *
 * @param filePaths - List of file paths to sort
 * @param fileLayerMap - Mapping of file to its dominant layer
 * @returns Topologically sorted array of file paths
 */
export function sortFilesByArchitecturalLayer(
    filePaths: string[],
    fileLayerMap: Map<string, AgentTopologyLayer>,
): string[] {
    const bucketContract: string[] = [];
    const bucketOperator: string[] = [];
    const bucketConfig: string[] = [];
    const bucketPresentation: string[] = [];
    const bucketGovernance: string[] = [];
    const bucketUnranked: string[] = [];

    for (const filePath of filePaths) {
        const dominantLayer = fileLayerMap.get(filePath);
        switch (dominantLayer) {
            case 'L1_CONTRACT':
                bucketContract.push(filePath);
                break;
            case 'L2_OPERATOR':
                bucketOperator.push(filePath);
                break;
            case 'L3_CONFIG':
                bucketConfig.push(filePath);
                break;
            case 'L4_PRESENTATION':
                bucketPresentation.push(filePath);
                break;
            case 'L5_GOVERNANCE':
                bucketGovernance.push(filePath);
                break;
            default:
                bucketUnranked.push(filePath);
                break;
        }
    }

    const alphabeticalComparator = (filePathA: string, filePathB: string): number => {
        return filePathA.localeCompare(filePathB);
    };

    bucketContract.sort(alphabeticalComparator);
    bucketOperator.sort(alphabeticalComparator);
    bucketConfig.sort(alphabeticalComparator);
    bucketPresentation.sort(alphabeticalComparator);
    bucketGovernance.sort(alphabeticalComparator);
    bucketUnranked.sort(alphabeticalComparator);

    return [
        ...bucketContract,
        ...bucketOperator,
        ...bucketConfig,
        ...bucketPresentation,
        ...bucketGovernance,
        ...bucketUnranked,
    ];
}

/**
 * Instantiates an empty bucket map for all ordered topology layers.
 *
 * @returns Fresh dictionary with empty string arrays per layer
 */
export function createEmptyTopologyBuckets(): Record<AgentTopologyLayer, string[]> {
    return {
        L1_CONTRACT: [],
        L2_OPERATOR: [],
        L3_CONFIG: [],
        L4_PRESENTATION: [],
        L5_GOVERNANCE: [],
    };
}

/**
 * Filters out empty topology buckets from final emitted structure.
 *
 * @param buckets - Full topology bucket dictionary
 * @returns Filtered dictionary containing only non-empty layers
 */
export function filterActiveTopologyBuckets(
    buckets: Record<AgentTopologyLayer, string[]>,
): Partial<Record<AgentTopologyLayer, readonly string[]>> {
    const active: Partial<Record<AgentTopologyLayer, readonly string[]>> = {};
    for (const layer of ORDERED_TOPOLOGY_LAYERS) {
        const bucket = buckets[layer];
        if (bucket && bucket.length > 0) {
            active[layer] = bucket;
        }
    }
    return active;
}

/**
 * Complete partitioned pipeline context ready for format emission.
 */
export interface PartitionedFileContext {
    readonly fileMap: Map<string, Issue[]>;
    readonly fileLayerMap: Map<string, AgentTopologyLayer>;
    readonly sortedFiles: string[];
    readonly topologyBuckets: Record<AgentTopologyLayer, string[]>;
}

/**
 * Executes standard topological partitioning pipeline on a collection of issues.
 *
 * @param issues - Raw diagnostic issues
 * @param baseDir - Repository root directory
 * @param includeInfo - Whether to include info issues
 * @returns Fully partitioned and topologically sorted file context
 */
export function executeFileTopologyPipeline(
    issues: readonly Issue[],
    baseDir: string = '',
    includeInfo: boolean = false,
): PartitionedFileContext {
    const fileMap = partitionIssuesByFile(issues, baseDir, includeInfo);
    const fileLayerMap = buildFileDominantLayerMap(fileMap);
    const sortedFiles = sortFilesByArchitecturalLayer(Array.from(fileMap.keys()), fileLayerMap);
    const topologyBuckets = createEmptyTopologyBuckets();

    return {
        fileMap,
        fileLayerMap,
        sortedFiles,
        topologyBuckets,
    };
}
