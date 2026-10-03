/**
 * Module: Core Preflight — Progressive Blast-Radius Expansion Tracer
 * File Path: src/core/preflight/expansion-tracer.ts
 * Architecture Role: Discovers minimal sufficient affected scope via progressive 1st-
 *   and 2nd-order neighborhood exploration, guarded by risk-confidence expansion
 *   criteria Expand = Risk * Conf * BlastRadius > θ.
 * Dependencies & Triggers: Consumes audit-index; called by preflight controller
 *   during CHANGESET mode.
 * Responsibilities:
 *   1. Establish 0-order seed set from directly modified files.
 *   2. Identify 1st-order callers and consumers via preflight dependency index.
 *   3. Evaluate risk-confidence expansion formula to decide whether 2nd-order
 *      expansion is justified.
 *   4. Apply early stopping criterion to prevent unrestricted whole-graph unfolding.
 * Exit Semantics & Design Rationale: Bounded iterative search; never loops; deterministic output.
 */

import type { PreflightAuditIndexStore } from './audit-index';

/** Options configuring progressive expansion */
export interface ExpansionTracerOptions {
    /** Expansion criterion threshold (default 0.50) */
    readonly expansionThreshold?: number;
    /** Maximum cumulative files allowed across all expansion orders (default 30) */
    readonly maxExpansionLimit?: number;
    /** Base confidence factor for changed symbols (default 0.90) */
    readonly defaultConfidence?: number;
}

/** Complete structured result of progressive expansion */
export interface ExpansionTraceResult {
    readonly seedFiles: readonly string[];
    readonly firstOrderNeighbors: readonly string[];
    readonly secondOrderNeighbors: readonly string[];
    readonly allAuditedFiles: readonly string[];
    readonly stoppedReason: string;
    readonly totalAuditedCount: number;
    readonly expansionRatio: number;
}

/** Default expansion options */
const DEFAULT_EXPANSION_THRESHOLD = 0.5;
const DEFAULT_MAX_EXPANSION_LIMIT = 30;
const DEFAULT_CONFIDENCE = 0.9;

/** Normalizes a file path for key comparison */
function normPath(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase();
}

/** Finds 1st-order direct upstream callers who import the target file */
function findDirectCallers(targetFile: string, indexStore: PreflightAuditIndexStore): string[] {
    const callers: string[] = [];
    const targetNorm = normPath(targetFile);
    const targetBase = targetNorm.split('/').pop()?.split('.')[0] || '';

    for (const entry of indexStore.getAllEntries()) {
        if (normPath(entry.filePath) === targetNorm) continue;

        for (const imp of entry.deps.imports) {
            const impNorm = normPath(imp);
            if (impNorm.includes(targetBase) || impNorm.endsWith(targetBase)) {
                callers.push(entry.filePath);
                break;
            }
        }
    }
    return callers;
}

/** Expands 1st-order neighborhood callers */
function expandFirstOrder(
    seedFiles: readonly string[],
    indexStore: PreflightAuditIndexStore,
    auditedSet: Set<string>,
    firstOrderSet: Set<string>,
    maxLimit: number,
): string | null {
    for (const seed of seedFiles) {
        if (auditedSet.size >= maxLimit) {
            return `Expansion limit reached (${maxLimit} files) during 1st-order tracing`;
        }

        const callers = findDirectCallers(seed, indexStore);
        for (const caller of callers) {
            if (!auditedSet.has(caller)) {
                firstOrderSet.add(caller);
                auditedSet.add(caller);
                if (auditedSet.size >= maxLimit) {
                    return `Expansion limit reached (${maxLimit} files) during 1st-order tracing`;
                }
            }
        }
    }
    return null;
}

/** Evaluates whether neighbor qualifies for 2nd-order expansion */
function shouldExpandNeighbor(
    neighbor: string,
    indexStore: PreflightAuditIndexStore,
    threshold: number,
    confidence: number,
): boolean {
    const entry = indexStore.get(neighbor);
    if (!entry) return false;
    const isHighValue = entry.role === 'core_trunk' || entry.risk.isHighFanIn;
    if (!isHighValue) return false;

    const risk = entry.risk.inherentRisk;
    const blastRadiusFactor = Math.min(1.0, entry.deps.fanIn / 8);
    const expandScore = risk * confidence * (0.5 + 0.5 * blastRadiusFactor);
    return expandScore > threshold;
}

