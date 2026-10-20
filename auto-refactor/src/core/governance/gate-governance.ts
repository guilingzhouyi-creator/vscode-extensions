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

const RISK_CRITICAL = 'critical';
const RISK_HIGH = 'high';
const RISK_MEDIUM = 'medium';
const _RISK_LOW = 'low';

const CATEGORY_ARCHITECTURE = 'architecture';
const CATEGORY_RELIABILITY = 'reliability';
const _CATEGORY_SECURITY = 'security';
const CATEGORY_MAINTAINABILITY = 'maintainability';
const CATEGORY_STANDARDIZATION = 'standardization';
const CATEGORY_HYGIENE = 'hygiene';
const CATEGORY_PERFORMANCE = 'performance';

const MANIFEST_PACKAGE_JSON = 'package.json';
const MANIFEST_CARGO_TOML = 'Cargo.toml';
const REPO_ROOT_DIR = '.';

const TOTAL_RULES_AUDITED = 15;

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

function resolveManifestTargetFile(manifests: RepoArchetypeContext['manifests']): string {
    if (manifests.packageJson) return MANIFEST_PACKAGE_JSON;
    if (manifests.cargoToml) return MANIFEST_CARGO_TOML;
    return REPO_ROOT_DIR;
}

/** Strongly typed parameters for creating a gate governance issue. */
export interface GateIssueParams {
    readonly ruleId: string;
    readonly filePath: string;
    readonly line: number;
    readonly severity: Severity;
    readonly risk: 'critical' | 'high' | 'medium' | 'low';
    readonly category: string;
    readonly message: string;
    readonly remediation: string;
    readonly rationale: string;
    readonly actionable?: AgentActionablePayload;
    readonly extraDetail?: Record<string, any>;
}

