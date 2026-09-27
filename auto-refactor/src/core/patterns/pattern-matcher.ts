/**
 * Module: Core Engine — Generalized Pattern Matching Kernel
 * File Path: src/core/patterns/pattern-matcher.ts
 * Architecture Role: High-performance, language-agnostic matcher for semantic rule archetypes.
 * Dependencies & Triggers: Consumed by universal and domain-specialized analyzers.
 * Responsibilities:
 *   1. Evaluate resource lifecycle registration, scoping, and leakage invariants.
 *   2. Detect synchronous blocking invocations inside event loop or main thread contexts.
 *   3. Enforce zero-allocation constraints inside high-frequency hot-path scopes.
 *   4. Intercept forbidden architectural dependencies across module boundaries.
 *   5. Detect bare string literals flowing into user-facing presentation sinks.
 * Exit Semantics & Design Rationale: Deterministic, reentrant, and thread-safe.
 *   Operates on masked/raw line arrays without transient heap bloat or unhandled exceptions.
 */

import type {
    ResourceLifecyclePattern,
    ResourceLifecycleViolation,
    BlockingCallPattern,
    BlockingCallViolation,
    HotPathPattern,
    HotPathViolation,
    BoundaryIsolationPattern,
    BoundaryIsolationViolation,
    PresentationLiteralPattern,
    PresentationLiteralViolation,
} from './types';
import { CfgBuilder } from '../cfg/cfg-builder';
import { DefUseAnalyzer } from '../cfg/def-use-chain';
import type { FlowAnalysisResult } from '../cfg/types';

/** Variable assignment extraction pattern: const/let/var x = ... or x := ... */
const VARIABLE_ASSIGNMENT_RE = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=/;

/**
 * Match resource lifecycle allocations against registration containers.
 *
 * @param maskedLines - Source lines with comments and string contents masked.
 * @param pattern - Lifecycle configuration defining acquisition and container patterns.
 * @returns Array of discovered lifecycle violations.
 */
export function matchResourceLifecycle(
    maskedLines: readonly string[],
    pattern: ResourceLifecyclePattern,
): ResourceLifecycleViolation[] {
    const violations: ResourceLifecycleViolation[] = [];
    const windowSize = pattern.trackingWindowLines ?? 6;
    let pendingVar: string | null = null;
    let pendingLine = -1;

    for (let idx = 0; idx < maskedLines.length; idx++) {
        const line = maskedLines[idx];
        const lineNum = idx + 1;
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        const isAcquisition = pattern.acquisitionPatterns.some((re) => re.test(line));
        if (isAcquisition) {
            let isContained = pattern.containerPatterns.some((re) => re.test(line));
            if (!isContained) {
                // Check immediate preceding lines for container enclosing invocation
                for (let back = 1; back <= 3 && idx - back >= 0; back++) {
                    const prev = maskedLines[idx - back].trim();
                    if (pattern.containerPatterns.some((re) => re.test(prev))) {
                        isContained = true;
                        break;
                    }
                    if (prev.endsWith(';') || prev.endsWith('}')) break;
                }
            }

            if (!isContained) {
                const assignMatch = VARIABLE_ASSIGNMENT_RE.exec(line);
                if (assignMatch) {
                    pendingVar = assignMatch[1];
                    pendingLine = lineNum;
                } else {
                    violations.push({
                        line: lineNum,
                        rawText: trimmed,
                        reason: 'unregistered',
                    });
                }
            }
        } else if (pendingVar !== null) {
            const isRegistered = pattern.containerPatterns.some(
                (re) => re.test(line) && line.includes(pendingVar as string),
            );
            if (isRegistered) {
                pendingVar = null;
                pendingLine = -1;
            } else if (lineNum - pendingLine > windowSize) {
                violations.push({
                    line: pendingLine,
                    rawText: maskedLines[pendingLine - 1]?.trim() ?? '',
                    resourceIdentifier: pendingVar,
                    reason: 'untracked',
                });
                pendingVar = null;
                pendingLine = -1;
            }
        }
    }

    if (pendingVar !== null && pendingLine > 0) {
        violations.push({
            line: pendingLine,
            rawText: maskedLines[pendingLine - 1]?.trim() ?? '',
            resourceIdentifier: pendingVar,
            reason: 'untracked',
        });
    }

    return violations;
}

/**
 * Scan source lines for synchronous blocking call invocations.
 *
 * @param maskedLines - Masked source lines.
 * @param pattern - Blocking call configuration.
 * @returns Array of discovered blocking call violations.
 */
