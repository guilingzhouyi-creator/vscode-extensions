/**
 * Module: Core Engine — Per-File Preflight Bitmask Gate
 * File Path: src/core/scanner/file-preflight-gate.ts
 * Architecture Role: Single-pass file preflight filter evaluating syntactic signals and language
 *   bounds to compile a 32-bit active analyzer bitmask prior to AST construction and dispatch.
 * Dependencies & Triggers: Consumes AnalyzerBit constants and trigger-catalog; invoked by
 *   runFileAnalyzers per file before streaming or legacy analyzer iteration.
 * Responsibilities:
 *   1. Evaluate file extension compatibility against language-specific analyzer packs;
 *   2. Probe file content against fast byte trigger catalogs for secrets, comments, and complexity;
 *   3. Emit a unified 32-bit active analyzer bitmask enabling O(1) single-cycle dispatching;
 *   4. Support `bypassPreflight: true` escape hatch for deterministic unconstrained scanning.
 * Exit Semantics & Design Rationale: Pure, fail-safe evaluation returning 32-bit integer mask;
 *   never throws, allocates zero heap structures during inspection, and reduces dispatch overhead.
 */

import * as path from 'path';
import type { ScanConfig } from '../types';
import {
    ALL_ANALYZERS_MASK,
    ANALYZER_NAME_TO_BIT,
    AnalyzerBit,
} from '../constants/analyzer-bitmask';
import { defaultTriggerCatalog } from './trigger-catalog';

/** Language extension sets for fast compatibility gating. */
const PYTHON_EXTS = new Set(['.py']);
const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const RUST_EXTS = new Set(['.rs']);
const GDSCRIPT_EXTS = new Set(['.gd']);
const GO_EXTS = new Set(['.go']);
const SHELL_EXTS = new Set(['.sh', '.bash', '.zsh', '.ps1', '.psm1', '.psd1']);

/**
 * Evaluates file content and path to construct a 32-bit active analyzer bitmask.
 *
 * @param content - Raw file content string.
 * @param filePath - Repository-relative or absolute file path.
 * @param config - Optional scanner configuration carrying bypassPreflight override.
 * @returns 32-bit bitmask where set bits indicate analyzers that should execute.
 */
export function evaluateFilePreflightMask(
    content: string,
    filePath: string,
    config?: ScanConfig,
): number {
    if (config?.bypassPreflight === true) {
        return ALL_ANALYZERS_MASK;
    }

    let mask = ALL_ANALYZERS_MASK;
    const ext = path.extname(filePath).toLowerCase();

    // 1. Language pack extension filtering
    if (!PYTHON_EXTS.has(ext)) {
        mask &= ~AnalyzerBit.PYTHON_MODERN;
    }
    if (!TS_EXTS.has(ext)) {
        mask &= ~AnalyzerBit.TYPESCRIPT_MODERN;
    }
    if (!RUST_EXTS.has(ext)) {
        mask &= ~AnalyzerBit.RUST_MODERN;
    }
    if (!GDSCRIPT_EXTS.has(ext)) {
        mask &= ~(AnalyzerBit.GDSCRIPT_MODERN | AnalyzerBit.GDSCRIPT_GAME);
    }
    if (!GO_EXTS.has(ext)) {
        mask &= ~AnalyzerBit.GO_MODERN;
    }
    if (!SHELL_EXTS.has(ext)) {
        mask &= ~(AnalyzerBit.SHELL_LINT | AnalyzerBit.SHELL_SAFETY);
    }

    // 2. Syntactic trigger pre-filtering
    if (content.length > 0) {
        if (!defaultTriggerCatalog.shouldExecuteAnalyzer('secrets', content)) {
            mask &= ~AnalyzerBit.SECRETS;
        }
        if (!defaultTriggerCatalog.shouldExecuteAnalyzer('comments', content)) {
            mask &= ~AnalyzerBit.COMMENTS;
        }
        if (!defaultTriggerCatalog.shouldExecuteAnalyzer('complexity', content)) {
            mask &= ~AnalyzerBit.COMPLEXITY;
        }
    }

    return mask;
}

/**
 * Checks whether an analyzer is active given a preflight mask and analyzer name.
 * Safe fallback: unregistered/custom analyzers always return true.
 *
 * @param mask - 32-bit active analyzer bitmask.
 * @param analyzerName - Target analyzer identifier.
 * @returns True if the analyzer is cleared to execute on the file.
 */
export function isFileAnalyzerActive(mask: number, analyzerName: string): boolean {
    const bit = ANALYZER_NAME_TO_BIT[analyzerName];
    if (bit === undefined) {
        return true;
    }
    return (mask & bit) !== 0;
}
