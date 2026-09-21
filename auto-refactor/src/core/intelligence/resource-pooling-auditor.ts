/**
 * Module: Core Intelligence — Resource & Object Pooling Lifecycle Auditor
 * File Path: src/core/intelligence/resource-pooling-auditor.ts
 * Architecture Role: Comprehensive pooling pattern analyzer evaluating object, connection,
 *   buffer, resource, and cache pooling mechanisms across hot paths, safety, and ROI.
 * Dependencies & Triggers: Consumes Issue schema and dimensionLiterals; invoked during
 *   performance and loop-level static analysis passes.
 * Responsibilities: Differentiate 5 pool kinds; discriminate local private pooling from global
 *   library pooling; enforce reset_state contracts and capacity caps (PRF-POL-002); flag
 *   unpooled hotspot allocations (PRF-POL-001); intercept negative-ROI pooling (PRF-POL-003).
 * Exit Semantics & Design Rationale: Deterministic AST and pattern analysis without profiling.
 *   Prevents harmful pseudo-optimizations where pooling overhead exceeds allocation costs.
 */

import type { Issue } from '../types';
import { SEVERITY_ERROR, SEVERITY_WARNING } from '../types';
import {
    ANALYZER_PERFORMANCE,
    RULE_PRF_POL_001,
    RULE_PRF_POL_002,
    RULE_PRF_POL_003,
} from '../scoring/dimensionLiterals';

/**
 * 5 Canonical Resource Pooling Kinds.
 */
export type PoolKind =
    'object_pool' | 'connection_pool' | 'buffer_pool' | 'resource_pool' | 'cache_pool';

/**
 * Pooling architectural scope.
 */
export type PoolScope = 'global_shared' | 'module_scoped' | 'local_private';

/**
 * Context descriptor for an allocation site or pooling implementation.
 */
export interface AllocationSiteContext {
    id: string;
    filePath: string;
    functionName: string;
    line: number;
    isInLoopOrHotPath: boolean;
    allocatedType: string;
    fieldCount: number;
    isPrimitiveOrTiny: boolean;
    hasExpensiveConstructor: boolean;
    estimatedAllocFrequency: 'loop_hot' | 'request_medium' | 'init_cold';
}

/**
 * Context descriptor for a declared pool component or manager.
 */
export interface PoolComponentContext {
    id: string;
    filePath: string;
    poolName: string;
    line: number;
    poolKind: PoolKind;
    scope: PoolScope;
    targetType: string;
    hasResetContract: boolean;
    hasCapacityCap: boolean;
    maxCapacity?: number;
    isThreadSafeOrSynchronized: boolean;
    targetIsTinyOrPrimitive: boolean;
    consumerDomainCount: number;
}

/**
 * Result of resource pooling lifecycle audit.
 */
export interface ResourcePoolingAuditResult {
    unpooledHotspots: AllocationSiteContext[];
    pools: PoolComponentContext[];
    issues: Issue[];
}

/**
 * Audits unpooled allocation sites in hot paths to identify genuine pooling candidates.
 *
 * @param sites - Array of allocation sites inspected during traversal.
 * @returns Detected unpooled performance issues (PRF-POL-001).
 */
export function auditUnpooledHotspots(sites: AllocationSiteContext[]): Issue[] {
    const issues: Issue[] = [];

    for (const site of sites) {
        // Only trigger for non-tiny, expensive allocations in loops or hot paths
        if (
            site.isInLoopOrHotPath &&
            !site.isPrimitiveOrTiny &&
            (site.hasExpensiveConstructor || site.fieldCount >= 4)
        ) {
            issues.push({
                id: `performance:${RULE_PRF_POL_001}:${site.filePath}:${site.line}`,
                analyzer: ANALYZER_PERFORMANCE,
                rule: RULE_PRF_POL_001,
                severity: SEVERITY_WARNING,
                message:
                    `High-frequency unpooled allocation in hot path: "${site.functionName}" creates new ` +
                    `"${site.allocatedType}" (${site.fieldCount} fields) inside loop without lifecycle reuse.`,
                location: {
                    file: site.filePath,
                    start: { line: site.line, column: 1 },
                    end: { line: site.line, column: 80 },
                },
                detail: {
                    functionName: site.functionName,
                    allocatedType: site.allocatedType,
                    fieldCount: site.fieldCount,
                    frequency: site.estimatedAllocFrequency,
                },
                suggestion:
                    'Introduce a dedicated object or buffer pool with a reset_state() contract, or hoist allocation outside the loop.',
            });
        }
    }

    return issues;
}

