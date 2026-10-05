/**
 * Module: Core Governance — Repository Gate Architecture Governance Evaluator
 * File Path: src/core/governance/gate-governance.ts
 * Architecture Role: Evaluates repository gate health across two major scenarios:
 *   Scenario A: Completely missing or partially missing gate defense systems;
 *   Scenario B: 7-dimensional rigorous audit of existing gate infrastructure.
 * Dependencies & Triggers: Consumes RepoArchetypeContext; invoked by GateArchitectureAnalyzer,
 *   CLI audits, and Agent pre-flight diagnostics.
 * Responsibilities:
 *   1. Scenario A: Emit GATE-SYS-001 or GATE-HOOK-001 with full GateScaffoldPayload;
 *   2. Scenario B: Evaluate 7 dimensions:
 *      - GATE-ISO-001: Dual-tier isomorphism between local hooks and remote CI;
 *      - GATE-ROUTE-001: Runtime degradation and execution safety in hook routers;
 *      - GATE-MSG-001: Commit-msg engineering structure and anti-jargon guard;
 *      - GATE-HYG-001: Physical hygiene (0-byte file and line ending enforcement);
 *      - GATE-BUDGET-001: Gate performance tiering (fast staged pre-commit vs full pre-push);
 *      - GATE-ERR-001: Strict error handling flags in gate scripts;
 *      - GATE-SSOT-001: Rule SSOT catalog synchronization.
 * Exit Semantics & Design Rationale: Deterministic pure evaluation returning Issue[].
 *   Never throws; attaches structured AgentActionablePayload to all findings.
 */

import * as path from 'path';
import type { Issue, Severity, AgentActionablePayload } from '../types';
import { SEVERITY_ERROR, SEVERITY_WARNING } from '../types';
import type { RepoArchetypeContext } from './repo-archetype';
import { inspectRepoArchetype } from './repo-archetype';
import { generateGateScaffold } from './gate-scaffold';

/** Canonical analyzer identifier for gate architecture governance. */
export const ANALYZER_GATE_ARCHITECTURE = 'gate-architecture';

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

function createGateIssue(
    ruleId: string,
    filePath: string,
    line: number,
    severity: Severity,
    risk: 'critical' | 'high' | 'medium' | 'low',
    category: string,
    message: string,
    remediation: string,
    rationale: string,
    actionable?: AgentActionablePayload,
    extraDetail?: Record<string, any>,
): Issue {
    return {
        id: `${ANALYZER_GATE_ARCHITECTURE}:${ruleId}:${filePath.replace(/\\/g, '/')}:${line}`,
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        rule: ruleId,
        severity,
        message,
        location: {
            file: filePath.replace(/\\/g, '/'),
            start: { line, column: 1 },
            end: { line, column: 1 },
        },
        detail: {
            category,
            risk,
            remediation,
            rationale,
            ...(extraDetail || {}),
        },
        suggestion: remediation,
        actionable,
    };
}

/**
 * Scenario A: Audit for completely or partially missing gate defense systems.
 */
