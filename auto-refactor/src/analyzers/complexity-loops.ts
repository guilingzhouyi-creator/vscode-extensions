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

import type { NormalizedNode } from '../core/ast/multilang';
import type { LoopSite } from '../core/intelligence/semanticComplexity';
import { isBoundedCollection } from '../core/intelligence/semanticComplexity';
import { calculateLoopStateEntropy } from '../core/intelligence/payload-density';
import { isCommentLine } from '../core/scanner/text-scanner-utils';
import type { AllocationSiteContext } from '../core/intelligence/resource-pooling-auditor';
import type { RoutineSemanticDescriptor } from '../core/intelligence/semantic-domain-detector';
import { REGEX } from '../core/constants';

/**
 * Maximum window of lines inside a loop body inspected for allocations and blocking I/O.
 */
const MAX_LOOP_INSPECTION_WINDOW_LINES = 30;

/** Default scale collection variable name when loop target cannot be parsed. */
const DEFAULT_SCALE_VAR = 'dynamicCollection';

/** Loop headers the engine treats as iteration sites across TS/JS, Python, Rust, Go, GDScript. */
const LOOP_HEADER_RE = REGEX.SYNTAX.LOOP_HEADER;

/** Synchronous I/O calls that amplify its cost when run once per iteration. */
const BLOCKING_IO_RE = REGEX.SYNTAX.BLOCKING_IO;

/**
 * Select the appropriate transient allocation regex based on file path extension.
 *
 * @param filePath - Path of the file being inspected.
 * @returns Pre-compiled regex matching transient container allocations in that runtime.
 */
function resolveTransientRegex(filePath: string): RegExp {
    if (filePath.endsWith('.py')) return REGEX.PYTHON.TRANSIENT_ALLOCATION;
    if (filePath.endsWith('.go')) return REGEX.GO.TRANSIENT_ALLOCATION;
    if (filePath.endsWith('.rs')) return REGEX.RUST.TRANSIENT_ALLOCATION;
    if (filePath.endsWith('.gd')) return REGEX.GDSCRIPT.TRANSIENT_ALLOCATION;
    return REGEX.SYNTAX.TRANSIENT_TS_CONTAINER;
}

/**
 * Resolve the variable or expression a loop is bounded by.
 *
 * @param lineText - Raw loop header line.
 * @returns The iterated expression, or the generic fallback when the header is unusual.
 */
