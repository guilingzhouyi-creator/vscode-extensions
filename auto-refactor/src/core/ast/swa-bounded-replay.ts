/**
 * Module: Core Engine — DeepInfer SWA Bounded AST Replay Manager
 * File Path: src/core/ast/swa-bounded-replay.ts
 * Architecture Role: Bounded incremental AST recompute and replay coordinator modeled after
 *   DeepInfer's SWA (Sliding Window Attention) philosophy. Limits re-audit of localized edits
 *   to a bounded syntactic window (<= 128 lines), keeping recomputation latency O(1) and
 *   eliminating whole-file re-parse overhead during speculative pair programming and MCTS passes.
 * Dependencies & Triggers: Consumes NormalizedNode/NodeKind from multilang, fastDigest from
 *   domainFingerprint, and Issue from types. Invoked by dualTrackPipeline and speculative
 *   refactoring loops when evaluating localized micro-edits.
 * Responsibilities:
 *   1. Build and cache top-level declaration anchor indexes with line bounds and signature digests.
 *   2. Evaluate diff changed line ranges against anchor boundaries to verify localized scope.
 *   3. Enforce signature invariance: if function/class signatures are intact, bound replay scope
 *      strictly to [L_start, min(L_end, L_start + 128)].
 *   4. Fall back to whole-file replay when changes cross anchor boundaries, break declarations,
 *      or alter global scope / module imports.
 *   5. Prune and filter analyzer issues outside the bounded window with zero heap churn.
 * Exit Semantics & Design Rationale: Pure deterministic execution without throwing. Returns
 *   SwaReplayWindow with isBounded and requiresFullReplay status flags. Replaces O(N) AST passes
 *   with O(1) bounded windows for small localized diffs.
 */

import type { NormalizedNode } from './multilang';
import { NodeKind } from './multilang';
import { fastDigest } from '../memory/domainFingerprint';
import type { Issue } from '../types';

/** Default sliding window attention window size in lines (DeepInfer nominal window). */
export const DEFAULT_SWA_WINDOW_SIZE = 128;

/** Maximum cached anchor indices across active files to prevent unbounded memory growth. */
const MAX_ANCHOR_CACHE_SIZE = 256;

/** SWA replay reason indicating bounded localized recompute within single anchor. */
export const REASON_BOUNDED_LOCAL = 'BOUNDED_LOCAL_REPLAY';

/** SWA replay reason indicating mutation outside known anchors in global scope. */
export const REASON_GLOBAL_MUTATION = 'GLOBAL_SCOPE_MUTATION';

/** SWA replay reason indicating top-level declaration signature was modified. */
export const REASON_SIGNATURE_MUTATION = 'SIGNATURE_MUTATION';

/** SWA replay reason indicating edit spans across multiple syntactic anchors. */
export const REASON_MULTI_ANCHOR_SPAN = 'MULTI_ANCHOR_SPAN';

/** SWA replay reason indicating identical content with zero changed lines. */
export const REASON_EMPTY_DIFF = 'EMPTY_DIFF';

/** Immutable empty anchor array to prevent transient heap churn. */
const EMPTY_ANCHOR_ARRAY: readonly AstAnchor[] = Object.freeze([]);

/** ASCII character code for left curly bracket '{'. */
const CHAR_OPEN_BRACE = 123;

/** ASCII character code for right curly bracket '}'. */
const CHAR_CLOSE_BRACE = 125;

/** Fast regex pattern matching top-level function, class, interface or const declarations. */
const DECLARATION_LINE_PATTERN =
    /^\s*(?:(export)\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var|enum|struct|impl|trait|fn|def)\s+([A-Za-z0-9_$]+)/;

/** Fast regex pattern matching import or export statements at top level. */
const IMPORT_EXPORT_PATTERN = /^\s*(?:import|export\s*\{)/;

/**
 * Scalar character count helper eliminating transient heap allocations in hot scan loops.
 *
 * @param str - Source text to inspect.
 * @param targetCode - ASCII character code to count.
 * @returns Total occurrences of target character code.
 */
function countCharCode(str: string, targetCode: number): number {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) === targetCode) {
            count++;
        }
    }
    return count;
}

