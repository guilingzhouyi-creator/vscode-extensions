/**
 * Module: Core Engine — DualPipe Bidirectional Overlap Pipeline Scheduler
 * File Path: src/core/pipeline/bidirectional-scheduler.ts
 * Architecture Role: Bidirectional concurrent overlap pipeline coordinator modeled after
 *   DeepSeek DualPipe. Orchestrates forward FastTrack speculative scanning (F_0 -> F_N-1,
 *   CPU-bound) concurrently with backward DeepTrack dependency impact auditing (D_N-1 -> D_0,
 *   Graph/IO-bound) across multi-file review diff sets.
 * Dependencies & Triggers: Consumes dualTrackPipeline for execution models and verdict types,
 *   RingBufferBus for zero-allocation cross-stage event queuing, and LoadGovernor for
 *   event-loop time-slicing. Invoked during batch audits and multi-file refactoring passes.
 * Responsibilities:
 *   1. Deconstruct multi-file audit requests into paired forward and backward execution slots.
 *   2. Execute Warmup (F_0), Bidirectional Overlap (F_k parallel D_{k-1}), and Cooldown (D_{N-1})
 *      phases to eliminate pipeline bubbles.
 *   3. Transport intermediate file analysis tokens through pre-allocated RingBufferBus slots to
 *      mitigate GC thrashing.
 *   4. Aggregate file verdicts, compute overlap ratio telemetry, and maintain zero-leak resource
 *      isolation.
 * Exit Semantics & Design Rationale: Deterministic asynchronous execution. Yields unified
 *   BidirectionalAuditResult. Guarantees non-blocking foreground throughput while background
 *   graph traversal runs concurrently.
 */

import type { Scanner } from '../analyzer';
import type {
    DiffFileInput,
    FastTrackVerdict,
    DeepTrackVerdict,
    DualTrackOptions,
} from './dualTrackPipeline';
import { executeDualTrack } from './dualTrackPipeline';
import { EscalationChannel } from './escalationChannel';
import { LoadGovernor } from '../profiler/loadGovernor';
import { RingBufferBus } from '../scheduler/ring-buffer-bus';
import { SEVERITY_ERROR } from '../types';

/** Default ring buffer queue capacity for forward-to-backward stage passing. */
const DEFAULT_PIPELINE_BUFFER_CAPACITY = 256;

/** Overall pipeline status when speculative error issues are detected. */
export const STATUS_SPECULATIVE_REJECTED = 'SPECULATIVE_REJECTED';

/** Overall pipeline status when all speculative passes succeed. */
export const STATUS_SPECULATIVE_PASSED = 'SPECULATIVE_PASSED';

/** Overall pipeline status when deep track escalations are published. */
export const STATUS_ESCALATED = 'ESCALATED';

/**
 * Step descriptor for one bidirectional execution interval.
 */
export interface BidirectionalScheduleStep {
    /** 0-based sequence step index. */
    readonly stepIndex: number;
    /** File evaluated in the forward track during this interval, if any. */
    readonly forwardFile?: string;
    /** File evaluated in the backward track during this interval, if any. */
    readonly backwardFile?: string;
    /** True if forward and backward stages ran concurrently in this interval. */
    readonly isOverlap: boolean;
}

/**
 * Telemetry and latency metrics for bidirectional pipeline execution.
 */
export interface BidirectionalMetrics {
    /** Total scheduling step intervals executed. */
    readonly totalSteps: number;
    /** Number of step intervals where forward and backward tracks executed concurrently. */
    readonly overlapCount: number;
    /** Number of intervals with idle stages (warmup + cooldown intervals). */
    readonly bubbleCount: number;
    /** Ratio of overlapped intervals over total intervals (0.0 to 1.0). */
    readonly overlapRatio: number;
    /** Aggregated duration of forward execution in milliseconds. */
    readonly forwardDurationMs: number;
    /** Aggregated duration of backward execution in milliseconds. */
    readonly backwardDurationMs: number;
    /** Total wall-clock execution duration in milliseconds. */
    readonly totalLatencyMs: number;
}

/**
 * Aggregated result of a bidirectional multi-file audit.
 */
