/**
 * Module: Core Engine — Unified Semantic Graph Topology
 * File Path: src/core/semantic/semanticGraph.ts
 * Architecture Role: Provides high-throughput in-memory semantic graph representation,
 *   supporting bidirectional adjacency indexing, topological traversal, cycle detection,
 *   and impact slicing.
 * Dependencies & Triggers: Consumes types from ./types. Built by language-specific AST
 *   adapters and analyzed by Layer 1/2 rule evaluators.
 * Responsibilities: Graph construction, neighborhood queries, SCC/cycle analysis,
 *   and local impact subgraph extraction.
 * Exit Semantics & Design Rationale: Bounded BFS/DFS safeguards prevent stack overflow
 *   on dense codebases while guaranteeing deterministic results.
 */

import type {
    SemanticEdge,
    SemanticEdgeKind,
    SemanticGraphMetrics,
    SemanticNode,
    SemanticSubgraph,
} from './types';
import { normalizeCanonicalPath } from './adapters/path-utils';
import { detectGraphCycles, computeTopologicalOrder } from '../algorithms/graph';

const DIRECTION_FORWARD = 'forward';
const DIRECTION_BACKWARD = 'backward';
const DIRECTION_BOTH = 'both';
type GraphDirection = typeof DIRECTION_FORWARD | typeof DIRECTION_BACKWARD | typeof DIRECTION_BOTH;

/**
 * High-performance language-agnostic code topology graph.
 */
export class SemanticGraph {
    private readonly nodes: Map<string, SemanticNode> = new Map();
    private readonly outgoing: Map<string, Map<string, SemanticEdge>> = new Map();
    private readonly incoming: Map<string, Map<string, SemanticEdge>> = new Map();
    private readonly nodesByFile: Map<string, SemanticNode[]> = new Map();
    private readonly fileUpdates = new Map<string, symbol>();
    private readonly fileVersions = new Map<string, symbol>();

    /**
     * Read the current source-local publication identity, distinct from a snapshot/config digest.
     * @param filePath - Source file whose extraction was published.
     * @returns Process-local version token, absent for unversioned direct graph mutations.
     */
    public getFileVersion(filePath: string): symbol | undefined {
        return this.fileVersions.get(normalizeCanonicalPath(filePath));
    }

    /**
     * Check that a published file has neither changed nor acquired a newer pending extraction.
     * @param filePath - Source file reviewed by the caller.
     * @param version - Exact token captured after successful extraction.
     * @returns Whether the caller's file publication remains current.
     */
    public isFileVersionCurrent(filePath: string, version: symbol): boolean {
        const file = normalizeCanonicalPath(filePath);
        return this.fileVersions.get(file) === version && !this.fileUpdates.has(file);
    }

    /**
     * Reserve publication for the latest requested extraction of a canonical file.
     * @param filePath - Source file being rebuilt outside the published graph.
     * @returns Unique update token; older tokens cannot publish after a newer request.
     */
    public beginFileUpdate(filePath: string): symbol {
        const file = normalizeCanonicalPath(filePath);
        const token = Symbol(file);
        this.fileUpdates.set(file, token);
        return token;
    }

    /**
     * Release a failed update without cancelling a newer request for the same file.
     * @param filePath - File whose extraction failed.
     * @param token - Exact reservation issued before extraction.
     */
    public cancelFileUpdate(filePath: string, token: symbol): void {
        const file = normalizeCanonicalPath(filePath);
        if (this.fileUpdates.get(file) === token) this.fileUpdates.delete(file);
    }

    /**
     * Publish one completed source-local extraction synchronously, retaining stable inbound edges.
     * Complexity is O(old/new file nodes + their incident edges + replacement edges).
     * @param filePath - Canonical source owner of the replacement.
     * @param token - Latest reservation for this file.
     * @param replacement - Isolated adapter output, containing only this file's nodes and edges.
     * @returns False when superseded, cleared or removed before publication.
     */
    public completeFileUpdate(
        filePath: string, token: symbol, replacement: SemanticGraph,
    ): boolean {
        const file = normalizeCanonicalPath(filePath);
        if (this.fileUpdates.get(file) !== token) return false;
        const nodes = replacement.getAllNodes();
        const edges = replacement.getAllEdges();
        this.validateFileReplacement(file, nodes, edges);
        this.fileUpdates.delete(file);
        this.installFileReplacement(file, nodes, edges);
        this.fileVersions.set(file, token);
        return true;
    }

