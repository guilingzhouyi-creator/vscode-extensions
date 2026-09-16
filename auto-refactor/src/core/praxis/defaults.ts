/**
 * Module: Core Engine — Default High-Performance Praxis SPI Implementations
 * File Path: src/core/praxis/defaults.ts
 * Architecture Role: Runtime fallback layer for the Praxis SPI; supplies concrete
 *   in-process implementations when an embedding host injects no custom plugins.
 * Dependencies & Triggers: Imports only type contracts from `./contracts` (erased at
 *   runtime); loaded via the `./index` barrel or a direct import, and triggered when a
 *   default class is instantiated or `createDefaultPraxisHooks()` is called.
 * Responsibilities: Return the `card-default`/`cell-0`/`agent-build-local` attribution;
 *   derive an enclosing symbol from a hunk header and suggest `rework` above 50 hunk lines
 *   else `auto_fix`; classify non-context line counts as major L3A escalation above 100,
 *   minor fix above 30, else passed; keep a 500-hunk in-memory buffer with oldest-first
 *   eviction, no-op snapshot flush, and `Date.now()` archive ids; provide optimistic
 *   rollback/merge gate stubs; and assemble all five hooks into one bundle.
 * Exit Semantics & Design Rationale: Constructors and methods are synchronous and
 *   side-effect-light, never throw, and choose safe fallback or optimistic values with
 *   state held only in process memory, so auto-refactor runs without external services.
 *
 * Used out-of-the-box by auto-refactor when no custom Praxis plugins are injected.
 */

import type {
    PraxisCardContext,
    IPraxisAttributionResolver,
    IPraxisContextEnricher,
    IPraxisThresholdPolicy,
    IPraxisHumanFaceStorage,
    IPraxisRollbackGatekeeper,
    ReviewDiffHunk,
    PraxisEnrichedContext,
    PraxisVerdict,
    PraxisPluginHooks,
} from './contracts';

/**
 * Hunk length (in diff lines) above which the default enricher suggests `rework` instead of
 * `auto_fix`.
 */
const HUNK_REWORK_LINE_THRESHOLD = 50;

/**
 * Default largest non-context change count that still passes without a `minor_fix_needed`
 * verdict.
 */
const DEFAULT_MAX_MINOR_LINES = 30;

/**
 * Default change count above which the threshold policy demands major rework and L3A escalation.
 */
const DEFAULT_AUTO_ESCALATE_LINES = 100;

/**
 * Default number of hunks retained by the in-memory human-face storage before oldest-first
 * eviction.
 */
const DEFAULT_HUMAN_FACE_MAX_CAPACITY = 500;

/**
 * Default attribution resolver returning a local fallback context.
 *
 * Used when a host injects no attribution SPI. `resolveAttribution` is synchronous, stateless,
 * and always returns a fresh plain object, so one instance is reentrant and safe to share across
 * files or concurrent calls.
 */
export class DefaultPraxisAttributionResolver implements IPraxisAttributionResolver {
    /**
     * Resolve the attribution for a reviewed file and line span.
     *
     * @param _filePath - Repository-relative path of the reviewed file; unused because the default
     *   resolver has no host card registry to query.
     * @param _lineSpan - One-based start and end line of the reviewed hunk; unused for the same
     *   reason.
     * @param _lineSpan.startLine - First line of the reviewed span; unused by the default resolver.
     * @param _lineSpan.endLine - Last line of the reviewed span; unused by the default resolver.
     * @returns A fresh context identifying `card-default`, `cell-0`, and `agent-build-local`;
     *   callers may mutate it without affecting later calls.
     */
    resolveAttribution(
        _filePath: string,
        _lineSpan: { startLine: number; endLine: number },
    ): PraxisCardContext | null {
        return {
            cardId: 'card-default',
            cellId: 'cell-0',
            agentUid: 'agent-build-local',
        };
    }
}

/**
 * Default contextual enricher extracting standard scope heuristics.
 *
 * It derives the enclosing symbol from the hunk header and suggests `rework` for hunks longer than
 * 50 lines, otherwise `auto_fix`. Calls are synchronous, deterministic, and keep no state.
 */
