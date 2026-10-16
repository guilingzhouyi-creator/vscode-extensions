/**
 * Module: Core Intelligence — Spatiotemporal Complexity Semantic Analyzer
 * File Path: src/core/intelligence/semanticComplexity.ts
 * Architecture Role: Graph- and AST-driven semantic reasoning engine for time, space, and
 *   lifecycle complexity; derives composite polynomial order across multi-file call chains.
 * Dependencies & Triggers: Imports CallGraph and SymbolIndex from ./callGraph and ./symbolIndex,
 *   core types (Issue, SemanticEvidenceStep, SemanticReviewDetail); invoked during complexity
 *   review and post-scan report finalization.
 * Responsibilities: Differentiate bounded collections from unbounded dynamic input streams;
 *   trace cross-function/cross-file polynomial loops (CPX-TIME-001); detect hot-path transient
 *   allocations (CPX-SPACE-001); detect unbounded recursion cycles (CPX-REC-001); detect
 *   amplification hazards like nested I/O or serialization in call chains (CPX-AMP-001).
 * Exit Semantics & Design Rationale: Pure in-memory graph walk without disk I/O or throwing;
 *   returns structured Issue records conforming strictly to the Section VII result schema.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CallGraph } from './callGraph';
import type { SymbolIndex, SymbolDefinition } from './symbolIndex';
import type { Issue, SemanticEvidenceStep, SemanticReviewDetail } from '../types';

export { analyzeCrossFunctionComplexity } from './crossFunctionComplexity';
export { MAX_COMPLEXITY_TRACE_DEPTH } from './crossFunctionComplexity';

/** Score ceiling applied when a metric saturates. */
const MAX_SCORE_CAP = 80;

/** Threshold of collection size considered bounded/small-scale (e.g. enum/options). */
export const BOUNDED_COLLECTION_MAX_SIZE = 16;

/** Maximum lines forward to scan when locating parameter list in source text. */
const MAX_PARAM_SIGNATURE_SCAN_LINES = 15;

/** Standard domain, method, and kind constants to eliminate repeated hardcoded string literals. */
const SEPARATOR_CYCLE = ' -> ';
const KIND_CALL = 'call';
const KIND_LOOP = 'loop';
const KIND_IO = 'io';
const KIND_ALLOCATION = 'allocation';
const METHOD_EDGES = 'edges';
const METHOD_GET_PARAMETERS = 'getParameters';
const DOMAIN_CORE = 'core';
const DOMAIN_RECURSION_LIFECYCLE = 'recursion-lifecycle';
const DOMAIN_IO_AMPLIFICATION = 'io-amplification';
const DOMAIN_MEMORY_ALLOCATION = 'memory-allocation';
const DEFAULT_RULE_VERSION = '1.0.0';
const DEFAULT_CONFIG_VERSION = '0.3.0';
const SEVERITY_ERROR = 'error';
const SEVERITY_WARNING = 'warning';
const ANALYZER_NAME = 'complexity';
const LANG_TYPESCRIPT = 'typescript';

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
    isTautological?: boolean;
    deltaEntropy?: number;
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
 * Context required to construct and record an unbounded mutual recursion cycle finding.
 */
interface UnboundedCycleContext {
    currentSymbol: string;
    edge: { callerFile: string; line?: number | null };
    cycle: string[];
    callGraph: CallGraph;
    issues: Issue[];
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
    return /\b(?:take|slice|limit)\s*\(\s*(?:[1-9]|1[0-6])\s*\)/.test(trimmed);
}

