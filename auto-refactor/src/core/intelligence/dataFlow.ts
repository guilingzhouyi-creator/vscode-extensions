/**
 * Module: Core Intelligence — Data Flow & Lifecycle Graph
 * File Path: src/core/intelligence/dataFlow.ts
 * Architecture Role: Graph-based analysis of end-to-end data lifecycle stages
 *   (Source -> Validation -> Transformation -> Storage -> Bus -> Consumer -> SideEffect),
 *   unbounded memory growth detection (O(t) timer and O(n) loop leaks), and incremental
 *   coupling/maintainability metrics.
 * Dependencies & Triggers: Core types (Issue, NEED_RUNTIME_EVIDENCE), PerformanceMessages and the
 *   shared source-mask primitive; invoked during performance scanning, asymmetric review tracks,
 *   and consumer gate runners.
 * Responsibilities: Model dataflow nodes with ownership and lifetime; trace multi-stage lifecycle
 *   pipelines; detect unbounded accumulation in collections; compute incremental coupling,
 *   duplication and maintainability deltas and reject the "deleted lines but increased coupling"
 *   maintainability anti-pattern. Every content heuristic reads the shared masked view, never a raw
 *   line.
 * Exit Semantics & Design Rationale: Pure computational graph and heuristic detection. Functions
 *   never throw unhandled errors; analysis returns structured diagnostics and metrics.
 *
 * PROVENANCE — read before relying on this module's parts:
 *   - `detectUnboundedGrowth`, `computeCoupling`, `computeEffectiveLoc`, `computeComplexityProxy`,
 *     `countDuplicateLines` and `computeIncrementalMetrics` ARE wired: the performance analyzer and
 *     the consumer coupling gate call them, and `scripts/validate-data-flow.js` asserts them.
 *   - `DataFlowGraph` (with `traceLifecycle` / `findPipelines` / `stats`) is **Unwired**: nothing
 *     but the verification harness builds one, because no traversal yet constructs a graph from
 *     real source. Per the work-order rule that a capability needs "entry reachable + real data in
 *     + logic executed + result consumed", it must be reported as Unwired — not as delivered
 *     lifecycle analysis — until a producer feeds it and a consumer reads it.
 */

import type { Issue } from '../types';
import { NEED_RUNTIME_EVIDENCE } from '../types';
import { PerformanceMessages } from '../messages/performance';
import { maskedLinesOfPath } from '../policy/source-mask';
import type { NativeDominatorTreeResult, NativeDataflowResult } from '../native/native-types';
import { nativeCore } from '../native/native-bridge';

// The incremental metrics live in their own module (this file crossed the repository's own
// large-file fail threshold); re-exported here so the public surface stays one import site.
export {
    computeCoupling,
    computeEffectiveLoc,
    computeComplexityProxy,
    computeIncrementalMetrics,
    countDuplicateLines,
    extractDependencies,
    IncrementalMetrics,
    IncrementalOptions,
} from './incrementalMetrics';

/** Seven canonical lifecycle stages of data moving through an application. */
export type LifecycleStage =
    'Source' | 'Validation' | 'Transformation' | 'Storage' | 'Bus' | 'Consumer' | 'SideEffect';

const STAGE_SOURCE = 'Source' as const;
const STAGE_VALIDATION = 'Validation' as const;
const STAGE_TRANSFORMATION = 'Transformation' as const;
const STAGE_STORAGE = 'Storage' as const;
const STAGE_BUS = 'Bus' as const;
const STAGE_CONSUMER = 'Consumer' as const;
const STAGE_SIDE_EFFECT = 'SideEffect' as const;

/** Lifetime duration of data or state at a specific node. */
export type LifetimeKind = 'ephemeral' | 'scoped' | 'persistent' | 'unbounded';

/** Transfer mechanism connecting two lifecycle nodes. */
export type TransferType = 'direct' | 'async' | 'event' | 'storage';

/** A node representing a discrete data operation, variable, or boundary in the flow graph. */
export interface DataFlowNode {
    id: string;
    name: string;
    filePath: string;
    stage: LifecycleStage;
    ownership: string;
    lifetime: LifetimeKind;
    loc?: { line: number; column: number };
}

