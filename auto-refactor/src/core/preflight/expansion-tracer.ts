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

/** Extracts normalized base name without directory and extension */
function extractBaseName(p: string): string {
    const norm = normPath(p);
    return norm.split('/').pop()?.split('.')[0] || '';
}

/**
 * Builds an inverted index mapping imported base-name to calling files.
 * Precomputes reverse dependencies in single O(N*M) pass; queries are O(1).
 */
function buildReverseDependencyIndex(indexStore: PreflightAuditIndexStore): Map<string, string[]> {
    const reverseIndex = new Map<string, string[]>();
    const seenBases = new Set<string>();

    for (const entry of indexStore.getAllEntries()) {
        const caller = entry.filePath;
        seenBases.clear();

        for (const imp of entry.deps.imports) {
            const base = extractBaseName(imp);
            if (!base || seenBases.has(base)) {
                continue;
            }
            seenBases.add(base);

            const callers = reverseIndex.get(base);
            if (callers) {
                callers.push(caller);
            } else {
                reverseIndex.set(base, [caller]);
            }
        }
    }

    return reverseIndex;
}

/** Finds 1st-order direct upstream callers who import the target file */
function findDirectCallers(
    targetFile: string,
    reverseIndexOrStore: ReadonlyMap<string, readonly string[]> | PreflightAuditIndexStore,
): string[] {
    const reverseIndex =
        'getAllEntries' in reverseIndexOrStore
            ? buildReverseDependencyIndex(reverseIndexOrStore)
            : reverseIndexOrStore;

    const targetNorm = normPath(targetFile);
    const targetBase = extractBaseName(targetFile);
    if (!targetBase) {
        return [];
    }

    const callers = reverseIndex.get(targetBase);
    if (!callers || callers.length === 0) {
        return [];
    }

    return callers.filter((caller) => normPath(caller) !== targetNorm);
}

/**
 * Ingests direct callers into the target collection and global audited set.
 * Returns true if the cumulative audited count hits or exceeds maxLimit.
 */
function ingestCallers(
    callers: readonly string[],
    targetSet: Set<string>,
    auditedSet: Set<string>,
    maxLimit: number,
): boolean {
    for (const caller of callers) {
        if (auditedSet.has(caller)) {
            continue;
        }
        targetSet.add(caller);
        auditedSet.add(caller);
        if (auditedSet.size >= maxLimit) {
            return true;
        }
    }
    return false;
}

/** Expands 1st-order neighborhood callers */
function expandFirstOrder(
    seedFiles: readonly string[],
    reverseIndex: ReadonlyMap<string, readonly string[]>,
    auditedSet: Set<string>,
    firstOrderSet: Set<string>,
    maxLimit: number,
): string | null {
    for (const seed of seedFiles) {
        if (auditedSet.size >= maxLimit) {
            return `Expansion limit reached (${maxLimit} files) during 1st-order tracing`;
        }

        const callers = findDirectCallers(seed, reverseIndex);
        const limitReached = ingestCallers(callers, firstOrderSet, auditedSet, maxLimit);
        if (limitReached) {
            return `Expansion limit reached (${maxLimit} files) during 1st-order tracing`;
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
    reverseIndex: ReadonlyMap<string, readonly string[]>,
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

        const secondCallers = findDirectCallers(neighbor, reverseIndex);
        const limitReached = ingestCallers(secondCallers, secondOrderSet, auditedSet, maxLimit);
        if (limitReached) {
            return `Expansion limit reached (${maxLimit} files) during 2nd-order tracing`;
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

    const reverseIndex = buildReverseDependencyIndex(indexStore);
    const auditedSet = new Set<string>(seedFiles);
    const firstOrderSet = new Set<string>();
    const secondOrderSet = new Set<string>();

    const firstReason = expandFirstOrder(
        seedFiles,
        reverseIndex,
        auditedSet,
        firstOrderSet,
        maxLimit,
    );
    if (firstReason) {
        return buildTraceResult(seedFiles, firstOrderSet, secondOrderSet, auditedSet, firstReason);
    }

    const secondReason = expandSecondOrder(
        firstOrderSet,
        reverseIndex,
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