function auditMissingGates(context: RepoArchetypeContext, issues: Issue[]): boolean {
    const hasHooks = context.hooks.allHookFiles.length > 0;
    const hasCi = context.ci.workflowFiles.length > 0;

    // Both missing: Critical system void
    if (!hasHooks && !hasCi) {
        const scaffold = generateGateScaffold(context, 'GATE-SYS-001');
        issues.push(
            createGateIssue(
                'GATE-SYS-001',
                context.manifests.packageJson
                    ? 'package.json'
                    : context.manifests.cargoToml
                      ? 'Cargo.toml'
                      : '.',
                1,
                SEVERITY_ERROR,
                'critical',
                'architecture',
                `Repository completely lacks a gate defense system (no Git hooks and no CI pipeline detected for ${context.primaryArchetype} project).`,
                'Scaffold a standardized 2-tier gate system with pre-commit, commit-msg, pre-push hooks and CI workflow.',
                'Unchecked repositories accumulate syntax errors, broken builds, and technical debt that delay developer feedback loops.',
                scaffold,
            ),
        );
        return true;
    }

    // CI exists, but local hooks are completely missing
    if (hasCi && !hasHooks) {
        const scaffold = generateGateScaffold(context, 'GATE-HOOK-001');
        issues.push(
            createGateIssue(
                'GATE-HOOK-001',
                context.ci.workflowFiles[0] || '.',
                1,
                SEVERITY_WARNING,
                'high',
                'architecture',
                'Repository lacks local left-shift Git hooks (Tier 1 Gate missing); all quality validation is deferred to remote CI.',
                'Install local Git hooks (.githooks or .husky) to catch hygiene and regression defects prior to git commit.',
                'Waiting for remote CI to catch trivial formatting or syntax errors incurs significant feedback latency and pollutes Git commit history.',
                scaffold,
            ),
        );
        return false;
    }

    // Local hooks exist, but remote CI pipeline is completely missing
    if (hasHooks && !hasCi) {
        const scaffold = generateGateScaffold(context, 'GATE-ISO-001');
        issues.push(
            createGateIssue(
                'GATE-ISO-001',
                context.manifests.packageJson
                    ? 'package.json'
                    : context.manifests.cargoToml
                      ? 'Cargo.toml'
                      : '.',
                1,
                SEVERITY_WARNING,
                'high',
                'architecture',
                `Repository has local Git hooks but lacks a remote CI pipeline (Tier 2 Remote Gate missing for ${context.primaryArchetype} project).`,
                'Set up a remote CI workflow (e.g. .github/workflows/ci.yml) to mirror local gate checks on pull requests and pushes.',
                'Relying solely on local hooks cannot enforce quality standards against bypassed commits (--no-verify) or external contributions.',
                scaffold,
            ),
        );
        return false;
    }

    return false;
}

/**
 * Dimension 1: GATE-ISO-001: Dual-Tier Isomorphism.
 */
function auditIsomorphism(context: RepoArchetypeContext, issues: Issue[]): void {
    if (context.ci.workflowFiles.length === 0 || context.hooks.allHookFiles.length === 0) {
        return;
    }

    // Check if CI runs checks (e.g. hygiene, lint, test) that local pre-commit/pre-push lacks
    const ciContentCombined = Object.values(context.ci.workflowContents).join('\n').toLowerCase();
    const localContentCombined = [
        context.hooks.preCommit?.content || '',
        context.hooks.prePush?.content || '',
        ...Object.values(context.gateScripts.contents),
    ]
        .join('\n')
        .toLowerCase();

    const checkSignatures = [
        {
            name: 'hygiene',
            ciPattern: /hygiene|0-byte|empty|crlf/i,
            localPattern: /hygiene|0-byte|empty|crlf/i,
        },
        {
            name: 'lint',
            ciPattern: /npm run lint|eslint|cargo clippy|flake8|pylint/i,
            localPattern: /lint|clippy|flake8|eslint/i,
        },
        {
            name: 'test/regression',
            ciPattern: /npm test|cargo test|pytest|go test/i,
            localPattern: /npm test|cargo test|pytest|go test|run_test/i,
        },
    ];

    for (const sig of checkSignatures) {
        const inCi = sig.ciPattern.test(ciContentCombined);
        const inLocal = sig.localPattern.test(localContentCombined);

        if (inCi && !inLocal) {
            issues.push(
                createGateIssue(
                    'GATE-ISO-001',
                    context.ci.workflowFiles[0],
                    1,
                    SEVERITY_WARNING,
                    'high',
                    'architecture',
                    `Dual-tier gate boundary is not isomorphic: remote CI enforces '${sig.name}', but local Git hooks lack corresponding validation.`,
                    `Mirror the '${sig.name}' check in local pre-commit or pre-push gates to ensure local and remote defense parity.`,
                    'Discrepancies between local gates and remote CI lead to unexpected PR failures and developer friction.',
                    undefined,
                    {
                        action: 'sync_gate_parity',
                        missingCheck: sig.name,
                        targetHook: sig.name === 'test/regression' ? 'pre-push' : 'pre-commit',
                        safeToAutomate: false,
                    },
                ),
            );
        }
    }
}

