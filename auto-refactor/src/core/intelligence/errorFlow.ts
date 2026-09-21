/**
 * Module: Core Engine - Error Propagation Chains (Repository Intelligence consumer)
 * File Path: src/core/intelligence/errorFlow.ts
 * Architecture Role: The error-taxonomy view over the shared repository intelligence: it reads
 *     the error-code literals the traversal already collected and the call graph already derived,
 *     and reports codes that are duplicated across raisers or that can travel far up a call chain,
 *     so the reviewer never re-reads the files to answer "who raises this and who sees it?"
 * Dependencies & Triggers: `LiteralIndex` from ./literalIndex, `CallGraph` from ./callGraph,
 *     `Issue` from ../types; called by the `error-flow` post-scan pass in api.finalizeReport when
 *     the hygiene analyzer enables `errorPropagation` and the scan covers the complete file set
 * Responsibilities: Select error-code literals with a configurable pattern, group their raise
 *     sites, walk callersOf() upward into a propagation chain, flag duplicate raisers and long
 *     chains, and emit one finding per code with the chain and the boundary as evidence
 * Exit Semantics & Design Rationale: Pure derivation over in-memory facts - no I/O, no throwing,
 *     deterministic ordering. The chain is static evidence only: it says which callers CAN see the
 *     code, never that they handle, translate or log it, so every finding carries
 *     `detail.staticOnly: true` and names the boundary where the static walk stopped (no caller =
 *     entry point or unused) instead of implying a verified handling path. A code raised in two
 *     different declarations is reported as a taxonomy defect (two owners, one name) rather than
 *     being merged into a single "known error", because merging is exactly what hides the defect.
 */
import type { Issue } from '../types';
import type { CallGraph } from './callGraph';
import type { LiteralIndex, LiteralOccurrence } from './literalIndex';

/** Canonical rule id for error propagation chain findings. */
export const ERROR_PROPAGATION_RULE_ID = 'ERR-PRP-001';

/** Tuning for the error propagation pass. */
export interface ErrorFlowOptions {
    /** Minimum upward hops before a non-duplicated code is reported. Defaults to three. */
    minHops?: number;
    /** Hard cap on emitted findings. Defaults to fifty. */
    maxIssues?: number;
    /** Severity of the emitted findings. Defaults to `warning`. */
    severity?: string;
    /** Optional project-specific error-code pattern (source text of a regular expression). */
    codePattern?: string;
}

/** Default error-code spellings: explicit error prefixes or explicit failure suffixes. */
const DEFAULT_CODE_PATTERNS: readonly RegExp[] = [
    /^(?:E|ERR|ERROR|EX|FAULT)_[A-Z0-9][A-Z0-9_]*$/,
    /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:ERROR|FAILED|TIMEOUT|EXHAUSTED|DENIED|NOT_FOUND)$/,
];

const DEFAULT_MIN_HOPS = 3;
const DEFAULT_MAX_ISSUES = 50;
const DEFAULT_SEVERITY = 'warning';
const MAX_CHAIN_HOPS = 32;
const UNATTRIBUTED = 'unattributed';

/**
 * Strip wrapping quotes from a literal string value.
 *
 * @param value - Literal token from AST.
 * @returns Inner string content.
 */
function stripQuotes(value: string): string {
    if (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith('`') && value.endsWith('`'))
    ) {
        return value.slice(1, -1);
    }
    return value;
}

/**
 * Decide whether a literal value looks like an error code.
 *
 * @param value - Raw literal spelling.
 * @param override - Optional project-specific pattern.
 * @returns True when the value is treated as an error code.
 */
function isErrorCode(value: string, override: RegExp | null): boolean {
    const stripped = stripQuotes(value);
    if (override !== null) return override.test(stripped);
    return DEFAULT_CODE_PATTERNS.some((pattern) => pattern.test(stripped));
}

function deduplicateSorted(items: string[]): string[] {
    return [...new Set(items)].sort();
}

/**
 * Walk the call graph upward from a raiser, collecting the callers that can observe the code.
 *
 * @param graph - Call graph derived from the shared symbol index.
 * @param raiser - Declaration that raises the code.
 * @returns Chain starting at the raiser, nearest caller first.
 */
function propagationChain(graph: CallGraph, raiser: string): string[] {
    const chain = [raiser];
    const seen = new Set<string>([raiser]);
    let current = raiser;
    while (chain.length <= MAX_CHAIN_HOPS) {
        const callers = graph
            .callersOf(current)
            .map((edge) => edge.caller)
            .filter((caller): caller is string => caller !== null && !seen.has(caller));
        if (callers.length === 0) break;
        const next = deduplicateSorted(callers)[0];
        seen.add(next);
        chain.push(next);
        current = next;
    }
    return chain;
}

