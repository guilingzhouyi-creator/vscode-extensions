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

/**
 * Maximum window of lines inside a loop body inspected for allocations and blocking I/O.
 */
const MAX_LOOP_INSPECTION_WINDOW_LINES = 30;

/** Default scale collection variable name when loop target cannot be parsed. */
const DEFAULT_SCALE_VAR = 'dynamicCollection';

/**
 * Loop headers the engine treats as iteration sites across TS/JS, Python, Rust, Go, GDScript.
 */
const LOOP_HEADER_RE =
    /\b(?:for\s*\(|for\s+[a-zA-Z0-9_$]+(?:\s*,\s*[a-zA-Z0-9_$]+)?\s*(?:in|range|:=)|for\s*\{|while\s*\(|while\s+[^{:\n]+|loop\s*\{|do\s*\{)\b/;

/**
 * Transient heap allocation patterns per language runtime.
 */
const TRANSIENT_TS_CONTAINER_RE =
    /\b(?:new\s+(?:Array|Object|Map|Set|WeakMap|WeakSet|Int[0-9]+Array|Uint[0-9]+Array|Float[0-9]+Array)|\/duplicate\(true\)|\.clone\()/;

const TRANSIENT_GO_RE = /\b(?:make\s*\(\s*(?:\[\]|map\[|chan\b)|&[A-Z][a-zA-Z0-9_]*\{|\.clone\()/;

const TRANSIENT_RUST_RE =
    /\b(?:(?:Vec|Box|String|HashMap|BTreeMap|HashSet|BTreeSet)::(?:new|with_capacity)\s*\(|\.clone\()/;

const TRANSIENT_PYTHON_RE = /(?:(?<![.\w])(?:list|dict|set)\s*\(|\.copy\()/;

const TRANSIENT_GDSCRIPT_RE = /\b(?:\/duplicate\(true\)|\.duplicate\()/;

/**
 * Select the appropriate transient allocation regex based on file path extension.
 *
 * @param filePath - Path of the file being inspected.
 * @returns Pre-compiled regex matching transient container allocations in that runtime.
 */
function resolveTransientRegex(filePath: string): RegExp {
    if (filePath.endsWith('.py')) return TRANSIENT_PYTHON_RE;
    if (filePath.endsWith('.go')) return TRANSIENT_GO_RE;
    if (filePath.endsWith('.rs')) return TRANSIENT_RUST_RE;
    if (filePath.endsWith('.gd')) return TRANSIENT_GDSCRIPT_RE;
    return TRANSIENT_TS_CONTAINER_RE;
}

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
    for (let l = headerLine; l <= cap; l++) {
        const lineStr = masked[l - 1] ?? '';
        const startCharIdx = l === headerLine ? Math.max(0, lineStr.lastIndexOf(')')) : 0;
        for (let c = startCharIdx; c < lineStr.length; c++) {
            const ch = lineStr[c];
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

    const afterParen = header.slice(header.lastIndexOf(')') + 1);
    if (header.indexOf('{', header.lastIndexOf(')') + 1) >= 0) {
        return { from: headerLine, to: braceMatchedEnd(targetLines, headerLine, cap) };
    }
    if (afterParen.trim().length > 0) return { from: headerLine, to: headerLine };
    for (let l = headerLine + 1; l <= cap; l++) {
        if ((targetLines[l - 1] ?? '').trim().length > 0) return { from: headerLine, to: l };
    }
    return { from: headerLine, to: headerLine };
}

const MUTATION_RE =
    /(?:[=+\-*/%&|^]|\b(?:push|pop|shift|unshift|set|add|delete|clear|splice|return|break|yield|throw)\b)/;
const SIDE_EFFECT_RE =
    /(?:console\.|fs\.|print\s*\(|write\s*\(|\.write\s*\(|send\s*\(|\.send\s*\(|emit\s*\(|emit_signal\s*\(|\.emit\s*\(|\.set\s*\(|\.delete\s*\(|\.add\s*\(|\.push\s*\(|\b(?:dispose|close|destroy|cleanup|release|cancel|unsubscribe|flush|disconnect|dispatchEvent)\b|\bawait\b|\b[A-Za-z0-9_$]+\s*\()/;

function isCommentLine(trimmed: string): boolean {
    return (
        trimmed.startsWith('//') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
    );
}

function extractLoopStatementText(trimmed: string): string | null {
    if (!LOOP_HEADER_RE.test(trimmed)) {
        return trimmed;
    }
    const lastClose = trimmed.lastIndexOf(')');
    if (lastClose < 0) return null;
    const afterParen = trimmed
        .slice(lastClose + 1)
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
 * @param to - Last body line (inclusive, 1-based).
 * @param transientRegex - Pre-compiled regex matching transient container allocations.
 * @returns Flags the complexity rules report on.
 */
function inspectLoopBody(
    lines: string[],
    from: number,
    to: number,
    transientRegex: RegExp = TRANSIENT_TS_CONTAINER_RE,
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

    for (let l = from; l <= to && l <= lines.length; l++) {
        const lineInfo = inspectSingleLoopLine(lines[l - 1] ?? '', transientRegex);
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
    const lines = Array.isArray(contentOrLines)
        ? contentOrLines
        : contentOrLines
          ? contentOrLines.split('\n')
          : [];
    const sites: LoopSite[] = [];
    const startLine = fnNode.start?.line ?? 1;
    const endLine = fnNode.end?.line ?? lines.length;
    const transientRegex = resolveTransientRegex(filePath);

    for (let l = startLine; l <= endLine && l <= lines.length; l++) {
        const lineText = lines[l - 1] ?? '';
        const trimmed = lineText.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
        if (!LOOP_HEADER_RE.test(lineText)) continue;

        const scaleVariable = resolveLoopScaleVariable(lineText);
        const body = loopBodyRange(masked, l, endLine, lines);
        sites.push({
            file: filePath,
            line: l,
            symbol: fnSymbol,
            isBounded: isBoundedCollection(scaleVariable),
            scaleVariable,
            ...inspectLoopBody(lines, body.from, body.to, transientRegex),
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

/**
 * Cyclomatic complexity of a function-like node: base 1 + sum of `branchWeight` over every
 * decision point inside it, NOT descending into nested function-like nodes.
 */
function walkChildrenCC(node: NormalizedNode): number {
    let sum = 0;
    const kids = node.children;
    if (!kids) return 0;
    for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.functionLike) continue;
        sum += (c.branchWeight || 0) + walkChildrenCC(c);
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
