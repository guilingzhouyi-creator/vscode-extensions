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

/** Permitted AST symbol declaration kinds audited for architectural coupling. */
export type SymbolDeclarationKind =
    'type' | 'class' | 'interface' | 'function' | 'method' | 'variable' | 'constant' | 'member';

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
    readonly clusterMinSymbols: number;
    readonly clusterMinPrefixLength: number;
    readonly clusterMinPrefixSegments: number;
}

/** Default configuration thresholds for naming decoupling and prefix clustering audits. */
export const DEFAULT_NAMING_DECOUPLING_CONFIG: NamingDecouplingConfig = {
    typeWarningLength: 35,
    typeErrorLength: 45,
    typeWarningSegments: 5,
    typeErrorSegments: 7,
    valueWarningLength: 32,
    valueErrorLength: 42,
    clusterMinSymbols: 4,
    clusterMinPrefixLength: 12,
    clusterMinPrefixSegments: 2,
};

/**
 * Machine-actionable decoupling proposal payload for AI Agent dispatch.
 */
export interface ActionableDecouplingProposal {
    readonly action: 'decompose_module';
    readonly rule: typeof RULE_NAM_DEC_001;
    readonly targetSymbol: string;
    readonly suggestedDomainDirectory: string;
    readonly suggestedSymbol: string;
    readonly rationale: string;
}

/**
 * Finding produced when an identifier exhibits architectural inflation.
 */
export interface NamingDecouplingFinding {
    readonly symbol: string;
    readonly kind: SymbolDeclarationKind;
    readonly line: number;
    readonly column: number;
    readonly length: number;
    readonly segments: readonly string[];
    readonly severity: 'warning' | 'error';
    readonly reason: 'excessive_length' | 'excessive_segments' | 'domain_prefix_clustering';
    readonly suggestedDomainDirectory: string;
    readonly suggestedSymbol: string;
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
    const result: string[] = [];
    const pattern = /([A-Z]+(?=[A-Z][a-z0-9]|$)|[A-Z][a-z0-9]*|[a-z0-9]+)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(name)) !== null) {
        if (match[0].length > 0) {
            result.push(match[0]);
        }
    }
    return result.length > 0 ? result : [name];
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
        const fallbackDir = `domain/${name.toLowerCase().slice(0, 10)}/`;
        return { suggestedDomainDirectory: fallbackDir, suggestedSymbol: name };
    }

    // Take leading 2 segments (or 1 if 3 segments total) as the domain namespace
    const prefixCount = segments.length >= 5 ? 2 : 1;
    const prefixSegments = segments.slice(0, prefixCount);
    const remainderSegments = segments.slice(prefixCount);

    const suggestedDomainDirectory = `domain/${toKebabPath(prefixSegments)}`;

    let suggestedSymbol: string;
    if (isUpperSnake) {
        suggestedSymbol = remainderSegments.join('_');
    } else {
        suggestedSymbol = remainderSegments.join('');
    }

    // Guard against empty remainder
    if (!suggestedSymbol || suggestedSymbol.length === 0) {
        suggestedSymbol = name;
    }

    return { suggestedDomainDirectory, suggestedSymbol };
}

function isTypeSymbol(kind: SymbolDeclarationKind): boolean {
    return kind === 'type' || kind === 'class' || kind === 'interface';
}

interface ViolationVerdict {
    readonly severity: 'warning' | 'error';
    readonly reason: 'excessive_length' | 'excessive_segments';
}

function evaluateThresholdViolation(
    len: number,
    segmentCount: number,
    isType: boolean,
    config: NamingDecouplingConfig,
): ViolationVerdict | null {
    if (isType) {
        if (len >= config.typeErrorLength) {
            return { severity: 'error', reason: 'excessive_length' };
        }
        if (segmentCount >= config.typeErrorSegments) {
            return { severity: 'error', reason: 'excessive_segments' };
        }
        if (len >= config.typeWarningLength) {
            return { severity: 'warning', reason: 'excessive_length' };
        }
        if (segmentCount >= config.typeWarningSegments) {
            return { severity: 'warning', reason: 'excessive_segments' };
        }
        return null;
    }
    if (len >= config.valueErrorLength) {
        return { severity: 'error', reason: 'excessive_length' };
    }
    if (len >= config.valueWarningLength) {
        return { severity: 'warning', reason: 'excessive_length' };
    }
    return null;
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
    if (prefixKey.length < minLength) {
        return null;
    }
    return prefixKey;
}

function createClusterFinding(
    item: SymbolEntry,
    prefix: string,
    clusterSize: number,
    suggestedDir: string,
): NamingDecouplingFinding {
    const isUpperSnake = /^[A-Z0-9_]+$/.test(item.name);
    const segments = splitIdentifierTokens(item.name);
    const proposal = deriveDomainProposal(item.name, segments, isUpperSnake);
    const rationale =
        `${clusterSize} symbols share prefix '${prefix}'. ` +
        `Submerge into '${suggestedDir}' to achieve architectural encapsulation.`;

    return {
        symbol: item.name,
        kind: item.kind,
        line: item.line,
        column: item.column,
        length: item.name.length,
        segments,
        severity: 'warning',
        reason: 'domain_prefix_clustering',
        suggestedDomainDirectory: suggestedDir,
        suggestedSymbol: proposal.suggestedSymbol,
        actionableProposal: {
            action: 'decompose_module',
            rule: RULE_NAM_DEC_001,
            targetSymbol: item.name,
            suggestedDomainDirectory: suggestedDir,
            suggestedSymbol: proposal.suggestedSymbol,
            rationale,
        },
        message:
            `Symbol '${item.name}' belongs to a flat prefix cluster ` +
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

        const verdict = evaluateThresholdViolation(len, segments.length, isType, this.config);
        if (!verdict) {
            return null;
        }

        const isUpperSnake = /^[A-Z0-9_]+$/.test(symbol) && symbol.includes('_');
        const proposal = deriveDomainProposal(symbol, segments, isUpperSnake);
        const rationale =
            `Identifier '${symbol}' has ${len} chars (${segments.length} segments). ` +
            `Extract namespace into '${proposal.suggestedDomainDirectory}' to decouple ` +
            `architecture and simplify symbol to '${proposal.suggestedSymbol}'.`;

        const actionableProposal: ActionableDecouplingProposal = {
            action: 'decompose_module',
            rule: RULE_NAM_DEC_001,
            targetSymbol: symbol,
            suggestedDomainDirectory: proposal.suggestedDomainDirectory,
            suggestedSymbol: proposal.suggestedSymbol,
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
            severity: verdict.severity,
            reason: verdict.reason,
            suggestedDomainDirectory: proposal.suggestedDomainDirectory,
            suggestedSymbol: proposal.suggestedSymbol,
            actionableProposal,
            message,
        };
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
            const prefixSegments = splitIdentifierTokens(grouped[0].name).slice(0, 2);
            const suggestedDir = `domain/${toKebabPath(prefixSegments)}`;

            for (const item of grouped) {
                if (seenSymbols.has(item.name)) {
                    continue;
                }
                seenSymbols.add(item.name);
                findings.push(createClusterFinding(item, prefix, grouped.length, suggestedDir));
            }
        }

        return findings;
    }
}
