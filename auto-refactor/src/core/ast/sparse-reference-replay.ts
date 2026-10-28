/**
 * Module: Core Engine — Sparse Reference Replay Planner (Bounded Working Set)
 * File Path: src/core/ast/sparse-reference-replay.ts
 * Architecture Role: Planner-level upgrade over the bounded sliding-window replay manager. Where
 *   the
 *   base manager degrades to whole-file replay on signature, import or cross-anchor mutations, this
 *   planner keeps a constant-size working set by widening the window to a compound anchor span or
 *   by attaching a bounded reference set gathered from the call sites of the mutated symbol.
 * Dependencies & Triggers: Composes SwaBoundedReplayManager from ./swa-bounded-replay and the
 *   AstAnchor/SwaReplayWindow/REASON_* contracts; invoked by Praxis slice audit and speculative
 *   refactoring loops through the defaultSparseReferenceReplayManager singleton.
 * Responsibilities:
 *   1. Delegate baseline window computation to the bounded manager unchanged.
 *   2. Promote multi-anchor edits into a compound window when the merged span fits the cap.
 *   3. Promote signature mutations into a bounded anchor window plus a sparse reference set.
 *   4. Report every remaining degradation honestly instead of pretending the replay was bounded.
 * Exit Semantics & Design Rationale: Pure and synchronous, never throws. Compound promotion only
 *   happens when the merged span stays inside the configured cap, because a compound window that
 *   silently covers the whole file is a full replay wearing a bounded label. Import mutations stay
 *   full replay on purpose: an import edit changes module resolution for the entire file, and no
 *   bounded window can prove otherwise. A signature mutation is different — the failed window is
 *   still one declaration, and the external blast radius is exactly what a sparse reference set can
 *   capture, so the planner bounds the window and names the references instead of re-reading the
 *   repository. When the symbol has no external callers the window is still bounded, but it reports
 *   REASON_BOUNDED_SIGNATURE_LOCAL and no bridge flag: nothing external was consulted.
 */

import type { AstAnchor, SwaBoundedReplayManager, SwaReplayWindow } from './swa-bounded-replay';
import type { NormalizedNode } from './multilang';
import type { Issue } from '../types';
import type { CodeDensityMetrics } from '../intelligence/code-density-analyzer';
import {
    REASON_MULTI_ANCHOR_SPAN,
    REASON_SIGNATURE_MUTATION,
    defaultSwaBoundedReplayManager,
} from './swa-bounded-replay';

/** Reason tag for a bounded window that merged several adjacent anchors into one span. */
export const REASON_COMPOUND_ANCHOR_WINDOW = 'COMPOUND_ANCHOR_WINDOW';

/** Reason tag for a bounded window that carries a sparse reference set for a mutated signature. */
export const REASON_SPARSE_BRIDGED_SIGNATURE = 'SPARSE_BRIDGED_SIGNATURE';

/**
 * Reason tag for a bounded window limited to the mutated declaration when the symbol has no
 * external callers. Nothing outside the declaration can be stale, so no reference set is needed —
 * but the window must not claim to be bridged, because no external context was consulted.
 */
export const REASON_BOUNDED_SIGNATURE_LOCAL = 'BOUNDED_SIGNATURE_LOCAL';

/** Default number of external call sites retained as sparse references. */
export const DEFAULT_MAX_SPARSE_REFERENCES = 32;

/** Default cap, in lines, for a compound anchor window. */
export const DEFAULT_MAX_COMPOUND_WINDOW_LINES = 256;

/** Baseline effective code density used to calibrate adaptive window capacity. */
export const BASELINE_EFFECTIVE_DENSITY = 0.65;

/** Minimum safe bound for density-calibrated window capacity. */
export const MIN_ADAPTIVE_WINDOW_CAP = 64;

/** Maximum safe bound for density-calibrated window capacity. */
export const MAX_ADAPTIVE_WINDOW_CAP = 512;

/** Immutable empty reference array reused for every non-bridged window. */
const EMPTY_REFERENCES: readonly SparseReferenceAnchor[] = Object.freeze([]);

