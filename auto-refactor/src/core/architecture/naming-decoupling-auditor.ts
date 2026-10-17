/**
 * Module: Core Architecture — Identifier Length & Architectural Decoupling Auditor
 * File Path: src/core/architecture/naming-decoupling-auditor.ts
 * Architecture Role: Evaluator analyzing identifier inflation (30-40+ chars) as a pathological
 *   symptom of monolithic flat structures, driving automated domain decoupling proposals.
 * Dependencies & Triggers: Consumed by NamingAnalyzer (src/analyzers/naming.ts),
 *   MetaArchitectureEvaluator, and machine-actionable repair agents.
 * Responsibilities:
 *   1. Tokenize identifiers across camelCase, PascalCase, snake_case, and UPPER_SNAKE_CASE.
 *   2. Evaluate identifier length and token segment thresholds (NAM-DEC-001).
 *   3. Perform Domain Prefix Clustering to detect shared domain prefixes across flat symbols.
 *   4. Generate structured, machine-actionable domain decoupling proposals for AI Agents.
 * Exit Semantics & Design Rationale: Pure deterministic analysis with zero I/O; enforces
 *   clean line limits (<= 100 columns) and returns structured findings.
 */

import { RULE_NAM_DEC_001 } from '../scoring/dimensionLiterals';

const TYPE_WARN_CHARS = 35;
const TYPE_ERROR_CHARS = 45;
const TYPE_WARN_SEGS = 5;
const TYPE_ERROR_SEGS = 7;
const VAL_WARN_CHARS = 32;
const VAL_ERROR_CHARS = 42;
const CONST_WARN_CHARS = 42;
const CONST_ERROR_CHARS = 50;
const CONST_WARN_SEGS = 6;
const CONST_ERROR_SEGS = 8;
const CLUST_MIN_SYMS = 4;
const CLUST_MIN_PFX_CHARS = 12;
const CLUST_MIN_PFX_SEGS = 2;

const ACTION_DECOMPOSE_MODULE = 'decompose_module' as const;
const SEVERITY_WARNING = 'warning' as const;
const SEVERITY_ERROR = 'error' as const;
const REASON_EXCESSIVE_LENGTH = 'excessive_length' as const;
const REASON_EXCESSIVE_SEGMENTS = 'excessive_segments' as const;
const REASON_PREFIX_CLUSTERING = 'domain_prefix_clustering' as const;

const KIND_TYPE = 'type' as const;
const KIND_CLASS = 'class' as const;
const KIND_INTERFACE = 'interface' as const;
const KIND_CONSTANT = 'constant' as const;

const FALLBACK_DOMAIN_PREFIX_LENGTH = 10;
const LONG_SEGMENT_THRESHOLD = 5;
const DEFAULT_PREFIX_SLICE_COUNT = 2;
const SHORT_PREFIX_SLICE_COUNT = 1;

/** Permitted AST symbol declaration kinds audited for architectural coupling. */
export type SymbolDeclarationKind =
    'type' | 'class' | 'interface' | 'function' | 'method' | 'variable' | 'constant' | 'member';

/** Suggested domain directory and symbol output of a decomposition proposal. */
export interface DomainProposalOutcome {
    readonly suggestedDomainDirectory: string;
    readonly suggestedSymbol: string;
}

/**
 * Configuration thresholds for identifier length and architectural decomposition analysis.
 */
export interface NamingDecouplingConfig {
    readonly typeWarningLength: number;
    readonly typeErrorLength: number;
    readonly typeWarningSegments: number;
    readonly typeErrorSegments: number;
    readonly valueWarningLength: number;
    readonly valueErrorLength: number;
    readonly constantWarningLength?: number;
    readonly constantErrorLength?: number;
    readonly constantWarningSegments?: number;
    readonly constantErrorSegments?: number;
    readonly clusterMinSymbols: number;
    readonly clusterMinPrefixLength: number;
    readonly clusterMinPrefixSegments: number;
}

/** Default configuration thresholds for naming decoupling and prefix clustering audits. */
export const DEFAULT_NAMING_DECOUPLING_CONFIG: NamingDecouplingConfig = {
    typeWarningLength: TYPE_WARN_CHARS,
    typeErrorLength: TYPE_ERROR_CHARS,
    typeWarningSegments: TYPE_WARN_SEGS,
    typeErrorSegments: TYPE_ERROR_SEGS,
    valueWarningLength: VAL_WARN_CHARS,
    valueErrorLength: VAL_ERROR_CHARS,
    constantWarningLength: CONST_WARN_CHARS,
    constantErrorLength: CONST_ERROR_CHARS,
    constantWarningSegments: CONST_WARN_SEGS,
    constantErrorSegments: CONST_ERROR_SEGS,
    clusterMinSymbols: CLUST_MIN_SYMS,
    clusterMinPrefixLength: CLUST_MIN_PFX_CHARS,
    clusterMinPrefixSegments: CLUST_MIN_PFX_SEGS,
};