export function matchBlockingCalls(
    maskedLines: readonly string[],
    pattern: BlockingCallPattern,
): BlockingCallViolation[] {
    const violations: BlockingCallViolation[] = [];

    for (let idx = 0; idx < maskedLines.length; idx++) {
        const line = maskedLines[idx];
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        for (const re of pattern.blockingCalls) {
            const match = re.exec(line);
            if (match) {
                violations.push({
                    line: idx + 1,
                    rawText: trimmed,
                    callName: match[0].replace(/\s*\($/, ''),
                });
                break;
            }
        }
    }

    return violations;
}

/**
 * Scan source lines for transient heap allocations within high-frequency hot paths.
 *
 * @param maskedLines - Masked source lines.
 * @param pattern - Hot path configuration defining scopes and allocation patterns.
 * @returns Array of discovered hot path violations.
 */
export function matchHotPathAllocations(
    maskedLines: readonly string[],
    pattern: HotPathPattern,
): HotPathViolation[] {
    const violations: HotPathViolation[] = [];
    let currentHotIndent: number | null = null;
    let currentScopeName = '';

    for (let idx = 0; idx < maskedLines.length; idx++) {
        const line = maskedLines[idx];
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        const indent = line.search(/\S/);

        if (currentHotIndent !== null) {
            if (indent <= currentHotIndent) {
                currentHotIndent = null;
                currentScopeName = '';
            } else {
                const isExempt = pattern.poolExemptions?.some((re) => re.test(line)) ?? false;
                if (!isExempt) {
                    for (const allocRe of pattern.allocationPatterns) {
                        const match = allocRe.exec(line);
                        if (match) {
                            violations.push({
                                line: idx + 1,
                                rawText: trimmed,
                                scopeName: currentScopeName,
                                allocationType: match[0],
                            });
                            break;
                        }
                    }
                }
            }
        }

        if (currentHotIndent === null) {
            for (const scopeRe of pattern.hotPathScopes) {
                const match = scopeRe.exec(line);
                if (match) {
                    currentHotIndent = indent;
                    currentScopeName = match[0].trim();
                    break;
                }
            }
        }
    }

    return violations;
}

/**
 * Check if the target file represents a protected source layer.
 *
 * @param filePath - Normalized relative file path.
 * @param maskedLines - Masked source lines.
 * @param pattern - Boundary isolation pattern.
 * @returns True if the target file matches protected source layer indicators.
 */
function isProtectedLayer(
    filePath: string,
    maskedLines: readonly string[],
    pattern: BoundaryIsolationPattern,
): boolean {
    const normalized = filePath.toLowerCase();
    for (const indicator of pattern.sourceLayerIndicators) {
        if (typeof indicator === 'string') {
            if (normalized.includes(indicator.toLowerCase())) return true;
        } else if (indicator.test(filePath)) {
            return true;
        }
    }

    // Inspect top 30 header lines for annotations or declarations
    const checkLimit = Math.min(maskedLines.length, 30);
    for (let i = 0; i < checkLimit; i++) {
        const line = maskedLines[i].trim();
        for (const indicator of pattern.sourceLayerIndicators) {
            if (typeof indicator === 'string') {
                if (line.includes(indicator)) return true;
            } else if (indicator.test(line)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Scan source lines for forbidden architectural boundary crossings.
 *
 * @param filePath - Target file path.
 * @param maskedLines - Masked source lines.
 * @param pattern - Boundary isolation pattern.
 * @returns Array of discovered boundary violations.
 */
export function matchBoundaryIsolation(
    filePath: string,
    maskedLines: readonly string[],
    pattern: BoundaryIsolationPattern,
): BoundaryIsolationViolation[] {
    if (!isProtectedLayer(filePath, maskedLines, pattern)) {
        return [];
    }

    const violations: BoundaryIsolationViolation[] = [];
    for (let idx = 0; idx < maskedLines.length; idx++) {
        const line = maskedLines[idx];
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        for (const target of pattern.forbiddenTargets) {
            const matches = typeof target === 'string' ? line.includes(target) : target.test(line);

            if (matches) {
                violations.push({
                    line: idx + 1,
                    rawText: trimmed,
                    targetIdentifier: typeof target === 'string' ? target : target.source,
                });
                break;
            }
        }
    }

    return violations;
}

/**
 * Scan raw source lines for un-localized presentation string literals.
 *
 * @param rawLines - Raw source lines preserving string literal values.
 * @param pattern - Presentation literal configuration.
 * @returns Array of discovered presentation literal violations.
 */
export function matchPresentationLiterals(
    rawLines: readonly string[],
    pattern: PresentationLiteralPattern,
): PresentationLiteralViolation[] {
    const violations: PresentationLiteralViolation[] = [];

    for (let idx = 0; idx < rawLines.length; idx++) {
        const rawLine = rawLines[idx];
        const trimmed = rawLine.trim();
        if (trimmed.length === 0) continue;

        for (const sinkRe of pattern.presentationSinks) {
            const sinkMatch = sinkRe.exec(rawLine);
            if (sinkMatch) {
                const isWrapped = pattern.i18nWrappers.some((wrapperRe) => wrapperRe.test(rawLine));
                if (!isWrapped) {
                    const literal = sinkMatch[1] ?? sinkMatch[0];
                    violations.push({
                        line: idx + 1,
                        literalText: literal,
                        sinkExpression: sinkMatch[0],
                    });
                    break;
                }
            }
        }
    }

    return violations;
}

/**
 * Matches control flow and dataflow invariants (floating promises, unguarded nulls, resource closures).
 * Concurrency: Thread-safe, reentrant, creates isolated in-memory graph per call.
 *
 * @param lines - Source code lines.
 * @param baseLine - Base line offset (1-based).
 * @returns Discovered flow analysis violations.
 */
export function matchControlFlowInvariants(
    lines: readonly string[],
    baseLine = 1,
): FlowAnalysisResult {
    const builder = new CfgBuilder();
    const cfg = builder.buildFromLines(lines, baseLine);
    return DefUseAnalyzer.analyze(cfg);
}
