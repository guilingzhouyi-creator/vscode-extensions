/**
 * Module: Core Engine — Multi-Agent Architecture Collision Detector
 * File Path: src/core/trajectory/agentCollisionDetector.ts
 * Architecture Role: Detects concurrent architectural boundary breaches, cross-agent
 *   dependency cycles, and contract breakages when multiple agents modify code in parallel.
 * Dependencies & Triggers: Consumes AgentCollision, AgentPatchSlice from ./types and Issue,
 *   Severity from ../types.
 * Responsibilities: Build composite dependency topology from concurrent agent patches, detect
 *   multi-agent circular dependencies, identify clean-layer inversion, and emit formal
 *   GOV-AGENT-COLLISION issues.
 * Exit Semantics & Design Rationale: Pure in-memory analysis; deterministic and safe against
 *   malformed inputs; returns empty collision array when no conflicts are present.
 */

import type { Issue } from '../types';
import type { AgentCollision, AgentPatchSlice } from './types';
import { inferSystemTopologyRole } from '../architecture/roleInference';
import type { SystemTopologyRole } from '../architecture/types';
import { DEFAULT_ALLOWED_DEPENDENCIES } from '../architecture/types';

interface DependencyEdge {
    from: string;
    to: string;
    agentUid: string;
    patchId: string;
}

/**
 * Normalizes file path to POSIX style.
 */
function normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * Builds a directed edge map from patch dependency additions.
 */
function buildCompositeEdges(patches: AgentPatchSlice[]): DependencyEdge[] {
    const edges: DependencyEdge[] = [];
    for (const patch of patches) {
        const from = normalizePath(patch.filePath);
        const deps = patch.dependenciesAdded || [];
        for (const dep of deps) {
            edges.push({
                from,
                to: normalizePath(dep),
                agentUid: patch.agentUid,
                patchId: patch.patchId,
            });
        }
    }
    return edges;
}

/**
 * Detects cycles in a directed graph using DFS and collects contributing agents.
 */
function findCycleInGraph(
    node: string,
    adj: Map<string, DependencyEdge[]>,
    visited: Set<string>,
    stack: string[],
    edgeStack: DependencyEdge[],
): { cycle: string[]; edges: DependencyEdge[] } | null {
    visited.add(node);
    stack.push(node);

    const neighbors = adj.get(node) || [];
    for (const edge of neighbors) {
        edgeStack.push(edge);
        if (!visited.has(edge.to)) {
            const res = findCycleInGraph(edge.to, adj, visited, stack, edgeStack);
            if (res) return res;
        } else {
            const cycleIndex = stack.indexOf(edge.to);
            if (cycleIndex !== -1) {
                const cycle = stack.slice(cycleIndex);
                cycle.push(edge.to);
                const relevantEdges = edgeStack.slice(cycleIndex);
                return { cycle, edges: relevantEdges };
            }
        }
        edgeStack.pop();
    }

    stack.pop();
    return null;
}

/**
 * Creates a formal Issue for an architectural collision.
 */
function createCollisionIssue(
    collisionId: string,
    file: string,
    message: string,
    details: Record<string, unknown>,
): Issue {
    return {
        id: `governance:GOV-AGN-001:${collisionId}`,
        analyzer: 'governance',
        rule: 'GOV-AGN-001',
        severity: 'error',
        message,
        location: {
            file,
            start: { line: 1, column: 1 },
            end: { line: 1, column: 1 },
        },
        detail: details,
    };
}

type CycleResult = { cycle: string[]; edges: DependencyEdge[] };

/**
 * Extracts unique non-base agent IDs contributing to a cycle.
 */
function extractUniqueAgentsFromCycle(edges: DependencyEdge[]): string[] {
    const agentUids = new Set<string>();
    for (const e of edges) {
        if (e.agentUid !== '__base__') {
            agentUids.add(e.agentUid);
        }
    }
    return Array.from(agentUids);
}

/**
 * Constructs a cross-agent circular dependency collision record if multiple agents participate.
 */
function buildCycleCollision(result: CycleResult): AgentCollision | null {
    const agentUids = extractUniqueAgentsFromCycle(result.edges);
    if (agentUids.length < 2) {
        return null;
    }
    const pathDesc = result.cycle.join(' -> ');
    const collisionId = `cycle-${Date.now()}`;
    const message =
        `Concurrent cross-agent circular dependency detected across ` +
        `agents [${agentUids.join(', ')}]: ${pathDesc}`;
    const issue = createCollisionIssue(collisionId, result.cycle[0], message, {
        cycle: result.cycle,
        agents: agentUids,
    });
    return {
        collisionId,
        kind: 'circular_dependency',
        agents: agentUids,
        files: result.cycle,
        description: message,
        issue,
        details: { cycle: result.cycle },
    };
}

/**
 * Validates a single dependency addition for layer boundary inversions.
 */
