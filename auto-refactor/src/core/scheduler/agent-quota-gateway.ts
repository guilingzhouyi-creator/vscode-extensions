/**
 * Module: Core Engine - Multi-Agent Quota & Resource Governance Gateway
 * File Path: src/core/scheduler/agent-quota-gateway.ts
 * Architecture Role: Agent OS resource governance gateway providing multi-tenant quota bounding,
 *   token-bucket rate limiting, dynamic priority preemption, and TTL lease management.
 * Dependencies & Triggers: Consumes TaskPriority from execution-scheduler;
 *   invoked by Agent OS workflows and sparse review orchestrators.
 * Responsibilities:
 *   1. Track active agents, their assigned service tiers, and concurrency limits;
 *   2. Enforce fair scheduling and token-bucket rate limits to prevent worker starvation;
 *   3. Issue and track timed resource leases (Lease TTL) with automatic expiry cleanup;
 *   4. Provide real-time telemetry metrics for multi-agent concurrency and quota utilization.
 * Exit Semantics & Design Rationale: Never throws; deterministic grant/deny decisions.
 */

import { TaskPriority } from './execution-scheduler';

/**
 * Service tier categorization for collaborative agent entities.
 */
export type AgentServiceTier = 'interactive' | 'batch' | 'background';

/**
 * Configuration options bounding an agent's execution quotas.
 */
export interface AgentQuotaConfig {
    readonly maxConcurrentTasks: number;
    readonly tokensPerMinute: number;
    readonly burstCapacity: number;
    readonly leaseTtlMs: number;
}

/**
 * Default quota profiles per service tier.
 */
export const DEFAULT_TIER_QUOTAS: Record<AgentServiceTier, AgentQuotaConfig> = {
    interactive: {
        maxConcurrentTasks: 8,
        tokensPerMinute: 600,
        burstCapacity: 20,
        leaseTtlMs: 15_000,
    },
    batch: {
        maxConcurrentTasks: 4,
        tokensPerMinute: 200,
        burstCapacity: 10,
        leaseTtlMs: 60_000,
    },
    background: {
        maxConcurrentTasks: 2,
        tokensPerMinute: 60,
        burstCapacity: 5,
        leaseTtlMs: 120_000,
    },
};

/**
 * Timed resource lease granted to an agent for task execution.
 */
export interface AgentResourceLease {
    readonly leaseId: string;
    readonly agentId: string;
    readonly tier: AgentServiceTier;
    readonly acquiredAt: number;
    readonly expiresAt: number;
}

/**
 * Real-time telemetry metrics for a registered agent.
 */
export interface AgentGatewayMetrics {
    readonly agentId: string;
    readonly tier: AgentServiceTier;
    readonly activeLeases: number;
    readonly availableTokens: number;
    readonly totalRequests: number;
    readonly totalGranted: number;
    readonly totalRejected: number;
    readonly totalExpired: number;
}

/**
 * Internal state descriptor for an active agent client.
 */
interface AgentState {
    readonly config: AgentQuotaConfig;
    readonly tier: AgentServiceTier;
    tokens: number;
    lastTokenRefill: number;
    activeLeases: Map<string, AgentResourceLease>;
    totalRequests: number;
    totalGranted: number;
    totalRejected: number;
    totalExpired: number;
}

/**
 * Multi-Agent Resource Quota and Gateway Coordinator.
 */
export class AgentQuotaGateway {
    private readonly agents = new Map<string, AgentState>();
    private leaseSequence = 1;

    /**
     * Registers or updates an agent client with an assigned service tier.
     */
    public registerAgent(
        agentId: string,
        tier: AgentServiceTier = 'batch',
        customConfig?: Partial<AgentQuotaConfig>,
    ): void {
        const baseConfig = DEFAULT_TIER_QUOTAS[tier];
        const config: AgentQuotaConfig = {
            maxConcurrentTasks: customConfig?.maxConcurrentTasks ?? baseConfig.maxConcurrentTasks,
            tokensPerMinute: customConfig?.tokensPerMinute ?? baseConfig.tokensPerMinute,
            burstCapacity: customConfig?.burstCapacity ?? baseConfig.burstCapacity,
            leaseTtlMs: customConfig?.leaseTtlMs ?? baseConfig.leaseTtlMs,
        };

        this.agents.set(agentId, {
            config,
            tier,
            tokens: config.burstCapacity,
            lastTokenRefill: Date.now(),
            activeLeases: new Map(),
            totalRequests: 0,
            totalGranted: 0,
            totalRejected: 0,
            totalExpired: 0,
        });
    }