    /**
     * Remove a deleted/renamed file and prevent unfinished extraction from resurrecting it.
     * @param filePath - Source file to remove, using the graph's existing canonical path rules.
     * @returns Number of previously published nodes removed.
     */
    public removeFile(filePath: string): number {
        const file = normalizeCanonicalPath(filePath);
        const count = this.nodesByFile.get(file)?.length ?? 0;
        this.fileUpdates.delete(file);
        this.fileVersions.delete(file);
        this.installFileReplacement(file, [], []);
        return count;
    }

    private validateFileReplacement(
        file: string, nodes: SemanticNode[], edges: SemanticEdge[],
    ): void {
        const owned = new Set<string>();
        for (const node of nodes) {
            if (normalizeCanonicalPath(node.location.file) !== file) {
                throw new Error('Semantic extraction emitted a node outside its source file');
            }
            const existing = this.nodes.get(node.id);
            if (existing && normalizeCanonicalPath(existing.location.file) !== file) {
                throw new Error('Semantic extraction overwrote another file symbol');
            }
            owned.add(node.id);
        }
        if (edges.some(edge => !owned.has(edge.fromNodeId))) {
            throw new Error('Semantic extraction emitted an edge outside its source file');
        }
    }

    private removePublishedEdge(edge: SemanticEdge): void {
        const outgoing = this.outgoing.get(edge.fromNodeId);
        outgoing?.delete(edge.id);
        if (outgoing?.size === 0 && !this.nodes.has(edge.fromNodeId)) {
            this.outgoing.delete(edge.fromNodeId);
        }
        const incoming = this.incoming.get(edge.toNodeId);
        incoming?.delete(edge.id);
        if (incoming?.size === 0 && !this.nodes.has(edge.toNodeId)) {
            this.incoming.delete(edge.toNodeId);
        }
    }

    private installFileReplacement(
        file: string, nodes: SemanticNode[], edges: SemanticEdge[],
    ): void {
        const retained = new Set(nodes.map(node => node.id));
        const previous = this.nodesByFile.get(file) ?? [];
        this.nodesByFile.delete(file);
        for (const node of previous) {
            this.nodes.delete(node.id);
            for (const edge of this.outgoing.get(node.id)?.values() ?? []) {
                this.removePublishedEdge(edge);
            }
            this.outgoing.delete(node.id);
            if (retained.has(node.id)) continue;
            for (const edge of this.incoming.get(node.id)?.values() ?? []) {
                this.removePublishedEdge(edge);
            }
            this.incoming.delete(node.id);
        }
        for (const node of nodes) this.addNode(node);
        for (const edge of edges) this.addEdge(edge);
    }

    /**
     * Inserts or replaces a node in the graph, updating inverted file indices.
     */
    public addNode(node: SemanticNode): this {
        const existing = this.nodes.get(node.id);
        if (existing?.location?.file) {
            const previousFile = normalizeCanonicalPath(existing.location.file);
            this.fileUpdates.delete(previousFile);
            this.fileVersions.delete(previousFile);
            this.removeNodeFromFileIndex(existing);
        }

        this.nodes.set(node.id, node);
        if (!this.outgoing.has(node.id)) {
            this.outgoing.set(node.id, new Map());
        }
        if (!this.incoming.has(node.id)) {
            this.incoming.set(node.id, new Map());
        }

        if (node.location?.file) {
            const canonicalFile = normalizeCanonicalPath(node.location.file);
            this.fileUpdates.delete(canonicalFile);
            this.fileVersions.delete(canonicalFile);
            let fileNodes = this.nodesByFile.get(canonicalFile);
            if (!fileNodes) {
                fileNodes = [];
                this.nodesByFile.set(canonicalFile, fileNodes);
            }
            fileNodes.push(node);
        }
        return this;
    }

    private removeNodeFromFileIndex(node: SemanticNode): void {
        const oldFile = normalizeCanonicalPath(node.location.file);
        const list = this.nodesByFile.get(oldFile);
        if (!list) {
            return;
        }
        const idx = list.findIndex((targetNode) => targetNode.id === node.id);
        if (idx >= 0) {
            list.splice(idx, 1);
        }
    }

    /**
     * Checks if a node exists.
     */
    public hasNode(nodeId: string): boolean {
        return this.nodes.has(nodeId);
    }

    /**
     * Retrieves a node by its canonical identifier.
     */
    public getNode(nodeId: string): SemanticNode | undefined {
        return this.nodes.get(nodeId);
    }

    /**
     * Returns all registered nodes.
     */
    public getAllNodes(): SemanticNode[] {
        return Array.from(this.nodes.values());
    }

