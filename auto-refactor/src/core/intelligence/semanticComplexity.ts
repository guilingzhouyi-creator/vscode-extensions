export { analyzeCrossFunctionComplexity } from './crossFunctionComplexity';
export { MAX_COMPLEXITY_TRACE_DEPTH } from './crossFunctionComplexity';

/**
 * Module: Core Intelligence — Spatiotemporal Complexity Semantic Analyzer
 * File Path: src/core/intelligence/semanticComplexity.ts
 * Architecture Role: Graph- and AST-driven semantic reasoning engine for time, space, and
 *   lifecycle complexity; derives composite polynomial order across multi-file call chains.
 * Dependencies & Triggers: Imports CallGraph and SymbolIndex from ./callGraph and ./symbolIndex,
 *   core types (Issue, SemanticReviewDetail, SemanticEvidenceStep); invoked during complexity
 *   review and post-scan report finalization.
 * Responsibilities: Differentiate bounded collections from unbounded dynamic input streams;
 *   trace cross-function/cross-file polynomial loops (CPX-TIME-001); detect hot-path transient
 *   allocations (CPX-SPACE-001); detect unbounded recursion cycles (CPX-REC-001); detect
 *   amplification hazards like nested I/O or serialization in call chains (CPX-AMP-001).
 * Exit Semantics & Design Rationale: Pure in-memory graph walk without disk I/O or throwing;
 *   returns structured Issue records conforming strictly to the Section VII result schema.
 */
/**
 * Score ceiling applied when a metric saturates.
 */
const MAX_SCORE_CAP = 80;

import * as fs from 'fs';
import * as path from 'path';
import type { CallGraph } from './callGraph';
import type { SymbolIndex, SymbolDefinition } from './symbolIndex';
import type { Issue, SemanticEvidenceStep, SemanticReviewDetail } from '../types';

/** Threshold of call depth when tracing polynomial cross-function complexity. */

/** Maximum collection size considered bounded/small-scale (e.g. enum/options). */
export const BOUNDED_COLLECTION_MAX_SIZE = 16;

/**
 * Descriptor of a loop or traversal site within a function.
 */
export interface LoopSite {
    file: string;
    line: number;
    symbol: string;
    isBounded: boolean;
    scaleVariable: string;
    hasTransientAllocation: boolean;
    hasBlockingIo: boolean;
}

/**
 * Options controlling semantic complexity deduction.
 */
export interface SemanticComplexityOptions {
    checkCrossFunctionComplexity?: boolean;
    distinguishBoundedCollections?: boolean;
    maxTraceDepth?: number;
}

/**
 * Identify whether an input scale variable or expression is statically bounded.
 *
 * @param expr - Expression or identifier text being iterated.
 * @returns True when the collection is a known small enum, fixed config, or slice.
 */
export function isBoundedCollection(expr: string): boolean {
    const trimmed = expr.trim();
    // A numeric literal bound cannot grow with the input, so the loop is bounded by definition;
    // reporting it as an unbounded hot loop would contradict the message the rule prints.
    if (/^\d[\d_]*(?:\.\d+)?$/.test(trimmed)) {
        return true;
    }
    // A SCREAMING_CASE identifier is a module-level constant by convention (`CONFIG_*`, `MAX_*`,
    // `*_LIMIT`), so a loop bounded by it cannot scale with the input either.
    if (/^[A-Z][A-Z0-9_]{2,}$/.test(trimmed)) {
        return true;
    }
    if (/^(?:Object\.(?:keys|values|entries)|\[.*\]|enum|CONFIG_[A-Z0-9_]+)/.test(trimmed)) {
        return true;
    }
    if (/\b(?:take|slice|limit)\s*\(\s*(?:[1-9]|1[0-6])\s*\)/.test(trimmed)) {
        return true;
    }
    return false;
}