/**
 * Dimension 2: GATE-ROUTE-001: Hook Runtime Degradation & Safety.
 */
function auditRoutingSafety(context: RepoArchetypeContext, issues: Issue[]): void {
    const hookFiles = [
        context.hooks.preCommit,
        context.hooks.commitMsg,
        context.hooks.prePush,
    ].filter((h): h is NonNullable<typeof h> => Boolean(h));

    for (const hook of hookFiles) {
        const content = hook.content;
        const relPath = path.relative(context.root, hook.filePath).replace(/\\/g, '/');

        // Check 1: Using powershell.exe directly instead of pwsh
        // (risks Windows PS 5.1 UTF-8 encoding corruption)
        if (/\bpowershell(?:\.exe)?\b/i.test(content) && !/\bpwsh\b/i.test(content)) {
            issues.push(
                createGateIssue(
                    'GATE-ROUTE-001',
                    relPath,
                    1,
                    SEVERITY_ERROR,
                    'high',
                    'reliability',
                    `Hook router '${hook.name}' invokes Windows PowerShell 5.1 (powershell.exe) directly instead of cross-platform 'pwsh'.`,
                    'Prioritize cross-platform pwsh and fall back gracefully to bash to prevent Windows PS 5.1 UTF-8 BOM encoding issues.',
                    'Windows PowerShell 5.1 misinterprets UTF-8 files without BOM, leading to silent script syntax failures in automated environments.',
                    undefined,
                    {
                        action: 'harden_hook_router',
                        targetFile: relPath,
                        safeToAutomate: true,
                    },
                ),
            );
        }

        // Check 2: Pure /bin/sh invocation with potential bashisms
        if (/^#!\/bin\/sh\b/m.test(content) && /(?:\[\[|\(\(|\bfunction\b)/.test(content)) {
            issues.push(
                createGateIssue(
                    'GATE-ROUTE-001',
                    relPath,
                    1,
                    SEVERITY_ERROR,
                    'high',
                    'reliability',
                    `Hook router '${hook.name}' declares #!/bin/sh shebang but contains non-portable Bash syntax.`,
                    'Change shebang to #!/usr/bin/env bash or remove bashisms to prevent execution failures on Debian/Ubuntu dash.',
                    'On many Linux distributions /bin/sh points to dash, which fails immediately on bash-specific syntax constructs.',
                ),
            );
        }
    }
}

/**
 * Dimension 3: GATE-MSG-001: Commit Message Engineering Integrity.
 */