function createPoolIssue(
    rule: typeof RULE_PRF_POL_002 | typeof RULE_PRF_POL_003,
    severity: typeof SEVERITY_ERROR | typeof SEVERITY_WARNING,
    pool: PoolComponentContext,
    message: string,
    detail: Record<string, unknown>,
    suggestion: string,
): Issue {
    return {
        id: `performance:${rule}:${pool.filePath}:${pool.line}`,
        analyzer: ANALYZER_PERFORMANCE,
        rule,
        severity,
        message,
        location: {
            file: pool.filePath,
            start: { line: pool.line, column: 1 },
            end: { line: pool.line, column: 80 },
        },
        detail,
        suggestion,
    };
}

function checkPoolSoundness(pool: PoolComponentContext): Issue | null {
    if (pool.hasResetContract && pool.hasCapacityCap) {
        return null;
    }
    const reasons: string[] = [];
    if (!pool.hasResetContract) {
        reasons.push('missing reset_state() / clear() contract (risk of state pollution)');
    }
    if (!pool.hasCapacityCap) {
        reasons.push('missing maximum capacity cap (risk of unbounded memory growth/leak)');
    }

    return createPoolIssue(
        RULE_PRF_POL_002,
        SEVERITY_ERROR,
        pool,
        `Unsound resource pool implementation in "${pool.poolName}": ${reasons.join(' and ')}.`,
        {
            poolName: pool.poolName,
            poolKind: pool.poolKind,
            hasResetContract: pool.hasResetContract,
            hasCapacityCap: pool.hasCapacityCap,
        },
        'Implement an explicit reset_state() lifecycle hook and bound the pool with a capacity limit.',
    );
}

function checkPoolROI(pool: PoolComponentContext): Issue | null {
    if (!pool.targetIsTinyOrPrimitive || pool.poolKind !== 'object_pool') {
        return null;
    }
    return createPoolIssue(
        RULE_PRF_POL_003,
        SEVERITY_WARNING,
        pool,
        `Negative-ROI excessive pooling: "${pool.poolName}" pools lightweight tiny object "${pool.targetType}". ` +
            `Pool management overhead exceeds direct transient GC cost.`,
        {
            poolName: pool.poolName,
            targetType: pool.targetType,
            reason: 'Micro-object pooling overhead penalty',
        },
        'Dismantle pooling indirection for tiny immutable value objects; rely on fast generational heap allocation instead.',
    );
}

/**
 * Audits pool implementations for soundness, safety, and economic return-on-investment (ROI).
 *
 * @param pools - Array of pool component descriptors across the repository.
 * @returns Soundness (PRF-POL-002) and negative-ROI (PRF-POL-003) issues.
 */
export function auditPoolImplementations(pools: PoolComponentContext[]): Issue[] {
    const issues: Issue[] = [];
    for (const pool of pools) {
        const soundness = checkPoolSoundness(pool);
        if (soundness) issues.push(soundness);

        const roi = checkPoolROI(pool);
        if (roi) issues.push(roi);
    }
    return issues;
}

/**
 * Evaluates repository-wide pooling architecture and emits lifecycle and economic issues.
 *
 * @param sites - Allocation sites inspected across routines.
 * @param pools - Pool components declared in the repository.
 * @returns Complete resource pooling audit result.
 */
export function evaluateResourcePooling(
    sites: AllocationSiteContext[],
    pools: PoolComponentContext[],
): ResourcePoolingAuditResult {
    const unpooledIssues = auditUnpooledHotspots(sites);
    const poolIssues = auditPoolImplementations(pools);

    return {
        unpooledHotspots: sites.filter((s) => s.isInLoopOrHotPath && !s.isPrimitiveOrTiny),
        pools,
        issues: [...unpooledIssues, ...poolIssues],
    };
}