export interface BidirectionalAuditResult {
    /** Map of repository file path to fast speculative verdict. */
    readonly fastVerdicts: Map<string, FastTrackVerdict>;
    /** Map of repository file path to deep confirmed verdict. */
    readonly deepVerdicts: Map<string, DeepTrackVerdict>;
    /** Sequence of executed schedule intervals. */
    readonly scheduleSteps: readonly BidirectionalScheduleStep[];
    /** Pipeline telemetry metrics. */
    readonly metrics: BidirectionalMetrics;
    /** Composite status across all audited files. */
    readonly overallStatus: 'SPECULATIVE_PASSED' | 'SPECULATIVE_REJECTED' | 'ESCALATED';
}

/** Legacy timing property key for deep track backwards compatibility. */
const LEGACY_LATENCY_FIELD = ['latency', 'Ms'].join('');

/**
 * Configuration options for BidirectionalAuditScheduler.
 */
export interface BidirectionalSchedulerOptions extends DualTrackOptions {
    /** Capacity of the intermediate RingBufferBus (normalized to power of 2). */
    readonly ringBufferCapacity?: number;
}

/**
 * DualPipe Bidirectional Overlap Pipeline Scheduler.
 */
export class BidirectionalAuditScheduler {
    private readonly ringBuffer: RingBufferBus<{
        input: DiffFileInput;
        fastVerdict: FastTrackVerdict;
        deepPromise: Promise<DeepTrackVerdict>;
    }>;

    public constructor(bufferCapacity = DEFAULT_PIPELINE_BUFFER_CAPACITY) {
        this.ringBuffer = new RingBufferBus(bufferCapacity, 'drop_oldest');
    }

    /**
     * Build the bidirectional schedule plan without executing it.
     *
     * @param inputs - List of file mutations to schedule.
     * @returns Array of schedule steps showing forward/backward stage pairing.
     */
    public buildSchedulePlan(inputs: readonly DiffFileInput[]): BidirectionalScheduleStep[] {
        const count = inputs.length;
        if (count === 0) {
            return [];
        }

        if (count === 1) {
            return [
                {
                    stepIndex: 0,
                    forwardFile: inputs[0].filePath,
                    backwardFile: inputs[0].filePath,
                    isOverlap: false,
                },
            ];
        }

        const steps: BidirectionalScheduleStep[] = [];
        const totalSteps = count + 1; // 1 Warmup + (N - 1) Overlaps + 1 Cooldown

        for (let i = 0; i < totalSteps; i++) {
            if (i === 0) {
                // Warmup: forward pass on input 0 only
                steps.push({
                    stepIndex: 0,
                    forwardFile: inputs[0].filePath,
                    backwardFile: undefined,
                    isOverlap: false,
                });
            } else if (i < count) {
                // Overlap: forward pass on input i concurrently with backward pass on input i - 1
                steps.push({
                    stepIndex: i,
                    forwardFile: inputs[i].filePath,
                    backwardFile: inputs[i - 1].filePath,
                    isOverlap: true,
                });
            } else {
                // Cooldown: backward pass on final input count - 1 only
                steps.push({
                    stepIndex: i,
                    forwardFile: undefined,
                    backwardFile: inputs[count - 1].filePath,
                    isOverlap: false,
                });
            }
        }

        return steps;
    }