function recordUnboundedCycleIssue(
    u: string,
    edge: { callerFile: string; line?: number | null },
    cycle: string[],
    callGraph: CallGraph,
    issues: Issue[],
): void {
    const file = edge.callerFile;
    const primaryLine = edge.line ?? 1;
    const cycleKey = cycle.join(' -> ');

    const evidence: SemanticEvidenceStep[] = cycle.map((sym, idx) => ({
        kind: 'call',
        description: `Step ${idx + 1}: calls '${sym}'`,
        file,
        line: primaryLine,
        symbol: sym,
    }));

    const detail: SemanticReviewDetail = {
        language: 'typescript',
        module: 'core',
        symbol: u,
        codeDomain: 'recursion-lifecycle',
        currentBehavior: `Mutual recursive invocation cycle: ${cycleKey}`,
        semanticEvidenceChain: evidence,
        triggerCondition: 'Cyclic call path detected without verifiable base-case depth guard',
        risk: 'Potential call-stack exhaustion (StackOverflowError) under pathological or cyclic input graphs.',
        blastRadius: [file],
        isDeterministic: true,
        requiresManualConfirm: true,
        suggestedFix:
            'Introduce an explicit depth accumulator parameter with termination threshold, or rewrite using an iterative worklist.',
        impactedCallers: callGraph.callersOf(u).map((e) => e.caller ?? 'unknown'),
        impactedTests: [],
        verificationMethod:
            'Test with deep tree or cyclic data structures to verify graceful termination.',
        ruleVersion: '1.0.0',
        configVersion: '0.3.0',
        canAutofix: false,
    };

    issues.push({
        id: `complexity:CPX-REC-001:${file}:${primaryLine}`,
        analyzer: 'complexity',
        rule: 'CPX-REC-001',
        severity: 'error',
        message: `Potential unbounded recursion cycle: ${cycleKey}`,
        location: {
            file,
            start: { line: primaryLine, column: 1 },
            end: { line: primaryLine, column: MAX_SCORE_CAP },
        },
        detail,
        suggestion: 'Convert to iterative stack loop or pass a bounded depth counter.',
        evidence: {
            confidence: 0.9,
            requiresRuntime: false,
        },
    });
}

/**
 * Known parameter names that serve as explicit recursion depth or traversal bounds.
 */
const GUARD_PARAM_NAMES = new Set<string>([
    'depth',
    'maxdepth',
    'currentdepth',
    'curdepth',
    'limit',
    'maxlimit',
    'recursionlimit',
    'level',
    'maxlevel',
    'currentlevel',
    'curlevel',
    'depthlimit',
]);

/**
 * Checks whether an identifier or declaration represents a recursion depth or iteration guard.
 *
 * @param param - Parameter declaration or identifier text.
 * @returns True when the parameter represents a depth, limit, or level bound.
 */
export function isGuardParameter(param: string): boolean {
    const raw = param
        .trim()
        .replace(/^(?:public|private|protected|readonly|mut|var|let)\s+/, '')
        .split(/[:=\s]/)[0]
        .replace(/^[*&]+/, '')
        .trim();
    const clean = raw.toLowerCase().replace(/_/g, '');
    if (!clean) return false;
    if (GUARD_PARAM_NAMES.has(clean)) return true;
    return (
        (/^depth/.test(clean) && !/^delimiter/.test(clean)) ||
        /^maxdepth/.test(clean) ||
        /depth$/.test(clean) ||
        /limit$/.test(clean) ||
        /level$/.test(clean)
    );
}

/**
 * Attempts to read file lines safely from disk or in-memory cache.
 */
function tryReadSourceLines(file: string, cache: Map<string, string[]>): string[] | null {
    if (cache.has(file)) return cache.get(file)!;
    try {
        const fullPath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
        if (fs.existsSync(fullPath)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            cache.set(file, lines);
            return lines;
        }
    } catch {
        /* Best-effort: unreadable or non-existent file is ignored and falls back to null */
    }
    return null;
}

/**
 * Extracts the parameter signature enclosed in outer parentheses starting from a line.
 */
function extractParamSignature(lines: string[], startLineIdx: number): string | null {
    let text = '';
    const end = Math.min(lines.length, startLineIdx + 15);
    for (let i = startLineIdx; i < end; i++) {
        text += ' ' + lines[i];
    }
    const openIdx = text.indexOf('(');
    if (openIdx === -1) return null;
    let depth = 0;
    let closeIdx = -1;
    for (let i = openIdx; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(') {
            depth++;
        } else if (ch === ')') {
            depth--;
            if (depth === 0) {
                closeIdx = i;
                break;
            }
        }
    }
    if (closeIdx === -1 || closeIdx <= openIdx + 1) return null;
    return text.slice(openIdx + 1, closeIdx);
}

interface ParameterNestingState {
    paren: number;
    bracket: number;
    angle: number;
}