/** One external call site kept alive as sparse context for a mutated declaration. */
export interface SparseReferenceAnchor {
    /** File owning the call site. */
    readonly file: string;
    /** 1-based line of the call site inside `file`. */
    readonly line: number;
    /** Enclosing declaration of the call site, or null when it could not be attributed. */
    readonly caller: string | null;
    /** Declared symbol the call site targets. */
    readonly symbol: string;
}

/**
 * Resolve the most significant external call sites of a symbol.
 *
 * @param symbol - Declared name whose signature changed.
 * @param limit - Maximum number of references the planner keeps.
 * @returns At most `limit` references, ordered by the resolver's own significance rule.
 */
export type SparseReferenceResolver = (
    symbol: string,
    limit: number,
) => readonly SparseReferenceAnchor[];

/** Baseline replay window extended with the sparse reference set that justifies it. */
export interface SparseReplayWindow extends SwaReplayWindow {
    /** External call sites retained as bounded context, empty when no bridging happened. */
    readonly sparseReferences: readonly SparseReferenceAnchor[];
    /** True when a sparse reference set replaced a whole-file replay. */
    readonly isSparseBridged: boolean;
}

/** Input for one sparse reference replay decision. */
export interface SparseReplayRequest {
    /** Repository-relative or absolute file path. */
    readonly filePath: string;
    /** Content before the mutation. */
    readonly oldContent: string;
    /** Content after the mutation. */
    readonly newContent: string;
    /** Optional 1-based [first, last] changed line range supplied by the diff producer. */
    readonly changedLines?: readonly [number, number];
    /** Optional resolver supplying external call sites for a mutated signature. */
    readonly resolveReferences?: SparseReferenceResolver;
    /** Optional pre-parsed normalized AST root for newContent. */
    readonly rootNode?: NormalizedNode;
    /** Optional code density metrics to dynamically calibrate window capacity. */
    readonly density?: CodeDensityMetrics;
}

/**
 * Calibrate an adaptive window line capacity based on code density metrics.
 *
 * When code density is high (dense logic, few comments/blanks), physical lines carry higher
 * cognitive and semantic payload, so the window cap scales down toward MIN_ADAPTIVE_WINDOW_CAP.
 * When density is low (well-documented, spaced formatting, template/data), physical lines are
 * sparser and the window comfortably expands toward MAX_ADAPTIVE_WINDOW_CAP without exceeding
 * token and analyzer complexity budgets.
 *
 * @param density - Code density metrics, or undefined to use defaultCap directly.
 * @param defaultCap - Fallback capacity in lines (defaults to DEFAULT_MAX_COMPOUND_WINDOW_LINES).
 * @returns Calibrated window cap clamped between MIN_ADAPTIVE_WINDOW_CAP and
 *   MAX_ADAPTIVE_WINDOW_CAP.
 */
export function resolveWindowCap(
    density?: CodeDensityMetrics,
    defaultCap: number = DEFAULT_MAX_COMPOUND_WINDOW_LINES,
): number {
    if (
        !density ||
        typeof density.effectiveDensity !== 'number' ||
        Number.isNaN(density.effectiveDensity)
    ) {
        return defaultCap;
    }
    const clampedDensity = Math.max(0.2, Math.min(0.95, density.effectiveDensity));
    const scalingFactor = BASELINE_EFFECTIVE_DENSITY / clampedDensity;
    const minCap = Math.min(defaultCap, MIN_ADAPTIVE_WINDOW_CAP);
    const maxCap = Math.max(defaultCap, MAX_ADAPTIVE_WINDOW_CAP);
    const computed = Math.round(defaultCap * scalingFactor);
    return Math.max(minCap, Math.min(computed, maxCap));
}

/** Tuning knobs for the sparse reference planner. */
export interface SparseReplayOptions {
    /** Maximum lines a compound anchor window may span (defaults to 256). */
    readonly maxCompoundWindowLines?: number;
    /** Maximum sparse references retained per bridged window (defaults to 32). */
    readonly maxSparseReferences?: number;
}