function auditCommitMsgGate(context: RepoArchetypeContext, issues: Issue[]): void {
    if (context.hooks.allHookFiles.length === 0) return;

    if (!context.hooks.commitMsg) {
        issues.push(
            createGateIssue(
                'GATE-MSG-001',
                context.hooks.hookDir || '.githooks',
                1,
                SEVERITY_WARNING,
                'medium',
                'standardization',
                'Gate system lacks a commit-msg hook; commit messages are not verified for Conventional Commits or structural contracts.',
                'Introduce a commit-msg gate script to enforce standard conventional commits prefix and structured sections.',
                'Unvalidated commit messages lead to unsearchable Git history, breaking automated changelog and semantic release tooling.',
                undefined,
                {
                    action: 'add_commit_msg_gate',
                    safeToAutomate: true,
                },
            ),
        );
        return;
    }

    const content = context.hooks.commitMsg.content;
    const relPath = path
        .relative(context.root, context.hooks.commitMsg.filePath)
        .replace(/\\/g, '/');

    // Check if the commit-msg hook or runner actually verifies conventional commits
    const hasConventionalCheck =
        /(?:feat|fix|refactor|chore|test|docs|style|perf)/i.test(content) ||
        Object.values(context.gateScripts.contents).some((c) => /commit-msg|conventional/i.test(c));

    if (!hasConventionalCheck) {
        issues.push(
            createGateIssue(
                'GATE-MSG-001',
                relPath,
                1,
                SEVERITY_WARNING,
                'medium',
                'standardization',
                'Existing commit-msg gate does not enforce Conventional Commits (<type>(<scope>): <summary>) format.',
                'Enforce Conventional Commits regex validation in commit-msg gate script.',
                'Standardized commit message prefixes are required for automated auditing and semantic versioning.',
            ),
        );
    }

    // GATE-MSG-003: Monorepo Project Scope & Whitelist Verification (Adaptive to topology)
    // If repository is Single-Project (not a Monorepo), auto-mute: zero findings emitted.
    if (context.topology.isMonorepo) {
        const combinedCommitScripts = [
            content,
            ...Object.entries(context.gateScripts.contents)
                .filter(([k]) => /commit-msg/i.test(k))
                .map(([, v]) => v),
        ].join('\n');

        const hasProjectScopeCheck =
            /(?:\[Project|\[\s*Project\s*\/?\s*项目归属|IN_PROJECT_SECTION|FOUND_PROJECT_HEADER|VALID_PROJECTS)/i.test(
                combinedCommitScripts,
            );

        if (!hasProjectScopeCheck) {
            issues.push(
                createGateIssue(
                    'GATE-MSG-003',
                    relPath,
                    1,
                    SEVERITY_ERROR,
                    'high',
                    'standardization',
                    'Monorepo commit-msg gate lacks [Project / 项目归属] format section and subproject whitelist validation.',
                    'Implement [Project] format section validation in commit-msg gate to demarcate subproject attribution.',
                    'In multi-project repositories, unattributed commits blur architecture boundaries and cause cross-project contamination.',
                    undefined,
                    {
                        action: 'add_project_scope_gate',
                        targetFile: relPath,
                        detectedSubprojects: context.topology.subprojects.map((s) => s.name),
                        safeToAutomate: true,
                    },
                ),
            );
        }
    }
}

/**
 * Dimension 4: GATE-HYG-001: Physical Hygiene Guard.
 */
function auditHygieneGuard(context: RepoArchetypeContext, issues: Issue[]): void {
    if (context.hooks.allHookFiles.length === 0) return;

    const preCommit = context.hooks.preCommit;
    if (!preCommit) return;

    const content = [preCommit.content, ...Object.values(context.gateScripts.contents)].join('\n');

    const relPath = path.relative(context.root, preCommit.filePath).replace(/\\/g, '/');

    // Look for physical zero-byte empty file detection:
    // ! -s, -empty, Length -eq 0, size === 0, etc.
    const hasZeroByteCheck =
        /(?:!\s*-s|-empty|Length\s*-eq\s*0|stat\s*-c\s*%s|\.size\s*===?\s*0|0-byte)/i.test(content);

    if (!hasZeroByteCheck) {
        issues.push(
            createGateIssue(
                'GATE-HYG-001',
                relPath,
                1,
                SEVERITY_ERROR,
                'high',
                'hygiene',
                'Pre-commit gate does not enforce physical hygiene: lacks zero-byte (0-byte) empty file detection.',
                'Add zero-byte empty file detection to pre-commit gate to block accidental empty file commits.',
                'Zero-byte empty files pollute the codebase, break module resolution, and bypass AST static analysis.',
                undefined,
                {
                    action: 'add_hygiene_check',
                    targetHook: 'pre-commit',
                    safeToAutomate: true,
                },
            ),
        );
    }
}

/**
 * Dimension 5: GATE-BUDGET-001: Performance Tiering & Budget.
 */
function auditBudgetTiering(context: RepoArchetypeContext, issues: Issue[]): void {
    const preCommit = context.hooks.preCommit;
    if (!preCommit) return;

    const content = preCommit.content.toLowerCase();
    const relPath = path.relative(context.root, preCommit.filePath).replace(/\\/g, '/');

    // Anti-pattern: Pre-commit running unconstrained full regressions
    // (e.g. bare npm test, cargo test) without staged file checks
    const hasStagedFiltering =
        /(?:git\s+diff|--cached|--staged|staged)/i.test(content) ||
        Object.values(context.gateScripts.contents).some((c) =>
            /diff\s+--cached|--staged/i.test(c),
        );

    const runsHeavyweightUnstaged =
        /(?:cargo\s+test\s*--workspace|npm\s+test(?!\s*--\s*--staged)|pytest\s+tests\/|go\s+test\s+\.\/\.\.\.)/i.test(
            content,
        );

    if (!hasStagedFiltering && runsHeavyweightUnstaged) {
        issues.push(
            createGateIssue(
                'GATE-BUDGET-001',
                relPath,
                1,
                SEVERITY_WARNING,
                'medium',
                'performance',
                'Pre-commit gate runs unconstrained whole-repo test suites without staged-file filtering, risking budget overrun.',
                'Tier gate performance: restrict pre-commit to fast staged-slice checks (< 2s) and defer full regressions to pre-push.',
                'Slow pre-commit gates disrupt developer flow and encourage bypassing gates via git commit --no-verify.',
            ),
        );
    }
}

/**
 * Dimension 6: GATE-ERR-001: Strict Error Discipline in Gate Scripts.
 */
function auditStrictErrorDiscipline(context: RepoArchetypeContext, issues: Issue[]): void {
    // Check all discovered gate scripts and hook files
    const scriptsToCheck: Array<{ filePath: string; content: string }> = [
        ...(context.hooks.preCommit ? [context.hooks.preCommit] : []),
        ...(context.hooks.commitMsg ? [context.hooks.commitMsg] : []),
        ...(context.hooks.prePush ? [context.hooks.prePush] : []),
        ...Object.entries(context.gateScripts.contents).map(([rel, c]) => ({
            filePath: path.join(context.root, rel),
            content: c,
        })),
    ];

    for (const script of scriptsToCheck) {
        const content = script.content;
        const relPath = path.relative(context.root, script.filePath).replace(/\\/g, '/');

        if (
            script.filePath.endsWith('.sh') ||
            (!script.filePath.includes('.') && content.startsWith('#!'))
        ) {
            // Shell script: must declare set -e or set -euo pipefail
            if (!/set\s+-[a-z]*e/m.test(content)) {
                issues.push(
                    createGateIssue(
                        'GATE-ERR-001',
                        relPath,
                        1,
                        SEVERITY_ERROR,
                        'high',
                        'reliability',
                        `Gate script '${path.basename(relPath)}' lacks strict error mode ('set -euo pipefail' or 'set -e').`,
                        'Add set -euo pipefail near script start to prevent silent failures and false-positive gate passes.',
                        'Without set -e, command failures inside gate scripts are ignored, leading to catastrophic false-pass gate releases.',
                        undefined,
                        {
                            action: 'add_strict_mode',
                            targetFile: relPath,
                            safeToAutomate: true,
                        },
                    ),
                );
            }
        } else if (script.filePath.endsWith('.ps1')) {
            // PowerShell: must declare $ErrorActionPreference = 'Stop'
            if (!/\$ErrorActionPreference\s*=\s*['"]?Stop['"]?/i.test(content)) {
                issues.push(
                    createGateIssue(
                        'GATE-ERR-001',
                        relPath,
                        1,
                        SEVERITY_ERROR,
                        'high',
                        'reliability',
                        `Gate script '${path.basename(relPath)}' lacks strict error preference ('$ErrorActionPreference = "Stop"').`,
                        "Declare $ErrorActionPreference = 'Stop' at the top of PowerShell gate script.",
                        'PowerShell by default continues execution after non-terminating errors, resulting in false-positive gate passes.',
                        undefined,
                        {
                            action: 'add_strict_error_preference',
                            targetFile: relPath,
                            safeToAutomate: true,
                        },
                    ),
                );
            }
        }
    }
}

/**
 * Dimension 7: GATE-SSOT-001: Rule SSOT Catalog Synchronization.
 */
function auditSsotSync(context: RepoArchetypeContext, issues: Issue[]): void {
    // If gate scripts check rule codes or catalog, check if catalog file exists
    const gateScriptsContent = Object.values(context.gateScripts.contents).join('\n');
    const mentionsRuleCatalog = /rule-catalog\.json|review-rules\.json|rules-registry/i.test(
        gateScriptsContent,
    );

    if (mentionsRuleCatalog) {
        // Look for the catalog file
        const catalogExists =
            Object.keys(context.gateScripts.contents).some((f) =>
                /rule-catalog\.json|review-rules\.json/i.test(f),
            ) || context.gateScripts.files.some((f) => /catalog|registry/i.test(f));

        if (!catalogExists) {
            issues.push(
                createGateIssue(
                    'GATE-SSOT-001',
                    'scripts',
                    1,
                    SEVERITY_WARNING,
                    'medium',
                    'architecture',
                    'Gate system references rule catalog verification but single-source catalog file is missing or unregistered.',
                    'Maintain a single source of truth catalog (e.g. scripts/common/rule-catalog.json) and verify gate rules against it.',
                    'Hardcoding rule IDs across multiple gate scripts leads to rule drift, phantom rules, and gate inconsistency.',
                ),
            );
        }
    }
}

/**
 * Dimension 8: GATE-MSG-002: Commit Message Style Constraints & Bilingual Terms Guard.
 */
function auditCommitMsgStyle(context: RepoArchetypeContext, issues: Issue[]): void {
    if (context.hooks.allHookFiles.length === 0) return;

    const gateScriptsContent = Object.values(context.gateScripts.contents).join('\n');
    const commitMsgHookContent = context.hooks.commitMsg?.content || '';
    const combined = `${gateScriptsContent}\n${commitMsgHookContent}`;

    // Verify whether commit-msg-forbidden-terms.json or validate-commit-msg-style is wired
    const wiresStyleCheck = /commit-msg-forbidden-terms\.json|validate-commit-msg-style/i.test(
        combined,
    );

    const relHookPath = context.hooks.commitMsg
        ? path.relative(context.root, context.hooks.commitMsg.filePath).replace(/\\/g, '/')
        : 'scripts/ps1/commit-msg-gate.ps1';

    if (!wiresStyleCheck) {
        issues.push(
            createGateIssue(
                'GATE-MSG-002',
                relHookPath,
                1,
                SEVERITY_WARNING,
                'medium',
                'standardization',
                'Commit-msg gate does not enforce bidirectional bilingual style terms constraints (commit-msg-forbidden-terms.json unwired).',
                'Wire validate-commit-msg-style.js or commit-msg-forbidden-terms.json into commit-msg-gate to intercept temporary and non-factual language.',
                'Unchecked commit style leads to casual jargon, hyperbolic exaggerations, and circumvented quality constraints.',
            ),
        );
        return;
    }

    // Verify the dictionary file has bilingual patterns if present in gateScripts
    const termsContent = Object.entries(context.gateScripts.contents).find(([f]) =>
        /commit-msg-forbidden-terms\.json/i.test(f),
    )?.[1];

    if (termsContent) {
        const hasEnglish = /asciiPatterns|temporary|hyperbolic|meta_narrative/i.test(termsContent);
        const hasChinese = /[\u4e00-\u9fa5]/.test(termsContent);

        if (!hasEnglish || !hasChinese) {
            issues.push(
                createGateIssue(
                    'GATE-MSG-002',
                    'scripts/common/commit-msg-forbidden-terms.json',
                    1,
                    SEVERITY_WARNING,
                    'medium',
                    'standardization',
                    'Forbidden terms dictionary lacks bidirectional bilingual coverage (must contain both English and Chinese constraints).',
                    'Include both asciiPatterns (English) and patterns (Chinese) in forbidden terms dictionary to prevent language bypass.',
                    'Agents or contributors can bypass single-language filters by substituting equivalent foreign terms.',
                ),
            );
        }
    }
}

/**
 * Dimension 9: GATE-AST-001: AST Staged Slice Complexity & Nesting Guard.
 */
function auditAstSliceGuard(context: RepoArchetypeContext, issues: Issue[]): void {
    if (context.hooks.allHookFiles.length === 0) return;

    const preCommitContent = [
        context.hooks.preCommit?.content || '',
        ...Object.entries(context.gateScripts.contents)
            .filter(([k]) => /pre-commit/i.test(k))
            .map(([, v]) => v),
    ].join('\n');

    const relPath = context.hooks.preCommit
        ? path.relative(context.root, context.hooks.preCommit.filePath).replace(/\\/g, '/')
        : 'scripts/ps1/pre-commit-gate.ps1';

    // Verify whether pre-commit gate inspects staged AST slices
    const hasAstSliceCheck =
        /validate-staged-slice|ast[-_]slice|complexity.*depth|CC\s*<=\s*15/i.test(preCommitContent);

    if (!hasAstSliceCheck) {
        issues.push(
            createGateIssue(
                'GATE-AST-001',
                relPath,
                1,
                SEVERITY_ERROR,
                'high',
                'maintainability',
                'Pre-commit gate lacks AST staged slice complexity and nesting budget check (CC <= 15, Depth <= 4).',
                'Integrate validate-staged-slice.js into pre-commit gate to reject over-complex staged functions prior to commit.',
                'Allowing complex methods to be committed defers technical debt detection to late-stage full regression reviews.',
            ),
        );
    }
}

/**
 * Dimension 10: GATE-FAC-001: Facade Substantive Bearing & Vacuous Forwarding Elimination.
 */
function auditFacadeDisciplineGuard(context: RepoArchetypeContext, issues: Issue[]): void {
    const combinedScripts = [
        ...Object.values(context.gateScripts.contents),
        context.hooks.preCommit?.content || '',
        context.hooks.prePush?.content || '',
    ].join('\n');

    // Look for facade discipline or ARCH-FAC / ARCH-ABS verification in gate scripts
    const hasFacadeCheck =
        /validate-facade|facade-discipline|ARCH-FAC-001|ARCH-ABS-001|facade-governance/i.test(
            combinedScripts,
        );

    if (!hasFacadeCheck) {
        issues.push(
            createGateIssue(
                'GATE-FAC-001',
                context.hooks.prePush
                    ? path
                          .relative(context.root, context.hooks.prePush.filePath)
                          .replace(/\\/g, '/')
                    : 'scripts',
                1,
                SEVERITY_ERROR,
                'high',
                'architecture',
                'Gate pipeline lacks static validation for facade substantive bearing (ELOC >= 15) and vacuous forwarding elimination.',
                'Incorporate facade discipline verification into pre-push or self-audit gates to eliminate pass-through shims.',
                'Vacuous forwarding shims add unnecessary indirection layers without domain logic, increasing maintenance overhead.',
            ),
        );
    }
}

/**
 * Dimension 11: GATE-PROC-001: PowerShell Terminal Non-Interactive & Output Redirection Guard.
 */
function auditProcessInteractiveSafety(context: RepoArchetypeContext, issues: Issue[]): void {
    const ps1Scripts = Object.entries(context.gateScripts.contents).filter(([f]) =>
        f.endsWith('.ps1'),
    );

    for (const [relPath, content] of ps1Scripts) {
        // Detect interactive commands that lack non-interactive redirection guard
        if (/\b(?:Read-Host|pause|choice\.exe)\b/i.test(content)) {
            const hasRedirectGuard = /IsOutputRedirected|UserInteractive/i.test(content);

            if (!hasRedirectGuard) {
                issues.push(
                    createGateIssue(
                        'GATE-PROC-001',
                        relPath,
                        1,
                        SEVERITY_ERROR,
                        'medium',
                        'reliability',
                        `PowerShell gate script '${path.basename(relPath)}' uses interactive prompts without output redirection guard.`,
                        'Wrap interactive prompt blocks with: if ([Environment]::UserInteractive -and -not [Console]::IsOutputRedirected).',
                        'Interactive prompts in headless CI or Agent child processes cause silent hangs and pipeline timeouts.',
                    ),
                );
            }
        }
    }
}

/**
 * Dimension 12: GATE-PAIR-001: Dual-Platform Gate Script Isomorphic Pairing Guard.
 */
function auditDualPlatformPairing(context: RepoArchetypeContext, issues: Issue[]): void {
    const isCoreGateScript = (f: string) =>
        /(?:pre-commit|commit-msg|pre-push|audit-all)[-_]gate|audit-all/i.test(f);

    const shScripts = context.gateScripts.files.filter(
        (f) => f.startsWith('scripts/sh/') && f.endsWith('.sh') && isCoreGateScript(f),
    );
    const ps1Scripts = context.gateScripts.files.filter(
        (f) => f.startsWith('scripts/ps1/') && f.endsWith('.ps1') && isCoreGateScript(f),
    );

    // If neither exists, this repo does not use scripts/sh or scripts/ps1 dual structure
    if (shScripts.length === 0 && ps1Scripts.length === 0) return;

    const shBases = new Set(shScripts.map((f) => path.basename(f, '.sh')));
    const ps1Bases = new Set(ps1Scripts.map((f) => path.basename(f, '.ps1')));

    for (const base of shBases) {
        if (!ps1Bases.has(base)) {
            issues.push(
                createGateIssue(
                    'GATE-PAIR-001',
                    `scripts/sh/${base}.sh`,
                    1,
                    SEVERITY_WARNING,
                    'medium',
                    'reliability',
                    `Shell gate script 'scripts/sh/${base}.sh' lacks matching 'scripts/ps1/${base}.ps1'.`,
                    `Provide isomorphic 'scripts/ps1/${base}.ps1' script for cross-platform parity.`,
                    'Asymmetric gate scripts cause validation discrepancies across developer platforms.',
                ),
            );
        }
    }

    for (const base of ps1Bases) {
        if (!shBases.has(base)) {
            issues.push(
                createGateIssue(
                    'GATE-PAIR-001',
                    `scripts/ps1/${base}.ps1`,
                    1,
                    SEVERITY_WARNING,
                    'medium',
                    'reliability',
                    `PowerShell gate script 'scripts/ps1/${base}.ps1' lacks matching 'scripts/sh/${base}.sh'.`,
                    `Provide isomorphic 'scripts/sh/${base}.sh' script for cross-platform parity.`,
                    'Asymmetric gate scripts cause validation discrepancies across developer platforms.',
                ),
            );
        }
    }
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
    }

    const hasLocalGates = context.hooks.allHookFiles.length > 0;
    const hasCiPipelines = context.ci.workflowFiles.length > 0;
    const isIsomorphic = !issues.some((i) => i.rule === 'GATE-ISO-001');

    return {
        context,
        issues,
        passed: issues.length === 0,
        metrics: {
            totalRulesAudited: 15,
            violationsCount: issues.length,
            hasLocalGates,
            hasCiPipelines,
            isIsomorphic,
        },
    };
}