interface AttributedSiteInfo {
    code: string;
    sites: LiteralOccurrence[];
    raisers: string[];
    files: string[];
    duplicate: boolean;
    attributedRaisers: string[];
}

function extractAttributedSiteInfo(entryValue: string, literals: LiteralIndex): AttributedSiteInfo {
    const code = stripQuotes(entryValue);
    const sites = literals.sitesOf(entryValue);
    const raiserSymbols = sites.map((site: LiteralOccurrence) => site.symbol ?? UNATTRIBUTED);
    const raisers = deduplicateSorted(raiserSymbols);
    const files = deduplicateSorted(sites.map((s) => s.file));
    const duplicate =
        raisers.filter((raiser) => raiser !== UNATTRIBUTED).length > 1 || files.length > 1;
    const attributedRaisers = raisers.filter((raiser): raiser is string => raiser !== UNATTRIBUTED);
    return { code, sites, raisers, files, duplicate, attributedRaisers };
}

function findBestPropagationChain(graph: CallGraph, attributedRaisers: string[]): string[] {
    let bestChain: string[] = [];
    for (const r of attributedRaisers) {
        const c = propagationChain(graph, r);
        if (c.length > bestChain.length) {
            bestChain = c;
        }
    }
    return bestChain;
}

/**
 * Build review findings for duplicated or far-propagating error codes.
 *
 * @param literals - Shared literal store fed by the scan traversal.
 * @param graph - Call graph derived from the same scan.
 * @param options - Optional thresholds, severity and code pattern.
 * @returns One finding per qualifying error code, most severe first.
 */
export function buildErrorFlowIssues(
    literals: LiteralIndex,
    graph: CallGraph,
    options: ErrorFlowOptions = {},
): Issue[] {
    const minHops = options.minHops ?? DEFAULT_MIN_HOPS;
    const maxIssues = options.maxIssues ?? DEFAULT_MAX_ISSUES;
    const severity = options.severity ?? DEFAULT_SEVERITY;
    const override = options.codePattern === undefined ? null : new RegExp(options.codePattern);
    const issues: Array<{ issue: Issue; hops: number }> = [];

    for (const entry of literals.entries()) {
        if (!isErrorCode(entry.value, override)) continue;
        const siteInfo = extractAttributedSiteInfo(entry.value, literals);
        const chain = findBestPropagationChain(graph, siteInfo.attributedRaisers);
        const hops = Math.max(0, chain.length - 1);
        if (!siteInfo.duplicate && hops < minHops) continue;
        const first = siteInfo.sites[0];
        const boundary = chain.length > 0 ? chain[chain.length - 1] : null;
        const boundarySeenFrom = boundary === null ? [] : graph.callersOf(boundary);
        const reason = siteInfo.duplicate
            ? `在 ${siteInfo.raisers.length} 个声明中重复出现（错误分类法冲突）`
            : `可沿调用链向上传播 ${hops} 跳`;
        const code = siteInfo.code;
        const sites = siteInfo.sites;
        const raisers = siteInfo.raisers;
        const files = siteInfo.files;
        const duplicate = siteInfo.duplicate;
        issues.push({
            hops,
            issue: {
                id: `error-flow:${code}`,
                analyzer: 'hygiene',
                rule: ERROR_PROPAGATION_RULE_ID,
                severity: severity as Issue['severity'],
                message: `错误码 "${code}" ${reason}；静态链路：${chain.join(' <- ') || '(无归属调用者)'}`,
                location: {
                    file: first.file,
                    start: { line: first.line, column: first.column },
                    end: { line: first.line, column: first.column },
                },
                detail: {
                    code,
                    raiseSites: sites.map((site: LiteralOccurrence) => ({
                        file: site.file,
                        line: site.line,
                        symbol: site.symbol,
                    })),
                    raisers,
                    files,
                    duplicate,
                    hops,
                    chain,
                    boundary,
                    boundaryIsEntryPoint: boundary !== null && boundarySeenFrom.length === 0,
                    staticOnly: true,
                },
                suggestion:
                    '统一错误分类法：让该错误码只有一个所有者（领域错误类型/枚举），在边界层显式转换、记录并决定恢复策略；' +
                    '若多个模块确需同一语义，改用具名错误类型而不是裸字符串，避免同一码在不同层被重新解释。',
            },
        });
    }

    issues.sort((a, b) => b.hops - a.hops || a.issue.id.localeCompare(b.issue.id));
    return issues.slice(0, maxIssues).map((item) => item.issue);
}
