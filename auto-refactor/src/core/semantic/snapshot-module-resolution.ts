/**
 * Module: Semantic — Snapshot Local Module Resolution
 * File Path: src/core/semantic/snapshot-module-resolution.ts
 * Architecture Role: Resolve unambiguous local TypeScript module edges in a captured graph.
 * Dependencies & Triggers: POSIX path operations and canonical semantic symbol identities.
 * Responsibilities: Preserve unresolved external, ambiguous and out-of-scope targets explicitly.
 * Exit Semantics & Design Rationale: Closed-world module matching never claims full type checking,
 *     alias resolution or dynamic dependency coverage.
 */
import { posix } from 'node:path';
import { SemanticGraph } from './semanticGraph';
import type { SemanticEdge, SemanticNode } from './types';

const EXTENSIONS = Object.freeze(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function localTarget(
    edge: SemanticEdge, source: SemanticNode, modules: ReadonlyMap<string, SemanticNode>,
): SemanticNode | undefined {
    const specifier = edge.context?.moduleSpecifier;
    if (typeof specifier !== 'string') return undefined;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return undefined;
    const base = posix.normalize(posix.join(posix.dirname(source.location.file), specifier));
    if (base.startsWith('../')) return undefined;
    const exact = modules.get(base);
    if (exact) return exact;
    const candidates = EXTENSIONS.flatMap(extension => [
        modules.get(`${base}${extension}`), modules.get(`${base}/index${extension}`),
    ]).filter((node): node is SemanticNode => node !== undefined);
    return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Resolve captured local module edges, retaining every other observation unchanged.
 * @param graph - Private graph built from exact texts read from the snapshot.
 * @returns Independent topology and the number of edges with an absent endpoint.
 */
export function resolveSnapshotModules(graph: SemanticGraph): {
    readonly graph: SemanticGraph;
    readonly unresolvedEdges: number;
} {
    const nodes = graph.getAllNodes();
    const byId = new Map(nodes.map(node => [node.id, node]));
    const modules = new Map(nodes.filter(node => node.kind === 'module')
        .map(node => [node.location.file, node]));
    const edges = graph.getAllEdges().map(edge => {
        const source = byId.get(edge.fromNodeId);
        if (!source || source.language !== 'typescript' || edge.kind !== 'depends_on' ||
            byId.has(edge.toNodeId)) return edge;
        const target = localTarget(edge, source, modules);
        return target ? { ...edge, toNodeId: target.id, id: `${edge.id}:resolved:${target.id}` } : edge;
    });
    const unresolvedEdges = edges.filter(edge =>
        !byId.has(edge.fromNodeId) || !byId.has(edge.toNodeId)).length;
    return { graph: SemanticGraph.fromJSON({ nodes, edges }), unresolvedEdges };
}