/** Directed edge between two data flow nodes representing value or control transfer. */
export interface DataFlowEdge {
    from: string;
    to: string;
    transferType: TransferType;
    description?: string;
}

/** Distribution statistics summarizing a data flow graph. */
export interface DataFlowGraphStats {
    totalNodes: number;
    totalEdges: number;
    stageDistribution: Record<LifecycleStage, number>;
    lifetimeDistribution: Record<LifetimeKind, number>;
}

/** Directed graph modeling data transformations and lifecycle stages across components. */
export class DataFlowGraph {
    private readonly nodes = new Map<string, DataFlowNode>();
    private readonly edges: DataFlowEdge[] = [];
    private readonly outgoing = new Map<string, DataFlowEdge[]>();
    private readonly incoming = new Map<string, DataFlowEdge[]>();

    /**
     * Registers a data flow node into the graph, keyed by its unique identifier.
     * Overwrite behavior is idempotent: if a node with the same `id` already exists,
     * its metadata is replaced in-place without invalidating existing edges.
     *
     * @param node - The data flow node descriptor to register or overwrite.
     */
    public addNode(node: DataFlowNode): void {
        this.nodes.set(node.id, node);
    }

    /**
     * Appends a directed transfer edge between two data flow nodes and updates
     * internal outgoing and incoming adjacency indexes.
     *
     * @param edge - The directed data flow edge linking source and target nodes.
     */
    public addEdge(edge: DataFlowEdge): void {
        this.edges.push(edge);
        const outList = this.outgoing.get(edge.from) ?? [];
        outList.push(edge);
        this.outgoing.set(edge.from, outList);

        const inList = this.incoming.get(edge.to) ?? [];
        inList.push(edge);
        this.incoming.set(edge.to, inList);
    }

    /**
     * Retrieves a registered data flow node by its unique identifier.
     *
     * @param id - Unique identifier of the node to look up.
     * @returns The matching DataFlowNode if present in the graph, or undefined if not found.
     */
    public getNode(id: string): DataFlowNode | undefined {
        return !id ? undefined : this.nodes.get(id);
    }

    /**
     * Retrieves all registered data flow nodes in insertion order.
     *
     * @returns Read-only array of all active DataFlowNode descriptors in the graph.
     */
    public getNodes(): readonly DataFlowNode[] {
        return Array.from(this.nodes.values());
    }

    /**
     * Retrieves all registered directed data flow edges in the graph.
     *
     * @returns Read-only array of all DataFlowEdge descriptors in registration order.
     */
    public getEdges(): readonly DataFlowEdge[] {
        return this.edges;
    }

    /**
     * Queries all directed edges originating from the specified source node.
     *
     * @param id - Identifier of the source node whose outgoing edges are requested.
     * @returns Read-only array of outgoing DataFlowEdge instances, or an empty array if none exist.
     */
    public getOutgoingEdges(id: string): readonly DataFlowEdge[] {
        return this.outgoing.get(id) ?? [];
    }

    /**
     * Queries all directed edges terminating at the specified destination node.
     *
     * @param id - Identifier of the destination node whose incoming edges are requested.
     * @returns Read-only array of incoming DataFlowEdge instances, or an empty array if none exist.
     */
    public getIncomingEdges(id: string): readonly DataFlowEdge[] {
        return this.incoming.get(id) ?? [];
    }

    /**
     * Compute the ordered sequence of distinct lifecycle stages reachable from a start node.
     *
     * @param startNodeId - Identifier of the root node to begin traversal from.
     * @returns Ordered array of distinct lifecycle stages encountered.
     */
    public computeLifecycleTrace(startNodeId: string): LifecycleStage[] {
        const visited = new Set<string>();
        const seenStages = new Set<LifecycleStage>();
        const stages: LifecycleStage[] = [];
        const queue: string[] = [startNodeId];
        let head = 0;

        while (head < queue.length) {
            const currentId = queue[head++];
            if (visited.has(currentId)) continue;
            visited.add(currentId);

            const node = this.nodes.get(currentId);
            if (node && !seenStages.has(node.stage)) {
                seenStages.add(node.stage);
                stages.push(node.stage);
            }

            const edges = this.outgoing.get(currentId) ?? [];
            for (const edge of edges) {
                if (!visited.has(edge.to)) {
                    queue.push(edge.to);
                }
            }
        }
        return stages;
    }

