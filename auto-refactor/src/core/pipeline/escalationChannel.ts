/**
 * Module: Core Engine — Asynchronous Escalation Broadcast
 * File Path: src/core/pipeline/escalationChannel.ts
 * Architecture Role: Pub-sub adapter between the DeepTrack pipeline and escalation
 *   consumers; owns the listener registry and recorded event log, and taints Review
 *   Memory/trajectory state when cross-file violations are confirmed.
 * Dependencies & Triggers: Imports Issue/Severity plus ReviewMemoryManager and
 *   ChangeTrajectoryManager; constructed by executeDualTrack, subscribed by consumers, and
 *   triggered by publish calls for CIRCULAR_DEPENDENCY / ARCHITECTURE_BREACH escalations.
 * Responsibilities: subscribe registers a listener and returns an idempotent unsubscribe
 *   closure; publish appends the event to the log, maps escalation issues into rule hits,
 *   lowers a present record score by 20 clamped at zero and marks it REJECTED, appends a
 *   quality-regression anomaly to the source trajectory, then awaits listeners in order while
 *   catching and logging each listener error; getEvents exposes the log read-only,
 *   hasBreaches detects error/critical events, and clear empties the log in place.
 * Exit Semantics & Design Rationale: publish resolves even when a listener throws because
 *   errors are caught and logged, so one faulty subscriber cannot abort DeepTrack escalation;
 *   an empty log reports no breaches, keeping the channel advisory and fail-soft; tainting
 *   memory/trajectory records keeps downstream gating consistent with the event.
 */

import type { Issue, Severity } from '../types';
import type { ReviewMemoryManager } from '../memory/reviewMemory';
import type { ChangeTrajectoryManager } from '../trajectory/changeTrajectory';

/** Points subtracted from a review score per confirmed escalation, clamped at 0. */
const ESCALATION_SCORE_PENALTY = 20;

/**
 * Categories of cross-file regressions the channel can broadcast.
 *
 * CIRCULAR_DEPENDENCY marks an import cycle, ARCHITECTURE_BREACH a layer
 * inversion, TRANSITIVE_REGRESSION fallout in dependent files, and
 * SPECULATIVE_INVALIDATION a prediction contradicted by later evidence.
 */
export type EscalationType =
    | 'CIRCULAR_DEPENDENCY'
    | 'ARCHITECTURE_BREACH'
    | 'TRANSITIVE_REGRESSION'
    | 'SPECULATIVE_INVALIDATION';

/**
 * Broadcast payload describing one escalation.
 *
 * `sourceFile` is the origin of the violation, `affectedFiles` lists impacted
 * paths, `issues` carries the concrete analyzer findings, and `timestamp` is the
 * epoch-millisecond creation time. Every listener receives the same reference,
 * so consumers must treat the payload as read-only.
 */
export interface EscalationEvent {
    type: EscalationType;
    sourceFile: string;
    affectedFiles: string[];
    issues: Issue[];
    severity: Severity;
    message: string;
    timestamp: number;
}

/**
 * Subscriber callback invoked for each published escalation.
 *
 * A synchronous return value is accepted, while returning a promise lets the
 * publisher await completion; listener rejections are caught and logged so one
 * faulty subscriber cannot abort the broadcast.
 */
export type EscalationListener = (event: EscalationEvent) => void | Promise<void>;

/**
 * Records escalation events and fans them out to registered listeners.
 *
 * Delivery is sequential (`await` per subscriber), so a slow listener delays the
 * ones after it; publish resolves even when listeners fail. Instances are not
 * thread-safe: the shared listener set and event log assume single-threaded
 * event-loop use.
 */
export class EscalationChannel {
    private readonly listeners: Set<EscalationListener> = new Set();
    private readonly events: EscalationEvent[] = [];

    /**
     * Subscribe to asynchronous escalation events.
     * Returns an unsubscribe function.
     *
     * @param listener - Callback registered for every subsequently published event.
     * @returns Idempotent unsubscribe closure that removes this exact listener; calling it
     *          again after removal is a safe no-op.
     */
    subscribe(listener: EscalationListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Publish an escalation event to all registered listeners.
     *
     * The event is appended to the log first, then optional memory/trajectory
     * tainting is applied, and finally listeners are awaited in insertion order.
     * Listener errors are caught and logged, so listener failures never reject
     * the returned promise.
     *
     * @param event - Escalation payload recorded and broadcast to listeners.
     * @param memory - Optional review memory manager whose record for the source file is
     *                 tainted (rule hits appended, score penalized, status set to REJECTED).
     * @param trajectory - Optional trajectory manager that records a quality-regression
     *                     anomaly for the source file.
     * @returns Promise resolved after all listeners have completed; never rejects.
     */
    async publish(
        event: EscalationEvent,
        memory?: ReviewMemoryManager,
        trajectory?: ChangeTrajectoryManager,
    ): Promise<void> {
        this.events.push(event);

        // If review memory manager is provided, invalidate/taint the review record
        if (memory) {
            const record = memory.get(event.sourceFile);
            if (record) {
                // Append escalation issues to the record
                const mappedHits = event.issues.map((i) => ({
                    id: i.id,
                    analyzer: i.analyzer,
                    rule: i.rule,
                    severity: i.severity,
                    line: i.location.start.line,
                    message: i.message,
                }));
                record.ruleHits = [...record.ruleHits, ...mappedHits];
                if (record.overallScore !== undefined) {
                    record.overallScore = Math.max(
                        0,
                        record.overallScore - ESCALATION_SCORE_PENALTY,
                    );
                }
                record.status = 'REJECTED';
                record.contaminationReason = event.message;
                memory.put(record);
            }
        }

        // If trajectory manager is provided, record anomaly
        if (trajectory) {
            const traj = trajectory.getTrajectory(event.sourceFile);
            if (traj) {
                traj.activeAnomalies.push({
                    kind: 'quality-regression',
                    dimension: 'architectureConsistency',
                    severity: event.severity,
                    message: event.message,
                    affectedAgents:
                        traj.participatingAgents.length > 0
                            ? [traj.participatingAgents[traj.participatingAgents.length - 1]]
                            : ['asymmetric-escalation'],
                    details: { escalationType: event.type, issues: event.issues.map((i) => i.id) },
                });
            }
        }

        for (const listener of this.listeners) {
            try {
                await listener(event);
            } catch (err) {
                console.error(`[EscalationChannel] Listener error: ${err}`);
            }
        }
    }

    /**
     * Get all recorded escalation events.
     *
     * @returns Live read-only view of the internal log in append order; the backing array
     *          is not copied, so callers must not mutate it.
     */
    getEvents(): readonly EscalationEvent[] {
        return this.events;
    }

    /**
     * Check if any critical/error escalations have occurred.
     *
     * @returns True when at least one recorded event has error or critical severity.
     */
    hasBreaches(): boolean {
        return this.events.some(
            (e) => e.severity === 'error' || (e.severity as any) === 'critical',
        );
    }

    /**
     * Clear recorded events.
     *
     * Empties the log in place, so arrays previously returned by
     * {@link getEvents} observe the cleared state; listener registrations are
     * left untouched.
     */
    clear(): void {
        this.events.length = 0;
    }
}