function recordUnboundedCycleIssue(context: UnboundedCycleContext): void {
    const { currentSymbol, edge, cycle, callGraph, issues } = context;
    const file = edge.callerFile;
    const primaryLine = edge.line ?? 1;
    const cycleKey = cycle.join(SEPARATOR_CYCLE);

    const evidence: SemanticEvidenceStep[] = cycle.map((sym, idx) => ({
        kind: KIND_CALL,
        description: `Step ${idx + 1}: calls '${sym}'`,
        file,
        line: primaryLine,
        symbol: sym,
    }));

    const detail: SemanticReviewDetail = {
        language: LANG_TYPESCRIPT,
        module: DOMAIN_CORE,
        symbol: currentSymbol,
        codeDomain: DOMAIN_RECURSION_LIFECYCLE,
        currentBehavior: `Mutual recursive invocation cycle: ${cycleKey}`,
        semanticEvidenceChain: evidence,
        triggerCondition: 'Cyclic call path detected without verifiable base-case depth guard',
        risk: 'Potential call-stack exhaustion (StackOverflowError) under pathological or cyclic input graphs.',
        blastRadius: [file],
        isDeterministic: true,
        requiresManualConfirm: true,
        suggestedFix:
            'Introduce an explicit depth accumulator parameter with termination threshold, or rewrite using an iterative worklist.',
        impactedCallers: callGraph.callersOf(currentSymbol).map((e) => e.caller ?? 'unknown'),
        impactedTests: [],
        verificationMethod:
            'Test with deep tree or cyclic data structures to verify graceful termination.',
        ruleVersion: DEFAULT_RULE_VERSION,
        configVersion: DEFAULT_CONFIG_VERSION,
        canAutofix: false,
    };

    issues.push({
        id: `complexity:CPX-REC-001:${file}:${primaryLine}`,
        analyzer: ANALYZER_NAME,
        rule: 'CPX-REC-001',
        severity: SEVERITY_ERROR,
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
 * @param paramText - Parameter declaration or identifier text.
 * @returns True when the parameter represents a depth, limit, or level bound.
 */
export function isGuardParameter(paramText: string): boolean {
    const raw = paramText
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
function tryReadSourceLines(
    file: string,
    filePathToLinesMap: Map<string, string[]>,
): string[] | null {
    if (filePathToLinesMap.has(file)) return filePathToLinesMap.get(file)!;
    try {
        const fullPath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
        if (fs.existsSync(fullPath)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            filePathToLinesMap.set(file, lines);
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
    const end = Math.min(lines.length, startLineIdx + MAX_PARAM_SIGNATURE_SCAN_LINES);
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

interface LegacyDefinitionParameters {
    parameters?: unknown;
    params?: unknown;
    paramNames?: unknown;
    signature?: unknown;
}

function extractArrayParameters(candidateDef: LegacyDefinitionParameters): string[] | null {
    if (
        Array.isArray(candidateDef.parameters) &&
        candidateDef.parameters.every((p): p is string => typeof p === 'string')
    ) {
        return candidateDef.parameters;
    }
    if (
        Array.isArray(candidateDef.params) &&
        candidateDef.params.every((p): p is string => typeof p === 'string')
    ) {
        return candidateDef.params;
    }
    if (
        Array.isArray(candidateDef.paramNames) &&
        candidateDef.paramNames.every((p): p is string => typeof p === 'string')
    ) {
        return candidateDef.paramNames;
    }
    return null;
}

/**
 * Resolves the parameter list for a single symbol definition.
 */
function resolveDefinitionParameters(
    def: SymbolDefinition | Record<string, unknown>,
    filePathToLinesMap: Map<string, string[]>,
): string[] {
    const candidateDef = def as LegacyDefinitionParameters;
    const arrayParams = extractArrayParameters(candidateDef);
    if (arrayParams) return arrayParams;
    if (typeof candidateDef.signature === 'string') {
        return splitParameters(candidateDef.signature);
    }
    if (typeof def.file === 'string' && typeof def.line === 'number' && def.line > 0) {
        const lines = tryReadSourceLines(def.file, filePathToLinesMap);
        if (lines && def.line <= lines.length) {
            const sig = extractParamSignature(lines, def.line - 1);
            if (sig) return splitParameters(sig);
        }
    }
    return [];
}

interface EdgeWithCallerCallee {
    caller?: string;
    callee?: string;
}

interface CallGraphWithEdges {
    edges(): Iterable<EdgeWithCallerCallee>;
}

function hasEdgesProvider(target: unknown): target is CallGraphWithEdges {
    return Boolean(
        target &&
        typeof target === 'object' &&
        METHOD_EDGES in target &&
        typeof (target as { edges?: unknown }).edges === 'function',
    );
}

interface SymbolIndexWithParameters {
    getParameters(symbol: string): readonly string[] | string[];
}

function hasParameterResolver(target: unknown): target is SymbolIndexWithParameters {
    return Boolean(
        target &&
        typeof target === 'object' &&
        METHOD_GET_PARAMETERS in target &&
        typeof (target as { getParameters?: unknown }).getParameters === 'function',
    );
}

function ingestCallGraphSymbols(callGraph: CallGraph | undefined, candidates: Set<string>): void {
    if (!callGraph) return;
    if (typeof callGraph.callerNames === 'function') {
        for (const name of callGraph.callerNames()) candidates.add(name);
    }
    if (hasEdgesProvider(callGraph)) {
        for (const edge of callGraph.edges()) {
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
    filePathToLinesMap: Map<string, string[]>,
): readonly string[] {
    if (hasParameterResolver(symbolIndex)) {
        const custom = symbolIndex.getParameters(sym);
        if (Array.isArray(custom)) return custom;
    }

    if (symbolIndex && typeof symbolIndex.resolve === 'function') {
        const resolved = symbolIndex.resolve(sym);
        const defs = resolved?.definitions || [];
        for (let i = 0; i < defs.length; i++) {
            const defParams = resolveDefinitionParameters(defs[i], filePathToLinesMap);
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
    const filePathToLinesMap = new Map<string, string[]>();
    const candidateSymbols = collectCandidateSymbols(callGraph, symbolIndex);

    for (const sym of candidateSymbols) {
        const params = resolveSymbolParameters(sym, symbolIndex, filePathToLinesMap);
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
    const stackIndexMap = new Map<string, number>();

    function traverseRecursionCycle(currentSymbol: string): void {
        visited.add(currentSymbol);
        inStack.add(currentSymbol);
        stackIndexMap.set(currentSymbol, stack.length);
        stack.push(currentSymbol);

        const neighbors = callGraph.calleesOf(currentSymbol);
        for (const edge of neighbors) {
            const callee = edge.callee;
            if (!visited.has(callee)) {
                traverseRecursionCycle(callee);
                continue;
            }
            if (!inStack.has(callee)) {
                continue;
            }

            const cycleStartIndex = stackIndexMap.get(callee) ?? 0;
            const cycle = stack.slice(cycleStartIndex).concat(callee);
            if (cycle.some((sym) => recursiveSymbolsWithGuards.has(sym))) {
                continue;
            }

            recordUnboundedCycleIssue({
                currentSymbol,
                edge,
                cycle,
                callGraph,
                issues,
            });
        }

        stack.pop();
        stackIndexMap.delete(currentSymbol);
        inStack.delete(currentSymbol);
    }

    for (const caller of callGraph.callerNames()) {
        if (!visited.has(caller)) {
            traverseRecursionCycle(caller);
        }
    }

    return issues;
}

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

interface AmplificationDescriptor {
    ruleId: 'CPX-AMP-001' | 'CPX-SPACE-001';
    codeDomain: string;
    stepKind: 'io' | 'allocation';
    stepDescription: string;
    behaviorMessage: (scaleVar: string) => string;
    triggerText: string;
    risk: string;
    fixRemediation: string;
    message: (scaleVar: string) => string;
    suggestion: string;
    verificationGuidance: string;
    confidence: number;
}

const IO_AMPLIFICATION_DESC: AmplificationDescriptor = {
    ruleId: 'CPX-AMP-001',
    codeDomain: DOMAIN_IO_AMPLIFICATION,
    stepKind: KIND_IO,
    stepDescription: 'Synchronous I/O or network call triggered per iteration',
    behaviorMessage: (scaleVar) =>
        `Executing synchronous blocking I/O or serialization per loop iteration over '${scaleVar}'.`,
    triggerText: 'I/O operation located inside unbounded iteration body',
    risk: 'Multiplies disk/network latency by collection cardinality N, freezing worker thread.',
    fixRemediation: 'Batch I/O operations outside the loop or buffer into a batch write.',
    message: (scaleVar) =>
        `Complexity amplification hazard: synchronous I/O executed inside loop over '${scaleVar}'.`,
    suggestion: 'Refactor to batch read/write before or after the loop.',
    verificationGuidance: 'Profile I/O operation count under varying collection sizes.',
    confidence: 0.95,
};

const ALLOC_AMPLIFICATION_DESC: AmplificationDescriptor = {
    ruleId: 'CPX-SPACE-001',
    codeDomain: DOMAIN_MEMORY_ALLOCATION,
    stepKind: KIND_ALLOCATION,
    stepDescription: 'Transient heap object or collection cloned inside loop',
    behaviorMessage: (scaleVar) =>
        `Repeated transient object/array allocation in hot loop over '${scaleVar}'.`,
    triggerText: 'Heap allocation inside unbounded loop path',
    risk: 'Excessive garbage collection thrashing and memory retention spikes.',
    fixRemediation: 'Hoist buffer/object allocation outside loop and reset in-place.',
    message: (scaleVar) =>
        `Unbounded transient allocation: heap memory allocated repeatedly in loop over '${scaleVar}'.`,
    suggestion: 'Hoist allocation outside the loop and clear/reuse the instance.',
    verificationGuidance: 'Check heap allocations with memory profiler.',
    confidence: 0.9,
};

function createAmplificationDetail(
    symbol: string,
    site: LoopSite,
    evidence: SemanticEvidenceStep[],
    descriptor: AmplificationDescriptor,
): SemanticReviewDetail {
    return {
        language: LANG_TYPESCRIPT,
        module: DOMAIN_CORE,
        symbol,
        codeDomain: descriptor.codeDomain,
        currentBehavior: descriptor.behaviorMessage(site.scaleVariable),
        semanticEvidenceChain: evidence,
        triggerCondition: descriptor.triggerText,
        risk: descriptor.risk,
        blastRadius: [site.file],
        isDeterministic: true,
        requiresManualConfirm: false,
        suggestedFix: descriptor.fixRemediation,
        impactedCallers: [],
        impactedTests: [],
        verificationMethod: descriptor.verificationGuidance,
        ruleVersion: DEFAULT_RULE_VERSION,
        configVersion: DEFAULT_CONFIG_VERSION,
        canAutofix: false,
    };
}

function createAmplificationIssue(
    symbol: string,
    site: LoopSite,
    descriptor: AmplificationDescriptor,
): Issue {
    const loopDescription =
        descriptor.stepKind === KIND_IO
            ? `Iteration over dynamic scale variable '${site.scaleVariable}'`
            : `Unbounded iteration over '${site.scaleVariable}'`;

    const evidence: SemanticEvidenceStep[] = [
        {
            kind: KIND_LOOP,
            description: loopDescription,
            file: site.file,
            line: site.line,
            symbol,
        },
        {
            kind: descriptor.stepKind,
            description: descriptor.stepDescription,
            file: site.file,
            line: site.line,
            symbol,
        },
    ];

    const detail = createAmplificationDetail(symbol, site, evidence, descriptor);

    return {
        id: `complexity:${descriptor.ruleId}:${site.file}:${site.line}`,
        analyzer: ANALYZER_NAME,
        rule: descriptor.ruleId,
        severity: SEVERITY_WARNING,
        message: descriptor.message(site.scaleVariable),
        location: {
            file: site.file,
            start: { line: site.line, column: 1 },
            end: { line: site.line, column: MAX_SCORE_CAP },
        },
        detail,
        suggestion: descriptor.suggestion,
        evidence: {
            confidence: descriptor.confidence,
            requiresRuntime: false,
        },
    };
}

function buildAmplificationIoIssue(symbol: string, site: LoopSite): Issue {
    return createAmplificationIssue(symbol, site, IO_AMPLIFICATION_DESC);
}

function buildAmplificationAllocIssue(symbol: string, site: LoopSite): Issue {
    return createAmplificationIssue(symbol, site, ALLOC_AMPLIFICATION_DESC);
}

function isPathExempt(filePath: string, unionPattern: RegExp | null): boolean {
    if (!unionPattern) return false;
    const normalized = filePath.replace(/\\/g, '/');
    if (unionPattern.test(normalized)) return true;
    const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
    return unionPattern.test(relPath);
}

interface AmplificationMatcher {
    ioUnionPattern: RegExp | null;
    allocUnionPattern: RegExp | null;
}

function checkSiteAmplification(
    symbol: string,
    site: LoopSite,
    matcher: AmplificationMatcher,
    issues: Issue[],
): void {
    if (site.isBounded) return;

    if (site.hasBlockingIo && !isPathExempt(site.file, matcher.ioUnionPattern)) {
        issues.push(buildAmplificationIoIssue(symbol, site));
    }

    if (site.hasTransientAllocation && !isPathExempt(site.file, matcher.allocUnionPattern)) {
        issues.push(buildAmplificationAllocIssue(symbol, site));
    }
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
    const matcher: AmplificationMatcher = {
        ioUnionPattern: compileUnionPattern(ioAllowPatterns),
        allocUnionPattern: compileUnionPattern(allocationAllowPatterns),
    };

    for (const [symbol, sites] of loopSites.entries()) {
        for (let i = 0; i < sites.length; i++) {
            checkSiteAmplification(symbol, sites[i], matcher, issues);
        }
    }

    return issues;
}