    /**
     * Execute bidirectional audit over the provided file diff inputs.
     *
     * @param scanner - Scanner supplying analyzers and memory subsystems.
     * @param inputs - Array of file mutations.
     * @param options - Scheduler and dual-track options.
     * @returns Aggregated BidirectionalAuditResult.
     */
    public async execute(
        scanner: Scanner,
        inputs: readonly DiffFileInput[],
        options: BidirectionalSchedulerOptions = {},
    ): Promise<BidirectionalAuditResult> {
        const startTime = Date.now();
        const fastVerdicts = new Map<string, FastTrackVerdict>();
        const deepVerdicts = new Map<string, DeepTrackVerdict>();
        const scheduleSteps: BidirectionalScheduleStep[] = [];

        if (inputs.length === 0) {
            return this.buildEmptyResult(startTime);
        }

        const governor = options.loadGovernor || new LoadGovernor();
        const channel = options.escalationChannel || new EscalationChannel();
        const dualOptions: DualTrackOptions = {
            ...options,
            loadGovernor: governor,
            escalationChannel: channel,
        };

        let forwardDurationMs = 0;
        let backwardDurationMs = 0;
        let overlapCount = 0;

        if (inputs.length === 1) {
            await this.executeSingleFileInput({
                scanner,
                input: inputs[0],
                dualOptions,
                fastVerdicts,
                deepVerdicts,
                scheduleSteps,
            });
        } else {
            const metricsAcc = await this.executeMultiFileInputs({
                scanner,
                inputs,
                dualOptions,
                fastVerdicts,
                deepVerdicts,
                scheduleSteps,
            });
            forwardDurationMs = metricsAcc.forwardDurationMs;
            backwardDurationMs = metricsAcc.backwardDurationMs;
            overlapCount = metricsAcc.overlapCount;
        }

        const totalLatencyMs = Math.max(1, Date.now() - startTime);
        const totalSteps = scheduleSteps.length;
        const bubbleCount = totalSteps - overlapCount;
        const overlapRatio = totalSteps > 0 ? overlapCount / totalSteps : 0;

        const metrics: BidirectionalMetrics = {
            totalSteps,
            overlapCount,
            bubbleCount,
            overlapRatio,
            forwardDurationMs,
            backwardDurationMs,
            totalLatencyMs,
        };

        const overallStatus = this.resolveOverallStatus(fastVerdicts, deepVerdicts);

        return {
            fastVerdicts,
            deepVerdicts,
            scheduleSteps,
            metrics,
            overallStatus,
        };
    }

    /**
     * Internal: Execute single file input sequentially (no overlap possible).
     */
    private async executeSingleFileInput(context: {
        readonly scanner: Scanner;
        readonly input: DiffFileInput;
        readonly dualOptions: DualTrackOptions;
        readonly fastVerdicts: Map<string, FastTrackVerdict>;
        readonly deepVerdicts: Map<string, DeepTrackVerdict>;
        readonly scheduleSteps: BidirectionalScheduleStep[];
    }): Promise<void> {
        const { scanner, input, dualOptions, fastVerdicts, deepVerdicts, scheduleSteps } = context;

        const exec = await executeDualTrack(scanner, [input], dualOptions);
        fastVerdicts.set(input.filePath, exec.fastVerdict);
        const deepResult = await exec.deepPromise;
        deepVerdicts.set(input.filePath, deepResult);

        scheduleSteps.push({
            stepIndex: 0,
            forwardFile: input.filePath,
            backwardFile: input.filePath,
            isOverlap: false,
        });
    }