function createGateIssue(params: GateIssueParams): Issue {
    const {
        ruleId,
        filePath,
        line,
        severity,
        risk,
        category,
        message,
        remediation,
        rationale,
        actionable,
        extraDetail,
    } = params;
    const normalizedFile = filePath.replace(/\\/g, '/');
    return {
        id: `${ANALYZER_GATE_ARCHITECTURE}:${ruleId}:${normalizedFile}:${line}`,
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        rule: ruleId,
        severity,
        message,
        location: {
            file: normalizedFile,
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
            createGateIssue({
                ruleId: 'GATE-SYS-001',
                filePath: resolveManifestTargetFile(context.manifests),
                line: 1,
                severity: SEVERITY_ERROR,
                risk: RISK_CRITICAL,
                category: CATEGORY_ARCHITECTURE,
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
        const scaffold = generateGateScaffold(context, 'GATE-HOOK-001');
        issues.push(
            createGateIssue({
                ruleId: 'GATE-HOOK-001',
                filePath: context.ci.workflowFiles[0] || REPO_ROOT_DIR,
                line: 1,
                severity: SEVERITY_WARNING,
                risk: RISK_HIGH,
                category: CATEGORY_ARCHITECTURE,
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
        const scaffold = generateGateScaffold(context, 'GATE-ISO-001');
        issues.push(
            createGateIssue({
                ruleId: 'GATE-ISO-001',
                filePath: resolveManifestTargetFile(context.manifests),
                line: 1,
                severity: SEVERITY_WARNING,
                risk: RISK_HIGH,
                category: CATEGORY_ARCHITECTURE,
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
                createGateIssue({
                    ruleId: 'GATE-ISO-001',
                    filePath: context.ci.workflowFiles[0],
                    line: 1,
                    severity: SEVERITY_WARNING,
                    risk: RISK_HIGH,
                    category: CATEGORY_ARCHITECTURE,
                    message:
                        `Dual-tier gate boundary is not isomorphic: remote CI enforces '${sig.name}',` +
                        `but local Git hooks lack corresponding validation.`,
                    remediation:
                        `Mirror the '${sig.name}' check in local pre-commit or pre-push gates to` +
                        `ensure local and remote defense parity.`,
                    rationale:
                        'Discrepancies between local gates and remote CI lead to unexpected PR' +
                        'failures and developer friction.',
                    extraDetail: {
                        action: 'sync_gate_parity',
                        missingCheck: sig.name,
                        targetHook: sig.name === 'test/regression' ? 'pre-push' : 'pre-commit',
                        safeToAutomate: false,
                    },
                }),
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
                createGateIssue({
                    ruleId: 'GATE-ROUTE-001',
                    filePath: relPath,
                    line: 1,
                    severity: SEVERITY_ERROR,
                    risk: RISK_HIGH,
                    category: CATEGORY_RELIABILITY,
                    message:
                        `Hook router '${hook.name}' invokes Windows PowerShell 5.1 (powershell.exe)` +
                        `directly instead of cross-platform 'pwsh'.`,
                    remediation:
                        'Prioritize cross-platform pwsh and fall back gracefully to bash to prevent' +
                        'Windows PS 5.1 UTF-8 BOM encoding issues.',
                    rationale:
                        'Windows PowerShell 5.1 misinterprets UTF-8 files without BOM, leading to' +
                        'silent script syntax failures in automated environments.',
                    extraDetail: {
                        action: 'harden_hook_router',
                        targetFile: relPath,
                        safeToAutomate: true,
                    },
                }),
            );
        }

        // Check 2: Pure /bin/sh invocation with potential bashisms
        if (/^#!\/bin\/sh\b/m.test(content) && /(?:\[\[|\(\(|\bfunction\b)/.test(content)) {
            issues.push(
                createGateIssue({
                    ruleId: 'GATE-ROUTE-001',
                    filePath: relPath,
                    line: 1,
                    severity: SEVERITY_ERROR,
                    risk: RISK_HIGH,
                    category: CATEGORY_RELIABILITY,
                    message: `Hook router '${hook.name}' declares #!/bin/sh shebang but contains non-portable Bash syntax.`,
                    remediation:
                        'Change shebang to #!/usr/bin/env bash or remove bashisms to prevent' +
                        'execution failures on Debian/Ubuntu dash.',
                    rationale:
                        'On many Linux distributions /bin/sh points to dash, which fails immediately' +
                        'on bash-specific syntax constructs.',
                }),
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
            createGateIssue({
                ruleId: 'GATE-MSG-001',
                filePath: context.hooks.hookDir || '.githooks',
                line: 1,
                severity: SEVERITY_WARNING,
                risk: RISK_MEDIUM,
                category: CATEGORY_STANDARDIZATION,
                message:
                    'Gate system lacks a commit-msg hook; commit messages are not verified for' +
                    'Conventional Commits or structural contracts.',
                remediation:
                    'Introduce a commit-msg gate script to enforce standard conventional commits' +
                    'prefix and structured sections.',
                rationale:
                    'Unvalidated commit messages lead to unsearchable Git history, breaking automated' +
                    'changelog and semantic release tooling.',
                extraDetail: {
                    action: 'add_commit_msg_gate',
                    safeToAutomate: true,
                },
            }),
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
            createGateIssue({
                ruleId: 'GATE-MSG-001',
                filePath: relPath,
                line: 1,
                severity: SEVERITY_WARNING,
                risk: RISK_MEDIUM,
                category: CATEGORY_STANDARDIZATION,
                message:
                    'Existing commit-msg gate does not enforce Conventional Commits (<type>(<scope>): <summary>) format.',
                remediation:
                    'Enforce Conventional Commits regex validation in commit-msg gate script.',
                rationale:
                    'Standardized commit message prefixes are required for automated auditing and semantic versioning.',
            }),
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
                createGateIssue({
                    ruleId: 'GATE-MSG-003',
                    filePath: relPath,
                    line: 1,
                    severity: SEVERITY_ERROR,
                    risk: RISK_HIGH,
                    category: CATEGORY_STANDARDIZATION,
                    message:
                        'Monorepo commit-msg gate lacks [Project / 项目归属] format section and' +
                        'subproject whitelist validation.',
                    remediation:
                        'Implement [Project] format section validation in commit-msg gate to' +
                        'demarcate subproject attribution.',
                    rationale:
                        'In multi-project repositories, unattributed commits blur architecture' +
                        'boundaries and cause cross-project contamination.',
                    extraDetail: {
                        action: 'add_project_scope_gate',
                        targetFile: relPath,
                        detectedSubprojects: context.topology.subprojects.map((s) => s.name),
                        safeToAutomate: true,
                    },
                }),
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
            createGateIssue({
                ruleId: 'GATE-HYG-001',
                filePath: relPath,
                line: 1,
                severity: SEVERITY_ERROR,
                risk: RISK_HIGH,
                category: CATEGORY_HYGIENE,
                message:
                    'Pre-commit gate does not enforce physical hygiene: lacks zero-byte (0-byte) empty file detection.',
                remediation:
                    'Add zero-byte empty file detection to pre-commit gate to block accidental empty file commits.',
                rationale:
                    'Zero-byte empty files pollute the codebase, break module resolution, and bypass AST static analysis.',
                extraDetail: {
                    action: 'add_hygiene_check',
                    targetHook: 'pre-commit',
                    safeToAutomate: true,
                },
            }),
        );
        return;
    }

    // Extended hygiene: Check whether gate enforces clutter file and root anti-pollution defense
    const hasClutterGuard =
        /(?:validate-physical-hygiene|physical-hygiene|clutter|\.actual\.json|\.tmp|\.bak|desktop\.ini|thumbs\.db|\.ds_store|root-script)/i.test(content);

    if (!hasClutterGuard) {
        issues.push(
            createGateIssue({
                ruleId: 'GATE-HYG-001',
                filePath: relPath,
                line: 1,
                severity: SEVERITY_WARNING,
                risk: RISK_HIGH,
                category: CATEGORY_HYGIENE,
                message:
                    'Pre-commit gate does not enforce extended physical hygiene: lacks transient clutter (.log/.tmp/.bak) and root script pollution guards.',
                remediation:
                    'Integrate physical hygiene verification into pre-commit gate to intercept transient clutter and root directory script pollution.',
                rationale:
                    'Transient log dumps, OS metadata, and scattered root scripts pollute repository history and break execution boundary isolation.',
                extraDetail: {
                    action: 'add_extended_hygiene_check',
                    targetHook: 'pre-commit',
                    safeToAutomate: true,
                },
            }),
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
            createGateIssue({
                ruleId: 'GATE-BUDGET-001',
                filePath: relPath,
                line: 1,
                severity: SEVERITY_WARNING,
                risk: RISK_MEDIUM,
                category: CATEGORY_PERFORMANCE,
                message:
                    'Pre-commit gate runs unconstrained whole-repo test suites without staged-file' +
                    'filtering, risking budget overrun.',
                remediation:
                    'Tier gate performance: restrict pre-commit to fast staged-slice checks (< 2s)' +
                    'and defer full regressions to pre-push.',
                rationale:
                    'Slow pre-commit gates disrupt developer flow and encourage bypassing gates via' +
                    'git commit --no-verify.',
            }),
        );
    }
}

const SHELL_SCRIPT_EXT = '.sh';
const POWERSHELL_SCRIPT_EXT = '.ps1';

/**
 * Evaluates strict error mode for shell scripts.
 */
function auditShellStrictMode(
    script: { filePath: string; content: string },
    relPath: string,
    issues: Issue[],
): void {
    const scriptExt = path.extname(script.filePath);
    const isShell =
        scriptExt === SHELL_SCRIPT_EXT || (scriptExt === '' && script.content.startsWith('#!'));
    if (!isShell) return;

    // Shell script: must declare set -e or set -euo pipefail
    if (!/set\s+-[a-z]*e/m.test(script.content)) {
        issues.push(
            createGateIssue({
                ruleId: 'GATE-ERR-001',
                filePath: relPath,
                line: 1,
                severity: SEVERITY_ERROR,
                risk: RISK_HIGH,
                category: CATEGORY_RELIABILITY,
                message:
                    `Gate script '${path.basename(relPath)}' lacks strict error mode ('set` +
                    `-euo pipefail' or 'set -e').`,
                remediation:
                    'Add set -euo pipefail near script start to prevent silent failures and' +
                    'false-positive gate passes.',
                rationale:
                    'Without set -e, command failures inside gate scripts are ignored,' +
                    'leading to catastrophic false-pass gate releases.',
                extraDetail: {
                    action: 'add_strict_mode',
                    targetFile: relPath,
                    safeToAutomate: true,
                },
            }),
        );
    }
}

/**
 * Evaluates strict error preference for PowerShell scripts.
 */
function auditPowerShellStrictMode(
    script: { filePath: string; content: string },
    relPath: string,
    issues: Issue[],
): void {
    const scriptExt = path.extname(script.filePath);
    if (scriptExt !== POWERSHELL_SCRIPT_EXT) return;

    // PowerShell: must declare $ErrorActionPreference = 'Stop'
    if (!/\$ErrorActionPreference\s*=\s*['"]?Stop['"]?/i.test(script.content)) {
        issues.push(
            createGateIssue({
                ruleId: 'GATE-ERR-001',
                filePath: relPath,
                line: 1,
                severity: SEVERITY_ERROR,
                risk: RISK_HIGH,
                category: CATEGORY_RELIABILITY,
                message:
                    `Gate script '${path.basename(relPath)}' lacks strict error preference` +
                    `('$ErrorActionPreference = "Stop"').`,
                remediation:
                    "Declare $ErrorActionPreference = 'Stop' at the top of PowerShell gate script.",
                rationale:
                    'PowerShell by default continues execution after non-terminating errors,' +
                    'resulting in false-positive gate passes.',
                extraDetail: {
                    action: 'add_strict_error_preference',
                    targetFile: relPath,
                    safeToAutomate: true,
                },
            }),
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
        const relPath = path.relative(context.root, script.filePath).replace(/\\/g, '/');
        auditShellStrictMode(script, relPath, issues);
        auditPowerShellStrictMode(script, relPath, issues);
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
                createGateIssue({
                    ruleId: 'GATE-SSOT-001',
                    filePath: 'scripts',
                    line: 1,
                    severity: SEVERITY_WARNING,
                    risk: RISK_MEDIUM,
                    category: CATEGORY_ARCHITECTURE,
                    message:
                        'Gate system references rule catalog verification but single-source catalog' +
                        'file is missing or unregistered.',
                    remediation:
                        'Maintain a single source of truth catalog (e.g.' +
                        'scripts/common/rule-catalog.json) and verify gate rules against it.',
                    rationale:
                        'Hardcoding rule IDs across multiple gate scripts leads to rule drift,' +
                        'phantom rules, and gate inconsistency.',
                }),
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
            createGateIssue({
                ruleId: 'GATE-MSG-002',
                filePath: relHookPath,
                line: 1,
                severity: SEVERITY_WARNING,
                risk: RISK_MEDIUM,
                category: CATEGORY_STANDARDIZATION,
                message:
                    'Commit-msg gate does not enforce bidirectional bilingual style terms constraints' +
                    '(commit-msg-forbidden-terms.json unwired).',
                remediation:
                    'Wire validate-commit-msg-style.js or commit-msg-forbidden-terms.json into' +
                    'commit-msg-gate to intercept temporary and non-factual language.',
                rationale:
                    'Unchecked commit style leads to casual jargon, hyperbolic exaggerations, and' +
                    'circumvented quality constraints.',
            }),
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
                createGateIssue({
                    ruleId: 'GATE-MSG-002',
                    filePath: 'scripts/common/commit-msg-forbidden-terms.json',
                    line: 1,
                    severity: SEVERITY_WARNING,
                    risk: RISK_MEDIUM,
                    category: CATEGORY_STANDARDIZATION,
                    message:
                        'Forbidden terms dictionary lacks bidirectional bilingual coverage (must' +
                        'contain both English and Chinese constraints).',
                    remediation:
                        'Include both asciiPatterns (English) and patterns (Chinese) in forbidden' +
                        'terms dictionary to prevent language bypass.',
                    rationale:
                        'Agents or contributors can bypass single-language filters by substituting' +
                        'equivalent foreign terms.',
                }),
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
            createGateIssue({
                ruleId: 'GATE-AST-001',
                filePath: relPath,
                line: 1,
                severity: SEVERITY_ERROR,
                risk: RISK_HIGH,
                category: CATEGORY_MAINTAINABILITY,
                message:
                    'Pre-commit gate lacks AST staged slice complexity and nesting budget check (CC <= 15, Depth <= 4).',
                remediation:
                    'Integrate validate-staged-slice.js into pre-commit gate to reject over-complex' +
                    'staged functions prior to commit.',
                rationale:
                    'Allowing complex methods to be committed defers technical debt detection to' +
                    'late-stage full regression reviews.',
            }),
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
            createGateIssue({
                ruleId: 'GATE-FAC-001',
                filePath: context.hooks.prePush
                    ? path
                          .relative(context.root, context.hooks.prePush.filePath)
                          .replace(/\\/g, '/')
                    : 'scripts',
                line: 1,
                severity: SEVERITY_ERROR,
                risk: RISK_HIGH,
                category: CATEGORY_ARCHITECTURE,
                message:
                    'Gate pipeline lacks static validation for facade substantive bearing (ELOC >=' +
                    '15) and vacuous forwarding elimination.',
                remediation:
                    'Incorporate facade discipline verification into pre-push or self-audit gates to' +
                    'eliminate pass-through shims.',
                rationale:
                    'Vacuous forwarding shims add unnecessary indirection layers without domain' +
                    'logic, increasing maintenance overhead.',
            }),
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
                    createGateIssue({
                        ruleId: 'GATE-PROC-001',
                        filePath: relPath,
                        line: 1,
                        severity: SEVERITY_ERROR,
                        risk: RISK_MEDIUM,
                        category: CATEGORY_RELIABILITY,
                        message:
                            `PowerShell gate script '${path.basename(relPath)}' uses interactive` +
                            `prompts without output redirection guard.`,
                        remediation:
                            'Wrap interactive prompt blocks with: if ([Environment]::UserInteractive' +
                            '-and -not [Console]::IsOutputRedirected).',
                        rationale:
                            'Interactive prompts in headless CI or Agent child processes cause silent' +
                            'hangs and pipeline timeouts.',
                    }),
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
                createGateIssue({
                    ruleId: 'GATE-PAIR-001',
                    filePath: `scripts/sh/${base}.sh`,
                    line: 1,
                    severity: SEVERITY_WARNING,
                    risk: RISK_MEDIUM,
                    category: CATEGORY_RELIABILITY,
                    message: `Shell gate script 'scripts/sh/${base}.sh' lacks matching 'scripts/ps1/${base}.ps1'.`,
                    remediation: `Provide isomorphic 'scripts/ps1/${base}.ps1' script for cross-platform parity.`,
                    rationale:
                        'Asymmetric gate scripts cause validation discrepancies across developer platforms.',
                }),
            );
        }
    }

    for (const base of ps1Bases) {
        if (!shBases.has(base)) {
            issues.push(
                createGateIssue({
                    ruleId: 'GATE-PAIR-001',
                    filePath: `scripts/ps1/${base}.ps1`,
                    line: 1,
                    severity: SEVERITY_WARNING,
                    risk: RISK_MEDIUM,
                    category: CATEGORY_RELIABILITY,
                    message: `PowerShell gate script 'scripts/ps1/${base}.ps1' lacks matching 'scripts/sh/${base}.sh'.`,
                    remediation: `Provide isomorphic 'scripts/sh/${base}.sh' script for cross-platform parity.`,
                    rationale:
                        'Asymmetric gate scripts cause validation discrepancies across developer platforms.',
                }),
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
            totalRulesAudited: TOTAL_RULES_AUDITED,
            violationsCount: issues.length,
            hasLocalGates,
            hasCiPipelines,
            isIsomorphic,
        },
    };
}