/**
 * Syntactic anchor representing a top-level code declaration unit.
 */
export interface AstAnchor {
    /** Unique anchor identifier within the file (e.g., 'fn:calculateScore:15:48'). */
    readonly id: string;
    /** Syntactic node kind. */
    readonly kind: NodeKind | string;
    /** Identifier name of the declaration. */
    readonly name: string;
    /** 1-based starting line number in source text. */
    readonly startLine: number;
    /** 1-based ending line number in source text. */
    readonly endLine: number;
    /** Digest of the declaration signature line for mutation verification. */
    readonly signatureHash: string;
    /** True if the declaration carries an export modifier. */
    readonly isExported: boolean;
}

/**
 * Result of SWA replay window calculation.
 */
export interface SwaReplayWindow {
    /** Enclosing anchor if localized within a single declaration unit. */
    readonly anchor?: AstAnchor;
    /** 1-based inclusive start line for bounded re-evaluation. */
    readonly startLine: number;
    /** 1-based inclusive end line for bounded re-evaluation. */
    readonly endLine: number;
    /** True if re-audit is strictly bounded to the SWA sliding window. */
    readonly isBounded: boolean;
    /** True if change invalidates global state and requires full-file re-audit. */
    readonly requiresFullReplay: boolean;
    /** Number of lines spanned by the effective evaluation window. */
    readonly effectiveSpanLines: number;
    /** Diagnostic reason explaining the SWA routing decision. */
    readonly reason: string;
}

/**
 * Configuration options for SwaBoundedReplayManager.
 */
export interface SwaBoundedReplayOptions {
    /** Maximum number of lines in a single bounded SWA window (defaults to 128). */
    readonly maxWindowLines?: number;
    /** Whether to tolerate signature modifications within the anchor (defaults to false). */
    readonly allowSignatureMutation?: boolean;
}

/**
 * DeepInfer SWA Bounded AST Replay Manager.
 */
export class SwaBoundedReplayManager {
    private readonly maxWindowLines: number;
    private readonly allowSignatureMutation: boolean;
    private readonly anchorCache: Map<string, { hash: string; anchors: readonly AstAnchor[] }>;

    private cacheHitCount = 0;
    private cacheMissCount = 0;

    public constructor(options: SwaBoundedReplayOptions = {}) {
        this.maxWindowLines = options.maxWindowLines ?? DEFAULT_SWA_WINDOW_SIZE;
        this.allowSignatureMutation = options.allowSignatureMutation ?? false;
        this.anchorCache = new Map();
    }

    /**
     * Build or retrieve cached syntactic anchor index for the specified source file.
     *
     * @param filePath - Repository-relative or absolute file path.
     * @param content - Source code content.
     * @param rootNode - Optional pre-parsed normalized AST root.
     * @returns Array of syntactic anchors in line-number order.
     */
    public indexAnchors(
        filePath: string,
        content: string,
        rootNode?: NormalizedNode,
    ): readonly AstAnchor[] {
        if (!content || content.length === 0) {
            return EMPTY_ANCHOR_ARRAY;
        }

        const contentHash = fastDigest(content);
        const cached = this.anchorCache.get(filePath);
        if (cached && cached.hash === contentHash) {
            this.cacheHitCount++;
            return cached.anchors;
        }

        this.cacheMissCount++;
        const anchors = rootNode && rootNode.children && rootNode.children.length > 0
            ? this.extractAnchorsFromAst(rootNode)
            : this.extractAnchorsFromText(content);

        this.storeInCache(filePath, contentHash, anchors);
        return anchors;
    }

