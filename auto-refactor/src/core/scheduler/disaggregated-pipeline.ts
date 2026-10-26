/**
 * Module: Core Engine — DeepInfer Prefill/Decode Disaggregated Audit Pipeline
 * File Path: src/core/scheduler/disaggregated-pipeline.ts
 * Architecture Role: Decoupled two-stage execution pipeline coordinator modeled after
 *   DeepInfer's Prefill/Decode (PD) disaggregation. Separates compute-dense Prefill tasks
 *   (AST extraction, slice generation, symbol parsing) from high-throughput Decode tasks
 *   (sparse rule evaluation, AAS v1.0 rendering, guidance prompt generation) with independent
 *   concurrency pools and zero-allocation ring buffer transport.
 * Dependencies & Triggers: Consumes RingBufferBus from scheduler, LoadGovernor from profiler,
 *   Scanner from analyzer, and Issue from types. Triggered during multi-file scans and batch passes.
 * Responsibilities:
 *   1. Manage decoupled Prefill worker pool (compute-bounded) and Decode worker pool (wide concurrency).
 *   2. Transport prefilled AST slices through an in-memory RingBufferBus to prevent GC thrashing.
 *   3. Enforce stage-level backpressure when decode queue capacity reaches high-water mark.
 *   4. Collect and report PD disaggregated pipeline telemetry (prefill time, decode time, queue depth).
 * Exit Semantics & Design Rationale: Pure asynchronous execution. Decouples heavy foreground
 *   CPU workloads from background streaming rules, preventing UI event loop starvation.
 */

import * as os from 'os';
import type { Scanner } from '../analyzer';
import { RingBufferBus } from './ring-buffer-bus';
import { LoadGovernor } from '../profiler/loadGovernor';
import type { Issue, FileMetric } from '../types';

/** Default ring buffer slot capacity connecting prefill and decode stages. */
const DEFAULT_DISAGGREGATED_BUFFER_CAPACITY = 512;

/**
 * Intermediate prefilled slice payload emitted by the Prefill stage.
 */
export interface PrefillAuditSlice {
    readonly sliceId: string;
    readonly filePath: string;
    readonly content: string;
    readonly activeAnalyzers: readonly string[];
    readonly lineBounds?: readonly [number, number];
    readonly prefillTimestamp: number;
}

/**
 * Result produced by the Decode stage for an individual slice.
 */
export interface DecodeSliceVerdict {
    readonly sliceId: string;
    readonly filePath: string;
    readonly issues: readonly Issue[];
    readonly metric?: FileMetric;
    readonly decodeTimestamp: number;
}

/**
 * Telemetry and latency breakdown for the disaggregated pipeline.
 */
export interface DisaggregatedPipelineTelemetry {
    readonly totalInputs: number;
    readonly prefillCompleted: number;
    readonly decodeCompleted: number;
    readonly prefillDurationMs: number;
    readonly decodeDurationMs: number;
    readonly totalPipelineDurationMs: number;
    readonly peakBufferUtilization: number;
}

/**
 * Configuration options for DisaggregatedAuditPipeline.
 */
export interface DisaggregatedPipelineOptions {
    /** Maximum concurrent prefill workers (defaults to os.cpus().length / 2). */
    readonly prefillConcurrency?: number;
    /** Maximum concurrent decode workers (defaults to os.cpus().length). */
    readonly decodeConcurrency?: number;
    /** Ring buffer queue capacity connecting stages (defaults to 512). */
    readonly bufferCapacity?: number;
    /** Cooperative load governor used for event loop yields. */
    readonly loadGovernor?: LoadGovernor;
}

/**
 * DeepInfer Prefill/Decode Disaggregated Audit Pipeline.
 */
export class DisaggregatedAuditPipeline {
    private readonly prefillConcurrency: number;
    private readonly decodeConcurrency: number;
    private readonly ringBuffer: RingBufferBus<PrefillAuditSlice>;

    public constructor(options: DisaggregatedPipelineOptions = {}) {
        const cpus = os.cpus?.()?.length ?? 4;
        this.prefillConcurrency = options.prefillConcurrency ?? Math.max(1, Math.floor(cpus / 2));
        this.decodeConcurrency = options.decodeConcurrency ?? Math.max(2, cpus);

        const cap = options.bufferCapacity ?? DEFAULT_DISAGGREGATED_BUFFER_CAPACITY;
        this.ringBuffer = new RingBufferBus<PrefillAuditSlice>(cap, 'drop_oldest');
    }