    /**
     * Attempts to acquire an execution lease for the specified agent.
     */
    public acquireLease(
        agentId: string,
        priority: TaskPriority = TaskPriority.NORMAL,
    ): { granted: boolean; lease?: AgentResourceLease; reason?: string } {
        let state = this.agents.get(agentId);
        if (!state) {
            // Auto-register unannounced agent under batch tier
            this.registerAgent(agentId, 'batch');
            state = this.agents.get(agentId)!;
        }

        state.totalRequests++;
        this.refillTokens(state);
        this.sweepExpiredLeasesForAgent(state);

        // 1. Check concurrent tasks limit (Critical tasks are allowed 1.5x burst)
        const maxTasks =
            priority === TaskPriority.CRITICAL
                ? Math.ceil(state.config.maxConcurrentTasks * 1.5)
                : state.config.maxConcurrentTasks;

        if (state.activeLeases.size >= maxTasks) {
            state.totalRejected++;
            return {
                granted: false,
                reason: `Concurrency limit exceeded (${state.activeLeases.size}/${maxTasks})`,
            };
        }

        // 2. Check token bucket rate limit
        if (state.tokens < 1) {
            state.totalRejected++;
            return {
                granted: false,
                reason: 'Rate limit token bucket exhausted',
            };
        }

        // Deduct token
        state.tokens -= 1;
        state.totalGranted++;

        const now = Date.now();
        const lease: AgentResourceLease = {
            leaseId: `lease-${agentId}-${this.leaseSequence++}`,
            agentId,
            tier: state.tier,
            acquiredAt: now,
            expiresAt: now + state.config.leaseTtlMs,
        };

        state.activeLeases.set(lease.leaseId, lease);
        return { granted: true, lease };
    }

    /**
     * Releases an active lease upon task completion.
     */
    public releaseLease(leaseId: string): boolean {
        for (const state of this.agents.values()) {
            if (state.activeLeases.delete(leaseId)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Sweeps and cleans up expired leases across all registered agents.
     */
    public sweepExpiredLeases(): number {
        let sweptCount = 0;
        for (const state of this.agents.values()) {
            sweptCount += this.sweepExpiredLeasesForAgent(state);
        }
        return sweptCount;
    }

    /**
     * Retrieves runtime quota and concurrency metrics for an agent.
     */
    public getMetrics(agentId: string): AgentGatewayMetrics | undefined {
        const state = this.agents.get(agentId);
        if (!state) {
            return undefined;
        }

        this.refillTokens(state);
        return {
            agentId,
            tier: state.tier,
            activeLeases: state.activeLeases.size,
            availableTokens: Math.floor(state.tokens),
            totalRequests: state.totalRequests,
            totalGranted: state.totalGranted,
            totalRejected: state.totalRejected,
            totalExpired: state.totalExpired,
        };
    }

    /**
     * Refills token bucket based on elapsed time.
     */
    private refillTokens(state: AgentState): void {
        const now = Date.now();
        const elapsedSec = (now - state.lastTokenRefill) / 1000;
        const refillAmount = (elapsedSec * state.config.tokensPerMinute) / 60;

        if (refillAmount > 0) {
            state.tokens = Math.min(state.config.burstCapacity, state.tokens + refillAmount);
            state.lastTokenRefill = now;
        }
    }

    /**
     * Sweeps expired leases for a specific agent state.
     */
    private sweepExpiredLeasesForAgent(state: AgentState): number {
        const now = Date.now();
        let swept = 0;

        for (const [id, lease] of state.activeLeases.entries()) {
            if (now >= lease.expiresAt) {
                state.activeLeases.delete(id);
                state.totalExpired++;
                swept++;
            }
        }

        return swept;
    }
}

/** Singleton default AgentQuotaGateway instance */
export const defaultAgentQuotaGateway = new AgentQuotaGateway();