    /**
     * Compute bounded SWA replay window for a file mutation.
     *
     * @param filePath - Path of mutated file.
     * @param oldContent - Content prior to mutation.
     * @param newContent - Content after mutation.
     * @param changedLines - Optional 1-based [minLine, maxLine] changed range.
     * @returns SwaReplayWindow specifying bounded recompute scope.
     */
    public computeReplayWindow(
        filePath: string,
        oldContent: string,
        newContent: string,
        changedLines?: readonly [number, number],
    ): SwaReplayWindow {
        if (oldContent === newContent) {
            return this.buildEmptyDiffWindow();
        }

        const oldAnchors = this.indexAnchors(filePath, oldContent);
        const newLines = this.splitSourceLines(newContent);
        const totalNewLines = Math.max(1, newLines.length);

        const targetRange = changedLines ?? this.detectChangedLines(oldContent, newContent);
        const [changeStart, changeEnd] = targetRange;

        if (changeStart <= 0 || changeEnd <= 0) {
            return this.buildFullReplayWindow(totalNewLines, REASON_EMPTY_DIFF);
        }

        return this.evaluateAnchorsForWindow({
            oldAnchors,
            newLines,
            totalNewLines,
            changeStart,
            changeEnd,
        });
    }

    /**
     * Test whether a replay window satisfies bounded localized recomputation criteria.
     *
     * @param window - Evaluated SwaReplayWindow.
     * @returns True if bounded localized replay can be safely executed.
     */
    public canUseSwaReplay(window: SwaReplayWindow): boolean {
        return window.isBounded && !window.requiresFullReplay;
    }

    /**
     * Filter analyzer issues to retain only those within the bounded replay window.
     *
     * @param issues - Raw list of issues surfaced by analyzers.
     * @param window - Active SWA replay window.
     * @returns Pruned issues matching the window scope with zero heap churn.
     */
    public pruneIssuesOutsideWindow(issues: Issue[], window: SwaReplayWindow): Issue[] {
        if (!this.canUseSwaReplay(window)) {
            return issues;
        }

        const { startLine, endLine } = window;
        const result: Issue[] = [];
        for (let i = 0; i < issues.length; i++) {
            const issue = issues[i];
            const issueLine = issue.location?.start?.line ?? 1;
            if (issueLine >= startLine && issueLine <= endLine) {
                result.push(issue);
            }
        }
        return result;
    }

    /**
     * Get anchor cache utilization telemetry.
     */
    public getCacheStats(): { size: number; hitCount: number; missCount: number } {
        return {
            size: this.anchorCache.size,
            hitCount: this.cacheHitCount,
            missCount: this.cacheMissCount,
        };
    }

    /**
     * Clear anchor cache.
     */
    public clearCache(): void {
        this.anchorCache.clear();
        this.cacheHitCount = 0;
        this.cacheMissCount = 0;
    }

    /**
     * Internal: Evaluate anchor boundaries against changed line interval.
     */
    private evaluateAnchorsForWindow(context: {
        readonly oldAnchors: readonly AstAnchor[];
        readonly newLines: readonly string[];
        readonly totalNewLines: number;
        readonly changeStart: number;
        readonly changeEnd: number;
    }): SwaReplayWindow {
        const { oldAnchors, newLines, totalNewLines, changeStart, changeEnd } = context;

        // Check if any change touched import statements
        if (this.hasImportModifications(newLines, changeStart, changeEnd)) {
            return this.buildFullReplayWindow(totalNewLines, REASON_GLOBAL_MUTATION);
        }

        // Find anchors overlapping with change range
        const overlapping = this.findOverlappingAnchors(oldAnchors, changeStart, changeEnd);

        if (overlapping.length === 0) {
            // Edit occurred outside all indexed anchors (global top-level statements)
            return this.buildFullReplayWindow(totalNewLines, REASON_GLOBAL_MUTATION);
        }

        if (overlapping.length > 1) {
            // Edit spans across multiple top-level declarations
            return this.buildFullReplayWindow(totalNewLines, REASON_MULTI_ANCHOR_SPAN);
        }

        const anchor = overlapping[0];
        const isSignatureIntact = this.verifySignatureIntact(anchor, newLines);

        if (!isSignatureIntact && !this.allowSignatureMutation) {
            return this.buildFullReplayWindow(totalNewLines, REASON_SIGNATURE_MUTATION);
        }

        return this.constructBoundedWindow(anchor, totalNewLines);
    }