function checkDependencyLayerInversion(
    patch: AgentPatchSlice,
    fromRole: SystemTopologyRole,
    dep: string,
): AgentCollision | null {
    const toRole = inferSystemTopologyRole(dep, []).role;
    if (fromRole === toRole) {
        return null;
    }
    const allowed = DEFAULT_ALLOWED_DEPENDENCIES[fromRole];
    if (!allowed || allowed.has(toRole)) {
        return null;
    }
    const collisionId = `layer-${patch.agentUid}-${Date.now()}`;
    const msg =
        `Architecture layer inversion by agent '${patch.agentUid}': ` +
        `'${fromRole}' module '${patch.filePath}' depends on ` +
        `outer '${toRole}' module '${dep}'`;
    const issue = createCollisionIssue(collisionId, patch.filePath, msg, {
        fromRole,
        toRole,
        dep,
    });
    return {
        collisionId,
        kind: 'layer_inversion',
        agents: [patch.agentUid],
        files: [patch.filePath, dep],
        description: msg,
        issue,
    };
}

/**
 * Validates whether an imported symbol has been concurrently removed or modified by another agent.
 */
function checkImportContractBreakage(
    p: AgentPatchSlice,
    sym: string,
    exportedMap: Map<string, { agentUid: string; file: string }>,
): AgentCollision | null {
    const exp = exportedMap.get(sym);
    if (!exp || exp.agentUid === p.agentUid) {
        return null;
    }
    if (p.deletedLines <= 0 || (p.newContent || '').indexOf(sym) !== -1) {
        return null;
    }
    const collisionId = `contract-${Date.now()}`;
    const msg =
        `Contract breakage between '${exp.agentUid}' and '${p.agentUid}': ` +
        `symbol '${sym}' is modified/removed while concurrently referenced`;
    const issue = createCollisionIssue(collisionId, p.filePath, msg, { sym });
    return {
        collisionId,
        kind: 'contract_breakage',
        agents: [exp.agentUid, p.agentUid],
        files: [exp.file, p.filePath],
        description: msg,
        issue,
    };
}

/**
 * Detects architectural collisions and dependency conflicts across concurrent agent patches.
 */
export class AgentCollisionDetector {
    /**
     * Inspects a collection of concurrent patches for architectural collisions.
     */
    public detectCollisions(
        patches: AgentPatchSlice[],
        baseEdges: Array<{ from: string; to: string }> = [],
    ): AgentCollision[] {
        const collisions: AgentCollision[] = [];
        const patchEdges = buildCompositeEdges(patches);

        const cycleCollision = this.detectCrossAgentCycles(patchEdges, baseEdges);
        if (cycleCollision) {
            collisions.push(cycleCollision);
        }

        const layerCollisions = this.detectLayerInversions(patches);
        collisions.push(...layerCollisions);

        const contractCollisions = this.detectContractBreakages(patches);
        collisions.push(...contractCollisions);

        return collisions;
    }

    /**
     * Detects cycles formed by combining dependency additions from distinct agents.
     */
    private detectCrossAgentCycles(
        patchEdges: DependencyEdge[],
        baseEdges: Array<{ from: string; to: string }>,
    ): AgentCollision | null {
        const adj = new Map<string, DependencyEdge[]>();

        for (const e of baseEdges) {
            const fromPath = normalizePath(e.from);
            const list = adj.get(fromPath) || [];
            list.push({
                from: fromPath,
                to: normalizePath(e.to),
                agentUid: '__base__',
                patchId: '__base__',
            });
            adj.set(fromPath, list);
        }

        for (const e of patchEdges) {
            const list = adj.get(e.from) || [];
            list.push(e);
            adj.set(e.from, list);
        }

        const visited = new Set<string>();
        for (const node of adj.keys()) {
            if (visited.has(node)) {
                continue;
            }
            const result = findCycleInGraph(node, adj, visited, [], []);
            if (!result) {
                continue;
            }
            const collision = buildCycleCollision(result);
            if (collision) {
                return collision;
            }
        }
        return null;
    }

    /**
     * Detects clean layer inversion introduced across concurrent agent changes.
     */
    private detectLayerInversions(patches: AgentPatchSlice[]): AgentCollision[] {
        const collisions: AgentCollision[] = [];
        for (const patch of patches) {
            const fromRole = inferSystemTopologyRole(patch.filePath, []).role;
            const deps = patch.dependenciesAdded || [];
            for (const dep of deps) {
                const collision = checkDependencyLayerInversion(patch, fromRole, dep);
                if (collision) {
                    collisions.push(collision);
                }
            }
        }
        return collisions;
    }

    /**
     * Detects concurrent contract breakages (e.g. deleted symbol still imported).
     */
    private detectContractBreakages(patches: AgentPatchSlice[]): AgentCollision[] {
        const collisions: AgentCollision[] = [];
        const exportedMap = new Map<string, { agentUid: string; file: string }>();

        for (const p of patches) {
            for (const sym of p.exportedSymbols || []) {
                exportedMap.set(sym, { agentUid: p.agentUid, file: p.filePath });
            }
        }

        for (const p of patches) {
            for (const sym of p.importedSymbols || []) {
                const collision = checkImportContractBreakage(p, sym, exportedMap);
                if (collision) {
                    collisions.push(collision);
                }
            }
        }

        return collisions;
    }
}

/** Default singleton instance of AgentCollisionDetector */
export const defaultAgentCollisionDetector = new AgentCollisionDetector();