export class DefaultPraxisContextEnricher implements IPraxisContextEnricher {
    /**
     * Enrich a hunk with the heuristic context available without AST or LSP services.
     *
     * @param _filePath - Repository-relative path of the reviewed file; accepted for SPI parity
     *   but not read by the default heuristic.
     * @param hunk - Diff hunk whose header and line count drive the result.
     * @returns Context with `enclosingSymbol` parsed from the header (undefined when empty) and
     *   `suggestedAction` set to `rework` for more than 50 lines, otherwise `auto_fix`.
     */
    enrichHunk(_filePath: string, hunk: ReviewDiffHunk): PraxisEnrichedContext {
        return {
            enclosingSymbol: hunk.header.replace(/^@@.*@@\s*/, '') || undefined,
            suggestedAction: hunk.lines.length > HUNK_REWORK_LINE_THRESHOLD ? 'rework' : 'auto_fix',
        };
    }
}

/**
 * Default threshold policy based on line count and severity thresholds.
 *
 * The policy counts non-context diff lines and compares them with the two constructor bounds:
 * counts above `autoEscalateLines` become major L3A escalation, counts above `maxMinorLines`
 * become minor fixes, and everything else passes. Evaluation is synchronous and stateless.
 */
export class DefaultPraxisThresholdPolicy implements IPraxisThresholdPolicy {
    /**
     * Configure the two review bounds used by `evaluateChange`.
     *
     * @param maxMinorLines - Largest non-context change count that still passes; larger counts
     *   become `minor_fix_needed`. Defaults to 30.
     * @param autoEscalateLines - Change count above which the verdict becomes
     *   `major_rework_needed` and asks for L3A escalation. Defaults to 100.
     */
    constructor(
        private readonly maxMinorLines: number = DEFAULT_MAX_MINOR_LINES,
        private readonly autoEscalateLines: number = DEFAULT_AUTO_ESCALATE_LINES,
    ) {}

    /**
     * Classify a hunk by its non-context change volume.
     *
     * @param _filePath - Repository-relative path of the reviewed file; accepted for SPI parity
     *   but not used by the count-only policy.
     * @param hunk - Hunk whose inserted and deleted lines are counted.
     * @param _context - Enriched context accepted for SPI parity; the default policy ignores it.
     * @returns A `passed` verdict for counts up to `maxMinorLines`, `minor_fix_needed` above it,
     *   and `major_rework_needed` with `shouldEscalateToL3A` above `autoEscalateLines`.
     */
    evaluateChange(
        _filePath: string,
        hunk: ReviewDiffHunk,
        _context: PraxisEnrichedContext,
    ): PraxisVerdict {
        const changeCount = hunk.lines.filter((l) => l.type !== 'context').length;
        if (changeCount > this.autoEscalateLines) {
            return {
                status: 'major_rework_needed',
                isMajorChange: true,
                shouldEscalateToL3A: true,
                violations: [
                    `Change size of ${changeCount} lines exceeds threshold ${this.autoEscalateLines}`,
                ],
            };
        }
        if (changeCount > this.maxMinorLines) {
            return {
                status: 'minor_fix_needed',
                isMajorChange: false,
                shouldEscalateToL3A: false,
            };
        }
        return {
            status: 'passed',
            isMajorChange: false,
            shouldEscalateToL3A: false,
        };
    }
}

/**
 * Default in-memory human-facing storage buffer.
 *
 * Keeps at most `maxCapacity` hunks with oldest-first eviction, provides a no-op snapshot flush,
 * and mints process-local archive ids prefixed with `r4-evicted-` without external I/O. The
 * implementation is synchronous and keeps all state in the instance, so it is not intended for
 * concurrent mutation from multiple threads.
 */
export class DefaultPraxisHumanFaceStorage implements IPraxisHumanFaceStorage {
    private readonly buffer: ReviewDiffHunk[] = [];
    private readonly maxCapacity: number;

    /**
     * Create an empty in-memory buffer.
     *
     * @param maxCapacity - Number of hunks retained before the oldest is shifted out. Defaults to
     *   500; callers should pass a positive value because the constructor performs no validation.
     */
    constructor(maxCapacity: number = DEFAULT_HUMAN_FACE_MAX_CAPACITY) {
        this.maxCapacity = maxCapacity;
    }

