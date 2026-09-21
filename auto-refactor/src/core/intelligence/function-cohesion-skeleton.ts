/**
 * Module: Core Intelligence — Function Cohesion & Execution Skeleton Analyzer
 * File Path: src/core/intelligence/function-cohesion-skeleton.ts
 * Architecture Role: Detects intra-file responsibility aggregation (ARCH-BLR-001) and shared
 *   execution skeleton + differentiated strategy candidates (ARCH-SKL-001).
 * Dependencies & Triggers: Consumes Issue schema and dimensionLiterals;
 *   invoked by ComplexityAnalyzer when a file hosts multiple routines.
 * Responsibilities: Compute symbol Jaccard overlap to detect disjoint boundary imbalance;
 *   align execution stages (prologue/epilogue) to discover template method / strategy refactorings.
 * Exit Semantics & Design Rationale: Deterministic text and token analysis without disk I/O.
 *   Provides architectural guidance rather than merely counting raw function metrics.
 */

import type { Issue } from '../types';
import { SEVERITY_INFO, SEVERITY_WARNING } from '../types';
import {
    ANALYZER_ARCHITECTURE,
    RULE_ARCH_BLR_001,
    RULE_ARCH_SKL_001,
} from '../scoring/dimensionLiterals';

/**
 * Summary of a complex function inspected for cohesion and skeleton patterns.
 */
export interface ComplexFunctionDescriptor {
    name: string;
    startLine: number;
    endLine: number;
    cc: number;
    lines: string[];
}

/**
 * Structural skeleton candidate sharing lifecycle prologue and epilogue.
 */
export interface SkeletonCandidate {
    functionA: string;
    functionB: string;
    sharedPrologue: string;
    sharedEpilogue: string;
}

/**
 * Result of function cohesion and skeleton discovery.
 */
export interface CohesionSkeletonResult {
    issues: Issue[];
    disjointPairs: [string, string][];
    skeletonCandidates: SkeletonCandidate[];
}

/**
 * Extracts identifiers and referenced tokens from function lines.
 */
function extractSymbolTokens(lines: string[]): Set<string> {
    const tokens = new Set<string>();
    const text = lines.join('\n');
    const matches = text.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g);
    if (!matches) return tokens;

    const KEYWORDS = new Set([
        'function',
        'const',
        'let',
        'var',
        'if',
        'else',
        'for',
        'while',
        'return',
        'this',
        'async',
        'await',
        'try',
        'catch',
        'throw',
        'new',
        'true',
        'false',
        'null',
        'undefined',
        'def',
        'class',
        'import',
        'from',
    ]);

    for (const m of matches) {
        if (!KEYWORDS.has(m) && m.length >= 2) {
            tokens.add(m);
        }
    }
    return tokens;
}

/**
 * Computes Jaccard similarity index between two symbol sets.
 */
function computeJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 && setB.size === 0) return 1.0;
    let intersection = 0;
    for (const item of setA) {
        if (setB.has(item)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0.0;
}

/**
 * Computes Szymkiewicz-Simpson Overlap Coefficient (|A ∩ B| / min(|A|, |B|)).
 * Identifies orchestrator-helper relationships and prevents false BLR violations.
 */
function computeOverlapCoefficient(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 || setB.size === 0) return 0.0;
    let intersection = 0;
    for (const item of setA) {
        if (setB.has(item)) intersection++;
    }
    return intersection / Math.min(setA.size, setB.size);
}

/**
 * Normalizes a code statement line for structural skeleton comparison.
 */
