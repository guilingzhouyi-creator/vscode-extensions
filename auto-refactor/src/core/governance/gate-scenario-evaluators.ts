/**
 * Module: Core Governance — Repository Gate Scenario B Evaluators
 * File Path: src/core/governance/gate-scenario-evaluators.ts
 * Architecture Role: Evaluates multi-dimensional gate health criteria (Scenario B) for existing
 *   gate defense systems across isomorphism, routing safety, commit-msg, physical hygiene,
 *   budget tiering, error discipline, SSOT, AST slice, facade discipline, interactive safety,
 *   and dual-platform pairing.
 * Dependencies & Triggers: Consumes RepoArchetypeContext and Issue types; invoked by
 *   auditGateArchitecture() in gate-governance.ts.
 * Responsibilities:
 *   1. Evaluate dual-tier isomorphism between local hooks and remote CI (GUARD-ISO-001);
 *   2. Evaluate runtime degradation and safety in hook routers (GUARD-ROUTE-001);
 *   3. Enforce Conventional Commits and monorepo project scope (GUARD-MSG-001, GUARD-MSG-003);
 *   4. Enforce physical hygiene (0-byte empty files and clutter anti-pollution) (GUARD-HYG-001);
 *   5. Guard gate performance tiering and budget overruns (GUARD-BUDGET-001);
 *   6. Enforce strict error handling flags across Bash and PowerShell (GUARD-ERR-001);
 *   7. Validate rule SSOT catalog synchronization (GUARD-SSOT-001);
 *   8. Enforce commit message style constraints and bilingual terms (GUARD-MSG-002);
 *   9. Enforce AST staged slice complexity and nesting budget (GUARD-AST-001);
 *   10. Enforce facade substantive bearing and vacuous forwarding elimination (GUARD-FAC-001);
 *   11. Guard against non-interactive process hangs in PowerShell (GUARD-PROC-001);
 *   12. Enforce dual-platform gate script isomorphic pairing (GUARD-PAIR-001).
 * Exit Semantics & Design Rationale: Deterministic pure evaluation returning Issue records;
 *   never throws; attaches structured AgentActionablePayload to actionable findings.
 */

import * as path from 'path';
import type { Issue, Severity, AgentActionablePayload } from '../types';
import { SEVERITY_ERROR, SEVERITY_WARNING } from '../types';
import type { RepoArchetypeContext } from './repo-archetype';
import { createLineIssue } from '../rules/diagnostic-catalog';

/** Canonical analyzer name for gate architecture evaluation. */
export const ANALYZER_GATE_ARCHITECTURE = 'gate-architecture';

const RISK_HIGH = 'high';
const RISK_MEDIUM = 'medium';

const CATEGORY_ARCHITECTURE = 'architecture';
const CATEGORY_RELIABILITY = 'reliability';
const CATEGORY_STANDARDIZATION = 'standardization';
const CATEGORY_HYGIENE = 'hygiene';
const CATEGORY_PERFORMANCE = 'performance';
const CATEGORY_MAINTAINABILITY = 'maintainability';

const SHELL_SCRIPT_EXT = '.sh';
const POWERSHELL_SCRIPT_EXT = '.ps1';

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

/**
 * Construct an Issue object for gate governance violations.
 *
 * @param params - Structured gate issue parameters.
 * @returns Standardized Issue object.
 */
export function createGateIssue(params: GateIssueParams): Issue {
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
    const issue = createLineIssue(ANALYZER_GATE_ARCHITECTURE, normalizedFile, {
        lineIdx: Math.max(0, line - 1),
        rule: ruleId,
        severity,
        message,
        detail: {
            category,
            risk,
            remediation,
            rationale,
            ...(extraDetail || {}),
        },
        suggestion: remediation,
    });
    if (actionable) {
        issue.actionable = actionable;
    }
    return issue;
}

/**
 * Dimension 1: GUARD-ISO-001: Dual-Tier Isomorphism.
 *
 * @param context - Repository archetype analysis context.
 * @param issues - Target array for appending findings.
 */
