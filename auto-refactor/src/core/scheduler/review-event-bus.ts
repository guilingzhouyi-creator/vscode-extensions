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

import type {
    ReviewCascadeEvent,
    ReviewCascadeEventKind,
    ReviewerDomain,
} from './scheduler-types';

/** 事件监听处理函数类型 */
export type ReviewCascadeListener = (event: ReviewCascadeEvent) => void;

/** 审查器级联触发事件总线 */
export class ReviewEventBus {
    private readonly listeners = new Map<string, Set<ReviewCascadeListener>>();
    private readonly dispatchedEvents: ReviewCascadeEvent[] = [];

    /**
     * 订阅指定事件类别或目标责任域的级联事件
     *
     * @param topic - 目标责任域或事件类型
     * @param listener - 回调处理函数
     * @returns 解除订阅的注销函数
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
     * 派发级联触发事件
     *
     * @param event - 级联事件载荷
     */
    public dispatch(event: ReviewCascadeEvent): void {
        this.dispatchedEvents.push(event);

        // 1. 派发给目标领域订阅者
        const domainListeners = this.listeners.get(event.targetDomain);
        if (domainListeners) {
            for (const listener of domainListeners) {
                try {
                    listener(event);
                } catch {
                    // 隔离异常，避免阻断流水线
                }
            }
        }

        // 2. 派发给特定事件类别订阅者
        const kindListeners = this.listeners.get(event.kind);
        if (kindListeners) {
            for (const listener of kindListeners) {
                try {
                    listener(event);
                } catch {
                    // 隔离异常
                }
            }
        }

        // 3. 通配广播
        const wildcardListeners = this.listeners.get('*');
        if (wildcardListeners) {
            for (const listener of wildcardListeners) {
                try {
                    listener(event);
                } catch {
                    // 隔离异常
                }
            }
        }
    }

    /**
     * 获取历史上已派发的所有级联事件
     */
    public getDispatchedEvents(): readonly ReviewCascadeEvent[] {
        return this.dispatchedEvents;
    }

    /**
     * 重置事件历史与清空监听器
     */
    public reset(): void {
        this.listeners.clear();
        this.dispatchedEvents.length = 0;
    }
}

/** 默认全局审查级联事件总线单例 */
export const defaultReviewEventBus = new ReviewEventBus();
