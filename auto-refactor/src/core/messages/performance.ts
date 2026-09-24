/**
 * Module: Core Messages - Performance & I/O Hotspot Diagnostics
 * File Path: src/core/messages/performance.ts
 * Architecture Role: Standard English descriptor catalog for the performance analyzer; defines
 *   rule prose and severity policy per modern performance engineering standards, while all
 *   detection and traversal remain in the analyzer.
 * Dependencies & Triggers: Imports DiagnosticDescriptor from ./types; loaded when the performance
 *   analyzer imports ../core/messages. Factories run when PRF-ALG-001, PRF-MEM-001, or
 *   PRF-IO-001 issues are emitted during CLI, CI, post-scan, or daemon scans.
 * Responsibilities: Provide factories for NESTED_LOOP_COMPLEXITY, TRANSIENT_LOOP_ALLOCATION, and
 *   BLOCKING_SYNC_IO; each builds message, suggestion, rationale, and risk text, with nested-loop
 *   risk High at depth 4+ and sync-I/O risk High inside async routines.
 * Exit Semantics & Design Rationale: Pure construction with no I/O, cache, or exceptions; only
 *   deterministic threshold and async-context ternaries select severity, so identical context
 *   always yields the same descriptor. Centralizing that policy keeps analyzer code free of prose
 *   and makes severity decisions reviewable in one leaf module.
 */

import type { DiagnosticDescriptor } from './types';

/** Loop-nesting depth at or above which PRF-ALG-001 escalates risk to High. */
const HIGH_RISK_NESTING_DEPTH = 4;

const RISK_HIGH = 'High';
const RISK_MEDIUM = 'Medium';
const RISK_LOW = 'Low';

/**
 * Performance-rule diagnostic descriptor catalog.
 *
 * Exposes factories for nested-loop complexity, transient loop allocation, and blocking
 * synchronous I/O findings. Factories map analyzer-supplied loop counts, thresholds, API
 * names, and async-context flags to fresh DiagnosticDescriptor records; severity is derived
 * only from deterministic threshold comparisons, with depth 4 or more and async contexts
 * promoted to High risk. Numeric and string inputs are trusted and embedded verbatim.
 * Construction is synchronous, side-effect-free, and cannot throw.
 */
export const PerformanceMessages = {
    // PRF-ALG-001
    /**
     * Build the PRF-ALG-001 descriptor for excessively nested loop iteration.
     *
     * @param currentDepth - Maximum nesting depth observed by the analyzer.
     * @param threshold - Configured depth threshold that triggered the finding.
     * @returns Fresh descriptor; risk is High at depth 4 or more, otherwise Medium.
     */
    NESTED_LOOP_COMPLEXITY: (currentDepth: number, threshold: number): DiagnosticDescriptor => ({
        message: `High algorithmic complexity risk: Found ${currentDepth} levels of nested loops (potential O(N^${currentDepth}) compute hotspot, threshold ${threshold})`,
        suggestion:
            'Deeply nested loops risk exponential/polynomial performance degradation; consider pre-indexing with Map/Set or breaking down algorithms',
        rationale:
            'Nested iteration over unbound collections leads to CPU starvation and frame drops on high-throughput workloads.',
        risk: currentDepth >= HIGH_RISK_NESTING_DEPTH ? RISK_HIGH : RISK_MEDIUM,
    }),

    // PRF-MEM-001
    /**
     * Build the PRF-MEM-001 descriptor for allocations repeated inside a hot loop.
     *
     * @param _loopDepth - Observed loop depth; accepted for signature symmetry but unused
     *   because the descriptor text and Low risk are depth-independent.
     * @returns Fresh descriptor with Low risk and allocation-hoisting guidance.
     */
    TRANSIENT_LOOP_ALLOCATION: (_loopDepth: number): DiagnosticDescriptor => ({
        message:
            'Transient heap allocation in hot loop: Temporary collection or object repeatedly instantiated inside loop body',
        suggestion:
            'Hoist temporary buffers, arrays, or objects outside the loop and reuse them by calling clear() or reset() each iteration',
        rationale:
            'Allocating short-lived objects in tight loops generates high garbage collection (GC) pressure and causes latency spikes.',
        risk: RISK_LOW,
    }),

    // PRF-MEM-002
    /**
     * Build the PRF-MEM-002 descriptor for high-pressure object pooling contract violations.
     *
     * @param loopDepth - Observed loop depth.
     * @returns Fresh descriptor with High risk and ADV-PRF-002 object pooling guidance.
     */
    HIGH_PRESSURE_OBJECT_ALLOCATION: (loopDepth: number): DiagnosticDescriptor => ({
        message: `High-pressure loop transient allocation: Violates ADV-PRF-002 zero-transient heap allocation contract in hot loop (depth ${loopDepth})`,
        suggestion:
            'Eliminate in-loop allocation by hoisting to outer scope or adopting an object pool with explicit reset_state() lifecycle hooks',
        rationale:
            'Transient heap allocations and deep duplicates inside loops produce GC spikes and memory fragmentation in latency-sensitive runtimes.',
        risk: RISK_HIGH,
    }),

    // PRF-IO-001
    /**
     * Build the PRF-IO-001 descriptor for a synchronous API on a hot execution path.
     *
     * @param apiName - Synchronous file or network API name that was detected.
     * @param inAsync - True when the call sits inside an async routine, which raises risk.
     * @returns Fresh descriptor; risk is High in async contexts, otherwise Medium.
     */
    BLOCKING_SYNC_IO: (apiName: string, inAsync: boolean): DiagnosticDescriptor => ({
        message: `Synchronous I/O blocking risk: Invoking synchronous blocking API '${apiName}' inside ${inAsync ? 'async routine' : 'critical execution stream'}`,
        suggestion:
            'Synchronous file or network calls freeze the event loop or game main thread; replace with non-blocking asynchronous alternatives',
        rationale:
            'Blocking the main thread stops event handling, network dispatching, and UI rendering until the OS filesystem operation completes.',
        risk: inAsync ? RISK_HIGH : RISK_MEDIUM,
    }),

    // PRF-LEAK-001
    /**
     * Build the PRF-LEAK-001 descriptor for unbounded collection growth.
     *
     * @param collectionName - Name of the accumulating collection.
     * @param complexity - 'O(t)' for timer leaks, 'O(n)' for loop leaks.
     * @param contextDescription - Description of enclosing context.
     * @returns Fresh descriptor with High risk and bounded-capacity guidance.
     */
    UNBOUNDED_GROWTH: (
        collectionName: string,
        complexity: 'O(t)' | 'O(n)',
        contextDescription: string,
    ): DiagnosticDescriptor => ({
        message: `Potential ${complexity} unbounded memory growth: collection '${collectionName}' accumulates elements in ${contextDescription} without eviction, clear(), or capacity bound`,
        suggestion:
            'Bound the collection with an explicit capacity limit, ring-buffer (LRU), or periodic reset to prevent unbounded memory retention',
        rationale:
            'Unbounded element retention leads to progressive heap fragmentation, garbage-collector pressure, and eventual out-of-memory crashes',
        risk: 'High',
    }),
} as const;