/** Expands conditional 2nd-order neighborhood callers */
function expandSecondOrder(
    firstOrderSet: Set<string>,
    indexStore: PreflightAuditIndexStore,
    auditedSet: Set<string>,
    secondOrderSet: Set<string>,
    maxLimit: number,
    threshold: number,
    confidence: number,
): string | null {
    for (const neighbor of Array.from(firstOrderSet)) {
        if (auditedSet.size >= maxLimit) {
            return `Expansion limit reached (${maxLimit} files) during 2nd-order tracing`;
        }

        if (!shouldExpandNeighbor(neighbor, indexStore, threshold, confidence)) {
            continue;
        }

        const secondCallers = findDirectCallers(neighbor, indexStore);
        for (const sc of secondCallers) {
            if (!auditedSet.has(sc)) {
                secondOrderSet.add(sc);
                auditedSet.add(sc);
                if (auditedSet.size >= maxLimit) {
                    return `Expansion limit reached (${maxLimit} files) during 2nd-order tracing`;
                }
            }
        }
    }
    return null;
}

/** Helper to construct immutable trace result */
function buildTraceResult(
    seedFiles: readonly string[],
    firstOrderSet: Set<string>,
    secondOrderSet: Set<string>,
    auditedSet: Set<string>,
    stoppedReason: string,
): ExpansionTraceResult {
    const allAudited = Array.from(auditedSet);
    const ratio =
        seedFiles.length > 0 ? Math.round((allAudited.length / seedFiles.length) * 100) / 100 : 1.0;

    return Object.freeze({
        seedFiles: Object.freeze([...seedFiles]),
        firstOrderNeighbors: Object.freeze(Array.from(firstOrderSet)),
        secondOrderNeighbors: Object.freeze(Array.from(secondOrderSet)),
        allAuditedFiles: Object.freeze(allAudited),
        stoppedReason,
        totalAuditedCount: allAudited.length,
        expansionRatio: ratio,
    });
}

/**
 * Traces progressive blast-radius expansion from seed files.
 *
 * @param seedFiles - Set of directly modified files.
 * @param indexStore - Preflight audit index store.
 * @param options - Expansion constraints.
 * @returns Frozen ExpansionTraceResult.
 */
export function traceProgressiveExpansion(
    seedFiles: readonly string[],
    indexStore: PreflightAuditIndexStore,
    options: ExpansionTracerOptions = {},
): ExpansionTraceResult {
    const threshold = options.expansionThreshold ?? DEFAULT_EXPANSION_THRESHOLD;
    const maxLimit = options.maxExpansionLimit ?? DEFAULT_MAX_EXPANSION_LIMIT;
    const confidence = options.defaultConfidence ?? DEFAULT_CONFIDENCE;

    const auditedSet = new Set<string>(seedFiles);
    const firstOrderSet = new Set<string>();
    const secondOrderSet = new Set<string>();

    const firstReason = expandFirstOrder(
        seedFiles,
        indexStore,
        auditedSet,
        firstOrderSet,
        maxLimit,
    );
    if (firstReason) {
        return buildTraceResult(seedFiles, firstOrderSet, secondOrderSet, auditedSet, firstReason);
    }

    const secondReason = expandSecondOrder(
        firstOrderSet,
        indexStore,
        auditedSet,
        secondOrderSet,
        maxLimit,
        threshold,
        confidence,
    );

    const stoppedReason =
        secondReason ||
        (secondOrderSet.size > 0
            ? 'Sufficient 2nd-order neighborhood evidence collected; expansion halted safely'
            : 'Expansion completed within 1st-order neighborhood');

    return buildTraceResult(seedFiles, firstOrderSet, secondOrderSet, auditedSet, stoppedReason);
}
