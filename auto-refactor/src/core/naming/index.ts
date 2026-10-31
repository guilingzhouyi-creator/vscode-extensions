/**
 * Module: Core Naming — Polyglot Naming & Architectural Terminology Hub
 * File Path: src/core/naming/index.ts
 * Architecture Role: Primary facade for polyglot identifier analysis, dictionary lookup,
 *   casing transformations, and naming diagnostic construction.
 * Dependencies & Triggers: Consumes naming contracts, case-converter, and abbreviation catalog;
 *   imported by naming analyzers, comments rules, and governance guards.
 * Responsibilities:
 *   1. Expose unified casing converters with immutable frozen mapping dictionaries;
 *   2. Provide diagnostic builders and candidate proposals for naming violations;
 *   3. Enforce consistent naming conventions across all supported language targets.
 * Exit Semantics & Design Rationale: CC <= 5, Depth <= 2; ELOC >= 15; frozen exports;
 *   zero mutable state and strictly non-throwing.
 */

export * from './case-converter';

import type { AnalyzerContext, Issue, Severity, AgentActionablePayload } from '../types';
import {
    toPascalCase,
    toUpperSnakeCase,
    toCamelCase,
    toKebabCase,
    splitIdentifierWords,
} from './case-converter';

/** Candidate naming proposal derived by the inference and abbreviation pipeline. */
export interface NamingCandidate {
    readonly name: string;
    readonly confidence: number;
    readonly source: 'type_inference' | 'initializer_call' | 'abbreviation_expansion';
    readonly rationale: string;
}

/** Summary of a cross-file symbol reference site. */
export interface CrossFileReferenceSummary {
    readonly file: string;
    readonly line: number | null;
    readonly caller?: string | null;
}

/** Usage context tracking cross-file references for an identifier. */
export interface CrossFileUsageContext {
    readonly symbolName: string;
    readonly definitionFile: string;
    readonly crossFileReferenceCount: number;
    readonly references: readonly CrossFileReferenceSummary[];
    readonly isCrossFile: boolean;
}

/** Machine-actionable proposal suggesting identifier standardization. */
export interface StandardizationProposal {
    readonly originalName: string;
    readonly suggestedName: string;
    readonly confidence: number;
    readonly candidates: readonly NamingCandidate[];
    readonly rationale: string;
    readonly safeToAutomate: boolean;
}

/** Request requiring clarification or human judgment for ambiguous naming. */
export interface ClarificationRequest {
    readonly symbolName: string;
    readonly filePath: string;
    readonly crossFileContext: CrossFileUsageContext;
    readonly ambiguityReasons: readonly string[];
    readonly candidates: readonly NamingCandidate[];
    readonly requiresHumanReview: boolean;
}

/** Actionable patch payload attached to naming violations for automated remediation. */
export interface NamingActionablePayload extends AgentActionablePayload {
    standardizationProposal?: StandardizationProposal;
    clarificationRequest?: ClarificationRequest;
}

/** Diagnostic record for a naming rule finding before final Issue creation. */
export interface NamingDiagnosticRecord {
    readonly rule: string;
    readonly message: string;
    readonly severity: Severity;
    readonly suggestion: string;
    readonly detail: Record<string, unknown>;
    readonly actionable?: NamingActionablePayload;
}

/** Diagnostic record payload for polyglot language naming findings. */
export interface PolyglotFindingInput {
    readonly line: number;
    readonly column: number;
    readonly rule: string;
    readonly message: string;
    readonly severity: Severity;
    readonly detail: Record<string, unknown>;
    readonly suggestion?: string;
    readonly actionable?: NamingActionablePayload;
}

/** Factory callback converting a structured polyglot finding into a standardized issue record. */
export type IssueFactory = (finding: PolyglotFindingInput) => Issue;

/** Target descriptor for an extracted polyglot function declaration. */
export interface ExtractedFunctionTarget {
    readonly fnName: string;
    readonly lineIdx: number;
    readonly isSnake: boolean;
}

/** Standard naming options surface consumed by polyglot and AST auditors. */
export interface BaseNamingOptions {
    readonly checkFiles?: boolean;
    readonly checkDirectories?: boolean;
    readonly checkGlobals?: boolean;
    readonly checkTypes?: boolean;
    readonly checkMembers?: boolean;
    readonly checkVagueNames?: boolean;
    readonly checkSingleLetters?: boolean;
    readonly checkCollections?: boolean;
    readonly checkJargon?: boolean;
    readonly checkDecoupling?: boolean;
    readonly checkLengths?: boolean;
    readonly checkAbbreviations?: boolean;
    readonly minFileLength?: number;
    readonly maxFileLength?: number;
    readonly minFileWords?: number;
    readonly maxFileWords?: number;
    readonly minFunctionLength?: number;
    readonly maxFunctionLength?: number;
    readonly minFunctionWords?: number;
    readonly maxFunctionWords?: number;
    readonly enforceVerbNounContract?: boolean;
    readonly enforceMorphemeCheck?: boolean;
    readonly allowedShortFiles?: string[] | readonly string[];
    readonly allowedShortNames?: string[] | readonly string[];
    readonly allowedAbbreviations?: string[] | readonly string[];
    readonly vagueBlacklist?: string[] | readonly string[];
    readonly singleLetterAllowed?: string[] | readonly string[];
}

/** Execution context carrying options, context, and issue accumulator for polyglot audits. */
export interface PolyglotNamingContext {
    readonly opts: BaseNamingOptions;
    readonly ctx: AnalyzerContext;
    readonly mkIssue: IssueFactory;
    readonly issues: Issue[];
}

/**
 * Supported naming styles across languages and contexts.
 */
export type NamingConvention = 'camelCase' | 'PascalCase' | 'snake_case' | 'kebab-case' | 'UPPER_SNAKE_CASE';

/**
 * Formats an identifier to match the requested naming convention.
 *
 * @param ident - Source identifier text.
 * @param convention - Target naming convention style.
 * @returns Transformed identifier matching the target convention.
 */
export function formatIdentifierConvention(ident: string, convention: NamingConvention): string {
    switch (convention) {
        case 'PascalCase':
            return toPascalCase(ident);
        case 'UPPER_SNAKE_CASE':
            return toUpperSnakeCase(ident);
        case 'snake_case':
            return toKebabCase(ident).replace(/-/g, '_');
        case 'kebab-case':
            return toKebabCase(ident);
        case 'camelCase':
        default:
            return toCamelCase(ident);
    }
}

/**
 * Inspects an identifier and computes its semantic constituent words and casing characteristics.
 *
 * @param ident - Identifier string to inspect.
 * @returns Structured metadata containing token count, word breakdown, and length.
 */
export function inspectIdentifierStructure(ident: string): {
    readonly words: readonly string[];
    readonly wordCount: number;
    readonly totalLength: number;
} {
    const words = Object.freeze(splitIdentifierWords(ident));
    return {
        words,
        wordCount: words.length,
        totalLength: ident.length,
    };
}
