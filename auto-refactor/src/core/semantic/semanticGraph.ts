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

const DIRECTION_FORWARD = 'forward';
const DIRECTION_BACKWARD = 'backward';
const DIRECTION_BOTH = 'both';
type GraphDirection = typeof DIRECTION_FORWARD | typeof DIRECTION_BACKWARD | typeof DIRECTION_BOTH;

function buildInDegreeMap(nodeIds: Iterable<string>, edges: SemanticEdge[]): Map<string, number> {
    const inDegree = new Map<string, number>();
    for (const nodeId of nodeIds) {
        inDegree.set(nodeId, 0);
    }
    for (const edge of edges) {
        if (inDegree.has(edge.toNodeId)) {
            inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) ?? 0) + 1);
        }
    }
    return inDegree;
}

function collectZeroDegreeNodes(inDegree: Map<string, number>): string[] {
    const queue: string[] = [];
    for (const [nodeId, deg] of inDegree.entries()) {
        if (deg === 0) {
            queue.push(nodeId);
        }
    }
    return queue;
}

/**
 * High-performance language-agnostic code topology graph.
 */
export class SemanticGraph {
    private readonly nodes: Map<string, SemanticNode> = new Map();
    private readonly outgoing: Map<string, Map<string, SemanticEdge>> = new Map();
    private readonly incoming: Map<string, Map<string, SemanticEdge>> = new Map();
    private readonly nodesByFile: Map<string, SemanticNode[]> = new Map();

    /**
     * Inserts or replaces a node in the graph, updating inverted file indices.
     */
    public addNode(node: SemanticNode): this {
        const existing = this.nodes.get(node.id);
        if (existing?.location?.file) {
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
        const idx = list.findIndex((n) => n.id === node.id);
        if (idx >= 0) {
            list.splice(idx, 1);
        }
    }

    /**
     * Checks if a node exists.
     */
    public hasNode(id: string): boolean {
        return this.nodes.has(id);
    }

    /**
     * Retrieves a node by its canonical identifier.
     */
    public getNode(id: string): SemanticNode | undefined {
        return this.nodes.get(id);
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
        this.nodes.clear();
        this.outgoing.clear();
        this.incoming.clear();
        this.nodesByFile.clear();
    }

    /**
     * Inserts a directed edge connecting two existing or implicit nodes.
     */
    public addEdge(edge: SemanticEdge): this {
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
     * Slices an impact subgraph radiating from a seed node up to a maximum depth.
     */
    public getSlice(
        seedNodeId: string,
        maxDepth: number = 3,
        direction: GraphDirection = DIRECTION_FORWARD,
    ): SemanticSubgraph {
        const visitedNodes = new Set<string>();
        const collectedEdges = new Set<SemanticEdge>();
        const queue: Array<{ id: string; depth: number }> = [{ id: seedNodeId, depth: 0 }];
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
        for (const id of visitedNodes) {
            const node = this.nodes.get(id);
            if (node) {
                nodes.push(node);
            }
        }

        return {
            nodes,
            edges: Array.from(collectedEdges),
            seedNodeId,
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
        const WHITE = 0;
        const GRAY = 1;
        const BLACK = 2;
        const color = new Map<string, number>();
        const cycles: string[][] = [];

        for (const start of this.nodes.keys()) {
            if ((color.get(start) ?? WHITE) !== WHITE) {
                continue;
            }
            this.traverseCycleDfs(start, color, cycles, WHITE, GRAY, BLACK);
        }

        return cycles;
    }

    private traverseCycleDfs(
        start: string,
        color: Map<string, number>,
        cycles: string[][],
        white: number,
        gray: number,
        black: number,
    ): void {
        color.set(start, gray);
        const pathArr: string[] = [start];
        const stack: Array<{ node: string; nexts: string[]; idx: number }> = [
            { node: start, nexts: this.getNodeNextIds(start), idx: 0 },
        ];

        while (stack.length > 0) {
            const top = stack[stack.length - 1];
            if (top.idx >= top.nexts.length) {
                color.set(top.node, black);
                stack.pop();
                pathArr.pop();
                continue;
            }

            const next = top.nexts[top.idx++];
            const c = color.get(next) ?? white;
            if (c === gray) {
                const at = pathArr.indexOf(next);
                if (at >= 0) {
                    cycles.push([...pathArr.slice(at), next]);
                }
            } else if (c === white) {
                color.set(next, gray);
                pathArr.push(next);
                stack.push({ node: next, nexts: this.getNodeNextIds(next), idx: 0 });
            }
        }
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
        const inDegree = buildInDegreeMap(this.nodes.keys(), this.getAllEdges());
        const queue = collectZeroDegreeNodes(inDegree);
        const order: string[] = [];
        let head = 0;

        while (head < queue.length) {
            const u = queue[head++];
            order.push(u);

            for (const edge of this.getOutgoingEdges(u)) {
                const v = edge.toNodeId;
                const nextDeg = (inDegree.get(v) ?? 1) - 1;
                inDegree.set(v, nextDeg);
                if (nextDeg === 0) {
                    queue.push(v);
                }
            }
        }

        return order.length === this.nodes.size ? order : null;
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
                const n = edge.toNodeId;
                if (this.nodes.has(n) && !visited.has(n)) {
                    visited.add(n);
                    queue.push(n);
                }
            }
            for (const edge of this.getIncomingEdges(cur)) {
                const n = edge.fromNodeId;
                if (this.nodes.has(n) && !visited.has(n)) {
                    visited.add(n);
                    queue.push(n);
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
            for (const n of payload.nodes) {
                graph.addNode(n);
            }
        }
        if (Array.isArray(payload.edges)) {
            for (const e of payload.edges) {
                graph.addEdge(e);
            }
        }
        return graph;
    }
}
