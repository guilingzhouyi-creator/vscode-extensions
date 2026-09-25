/**
 * Module: Core Engine - Review Cascade Event Bus
 * File Path: src/core/scheduler/review-event-bus.ts
 * Architecture Role: Lightweight typed event bus coordinating secondary cross-reviewer cascades;
 *   enables decoupled trigger dispatching between specialized reviewer responsibility domains.
 * Dependencies & Triggers: scheduler-types; consumed by sparse-orchestrator.
 * Responsibilities: Register event listeners by event kind or target domain; dispatch cascade
 *   events; record event audit logs for explainability and diagnostics.
 * Exit Semantics & Design Rationale: Synchronous in-memory event dispatch; never throws.
 */

import type { ReviewCascadeEvent, ReviewCascadeEventKind, ReviewerDomain } from './scheduler-types';

/** Callback listener signature for review cascade events */
export type ReviewCascadeListener = (event: ReviewCascadeEvent) => void;

/**
 * Event bus coordinating secondary review cascades across responsibility domains.
 */
export class ReviewEventBus {
    private readonly listeners = new Map<string, Set<ReviewCascadeListener>>();
    private readonly dispatchedEvents: ReviewCascadeEvent[] = [];

    /**
     * Subscribes to events targeting a specific domain, event kind, or wildcard '*'.
     *
     * @param topic - Target domain, event category, or '*' for all events
     * @param listener - Event listener callback
     * @returns Unsubscribe closure
     */
    public subscribe(
        topic: ReviewerDomain | ReviewCascadeEventKind | '*',
        listener: ReviewCascadeListener,
    ): () => void {
        let set = this.listeners.get(topic);
        if (!set) {
            set = new Set();
            this.listeners.set(topic, set);
        }
        set.add(listener);
        return () => {
            set?.delete(listener);
        };
    }

    /**
     * Dispatches a review cascade event to matching domain and kind listeners.
     *
     * @param event - Cascade event payload
     */
    public dispatch(event: ReviewCascadeEvent): void {
        this.dispatchedEvents.push(event);

        // 1. Dispatch to target domain subscribers
        const domainListeners = this.listeners.get(event.targetDomain);
        if (domainListeners) {
            for (const listener of domainListeners) {
                try {
                    listener(event);
                } catch {
                    // best-effort: isolate listener errors to preserve review pipeline continuity
                }
            }
        }

        // 2. Dispatch to event kind subscribers
        const kindListeners = this.listeners.get(event.kind);
        if (kindListeners) {
            for (const listener of kindListeners) {
                try {
                    listener(event);
                } catch {
                    // best-effort: isolate listener errors to preserve review pipeline continuity
                }
            }
        }

        // 3. Broadcast to wildcard subscribers
        const wildcardListeners = this.listeners.get('*');
        if (wildcardListeners) {
            for (const listener of wildcardListeners) {
                try {
                    listener(event);
                } catch {
                    // best-effort: isolate listener errors to preserve review pipeline continuity
                }
            }
        }
    }

    /**
     * Retrieves audit log of all events dispatched during the current session.
     */
    public getDispatchedEvents(): readonly ReviewCascadeEvent[] {
        return this.dispatchedEvents;
    }

    /**
     * Clears all subscribers and purges event history.
     */
    public reset(): void {
        this.listeners.clear();
        this.dispatchedEvents.length = 0;
    }
}

/** Default singleton instance of ReviewEventBus */
export const defaultReviewEventBus = new ReviewEventBus();
