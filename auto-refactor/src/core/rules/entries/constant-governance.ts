/**
 * Module: Core Engine — Rule Registry (constant governance entries)
 * File Path: src/core/rules/entries/constant-governance.ts
 * Architecture Role: Declarative rule metadata for constant layout, scope discipline,
 *   near-literal clustering, and cross-file ownership governance.
 * Dependencies & Triggers: core rule types plus defineRule(); consumed by ./registry.ts
 * Responsibilities: Declare RuleDefinition entries for CONST-LAY-001, CONST-SCP-001,
 *   CONST-SCP-002, CONST-CLU-001, CONST-DRF-001, and CONST-OWN-001.
 * Exit Semantics & Design Rationale: Pure data, no behaviour. Provides unified identity
 *   and documentation anchors for constant semantic governance rules.
 */

import type { RuleDefinition } from '../types';
import {
    ALL_LANGUAGES,
    defineRule,
    SEVERITY_WARNING,
    SEVERITY_INFO,
    RULE_FAMILY_CONSTANTS,
} from '../types';

const ANALYZER_CONSTANTS = 'constants';
const DOCS_ANCHOR_BASE = 'docs/04-analyzers-and-rules/01-builtin-rules.md#';

const RULE_ID_CONST_LAY_001 = 'CONST-LAY-001';
const RULE_ID_CONST_SCP_001 = 'CONST-SCP-001';
const RULE_ID_CONST_SCP_002 = 'CONST-SCP-002';
const RULE_ID_CONST_CLU_001 = 'CONST-CLU-001';
const RULE_ID_CONST_DRF_001 = 'CONST-DRF-001';
const RULE_ID_CONST_OWN_001 = 'CONST-OWN-001';
const RULE_ID_CONST_LIB_001 = 'CONST-LIB-001';

function createGovernanceRule(
    id: string,
    summary: string,
    remediation: string,
    severity = SEVERITY_WARNING,
): RuleDefinition {
    return defineRule({
        id,
        family: RULE_FAMILY_CONSTANTS,
        analyzer: ANALYZER_CONSTANTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: severity,
        summary,
        remediation,
        docsAnchor: `${DOCS_ANCHOR_BASE}${id.toLowerCase()}`,
    });
}

/**
 * Constant semantic governance rules table.
 */
export const CONSTANT_GOVERNANCE_RULES: readonly RuleDefinition[] = [
    createGovernanceRule(
        RULE_ID_CONST_LAY_001,
        'Module-level constants must be placed in the primary declaration section immediately following imports, not scattered within functions or business logic.',
        'Hoist module-level constants to the designated declaration block after import/require statements and before function/class definitions.',
    ),
    createGovernanceRule(
        RULE_ID_CONST_SCP_001,
        'Local invariants, lazily initialized values, or short-lived resources must not be needlessly hoisted to module scope.',
        'Keep scoped invariants inside their respective functions or blocks; avoid escalating local constants to global scope.',
    ),
    createGovernanceRule(
        RULE_ID_CONST_SCP_002,
        'Multiple identical local literals in a function should be consolidated as local constants at the function header.',
        'Declare local const variables at the beginning of the function and replace repeated inline literals.',
        SEVERITY_INFO,
    ),
    createGovernanceRule(
        RULE_ID_CONST_CLU_001,
        'Multiple homogeneous unextracted literals (status codes, protocols, paths, events) in the same call scope should be clustered and extracted together.',
        'Cluster related literals into cohesive domain constants or enums instead of leaving scattered literals.',
    ),
    createGovernanceRule(
        RULE_ID_CONST_DRF_001,
        'Homogeneous semantic constants across files have naming splits or minor value drifts, violating single source of truth (SSOT).',
        'Consolidate drifting constants into a shared domain or protocol library to establish a single source of truth.',
    ),
    createGovernanceRule(
        RULE_ID_CONST_OWN_001,
        'Shared constant ownership is misclassified; avoid dumping constants into kitchen-sink files or hiding them in private modules.',
        'Categorize constants into the appropriate ownership tier: Module-Private, Domain-Shared, Protocol-Shared, or System-Config.',
    ),
    createGovernanceRule(
        RULE_ID_CONST_LIB_001,
        'Large volumes of constants are scattered across business files without a structured, tiered constant library.',
        'Consolidate constants into modular files under constants/ with a unified barrel export in index.ts.',
    ),
];