function updateParameterNesting(ch: string, state: ParameterNestingState): boolean {
    switch (ch) {
        case '(':
            state.paren++;
            return true;
        case ')':
            state.paren = Math.max(0, state.paren - 1);
            return true;
        case '[':
        case '{':
            state.bracket++;
            return true;
        case ']':
        case '}':
            state.bracket = Math.max(0, state.bracket - 1);
            return true;
        case '<':
            state.angle++;
            return true;
        case '>':
            state.angle = Math.max(0, state.angle - 1);
            return true;
        default:
            return false;
    }
}

/**
 * Splits parameter list by top-level commas respecting nested brackets and generics.
 */
function splitParameters(paramStr: string): string[] {
    const params: string[] = [];
    let current = '';
    const state: ParameterNestingState = { paren: 0, bracket: 0, angle: 0 };
    for (let i = 0; i < paramStr.length; i++) {
        const ch = paramStr[i];
        if (updateParameterNesting(ch, state)) {
            current += ch;
            continue;
        }
        if (ch === ',' && state.paren === 0 && state.bracket === 0 && state.angle === 0) {
            const trimmed = current.trim();
            if (trimmed) params.push(trimmed);
            current = '';
            continue;
        }
        current += ch;
    }
    const tail = current.trim();
    if (tail) params.push(tail);
    return params;
}

/**
 * Resolves the parameter list for a single symbol definition.
 */
function resolveDefinitionParameters(
    def: SymbolDefinition | Record<string, any>,
    cache: Map<string, string[]>,
): string[] {
    const anyDef = def as Record<string, any>;
    if (Array.isArray(anyDef.parameters)) return anyDef.parameters;
    if (Array.isArray(anyDef.params)) return anyDef.params;
    if (Array.isArray(anyDef.paramNames)) return anyDef.paramNames;
    if (typeof anyDef.signature === 'string') {
        return splitParameters(anyDef.signature);
    }
    if (typeof def.file === 'string' && typeof def.line === 'number' && def.line > 0) {
        const lines = tryReadSourceLines(def.file, cache);
        if (lines && def.line <= lines.length) {
            const sig = extractParamSignature(lines, def.line - 1);
            if (sig) return splitParameters(sig);
        }
    }
    return [];
}

function ingestCallGraphSymbols(callGraph: CallGraph | undefined, candidates: Set<string>): void {
    if (!callGraph) return;
    if (typeof callGraph.callerNames === 'function') {
        for (const name of callGraph.callerNames()) candidates.add(name);
    }
    if (typeof (callGraph as any).edges === 'function') {
        for (const edge of (callGraph as any).edges()) {
            if (edge.caller) candidates.add(edge.caller);
            if (edge.callee) candidates.add(edge.callee);
        }
    }
}

function ingestSymbolIndexSymbols(
    symbolIndex: SymbolIndex | undefined,
    candidates: Set<string>,
): void {
    if (!symbolIndex || typeof symbolIndex.names !== 'function') return;
    for (const name of symbolIndex.names()) candidates.add(name);
}

/**
 * Collects distinct symbol names from call graph and symbol index.
 */
function collectCandidateSymbols(callGraph?: CallGraph, symbolIndex?: SymbolIndex): Set<string> {
    const candidates = new Set<string>();
    ingestCallGraphSymbols(callGraph, candidates);
    ingestSymbolIndexSymbols(symbolIndex, candidates);
    return candidates;
}

function resolveSymbolParameters(
    sym: string,
    symbolIndex: SymbolIndex,
    fileCache: Map<string, string[]>,
): readonly string[] {
    if (typeof (symbolIndex as any)?.getParameters === 'function') {
        const custom = (symbolIndex as any).getParameters(sym);
        if (Array.isArray(custom)) return custom;
    }

    if (symbolIndex && typeof symbolIndex.resolve === 'function') {
        const resolved = symbolIndex.resolve(sym);
        const defs = resolved?.definitions || [];
        for (let i = 0; i < defs.length; i++) {
            const defParams = resolveDefinitionParameters(defs[i], fileCache);
            if (defParams.length > 0) return defParams;
        }
    }

    return [];
}

function hasGuardParameter(params: readonly string[]): boolean {
    for (let i = 0; i < params.length; i++) {
        if (isGuardParameter(params[i])) return true;
    }
    return false;
}

/**
 * Extract recursive symbols that carry explicit termination guards (depth/maxDepth/limit/level).
 *
 * Inspects symbol parameter lists across definitions and the call graph, whitelisting
 * functions with termination depth limits to suppress false positive CPX-REC-001 findings.
 *
 * @param symbolIndex - Repository cross-file symbol index.
 * @param callGraph - Cross-file call graph.
 * @returns Set of guarded recursive symbol names.
 */