    /**
     * Retrieves all nodes belonging to a specific canonical file path.
     */
    public getNodesByFile(filePath: string): readonly SemanticNode[] {
        const canonicalFile = normalizeCanonicalPath(filePath);
        return this.nodesByFile.get(canonicalFile) ?? [];
    }

    /**
     * Clears all nodes, edges, and file indices.
     */
    public clear(): void {
        this.fileUpdates.clear();
        this.fileVersions.clear();
        this.nodes.clear();
        this.outgoing.clear();
        this.incoming.clear();
        this.nodesByFile.clear();
    }

    /**
     * Inserts a directed edge connecting two existing or implicit nodes.
     */
    public addEdge(edge: SemanticEdge): this {
        const owner = this.nodes.get(edge.fromNodeId)?.location.file;
        if (owner) {
            const file = normalizeCanonicalPath(owner);
            this.fileUpdates.delete(file);
            this.fileVersions.delete(file);
        }
        if (!this.outgoing.has(edge.fromNodeId)) {
            this.outgoing.set(edge.fromNodeId, new Map());
        }
        if (!this.incoming.has(edge.toNodeId)) {
            this.incoming.set(edge.toNodeId, new Map());
        }

        this.outgoing.get(edge.fromNodeId)!.set(edge.id, edge);
        this.incoming.get(edge.toNodeId)!.set(edge.id, edge);
        return this;
    }

    /**
     * Returns all registered edges.
     */
    public getAllEdges(): SemanticEdge[] {
        const edges: SemanticEdge[] = [];
        for (const edgeMap of this.outgoing.values()) {
            for (const edge of edgeMap.values()) {
                edges.push(edge);
            }
        }
        return edges;
    }

    /**
     * Retrieves outgoing edges from a given node, optionally filtered by kind.
     */
    public getOutgoingEdges(nodeId: string, kind?: SemanticEdgeKind): SemanticEdge[] {
        const edgeMap = this.outgoing.get(nodeId);
        if (!edgeMap) {
            return [];
        }
        const results: SemanticEdge[] = [];
        for (const edge of edgeMap.values()) {
            if (!kind || edge.kind === kind) {
                results.push(edge);
            }
        }
        return results;
    }

    /**
     * Retrieves incoming edges to a given node, optionally filtered by kind.
     */
    public getIncomingEdges(nodeId: string, kind?: SemanticEdgeKind): SemanticEdge[] {
        const edgeMap = this.incoming.get(nodeId);
        if (!edgeMap) {
            return [];
        }
        const results: SemanticEdge[] = [];
        for (const edge of edgeMap.values()) {
            if (!kind || edge.kind === kind) {
                results.push(edge);
            }
        }
        return results;
    }

    /**
     * Slices an impact subgraph radiating from one or more seeds up to a maximum depth.
     */
    public getSlice(
        seedNodeId: string | readonly string[],
        maxDepth: number = 3,
        direction: GraphDirection = DIRECTION_FORWARD,
    ): SemanticSubgraph {
        const visitedNodes = new Set<string>();
        const collectedEdges = new Set<SemanticEdge>();
        const seeds = typeof seedNodeId === 'string' ? [seedNodeId] : seedNodeId;
        const queue = seeds.map(id => ({ id, depth: 0 }));
        let head = 0;

        while (head < queue.length) {
            const current = queue[head++];
            if (visitedNodes.has(current.id)) {
                continue;
            }
            visitedNodes.add(current.id);

            if (current.depth >= maxDepth) {
                continue;
            }

            this.expandNeighbors(current, direction, queue, collectedEdges);
        }

        const nodes: SemanticNode[] = [];
        for (const visitedId of visitedNodes) {
            const node = this.nodes.get(visitedId);
            if (node) {
                nodes.push(node);
            }
        }

        return {
            nodes,
            edges: Array.from(collectedEdges),
            seedNodeId: seeds[0] ?? '',
            ...(typeof seedNodeId === 'string' ? {} : { seedNodeIds: Object.freeze([...seeds]) }),
            depth: maxDepth,
        };
    }

    /**
     * Helper to expand forward and backward neighbors during BFS slice.
     */
    private expandNeighbors(
        current: { id: string; depth: number },
        direction: GraphDirection,
        queue: Array<{ id: string; depth: number }>,
        collectedEdges: Set<SemanticEdge>,
    ): void {
        if (direction === DIRECTION_FORWARD || direction === DIRECTION_BOTH) {
            for (const edge of this.getOutgoingEdges(current.id)) {
                collectedEdges.add(edge);
                queue.push({ id: edge.toNodeId, depth: current.depth + 1 });
            }
        }
        if (direction === DIRECTION_BACKWARD || direction === DIRECTION_BOTH) {
            for (const edge of this.getIncomingEdges(current.id)) {
                collectedEdges.add(edge);
                queue.push({ id: edge.fromNodeId, depth: current.depth + 1 });
            }
        }
    }

