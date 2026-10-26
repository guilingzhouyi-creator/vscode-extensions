/**
 * Module: Core Engine — SGLang RadixAttention AST Prefix Tree Cache
 * File Path: src/core/ast/ast-prefix-radix-cache.ts
 * Architecture Role: Multi-way Radix prefix tree cache modeled after SGLang's RadixAttention
 *   KV-cache sharing. Caches tokenized source code prefixes (e.g. common imports, framework
 *   scaffolding, standard type declarations) and maps them to pre-parsed NormalizedNode subtrees
 *   and symbol bindings to accelerate multi-file batch scanning throughput.
 * Dependencies & Triggers: Consumes NormalizedNode and NodeKind from multilang, and fastDigest
 *   from domainFingerprint. Invoked during file parsing and scanner preflight passes.
 * Responsibilities:
 *   1. Tokenize and normalize source code prefixes into canonical line chunks.
 *   2. Maintain an in-memory multi-way Radix prefix tree with bounded memory and LRU eviction.
 *   3. Execute Longest Common Prefix (LCP) matching against candidate source files.
 *   4. Reuse verified AST subtrees and imported symbol lists when prefix match length >= K.
 *   5. Provide telemetry on prefix cache hits, LCP depth, and parser cycle savings.
 * Exit Semantics & Design Rationale: Deterministic zero-throw operation. Yields
 *   RadixPrefixMatchResult. Bypasses repetitive lexical and syntactic parsing across files sharing
 *   common header imports.
 */

import type { NormalizedNode } from './multilang';
import { fastDigest } from '../memory/domainFingerprint';

/** Default minimum matching lines required to trigger AST subtree reuse. */
export const DEFAULT_MIN_MATCH_LINES = 3;

/** Default maximum prefix lines inspected at the beginning of a file. */
export const DEFAULT_MAX_PREFIX_SCAN_LINES = 64;

/** Maximum total nodes retained in the Radix prefix tree before LRU eviction. */
const MAX_RADIX_TREE_NODES = 512;

/** Immutable empty AST node array to prevent transient heap churn. */
const EMPTY_SUBTREE_ARRAY: readonly NormalizedNode[] = Object.freeze([]);

/** Immutable empty symbols array to prevent transient heap churn. */
const EMPTY_SYMBOLS_ARRAY: readonly string[] = Object.freeze([]);

