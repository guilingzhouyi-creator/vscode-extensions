/**
 * Module: Static Analysis Engine — Loop Site Extraction for Complexity Analysis
 * File Path: src/analyzers/complexity-loops.ts
 * Architecture Role: Extracts loop sites and per-iteration transient allocations or blocking I/O
 *   operations inside functions to detect complexity amplification.
 * Dependencies & Triggers: Consumes NormalizedNode and LoopSite types;
 *   invoked by ComplexityAnalyzer.
 * Responsibilities: Locate loop headers, match braces, identify scale variables, inspect bodies.
 * Exit Semantics & Design Rationale: Deterministic in-memory text scan with string masking.
 */

import type { NormalizedNode } from '../core/multilang';
import type { LoopSite } from '../core/intelligence/semanticComplexity';
import { isBoundedCollection } from '../core/intelligence/semanticComplexity';

/**
 * Maximum window of lines inside a loop body inspected for allocations and blocking I/O.
 */
const MAX_LOOP_INSPECTION_WINDOW_LINES = 30;

/** Default scale collection variable name when loop target cannot be parsed. */
const DEFAULT_SCALE_VAR = 'dynamicCollection';

/**
 * Loop headers the engine treats as iteration sites.
 */
const LOOP_HEADER_RE = /\b(?:for\s*\(|for\s+[a-zA-Z0-9_$]+\s+in|while\s*\(|do\s*\{)\b/;

/**
 * Per-iteration allocation the hoist advice actually applies to.
 */
const TRANSIENT_CONTAINER_RE =
    /\b(?:new\s+(?:Array|Object|Map|Set|WeakMap|WeakSet|Int8Array|Uint8Array|Int16Array|Uint16Array|Int32Array|Uint32Array|Float32Array|Float64Array)|\/duplicate\(true\)|\.clone\()/;

/** Synchronous I/O calls that amplify its cost when run once per iteration. */
const BLOCKING_IO_RE =
    /\b(?:fs\.readFileSync|fs\.writeFileSync|execSync|spawnSync|socket\.send|db\.query)\b/;

/**
 * Resolve the variable or expression a loop is bounded by.
 *
 * @param lineText - Raw loop header line.
 * @returns The iterated expression, or the generic fallback when the header is unusual.
 */
function resolveLoopScaleVariable(lineText: string): string {
    const ofInMatch = lineText.match(
        /\bfor\s*(?:\([^;]+?(?:of|in)\s+([^);{]+)|[A-Za-z0-9_$,\s]+\s+in\s+([^:#\n]+))/,
    );
    if (ofInMatch) return (ofInMatch[1] || ofInMatch[2] || DEFAULT_SCALE_VAR).trim();
    const cStyleMatch = lineText.match(/;\s*[^<>=!]+[<>=!]+\s*([^;]+);/);
    return cStyleMatch ? cStyleMatch[1].trim() : DEFAULT_SCALE_VAR;
}

/**
 * Find the line where a brace-delimited loop body closes.
 *
 * @param masked - Masked lines, so a brace inside a string cannot unbalance the match.
 * @param headerLine - 1-based line of the loop header.
 * @param cap - Last line the search may reach.
 * @returns 1-based closing line, or the cap when the body never closes inside it.
 */
function braceMatchedEnd(masked: string[], headerLine: number, cap: number): number {
    let depth = 0;
    for (let l = headerLine; l <= cap; l++) {
        for (const ch of masked[l - 1] ?? '') {
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth <= 0) return l;
            }
        }
    }
    return cap;
}

/**
 * Locate the first and last line of a loop body.
 *
 * @param masked - Masked lines of the file, so braces inside strings never unbalance the match.
 * @param headerLine - 1-based line of the loop header.
 * @param endLine - Last line that may belong to the body (function end).
 * @returns Inclusive 1-based line range of the body.
 */
function loopBodyRange(
    masked: string[],
    headerLine: number,
    endLine: number,
): { from: number; to: number } {
    if (masked.length === 0) {
        return {
            from: headerLine,
            to: Math.min(endLine, headerLine + MAX_LOOP_INSPECTION_WINDOW_LINES),
        };
    }
    const header = masked[headerLine - 1] ?? '';
    const afterParen = header.slice(header.lastIndexOf(')') + 1);
    if (header.indexOf('{', header.lastIndexOf(')') + 1) >= 0) {
        const cap = Math.min(endLine, headerLine + MAX_LOOP_INSPECTION_WINDOW_LINES);
        return { from: headerLine, to: braceMatchedEnd(masked, headerLine, cap) };
    }
    if (afterParen.trim().length > 0) return { from: headerLine, to: headerLine };
    for (let l = headerLine + 1; l <= endLine; l++) {
        if ((masked[l - 1] ?? '').trim().length > 0) return { from: headerLine, to: l };
    }
    return { from: headerLine, to: headerLine };
}

/**
 * Scan a loop body for per-iteration allocation and blocking I/O.
 *
 * @param lines - Raw file lines.
 * @param from - First body line (inclusive, 1-based).
 * @param to - Last body line (inclusive, 1-based).
 * @returns Flags the complexity rules report on.
 */
function inspectLoopBody(
    lines: string[],
    from: number,
    to: number,
): { hasTransientAllocation: boolean; hasBlockingIo: boolean } {
    let hasTransientAllocation = false;
    let hasBlockingIo = false;
    for (let l = from; l <= to && l <= lines.length; l++) {
        const txt = lines[l - 1] ?? '';
        if (!hasTransientAllocation && TRANSIENT_CONTAINER_RE.test(txt)) {
            hasTransientAllocation = true;
        }
        if (!hasBlockingIo && BLOCKING_IO_RE.test(txt)) hasBlockingIo = true;
        if (hasTransientAllocation && hasBlockingIo) break;
    }
    return { hasTransientAllocation, hasBlockingIo };
}

/**
 * Collect the loop sites declared inside one function.
 *
 * @param fnNode - Function node being visited.
 * @param fnSymbol - Display name of the function.
 * @param filePath - File the function belongs to.
 * @param content - Raw file content.
 * @param masked - Masked lines of the same file.
 * @returns One site per detected loop header.
 */
export function findLoopSitesInFunction(
    fnNode: NormalizedNode,
    fnSymbol: string,
    filePath: string,
    content: string,
    masked: string[],
): LoopSite[] {
    const lines = content.split('\n');
    const sites: LoopSite[] = [];
    const startLine = fnNode.start?.line ?? 1;
    const endLine = fnNode.end?.line ?? lines.length;

    for (let l = startLine; l <= endLine && l <= lines.length; l++) {
        const lineText = lines[l - 1] ?? '';
        const trimmed = lineText.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
        if (!LOOP_HEADER_RE.test(lineText)) continue;

        const scaleVariable = resolveLoopScaleVariable(lineText);
        const body = loopBodyRange(masked, l, endLine);
        sites.push({
            file: filePath,
            line: l,
            symbol: fnSymbol,
            isBounded: isBoundedCollection(scaleVariable),
            scaleVariable,
            ...inspectLoopBody(lines, body.from, body.to),
        });
    }

    return sites;
}

import type { AllocationSiteContext } from '../core/intelligence/resource-pooling-auditor';
import type { RoutineSemanticDescriptor } from '../core/intelligence/semantic-domain-detector';

function toAllocSiteContext(fnName: string, loop: LoopSite): AllocationSiteContext {
    return {
        id: `${loop.file}:${loop.line}:${loop.symbol}`,
        filePath: loop.file,
        functionName: fnName,
        line: loop.line,
        isInLoopOrHotPath: true,
        allocatedType: 'Object',
        fieldCount: 4,
        isPrimitiveOrTiny: false,
        hasExpensiveConstructor: true,
        estimatedAllocFrequency: 'loop_hot',
    };
}

function collectAllocSitesForFunction(
    fnName: string,
    loops: LoopSite[],
    out: AllocationSiteContext[],
): void {
    for (const loop of loops) {
        if (loop.hasTransientAllocation && !loop.isBounded) {
            out.push(toAllocSiteContext(fnName, loop));
        }
    }
}

/**
 * Collects allocation sites suitable for resource pooling audit from loop sites.
 *
 * @param loopSites - Map of function names to detected loop sites.
 * @returns Array of allocation site contexts.
 */
export function collectLoopAllocSites(loopSites: Map<string, LoopSite[]>): AllocationSiteContext[] {
    const allocSites: AllocationSiteContext[] = [];
    for (const [fnName, loops] of loopSites.entries()) {
        collectAllocSitesForFunction(fnName, loops, allocSites);
    }
    return allocSites;
}

/**
 * Converts file functions into routine semantic descriptors for distributed redundancy review.
 *
 * @param fileFunctions - Analyzed functions in the file.
 * @param filePath - Path of the file under analysis.
 * @returns Array of routine semantic descriptors.
 */
export function createRoutineDescriptors(
    fileFunctions: Array<{
        name: string;
        startLine: number;
        endLine: number;
        cc: number;
    }>,
    filePath: string,
): RoutineSemanticDescriptor[] {
    const domainName = filePath.split(/[\\/]/)[0] || 'default';
    return fileFunctions.map((fn) => ({
        id: `${filePath}:${fn.name}:${fn.startLine}`,
        filePath,
        name: fn.name,
        startLine: fn.startLine,
        endLine: fn.endLine,
        cc: fn.cc,
        loc: fn.endLine - fn.startLine + 1,
        fingerprint: {
            symbolTokens: new Set([fn.name]),
            domainName,
            callInDegree: 1,
            callOutDegree: 1,
            cfgSkeletonHash: 'entry->cond->exit',
            dataFlowStages: ['input', 'compute', 'return'],
            ioShape: {
                arity: 1,
                paramTypes: ['unknown'],
                returnKind: 'scalar' as const,
            },
            algorithmicSteps: ['validate', 'compute'],
            sideEffectBoundary: 'pure' as const,
            stateOwnership: 'transient' as const,
            callFrequencyHotness: 'hot_loop' as const,
        },
    }));
}