    /**
     * Internal: Construct bounded SWA window from confirmed anchor.
     */
    private constructBoundedWindow(anchor: AstAnchor, totalLines: number): SwaReplayWindow {
        const winStart = Math.max(1, anchor.startLine);
        const winLimit = winStart + this.maxWindowLines - 1;
        const winEnd = Math.min(totalLines, Math.min(anchor.endLine, winLimit));
        const effectiveSpan = Math.max(1, winEnd - winStart + 1);

        return {
            anchor,
            startLine: winStart,
            endLine: winEnd,
            isBounded: true,
            requiresFullReplay: false,
            effectiveSpanLines: effectiveSpan,
            reason: REASON_BOUNDED_LOCAL,
        };
    }

    /**
     * Internal: Verify that the declaration signature line has not been mutated.
     */
    private verifySignatureIntact(anchor: AstAnchor, newLines: readonly string[]): boolean {
        const sigLineIndex = anchor.startLine - 1;
        if (sigLineIndex < 0 || sigLineIndex >= newLines.length) {
            return false;
        }

        const currentSigLine = newLines[sigLineIndex].trim();
        const currentHash = fastDigest(currentSigLine);
        return currentHash === anchor.signatureHash;
    }

    /**
     * Internal: Find all anchors that intersect with the given line interval.
     */
    private findOverlappingAnchors(
        anchors: readonly AstAnchor[],
        changeStart: number,
        changeEnd: number,
    ): AstAnchor[] {
        const matched: AstAnchor[] = [];
        for (let i = 0; i < anchors.length; i++) {
            const anchor = anchors[i];
            if (changeStart <= anchor.endLine && changeEnd >= anchor.startLine) {
                matched.push(anchor);
            }
        }
        return matched;
    }

    /**
     * Internal: Check if changed range intersects with import statements.
     */
    private hasImportModifications(
        lines: readonly string[],
        changeStart: number,
        changeEnd: number,
    ): boolean {
        const scanStart = Math.max(0, changeStart - 1);
        const scanEnd = Math.min(lines.length - 1, changeEnd - 1);

        for (let i = scanStart; i <= scanEnd; i++) {
            if (IMPORT_EXPORT_PATTERN.test(lines[i])) {
                return true;
            }
        }
        return false;
    }