/** Outcome of anchor selection for one changed line range. */
interface AnchorSelection {
    /** Anchors intersecting the changed range, in source order. */
    readonly anchors: readonly AstAnchor[];
}

/**
 * Sparse reference planner keeping the replay working set constant across degenerate diff shapes.
 */
export class SparseReferenceReplayManager {
    private readonly swa: SwaBoundedReplayManager;

    private readonly maxCompoundWindowLines: number;

    private readonly maxSparseReferences: number;

    public constructor(
        swa: SwaBoundedReplayManager = defaultSwaBoundedReplayManager,
        options: SparseReplayOptions = {},
    ) {
        this.swa = swa;
        this.maxCompoundWindowLines =
            options.maxCompoundWindowLines ?? DEFAULT_MAX_COMPOUND_WINDOW_LINES;
        this.maxSparseReferences = options.maxSparseReferences ?? DEFAULT_MAX_SPARSE_REFERENCES;
    }

    /**
     * Compute the replay window, promoting degenerate diff shapes that stay small.
     *
     * @param request - Mutation contents, changed range and optional reference resolver.
     * @returns Bounded window; `isSparseBridged` marks windows saved by sparse references.
     */
    public computeSparseReplayWindow(request: SparseReplayRequest): SparseReplayWindow {
        const base = this.swa.computeReplayWindow(
            request.filePath,
            request.oldContent,
            request.newContent,
            request.changedLines,
            request.rootNode,
        );
        if (this.swa.canUseSwaReplay(base)) {
            return this.asPlainWindow(base);
        }
        if (base.reason === REASON_MULTI_ANCHOR_SPAN) {
            return this.promoteCompoundSpan(base, request);
        }
        if (base.reason === REASON_SIGNATURE_MUTATION) {
            return this.promoteSignature(base, request);
        }
        return this.asPlainWindow(base);
    }

    /**
     * Base-manager delegate: anchors of a file, cached by the underlying manager.
     *
     * @param filePath - File whose top-level declarations are indexed.
     * @param content - Source text to index.
     * @param rootNode - Optional pre-parsed normalized AST root.
     * @returns Anchors in line order.
     */
    public indexAnchors(
        filePath: string,
        content: string,
        rootNode?: NormalizedNode,
    ): readonly AstAnchor[] {
        return this.swa.indexAnchors(filePath, content, rootNode);
    }

    /**
     * Base-manager delegate: whether a window permits bounded localized replay.
     *
     * @param window - Window to test.
     * @returns True when the window is bounded and needs no full replay.
     */
    public canUseSparseReplay(window: SparseReplayWindow): boolean {
        return window.isBounded && !window.requiresFullReplay;
    }

    /**
     * Base-manager delegate: keep only issues inside the window (all issues for full replay).
     *
     * @param issues - Analyzer issues to prune.
     * @param window - Active replay window.
     * @returns Issues whose start line sits inside the window.
     */
    public pruneIssuesOutsideWindow(issues: Issue[], window: SparseReplayWindow): Issue[] {
        return this.swa.pruneIssuesOutsideWindow(issues, window);
    }

    /**
     * Resolve an adaptive window cap based on density metrics and the manager's compound cap.
     *
     * @param density - Optional code density metrics.
     * @param defaultCap - Optional fallback cap overriding this manager's compound window cap.
     * @returns Calibrated window cap.
     */
    public resolveWindowCap(density?: CodeDensityMetrics, defaultCap?: number): number {
        return resolveWindowCap(density, defaultCap ?? this.maxCompoundWindowLines);
    }

    /** Wrap a base window with an empty reference set and no bridging flag. */
    private asPlainWindow(base: SwaReplayWindow): SparseReplayWindow {
        return { ...base, sparseReferences: EMPTY_REFERENCES, isSparseBridged: false };
    }