    /**
     * Detects cycles in the directed graph using iterative three-color DFS (WHITE/GRAY/BLACK).
     * Bounded explicit stack prevents native call stack exhaustion on deep dependency graphs.
     */
    public findCycles(): string[][] {
        return detectGraphCycles(this.nodes.keys(), (nodeId) => this.getNodeNextIds(nodeId));
    }

    private getNodeNextIds(nodeId: string): string[] {
        const edgeMap = this.outgoing.get(nodeId);
        if (!edgeMap) {
            return [];
        }
        const nexts: string[] = [];
        for (const edge of edgeMap.values()) {
            nexts.push(edge.toNodeId);
        }
        return nexts;
    }

    /**
     * Performs a topological sort on DAG structures. Returns null if cycles exist.
     */
    public getTopologicalSort(): string[] | null {
        return computeTopologicalOrder(this.nodes.keys(), (nodeId) => this.getNodeNextIds(nodeId));
    }

    /**
     * Computes holistic structural and graph density metrics.
     * Uses map.size directly to eliminate transient array allocations.
     */
    public computeMetrics(): SemanticGraphMetrics {
        const nodeCount = this.nodes.size;
        let edgeCount = 0;
        let totalIn = 0;
        let totalOut = 0;

        for (const edgeMap of this.outgoing.values()) {
            edgeCount += edgeMap.size;
            totalOut += edgeMap.size;
        }
        for (const inMap of this.incoming.values()) {
            totalIn += inMap.size;
        }

        const cycles = this.findCycles();

        const maxEdges = nodeCount > 1 ? nodeCount * (nodeCount - 1) : 1;
        const density = nodeCount > 1 ? Number((edgeCount / maxEdges).toFixed(4)) : 0;
        const avgIn = nodeCount > 0 ? Number((totalIn / nodeCount).toFixed(2)) : 0;
        const avgOut = nodeCount > 0 ? Number((totalOut / nodeCount).toFixed(2)) : 0;

        return {
            nodeCount,
            edgeCount,
            componentCount: this.computeComponentCount(),
            density,
            averageInDegree: avgIn,
            averageOutDegree: avgOut,
            cycleCount: cycles.length,
        };
    }

    private traverseComponent(startNode: string, visited: Set<string>): void {
        const queue: string[] = [startNode];
        visited.add(startNode);
        let head = 0;

        while (head < queue.length) {
            const cur = queue[head++];
            for (const edge of this.getOutgoingEdges(cur)) {
                const neighborId = edge.toNodeId;
                if (this.nodes.has(neighborId) && !visited.has(neighborId)) {
                    visited.add(neighborId);
                    queue.push(neighborId);
                }
            }
            for (const edge of this.getIncomingEdges(cur)) {
                const neighborId = edge.fromNodeId;
                if (this.nodes.has(neighborId) && !visited.has(neighborId)) {
                    visited.add(neighborId);
                    queue.push(neighborId);
                }
            }
        }
    }

    /**
     * Calculates weakly connected component count via undirected traversal.
     */
    private computeComponentCount(): number {
        const visited = new Set<string>();
        let components = 0;

        for (const nodeId of this.nodes.keys()) {
            if (!visited.has(nodeId)) {
                components++;
                this.traverseComponent(nodeId, visited);
            }
        }

        return components;
    }

    /**
     * Serializes graph into a plain JSON-compatible object.
     */
    public toJSON(): { nodes: SemanticNode[]; edges: SemanticEdge[] } {
        return {
            nodes: this.getAllNodes(),
            edges: this.getAllEdges(),
        };
    }

    /**
     * Reconstructs graph from serialized payload.
     */
    public static fromJSON(payload: {
        nodes?: SemanticNode[];
        edges?: SemanticEdge[];
    }): SemanticGraph {
        const graph = new SemanticGraph();
        if (Array.isArray(payload.nodes)) {
            for (const node of payload.nodes) {
                graph.addNode(node);
            }
        }
        if (Array.isArray(payload.edges)) {
            for (const edge of payload.edges) {
                graph.addEdge(edge);
            }
        }
        return graph;
    }
}
