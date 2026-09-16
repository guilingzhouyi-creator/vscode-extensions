/**
 * Module: Core Governance — Domain Contracts
 * File Path: src/core/governance/types.ts
 * Architecture Role: Single source of truth for the governance domain types shared by the
 *     registry, language profiles, rule modules, and the governance analyzer.
 * Dependencies & Triggers: Imports NormalizedNode from ../multilang and AnalyzerContext and
 *     Severity from ../types; compile-time contracts with no runtime execution of their own.
 * Responsibilities: Define the eight GovernanceCategory values and the RiskLevel scale;
 *     define GovernanceIssueDetail, LanguageCapabilities, RuleEvaluationContext, and
 *     GovernanceViolation payloads; define the GovernanceRule SPI with optional checkNode
 *     and checkFile hooks plus the optional per-language allow-list.
 * Exit Semantics & Design Rationale: Type-only module, so it can never throw or degrade at
 *     runtime; centralizing the SPI here avoids circular imports between the registry and
 *     rule modules and keeps every category bound to one stable contract.
 */
import type { NormalizedNode } from '../multilang';
import type { AnalyzerContext, Severity, IssueEvidence } from '../types';

/**
 * The eight core governance categories that every rule maps to.
 */
export type GovernanceCategory =
    | 'standardization' // Canonical style and idioms
    | 'file_structure' // File and directory layout conventions
    | 'code_logic' // Code logic correctness
    | 'type_system' // Type system usage
    | 'exception_safety' // Exception handling and resilience
    | 'debug_logging' // Debug output and logging
    | 'performance' // Performance conventions
    | 'maintainability'; // Maintainability

/**
 * Risk severity level for governance findings.
 */
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

/**
 * Structured detail payload conforming strictly to the governance output contract:
 * location -> category -> risk -> rationale -> suggestion -> fixable
 */
export interface GovernanceIssueDetail {
    category: GovernanceCategory;
    risk: RiskLevel;
    rationale: string;
    fixable: boolean;
    targetLanguage: string;
    ruleId: string;
    suggestedPatch?: string;
    [key: string]: any;
}

/**
 * Language capabilities profile defining feature sets and idiomatic patterns.
 * Rules branch on these capabilities, so multi-language support stays behind one
 * boundary instead of being mechanically coupled to each language.
 */
export interface LanguageCapabilities {
    languageId: string;
    supportsStaticTyping: boolean;
    supportsTypeInference: boolean;
    supportsClassInheritance: boolean;
    supportsPatternMatching: boolean;
    hasResultType: boolean;
    hasExceptions: boolean;
    debugIdentifiers: string[];
    namingConventions: {
        file: 'kebab-case' | 'snake_case' | 'camelCase' | 'any';
        class: 'PascalCase';
        function: 'camelCase' | 'snake_case' | 'PascalCase';
        variable: 'camelCase' | 'snake_case' | 'UPPER_SNAKE_CASE';
        constant: 'UPPER_SNAKE_CASE';
    };
}

/**
 * Context passed to rule evaluators during AST traversal.
 */
export interface RuleEvaluationContext {
    node: NormalizedNode;
    ctx: AnalyzerContext;
    parent?: NormalizedNode;
    grandparent?: NormalizedNode;
    depth: number;
    className: string | null;
    binding: string | null;
    capabilities: LanguageCapabilities;
    filePath: string;
    content: string;
    lines: string[];
    /**
     * Same-length masked copy of {@link lines} in which comments, string/template literals and
     * (for the C family) regex literals are blanked; see `core/sourceMask.ts`.
     *
     * Content-oriented rules must read this view instead of `lines`: a raw line makes JSDoc prose,
     * CLI usage text, regex bodies and type-union syntax look like executable code, which is how a
     * compression heuristic ends up reporting comments as statements. Required rather than optional
     * so the compiler forces every construction site to supply it.
     */
    masked: string[];
}

/**
 * Violation report returned by a governance rule check.
 */
export interface GovernanceViolation {
    ruleId: string;
    message: string;
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
    suggestion?: string;
    fixable?: boolean;
    suggestedPatch?: string;
    customDetail?: Record<string, any>;
    evidence?: IssueEvidence;
}

/**
 * Governance Rule SPI contract.
 */
export interface GovernanceRule {
    id: string;
    name: string;
    category: GovernanceCategory;
    severity: Severity;
    risk: RiskLevel;
    rationale: string;
    isFixable: boolean;
    /**
     * Target languages supported by this rule (e.g. ['typescript', 'javascript', 'gdscript']).
     * If omitted, applies to all languages whose capability matches.
     */
    languages?: string[];
    /**
     * Evaluated per AST node during streaming traversal.
     */
    checkNode?(context: RuleEvaluationContext): GovernanceViolation[] | null;
    /**
     * Evaluated once per file.
     */
    checkFile?(context: RuleEvaluationContext): GovernanceViolation[] | null;
}