    private findLastReachableNode(src: DataFlowNode): DataFlowNode {
        let lastNode = src;
        const visited = new Set<string>();
        const queue = [src.id];
        let head = 0;
        while (head < queue.length) {
            const current = queue[head++];
            if (visited.has(current)) continue;
            visited.add(current);
            const n = this.nodes.get(current);
            if (n) lastNode = n;
            const outgoingEdges = this.outgoing.get(current);
            if (outgoingEdges) {
                for (const e of outgoingEdges) {
                    if (!visited.has(e.to)) {
                        queue.push(e.to);
                    }
                }
            }
        }
        return lastNode;
    }

    /**
     * Finds end-to-end data processing pipelines traversing from Source nodes.
     *
     * @returns Array of discovered pipeline descriptors with start, stages, and end node.
     */
    public findPipelines(): Array<{
        startNode: DataFlowNode;
        stages: LifecycleStage[];
        endNode: DataFlowNode;
    }> {
        const sources = Array.from(this.nodes.values()).filter((n) => n.stage === STAGE_SOURCE);
        const pipelines: Array<{
            startNode: DataFlowNode;
            stages: LifecycleStage[];
            endNode: DataFlowNode;
        }> = [];

        for (const src of sources) {
            const stages = this.computeLifecycleTrace(src.id);
            const lastNode = this.findLastReachableNode(src);
            pipelines.push({
                startNode: src,
                stages,
                endNode: lastNode,
            });
        }
        return pipelines;
    }

    /**
     * Calculate aggregate statistics on nodes, edges, and distributions.
     *
     * @returns Structured distribution metrics across stages and lifetimes.
     */
    public stats(): DataFlowGraphStats {
        const stageDist: Record<LifecycleStage, number> = {
            [STAGE_SOURCE]: 0,
            [STAGE_VALIDATION]: 0,
            [STAGE_TRANSFORMATION]: 0,
            [STAGE_STORAGE]: 0,
            [STAGE_BUS]: 0,
            [STAGE_CONSUMER]: 0,
            [STAGE_SIDE_EFFECT]: 0,
        };
        const lifeDist: Record<LifetimeKind, number> = {
            ephemeral: 0,
            scoped: 0,
            persistent: 0,
            unbounded: 0,
        };
        for (const n of this.nodes.values()) {
            stageDist[n.stage] = (stageDist[n.stage] ?? 0) + 1;
            lifeDist[n.lifetime] = (lifeDist[n.lifetime] ?? 0) + 1;
        }
        return {
            totalNodes: this.nodes.size,
            totalEdges: this.edges.length,
            stageDistribution: stageDist,
            lifetimeDistribution: lifeDist,
        };
    }

    /**
     * Computes the immediate dominator tree and dominance frontiers for the flow graph.
     *
     * @param entryNodeId - Identifier of the root/entry node.
     * @returns Dominator tree structure with immediate dominators and loops.
     */
    public computeDominators(entryNodeId: string): NativeDominatorTreeResult {
        const nodeIds = Array.from(this.nodes.keys());
        const edgeTuples: Array<[string, string]> = this.edges.map((e) => [e.from, e.to]);
        return nativeCore.computeDominatorTree(entryNodeId, nodeIds, edgeTuples);
    }

    /**
     * Solves dataflow equations across this graph to a fixed point.
     *
     * @param entryNodeId - Identifier of the root/entry node.
     * @param gen - Generator mapping per node ID.
     * @param kill - Kill set mapping per node ID.
     * @param forward - True for forward analysis, false for backward analysis.
     * @returns Converged In and Out sets per node ID.
     */
    public computeDataflow(
        entryNodeId: string,
        gen?: Record<string, string[]>,
        kill?: Record<string, string[]>,
        forward = true,
    ): NativeDataflowResult {
        const nodeIds = Array.from(this.nodes.keys());
        const edgeTuples: Array<[string, string]> = this.edges.map((e) => [e.from, e.to]);
        return nativeCore.solveDataflow({
            entry: entryNodeId,
            nodes: nodeIds,
            edges: edgeTuples,
            forward,
            gen,
            kill,
        });
    }

