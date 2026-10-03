/**
 * Module: Core Engine — Rule Registry (gate governance entries)
 * File Path: src/core/rules/entries/gate-governance.ts
 * Architecture Role: Declarative rule metadata for repository gate architecture governance;
 *   concatenated into RULE_REGISTRY single source of truth.
 * Dependencies & Triggers: core rule types, defineRule(); consumed by ../registry.ts.
 * Responsibilities: Declare identity, severity, summary, remediation, and doc anchors for
 *   all 9 canonical GATE-* rules:
 *   - GATE-SYS-001: Missing gate system (no hooks and no CI);
 *   - GATE-HOOK-001: Missing local left-shift Git hooks;
 *   - GATE-ISO-001: Dual-tier isomorphism between local gates and remote CI;
 *   - GATE-ROUTE-001: Hook runtime routing safety and degradation guard;
 *   - GATE-MSG-001: Commit-msg engineering structure and anti-jargon guard;
 *   - GATE-HYG-001: Physical hygiene guard (0-byte file and line ending enforcement);
 *   - GATE-BUDGET-001: Gate performance tiering (fast staged pre-commit vs full pre-push);
 *   - GATE-ERR-001: Strict error handling discipline in gate scripts;
 *   - GATE-SSOT-001: Rule SSOT catalog synchronization.
 * Exit Semantics & Design Rationale: Pure metadata; zero runtime execution logic.
 */

import type { RuleDefinition } from '../types';
import {
    ALL_LANGUAGES,
    defineRule,
    RULE_FAMILY_GATE,
    SEVERITY_ERROR,
    SEVERITY_WARNING,
} from '../types';
import { ANALYZER_GATE_ARCHITECTURE } from '../../scoring/dimensionLiterals';

/**
 * Gate system architecture and engineering governance rule definitions.
 */
export const GATE_GOVERNANCE_RULES: readonly RuleDefinition[] = [
    defineRule({
        id: 'GATE-SYS-001',
        family: RULE_FAMILY_GATE,
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Repository completely lacks a gate defense system (no Git hooks and no CI pipeline detected).',
        remediation:
            'Scaffold a standardized 2-tier gate system with pre-commit, commit-msg, pre-push hooks and CI workflow.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gate-sys-001',
    }),
    defineRule({
        id: 'GATE-HOOK-001',
        family: RULE_FAMILY_GATE,
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Repository lacks local left-shift Git hooks; all defect feedback relies solely on remote CI.',
        remediation:
            'Install local Git hooks (.githooks or .husky) to catch hygiene and regression defects prior to git commit.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gate-hook-001',
    }),
    defineRule({
        id: 'GATE-ISO-001',
        family: RULE_FAMILY_GATE,
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Dual-tier gate boundary is not isomorphic; remote CI checks are not mirrored in local hooks.',
        remediation:
            'Ensure local gate scripts mirror CI pipeline checks to achieve dual-tier isomorphism.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gate-iso-001',
    }),
    defineRule({
        id: 'GATE-ROUTE-001',
        family: RULE_FAMILY_GATE,
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Git hook router invokes fragile shell or Windows PS 5.1 directly without cross-platform safety fallback.',
        remediation:
            'Route hooks via cross-platform pwsh with bash fallback; avoid fragile /bin/sh or Windows PowerShell 5.1.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gate-route-001',
    }),
    defineRule({
        id: 'GATE-MSG-001',
        family: RULE_FAMILY_GATE,
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Gate system lacks structured commit-msg validation for Conventional Commits and anti-jargon hygiene.',
        remediation:
            'Implement structured commit-msg gate enforcing conventional commits and structured sections.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gate-msg-001',
    }),
    defineRule({
        id: 'GATE-HYG-001',
        family: RULE_FAMILY_GATE,
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Pre-commit gate does not enforce physical hygiene: lacks zero-byte empty file detection.',
        remediation:
            'Add physical hygiene gate to pre-commit to block 0-byte empty files and CRLF line endings.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gate-hyg-001',
    }),
    defineRule({
        id: 'GATE-BUDGET-001',
        family: RULE_FAMILY_GATE,
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Pre-commit gate runs unconstrained whole-repo test suites without staged-file filtering, risking budget overrun.',
        remediation:
            'Tier gate performance: keep pre-commit under 2s on staged files; defer full regressions to pre-push.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gate-budget-001',
    }),
    defineRule({
        id: 'GATE-ERR-001',
        family: RULE_FAMILY_GATE,
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Gate script lacks strict error termination flags, risking silent failures and false-positive gate passes.',
        remediation:
            "Enforce strict error flags (set -euo pipefail or $ErrorActionPreference = 'Stop') in all gate scripts.",
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gate-err-001',
    }),
    defineRule({
        id: 'GATE-SSOT-001',
        family: RULE_FAMILY_GATE,
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Gate system lacks single-source-of-truth rule catalog verification, risking rule drift.',
        remediation: 'Synchronize gate rule validation with a centralized single-source catalog.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#gate-ssot-001',
    }),
];
