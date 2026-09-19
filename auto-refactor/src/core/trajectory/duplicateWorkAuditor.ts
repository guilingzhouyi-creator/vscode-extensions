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

/** Threshold ratio above which modifications are classified as duplicate work */
const DUPLICATE_WORK_THRESHOLD = 0.5;

interface AgentBlastRadius {
    files: Set<string>;
    symbols: Set<string>;
}

/**
 * Normalizes file path to POSIX style.
 */
function normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * Collects blast radius for all agents from their patch slices.
 */
function collectAgentBlastRadii(patches: AgentPatchSlice[]): Map<string, AgentBlastRadius> {
    const map = new Map<string, AgentBlastRadius>();

    for (const patch of patches) {
        let radius = map.get(patch.agentUid);
        if (!radius) {
            radius = { files: new Set(), symbols: new Set() };
            map.set(patch.agentUid, radius);
        }
        radius.files.add(normalizePath(patch.filePath));
        for (const sym of patch.importedSymbols || []) {
            radius.symbols.add(sym);
        }
        for (const sym of patch.exportedSymbols || []) {
            radius.symbols.add(sym);
        }
    }

    return map;
}

/**
 * Computes Jaccard index between two sets of strings.
 */
function computeJaccardIndex(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 && setB.size === 0) return 0;
    let intersection = 0;
    for (const item of setA) {
        if (setB.has(item)) {
            intersection++;
        }
    }
    const union = setA.size + setB.size - intersection;
    if (union === 0) return 0;
    return Math.round((intersection / union) * 100) / 100;
}

/**
 * Intersects two sets of strings and returns sorted array.
 */
function intersectSets(setA: Set<string>, setB: Set<string>): string[] {
    const common: string[] = [];
    for (const item of setA) {
        if (setB.has(item)) {
            common.push(item);
        }
    }
    return common.sort();
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
                const rA = radii.get(agentA)!;
                const rB = radii.get(agentB)!;

                const fileOverlap = computeJaccardIndex(rA.files, rB.files);
                const symOverlap = computeJaccardIndex(rA.symbols, rB.symbols);
                const combinedOverlap = Math.max(fileOverlap, symOverlap);

                if (combinedOverlap >= threshold) {
                    metrics.push({
                        agentA,
                        agentB,
                        overlapRatio: combinedOverlap,
                        commonFiles: intersectSets(rA.files, rB.files),
                        commonSymbols: intersectSets(rA.symbols, rB.symbols),
                    });
                }
            }
        }

        return metrics;
    }
}

/** Default singleton instance of DuplicateWorkAuditor */
export const defaultDuplicateWorkAuditor = new DuplicateWorkAuditor();