function normalizeStatement(line: string): string {
    return line
        .trim()
        .replace(/["'`][^"'`]*["'`]/g, '""')
        .replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g, '$ID')
        .replace(/\s+/g, ' ');
}

/**
 * Strips comments and blank lines to isolate structural executable statements.
 */
function cleanStatements(lines: string[]): string[] {
    return lines
        .map((l) => l.trim())
        .filter((l) => {
            if (l.length === 0) return false;
            if (
                l.startsWith('//') ||
                l.startsWith('/*') ||
                l.startsWith('*') ||
                l.startsWith('#')
            ) {
                return false;
            }
            return true;
        })
        .map(normalizeStatement);
}

function longestCommonPrefix(stmtsA: string[], stmtsB: string[]): string[] {
    const limit = Math.min(stmtsA.length, stmtsB.length);
    const common: string[] = [];
    for (let i = 0; i < limit; i++) {
        if (stmtsA[i] === stmtsB[i] && stmtsA[i].length > 0) {
            common.push(stmtsA[i]);
        } else {
            break;
        }
    }
    return common;
}

function longestCommonSuffix(stmtsA: string[], stmtsB: string[]): string[] {
    const limit = Math.min(stmtsA.length, stmtsB.length);
    const common: string[] = [];
    for (let i = 0; i < limit; i++) {
        const a = stmtsA[stmtsA.length - 1 - i];
        const b = stmtsB[stmtsB.length - 1 - i];
        if (a === b && a.length > 0) {
            common.unshift(a);
        } else {
            break;
        }
    }
    return common;
}

function checkDisjointPair(
    fnA: ComplexFunctionDescriptor,
    fnB: ComplexFunctionDescriptor,
    similarity: number,
    overlap: number,
    filePath: string,
    disjointPairs: [string, string][],
    issues: Issue[],
): void {
    if (fnA.cc >= 12 && fnB.cc >= 12 && similarity < 0.12 && overlap < 0.6) {
        disjointPairs.push([fnA.name, fnB.name]);
        issues.push({
            id: `architecture:${RULE_ARCH_BLR_001}:${filePath}:${fnA.startLine}-${fnB.startLine}`,
            analyzer: ANALYZER_ARCHITECTURE,
            rule: RULE_ARCH_BLR_001,
            severity: SEVERITY_WARNING,
            message:
                `File boundary imbalance: "${fnA.name}" (CC ${fnA.cc}) and "${fnB.name}" ` +
                `(CC ${fnB.cc}) share negligible semantic overlap (Jaccard: ${similarity.toFixed(2)}, Overlap: ${overlap.toFixed(2)}), ` +
                `indicating unrelated responsibility aggregation in "${filePath}".`,
            location: {
                file: filePath,
                start: { line: fnA.startLine, column: 1 },
                end: { line: fnB.endLine, column: 80 },
            },
            detail: {
                functionA: fnA.name,
                functionB: fnB.name,
                similarity,
                overlap,
                ccA: fnA.cc,
                ccB: fnB.cc,
            },
            suggestion:
                'Split this module into cohesive single-responsibility domain files along semantic boundaries.',
        });
    }
}

function checkSkeletonCandidate(
    fnA: ComplexFunctionDescriptor,
    fnB: ComplexFunctionDescriptor,
    filePath: string,
    skeletonCandidates: CohesionSkeletonResult['skeletonCandidates'],
    issues: Issue[],
): void {
    const cleanA = cleanStatements(fnA.lines);
    const cleanB = cleanStatements(fnB.lines);
    if (cleanA.length < 4 || cleanB.length < 4) return;

    const lcp = longestCommonPrefix(cleanA, cleanB);
    const lcs = longestCommonSuffix(cleanA, cleanB);
    const prologueMatch = lcp.length >= 1;
    const epilogueMatch = lcs.length >= 1;
    const midDivergent =
        cleanA.length > lcp.length + lcs.length || cleanB.length > lcp.length + lcs.length;

    if (prologueMatch && epilogueMatch && midDivergent && lcp.length + lcs.length >= 2) {
        const sharedPrologue = lcp.join(';');
        const sharedEpilogue = lcs.join(';');

        skeletonCandidates.push({
            functionA: fnA.name,
            functionB: fnB.name,
            sharedPrologue,
            sharedEpilogue,
        });

        issues.push({
            id: `architecture:${RULE_ARCH_SKL_001}:${filePath}:${fnA.startLine}-${fnB.startLine}`,
            analyzer: ANALYZER_ARCHITECTURE,
            rule: RULE_ARCH_SKL_001,
            severity: SEVERITY_INFO,
            message:
                `Shared execution skeleton candidate: "${fnA.name}" and "${fnB.name}" ` +
                `share matching prologue verification and epilogue finalization steps ` +
                `with diverging midsections.`,
            location: {
                file: filePath,
                start: { line: fnA.startLine, column: 1 },
                end: { line: fnB.endLine, column: 80 },
            },
            detail: {
                functionA: fnA.name,
                functionB: fnB.name,
                sharedPrologue,
                sharedEpilogue,
                pattern: 'Template Method / Strategy Candidate',
            },
            suggestion:
                'Extract shared orchestration skeleton into a template method or higher-order pipeline, injecting differentiated strategies.',
        });
    }
}

/**
 * Analyzes multiple complex functions within a single file for cohesion imbalance
 * and shared execution skeleton candidates.
 *
 * @param filePath - Physical file path.
 * @param functions - List of complex functions (CC >= 10) in the file.
 * @returns Discovered issues and structural candidate records.
 */
export function analyzeFunctionCohesionAndSkeleton(
    filePath: string,
    functions: ComplexFunctionDescriptor[],
): CohesionSkeletonResult {
    const issues: Issue[] = [];
    const disjointPairs: [string, string][] = [];
    const skeletonCandidates: SkeletonCandidate[] = [];

    if (functions.length < 2) {
        return { issues, disjointPairs, skeletonCandidates };
    }

    const tokenSets = functions.map((fn) => extractSymbolTokens(fn.lines));

    for (let i = 0; i < functions.length; i++) {
        for (let j = i + 1; j < functions.length; j++) {
            const similarity = computeJaccardSimilarity(tokenSets[i], tokenSets[j]);
            const overlap = computeOverlapCoefficient(tokenSets[i], tokenSets[j]);

            checkDisjointPair(
                functions[i],
                functions[j],
                similarity,
                overlap,
                filePath,
                disjointPairs,
                issues,
            );

            checkSkeletonCandidate(
                functions[i],
                functions[j],
                filePath,
                skeletonCandidates,
                issues,
            );
        }
    }

    return { issues, disjointPairs, skeletonCandidates };
}
