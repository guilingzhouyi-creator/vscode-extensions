/**
 * Module: Algorithmic Operator Template — Branchless LUT & Epoch CSR Graph Operator
 * File Path: .agents/skills/algorithmic-operator-engineering/templates/branchless-lut-and-epoch-operator.ts
 * Architecture Role: Reference operator template demonstrating data-oriented CSR flat graph storage,
 *   256-entry Uint8Array branchless character classification, and O(1) epoch-counter BFS traversal.
 * Dependencies & Triggers: Pure TypeScript zero-dependency operator template;
 *   used as a blueprint when engineering high-throughput analyzers or graph/text operators.
 * Responsibilities:
 *   1. Provide O(1) branchless ASCII token classification via static 256-entry Uint8Array LUT.
 *   2. Maintain a zero-allocation Compressed Sparse Row (CSR) flat graph arena.
 *   3. Execute O(1)-reset breadth-first reachability queries using monotonic epoch counters.
 * Exit Semantics & Design Rationale: Avoids pointer-chasing object graphs and per-query Set/fill
 *   allocations; falls back gracefully when node count exceeds preallocated arena capacity.
 */

const FLAG_WHITESPACE = 1 << 0;
const FLAG_OPERATOR = 1 << 1;

const ASCII_CLASS_LUT: Uint8Array = (() => {
    const table = new Uint8Array(256);
    const wsCodes = [9, 10, 11, 12, 13, 32];
    for (let i = 0; i < wsCodes.length; i++) {
        table[wsCodes[i]] |= FLAG_WHITESPACE;
    }
    const ops = '?:+-*/%&|^!~=<>';
    for (let i = 0; i < ops.length; i++) {
        table[ops.charCodeAt(i)] |= FLAG_OPERATOR;
    }
    return table;
})();

/**
 * Invariant: Evaluates non-whitespace and operator counts in a single O(N) pass with zero heap allocations.
 *
 * @param line - Input source line.
 * @returns Packed 32-bit integer where high 16 bits = operator count, low 16 bits = non-whitespace count.
 */
export function computePackedLineMetrics(line: string): number {
    let nonWs = 0;
    let ops = 0;
    const len = line.length;
    for (let i = 0; i < len; i++) {
        const code = line.charCodeAt(i);
        const flags = code < 256 ? ASCII_CLASS_LUT[code] : 0;
        nonWs += (flags & FLAG_WHITESPACE) === 0 ? 1 : 0;
        ops += (flags & FLAG_OPERATOR) !== 0 ? 1 : 0;
    }
    return ((ops & 0xffff) << 16) | (nonWs & 0xffff);
}

/**
 * Flat CSR Graph Arena with O(1) Epoch-Counter Reachability Solver.
 * Degradation Threshold: Automatically caps traversal at maxNodes capacity invariant.
 */
export class FlatCsrEpochReachability {
    private readonly head: Int32Array;
    private readonly to: Int32Array;
    private readonly next: Int32Array;
    private readonly visitedEpoch: Int32Array;
    private readonly queue: Int32Array;
    private edgeCount = 0;
    private currentEpoch = 1;

    constructor(maxNodes: number, maxEdges: number) {
        this.head = new Int32Array(maxNodes).fill(-1);
        this.to = new Int32Array(maxEdges);
        this.next = new Int32Array(maxEdges);
        this.visitedEpoch = new Int32Array(maxNodes);
        this.queue = new Int32Array(maxNodes);
    }

    public addDirectedEdge(u: number, v: number): void {
        if (this.edgeCount >= this.to.length) {
            return;
        }
        const idx = this.edgeCount++;
        this.to[idx] = v;
        this.next[idx] = this.head[u];
        this.head[u] = idx;
    }

    /**
     * Computes reachable node count from startNode in O(V_reached + E_reached)
     * with O(1) state reset between queries (zero Set allocation, zero array fill).
     */
    public countReachable(startNode: number): number {
        if (startNode < 0 || startNode >= this.head.length) {
            return 0;
        }
        const epoch = this.nextEpoch();
        let qHead = 0;
        let qTail = 0;

        this.visitedEpoch[startNode] = epoch;
        this.queue[qTail++] = startNode;

        while (qHead < qTail) {
            const u = this.queue[qHead++];
            for (let e = this.head[u]; e !== -1; e = this.next[e]) {
                const v = this.to[e];
                if (this.visitedEpoch[v] !== epoch) {
                    this.visitedEpoch[v] = epoch;
                    this.queue[qTail++] = v;
                }
            }
        }
        return qTail;
    }

    private nextEpoch(): number {
        this.currentEpoch = (this.currentEpoch + 1) | 0;
        if (this.currentEpoch <= 0) {
            this.visitedEpoch.fill(0);
            this.currentEpoch = 1;
        }
        return this.currentEpoch;
    }
}
