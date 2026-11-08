/**
 * Module: Core Constants — 32-Bit Analyzer Bitmask Taxonomy
 * File Path: src/core/constants/analyzer-bitmask.ts
 * Architecture Role: Single source of truth bitmask representation for all built-in analyzers,
 *   enabling zero-heap-allocation filtering and single-cycle bitwise dispatch throughout scanning.
 * Dependencies & Triggers: Consumed by scanner preflight gate, router, and analyzer-runner.
 * Responsibilities:
 *   1. Assign canonical immutable bit flags (1 << 0 to 1 << 31) to all 32 built-in analyzers;
 *   2. Provide ultra-fast bidirectional name-to-bit and bit-to-name lookup tables;
 *   3. Expose pure, allocation-free bitwise arithmetic and masking helpers.
 * Exit Semantics & Design Rationale: Pure constants and inline bitwise arithmetic; zero I/O,
 *   zero dynamic allocation, and sub-nanosecond evaluation.
 */

import { BUILTIN_ANALYZERS } from './rule-codes';

/**
 * 32-bit unsigned integer bit flag assigned to each built-in analyzer.
 */
export enum AnalyzerBit {
    CONSTANTS = 1 << 0,
    LARGE_FILE = 1 << 1,
    COMPLEXITY = 1 << 2,
    GOVERNANCE = 1 << 3,
    DEPENDENCY_GRAPH = 1 << 4,
    SECRETS = 1 << 5,
    ARCHITECTURE = 1 << 6,
    PERFORMANCE = 1 << 7,
    COMMENTS = 1 << 8,
    HYGIENE = 1 << 9,
    SECURITY = 1 << 10,
    SIMPLIFY = 1 << 11,
    PYTHON_MODERN = 1 << 12,
    TYPESCRIPT_MODERN = 1 << 13,
    RUST_MODERN = 1 << 14,
    GDSCRIPT_MODERN = 1 << 15,
    DOCS = 1 << 16,
    DATA_ARCHITECTURE = 1 << 17,
    TEST_MODERNITY = 1 << 18,
    DEPENDENCY_LAYOUT = 1 << 19,
    NAMING = 1 << 20,
    GO_MODERN = 1 << 21,
    SHELL_LINT = 1 << 22,
    STDLIB = 1 << 23,
    GDSCRIPT_GAME = 1 << 24,
    VSCODE_EXTENSION = 1 << 25,
    GATE_ARCHITECTURE = 1 << 26,
    FRONTEND = 1 << 27,
    PRODUCTION_HYGIENE = 1 << 28,
    CLIENT_EXPOSURE = 1 << 29,
    SHELL_SAFETY = 1 << 30,
    CONCURRENCY = 1 << 31,
}

/** All 32 built-in analyzer bits combined (mask: 0xFFFFFFFF). */
export const ALL_ANALYZERS_MASK: number = 0xffffffff;

/** Immutable dictionary mapping analyzer names to their 32-bit bit flags. */
export const ANALYZER_NAME_TO_BIT: Readonly<Record<string, number>> = Object.freeze(
    BUILTIN_ANALYZERS.reduce<Record<string, number>>((acc, name, idx) => {
        acc[name] = 1 << idx;
        return acc;
    }, {}),
);

/** Maps single bit flags (signed and unsigned) to their canonical analyzer names. */
export const BIT_TO_ANALYZER_NAME: Readonly<Record<number, string>> = Object.freeze(
    BUILTIN_ANALYZERS.reduce<Record<number, string>>((acc, name, idx) => {
        const signedBit = 1 << idx;
        acc[signedBit] = name;
        acc[signedBit >>> 0] = name;
        return acc;
    }, {}),
);

/**
 * Resolves the bitmask flag for a given analyzer name.
 *
 * @param name - Canonical analyzer name.
 * @returns Bitmask integer or 0 if unregistered.
 */
export function analyzerNameToBit(name: string): number {
    return ANALYZER_NAME_TO_BIT[name] || 0;
}

/**
 * Fast bitwise test checking whether a specific analyzer is active in a mask.
 *
 * @param mask - 32-bit active analyzer bitmask.
 * @param bit - Analyzer bit flag.
 * @returns True if the analyzer is enabled in the mask.
 */
export function hasAnalyzerBit(mask: number, bit: number): boolean {
    return (mask & bit) !== 0;
}

/**
 * Converts a 32-bit analyzer bitmask back into an array of canonical analyzer names.
 *
 * @param mask - Bitmask to decode.
 * @returns Array of active analyzer names.
 */
export function analyzerMaskToNames(mask: number): string[] {
    const names: string[] = [];
    for (let i = 0; i < BUILTIN_ANALYZERS.length; i++) {
        if ((mask & (1 << i)) !== 0) {
            names.push(BUILTIN_ANALYZERS[i]);
        }
    }
    return names;
}

/**
 * Encodes an iterable collection of analyzer names into a unified 32-bit bitmask.
 *
 * @param names - Iterable list of analyzer names.
 * @returns Combined 32-bit integer mask.
 */
export function analyzerNamesToMask(names: Iterable<string>): number {
    let mask = 0;
    for (const name of names) {
        const bit = ANALYZER_NAME_TO_BIT[name];
        if (bit !== undefined) {
            mask |= bit;
        }
    }
    return mask;
}
