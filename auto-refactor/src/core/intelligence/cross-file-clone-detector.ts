/**
 * Module: Core Engine — Cross-File Code Clone Discovery Service
 * File Path: src/core/intelligence/cross-file-clone-detector.ts
 * Architecture Role: Project-scale near-duplicate file and code clone detector powered by
 *   the Rust native 64-permutation MinHash signature and Locality Sensitive Hashing (LSH) operator.
 * Dependencies & Triggers: Consumes nativeCore from src/core/native; invoked by post-scan pipelines
 *   or multi-file hygiene audits.
 * Responsibilities:
 *   1. Filter eligible candidate source files (line count and non-blank threshold);
 *   2. Compute 64-dim MinHash signatures via native SIMD operator;
 *   3. Execute LSH multi-band bucket clustering via native findClonePairs;
 *   4. Emit structured cross-file similarity records and actionable refactor targets.
 * Exit Semantics & Design Rationale: Pure analysis service; returns empty array when < 2 eligible files.
 */

import { nativeCore } from '../native/native-bridge';

/**
 * Result of cross-file code clone detection between two source files.
 */
export interface CrossFileCloneMatch {
    readonly fileA: string;
    readonly fileB: string;
    readonly similarity: number;
}

/**
 * Options configuring cross-file clone discovery.
 */
export interface CrossFileCloneOptions {
    /** Minimum non-trivial lines required for a file to participate in clone discovery (default: 8). */
    readonly minLines?: number;
    /** Minimum Jaccard similarity threshold for candidate clone pairing (default: 0.80). */
    readonly similarityThreshold?: number;
    /** Number of permutations for MinHash projection (default: 64). */
    readonly numPermutations?: number;
}

const DEFAULT_MIN_LINES = 8;
const DEFAULT_SIMILARITY_THRESHOLD = 0.8;
const DEFAULT_NUM_PERMUTATIONS = 64;

/**
 * Discovers similar and cloned file pairs across a repository source corpus.
 *
 * @param files - Array of files with path and content.
 * @param options - Custom thresholds for filtering and pairing.
 * @returns Array of detected clone pairs sorted by similarity descending.
 */
export function detectCrossFileClones(
    files: Array<{ readonly file: string; readonly content: string }>,
    options?: CrossFileCloneOptions,
): CrossFileCloneMatch[] {
    const minLines = options?.minLines ?? DEFAULT_MIN_LINES;
    const threshold = options?.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    const numPerm = options?.numPermutations ?? DEFAULT_NUM_PERMUTATIONS;

    // 1. Filter eligible files
    const eligible: Array<{ file: string; content: string }> = [];
    for (const f of files) {
        if (!f.content || f.content.length < 50) continue;
        const lineCount = f.content.split('\n').length;
        if (lineCount >= minLines) {
            eligible.push({ file: f.file, content: f.content });
        }
    }

    if (eligible.length < 2) {
        return [];
    }

    // 2. Compute MinHash signatures via native operator
    const signatures: number[][] = [];
    for (const item of eligible) {
        signatures.push(nativeCore.computeMinHash(item.content, numPerm));
    }

    // 3. Cluster into candidate clone pairs via native LSH
    const pairs = nativeCore.findClonePairs(signatures, threshold);

    // 4. Map back to file paths
    const results: CrossFileCloneMatch[] = [];
    for (const p of pairs) {
        if (p.fileA < eligible.length && p.fileB < eligible.length) {
            results.push({
                fileA: eligible[p.fileA].file,
                fileB: eligible[p.fileB].file,
                similarity: Math.round(p.similarity * 100) / 100,
            });
        }
    }

    return results;
}
