/**
 * Module: Core Naming — Type Contracts & Diagnostic Models
 * File Path: src/core/naming/contracts.ts
 * Architecture Role: Centralized contract definitions for polyglot identifier analysis,
 *   candidate proposal generation, and diagnostic serialization across language adapters.
 * Dependencies & Triggers: Zero external runtime dependencies; consumes core AnalyzerContext & Issue.
 * Responsibilities:
 *   1. Declare candidate proposal models (NamingCandidate);
 *   2. Declare diagnostic payloads and action attachments (NamingActionablePayload);
 *   3. Declare polyglot evaluation contexts (PolyglotNamingContext, PolyglotFindingInput);
 *   4. Eliminate cyclic type dependencies across naming analysis helpers.
 * Exit Semantics & Design Rationale: CC <= 2; pure contract module with zero side effects.
 */

import type { AnalyzerContext, Issue, Severity, AgentActionablePayload } from '../types';

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
