/**
 * Module: Core Architecture — Semantic Architecture Graph Topology
 * File Path: src/core/architecture/semanticArchitectureGraph.ts
 * Architecture Role: In-memory multi-language architectural graph modeling system topology roles,
 *   cross-domain dependencies, and unidirectional boundary contracts.
 * Dependencies & Triggers: Consumes SemanticGraph from core/semantic, types from ./types.
 * Responsibilities: Graph construction from SemanticGraph or file lists, layer inversion detection,
 *   and boundary breach indexing.
 * Exit Semantics & Design Rationale: Bounded graph queries and pure topological deductions.
 */

import type { SemanticGraph } from '../semantic/semanticGraph';
import { FORBIDDEN_HEADLESS_IMPORTS } from '../intelligence/semanticArchitecture';
import { extractDomainName, inferSystemTopologyRole } from './roleInference';
import type {
    ArchitectureAuditOptions,
    SemanticArchitectureEdge,
    SemanticArchitectureNode,
    SystemTopologyRole,
} from './types';
import { DEFAULT_ALLOWED_DEPENDENCIES } from './types';

/**
 * File descriptor used for building the architecture graph.
 */
export interface SourceArchitectureFile {
    filePath: string;
    imports: string[];
    exports?: string[];
    content?: string;
    hasDirectConfigAccess?: boolean;
    hasGlobalMutableState?: boolean;
}

/**
 * Normalizes a file path to forward slashes.
 */
function normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * Reports whether an import targets private or internal paths.
 */
function isPrivateInternalPath(importPath: string): boolean {
    return (
        importPath.includes('/internal/') ||
        importPath.includes('/impl/') ||
        importPath.includes('/private/')
    );
}

/**
 * High-performance semantic architecture graph representation.
 */
export class SemanticArchitectureGraph {
    private readonly nodes: Map<string, SemanticArchitectureNode> = new Map();
    private readonly pathIndex: Map<string, string> = new Map();
    private readonly edges: SemanticArchitectureEdge[] = [];
    private readonly edgeIndex: Set<string> = new Set();

    /**
     * Adds an architecture node to the graph.
     */
    public addNode(node: SemanticArchitectureNode): this {
        this.nodes.set(node.id, node);
        const norm = normalizePath(node.filePath);
        this.pathIndex.set(norm, node.id);
        return this;
    }

    /**
     * Retrieves a node by id or file path in O(1) time.
     */
    public getNode(idOrPath: string): SemanticArchitectureNode | undefined {
        const direct = this.nodes.get(idOrPath);
        if (direct) {
            return direct;
        }
        const norm = normalizePath(idOrPath);
        const indexedId = this.pathIndex.get(norm);
        return indexedId ? this.nodes.get(indexedId) : undefined;
    }

    /**
     * Returns all registered architecture nodes.
     */
    public getAllNodes(): SemanticArchitectureNode[] {
        return Array.from(this.nodes.values());
    }

    /**
     * Adds an architectural dependency edge.
     */
    public addEdge(edge: SemanticArchitectureEdge): this {
        if (!this.edgeIndex.has(edge.id)) {
            this.edgeIndex.add(edge.id);
            this.edges.push(edge);
        }
        return this;
    }

    /**
     * Returns all registered edges.
     */
    public getAllEdges(): SemanticArchitectureEdge[] {
        return [...this.edges];
    }

    /**
     * Identifies all architectural edges that violate unidirectional layering.
     */
    public findLayerInversions(
        allowedMatrix: Record<
            SystemTopologyRole,
            ReadonlySet<SystemTopologyRole>
        > = DEFAULT_ALLOWED_DEPENDENCIES,
    ): SemanticArchitectureEdge[] {
        const inversions: SemanticArchitectureEdge[] = [];
        for (const edge of this.edges) {
            const from = this.nodes.get(edge.fromNodeId);
            const to = this.nodes.get(edge.toNodeId);
            if (!from || !to || from.role === to.role) {
                continue;
            }

            const allowed = allowedMatrix[from.role];
            if (allowed && !allowed.has(to.role)) {
                edge.isLayerInversion = true;
                inversions.push(edge);
            }
        }
        return inversions;
    }

    /**
     * Identifies cross-domain private internal bypasses.
     */
    public findPrivateBypasses(): SemanticArchitectureEdge[] {
        return this.edges.filter((edge) => edge.isPrivateBypass);
    }

    /**
     * Finds nodes in headless domain core that violate headless purity.
     */
    public findHeadlessViolations(): {
        node: SemanticArchitectureNode;
        forbiddenImport: string;
    }[] {
        const violations: { node: SemanticArchitectureNode; forbiddenImport: string }[] = [];
        for (const node of this.nodes.values()) {
            if (node.role !== 'headless_domain_core' && !node.isHeadless) {
                continue;
            }
            for (const imp of node.imports) {
                if (FORBIDDEN_HEADLESS_IMPORTS.has(imp)) {
                    violations.push({ node, forbiddenImport: imp });
                }
            }
        }
        return violations;
    }

    /**
     * Computes topology distribution across system roles.
     */
    public computeDistribution(): Record<SystemTopologyRole, number> {
        const dist: Record<SystemTopologyRole, number> = {
            headless_domain_core: 0,
            data_layer: 0,
            infrastructure: 0,
            adapter: 0,
            application_cli: 0,
            shared: 0,
            configuration: 0,
            tool_script: 0,
            test_suite: 0,
        };
        for (const node of this.nodes.values()) {
            dist[node.role] = (dist[node.role] || 0) + 1;
        }
        return dist;
    }