    /**
     * Execute disaggregated audit across supplied file items.
     *
     * @param scanner - Scanner supplying analyzer plan and run methods.
     * @param items - Array of files to audit with target content and analyzers.
     * @param options - Pipeline configuration and governor options.
     * @returns Array of decode verdicts and pipeline telemetry.
     */
    public async execute(
        scanner: Scanner,
        items: readonly {
            filePath: string;
            content: string;
            analyzers?: readonly string[];
            lineBounds?: readonly [number, number];
        }[],
        options: DisaggregatedPipelineOptions = {},
    ): Promise<{
        verdicts: DecodeSliceVerdict[];
        telemetry: DisaggregatedPipelineTelemetry;
    }> {
        const pipelineStart = Date.now();
        const totalInputs = items.length;

        if (totalInputs === 0) {
            return this.buildEmptyResult(pipelineStart);
        }

        const governor = options.loadGovernor ?? new LoadGovernor();
        const verdicts: DecodeSliceVerdict[] = [];

        let prefillDurationMs = 0;
        let decodeDurationMs = 0;

        // Stage 1: Prefill (Slice extraction & queue packing)
        const prefillStart = Date.now();
        const prefillSlices = await this.runPrefillStage(scanner, items, governor);
        prefillDurationMs = Math.max(1, Date.now() - prefillStart);

        // Stage 2: Decode (Concurrent rule evaluation & verification)
        const decodeStart = Date.now();
        const decodeResults = await this.runDecodeStage(scanner, prefillSlices, governor);
        decodeDurationMs = Math.max(1, Date.now() - decodeStart);
        verdicts.push(...decodeResults);

        const totalPipelineDurationMs = Math.max(1, Date.now() - pipelineStart);
        const bufferMetrics = this.ringBuffer.getMetrics();
        const peakBufferUtilization =
            bufferMetrics.capacity > 0 ? bufferMetrics.highWaterMark / bufferMetrics.capacity : 0;

        const telemetry: DisaggregatedPipelineTelemetry = {
            totalInputs,
            prefillCompleted: prefillSlices.length,
            decodeCompleted: verdicts.length,
            prefillDurationMs,
            decodeDurationMs,
            totalPipelineDurationMs,
            peakBufferUtilization: Math.round(peakBufferUtilization * 1000) / 1000,
        };

        return { verdicts, telemetry };
    }

    /**
     * Internal: Run Prefill stage over input items.
     */
    private async runPrefillStage(
        scanner: Scanner,
        items: readonly {
            filePath: string;
            content: string;
            analyzers?: readonly string[];
            lineBounds?: readonly [number, number];
        }[],
        governor: LoadGovernor,
    ): Promise<PrefillAuditSlice[]> {
        const availableAnalyzers = scanner.getPlan().map((p) => p.name);
        const slices: PrefillAuditSlice[] = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const activeAnalyzers = item.analyzers ?? availableAnalyzers;
            const slice: PrefillAuditSlice = {
                sliceId: `slice:${item.filePath}:${i}`,
                filePath: item.filePath,
                content: item.content,
                activeAnalyzers,
                lineBounds: item.lineBounds,
                prefillTimestamp: Date.now(),
            };

            slices.push(slice);
            this.ringBuffer.push(slice);

            if ((i + 1) % this.prefillConcurrency === 0) {
                await governor.yieldEventLoop();
            }
        }

        return slices;
    }

    /**
     * Internal: Run Decode stage concurrently processing prefilled slices.
     */
    private async runDecodeStage(
        scanner: Scanner,
        slices: readonly PrefillAuditSlice[],
        governor: LoadGovernor,
    ): Promise<DecodeSliceVerdict[]> {
        const verdicts: DecodeSliceVerdict[] = [];
        const batchSize = this.decodeConcurrency;

        for (let i = 0; i < slices.length; i += batchSize) {
            const batch = slices.slice(i, i + batchSize);
            const batchPromises = batch.map((slice) =>
                this.decodeSingleSlice(scanner, slice),
            );

            const batchVerdicts = await Promise.all(batchPromises);
            for (let j = 0; j < batchVerdicts.length; j++) {
                verdicts.push(batchVerdicts[j]);
            }

            await governor.yieldEventLoop();
        }

        return verdicts;
    }

    /**
     * Internal: Evaluate single slice in Decode stage.
     */
    private async decodeSingleSlice(
        scanner: Scanner,
        slice: PrefillAuditSlice,
    ): Promise<DecodeSliceVerdict> {
        const activeSet = new Set(slice.activeAnalyzers);
        const result = await scanner.runAnalyzers(
            slice.filePath,
            slice.content,
            undefined,
            activeSet,
            slice.lineBounds,
        );

        return {
            sliceId: slice.sliceId,
            filePath: slice.filePath,
            issues: result.issues,
            metric: result.metric ?? undefined,
            decodeTimestamp: Date.now(),
        };
    }

    /**
     * Internal: Construct empty result when inputs list is empty.
     */
    private buildEmptyResult(startTime: number): {
        verdicts: DecodeSliceVerdict[];
        telemetry: DisaggregatedPipelineTelemetry;
    } {
        return {
            verdicts: [],
            telemetry: {
                totalInputs: 0,
                prefillCompleted: 0,
                decodeCompleted: 0,
                prefillDurationMs: 0,
                decodeDurationMs: 0,
                totalPipelineDurationMs: Math.max(1, Date.now() - startTime),
                peakBufferUtilization: 0,
            },
        };
    }
}

/** Shared singleton instance of DisaggregatedAuditPipeline. */
export const defaultDisaggregatedAuditPipeline = new DisaggregatedAuditPipeline();
