/**
 * Module: Core Messages — Constant Semantic Governance Diagnostics
 * File Path: src/core/messages/constants.ts
 * Architecture Role: Static descriptor catalog for constant governance rules, providing standard
 *   English messages conforming to clean code and architecture boundaries.
 * Dependencies & Triggers: Imports DiagnosticDescriptor from ./types; consumed by constant
 *   governance guards in core/governance and core/architecture.
 * Responsibilities: Export ConstantsMessages factories for CONST-LAY-001, CONST-SCP-001,
 *   CONST-SCP-002, CONST-CLU-001, CONST-DRF-001, and CONST-OWN-001.
 * Exit Semantics & Design Rationale: Deterministic pure descriptor builders with zero I/O or state.
 */

import type { DiagnosticDescriptor } from './types';

const RISK_LOW = 'Low';
const RISK_MEDIUM = 'Medium';
const RISK_HIGH = 'High';

/**
 * Constant governance diagnostic descriptor catalog.
 *
 * Supplies standardized English descriptors for layout order, scope discipline,
 * sibling clustering, cross-file drift, and ownership hierarchy rules.
 */
export const ConstantsMessages = {
    // CONST-LAY-001: Module constant layout sequence
    LAYOUT_ORDER_BREACH: (symbolName: string, lastImportLine: number): DiagnosticDescriptor => ({
        message: `Module constant declaration order violation: '${symbolName}' must appear in the top-level constant section after imports and before logic declarations`,
        suggestion: `Move 'const ${symbolName}' to the top-level constant section following dependencies (line ${lastImportLine > 0 ? lastImportLine : 1})`,
        rationale:
            'Module-level constants establish static invariants that subsequent logic depends upon; scattering them across functions obscures architecture.',
        risk: RISK_MEDIUM,
    }),

    // CONST-SCP-001: Scope over-widening guard
    SCOPE_OVERWIDENING: (
        symbolName: string,
        startLine: number,
        endLine: number,
    ): DiagnosticDescriptor => ({
        message: `Constant scope over-widened: invariant '${symbolName}' is only referenced in a single local scope (lines ${startLine}..${endLine}) and must not be elevated to module-global scope`,
        suggestion: `Narrow scope: relocate declaration of '${symbolName}' into the specific local function or block where it is used`,
        rationale:
            'Elevating single-use local invariants to module globals pollutes the file namespace and creates unnecessary coupling.',
        risk: RISK_MEDIUM,
    }),

    // CONST-SCP-002: Scattered duplicate local literals
    LOCAL_DUPLICATE_SCATTERED: (functionName: string, count: number): DiagnosticDescriptor => ({
        message: `Scattered duplicate literals detected within function '${functionName}' (${count} occurrences); consolidate as local constants`,
        suggestion: `Declare local const variables at the start of '${functionName}' to eliminate scattered inline repetitions`,
        rationale:
            'Consolidating repeated values inside a function clarifies intent and prevents value divergence during maintenance.',
        risk: RISK_LOW,
    }),

    // CONST-CLU-001: Incomplete cluster extraction
    UNEXTRACTED_CLUSTER_LEAK: (
        family: string,
        unextractedCount: number,
        hasExtracted: boolean,
    ): DiagnosticDescriptor => ({
        message: `Incomplete literal cluster extraction: found ${unextractedCount} unextracted '${family}' inline literals in calling domain${hasExtracted ? ' despite existing sibling constants' : ''}`,
        suggestion: `Batch-extract all related '${family}' literals into cohesive domain constants`,
        rationale:
            'Extracting only a subset of related domain literals leaves orphaned magic values and invites configuration inconsistencies.',
        risk: RISK_MEDIUM,
    }),

    // CONST-DRF-001: Cross-file semantic drift
    CROSS_FILE_DRIFT: (symbolName: string, summary: string): DiagnosticDescriptor => ({
        message: `Semantic value drift detected across files for constant '${symbolName}' (${summary}); establish a single source of truth`,
        suggestion: `Establish a single source of truth (SSOT) in a shared domain or protocol module for '${symbolName}'`,
        rationale:
            'Maintaining divergent definitions of identical constant symbols across files causes insidious version desynchronization.',
        risk: RISK_HIGH,
    }),

    // CONST-OWN-001: Misplaced ownership tier
    MISPLACED_OWNERSHIP_TIER: (
        symbolName: string,
        recommendedTier: string,
        targetFile: string,
        rationaleText: string,
    ): DiagnosticDescriptor => ({
        message: `Constant ownership hierarchy breach: '${symbolName}' is misplaced; recommended tier is '${recommendedTier}' (target: '${targetFile}')`,
        suggestion: `Relocate '${symbolName}' to '${targetFile}' according to the four-tier constant ownership model`,
        rationale: rationaleText,
        risk: RISK_MEDIUM,
    }),
};