export function auditIsomorphism(context: RepoArchetypeContext, issues: Issue[]): void {
    if (context.ci.workflowFiles.length === 0 || context.hooks.allHookFiles.length === 0) {
        return;
    }

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
                    ruleId: 'GUARD-ISO-001',
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
 * Dimension 2: GUARD-ROUTE-001: Hook Runtime Degradation & Safety.
 *
 * @param context - Repository archetype analysis context.
 * @param issues - Target array for appending findings.
 */
export function auditRoutingSafety(context: RepoArchetypeContext, issues: Issue[]): void {
    const hookFiles = [
        context.hooks.preCommit,
        context.hooks.commitMsg,
        context.hooks.prePush,
    ].filter((hookFile): hookFile is NonNullable<typeof hookFile> => Boolean(hookFile));

    for (const hook of hookFiles) {
        const content = hook.content;
        const relPath = path.relative(context.root, hook.filePath).replace(/\\/g, '/');

        if (/\bpowershell(?:\.exe)?\b/i.test(content) && !/\bpwsh\b/i.test(content)) {
            issues.push(
                createGateIssue({
                    ruleId: 'GUARD-ROUTE-001',
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

        if (/^#!\/bin\/sh\b/m.test(content) && /(?:\[\[|\(\(|\bfunction\b)/.test(content)) {
            issues.push(
                createGateIssue({
                    ruleId: 'GUARD-ROUTE-001',
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
 * Dimension 3: GUARD-MSG-001 & GUARD-MSG-003: Commit Message Engineering Integrity.
 *
 * @param context - Repository archetype analysis context.
 * @param issues - Target array for appending findings.
 */
export function auditCommitMsgGate(context: RepoArchetypeContext, issues: Issue[]): void {
    if (context.hooks.allHookFiles.length === 0) return;

    if (!context.hooks.commitMsg) {
        issues.push(
            createGateIssue({
                ruleId: 'GUARD-MSG-001',
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

    const hasConventionalCheck =
        /(?:feat|fix|refactor|chore|test|docs|style|perf)/i.test(content) ||
        Object.values(context.gateScripts.contents).some((scriptContent) =>
            /commit-msg|conventional/i.test(scriptContent),
        );

    if (!hasConventionalCheck) {
        issues.push(
            createGateIssue({
                ruleId: 'GUARD-MSG-001',
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

    if (context.topology.isMonorepo) {
        const combinedCommitScripts = [
            content,
            ...Object.entries(context.gateScripts.contents)
                .filter(([k]) => /commit-msg/i.test(k))
                .map(([, scriptContent]) => scriptContent),
        ].join('\n');

        const hasProjectScopeCheck =
            /(?:\[Project|\[\s*Project\s*\/?\s*项目归属|IN_PROJECT_SECTION|FOUND_PROJECT_HEADER|VALID_PROJECTS)/i.test(
                combinedCommitScripts,
            );

        if (!hasProjectScopeCheck) {
            issues.push(
                createGateIssue({
                    ruleId: 'GUARD-MSG-003',
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
                        detectedSubprojects: context.topology.subprojects.map(
                            (subproject) => subproject.name,
                        ),
                        safeToAutomate: true,
                    },
                }),
            );
        }
    }
}

/**
 * Dimension 4: GUARD-HYG-001: Physical Hygiene Guard.
 *
 * @param context - Repository archetype analysis context.
 * @param issues - Target array for appending findings.
 */
export function auditHygieneGuard(context: RepoArchetypeContext, issues: Issue[]): void {
    if (context.hooks.allHookFiles.length === 0) return;

    const preCommit = context.hooks.preCommit;
    if (!preCommit) return;

    const content = [preCommit.content, ...Object.values(context.gateScripts.contents)].join('\n');
    const relPath = path.relative(context.root, preCommit.filePath).replace(/\\/g, '/');

    const hasZeroByteCheck =
        /(?:!\s*-s|-empty|Length\s*-eq\s*0|stat\s*-c\s*%s|\.size\s*===?\s*0|0-byte)/i.test(content);

    if (!hasZeroByteCheck) {
        issues.push(
            createGateIssue({
                ruleId: 'GUARD-HYG-001',
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

    const hasClutterGuard =
        /(?:validate-physical-hygiene|physical-hygiene|clutter|\.actual\.json|\.tmp|\.bak|desktop\.ini|thumbs\.db|\.ds_store|root-script)/i.test(
            content,
        );

    if (!hasClutterGuard) {
        issues.push(
            createGateIssue({
                ruleId: 'GUARD-HYG-001',
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
 * Dimension 5: GUARD-BUDGET-001: Performance Tiering & Budget.
 *
 * @param context - Repository archetype analysis context.
 * @param issues - Target array for appending findings.
 */
export function auditBudgetTiering(context: RepoArchetypeContext, issues: Issue[]): void {
    const preCommit = context.hooks.preCommit;
    if (!preCommit) return;

    const content = preCommit.content.toLowerCase();
    const relPath = path.relative(context.root, preCommit.filePath).replace(/\\/g, '/');

    const hasStagedFiltering =
        /(?:git\s+diff|--cached|--staged|staged)/i.test(content) ||
        Object.values(context.gateScripts.contents).some((scriptContent) =>
            /diff\s+--cached|--staged/i.test(scriptContent),
        );

    const runsHeavyweightUnstaged =
        /(?:cargo\s+test\s*--workspace|npm\s+test(?!\s*--\s*--staged)|pytest\s+tests\/|go\s+test\s+\.\/\.\.\.)/i.test(
            content,
        );

    if (!hasStagedFiltering && runsHeavyweightUnstaged) {
        issues.push(
            createGateIssue({
                ruleId: 'GUARD-BUDGET-001',
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

function auditShellStrictMode(
    script: { filePath: string; content: string },
    relPath: string,
    issues: Issue[],
): void {
    const scriptExt = path.extname(script.filePath);
    const isShell =
        scriptExt === SHELL_SCRIPT_EXT || (scriptExt === '' && script.content.startsWith('#!'));
    if (!isShell) return;

    if (!/set\s+-[a-z]*e/m.test(script.content)) {
        issues.push(
            createGateIssue({
                ruleId: 'GUARD-ERR-001',
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

function auditPowerShellStrictMode(
    script: { filePath: string; content: string },
    relPath: string,
    issues: Issue[],
): void {
    const scriptExt = path.extname(script.filePath);
    if (scriptExt !== POWERSHELL_SCRIPT_EXT) return;

    if (!/\$ErrorActionPreference\s*=\s*['"]?Stop['"]?/i.test(script.content)) {
        issues.push(
            createGateIssue({
                ruleId: 'GUARD-ERR-001',
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
 * Dimension 6: GUARD-ERR-001: Strict Error Discipline in Gate Scripts.
 *
 * @param context - Repository archetype analysis context.
 * @param issues - Target array for appending findings.
 */
export function auditStrictErrorDiscipline(context: RepoArchetypeContext, issues: Issue[]): void {
    const scriptsToCheck: Array<{ filePath: string; content: string }> = [
        ...(context.hooks.preCommit ? [context.hooks.preCommit] : []),
        ...(context.hooks.commitMsg ? [context.hooks.commitMsg] : []),
        ...(context.hooks.prePush ? [context.hooks.prePush] : []),
        ...Object.entries(context.gateScripts.contents).map(([rel, scriptContent]) => ({
            filePath: path.join(context.root, rel),
            content: scriptContent,
        })),
    ];

    for (const script of scriptsToCheck) {
        const relPath = path.relative(context.root, script.filePath).replace(/\\/g, '/');
        auditShellStrictMode(script, relPath, issues);
        auditPowerShellStrictMode(script, relPath, issues);
    }
}

/**
 * Dimension 7: GUARD-SSOT-001: Rule SSOT Catalog Synchronization.
 *
 * @param context - Repository archetype analysis context.
 * @param issues - Target array for appending findings.
 */
export function auditSsotSync(context: RepoArchetypeContext, issues: Issue[]): void {
    const gateScriptsContent = Object.values(context.gateScripts.contents).join('\n');
    const mentionsRuleCatalog = /rule-catalog\.json|review-rules\.json|rules-registry/i.test(
        gateScriptsContent,
    );

    if (mentionsRuleCatalog) {
        const catalogExists =
            Object.keys(context.gateScripts.contents).some((filePath) =>
                /rule-catalog\.json|review-rules\.json/i.test(filePath),
            ) || context.gateScripts.files.some((filePath) => /catalog|registry/i.test(filePath));

        if (!catalogExists) {
            issues.push(
                createGateIssue({
                    ruleId: 'GUARD-SSOT-001',
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
 * Dimension 8: GUARD-MSG-002: Commit Message Style Constraints & Bilingual Terms Guard.
 *
 * @param context - Repository archetype analysis context.
 * @param issues - Target array for appending findings.
 */
export function auditCommitMsgStyle(context: RepoArchetypeContext, issues: Issue[]): void {
    if (context.hooks.allHookFiles.length === 0) return;

    const gateScriptsContent = Object.values(context.gateScripts.contents).join('\n');
    const commitMsgHookContent = context.hooks.commitMsg?.content || '';
    const combined = `${gateScriptsContent}\n${commitMsgHookContent}`;

    const wiresStyleCheck = /commit-msg-forbidden-terms\.json|validate-commit-msg-style/i.test(
        combined,
    );

    const relHookPath = context.hooks.commitMsg
        ? path.relative(context.root, context.hooks.commitMsg.filePath).replace(/\\/g, '/')
        : 'scripts/ps1/commit-msg-gate.ps1';

    if (!wiresStyleCheck) {
        issues.push(
            createGateIssue({
                ruleId: 'GUARD-MSG-002',
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

    const termsContent = Object.entries(context.gateScripts.contents).find(([filePath]) =>
        /commit-msg-forbidden-terms\.json/i.test(filePath),
    )?.[1];

    if (termsContent) {
        const hasEnglish = /asciiPatterns|temporary|hyperbolic|meta_narrative/i.test(termsContent);
        const hasChinese = /[\u4e00-\u9fa5]/.test(termsContent);

        if (!hasEnglish || !hasChinese) {
            issues.push(
                createGateIssue({
                    ruleId: 'GUARD-MSG-002',
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
 * Dimension 9: GUARD-AST-001: AST Staged Slice Complexity & Nesting Guard.
 *
 * @param context - Repository archetype analysis context.
 * @param issues - Target array for appending findings.
 */
export function auditAstSliceGuard(context: RepoArchetypeContext, issues: Issue[]): void {
    if (context.hooks.allHookFiles.length === 0) return;

    const preCommitContent = [
        context.hooks.preCommit?.content || '',
        ...Object.entries(context.gateScripts.contents)
            .filter(([k]) => /pre-commit/i.test(k))
            .map(([, scriptContent]) => scriptContent),
    ].join('\n');

    const relPath = context.hooks.preCommit
        ? path.relative(context.root, context.hooks.preCommit.filePath).replace(/\\/g, '/')
        : 'scripts/ps1/pre-commit-gate.ps1';

    const hasAstSliceCheck =
        /validate-staged-slice|ast[-_]slice|complexity.*depth|CC\s*<=\s*15/i.test(preCommitContent);

    if (!hasAstSliceCheck) {
        issues.push(
            createGateIssue({
                ruleId: 'GUARD-AST-001',
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
 * Dimension 10: GUARD-FAC-001: Facade Substantive Bearing & Vacuous Forwarding Elimination.
 *
 * @param context - Repository archetype analysis context.
 * @param issues - Target array for appending findings.
 */
export function auditFacadeDisciplineGuard(context: RepoArchetypeContext, issues: Issue[]): void {
    const combinedScripts = [
        ...Object.values(context.gateScripts.contents),
        context.hooks.preCommit?.content || '',
        context.hooks.prePush?.content || '',
    ].join('\n');

    const hasFacadeCheck =
        /validate-facade|facade-discipline|ARCH-FAC-001|ARCH-ABS-001|facade-governance/i.test(
            combinedScripts,
        );

    if (!hasFacadeCheck) {
        issues.push(
            createGateIssue({
                ruleId: 'GUARD-FAC-001',
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
 * Dimension 11: GUARD-PROC-001: PowerShell Terminal Non-Interactive & Output Redirection Guard.
 *
 * @param context - Repository archetype analysis context.
 * @param issues - Target array for appending findings.
 */
export function auditProcessInteractiveSafety(
    context: RepoArchetypeContext,
    issues: Issue[],
): void {
    const ps1Scripts = Object.entries(context.gateScripts.contents).filter(([filePath]) =>
        filePath.endsWith('.ps1'),
    );

    for (const [relPath, content] of ps1Scripts) {
        if (/\b(?:Read-Host|pause|choice\.exe)\b/i.test(content)) {
            const hasRedirectGuard = /IsOutputRedirected|UserInteractive/i.test(content);

            if (!hasRedirectGuard) {
                issues.push(
                    createGateIssue({
                        ruleId: 'GUARD-PROC-001',
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
 * Dimension 12: GUARD-PAIR-001: Dual-Platform Gate Script Isomorphic Pairing Guard.
 *
 * @param context - Repository archetype analysis context.
 * @param issues - Target array for appending findings.
 */
export function auditDualPlatformPairing(context: RepoArchetypeContext, issues: Issue[]): void {
    const isCoreGateScript = (filePath: string) =>
        /(?:pre-commit|commit-msg|pre-push|audit-all)[-_]gate|audit-all/i.test(filePath);

    const shScripts = context.gateScripts.files.filter(
        (filePath) =>
            filePath.startsWith('scripts/sh/') &&
            filePath.endsWith('.sh') &&
            isCoreGateScript(filePath),
    );
    const ps1Scripts = context.gateScripts.files.filter(
        (filePath) =>
            filePath.startsWith('scripts/ps1/') &&
            filePath.endsWith('.ps1') &&
            isCoreGateScript(filePath),
    );

    if (shScripts.length === 0 && ps1Scripts.length === 0) return;

    const shBases = new Set(shScripts.map((filePath) => path.basename(filePath, '.sh')));
    const ps1Bases = new Set(ps1Scripts.map((filePath) => path.basename(filePath, '.ps1')));

    for (const base of shBases) {
        if (!ps1Bases.has(base)) {
            issues.push(
                createGateIssue({
                    ruleId: 'GUARD-PAIR-001',
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
                    ruleId: 'GUARD-PAIR-001',
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
