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
 * Compiled representation of boundary isolation targets and indicators
 * for high-performance matching.
 */
interface CompiledBoundaryTarget {
    readonly id: string;
    readonly matcher: RegExp;
}

interface CompiledBoundaryPattern {
    readonly filePathRegex: RegExp | null;
    readonly fileRegexes: readonly RegExp[];
    readonly headerRegex: RegExp | null;
    readonly headerRegexes: readonly RegExp[];
    readonly targets: readonly CompiledBoundaryTarget[];
    readonly targetsFilterRegex: RegExp | null;
}

/** Global weak-reference object reuse cache for compiled boundary patterns. */
const boundaryPatternCache = new WeakMap<BoundaryIsolationPattern, CompiledBoundaryPattern>();

/**
 * Escapes regex control characters in a string literal.
 *
 * @param str - Input string to escape.
 * @returns Escaped regex string safe for RegExp construction.
 */
function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Global RegExp object cache pool to eliminate redundant allocations (PRF-MEM-001). */
const REGEXP_CACHE_POOL = new Map<string, RegExp>();

function getOrCreateRegExp(pattern: string, flags?: string): RegExp {
    const key = flags ? `${flags}:${pattern}` : pattern;
    let cached = REGEXP_CACHE_POOL.get(key);
    if (!cached) {
        cached = new RegExp(pattern, flags);
        REGEXP_CACHE_POOL.set(key, cached);
    }
    return cached;
}

/**
 * Compiles and indexes boundary isolation rules into unified expressions and target mappings.
 *
 * @param pattern - Architectural boundary isolation pattern.
 * @returns Precompiled pattern matcher descriptors.
 */
function compileBoundaryPattern(pattern: BoundaryIsolationPattern): CompiledBoundaryPattern {
    const stringIndicators: string[] = [];
    const indicatorRegexSet = new Set<RegExp>();

    for (let i = 0; i < pattern.sourceLayerIndicators.length; i++) {
        const ind = pattern.sourceLayerIndicators[i];
        if (typeof ind === 'string') {
            stringIndicators.push(ind);
        } else {
            indicatorRegexSet.add(ind);
        }
    }
    const indicatorRegexes = Array.from(indicatorRegexSet);

    const filePathRegex =
        stringIndicators.length > 0
            ? getOrCreateRegExp(
                  stringIndicators.map((s) => escapeRegExp(s.toLowerCase())).join('|'),
              )
            : null;

    const headerRegex =
        stringIndicators.length > 0
            ? getOrCreateRegExp(stringIndicators.map((s) => escapeRegExp(s)).join('|'))
            : null;

    const targets: CompiledBoundaryTarget[] = [];
    const targetPatternStrings: string[] = [];

    for (let i = 0; i < pattern.forbiddenTargets.length; i++) {
        const t = pattern.forbiddenTargets[i];
        if (typeof t === 'string') {
            const escaped = escapeRegExp(t);
            targets.push({
                id: t,
                matcher: getOrCreateRegExp(escaped),
            });
            targetPatternStrings.push(escaped);
        } else {
            const matcher = t.global ? getOrCreateRegExp(t.source, t.flags.replace('g', '')) : t;
            targets.push({
                id: t.source,
                matcher,
            });
            targetPatternStrings.push(t.source);
        }
    }

    const targetsFilterRegex =
        targetPatternStrings.length > 0 ? getOrCreateRegExp(targetPatternStrings.join('|')) : null;

    return {
        filePathRegex,
        fileRegexes: indicatorRegexes,
        headerRegex,
        headerRegexes: indicatorRegexes,
        targets,
        targetsFilterRegex,
    };
}

/**
 * Retrieves or builds a cached compiled boundary pattern descriptor.
 *
 * @param pattern - Source boundary isolation pattern.
 * @returns Cached or freshly compiled pattern descriptor.
 */
function getCompiledBoundaryPattern(pattern: BoundaryIsolationPattern): CompiledBoundaryPattern {
    let cached = boundaryPatternCache.get(pattern);
    if (!cached) {
        cached = compileBoundaryPattern(pattern);
        boundaryPatternCache.set(pattern, cached);
    }
    return cached;
}

/**
 * Tests whether any regular expression in the collection matches the target text.
 * Avoids per-iteration closure allocation and provides immediate short-circuiting.
 *
 * @param patterns - Collection of regular expression patterns to test.
 * @param text - Target source line text to evaluate.
 * @returns True if at least one regular expression matches, false otherwise.
 */
export function testAnyPattern(patterns: readonly RegExp[], text: string): boolean {
    for (let i = 0; i < patterns.length; i++) {
        if (patterns[i].test(text)) {
            return true;
        }
    }
    return false;
}

/**
 * Scans preceding source lines to verify if the allocation is enclosed in a registration container.
 *
 * @param maskedLines - Masked source lines.
 * @param idx - Index of the current line under inspection.
 * @param containerPatterns - Regular expressions defining valid container invocations.
 * @returns True if an enclosing container invocation is found within the backward search window.
 */