export function extractGuardedRecursiveSymbols(
    symbolIndex: SymbolIndex,
    callGraph: CallGraph,
): Set<string> {
    const guarded = new Set<string>();
    const fileCache = new Map<string, string[]>();
    const candidateSymbols = collectCandidateSymbols(callGraph, symbolIndex);

    for (const sym of candidateSymbols) {
        const params = resolveSymbolParameters(sym, symbolIndex, fileCache);
        if (hasGuardParameter(params)) {
            guarded.add(sym);
        }
    }

    return guarded;
}

/**
 * Detect recursion cycles in the call graph that lack verified termination bounds.
 *
 * @param callGraph - Cross-file call graph.
 * @param recursiveSymbolsWithGuards - Set of symbol names verified to have depth guards.
 * @returns Issues reporting unverified recursion cycles (CPX-REC-001).
 */
export function detectUnboundedRecursion(
    callGraph: CallGraph,
    recursiveSymbolsWithGuards: Set<string>,
): Issue[] {
    const issues: Issue[] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const stack: string[] = [];

    function dfs(u: string): void {
        visited.add(u);
        inStack.add(u);
        stack.push(u);

        const neighbors = callGraph.calleesOf(u);
        for (const edge of neighbors) {
            const callee = edge.callee;
            if (!visited.has(callee)) {
                dfs(callee);
                continue;
            }
            if (!inStack.has(callee)) {
                continue;
            }

            const cycleStartIndex = stack.indexOf(callee);
            const cycle = stack.slice(cycleStartIndex).concat(callee);
            if (cycle.some((sym) => recursiveSymbolsWithGuards.has(sym))) {
                continue;
            }

            recordUnboundedCycleIssue(u, edge, cycle, callGraph, issues);
        }

        stack.pop();
        inStack.delete(u);
    }

    for (const caller of callGraph.callerNames()) {
        if (!visited.has(caller)) {
            dfs(caller);
        }
    }

    return issues;
}

/**
 * Detect complexity amplification hazards where I/O or heavy allocations happen inside loops.
 *
 * @param loopSites - Map of function symbol to its local loop sites.
 * @param ioAllowPatterns - Path patterns whose blocking I/O is by design (process-style tools),
 *   mirroring the `blockingIoAllowPatterns` policy used by PRF-IO-001 / GOV-PRF-004.
 * @param allocationAllowPatterns - Path patterns whose per-iteration allocation is by design,
 *   the allocation counterpart of the same policy.
 * @returns Issues for complexity amplification (CPX-AMP-001 and CPX-SPACE-001).
 */
/**
 * Compile an array of regular expressions into a single union pattern.
 *
 * @param patterns - Candidate path matching patterns.
 * @returns Combined RegExp or null if patterns array is empty.
 */
function compileUnionPattern(patterns: readonly RegExp[]): RegExp | null {
    if (patterns.length === 0) return null;
    if (patterns.length === 1) return patterns[0];
    let hasI = false;
    let hasU = false;
    let hasS = false;
    const sources: string[] = [];
    for (let i = 0; i < patterns.length; i++) {
        const p = patterns[i];
        if (p.ignoreCase) hasI = true;
        if (p.unicode) hasU = true;
        if (p.dotAll) hasS = true;
        sources.push(`(?:${p.source})`);
    }
    let flags = '';
    if (hasI) flags += 'i';
    if (hasU) flags += 'u';
    if (hasS) flags += 's';
    return new RegExp(sources.join('|'), flags || undefined);
}

