/**
 * Module: Core Governance — Repository Gate Architecture Governance Evaluator
 * File Path: src/core/governance/gate-governance.ts
 * Architecture Role: Evaluates repository gate health across two major scenarios:
 *   Scenario A: Completely missing or partially missing gate defense systems;
 *   Scenario B: 7-dimensional rigorous audit of existing gate infrastructure.
 * Dependencies & Triggers: Consumes RepoArchetypeContext; invoked by GateArchitectureAnalyzer,
 *   CLI audits, and Agent pre-flight diagnostics.
 * Responsibilities:
 *   1. Scenario A: Emit GUARD-SYS-001 or GUARD-HOOK-001 with full GateScaffoldPayload;
 *   2. Scenario B: Evaluate 7 dimensions:
 *      - GUARD-ISO-001: Dual-tier isomorphism between local hooks and remote CI;
 *      - GUARD-ROUTE-001: Runtime degradation and execution safety in hook routers;
 *      - GUARD-MSG-001: Commit-msg engineering structure and anti-jargon guard;
 *      - GUARD-HYG-001: Physical hygiene (0-byte file and line ending enforcement);
 *      - GUARD-BUDGET-001: Gate performance tiering (fast staged pre-commit vs full pre-push);
 *      - GUARD-ERR-001: Strict error handling flags in gate scripts;
 *      - GUARD-SSOT-001: Rule SSOT catalog synchronization.
 * Exit Semantics & Design Rationale: Deterministic pure evaluation returning Issue[].
 *   Never throws; attaches structured AgentActionablePayload to all findings.
 */

import type { Issue } from '../types';
import { SEVERITY_ERROR, SEVERITY_WARNING } from '../types';
import type { RepoArchetypeContext } from './repo-archetype';
import { inspectRepoArchetype } from './repo-archetype';
import { generateGateScaffold } from './gate-scaffold';
import { auditFeedbackVocabulary } from './gate-feedback';
import {
    ANALYZER_GATE_ARCHITECTURE,
    createGateIssue,
    type GateIssueParams,
    auditIsomorphism,
    auditRoutingSafety,
    auditCommitMsgGate,
    auditHygieneGuard,
    auditBudgetTiering,
    auditStrictErrorDiscipline,
    auditSsotSync,
    auditCommitMsgStyle,
    auditAstSliceGuard,
    auditFacadeDisciplineGuard,
    auditProcessInteractiveSafety,
    auditDualPlatformPairing,
} from './gate-scenario-evaluators';

export { ANALYZER_GATE_ARCHITECTURE, createGateIssue, type GateIssueParams };

const MANIFEST_PACKAGE_JSON = 'package.json';
const MANIFEST_CARGO_TOML = 'Cargo.toml';
const REPO_ROOT_DIR = '.';

const TOTAL_RULES_AUDITED = 16;

/** Options configuring gate architecture audit. */
export interface GateGovernanceOptions {
    enforceIsomorphism?: boolean;
    enforceStrictError?: boolean;
    enforceHygiene?: boolean;
    enforceCommitMsg?: boolean;
    enforceRoutingSafety?: boolean;
    enforceBudgetTiering?: boolean;
    enforceSsotSync?: boolean;
    enforceCommitMsgStyle?: boolean;
    enforceAstSlice?: boolean;
    enforceFacadeDiscipline?: boolean;
    enforceProcessGuard?: boolean;
    enforceMonorepoScope?: boolean;
    enforcePairing?: boolean;
    enforceFeedbackVocabulary?: boolean;
}

/** Comprehensive audit result. */
export interface GateAuditResult {
    context: RepoArchetypeContext;
    issues: Issue[];
    passed: boolean;
    metrics: {
        totalRulesAudited: number;
        violationsCount: number;
        hasLocalGates: boolean;
        hasCiPipelines: boolean;
        isIsomorphic: boolean;
    };
}

function resolveManifestTargetFile(manifests: RepoArchetypeContext['manifests']): string {
    if (manifests.packageJson) return MANIFEST_PACKAGE_JSON;
    if (manifests.cargoToml) return MANIFEST_CARGO_TOML;
    return REPO_ROOT_DIR;
}

/**
 * Scenario A: Audit for completely or partially missing gate defense systems.
 */