    /**
     * Backward-compatible alias for computeDataflow.
     */
    public solveDataflow(
        entryNodeId: string,
        gen?: Record<string, string[]>,
        kill?: Record<string, string[]>,
        forward = true,
    ): NativeDataflowResult {
        return this.computeDataflow(entryNodeId, gen, kill, forward);
    }
}

const REGEX_ESCAPE_REPLACEMENT = '\\$&';

/**
 * Escape a literal for use inside a `RegExp`.
 *
 * @param rawText - Raw identifier text.
 * @returns The same text with regex metacharacters escaped.
 */
function escapeRegExp(rawText: string): string {
    return rawText.replace(/[.*+?^${}()|[\]\\]/g, REGEX_ESCAPE_REPLACEMENT);
}

/**
 * Collection declaration head.
 *
 * Covers module-scope declarations (`const buf = []`), `this.` assignments and CLASS FIELDS
 * (`private entries: string[] = []`), because a field buffer accumulated in a loop is the most
 * common real shape and the previous `const|let|var|this.` prefix missed it entirely.
 */
const COLLECTION_DECL_RE =
    /(?:^|[\s;{,])(?:const|let|var|readonly|private|public|protected|static|\s)*\s*(?:this\.)?([A-Za-z0-9_$]+)\s*(?::[^=;]*)?=\s*(?:\[\s*\]|new\s+(?:Array|Map|Set|WeakMap|WeakSet)\b)/g;

/** Append/side-effect call on a collection. */
const APPEND_CALL_RE = '\\b%s\\.(?:push|add|set)\\s*\\(';

/** An opener whose braced body must be tracked. */
type ScopeKind = 'timer' | 'loop' | 'plain';

/** A tracked braced scope. */
interface OpenScope {
    kind: ScopeKind;
    line: number;
    depth: number;
}

/**
 * Find every collection declaration that could leak if appended without bounds.
 *
 * @param content - Full file content.
 * @returns Map of collection name to the 1-based line of its declaration.
 */
function findCollectionDeclarations(content: string): Map<string, number> {
    const declMap = new Map<string, number>();
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        COLLECTION_DECL_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = COLLECTION_DECL_RE.exec(lines[i])) !== null) {
            // Later declarations must not silently overwrite earlier ones: a name reused in two
            // scopes would otherwise inherit the other scope's line and disable the check.
            if (!declMap.has(match[1])) declMap.set(match[1], i + 1);
        }
    }
    return declMap;
}

/**
 * Check whether a collection has bounding or eviction logic applied to IT.
 *
 * Every pattern is scoped to the collection name. A file-wide keyword test used to sit here, which
 * meant a single unrelated `limit`/`capacity`/`ringBuffer` occurrence anywhere in the file silenced
 * the rule for every collection in it.
 *
 * @param content - Full file content.
 * @param name - Collection identifier.
 * @returns True when the collection is provably bounded.
 */
function hasCapacityBounding(content: string, name: string): boolean {
    const escaped = escapeRegExp(name);
    const comparison = `(?:[<>]=?|===?|!==?)\\s*\\d`;
    const boundingPatterns = [
        new RegExp(`\\b${escaped}\\.length\\s*${comparison}`),
        new RegExp(`\\b${escaped}\\.size\\s*${comparison}`),
        new RegExp(`\\b${escaped}\\.(?:shift|pop|splice|slice|clear|delete)\\s*\\(`),
        new RegExp(
            `(?:MAX|LIMIT|CAPACITY)[A-Za-z0-9_$]*\\s*(?:[<>]=?)\\s*\\b${escaped}\\.(?:length|size)`,
        ),
    ];
    return boundingPatterns.some((pattern) => pattern.test(content));
}

/**
 * Detect unbounded memory accumulation hazards (O(t) timer leaks and O(n) loop leaks).
 *
 * Reading the MASKED view is what makes the depth bookkeeping trustworthy: a brace inside a string,
 * template or comment no longer shifts the scope, and a `#`/`//` in prose no longer truncates a
 * line. Enclosing scopes are tracked as a stack keyed by brace depth, so a callback that opens and
 * closes on one physical line is scoped correctly instead of leaving a flag stuck for the following
 * lines.
 *
 * @param filePath - Path of the source file being scanned.
 * @param content - Full text of the source file.
 * @returns List of PRF-LEAK-001 issues identifying unbounded collection growth.
 */