    /**
     * Builds a SemanticArchitectureGraph from a unified SemanticGraph.
     */
    public static fromSemanticGraph(
        graph: SemanticGraph,
        options: ArchitectureAuditOptions = {},
    ): SemanticArchitectureGraph {
        const archGraph = new SemanticArchitectureGraph();
        const fileMap = collectFileMap(graph);
        populateArchitectureNodes(archGraph, fileMap, options);
        connectArchitectureEdges(archGraph, fileMap);
        return archGraph;
    }

    /**
     * Builds a SemanticArchitectureGraph from source file descriptions.
     */
    public static fromFiles(
        files: SourceArchitectureFile[],
        options: ArchitectureAuditOptions = {},
    ): SemanticArchitectureGraph {
        const archGraph = new SemanticArchitectureGraph();

        // 1. Create nodes
        for (const file of files) {
            const filePath = normalizePath(file.filePath);
            const inference = inferSystemTopologyRole(
                filePath,
                file.imports,
                file.exports || [],
                file.content,
                options,
            );
            const domainName = extractDomainName(filePath);

            archGraph.addNode({
                id: filePath,
                filePath,
                role: inference.role,
                isHeadless: inference.isHeadless,
                domainName,
                inferredReasons: inference.reasons,
                imports: file.imports,
                exports: file.exports || [],
                hasDirectConfigAccess: file.hasDirectConfigAccess ?? false,
                hasGlobalMutableState: file.hasGlobalMutableState ?? false,
            });
        }

        // 2. Create edges
        for (const file of files) {
            const fromPath = normalizePath(file.filePath);
            const fromNode = archGraph.getNode(fromPath);
            if (!fromNode) {
                continue;
            }

            for (const imp of file.imports) {
                const isPrivate = isPrivateInternalPath(imp);
                const toNode = archGraph.getNode(imp);

                if (toNode) {
                    const isCrossDomain = fromNode.domainName !== toNode.domainName;
                    archGraph.addEdge({
                        id: `${fromNode.id}->${toNode.id}`,
                        fromNodeId: fromNode.id,
                        toNodeId: toNode.id,
                        edgeKind: 'imports',
                        isCrossDomain,
                        isLayerInversion: false,
                        isPrivateBypass: isCrossDomain && isPrivate,
                    });
                }
            }
        }

        return archGraph;
    }
}

interface FileEntry {
    imports: Set<string>;
    exports: Set<string>;
}

function getOrCreateFileEntry(fileMap: Map<string, FileEntry>, file: string): FileEntry {
    let entry = fileMap.get(file);
    if (!entry) {
        entry = { imports: new Set(), exports: new Set() };
        fileMap.set(file, entry);
    }
    return entry;
}

function parseExternalPackage(edgeToNodeId: string): string | null {
    const colonIdx = edgeToNodeId.indexOf(':');
    const hashIdx = edgeToNodeId.indexOf('#');
    if (colonIdx === -1) return null;
    const start = colonIdx + 1;
    const end = hashIdx !== -1 ? hashIdx : edgeToNodeId.length;
    const pkg = edgeToNodeId.slice(start, end);
    return pkg || null;
}

function collectFileMap(graph: SemanticGraph): Map<string, FileEntry> {
    const fileMap = new Map<string, FileEntry>();

    for (const node of graph.getAllNodes()) {
        const f = normalizePath(node.location.file);
        const info = getOrCreateFileEntry(fileMap, f);
        info.exports.add(node.name);
    }

    for (const edge of graph.getAllEdges()) {
        const fromNode = graph.getNode(edge.fromNodeId);
        if (!fromNode) continue;

        const fromFile = normalizePath(fromNode.location.file);
        const entry = fileMap.get(fromFile);
        if (!entry) continue;

        const toNode = graph.getNode(edge.toNodeId);
        if (toNode && fromNode.location.file !== toNode.location.file) {
            const toFile = normalizePath(toNode.location.file);
            entry.imports.add(toFile);
        } else if (!toNode && edge.kind === 'depends_on') {
            const pkg = parseExternalPackage(edge.toNodeId);
            if (pkg) entry.imports.add(pkg);
        }
    }

    return fileMap;
}

function populateArchitectureNodes(
    archGraph: SemanticArchitectureGraph,
    fileMap: Map<string, FileEntry>,
    options: ArchitectureAuditOptions,
): void {
    for (const [filePath, { imports, exports }] of fileMap.entries()) {
        const importList = Array.from(imports);
        const exportList = Array.from(exports);
        const inference = inferSystemTopologyRole(filePath, importList, exportList, '', options);
        const domainName = extractDomainName(filePath);

        archGraph.addNode({
            id: filePath,
            filePath,
            role: inference.role,
            isHeadless: inference.isHeadless,
            domainName,
            inferredReasons: inference.reasons,
            imports: importList,
            exports: exportList,
            hasDirectConfigAccess: false,
            hasGlobalMutableState: false,
        });
    }
}

function connectArchitectureEdges(
    archGraph: SemanticArchitectureGraph,
    fileMap: Map<string, FileEntry>,
): void {
    for (const [filePath, { imports }] of fileMap.entries()) {
        const fromNode = archGraph.getNode(filePath);
        if (!fromNode) continue;

        for (const imp of imports) {
            const toNode = archGraph.getNode(imp);
            if (!toNode) continue;

            const isCrossDomain = fromNode.domainName !== toNode.domainName;
            const isPrivate = isPrivateInternalPath(imp);
            const edgeId = `${fromNode.id}->${toNode.id}`;

            archGraph.addEdge({
                id: edgeId,
                fromNodeId: fromNode.id,
                toNodeId: toNode.id,
                edgeKind: 'depends_on',
                isCrossDomain,
                isLayerInversion: false,
                isPrivateBypass: isCrossDomain && isPrivate,
            });
        }
    }
}