/** Regex detecting import or package declarations that form reusable prefixes. */
const IMPORT_DECLARATION_PATTERN =
    /^\s*(?:import|from|require\(|package|use\s+|include\s+|extern\s+crate)/;

/**
 * Node in the multi-way Radix AST prefix tree.
 */
export interface RadixTreeNode {
    /** Normalized line key for this tree edge. */
    readonly lineKey: string;
    /** Cumulative prefix line depth from root up to this node. */
    readonly cumulativeLines: number;
    /** Cached pre-parsed AST subtrees matching this cumulative prefix. */
    readonly astSubtrees: readonly NormalizedNode[];
    /** List of symbol identifiers introduced by this prefix. */
    readonly importedSymbols: readonly string[];
    /** Outgoing edge transitions keyed by normalized line hash. */
    readonly children: Map<string, RadixTreeNode>;
    /** Last access timestamp for LRU eviction. */
    lastAccessTime: number;
    /** Number of cache hits routed through this node. */
    hitCount: number;
}

/**
 * Result of Longest Common Prefix matching on a source file.
 */
export interface RadixPrefixMatchResult {
    /** Number of matching prefix lines found. */
    readonly matchedLines: number;
    /** Total number of candidate prefix lines inspected in source. */
    readonly totalPrefixLines: number;
    /** Match ratio between 0.0 and 1.0 (matchedLines / totalPrefixLines). */
    readonly matchRatio: number;
    /** True if matched lines satisfy minimum prefix threshold. */
    readonly isMatch: boolean;
    /** Reusable pre-parsed AST subtrees covering the matched prefix. */
    readonly reusableSubtrees: readonly NormalizedNode[];
    /** Imported symbols provided by the matched prefix. */
    readonly importedSymbols: readonly string[];
    /** Remaining source content starting immediately after the matched prefix. */
    readonly remainingContent: string;
    /** 1-based start line number of remaining unparsed source code. */
    readonly remainingStartLine: number;
}

/**
 * Telemetry and performance metrics for AstPrefixRadixCache.
 */
export interface RadixCacheTelemetry {
    /** Total tree nodes currently stored in memory. */
    readonly totalNodes: number;
    /** Total lookup queries executed. */
    readonly totalQueries: number;
    /** Total successful prefix hits. */
    readonly hitCount: number;
    /** Total misses where match lines fell below threshold. */
    readonly missCount: number;
    /** Prefix hit ratio (hitCount / totalQueries). */
    readonly hitRatio: number;
    /** Average matched line depth across hits. */
    readonly avgMatchedLines: number;
}

/**
 * Configuration options for AstPrefixRadixCache.
 */
export interface AstPrefixRadixCacheOptions {
    /** Minimum matched lines to consider a prefix hit (defaults to 3). */
    readonly minMatchLines?: number;
    /** Maximum lines inspected from the file head (defaults to 64). */
    readonly maxPrefixScanLines?: number;
    /** Maximum total nodes before eviction (defaults to 512). */
    readonly maxTreeNodes?: number;
}

/**
 * SGLang RadixAttention AST Prefix Tree Cache.
 */
export class AstPrefixRadixCache {
    private readonly minMatchLines: number;
    private readonly maxPrefixScanLines: number;
    private readonly maxTreeNodes: number;

    private readonly root: RadixTreeNode;
    private nodeCount = 0;

    // Telemetry counters
    private queryCount = 0;
    private hitCount = 0;
    private missCount = 0;
    private totalMatchedLinesSum = 0;

    public constructor(options: AstPrefixRadixCacheOptions = {}) {
        this.minMatchLines = options.minMatchLines ?? DEFAULT_MIN_MATCH_LINES;
        this.maxPrefixScanLines = options.maxPrefixScanLines ?? DEFAULT_MAX_PREFIX_SCAN_LINES;
        this.maxTreeNodes = options.maxTreeNodes ?? MAX_RADIX_TREE_NODES;

        this.root = {
            lineKey: '__ROOT__',
            cumulativeLines: 0,
            astSubtrees: EMPTY_SUBTREE_ARRAY,
            importedSymbols: EMPTY_SYMBOLS_ARRAY,
            children: new Map(),
            lastAccessTime: Date.now(),
            hitCount: 0,
        };
    }

    /**
     * Insert a tokenized prefix line sequence with corresponding AST subtrees into the Radix tree.
     *
     * @param lines - Array of normalized prefix lines.
     * @param astSubtrees - Pre-parsed AST subtrees covering these lines.
     * @param importedSymbols - Optional list of symbols introduced in this prefix.
     */
    public insertPrefix(
        lines: readonly string[],
        astSubtrees: readonly NormalizedNode[],
        importedSymbols?: readonly string[],
    ): void {
        const count = Math.min(lines.length, this.maxPrefixScanLines);
        if (count === 0) {
            return;
        }

        let currentNode = this.root;
        const now = Date.now();

        for (let i = 0; i < count; i++) {
            const lineKey = this.computeLineKey(lines[i]);
            currentNode = this.stepChildNode(
                currentNode,
                lineKey,
                i + 1,
                i === count - 1,
                astSubtrees,
                importedSymbols,
                now,
            );
        }
    }

    /**
     * Internal: Resolve or allocate next Radix child node along prefix edge.
     */
    private stepChildNode(
        currentNode: RadixTreeNode,
        lineKey: string,
        cumulativeLines: number,
        isTerminal: boolean,
        astSubtrees: readonly NormalizedNode[],
        importedSymbols: readonly string[] | undefined,
        now: number,
    ): RadixTreeNode {
        let nextNode = currentNode.children.get(lineKey);
        if (!nextNode) {
            this.evictLruIfNecessary();
            nextNode = this.createNewRadixNode(
                lineKey,
                cumulativeLines,
                isTerminal,
                astSubtrees,
                importedSymbols,
                now,
            );
            currentNode.children.set(lineKey, nextNode);
            this.nodeCount++;
        } else if (isTerminal) {
            this.updateTerminalPayload(nextNode, astSubtrees, importedSymbols);
        }

        nextNode.lastAccessTime = now;
        return nextNode;
    }

    /**
     * Internal: Allocate a new RadixTreeNode.
     */
    private createNewRadixNode(
        lineKey: string,
        cumulativeLines: number,
        isTerminal: boolean,
        astSubtrees: readonly NormalizedNode[],
        importedSymbols: readonly string[] | undefined,
        now: number,
    ): RadixTreeNode {
        return {
            lineKey,
            cumulativeLines,
            astSubtrees: isTerminal ? astSubtrees : EMPTY_SUBTREE_ARRAY,
            importedSymbols: isTerminal ? (importedSymbols ?? EMPTY_SYMBOLS_ARRAY) : EMPTY_SYMBOLS_ARRAY,
            children: new Map(),
            lastAccessTime: now,
            hitCount: 0,
        };
    }

    /**
     * Internal: Update terminal payload on existing node.
     */
    private updateTerminalPayload(
        node: RadixTreeNode,
        astSubtrees: readonly NormalizedNode[],
        importedSymbols: readonly string[] | undefined,
    ): void {
        if (astSubtrees.length > 0 && node.astSubtrees.length === 0) {
            (node as { astSubtrees: readonly NormalizedNode[] }).astSubtrees = astSubtrees;
            if (importedSymbols && importedSymbols.length > 0) {
                (node as { importedSymbols: readonly string[] }).importedSymbols = importedSymbols;
            }
        }
    }

    /**
     * Find the Longest Common Prefix (LCP) match for the given source code text or lines.
     *
     * @param source - Raw file source string or pre-split lines.
     * @returns RadixPrefixMatchResult with reusable subtrees and remaining unparsed content.
     */
    public findLongestPrefixMatch(source: string | readonly string[]): RadixPrefixMatchResult {
        this.queryCount++;

        const lines = typeof source === 'string'
            ? this.extractCandidatePrefixLines(source)
            : source.slice(0, this.maxPrefixScanLines);

        const totalPrefixLines = lines.length;
        if (totalPrefixLines === 0) {
            this.missCount++;
            return this.buildMissResult(typeof source === 'string' ? source : source.join('\n'), 0);
        }

        let currentNode = this.root;
        let lastMatchedNode: RadixTreeNode | undefined;
        let matchedLines = 0;
        const now = Date.now();

        for (let i = 0; i < totalPrefixLines; i++) {
            const lineKey = this.computeLineKey(lines[i]);
            const nextNode = currentNode.children.get(lineKey);
            if (!nextNode) {
                break;
            }

            matchedLines = i + 1;
            nextNode.lastAccessTime = now;
            nextNode.hitCount++;
            currentNode = nextNode;

            if (nextNode.astSubtrees.length > 0) {
                lastMatchedNode = nextNode;
            }
        }

        const isHit = matchedLines >= this.minMatchLines && lastMatchedNode !== undefined;
        if (isHit && lastMatchedNode) {
            this.hitCount++;
            this.totalMatchedLinesSum += matchedLines;

            const remainingStartLine = matchedLines + 1;
            const fullSource = typeof source === 'string' ? source : source.join('\n');
            const remainingContent = this.sliceRemainingContent(fullSource, matchedLines);
            const matchRatio = totalPrefixLines > 0 ? matchedLines / totalPrefixLines : 0;

            return {
                matchedLines,
                totalPrefixLines,
                matchRatio: Math.round(matchRatio * 1000) / 1000,
                isMatch: true,
                reusableSubtrees: lastMatchedNode.astSubtrees,
                importedSymbols: lastMatchedNode.importedSymbols,
                remainingContent,
                remainingStartLine,
            };
        }

        this.missCount++;
        const fullSourceText = typeof source === 'string' ? source : source.join('\n');
        return this.buildMissResult(fullSourceText, totalPrefixLines);
    }

    /**
     * Get aggregate cache telemetry.
     */
    public getTelemetry(): RadixCacheTelemetry {
        const hitRatio = this.queryCount > 0 ? this.hitCount / this.queryCount : 0;
        const avgMatchedLines = this.hitCount > 0 ? this.totalMatchedLinesSum / this.hitCount : 0;

        return {
            totalNodes: this.nodeCount,
            totalQueries: this.queryCount,
            hitCount: this.hitCount,
            missCount: this.missCount,
            hitRatio: Math.round(hitRatio * 1000) / 1000,
            avgMatchedLines: Math.round(avgMatchedLines * 10) / 10,
        };
    }

    /**
     * Clear all cached Radix tree nodes.
     */
    public clear(): void {
        this.root.children.clear();
        this.nodeCount = 0;
        this.queryCount = 0;
        this.hitCount = 0;
        this.missCount = 0;
        this.totalMatchedLinesSum = 0;
    }

    /**
     * Internal: Extract candidate prefix lines from source content.
     */
    private extractCandidatePrefixLines(content: string): string[] {
        const lines = content.split(/\r?\n/);
        const prefixLines: string[] = [];
        const limit = Math.min(lines.length, this.maxPrefixScanLines);

        for (let i = 0; i < limit; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed.length === 0) {
                // Empty lines within prefix block are tolerated
                prefixLines.push('');
                continue;
            }

            if (IMPORT_DECLARATION_PATTERN.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
                prefixLines.push(trimmed);
            } else {
                // First non-import non-comment statement terminates prefix scan
                break;
            }
        }

        return prefixLines;
    }

    /**
     * Internal: Compute deterministic hash key for a normalized line.
     */
    private computeLineKey(line: string): string {
        const normalized = line.trim().replace(/\s+/g, ' ');
        return normalized.length > 32 ? fastDigest(normalized) : normalized;
    }

    /**
     * Internal: Slice remaining source content after matched line count.
     */
    private sliceRemainingContent(fullContent: string, matchedLines: number): string {
        let currentLine = 0;
        let charIndex = 0;

        while (charIndex < fullContent.length && currentLine < matchedLines) {
            if (fullContent.charCodeAt(charIndex) === 10) { // '\n'
                currentLine++;
            }
            charIndex++;
        }

        return charIndex < fullContent.length ? fullContent.slice(charIndex) : '';
    }

    /**
     * Internal: Count total active nodes in tree.
     */
    private countTreeNodes(): number {
        let count = 0;
        const stack: RadixTreeNode[] = [this.root];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node) continue;
            for (const child of node.children.values()) {
                count++;
                stack.push(child);
            }
        }
        return count;
    }

    /**
     * Internal: Evict oldest LRU tree node when capacity limit is reached.
     */
    private evictLruIfNecessary(): void {
        while (this.nodeCount >= this.maxTreeNodes && this.root.children.size > 0) {
            let oldestLeaf: { parentMap: Map<string, RadixTreeNode>; key: string } | undefined;
            let oldestTime = Infinity;

            const stack: Array<{ parentMap: Map<string, RadixTreeNode>; key: string; node: RadixTreeNode }> = [];
            for (const [key, child] of this.root.children.entries()) {
                stack.push({ parentMap: this.root.children, key, node: child });
            }

            while (stack.length > 0) {
                const item = stack.pop();
                if (!item) continue;
                if (item.node.children.size === 0 && item.node.lastAccessTime < oldestTime) {
                    oldestTime = item.node.lastAccessTime;
                    oldestLeaf = { parentMap: item.parentMap, key: item.key };
                }
                for (const [k, c] of item.node.children.entries()) {
                    stack.push({ parentMap: item.node.children, key: k, node: c });
                }
            }

            if (oldestLeaf) {
                oldestLeaf.parentMap.delete(oldestLeaf.key);
            } else {
                const firstKey = this.root.children.keys().next().value;
                if (firstKey) {
                    this.root.children.delete(firstKey);
                } else {
                    break;
                }
            }
            this.nodeCount = this.countTreeNodes();
        }
    }

    /**
     * Internal: Build default miss result when no prefix matched.
     */
    private buildMissResult(fullSource: string, totalPrefixLines: number): RadixPrefixMatchResult {
        return {
            matchedLines: 0,
            totalPrefixLines,
            matchRatio: 0,
            isMatch: false,
            reusableSubtrees: EMPTY_SUBTREE_ARRAY,
            importedSymbols: EMPTY_SYMBOLS_ARRAY,
            remainingContent: fullSource,
            remainingStartLine: 1,
        };
    }
}

/** Shared singleton instance of AstPrefixRadixCache. */
export const defaultAstPrefixRadixCache = new AstPrefixRadixCache();