export function detectUnboundedGrowth(filePath: string, content: string): Issue[] {
    const normalizedFile = filePath.replace(/\\/g, '/');
    const collections = findCollectionDeclarations(content);
    if (collections.size === 0) return [];

    // Comments, strings and (for the C family) regex literals are blanked at the same length, so
    // brace positions and reported columns still match the raw source.
    const masked = maskedLinesOfPath(filePath, content);
    const ctx: GrowthScanContext = {
        appendRes: buildAppendRes(collections.keys()),
        collections,
        // Bounded or not is a per-collection fact: deciding it once avoids re-scanning the whole
        // file for every append site.
        bounded: findBoundedCollections(content, collections.keys()),
        file: normalizedFile,
    };

    const issues: Issue[] = [];
    const scopes: OpenScope[] = [];
    let depth = 0;

    for (let i = 0; i < masked.length; i++) {
        const scan = scanLine({
            code: masked[i],
            lineNum: i + 1,
            scopes,
            depth,
            ctx,
        });
        issues.push(...scan.issues);
        depth = scan.depth;
    }

    return issues;
}

/** An append/side-effect call site on a masked line. */
interface AppendSite {
    /** Index of the match start within the masked line. */
    index: number;
    /** Collection identifier being appended to. */
    name: string;
    /** Length of the matched call text. */
    length: number;
}

const SCOPE_KIND_PLAIN: ScopeKind = 'plain';
const SCOPE_KIND_TIMER: ScopeKind = 'timer';
const SCOPE_KIND_LOOP: ScopeKind = 'loop';

const COMPLEXITY_TIME = 'O(t)';
const COMPLEXITY_INPUT = 'O(n)';
const CONTEXT_TIMER = 'timer callback';
const CONTEXT_LOOP = 'iteration loop';
const ANALYZER_PERFORMANCE = 'performance';
const RULE_PRF_LEAK = 'PRF-LEAK-001';
const SEVERITY_WARNING = 'warning';

/** An opener that may own a braced or braceless body on its line. */
interface Opener {
    kind: ScopeKind;
    /** Index of the opener token within the masked line. */
    index: number;
}

/** Per-file facts a line-level growth scan needs. */
interface GrowthScanContext {
    /** Append-call matcher per collection name. */
    appendRes: Map<string, RegExp>;
    /** Collection name to declaration line. */
    collections: Map<string, number>;
    /** Collections proven to be bounded. */
    bounded: Set<string>;
    /** Normalized file path for emitted issues. */
    file: string;
}

/**
 * Build the append-call matcher for every collection.
 *
 * @param names - Collection identifiers declared in the file.
 * @returns One matcher per name, each carrying the global flag for repeated exec.
 */
function buildAppendRes(names: Iterable<string>): Map<string, RegExp> {
    const appendPatternByNameMap = new Map<string, RegExp>();
    for (const name of names) {
        appendPatternByNameMap.set(
            name,
            new RegExp(APPEND_CALL_RE.replaceAll('%s', escapeRegExp(name)), 'g'),
        );
    }
    return appendPatternByNameMap;
}

/**
 * Decide once per file which collections are provably bounded.
 *
 * @param content - Full file content.
 * @param names - Collection identifiers declared in the file.
 * @returns Names for which bounding evidence was found.
 */
function findBoundedCollections(content: string, names: Iterable<string>): Set<string> {
    const bounded = new Set<string>();
    for (const name of names) {
        if (hasCapacityBounding(content, name)) bounded.add(name);
    }
    return bounded;
}

/**
 * Find the openers that may own a body on this line.
 *
 * @param code - Masked line.
 * @returns Openers ordered by their index on the line.
 */