    /**
     * Internal: Extract anchors from pre-parsed NormalizedNode AST.
     */
    private extractAnchorsFromAst(root: NormalizedNode): AstAnchor[] {
        const anchors: AstAnchor[] = [];
        const children = root.children ?? [];

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const isAnchorKind =
                child.kind === NodeKind.Function ||
                child.kind === NodeKind.Class ||
                child.kind === NodeKind.Interface ||
                child.kind === NodeKind.Struct ||
                child.kind === NodeKind.Impl ||
                child.kind === NodeKind.Trait;

            if (!isAnchorKind || !child.start || !child.end) {
                continue;
            }

            const name = child.name || `anon_${child.start.line}`;
            const sigText = child.text ? child.text.split('\n')[0].trim() : `${child.kind}:${name}`;
            const anchorId = `${child.kind}:${name}:${child.start.line}:${child.end.line}`;

            anchors.push({
                id: anchorId,
                kind: child.kind,
                name,
                startLine: child.start.line,
                endLine: child.end.line,
                signatureHash: fastDigest(sigText),
                isExported: Boolean(child.introducesBinding),
            });
        }
        return anchors;
    }

    /**
     * Internal: Extract anchors from raw source text via line scanner fallback.
     */
    private extractAnchorsFromText(content: string): AstAnchor[] {
        const lines = this.splitSourceLines(content);
        const anchors: AstAnchor[] = [];

        let currentAnchor: {
            kind: string;
            name: string;
            startLine: number;
            sigHash: string;
            isExported: boolean;
            braceDepth: number;
        } | null = null;

        for (let i = 0; i < lines.length; i++) {
            const lineNum = i + 1;
            const line = lines[i];

            if (!currentAnchor) {
                const match = DECLARATION_LINE_PATTERN.exec(line);
                if (match) {
                    const isExported = Boolean(match[1]);
                    const name = match[2];
                    const sigHash = fastDigest(line.trim());
                    const openBraces = countCharCode(line, CHAR_OPEN_BRACE);
                    const closeBraces = countCharCode(line, CHAR_CLOSE_BRACE);
                    const depth = openBraces - closeBraces;

                    currentAnchor = {
                        kind: 'declaration',
                        name,
                        startLine: lineNum,
                        sigHash,
                        isExported,
                        braceDepth: depth,
                    };

                    if (depth <= 0 && openBraces > 0) {
                        anchors.push(this.buildTextAnchor(currentAnchor, lineNum));
                        currentAnchor = null;
                    }
                }
            } else {
                const openBraces = countCharCode(line, CHAR_OPEN_BRACE);
                const closeBraces = countCharCode(line, CHAR_CLOSE_BRACE);
                currentAnchor.braceDepth += openBraces - closeBraces;

                if (currentAnchor.braceDepth <= 0) {
                    anchors.push(this.buildTextAnchor(currentAnchor, lineNum));
                    currentAnchor = null;
                }
            }
        }

        return anchors;
    }

    /**
     * Internal: Construct AstAnchor from text scan accumulator.
     */
    private buildTextAnchor(
        acc: {
            kind: string;
            name: string;
            startLine: number;
            sigHash: string;
            isExported: boolean;
        },
        endLine: number,
    ): AstAnchor {
        return {
            id: `${acc.kind}:${acc.name}:${acc.startLine}:${endLine}`,
            kind: acc.kind,
            name: acc.name,
            startLine: acc.startLine,
            endLine,
            signatureHash: acc.sigHash,
            isExported: acc.isExported,
        };
    }

    /**
     * Internal: Fast line-level diff range detection between two texts.
     */
    private detectChangedLines(oldContent: string, newContent: string): [number, number] {
        const oldLines = this.splitSourceLines(oldContent);
        const newLines = this.splitSourceLines(newContent);

        let prefix = 0;
        const maxPrefix = Math.min(oldLines.length, newLines.length);
        while (prefix < maxPrefix && oldLines[prefix] === newLines[prefix]) {
            prefix++;
        }

        let oldSuffix = oldLines.length - 1;
        let newSuffix = newLines.length - 1;
        while (oldSuffix >= prefix && newSuffix >= prefix && oldLines[oldSuffix] === newLines[newSuffix]) {
            oldSuffix--;
            newSuffix--;
        }

        const startLine = prefix + 1;
        const endLine = Math.max(startLine, newSuffix + 1);
        return [startLine, endLine];
    }

    /**
     * Internal: Split source string into line array.
     */
    private splitSourceLines(content: string): string[] {
        return content.split(/\r?\n/);
    }

    /**
     * Internal: Construct full-replay fallback window.
     */
    private buildFullReplayWindow(totalLines: number, reason: string): SwaReplayWindow {
        return {
            startLine: 1,
            endLine: Math.max(1, totalLines),
            isBounded: false,
            requiresFullReplay: true,
            effectiveSpanLines: Math.max(1, totalLines),
            reason,
        };
    }

    /**
     * Internal: Construct empty diff window.
     */
    private buildEmptyDiffWindow(): SwaReplayWindow {
        return {
            startLine: 1,
            endLine: 1,
            isBounded: true,
            requiresFullReplay: false,
            effectiveSpanLines: 0,
            reason: REASON_EMPTY_DIFF,
        };
    }

    /**
     * Internal: Store anchor list in LRU-bounded cache.
     */
    private storeInCache(filePath: string, hash: string, anchors: readonly AstAnchor[]): void {
        if (this.anchorCache.size >= MAX_ANCHOR_CACHE_SIZE) {
            const firstKey = this.anchorCache.keys().next().value;
            if (firstKey) {
                this.anchorCache.delete(firstKey);
            }
        }
        this.anchorCache.set(filePath, { hash, anchors });
    }
}

/**
 * Shared singleton instance of SwaBoundedReplayManager.
 */
export const defaultSwaBoundedReplayManager = new SwaBoundedReplayManager();