/**
 * Machine-actionable decoupling proposal payload for AI Agent dispatch.
 */
export interface ActionableDecouplingProposal extends DomainProposalOutcome {
    readonly action: 'decompose_module';
    readonly rule: typeof RULE_NAM_DEC_001;
    readonly targetSymbol: string;
    readonly rationale: string;
}

/**
 * Finding produced when an identifier exhibits architectural inflation.
 */
export interface NamingDecouplingFinding extends DomainProposalOutcome {
    readonly symbol: string;
    readonly kind: SymbolDeclarationKind;
    readonly line: number;
    readonly column: number;
    readonly length: number;
    readonly segments: readonly string[];
    readonly severity: 'warning' | 'error';
    readonly reason: 'excessive_length' | 'excessive_segments' | 'domain_prefix_clustering';
    readonly actionableProposal: ActionableDecouplingProposal;
    readonly message: string;
}

/**
 * Input symbol descriptor for cluster analysis.
 */
export interface SymbolEntry {
    readonly name: string;
    readonly kind: SymbolDeclarationKind;
    readonly line: number;
    readonly column: number;
}

/**
 * Tokenize an identifier into semantic segments.
 * Supports camelCase, PascalCase, snake_case, and UPPER_SNAKE_CASE.
 *
 * @param name - The identifier name to tokenize.
 * @returns Array of individual token strings.
 */
export function splitIdentifierTokens(name: string): string[] {
    if (!name || typeof name !== 'string') return [];

    // Snake case / UPPER_SNAKE_CASE
    if (name.includes('_')) {
        return name
            .split('_')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
    }

    // PascalCase / camelCase / acronyms (e.g., HTTPResponseHandler -> HTTP, Response, Handler)
    const tokenList: string[] = [];
    const pattern = /([A-Z]+(?=[A-Z][a-z0-9]|$)|[A-Z][a-z0-9]*|[a-z0-9]+)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(name)) !== null) {
        if (match[0].length > 0) {
            tokenList.push(match[0]);
        }
    }
    return tokenList.length > 0 ? tokenList : [name];
}

/**
 * Convert semantic prefix tokens into a suggested directory namespace.
 */
function toKebabPath(tokens: readonly string[]): string {
    return tokens
        .map((t) => t.toLowerCase())
        .join('/')
        .concat('/');
}

function buildDomainProposal(
    suggestedDomainDirectory: string,
    suggestedSymbol: string,
): { suggestedDomainDirectory: string; suggestedSymbol: string } {
    return { suggestedDomainDirectory, suggestedSymbol };
}

/**
 * Derive suggested target domain directory and stripped symbol from token segments.
 *
 * @param name - The original symbol identifier.
 * @param segments - Tokenized segments of the identifier.
 * @param isUpperSnake - Whether the identifier is UPPER_SNAKE_CASE.
 * @returns Proposal with suggested domain directory and stripped symbol.
 */
export function deriveDomainProposal(
    name: string,
    segments: readonly string[],
    isUpperSnake: boolean,
): { suggestedDomainDirectory: string; suggestedSymbol: string } {
    if (segments.length <= 2) {
        const domainSlug = name.toLowerCase().slice(0, FALLBACK_DOMAIN_PREFIX_LENGTH);
        return buildDomainProposal(`domain/${domainSlug}/`, name);
    }

    // Take leading 2 segments (or 1 if 3 segments total) as the domain namespace
    const prefixCount = segments.length >= LONG_SEGMENT_THRESHOLD
        ? DEFAULT_PREFIX_SLICE_COUNT
        : SHORT_PREFIX_SLICE_COUNT;
    const prefixSegments = segments.slice(0, prefixCount);
    const remainderSegments = segments.slice(prefixCount);

    const domainPath = `domain/${toKebabPath(prefixSegments)}`;

    let candidateSymbol: string;
    if (isUpperSnake) {
        candidateSymbol = remainderSegments.join('_');
    } else {
        candidateSymbol = remainderSegments.join('');
    }

    // Guard against empty remainder
    const cleanSymbol = candidateSymbol && candidateSymbol.length > 0 ? candidateSymbol : name;

    return buildDomainProposal(domainPath, cleanSymbol);
}

function isTypeSymbol(kind: SymbolDeclarationKind): boolean {
    return kind === KIND_TYPE || kind === KIND_CLASS || kind === KIND_INTERFACE;
}

interface ViolationVerdict {
    readonly severity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR;
    readonly reason: typeof REASON_EXCESSIVE_LENGTH | typeof REASON_EXCESSIVE_SEGMENTS;
}