function extractOpeners(code: string): Opener[] {
    const openers: Opener[] = [];
    const timer = /\b(?:setInterval|setTimeout)\s*\(/.exec(code);
    if (timer) openers.push({ kind: SCOPE_KIND_TIMER, index: timer.index });
    const loop = /\b(?:while|for)\s*\(/.exec(code);
    if (loop) openers.push({ kind: SCOPE_KIND_LOOP, index: loop.index });
    openers.sort((a, b) => a.index - b.index);
    return openers;
}

/**
 * Detect a braceless body, which owns the rest of its line.
 *
 * @param code - Masked line.
 * @param openers - Openers found on this line.
 * @returns The opener owning a braceless body, or null when none does.
 */
function findBracelessOpener(code: string, openers: Opener[]): Opener | null {
    if (openers.length === 0) return null;
    const firstOpener = openers[0];
    return !code.slice(firstOpener.index).includes('{') ? firstOpener : null;
}

/**
 * Find the append sites on this line.
 *
 * @param code - Masked line.
 * @param appendRes - Append-call matcher per collection.
 * @returns Sites ordered by their index on the line.
 */
function collectAppendSites(code: string, appendRes: Map<string, RegExp>): AppendSite[] {
    const sites: AppendSite[] = [];
    for (const [name, re] of appendRes) {
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(code)) !== null) {
            sites.push({ index: match.index, name, length: match[0].length });
        }
    }
    sites.sort((a, b) => a.index - b.index);
    return sites;
}

/** Scope resolution context parameters. */
interface ScopeResolutionParams {
    site: AppendSite;
    scopes: OpenScope[];
    braceless: Opener | null;
    lineNum: number;
    depth: number;
}

/**
 * Resolve the scope enclosing an append site.
 *
 * @param params - Scope resolution parameter object.
 * @returns The enclosing scope, or null when the site sits at top level.
 */
function findEnclosingScope(params: ScopeResolutionParams): OpenScope | null {
    const { site, scopes, braceless, lineNum, depth } = params;
    const innermost = scopes.length > 0 ? scopes[scopes.length - 1] : null;
    if (innermost) return innermost;
    if (braceless && site.index > braceless.index) {
        return { kind: braceless.kind, line: lineNum, depth };
    }
    return null;
}

/** Mutable cursor state for one line's brace walk. */
interface BraceWalk {
    /** Brace depth after the characters processed so far. */
    depth: number;
    /** Cursor into the line's opener list. */
    openerCursor: number;
    /** Cursor into the line's append-site list. */
    appendCursor: number;
}

/** Result of scanning one masked line. */
interface LineScan {
    /** Findings produced on this line. */
    issues: Issue[];
    /** Brace depth after this line. */
    depth: number;
}

/** Parameter bundle for scanning a masked source line. */
interface LineScanParams {
    code: string;
    lineNum: number;
    scopes: OpenScope[];
    depth: number;
    ctx: GrowthScanContext;
}

/** Parameter bundle for emitting append sites at a specific character offset. */
interface EmitSitesParams {
    walk: BraceWalk;
    appends: AppendSite[];
    charIndex: number;
    lineNum: number;
    scopes: OpenScope[];
    braceless: Opener | null;
    ctx: GrowthScanContext;
    out: Issue[];
}

/** Parameter bundle for resolving growth issues for an append site. */
interface GrowthIssueParams {
    site: AppendSite;
    lineNum: number;
    scopes: OpenScope[];
    braceless: Opener | null;
    depth: number;
    ctx: GrowthScanContext;
}

/** Parameter bundle for updating brace depth and active scope tracking. */
interface BraceCharParams {
    char: string;
    charIndex: number;
    walk: BraceWalk;
    openers: Opener[];
    scopes: OpenScope[];
    lineNum: number;
}

/**
 * Scan one masked line: emit growth findings and advance the scope stack.
 *
 * Appends and braces are walked TOGETHER in character order, because a callback that opens and
 * closes on one physical line must already be on the scope stack when its own body appends. Two
 * separate passes made that same-line case report nothing.
 *
 * @param params - Line scan parameter object.
 * @returns Findings for this line plus the depth after it.
 */
function scanLine(params: LineScanParams): LineScan {
    const { code, lineNum, scopes, depth, ctx } = params;
    const openers = extractOpeners(code);
    const braceless = findBracelessOpener(code, openers);
    const appends = collectAppendSites(code, ctx.appendRes);
    const walk: BraceWalk = { depth, openerCursor: 0, appendCursor: 0 };
    const issues: Issue[] = [];

    for (let charIndex = 0; charIndex < code.length; charIndex += 1) {
        emitSitesAt({
            walk,
            appends,
            charIndex,
            lineNum,
            scopes,
            braceless,
            ctx,
            out: issues,
        });
        applyBraceChar({
            char: code[charIndex],
            charIndex,
            walk,
            openers,
            scopes,
            lineNum,
        });
    }

    return { issues, depth: walk.depth };
}

