/**
 * Module: Core Engine — Multi-Agent Duplicate Work Auditor
 * File Path: src/core/trajectory/duplicateWorkAuditor.ts
 * Architecture Role: Computes blast radius overlap matrices across parallel agent changes,
 *   identifying redundant code modifications and coordination inefficiencies.
 * Dependencies & Triggers: Consumes DuplicateWorkMetric, AgentPatchSlice from ./types.
 * Responsibilities: Calculate Jaccard similarity index across touched files and symbol scopes,
 *   detect wasteful churn, and provide structured coordination recommendations.
 * Exit Semantics & Design Rationale: Deterministic in-memory set intersections; scales linearly
 *   with agent and file counts without heap pressure.
 */

import type { AgentPatchSlice, DuplicateWorkMetric } from './types';
import { computeJaccardSimilarity, computeSetIntersection } from '../algorithms/set-algebra';

/** Threshold ratio above which modifications are classified as duplicate work */
const DUPLICATE_WORK_THRESHOLD = 0.5;

interface AgentBlastRadius {
    files: Set<string>;
    symbols: Set<string>;
}

/**
 * Normalizes file path to POSIX style.
 */
function normalizePath(patchPath: string): string {
    return patchPath.replace(/\\/g, '/');
}

function getOrCreateAgentBlastRadius(
    map: Map<string, AgentBlastRadius>,
    agentUid: string,
): AgentBlastRadius {
    let radius = map.get(agentUid);
    if (!radius) {
        radius = { files: new Set(), symbols: new Set() };
        map.set(agentUid, radius);
    }
    return radius;
}

/**
 * Collects blast radius for all agents from their patch slices.
 */
function collectAgentBlastRadii(patches: AgentPatchSlice[]): Map<string, AgentBlastRadius> {
    const map = new Map<string, AgentBlastRadius>();

    for (const patch of patches) {
        const radius = getOrCreateAgentBlastRadius(map, patch.agentUid);
        radius.files.add(normalizePath(patch.filePath));
        if (patch.importedSymbols) {
            for (const sym of patch.importedSymbols) {
                radius.symbols.add(sym);
            }
        }
        if (patch.exportedSymbols) {
            for (const sym of patch.exportedSymbols) {
                radius.symbols.add(sym);
            }
        }
    }

    return map;
}

/**
 * Computes Jaccard index between two sets of strings.
 */
function computeJaccardIndex(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 && setB.size === 0) return 0;
    return Math.round(computeJaccardSimilarity(setA, setB) * 100) / 100;
}

/**
 * Intersects two sets of strings and returns sorted array.
 */
function intersectSets(setA: Set<string>, setB: Set<string>): string[] {
    return Array.from(computeSetIntersection(setA, setB)).sort();
}

/**
 * Audits duplicate work and blast radius overlap across concurrent agents.
 */
export class DuplicateWorkAuditor {
    /**
     * Calculates pairwise blast radius overlap metrics for all agents.
     */
    public auditDuplicateWork(
        patches: AgentPatchSlice[],
        threshold: number = DUPLICATE_WORK_THRESHOLD,
    ): DuplicateWorkMetric[] {
        const radii = collectAgentBlastRadii(patches);
        const agents = Array.from(radii.keys()).sort();
        const metrics: DuplicateWorkMetric[] = [];

        for (let i = 0; i < agents.length; i++) {
            for (let j = i + 1; j < agents.length; j++) {
                const agentA = agents[i];
                const agentB = agents[j];
                const recordA = radii.get(agentA)!;
                const recordB = radii.get(agentB)!;

                const fileOverlap = computeJaccardIndex(recordA.files, recordB.files);
                const symOverlap = computeJaccardIndex(recordA.symbols, recordB.symbols);
                const combinedOverlap = Math.max(fileOverlap, symOverlap);

                if (combinedOverlap >= threshold) {
                    metrics.push({
                        agentA,
                        agentB,
                        overlapRatio: combinedOverlap,
                        commonFiles: intersectSets(recordA.files, recordB.files),
                        commonSymbols: intersectSets(recordA.symbols, recordB.symbols),
                    });
                }
            }
        }

        return metrics;
    }
}

/** Default singleton instance of DuplicateWorkAuditor */
export const defaultDuplicateWorkAuditor = new DuplicateWorkAuditor();