interface ThresholdLimits {
    readonly errorLength: number;
    readonly errorSegments: number;
    readonly warningLength: number;
    readonly warningSegments: number;
}

function evaluateMetricBounds(
    len: number,
    segmentCount: number,
    limits: ThresholdLimits,
): ViolationVerdict | null {
    const isError = len >= limits.errorLength || segmentCount >= limits.errorSegments;
    if (isError) {
        const reason = len >= limits.errorLength ? REASON_EXCESSIVE_LENGTH : REASON_EXCESSIVE_SEGMENTS;
        return { severity: SEVERITY_ERROR, reason };
    }
    const isWarning = len >= limits.warningLength || segmentCount >= limits.warningSegments;
    if (isWarning) {
        const reason = len >= limits.warningLength ? REASON_EXCESSIVE_LENGTH : REASON_EXCESSIVE_SEGMENTS;
        return { severity: SEVERITY_WARNING, reason };
    }
    return null;
}

function evaluateTypeThreshold(
    len: number,
    segmentCount: number,
    config: NamingDecouplingConfig,
): ViolationVerdict | null {
    return evaluateMetricBounds(len, segmentCount, {
        errorLength: config.typeErrorLength,
        errorSegments: config.typeErrorSegments,
        warningLength: config.typeWarningLength,
        warningSegments: config.typeWarningSegments,
    });
}

function evaluateConstantThreshold(
    len: number,
    segmentCount: number,
    config: NamingDecouplingConfig,
): ViolationVerdict | null {
    return evaluateMetricBounds(len, segmentCount, {
        errorLength: config.constantErrorLength ?? CONST_ERROR_CHARS,
        errorSegments: config.constantErrorSegments ?? CONST_ERROR_SEGS,
        warningLength: config.constantWarningLength ?? CONST_WARN_CHARS,
        warningSegments: config.constantWarningSegments ?? CONST_WARN_SEGS,
    });
}

function evaluateValueThreshold(
    len: number,
    config: NamingDecouplingConfig,
): ViolationVerdict | null {
    if (len >= config.valueErrorLength) {
        return { severity: SEVERITY_ERROR, reason: REASON_EXCESSIVE_LENGTH };
    }
    if (len >= config.valueWarningLength) {
        return { severity: SEVERITY_WARNING, reason: REASON_EXCESSIVE_LENGTH };
    }
    return null;
}

interface ThresholdEvaluationContext {
    readonly len: number;
    readonly segmentCount: number;
    readonly isType: boolean;
    readonly isConstant: boolean;
    readonly config: NamingDecouplingConfig;
}

function evaluateThresholdViolation(
    context: ThresholdEvaluationContext,
): ViolationVerdict | null {
    if (context.isType) {
        return evaluateTypeThreshold(context.len, context.segmentCount, context.config);
    }
    if (context.isConstant) {
        return evaluateConstantThreshold(context.len, context.segmentCount, context.config);
    }
    return evaluateValueThreshold(context.len, context.config);
}

function extractPrefixKey(
    entry: SymbolEntry,
    minSegments: number,
    minLength: number,
): string | null {
    const segments = splitIdentifierTokens(entry.name);
    if (segments.length < minSegments) {
        return null;
    }
    const isUpperSnake = /^[A-Z0-9_]+$/.test(entry.name);
    const prefixSegments = segments.slice(0, 2);
    const separator = isUpperSnake ? '_' : '';
    const prefixKey = prefixSegments.map((seg) => seg.toLowerCase()).join(separator);
    return prefixKey.length >= minLength ? prefixKey : null;
}

function buildNamingFinding(params: {
    symbol: string;
    kind: SymbolDeclarationKind;
    line: number;
    column: number;
    len: number;
    segments: readonly string[];
    severity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR;
    reason: typeof REASON_EXCESSIVE_LENGTH | typeof REASON_EXCESSIVE_SEGMENTS;
    proposal: DomainProposalOutcome;
}): NamingDecouplingFinding {
    const { symbol, kind, line, column, len, segments, severity, reason, proposal } = params;
    const rationale =
        `Identifier '${symbol}' has ${len} chars (${segments.length} segments). ` +
        `Extract namespace into '${proposal.suggestedDomainDirectory}' to decouple ` +
        `architecture and simplify symbol to '${proposal.suggestedSymbol}'.`;

    const actionableProposal: ActionableDecouplingProposal = {
        action: ACTION_DECOMPOSE_MODULE,
        rule: RULE_NAM_DEC_001,
        targetSymbol: symbol,
        ...proposal,
        rationale,
    };

    const message =
        `Symbol '${symbol}' exhibits excessive length (${len} chars, ` +
        `${segments.length} segments), indicating missing architectural encapsulation. ` +
        `Decompose into domain directory '${proposal.suggestedDomainDirectory}'.`;

    return {
        symbol,
        kind,
        line,
        column,
        length: len,
        segments,
        severity,
        reason,
        ...proposal,
        actionableProposal,
        message,
    };
}