/**
 * Emit findings for the append sites that start at this character index.
 *
 * @param params - Emission parameter object.
 */
function emitSitesAt(params: EmitSitesParams): void {
    const { walk, appends, charIndex, lineNum, scopes, braceless, ctx, out } = params;
    while (walk.appendCursor < appends.length && appends[walk.appendCursor].index === charIndex) {
        const site = appends[walk.appendCursor];
        walk.appendCursor += 1;
        const issue = createGrowthIssue({
            site,
            lineNum,
            scopes,
            braceless,
            depth: walk.depth,
            ctx,
        });
        if (issue) out.push(issue);
    }
}

/**
 * Build the finding for one append site, or null when it is out of scope.
 *
 * @param params - Growth resolution parameter object.
 * @returns The finding, or null when the site is bounded, pre-declaration or top-level.
 */
function createGrowthIssue(params: GrowthIssueParams): Issue | null {
    const { site, lineNum, scopes, braceless, depth, ctx } = params;
    const declLine = ctx.collections.get(site.name) ?? 0;
    if (lineNum <= declLine || ctx.bounded.has(site.name)) return null;
    const enclosing = findEnclosingScope({ site, scopes, braceless, lineNum, depth });
    if (!enclosing || enclosing.kind === SCOPE_KIND_PLAIN) return null;
    return buildGrowthIssue(enclosing, site, lineNum, ctx.file);
}

/**
 * Apply one character of brace bookkeeping.
 *
 * @param params - Brace character update parameters.
 */
function applyBraceChar(params: BraceCharParams): void {
    const { char, charIndex, walk, openers, scopes, lineNum } = params;
    if (char === '{') {
        walk.depth += 1;
        const next = openers[walk.openerCursor];
        if (next && next.index < charIndex) {
            walk.openerCursor += 1;
            scopes.push({ kind: next.kind, line: lineNum, depth: walk.depth });
        } else {
            scopes.push({ kind: SCOPE_KIND_PLAIN, line: lineNum, depth: walk.depth });
        }
    } else if (char === '}' && walk.depth > 0) {
        while (scopes.length > 0 && scopes[scopes.length - 1].depth >= walk.depth) {
            scopes.pop();
        }
        walk.depth -= 1;
    }
}

/**
 * Build the PRF-LEAK-001 issue for one append site.
 *
 * @param scope - Enclosing tracked scope supplying the complexity verdict.
 * @param site - Append site: collection name, masked-line index and matched text length.
 * @param lineNum - 1-based line of the append.
 * @param file - Normalized file path.
 * @returns The issue record.
 */
function buildGrowthIssue(
    scope: OpenScope,
    site: AppendSite,
    lineNum: number,
    file: string,
): Issue {
    const complexity: 'O(t)' | 'O(n)' =
        scope.kind === SCOPE_KIND_TIMER ? COMPLEXITY_TIME : COMPLEXITY_INPUT;
    const context = complexity === COMPLEXITY_TIME ? CONTEXT_TIMER : CONTEXT_LOOP;
    const desc = PerformanceMessages.UNBOUNDED_GROWTH(site.name, complexity, context);
    return {
        id: `${ANALYZER_PERFORMANCE}:${RULE_PRF_LEAK}:${file}:${lineNum}:${site.index}`,
        analyzer: ANALYZER_PERFORMANCE,
        rule: RULE_PRF_LEAK,
        severity: SEVERITY_WARNING,
        message: desc.message,
        location: {
            file,
            start: { line: lineNum, column: site.index + 1 },
            end: { line: lineNum, column: site.index + site.length + 1 },
        },
        detail: {
            collectionName: site.name,
            complexity,
            triggerLine: scope.line,
        },
        suggestion: desc.suggestion,
        evidence: {
            confidence: 0.85,
            requiresRuntime: true,
            runtimeEvidenceReason: NEED_RUNTIME_EVIDENCE,
        },
    };
}