function buildAmplificationIoIssue(symbol: string, site: LoopSite): Issue {
    const evidence: SemanticEvidenceStep[] = [
        {
            kind: 'loop',
            description: `Iteration over dynamic scale variable '${site.scaleVariable}'`,
            file: site.file,
            line: site.line,
            symbol,
        },
        {
            kind: 'io',
            description: 'Synchronous I/O or network call triggered per iteration',
            file: site.file,
            line: site.line,
            symbol,
        },
    ];

    const detail: SemanticReviewDetail = {
        language: 'typescript',
        module: 'core',
        symbol,
        codeDomain: 'io-amplification',
        currentBehavior: `Executing synchronous blocking I/O or serialization per loop iteration over '${site.scaleVariable}'.`,
        semanticEvidenceChain: evidence,
        triggerCondition: 'I/O operation located inside unbounded iteration body',
        risk: 'Multiplies disk/network latency by collection cardinality N, freezing worker thread.',
        blastRadius: [site.file],
        isDeterministic: true,
        requiresManualConfirm: false,
        suggestedFix: 'Batch I/O operations outside the loop or buffer into a batch write.',
        impactedCallers: [],
        impactedTests: [],
        verificationMethod: 'Profile I/O operation count under varying collection sizes.',
        ruleVersion: '1.0.0',
        configVersion: '0.3.0',
        canAutofix: false,
    };

    return {
        id: `complexity:CPX-AMP-001:${site.file}:${site.line}`,
        analyzer: 'complexity',
        rule: 'CPX-AMP-001',
        severity: 'warning',
        message: `Complexity amplification hazard: synchronous I/O executed inside loop over '${site.scaleVariable}'.`,
        location: {
            file: site.file,
            start: { line: site.line, column: 1 },
            end: { line: site.line, column: MAX_SCORE_CAP },
        },
        detail,
        suggestion: 'Refactor to batch read/write before or after the loop.',
        evidence: {
            confidence: 0.95,
            requiresRuntime: false,
        },
    };
}

function buildAmplificationAllocIssue(symbol: string, site: LoopSite): Issue {
    const evidence: SemanticEvidenceStep[] = [
        {
            kind: 'loop',
            description: `Unbounded iteration over '${site.scaleVariable}'`,
            file: site.file,
            line: site.line,
            symbol,
        },
        {
            kind: 'allocation',
            description: 'Transient heap object or collection cloned inside loop',
            file: site.file,
            line: site.line,
            symbol,
        },
    ];

    const detail: SemanticReviewDetail = {
        language: 'typescript',
        module: 'core',
        symbol,
        codeDomain: 'memory-allocation',
        currentBehavior: `Repeated transient object/array allocation in hot loop over '${site.scaleVariable}'.`,
        semanticEvidenceChain: evidence,
        triggerCondition: 'Heap allocation inside unbounded loop path',
        risk: 'Excessive garbage collection thrashing and memory retention spikes.',
        blastRadius: [site.file],
        isDeterministic: true,
        requiresManualConfirm: false,
        suggestedFix: 'Hoist buffer/object allocation outside loop and reset in-place.',
        impactedCallers: [],
        impactedTests: [],
        verificationMethod: 'Check heap allocations with memory profiler.',
        ruleVersion: '1.0.0',
        configVersion: '0.3.0',
        canAutofix: false,
    };

    return {
        id: `complexity:CPX-SPACE-001:${site.file}:${site.line}`,
        analyzer: 'complexity',
        rule: 'CPX-SPACE-001',
        severity: 'warning',
        message: `Unbounded transient allocation: heap memory allocated repeatedly in loop over '${site.scaleVariable}'.`,
        location: {
            file: site.file,
            start: { line: site.line, column: 1 },
            end: { line: site.line, column: MAX_SCORE_CAP },
        },
        detail,
        suggestion: 'Hoist allocation outside the loop and clear/reuse the instance.',
        evidence: {
            confidence: 0.9,
            requiresRuntime: false,
        },
    };
}

/**
 * Detect complexity amplification issues across loop sites, such as blocking I/O
 * and transient allocations.
 *
 * @param loopSites - Map of symbol names to their analyzed loop sites.
 * @param ioAllowPatterns - Optional list of RegExp patterns exempting files from
 *   blocking I/O warnings.
 * @param allocationAllowPatterns - Optional list of RegExp patterns exempting files
 *   from transient allocation warnings.
 * @returns Array of detected complexity amplification issues.
 */
export function detectComplexityAmplification(
    loopSites: Map<string, LoopSite[]>,
    ioAllowPatterns: RegExp[] = [],
    allocationAllowPatterns: RegExp[] = [],
): Issue[] {
    const issues: Issue[] = [];
    const ioUnionPattern = compileUnionPattern(ioAllowPatterns);
    const allocUnionPattern = compileUnionPattern(allocationAllowPatterns);

    for (const [symbol, sites] of loopSites.entries()) {
        for (const site of sites) {
            if (site.isBounded) continue;
            const ioExempt = ioUnionPattern !== null && ioUnionPattern.test(site.file);
            const allocExempt = allocUnionPattern !== null && allocUnionPattern.test(site.file);

            if (site.hasBlockingIo && !ioExempt) {
                issues.push(buildAmplificationIoIssue(symbol, site));
            }

            if (site.hasTransientAllocation && !allocExempt) {
                issues.push(buildAmplificationAllocIssue(symbol, site));
            }
        }
    }

    return issues;
}