export function checkPrecedingContainerInvocation(
    maskedLines: readonly string[],
    idx: number,
    containerPatterns: readonly RegExp[],
): boolean {
    const minIdx = Math.max(0, idx - 3);
    for (let current = idx - 1; current >= minIdx; current--) {
        const prev = maskedLines[current].trim();
        if (testAnyPattern(containerPatterns, prev)) {
            return true;
        }
        if (prev.endsWith(';') || prev.endsWith('}')) {
            break;
        }
    }
    return false;
}

/**
 * Checks if the current line or preceding lines enclose the acquisition in a container.
 *
 * @param line - Current source line text.
 * @param idx - Current line index in maskedLines array.
 * @param maskedLines - Masked source lines.
 * @param containerPatterns - Regular expressions matching container registration.
 * @returns True if acquisition is enclosed in a container invocation.
 */
function isEnclosedInContainer(
    line: string,
    idx: number,
    maskedLines: readonly string[],
    containerPatterns: readonly RegExp[],
): boolean {
    if (testAnyPattern(containerPatterns, line)) {
        return true;
    }
    return checkPrecedingContainerInvocation(maskedLines, idx, containerPatterns);
}

/**
 * Records an untracked lifecycle violation for an un-registered variable.
 *
 * @param violations - Violation accumulator array.
 * @param maskedLines - Masked source lines.
 * @param line - Line number of the pending allocation.
 * @param resourceId - Identifier of the unmanaged variable.
 */
function recordUntrackedViolation(
    violations: ResourceLifecycleViolation[],
    maskedLines: readonly string[],
    line: number,
    resourceId: string,
): void {
    violations.push({
        line,
        rawText: maskedLines[line - 1]?.trim() ?? '',
        resourceIdentifier: resourceId,
        reason: 'untracked',
    });
}

/**
 * Evaluates an acquisition line, extracting variable assignment or recording
 * unregistered violation.
 *
 * @param line - Current source line text.
 * @param lineNum - 1-based source line number.
 * @param trimmed - Trimmed source line text.
 * @param idx - Current line index in maskedLines array.
 * @param maskedLines - Masked source lines.
 * @param containerPatterns - Container registration regular expressions.
 * @param violations - Violation accumulator array.
 * @returns Captured variable name if assigned, or null otherwise.
 */
function handleAcquisition(
    line: string,
    lineNum: number,
    trimmed: string,
    idx: number,
    maskedLines: readonly string[],
    containerPatterns: readonly RegExp[],
    violations: ResourceLifecycleViolation[],
): string | null {
    if (isEnclosedInContainer(line, idx, maskedLines, containerPatterns)) {
        return null;
    }
    const assignMatch = VARIABLE_ASSIGNMENT_RE.exec(line);
    if (assignMatch) {
        return assignMatch[1];
    }
    violations.push({
        line: lineNum,
        rawText: trimmed,
        reason: 'unregistered',
    });
    return null;
}

/**
 * Tests whether a pending tracked resource is registered in a container on the current line.
 *
 * @param line - Source line text.
 * @param pendingVar - Variable name of the pending resource.
 * @param containerPatterns - Container registration patterns.
 * @returns True if registered on this line.
 */
function isPendingRegistered(
    line: string,
    pendingVar: string,
    containerPatterns: readonly RegExp[],
): boolean {
    return line.includes(pendingVar) && testAnyPattern(containerPatterns, line);
}

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

        if (testAnyPattern(pattern.acquisitionPatterns, line)) {
            const acquiredVar = handleAcquisition(
                line,
                lineNum,
                trimmed,
                idx,
                maskedLines,
                pattern.containerPatterns,
                violations,
            );
            if (acquiredVar !== null) {
                pendingVar = acquiredVar;
                pendingLine = lineNum;
            }
        } else if (pendingVar !== null) {
            if (isPendingRegistered(line, pendingVar, pattern.containerPatterns)) {
                pendingVar = null;
                pendingLine = -1;
            } else if (lineNum - pendingLine > windowSize) {
                recordUntrackedViolation(violations, maskedLines, pendingLine, pendingVar);
                pendingVar = null;
                pendingLine = -1;
            }
        }
    }

    if (pendingVar !== null) {
        recordUntrackedViolation(violations, maskedLines, pendingLine, pendingVar);
    }

    return violations;
}

/**
 * Scans a source line for the first matching blocking call regular expression.
 *
 * @param line - Source line text.
 * @param blockingCalls - Regular expressions identifying blocking operations.
 * @returns Matched blocking function name, or null if none matched.
 */
function findBlockingCallInLine(line: string, blockingCalls: readonly RegExp[]): string | null {
    for (let i = 0; i < blockingCalls.length; i++) {
        const match = blockingCalls[i].exec(line);
        if (match) {
            return match[0].replace(/\s*\($/, '');
        }
    }
    return null;
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

        const callName = findBlockingCallInLine(line, pattern.blockingCalls);
        if (callName !== null) {
            violations.push({
                line: idx + 1,
                rawText: trimmed,
                callName,
            });
        }
    }

    return violations;
}

