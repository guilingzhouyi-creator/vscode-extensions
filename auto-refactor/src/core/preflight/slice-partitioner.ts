/**
 * Module: Core Preflight — Mutually Disjoint Slice Partitioner
 * File Path: src/core/preflight/slice-partitioner.ts
 * Architecture Role: Partitions activated files and analyzers into mutually disjoint execution
 *   slices P = {S_1, ..., S_n} and manages shared context caching for single-parse AST reuse.
 * Dependencies & Triggers: Consumes audit-index and sparse-activator; called by preflight
 *   controller and worker-pool schedulers.
 * Responsibilities:
 *   1. Categorize analyzers into 5 orthogonal domain slices (hygiene, AST,
 *      architecture, governance, security).
 *   2. Group candidate files into slices without redundant duplicate execution.
 *   3. Provide a shared in-memory AST and token cache to prevent multiple analyzers
 *      re-parsing the same file.
 *   4. Enforce concurrency limits within CPU and memory resource budgets.
 * Exit Semantics & Design Rationale: Pure partitioning logic; deterministic; never throws.
 */

import type { AuditIndexEntry } from './audit-index';
import type { SparseActivationResult } from './sparse-activator';

/** Canonical domain slice categories */
export type SliceCategory =
    | 'lexical_hygiene'
    | 'ast_complexity'
    | 'architecture_coupling'
    | 'modernity_governance'
    | 'security_safety';

/** Canonical mapping from analyzer ID to primary slice domain */
export const ANALYZER_SLICE_DOMAIN: Record<string, SliceCategory> = {
    // Slice 1: Lexical Hygiene
    comments: 'lexical_hygiene',
    naming: 'lexical_hygiene',
    hygiene: 'lexical_hygiene',
    docs: 'lexical_hygiene',
    'shell-lint': 'lexical_hygiene',

    // Slice 2: AST & Complexity
    complexity: 'ast_complexity',
    simplify: 'ast_complexity',
    'large-file': 'ast_complexity',
    performance: 'ast_complexity',

    // Slice 3: Architecture & Coupling
    architecture: 'architecture_coupling',
    'dependency-graph': 'architecture_coupling',
    'dependency-layout': 'architecture_coupling',
    'data-architecture': 'architecture_coupling',
    constants: 'architecture_coupling',
    stdlib: 'architecture_coupling',
    'gate-architecture': 'architecture_coupling',

    // Slice 4: Modernity & Governance
    governance: 'modernity_governance',
    'ts-modern': 'modernity_governance',
    'typescript-modern': 'modernity_governance',
    'python-modern': 'modernity_governance',
    'rust-modern': 'modernity_governance',
    'gdscript-modern': 'modernity_governance',
    'gdscript-game': 'modernity_governance',
    'test-modernity': 'modernity_governance',
    'vscode-extension': 'modernity_governance',
    'go-modern': 'modernity_governance',

    // Slice 5: Security & Safety
    security: 'security_safety',
    secrets: 'security_safety',
};

/** Representation of a single review execution slice */
export interface ReviewSlice {
    readonly id: string;
    readonly category: SliceCategory;
    readonly analyzers: readonly string[];
    readonly files: readonly string[];
    readonly estimatedWorkload: number;
}

/** Complete partition outcome */
export interface SlicePartitionResult {
    readonly slices: readonly ReviewSlice[];
    readonly totalWorkload: number;
    readonly maxConcurrency: number;
}

/**
 * Shared in-memory cache for parsed ASTs and lexical symbols across analyzers in one run.
 */
export class SharedContextCache {
    private readonly astCache = new Map<string, unknown>();
    private readonly symbolCache = new Map<string, readonly string[]>();

    public getAst<T>(filePath: string): T | undefined {
        return this.astCache.get(filePath) as T | undefined;
    }

    public setAst<T>(filePath: string, ast: T): void {
        this.astCache.set(filePath, ast);
    }

    public hasAst(filePath: string): boolean {
        return this.astCache.has(filePath);
    }

    public getSymbols(filePath: string): readonly string[] | undefined {
        return this.symbolCache.get(filePath);
    }

    public setSymbols(filePath: string, symbols: readonly string[]): void {
        this.symbolCache.set(filePath, Object.freeze([...symbols]));
    }

    public clear(): void {
        this.astCache.clear();
        this.symbolCache.clear();
    }
}

/**
 * Partitions activated analyzers and files into mutually disjoint review slices.
 *
 * @param activation - Sparse activation outcome.
 * @param fileEntries - Indexed file entries.
 * @param maxWorkers - Concurrency budget limit (default 4).
 * @returns Frozen SlicePartitionResult.
 */
export function partitionReviewSlices(
    activation: SparseActivationResult,
    fileEntries: readonly AuditIndexEntry[],
    maxWorkers = 4,
): SlicePartitionResult {
    const entryMap = new Map<string, AuditIndexEntry>();
    for (const e of fileEntries) {
        entryMap.set(e.filePath, e);
    }

    // Group activated analyzers by slice category
    const categoryAnalyzers: Record<SliceCategory, string[]> = {
        lexical_hygiene: [],
        ast_complexity: [],
        architecture_coupling: [],
        modernity_governance: [],
        security_safety: [],
    };

    for (const aId of activation.activatedAnalyzers) {
        const cat = ANALYZER_SLICE_DOMAIN[aId] || 'modernity_governance';
        categoryAnalyzers[cat].push(aId);
    }

    const slices: ReviewSlice[] = [];
    let totalWorkload = 0;

    const categoryEntries = Object.entries(categoryAnalyzers) as [SliceCategory, string[]][];
    for (const [cat, analyzers] of categoryEntries) {
        if (analyzers.length === 0) continue;

        // Find all selected files that need at least one analyzer from this category
        const relevantFiles: string[] = [];
        let sliceWorkload = 0;

        for (const f of activation.selectedFiles) {
            const needed = activation.fileAnalyzerMap[f] || [];
            const hasCategoryAnalyzer = analyzers.some((a) => needed.includes(a));
            if (hasCategoryAnalyzer) {
                relevantFiles.push(f);
                const eloc = entryMap.get(f)?.eloc.estimatedEloc || 50;
                sliceWorkload += eloc * analyzers.length;
            }
        }

        if (relevantFiles.length > 0) {
            slices.push(
                Object.freeze({
                    id: `slice-${cat}-${slices.length + 1}`,
                    category: cat,
                    analyzers: Object.freeze([...analyzers]),
                    files: Object.freeze(relevantFiles),
                    estimatedWorkload: sliceWorkload,
                }),
            );
            totalWorkload += sliceWorkload;
        }
    }

    return Object.freeze({
        slices: Object.freeze(slices),
        totalWorkload,
        maxConcurrency: Math.max(1, Math.min(maxWorkers, slices.length)),
    });
}