    /**
     * Append a hunk, evicting the oldest entry first when the buffer is at capacity.
     *
     * @param chunk - Hunk stored by reference; callers should not mutate it while the buffer may
     *   expose it through `getSnapshot`.
     */
    appendDiffChunk(chunk: ReviewDiffHunk): void {
        if (this.buffer.length >= this.maxCapacity) {
            this.buffer.shift(); // Evict oldest
        }
        this.buffer.push(chunk);
    }

    /**
     * Accept a periodic snapshot request without persisting anything.
     *
     * The default storage is process-memory only, so this hook is deliberately a no-op that exists
     * to satisfy the SPI contract.
     */
    flushPeriodicSnapshot(): void {
        // In-memory snapshot flush baseline
    }

    /**
     * Return a placeholder archive id for an evicted payload.
     *
     * @param _evictedPayload - UTF-8 JSON bytes produced by `CircularDiffBuffer`; accepted to
     *   satisfy the SPI but discarded because default storage has no R4 backend.
     * @returns An object whose `archiveId` combines `r4-evicted-` with the current epoch
     *   milliseconds; the payload is not copied or retained.
     */
    evictToR4Archive(_evictedPayload: Uint8Array): { archiveId: string } {
        return { archiveId: `r4-evicted-${Date.now()}` };
    }

    /**
     * Read the retained hunks in insertion order.
     *
     * @returns A shallow copy of the internal array; adding or removing elements from the result
     *   does not affect the buffer, though the hunk objects themselves are shared.
     */
    getSnapshot(): ReviewDiffHunk[] {
        return [...this.buffer];
    }
}

/**
 * Default gatekeeper and rollback engine.
 *
 * Provides optimistic in-process fallbacks: rollbacks report success with an empty patch, task
 * rollback reports no affected files or checkpoints, and merge gates approve unconditionally.
 * Methods are synchronous and stateless, and they do not touch Git or the filesystem.
 */
export class DefaultPraxisRollbackGatekeeper implements IPraxisRollbackGatekeeper {
    /**
     * Report a successful revert without producing a patch.
     *
     * @param _filePath - Repository-relative path of the file to revert; unused by the optimistic
     *   default because no file is actually written.
     * @param _hunkId - Identifier of the hunk to revert; unused for the same reason.
     * @returns `{ success: true, patch: '' }` so callers can continue down the optimistic path.
     */
    revertDiffHunk(_filePath: string, _hunkId: string): { success: boolean; patch: string } {
        return { success: true, patch: '' };
    }

    /**
     * Report a successful task-card rollback without mutating storage.
     *
     * @param _cardId - Task card identifier; unused because the default owns no checkpoints.
     * @returns Empty `affectedFiles` and `rolledBackCheckpoints` arrays for serialization parity.
     */
    revertTaskCard(_cardId: string): { affectedFiles: string[]; rolledBackCheckpoints: string[] } {
        return { affectedFiles: [], rolledBackCheckpoints: [] };
    }

    /**
     * Approve a merge gate without inspecting the payload.
     *
     * @param _sourceBranch - Name of the source branch; accepted for SPI parity, unused.
     * @param _targetBranch - Name of the target branch; accepted for SPI parity, unused.
     * @param _diffPayload - Diff hunks to evaluate; accepted for SPI parity, unused.
     * @returns `{ approved: true }` with no reason or violations, so default consumers never block.
     */
    checkMergeGate(
        _sourceBranch: string,
        _targetBranch: string,
        _diffPayload: ReviewDiffHunk[],
    ): { approved: boolean; reason?: string; violations?: string[] } {
        return { approved: true };
    }
}

/**
 * Create a standard default Praxis hook bundle.
 *
 * Each call constructs fresh hook instances, so callers that need isolation can call this again
 * instead of sharing the object returned by a previous invocation. The bundle touches no network
 * or filesystem services, but the in-memory human-storage instance does retain chunks across
 * calls.
 *
 * @returns A bundle containing one instance of each of the five default SPI implementations;
 *   every optional property is present so consumers can call it without a null check.
 */
export function createDefaultPraxisHooks(): PraxisPluginHooks {
    return {
        attributionResolver: new DefaultPraxisAttributionResolver(),
        contextEnricher: new DefaultPraxisContextEnricher(),
        thresholdPolicy: new DefaultPraxisThresholdPolicy(),
        humanStorage: new DefaultPraxisHumanFaceStorage(),
        rollbackGatekeeper: new DefaultPraxisRollbackGatekeeper(),
    };
}