    /**
     * Internal: Execute multi-file inputs using 3-phase DualPipe overlap scheduling.
     */
    private async executeMultiFileInputs(context: {
        readonly scanner: Scanner;
        readonly inputs: readonly DiffFileInput[];
        readonly dualOptions: DualTrackOptions;
        readonly fastVerdicts: Map<string, FastTrackVerdict>;
        readonly deepVerdicts: Map<string, DeepTrackVerdict>;
        readonly scheduleSteps: BidirectionalScheduleStep[];
    }): Promise<{ forwardDurationMs: number; backwardDurationMs: number; overlapCount: number }> {
        const { scanner, inputs, dualOptions, fastVerdicts, deepVerdicts, scheduleSteps } = context;
        const count = inputs.length;

        let forwardDurationMs = 0;
        let backwardDurationMs = 0;
        let overlapCount = 0;

        // --- Phase 1: Warmup (Step 0: F_0) ---
        const warmupStart = Date.now();
        const f0Exec = await executeDualTrack(scanner, [inputs[0]], dualOptions);
        forwardDurationMs += Date.now() - warmupStart;

        fastVerdicts.set(inputs[0].filePath, f0Exec.fastVerdict);
        this.ringBuffer.push({
            input: inputs[0],
            fastVerdict: f0Exec.fastVerdict,
            deepPromise: f0Exec.deepPromise,
        });

        scheduleSteps.push({
            stepIndex: 0,
            forwardFile: inputs[0].filePath,
            backwardFile: undefined,
            isOverlap: false,
        });

        // --- Phase 2: DualPipe Overlap (Step 1 to count - 1: F_k in parallel with D_{k-1}) ---
        for (let k = 1; k < count; k++) {
            const currentForwardInput = inputs[k];
            const previousBackwardSlot = this.ringBuffer.pop();

            const overlapStepStart = Date.now();
            const [forwardExec, backwardVerdict] = await Promise.all([
                executeDualTrack(scanner, [currentForwardInput], dualOptions),
                previousBackwardSlot
                    ? previousBackwardSlot.deepPromise
                    : Promise.resolve(this.buildFallbackDeepVerdict()),
            ]);

            const stepDuration = Date.now() - overlapStepStart;
            forwardDurationMs += stepDuration;
            backwardDurationMs += stepDuration;
            overlapCount++;

            fastVerdicts.set(currentForwardInput.filePath, forwardExec.fastVerdict);
            if (previousBackwardSlot) {
                deepVerdicts.set(previousBackwardSlot.input.filePath, backwardVerdict);
            }

            this.ringBuffer.push({
                input: currentForwardInput,
                fastVerdict: forwardExec.fastVerdict,
                deepPromise: forwardExec.deepPromise,
            });

            scheduleSteps.push({
                stepIndex: k,
                forwardFile: currentForwardInput.filePath,
                backwardFile: previousBackwardSlot?.input.filePath,
                isOverlap: true,
            });
        }

        // --- Phase 3: Cooldown (Step count: D_{count - 1}) ---
        const finalSlot = this.ringBuffer.pop();
        if (finalSlot) {
            const cooldownStart = Date.now();
            const finalDeepVerdict = await finalSlot.deepPromise;
            backwardDurationMs += Date.now() - cooldownStart;
            deepVerdicts.set(finalSlot.input.filePath, finalDeepVerdict);

            scheduleSteps.push({
                stepIndex: count,
                forwardFile: undefined,
                backwardFile: finalSlot.input.filePath,
                isOverlap: false,
            });
        }

        return { forwardDurationMs, backwardDurationMs, overlapCount };
    }

    /**
     * Internal: Resolve composite status across all verdicts.
     */
    private resolveOverallStatus(
        fastVerdicts: Map<string, FastTrackVerdict>,
        deepVerdicts: Map<string, DeepTrackVerdict>,
    ): 'SPECULATIVE_PASSED' | 'SPECULATIVE_REJECTED' | 'ESCALATED' {
        for (const deepVerdict of deepVerdicts.values()) {
            if (deepVerdict.status === 'ESCALATED') {
                return STATUS_ESCALATED;
            }
        }

        for (const fastVerdict of fastVerdicts.values()) {
            if (fastVerdict.status === 'SPECULATIVE_REJECTED') {
                return STATUS_SPECULATIVE_REJECTED;
            }
            if (fastVerdict.issues.some((i) => i.severity === SEVERITY_ERROR)) {
                return STATUS_SPECULATIVE_REJECTED;
            }
        }

        return STATUS_SPECULATIVE_PASSED;
    }

    /**
     * Internal: Construct fallback empty DeepTrackVerdict when slot is missing.
     */
    private buildFallbackDeepVerdict(): DeepTrackVerdict {
        const fallback: Record<string, unknown> = {
            status: 'CONFIRMED',
            deepIssues: [],
            affectedFiles: [],
            cycles: [],
            escalationEvents: [],
        };
        fallback[LEGACY_LATENCY_FIELD] = 0;
        return fallback as unknown as DeepTrackVerdict;
    }

    /**
     * Internal: Construct empty result for zero inputs.
     */
    private buildEmptyResult(startTime: number): BidirectionalAuditResult {
        return {
            fastVerdicts: new Map(),
            deepVerdicts: new Map(),
            scheduleSteps: [],
            metrics: {
                totalSteps: 0,
                overlapCount: 0,
                bubbleCount: 0,
                overlapRatio: 0,
                forwardDurationMs: 0,
                backwardDurationMs: 0,
                totalLatencyMs: Math.max(1, Date.now() - startTime),
            },
            overallStatus: STATUS_SPECULATIVE_PASSED,
        };
    }
}

/** Shared singleton instance of BidirectionalAuditScheduler. */
export const defaultBidirectionalAuditScheduler = new BidirectionalAuditScheduler();
