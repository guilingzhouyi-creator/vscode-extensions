/**
 * Module: Review — Immutable Semantic Generation
 * File Path: src/core/review/semantic-snapshot.ts
 * Architecture Role: Build snapshot-scoped topology beside the actual immutable review execution.
 * Dependencies & Triggers: Semantic registry, snapshot reads and local module resolution.
 * Responsibilities: Retain independent readers, extraction observations and explicit unknowns.
 * Exit Semantics & Design Rationale: Partial structure proves neither zero impact nor authority.
 *     Asset reuse does not share mutable version graphs.
 */
import { SemanticGraph } from '../semantic/semanticGraph';
import { defaultSemanticAdapterRegistry } from '../semantic/adapters/registry';
import { resolveSnapshotModules } from '../semantic/snapshot-module-resolution';
import type { SemanticNode } from '../semantic/types';
import type { SourceSnapshotIdentity } from './source-snapshot';
import type { SnapshotInputObservation } from './snapshot-scanner';
import type { ReviewConfigurationIdentity } from './review-configuration';

/** Recorded extraction actually attempted for a text input of this generation. */
export interface SemanticFileObservation {
    readonly path: string;
    readonly language: string;
    readonly version: string | null;
    readonly assetGeneration: string | null;
    readonly status: 'observed' | 'unsupported' | 'failed';
    readonly reason?: string;
}
/** Graph lifecycle identity; configuration can explicitly remain unbound. */
export interface SemanticGenerationIdentity {
    readonly snapshot: SourceSnapshotIdentity;
    readonly configuration: ReviewConfigurationIdentity;
    readonly extractors: readonly SemanticFileObservation[];
}
/** Conservative structural coverage, independent from required static analyzer coverage. */
export interface SemanticGraphCoverage {
    readonly status: 'partial' | 'unknown';
    readonly reason: string;
    readonly unresolvedEdges: number;
    readonly inputs: readonly SnapshotInputObservation[];
}
/** Reachable observed files, with completeness never inferred from an empty result. */
export interface SemanticFileImpact {
    readonly status: 'partial' | 'unknown';
    readonly files: readonly string[];
    readonly reason: string;
}

/** Owns a detached graph and exposes queries through detached data, without mutation methods. */
export class SemanticGraphSnapshot {
    readonly #graph: SemanticGraph;
    readonly identity: SemanticGenerationIdentity;
    readonly coverage: SemanticGraphCoverage;

    constructor(
        graph: SemanticGraph, identity: SemanticGenerationIdentity, coverage: SemanticGraphCoverage,
    ) {
        this.#graph = SemanticGraph.fromJSON(structuredClone(graph.toJSON()));
        const source = identity.snapshot;
        this.identity = Object.freeze({
            snapshot: Object.freeze({ repositoryId: source.repositoryId,
                tree: Object.freeze({ ...source.tree }),
                manifestDigest: Object.freeze({ ...source.manifestDigest }) }),
            configuration: Object.freeze({ ...identity.configuration }),
            extractors: Object.freeze(identity.extractors.map(entry =>
                Object.freeze({ ...entry }))),
        });
        this.coverage = Object.freeze({ ...coverage,
            inputs: Object.freeze(coverage.inputs.map(entry => Object.freeze({ ...entry }))) });
        Object.freeze(this);
    }

    /**
     * Read independent node observations for one file.
     * @param file - Exact snapshot-relative path.
     * @returns Detached nodes whose mutation cannot affect any graph reader.
     */
    getNodesByFile(file: string): SemanticNode[] {
        return structuredClone([...this.#graph.getNodesByFile(file)]);
    }

    /**
     * Traverse observed incoming edges while retaining explicit incomplete coverage.
     * @param file - File whose declarations are the traversal seeds.
     * @param depth - Bounded incoming edge distance, defaulting to three.
     * @returns Known reachable files; unknown never becomes an authoritative zero-impact result.
     */
    getFileImpact(file: string, depth = 3): SemanticFileImpact {
        if (!Number.isSafeInteger(depth) || depth < 0) throw new RangeError('Invalid impact depth');
        const seeds = this.#graph.getNodesByFile(file).map(node => node.id);
        if (seeds.length === 0) {
            return Object.freeze({ status: 'unknown', files: Object.freeze([]),
                reason: 'file-structure-unavailable' });
        }
        const slice = this.#graph.getSlice(seeds, depth, 'backward');
        const files = [...new Set(slice.nodes.map(node => node.location.file))].sort();
        return Object.freeze({ status: 'partial', files: Object.freeze(files), reason: this.coverage.reason });
    }

    /** Independent mutable copy for existing consumers; this generation remains unchanged. */
    createMutableGraph(): SemanticGraph {
        return SemanticGraph.fromJSON(structuredClone(this.#graph.toJSON()));
    }
}

/** Per-request builder; published snapshots do not retain this mutable construction graph. */
export class SemanticSnapshotBuilder {
    private readonly graph = new SemanticGraph();
    private readonly observations: SemanticFileObservation[] = [];

    /**
     * Observe the same exact text consumed by the file analyzer, with no filesystem reread.
     * @param file - Exact path visited by the snapshot port.
     * @param content - Already decoded immutable text supplied to actual review execution.
     */
    async observe(file: string, content: string): Promise<void> {
        const registry = defaultSemanticAdapterRegistry;
        const adapter = registry.getAdapterForFile(file);
        const declaration = { path: file, language: adapter?.language ?? 'unknown',
            version: adapter?.version ?? null, assetGeneration: adapter?.assetGeneration ?? null };
        if (!adapter) {
            this.observations.push({ ...declaration, status: 'unsupported', reason: 'no-semantic-adapter' });
            return;
        }
        try {
            const published = await registry.extractFileToGraph(file, content, this.graph);
            this.observations.push(published
                ? { ...declaration, status: 'observed' }
                : { ...declaration, status: 'failed', reason: 'semantic-publication-superseded' });
        } catch (error) {
            this.observations.push({ ...declaration, status: 'failed',
                reason: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Detach one generation and preserve unresolved, scoped and non-text coverage facts.
     * @param identity - Actual snapshot and captured configuration.
     * @param inputs - Every input outcome visited by the review.
     * @param reason - More specific lifecycle/scope limitation, when present.
     * @returns A reader-owned generation, isolated from every later extraction and publication.
     */
    seal(
        identity: Omit<SemanticGenerationIdentity, 'extractors'>,
        inputs: readonly SnapshotInputObservation[], reason?: string,
    ): SemanticGraphSnapshot {
        const resolved = resolveSnapshotModules(this.graph);
        const observed = this.observations.some(entry => entry.status === 'observed');
        const generation = { ...identity, extractors: this.observations };
        return new SemanticGraphSnapshot(resolved.graph, generation, {
            status: observed ? 'partial' : 'unknown',
            reason: reason ?? (observed ? 'adapter-coverage-incomplete' : 'graph-unavailable'),
            inputs, unresolvedEdges: resolved.unresolvedEdges,
        });
    }
}
