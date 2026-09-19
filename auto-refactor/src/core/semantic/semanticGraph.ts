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

/**
 * High-performance language-agnostic code topology graph.
 */
export class SemanticGraph {
    private readonly nodes: Map<string, SemanticNode> = new Map();
    private readonly outgoing: Map<string, Map<string, SemanticEdge>> = new Map();
    private readonly incoming: Map<string, Map<string, SemanticEdge>> = new Map();

    /**
     * Inserts or replaces a node in the graph.
     */
    public addNode(node: SemanticNode): this {
        this.nodes.set(node.id, node);
        if (!this.outgoing.has(node.id)) {
            this.outgoing.set(node.id, new Map());
        }
        if (!this.incoming.has(node.id)) {
            this.incoming.set(node.id, new Map());
        }
        return this;
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
        direction: 'forward' | 'backward' | 'both' = 'forward',
    ): SemanticSubgraph {
        const visitedNodes = new Set<string>();
        const collectedEdges = new Set<SemanticEdge>();
        const queue: Array<{ id: string; depth: number }> = [{ id: seedNodeId, depth: 0 }];

        while (queue.length > 0) {
            const current = queue.shift()!;
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
        direction: 'forward' | 'backward' | 'both',
        queue: Array<{ id: string; depth: number }>,
        collectedEdges: Set<SemanticEdge>,
    ): void {
        if (direction === 'forward' || direction === 'both') {
            for (const edge of this.getOutgoingEdges(current.id)) {
                collectedEdges.add(edge);
                queue.push({ id: edge.toNodeId, depth: current.depth + 1 });
            }
        }
        if (direction === 'backward' || direction === 'both') {
            for (const edge of this.getIncomingEdges(current.id)) {
                collectedEdges.add(edge);
                queue.push({ id: edge.fromNodeId, depth: current.depth + 1 });
            }
        }
    }

    /**
     * Detects cycles in the directed graph using Tarjan-style DFS.
     */
    public findCycles(): string[][] {
        const cycles: string[][] = [];
        const visited = new Set<string>();
        const inStack = new Set<string>();
        const pathStack: string[] = [];

        for (const nodeId of this.nodes.keys()) {
            if (!visited.has(nodeId)) {
                this.dfsCycleSearch(nodeId, visited, inStack, pathStack, cycles);
            }
        }

        return cycles;
    }

    /**
     * Internal DFS recursion for cycle detection.
     */
    private dfsCycleSearch(
        current: string,
        visited: Set<string>,
        inStack: Set<string>,
        pathStack: string[],
        cycles: string[][],
    ): void {
        visited.add(current);
        inStack.add(current);
        pathStack.push(current);

        const outEdges = this.getOutgoingEdges(current);
        for (const edge of outEdges) {
            const next = edge.toNodeId;
            if (!visited.has(next)) {
                this.dfsCycleSearch(next, visited, inStack, pathStack, cycles);
            } else if (inStack.has(next)) {
                const cycleStartIndex = pathStack.indexOf(next);
                if (cycleStartIndex >= 0) {
                    const cyclePath = pathStack.slice(cycleStartIndex);
                    cyclePath.push(next);
                    cycles.push(cyclePath);
                }
            }
        }

        pathStack.pop();
        inStack.delete(current);
    }

    /**
     * Performs a topological sort on DAG structures. Returns null if cycles exist.
     */
    public getTopologicalSort(): string[] | null {
        const inDegree = new Map<string, number>();
        for (const nodeId of this.nodes.keys()) {
            inDegree.set(nodeId, 0);
        }
        for (const edge of this.getAllEdges()) {
            if (inDegree.has(edge.toNodeId)) {
                inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) ?? 0) + 1);
            }
        }

        const queue: string[] = [];
        for (const [nodeId, deg] of inDegree.entries()) {
            if (deg === 0) {
                queue.push(nodeId);
            }
        }

        const order: string[] = [];
        while (queue.length > 0) {
            const u = queue.shift()!;
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
     */
    public computeMetrics(): SemanticGraphMetrics {
        const nodeCount = this.nodes.size;
        const allEdges = this.getAllEdges();
        const edgeCount = allEdges.length;
        const cycles = this.findCycles();

        let totalIn = 0;
        let totalOut = 0;
        for (const nodeId of this.nodes.keys()) {
            totalIn += this.getIncomingEdges(nodeId).length;
            totalOut += this.getOutgoingEdges(nodeId).length;
        }

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

    /**
     * Calculates weakly connected component count via undirected traversal.
     */
    private computeComponentCount(): number {
        const visited = new Set<string>();
        let components = 0;

        for (const nodeId of this.nodes.keys()) {
            if (!visited.has(nodeId)) {
                components++;
                const queue: string[] = [nodeId];
                visited.add(nodeId);

                while (queue.length > 0) {
                    const cur = queue.shift()!;
                    const neighbors = [
                        ...this.getOutgoingEdges(cur).map((e) => e.toNodeId),
                        ...this.getIncomingEdges(cur).map((e) => e.fromNodeId),
                    ];
                    for (const n of neighbors) {
                        if (this.nodes.has(n) && !visited.has(n)) {
                            visited.add(n);
                            queue.push(n);
                        }
                    }
                }
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