/**
 * Finds the first matching hot-path scope pattern on a line.
 *
 * @param line - Source line text.
 * @param scopes - Hot-path scope boundary regular expressions.
 * @returns Trimmed matched scope name, or null if line is not a hot-path scope header.
 */
function findMatchingScope(line: string, scopes: readonly RegExp[]): string | null {
    for (let i = 0; i < scopes.length; i++) {
        const match = scopes[i].exec(line);
        if (match) {
            return match[0].trim();
        }
    }
    return null;
}

/**
 * Evaluates allocation patterns for a source line within an active hot-path scope.
 *
 * @param line - Raw line text.
 * @param trimmed - Whitespace-trimmed line text.
 * @param lineNum - 1-based source line number.
 * @param pattern - Hot path configuration defining allocation patterns and exemptions.
 * @param violations - Violation accumulator array.
 * @param currentScopeName - Active hot-path scope identifier.
 */
export function checkHotPathAllocationsInLine(
    line: string,
    trimmed: string,
    lineNum: number,
    pattern: HotPathPattern,
    violations: HotPathViolation[],
    currentScopeName: string,
): void {
    if (pattern.poolExemptions && testAnyPattern(pattern.poolExemptions, line)) {
        return;
    }
    for (let i = 0; i < pattern.allocationPatterns.length; i++) {
        const allocRe = pattern.allocationPatterns[i];
        const match = allocRe.exec(line);
        if (match) {
            violations.push({
                line: lineNum,
                rawText: trimmed,
                scopeName: currentScopeName,
                allocationType: match[0],
            });
            break;
        }
    }
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
                checkHotPathAllocationsInLine(
                    line,
                    trimmed,
                    idx + 1,
                    pattern,
                    violations,
                    currentScopeName,
                );
            }
        }

        if (currentHotIndent === null) {
            const matchedScope = findMatchingScope(line, pattern.hotPathScopes);
            if (matchedScope !== null) {
                currentHotIndent = indent;
                currentScopeName = matchedScope;
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
    const compiled = getCompiledBoundaryPattern(pattern);
    const normalized = filePath.toLowerCase();

    if (compiled.filePathRegex && compiled.filePathRegex.test(normalized)) {
        return true;
    }
    if (testAnyPattern(compiled.fileRegexes, filePath)) {
        return true;
    }

    const checkLimit = Math.min(maskedLines.length, 30);
    for (let i = 0; i < checkLimit; i++) {
        const line = maskedLines[i].trim();
        if (line.length === 0) continue;
        if (compiled.headerRegex && compiled.headerRegex.test(line)) {
            return true;
        }
        if (testAnyPattern(compiled.headerRegexes, line)) {
            return true;
        }
    }

    return false;
}

/**
 * Finds the first matching forbidden target identifier in the source line.
 *
 * @param line - Source line text.
 * @param targets - Precompiled forbidden target descriptors.
 * @returns Target identifier if matched, or null otherwise.
 */
function findMatchingForbiddenTarget(
    line: string,
    targets: readonly CompiledBoundaryTarget[],
): string | null {
    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        if (target.matcher.test(line)) {
            return target.id;
        }
    }
    return null;
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

    const compiled = getCompiledBoundaryPattern(pattern);
    const violations: BoundaryIsolationViolation[] = [];

    for (let idx = 0; idx < maskedLines.length; idx++) {
        const line = maskedLines[idx];
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        if (compiled.targetsFilterRegex && !compiled.targetsFilterRegex.test(line)) {
            continue;
        }

        const targetId = findMatchingForbiddenTarget(line, compiled.targets);
        if (targetId !== null) {
            violations.push({
                line: idx + 1,
                rawText: trimmed,
                targetIdentifier: targetId,
            });
        }
    }

    return violations;
}

/**
 * Inspects a source line for un-localized presentation sink violations.
 *
 * @param rawLine - Raw source line text.
 * @param lineNum - 1-based source line number.
 * @param pattern - Presentation literal configuration.
 * @returns Violation descriptor if found, or null otherwise.
 */
function findPresentationViolationInLine(
    rawLine: string,
    lineNum: number,
    pattern: PresentationLiteralPattern,
): PresentationLiteralViolation | null {
    for (let i = 0; i < pattern.presentationSinks.length; i++) {
        const sinkRe = pattern.presentationSinks[i];
        const sinkMatch = sinkRe.exec(rawLine);
        if (sinkMatch && !testAnyPattern(pattern.i18nWrappers, rawLine)) {
            const literal = sinkMatch[1] ?? sinkMatch[0];
            return {
                line: lineNum,
                literalText: literal,
                sinkExpression: sinkMatch[0],
            };
        }
    }
    return null;
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

        const violation = findPresentationViolationInLine(rawLine, idx + 1, pattern);
        if (violation !== null) {
            violations.push(violation);
        }
    }

    return violations;
}

/**
 * Matches control flow and dataflow invariants (floating promises, unguarded nulls, resource
 * closures).
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