function auditMissingGates(context: RepoArchetypeContext, issues: Issue[]): boolean {
    const hasHooks = context.hooks.allHookFiles.length > 0;
    const hasCi = context.ci.workflowFiles.length > 0;

    // Both missing: Critical system void
    if (!hasHooks && !hasCi) {
        const scaffold = generateGateScaffold(context, 'GUARD-SYS-001');
        issues.push(
            createGateIssue({
                ruleId: 'GUARD-SYS-001',
                filePath: resolveManifestTargetFile(context.manifests),
                line: 1,
                severity: SEVERITY_ERROR,
                risk: 'critical',
                category: 'architecture',
                message:
                    `Repository completely lacks a gate defense system (no Git hooks and no CI` +
                    `pipeline detected for ${context.primaryArchetype} project).`,
                remediation:
                    'Scaffold a standardized 2-tier gate system with pre-commit, commit-msg, pre-push' +
                    'hooks and CI workflow.',
                rationale:
                    'Unchecked repositories accumulate syntax errors, broken builds, and technical' +
                    'debt that delay developer feedback loops.',
                actionable: scaffold,
            }),
        );
        return true;
    }

    // CI exists, but local hooks are completely missing
    if (hasCi && !hasHooks) {
        const scaffold = generateGateScaffold(context, 'GUARD-HOOK-001');
        issues.push(
            createGateIssue({
                ruleId: 'GUARD-HOOK-001',
                filePath: context.ci.workflowFiles[0] || REPO_ROOT_DIR,
                line: 1,
                severity: SEVERITY_WARNING,
                risk: 'high',
                category: 'architecture',
                message:
                    'Repository lacks local left-shift Git hooks (Tier 1 Gate missing); all quality' +
                    'validation is deferred to remote CI.',
                remediation:
                    'Install local Git hooks (.githooks or .husky) to catch hygiene and regression' +
                    'defects prior to git commit.',
                rationale:
                    'Waiting for remote CI to catch trivial formatting or syntax errors incurs' +
                    'significant feedback latency and pollutes Git commit history.',
                actionable: scaffold,
            }),
        );
        return false;
    }

    // Local hooks exist, but remote CI pipeline is completely missing
    if (hasHooks && !hasCi) {
        const scaffold = generateGateScaffold(context, 'GUARD-ISO-001');
        issues.push(
            createGateIssue({
                ruleId: 'GUARD-ISO-001',
                filePath: resolveManifestTargetFile(context.manifests),
                line: 1,
                severity: SEVERITY_WARNING,
                risk: 'high',
                category: 'architecture',
                message:
                    `Repository has local Git hooks but lacks a remote CI pipeline (Tier 2 Remote` +
                    `Gate missing for ${context.primaryArchetype} project).`,
                remediation:
                    'Set up a remote CI workflow (e.g. .github/workflows/ci.yml) to mirror local gate' +
                    'checks on pull requests and pushes.',
                rationale:
                    'Relying solely on local hooks cannot enforce quality standards against bypassed' +
                    'commits (--no-verify) or external contributions.',
                actionable: scaffold,
            }),
        );
        return false;
    }

    return false;
}

/**
 * Complete standalone audit of repository gate architecture.
 *
 * @param root - Path to repository root.
 * @param options - Audit configuration options.
 * @returns GateAuditResult with comprehensive findings and metrics.
 */
export function auditGateArchitecture(
    root: string,
    options: GateGovernanceOptions = {},
): GateAuditResult {
    const context = inspectRepoArchetype(root);
    const issues: Issue[] = [];

    // Scenario A: Missing gates
    const isMissingSystem = auditMissingGates(context, issues);

    // Scenario B: If gate system is present, execute multi-dimensional audits
    if (!isMissingSystem) {
        if (options.enforceIsomorphism !== false) auditIsomorphism(context, issues);
        if (options.enforceRoutingSafety !== false) auditRoutingSafety(context, issues);
        if (options.enforceCommitMsg !== false) auditCommitMsgGate(context, issues);
        if (options.enforceHygiene !== false) auditHygieneGuard(context, issues);
        if (options.enforceBudgetTiering !== false) auditBudgetTiering(context, issues);
        if (options.enforceStrictError !== false) auditStrictErrorDiscipline(context, issues);
        if (options.enforceSsotSync !== false) auditSsotSync(context, issues);
        if (options.enforceCommitMsgStyle !== false) auditCommitMsgStyle(context, issues);
        if (options.enforceAstSlice !== false) auditAstSliceGuard(context, issues);
        if (options.enforceFacadeDiscipline !== false) auditFacadeDisciplineGuard(context, issues);
        if (options.enforceProcessGuard !== false) auditProcessInteractiveSafety(context, issues);
        if (options.enforcePairing !== false) auditDualPlatformPairing(context, issues);
        if (options.enforceFeedbackVocabulary !== false) auditFeedbackVocabulary(context, issues);
    }

    const hasLocalGates = context.hooks.allHookFiles.length > 0;
    const hasCiPipelines = context.ci.workflowFiles.length > 0;
    const isIsomorphic = !issues.some((i) => i.rule === 'GUARD-ISO-001');

    return {
        context,
        issues,
        passed: issues.length === 0,
        metrics: {
            totalRulesAudited: TOTAL_RULES_AUDITED,
            violationsCount: issues.length,
            hasLocalGates,
            hasCiPipelines,
            isIsomorphic,
        },
    };
}