function createClusterFinding(
    targetSymbol: SymbolEntry,
    prefix: string,
    clusterSize: number,
    suggestedDir: string,
): NamingDecouplingFinding {
    const isUpperSnake = /^[A-Z0-9_]+$/.test(targetSymbol.name);
    const segments = splitIdentifierTokens(targetSymbol.name);
    const proposal = deriveDomainProposal(targetSymbol.name, segments, isUpperSnake);
    const rationale =
        `${clusterSize} symbols share prefix '${prefix}'. ` +
        `Submerge into '${suggestedDir}' to achieve architectural encapsulation.`;

    const domainOutcome: DomainProposalOutcome = {
        suggestedDomainDirectory: suggestedDir,
        suggestedSymbol: proposal.suggestedSymbol,
    };

    return {
        symbol: targetSymbol.name,
        kind: targetSymbol.kind,
        line: targetSymbol.line,
        column: targetSymbol.column,
        length: targetSymbol.name.length,
        segments,
        severity: SEVERITY_WARNING,
        reason: REASON_PREFIX_CLUSTERING,
        ...domainOutcome,
        actionableProposal: {
            action: ACTION_DECOMPOSE_MODULE,
            rule: RULE_NAM_DEC_001,
            targetSymbol: targetSymbol.name,
            ...domainOutcome,
            rationale,
        },
        message:
            `Symbol '${targetSymbol.name}' belongs to a flat prefix cluster ` +
            `('${prefix}', ${clusterSize} symbols). Extract into ` +
            `module '${suggestedDir}'.`,
    };
}

/**
 * Auditor implementing NAM-DEC-001 checks.
 */
export class NamingDecouplingAuditor {
    private readonly config: NamingDecouplingConfig;

    constructor(config: Partial<NamingDecouplingConfig> = {}) {
        this.config = { ...DEFAULT_NAMING_DECOUPLING_CONFIG, ...config };
    }

    /**
     * Audit a single identifier for excessive length or segment inflation.
     */
    public auditIdentifier(
        symbol: string,
        kind: SymbolDeclarationKind,
        line: number,
        column: number,
    ): NamingDecouplingFinding | null {
        if (!symbol || symbol.length === 0) return null;

        const isType = isTypeSymbol(kind);
        const segments = splitIdentifierTokens(symbol);
        const len = symbol.length;

        const isConstant = kind === KIND_CONSTANT;
        const verdict = evaluateThresholdViolation({
            len,
            segmentCount: segments.length,
            isType,
            isConstant,
            config: this.config,
        });
        if (!verdict) {
            return null;
        }

        const isUpperSnake = /^[A-Z0-9_]+$/.test(symbol) && symbol.includes('_');
        const proposal = deriveDomainProposal(symbol, segments, isUpperSnake);
        return buildNamingFinding({
            symbol,
            kind,
            line,
            column,
            len,
            segments,
            severity: verdict.severity,
            reason: verdict.reason,
            proposal,
        });
    }

    /**
     * Audit a collection of symbols within a file to detect un-decoupled domain clusters.
     */
    public auditClusters(symbols: readonly SymbolEntry[]): NamingDecouplingFinding[] {
        if (!symbols || symbols.length < this.config.clusterMinSymbols) {
            return [];
        }

        const prefixMap = new Map<string, SymbolEntry[]>();
        for (const entry of symbols) {
            const prefixKey = extractPrefixKey(
                entry,
                this.config.clusterMinPrefixSegments,
                this.config.clusterMinPrefixLength,
            );
            if (prefixKey === null) {
                continue;
            }
            const existing = prefixMap.get(prefixKey);
            if (existing !== undefined) {
                existing.push(entry);
            } else {
                prefixMap.set(prefixKey, [entry]);
            }
        }

        const findings: NamingDecouplingFinding[] = [];
        const seenSymbols = new Set<string>();

        for (const [prefix, grouped] of prefixMap.entries()) {
            if (grouped.length < this.config.clusterMinSymbols) {
                continue;
            }
            const prefixSegments = splitIdentifierTokens(grouped[0].name).slice(0, DEFAULT_PREFIX_SLICE_COUNT);
            const suggestedDir = `domain/${toKebabPath(prefixSegments)}`;

            for (const clusterEntry of grouped) {
                if (seenSymbols.has(clusterEntry.name)) {
                    continue;
                }
                seenSymbols.add(clusterEntry.name);
                findings.push(createClusterFinding(clusterEntry, prefix, grouped.length, suggestedDir));
            }
        }

        return findings;
    }
}