    /**
     * Merge adjacent anchors touched by the change into one window when the span fits the cap.
     *
     * @param base - Baseline full-replay window produced by the bounded manager.
     * @param request - Original request carrying the changed range.
     * @returns Compound bounded window, or the untouched full-replay window when the span is large.
     */
    private promoteCompoundSpan(
        base: SwaReplayWindow,
        request: SparseReplayRequest,
    ): SparseReplayWindow {
        const range = request.changedLines;
        if (!range) return this.asPlainWindow(base);
        const selection = this.selectAnchors(
            request.filePath,
            request.oldContent,
            range,
            request.rootNode,
        );
        if (selection.anchors.length < 2) return this.asPlainWindow(base);

        const spanStart = selection.anchors[0].startLine;
        const spanEnd = selection.anchors[selection.anchors.length - 1].endLine;
        const spanLines = spanEnd - spanStart + 1;
        const effectiveCap = this.resolveWindowCap(request.density);
        if (spanLines > effectiveCap) return this.asPlainWindow(base);

        return {
            startLine: spanStart,
            endLine: spanEnd,
            isBounded: true,
            requiresFullReplay: false,
            effectiveSpanLines: spanLines,
            reason: REASON_COMPOUND_ANCHOR_WINDOW,
            sparseReferences: EMPTY_REFERENCES,
            isSparseBridged: false,
        };
    }

    /**
     * Bound a signature mutation to its own declaration and attach the external call sites.
     *
     * @param base - Baseline full-replay window carrying the mutated anchor.
     * @param request - Original request carrying the resolver.
     * @returns Bridged bounded window when a single anchor and resolver exist.
     */
    private promoteSignature(
        base: SwaReplayWindow,
        request: SparseReplayRequest,
    ): SparseReplayWindow {
        const anchor = base.anchor;
        if (!anchor || !request.resolveReferences) return this.asPlainWindow(base);

        const anchorSpan = anchor.endLine - anchor.startLine + 1;
        const effectiveCap = this.resolveWindowCap(request.density);
        let startLine = anchor.startLine;
        let endLine = anchor.endLine;

        if (anchorSpan > effectiveCap) {
            // Anchor itself exceeds compound window budget: apply centered shift around signature
            const targetSpan = effectiveCap;
            const sigLine = request.changedLines ? request.changedLines[0] : anchor.startLine;
            const idealStart = sigLine - Math.floor(targetSpan / 2);
            startLine = Math.max(
                anchor.startLine,
                Math.min(idealStart, anchor.endLine - targetSpan + 1),
            );
            endLine = Math.min(anchor.endLine, startLine + targetSpan - 1);
        }

        const references = request
            .resolveReferences(anchor.name, this.maxSparseReferences)
            .slice(0, this.maxSparseReferences);

        return {
            anchor,
            startLine,
            endLine,
            isBounded: true,
            requiresFullReplay: false,
            effectiveSpanLines: Math.max(1, endLine - startLine + 1),
            reason:
                references.length > 0
                    ? REASON_SPARSE_BRIDGED_SIGNATURE
                    : REASON_BOUNDED_SIGNATURE_LOCAL,
            sparseReferences: references,
            isSparseBridged: references.length > 0,
        };
    }

    /**
     * Select the indexed anchors that intersect a changed line range.
     *
     * @param filePath - File owning the anchors.
     * @param oldContent - Pre-mutation content used to rebuild the anchor index.
     * @param range - 1-based [first, last] changed line range.
     * @param rootNode - Optional pre-parsed normalized AST root.
     * @returns Anchors intersecting the range, in source order.
     */
    private selectAnchors(
        filePath: string,
        oldContent: string,
        range: readonly [number, number],
        rootNode?: NormalizedNode,
    ): AnchorSelection {
        const [rangeStart, rangeEnd] = range;
        const anchors = this.swa.indexAnchors(filePath, oldContent, rootNode);
        const intersecting: AstAnchor[] = [];
        for (let i = 0; i < anchors.length; i++) {
            const anchor = anchors[i];
            if (rangeStart <= anchor.endLine && rangeEnd >= anchor.startLine) {
                intersecting.push(anchor);
            }
        }
        return { anchors: intersecting };
    }
}

/** Shared planner instance used when a caller has no reason to tune the caps. */
export const defaultSparseReferenceReplayManager = new SparseReferenceReplayManager();