function resolveLoopScaleVariable(lineText: string): string {
    const ofInMatch = lineText.match(
        /\bfor\s*(?:\([^;]+?(?:of|in)\s+([^);{]+)|[A-Za-z0-9_$,\s]+\s+(?:in|range)\s+([^:#{\n]+))/,
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
    const firstLineStr = masked[headerLine - 1] ?? '';
    const firstCharIdx = Math.max(0, firstLineStr.lastIndexOf(')'));
    for (let lineIdx = headerLine; lineIdx <= cap; lineIdx++) {
        const lineStr = masked[lineIdx - 1] ?? '';
        const startCharIdx = lineIdx === headerLine ? firstCharIdx : 0;
        for (let charIdx = startCharIdx; charIdx < lineStr.length; charIdx++) {
            const charToken = lineStr[charIdx];
            if (charToken === '{') depth++;
            else if (charToken === '}') {
                depth--;
                if (depth <= 0) return lineIdx;
            }
        }
    }
    return cap;
}

function indentationLoopBodyEnd(
    targetLines: string[],
    headerLine: number,
    baseIndent: number,
    cap: number,
): number {
    let lastBodyLine = headerLine;
    for (let lineIdx = headerLine + 1; lineIdx <= cap; lineIdx++) {
        const line = targetLines[lineIdx - 1] ?? '';
        const trimmedLine = line.trim();
        if (
            trimmedLine.length === 0 ||
            trimmedLine.startsWith('#') ||
            trimmedLine.startsWith('//')
        ) {
            continue;
        }
        const lineIndent = line.length - line.trimStart().length;
        if (lineIndent > baseIndent) {
            lastBodyLine = lineIdx;
        } else {
            break;
        }
    }
    return Math.max(headerLine + 1, lastBodyLine);
}

/**
 * Locate the first and last line of a loop body.
 *
 * @param masked - Masked lines of the file, so braces inside strings never unbalance the match.
 * @param headerLine - 1-based line of the loop header.
 * @param endLine - Last line that may belong to the body (function end).
 * @param rawLines - Raw file lines to fall back on when the masked line is completely blanked.
 * @returns Inclusive 1-based line range of the body.
 */
function loopBodyRange(
    masked: string[],
    headerLine: number,
    endLine: number,
    rawLines: string[] = [],
): { from: number; to: number } {
    const cap = Math.min(endLine, headerLine + MAX_LOOP_INSPECTION_WINDOW_LINES);
    if (masked.length === 0) {
        return { from: headerLine, to: cap };
    }
    let targetLines = masked;
    let header = masked[headerLine - 1] ?? '';
    if (header.trim().length === 0 && rawLines.length >= headerLine) {
        targetLines = rawLines;
        header = rawLines[headerLine - 1] ?? '';
    }

    // Python / GDScript indentation-based loop: header ends with ':' and does not contain '{'
    const trimmedHeader = header.trim();
    if (trimmedHeader.endsWith(':') && !header.includes('{')) {
        const baseIndent = header.length - header.trimStart().length;
        return {
            from: headerLine + 1,
            to: indentationLoopBodyEnd(targetLines, headerLine, baseIndent, cap),
        };
    }

    const afterParen = header.slice(header.lastIndexOf(')') + 1);
    if (header.indexOf('{', header.lastIndexOf(')') + 1) >= 0) {
        return { from: headerLine, to: braceMatchedEnd(targetLines, headerLine, cap) };
    }
    if (afterParen.trim().length > 0) return { from: headerLine, to: headerLine };
    for (let lineIdx = headerLine + 1; lineIdx <= cap; lineIdx++) {
        if ((targetLines[lineIdx - 1] ?? '').trim().length > 0)
            return { from: headerLine, to: lineIdx };
    }
    return { from: headerLine, to: headerLine };
}

const MUTATION_RE =
    /(?:[=+\-*/%&|^]|\b(?:push|pop|shift|unshift|set|add|delete|clear|splice|return|break|yield|throw)\b)/;
const SIDE_EFFECT_RE =
    /(?:console\.|fs\.|print\s*\(|write\s*\(|\.write\s*\(|send\s*\(|\.send\s*\(|emit\s*\(|emit_signal\s*\(|\.emit\s*\(|\.set\s*\(|\.delete\s*\(|\.add\s*\(|\.push\s*\(|\b(?:dispose|close|destroy|cleanup|release|cancel|unsubscribe|flush|disconnect|dispatchEvent)\b|\bawait\b|\b[A-Za-z0-9_$]+\s*\()/;

function extractLoopStatementText(trimmed: string): string | null {
    if (!LOOP_HEADER_RE.test(trimmed)) {
        return trimmed;
    }
    if (trimmed.endsWith(':') && !trimmed.includes('{')) {
        return null;
    }
    const openParen = trimmed.indexOf('(');
    if (openParen < 0) return null;
    let depth = 0;
    let headerClose = -1;
    for (let i = openParen; i < trimmed.length; i++) {
        if (trimmed[i] === '(') depth++;
        else if (trimmed[i] === ')') {
            depth--;
            if (depth === 0) {
                headerClose = i;
                break;
            }
        }
    }
    if (headerClose < 0) return null;
    const afterParen = trimmed
        .slice(headerClose + 1)
        .replace(/[{}]/g, '')
        .trim();
    return afterParen.length > 0 ? afterParen : null;
}

function isPunctuationOrPass(text: string): boolean {
    return text.length === 0 || text === '{' || text === '}' || text === 'pass';
}

interface LoopLineInspection {
    isEffective: boolean;
    isMutation: boolean;
    hasSideEffect: boolean;
    hasTransient: boolean;
    hasBlockingIo: boolean;
}

function inspectSingleLoopLine(txt: string, transientRegex: RegExp): LoopLineInspection {
    const trimmed = txt.trim();
    if (isCommentLine(trimmed)) {
        return {
            isEffective: false,
            isMutation: false,
            hasSideEffect: false,
            hasTransient: false,
            hasBlockingIo: false,
        };
    }
    const statementText = extractLoopStatementText(trimmed);
    const isEffective = Boolean(statementText && !isPunctuationOrPass(statementText));
    const isMutation = Boolean(statementText && isEffective && MUTATION_RE.test(statementText));
    const hasSideEffect = Boolean(
        statementText && isEffective && SIDE_EFFECT_RE.test(statementText),
    );
    const hasTransient = transientRegex.test(txt);
    const hasBlockingIo = BLOCKING_IO_RE.test(txt);

    return { isEffective, isMutation, hasSideEffect, hasTransient, hasBlockingIo };
}

/**
 * Scan the source lines spanning a loop body to detect transient heap allocations
 * and blocking synchronous I/O calls.
 *
 * @param lines - Array of full source lines.
 * @param from - First body line (inclusive, 1-based).
 * @param toLine - Last body line (inclusive, 1-based).
 * @param transientRegex - Pre-compiled regex matching transient container allocations.
 * @returns Flags the complexity rules report on.
 */
function inspectLoopBody(
    lines: string[],
    from: number,
    toLine: number,
    transientRegex: RegExp = REGEX.SYNTAX.TRANSIENT_TS_CONTAINER,
): {
    hasTransientAllocation: boolean;
    hasBlockingIo: boolean;
    isTautological: boolean;
    deltaEntropy: number;
} {
    let hasTransientAllocation = false;
    let hasBlockingIo = false;
    let stateMutationsCount = 0;
    let hasSideEffects = false;
    let effectiveStatements = 0;

    for (let lineIdx = from; lineIdx <= toLine && lineIdx <= lines.length; lineIdx++) {
        const lineInfo = inspectSingleLoopLine(lines[lineIdx - 1] ?? '', transientRegex);
        if (lineInfo.isEffective) {
            effectiveStatements++;
            if (lineInfo.isMutation) stateMutationsCount++;
            if (lineInfo.hasSideEffect) hasSideEffects = true;
        }
        if (lineInfo.hasTransient) hasTransientAllocation = true;
        if (lineInfo.hasBlockingIo) hasBlockingIo = true;
    }

    const { deltaEntropy, isTautological } = calculateLoopStateEntropy(
        Math.max(1, effectiveStatements),
        stateMutationsCount,
        hasSideEffects || hasBlockingIo,
    );

    return { hasTransientAllocation, hasBlockingIo, isTautological, deltaEntropy };
}

function isLoopHeaderCandidate(
    trimmed: string,
    lineText: string,
    isIndentedLang: boolean,
    maskedLine?: string,
): boolean {
    if (trimmed.charCodeAt(0) === 47 /* '/' */ || trimmed.charCodeAt(0) === 35 /* '#' */)
        return false;
    const testLine = maskedLine !== undefined ? maskedLine : lineText;
    if (!LOOP_HEADER_RE.test(testLine)) return false;
    if (!isIndentedLang) return true;
    if (trimmed.indexOf(':') === -1) return false;
    return /^(?:[a-zA-Z0-9_$]+:\s*)?(?:for\s|while\s)/.test(testLine.trim());
}

function resolveContentLines(contentOrLines: string | string[]): string[] {
    if (Array.isArray(contentOrLines)) return contentOrLines;
    if (!contentOrLines) return [];
    return contentOrLines.split('\n');
}

function getMaskedLine(masked: string[] | undefined, line1Based: number): string | undefined {
    if (!masked || line1Based > masked.length) return undefined;
    return masked[line1Based - 1];
}

function resolveFunctionLineBounds(
    fnNode: NormalizedNode,
    maxLines: number,
): { start: number; end: number } {
    const start = fnNode.start?.line ?? 1;
    const rawEnd = fnNode.end?.line ?? maxLines;
    const end = Math.min(rawEnd, maxLines);
    return { start, end };
}

/**
 * Collect the loop sites declared inside one function.
 *
 * @param fnNode - Function node being visited.
 * @param fnSymbol - Display name of the function.
 * @param filePath - File the function belongs to.
 * @param contentOrLines - Raw file content or pre-split lines.
 * @param masked - Masked lines of the same file.
 * @returns One site per detected loop header.
 */
export function findLoopSitesInFunction(
    fnNode: NormalizedNode,
    fnSymbol: string,
    filePath: string,
    contentOrLines: string | string[],
    masked: string[],
): LoopSite[] {
    const lines = resolveContentLines(contentOrLines);
    const sites: LoopSite[] = [];
    const { start: startLine, end: endLine } = resolveFunctionLineBounds(fnNode, lines.length);
    const transientRegex = resolveTransientRegex(filePath);
    const isIndentedLang = filePath.endsWith('.py') || filePath.endsWith('.gd');

    for (let lineIdx = startLine; lineIdx <= endLine; lineIdx++) {
        const lineText = lines[lineIdx - 1] ?? '';
        const trimmed = lineText.trim();
        const maskedLine = getMaskedLine(masked, lineIdx);
        if (!isLoopHeaderCandidate(trimmed, lineText, isIndentedLang, maskedLine)) continue;

        const scaleVariable = resolveLoopScaleVariable(lineText);
        const body = loopBodyRange(masked, lineIdx, endLine, lines);
        sites.push({
            file: filePath,
            line: lineIdx,
            symbol: fnSymbol,
            isBounded: isBoundedCollection(scaleVariable),
            scaleVariable,
            ...inspectLoopBody(lines, body.from, body.to, transientRegex),
        });
    }

    return sites;
}

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
    return fileFunctions.map((fnMetric) => ({
        id: `${filePath}:${fnMetric.name}:${fnMetric.startLine}`,
        filePath,
        name: fnMetric.name,
        startLine: fnMetric.startLine,
        endLine: fnMetric.endLine,
        cc: fnMetric.cc,
        loc: fnMetric.endLine - fnMetric.startLine + 1,
        fingerprint: {
            symbolTokens: new Set([fnMetric.name]),
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

/**
 * Cyclomatic complexity of a function-like node: base 1 + sum of `branchWeight` over every
 * decision point inside it, NOT descending into nested function-like nodes.
 */
function walkChildrenCC(node: NormalizedNode): number {
    let sum = 0;
    const kids = node.children;
    if (!kids) return 0;
    for (let i = 0; i < kids.length; i++) {
        const childNode = kids[i];
        if (childNode.functionLike) continue;
        sum += (childNode.branchWeight || 0) + walkChildrenCC(childNode);
    }
    return sum;
}

/**
 * Compute the cyclomatic complexity for a NormalizedNode.
 *
 * @param node - Function-like normalized AST node to compute complexity for.
 * @returns Computed cyclomatic complexity integer.
 */
export function cyclomaticComplexity(node: NormalizedNode): number {
    return 1 + walkChildrenCC(node);
}
