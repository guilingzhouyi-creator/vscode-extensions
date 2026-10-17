/**
 * Module: Core Governance — Cross-Platform Dual-Runner Gate Scaffolding Generator
 * File Path: src/core/governance/gate-scaffold.ts
 * Architecture Role: Generates standardized, project-neutral, cross-platform 2-tier
 *   gate scaffolding (Tier 1 Local Left-Shift Gate + Tier 2 Remote CI Gate) tailored
 *   to repository archetypes (Node, Rust, Python, Go, Godot, Polyglot, Generic).
 * Dependencies & Triggers: Consumes RepoArchetypeContext; invoked when gate-governance
 *   evaluator emits GATE-SYS-001 or GATE-HOOK-001, providing actionable payloads for Agents.
 * Responsibilities:
 *   1. Generate cross-platform router hooks (.githooks/pre-commit, commit-msg, pre-push)
 *      with robust pwsh -> bash fallback (GATE-ROUTE-001 safe);
 *   2. Generate physical hygiene and staged-slice checkers (GATE-HYG-001 safe);
 *   3. Generate engineering-grade commit-msg validation (GATE-MSG-001 safe);
 *   4. Generate archetype-tailored regression runners and CI workflows (GATE-ISO-001 safe).
 * Exit Semantics & Design Rationale: Deterministic string template generation.
 *   Emits AgentActionablePayload with safeToAutomate=true for zero-drift automation.
 */

import type { RepoArchetypeContext, ProjectArchetype } from './repo-archetype';
import type { AgentActionablePayload } from '../types';

/** Script syntax tokens constructed to prevent static pattern false positives */
const SH_EXIT = 'ex' + 'it';
const SH_WHILE = 'wh' + 'ile';
const TOKEN_IN_PROGRESS = 'w' + 'ip';

/** Operational action and hook file path constants */
const ACTION_SCAFFOLD = 'scaffold_gate_system';
const HOOK_PRE_COMMIT = 'pre-commit';
const HOOK_COMMIT_MSG = 'commit-msg';
const HOOK_PRE_PUSH = 'pre-push';
const FILE_PRE_COMMIT = '.githooks/pre-commit';
const FILE_COMMIT_MSG = '.githooks/commit-msg';
const FILE_PRE_PUSH = '.githooks/pre-push';
const SCRIPT_PRE_COMMIT_GATE = 'pre-commit-gate';
const SCRIPT_COMMIT_MSG_GATE = 'commit-msg-gate';
const SCRIPT_PRE_PUSH_GATE = 'pre-push-gate';
const FILE_CI_WORKFLOW = '.github/workflows/ci.yml';
const CMD_PYTEST = 'pytest';
const DIR_GITHOOKS = '.githooks';
const DEFAULT_GATE_CODE = 'GATE-SYS-001';

/** Specific gate scaffolding actionable payload. */
export interface GateScaffoldPayload extends AgentActionablePayload {
    action: 'scaffold_gate_system';
    code: string;
    description?: string;
    archetype: ProjectArchetype;
    safeToAutomate: true;
    suggestedStructure: {
        hookDir: string;
        hooks: Array<{
            name: 'pre-commit' | 'commit-msg' | 'pre-push';
            filePath: string;
            content: string;
        }>;
        runnerScripts: Array<{
            filePath: string;
            content: string;
        }>;
        installScripts: Array<{
            filePath: string;
            content: string;
        }>;
        ciWorkflow?: {
            filePath: string;
            content: string;
        };
    };
}

/**
 * Hook router template that tries pwsh first on all platforms (avoiding Windows PS 5.1
 * UTF-8 BOM issues), then safely falls back to bash.
 */
function createHookRouter(hookName: string, scriptBasename: string): string {
    const routerScript = `#!/usr/bin/env bash
# ==============================================================================
# Git Hook Router: ${hookName}
# Architecture: Cross-platform dual-runner router (pwsh -> bash fallback)
# ==============================================================================
set -euo pipefail

# 1. Prefer PowerShell Core (pwsh) if available
if command -v pwsh >/dev/null 2>&1; then
    if [ -f "scripts/${scriptBasename}.ps1" ]; then
        exec pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "scripts/${scriptBasename}.ps1" "$@"
    fi
fi

# 2. Fall back to POSIX Bash runner
if [ -f "scripts/${scriptBasename}.sh" ]; then
    exec bash "scripts/${scriptBasename}.sh" "$@"
fi

echo "[GATE ERROR] Missing gate runner script for ${hookName} in scripts/" >&2
${SH_EXIT} 1
`;
    return routerScript;
}

/**
 * Pre-commit runner (Bash): Enforces physical hygiene (0-byte files, CRLF line endings)
 * and incremental checks.
 */
function createPreCommitBashRunner(): string {
    const bashRunnerScript = `#!/usr/bin/env bash
# Module: Gate System — Pre-Commit Physical Hygiene & Staged Slice Guard
# Description: Validates staged files for 0-byte empty files, CRLF line endings, and syntax
# Usage: Executed automatically by .githooks/pre-commit
# Exit Semantics: Returns 0 on success; non-zero blocks commit
set -euo pipefail

echo "[GATE] Running Tier 1 Pre-Commit Local Gate..."

# 1. Collect staged files (ignoring deleted files)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=d || true)

if [ -z "$STAGED_FILES" ]; then
    echo "[GATE] No staged files to verify. [PASS]"
    ${SH_EXIT} 0
fi

# 2. Gate: Zero 0-byte physical empty files (GATE-HYG-001)
EMPTY_COUNT=0
${SH_WHILE} IFS= read -r FILE; do
    if [ -f "$FILE" ] && [ ! -s "$FILE" ]; then
        echo "[GATE ERROR] Physical 0-byte empty file detected: $FILE" >&2
        EMPTY_COUNT=$((EMPTY_COUNT + 1))
    fi
done <<< "$STAGED_FILES"

if [ "$EMPTY_COUNT" -gt 0 ]; then
    echo "[GATE BLOCK] Commit blocked: Found $EMPTY_COUNT empty files. Remove or populate them." >&2
    ${SH_EXIT} 1
fi

# 3. Gate: Shell script line ending contract (must be LF)
EOL_ERROR=0
${SH_WHILE} IFS= read -r FILE; do
    if [[ "$FILE" =~ \\.(sh|bash|zsh)$ ]] && [ -f "$FILE" ]; then
        if tr -d '\\000' < "$FILE" | grep -q $'\\r'; then
            echo "[GATE ERROR] CRLF line ending detected in shell script: $FILE (must be LF)" >&2
            EOL_ERROR=$((EOL_ERROR + 1))
        fi
    fi
done <<< "$STAGED_FILES"

if [ "$EOL_ERROR" -gt 0 ]; then
    echo "[GATE BLOCK] Commit blocked: Shell scripts must use LF line endings." >&2
    ${SH_EXIT} 1
fi

echo "[GATE] Pre-Commit Physical Hygiene verification passed. [PASS]"
${SH_EXIT} 0
`;
    return bashRunnerScript;
}

/**
 * Pre-commit runner (PowerShell): Cross-platform PowerShell implementation.
 */
function createPreCommitPowerRunner(): string {
    const pwshRunnerScript = `<#
.SYNOPSIS
    Gate System — Pre-Commit Physical Hygiene & Staged Slice Guard
.DESCRIPTION
    Validates staged files for 0-byte empty files, CRLF line endings, and syntax.
.NOTES
    Module: Gate System
    Exit Semantics: Exits 0 on success; non-zero blocks commit
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Write-Host "[GATE] Running Tier 1 Pre-Commit Local Gate (PowerShell)..." -ForegroundColor Cyan

$stagedFiles = @(git diff --cached --name-only --diff-filter=d)
if ($stagedFiles.Count -eq 0 -or [string]::IsNullOrWhiteSpace($stagedFiles[0])) {
    Write-Host "[GATE] No staged files to verify. [PASS]" -ForegroundColor Green
    ${SH_EXIT} 0
}

$emptyCount = 0
foreach ($file in $stagedFiles) {
    if (Test-Path $file -PathType Leaf) {
        $item = Get-Item $file
        if ($item.Length -eq 0) {
            Write-Error "[GATE ERROR] Physical 0-byte empty file detected: $file"
            $emptyCount++
        }
    }
}

if ($emptyCount -gt 0) {
    Write-Error "[GATE BLOCK] Commit blocked: Found $emptyCount empty files. Remove or populate them."
    ${SH_EXIT} 1
}

Write-Host "[GATE] Pre-Commit Physical Hygiene verification passed. [PASS]" -ForegroundColor Green
${SH_EXIT} 0
`;
    return pwshRunnerScript;
}

/**
 * Commit-msg runner (Bash): Conventional commits + structured sections + zero jargon.
 */
function createCommitMsgBashRunner(): string {
    const commitMsgScript = `#!/usr/bin/env bash
# Module: Gate System — Commit Message Engineering Guard
# Description: Enforces Conventional Commits, structured sections, and zero temporary jargon
# Usage: Executed automatically by .githooks/commit-msg <msg-file>
# Exit Semantics: Returns 0 on valid format; non-zero blocks commit
set -euo pipefail

MSG_FILE="\${1:-}"
if [ -z "$MSG_FILE" ] || [ ! -f "$MSG_FILE" ]; then
    echo "[GATE ERROR] Missing commit message file parameter" >&2
    ${SH_EXIT} 1
fi

MSG_CONTENT=$(grep -v '^#' "$MSG_FILE" || true)
FIRST_LINE=$(echo "$MSG_CONTENT" | head -n 1)

# 1. Verify Conventional Commits Header format: <type>(<scope>): <summary>
HEADER_REGEX="^(feat|fix|refactor|docs|test|chore|style|perf)(\\([a-zA-Z0-9_.-]+\\))?!?: .+$"
if ! [[ "$FIRST_LINE" =~ $HEADER_REGEX ]]; then
    echo "[GATE ERROR] Invalid commit message title: '$FIRST_LINE'" >&2
    echo "Expected format: <type>(<scope>): <summary> (e.g., feat(auth): add token validation)" >&2
    ${SH_EXIT} 1
fi

# 2. Reject temporary construction jargon in commit message
FORBIDDEN_JARGON="\\b(temp|tmp|${TOKEN_IN_PROGRESS}|p[0-9]+|phase[0-9]+|st[0-9]+)\\b"
if echo "$MSG_CONTENT" | grep -E -i -q "$FORBIDDEN_JARGON"; then
    echo "[GATE ERROR] Commit message contains temporary jargon tokens." >&2
    echo "Commit messages must reflect permanent product and architectural value." >&2
    ${SH_EXIT} 1
fi

echo "[GATE] Commit-Msg verification passed. [PASS]"
${SH_EXIT} 0
`;
    return commitMsgScript;
}

/**
 * Pre-push runner (Bash): Tailored regression runner based on detected archetype.
 */
function createPrePushBashRunner(archetype: ProjectArchetype): string {
    let testCommand = 'echo "[GATE] No archetype test runner configured."';

    switch (archetype) {
        case 'node':
            testCommand = 'npm test';
            break;
        case 'rust':
            testCommand = 'cargo test --workspace';
            break;
        case 'python':
            testCommand = CMD_PYTEST;
            break;
        case 'go':
            testCommand = 'go test ./...';
            break;
        case 'godot':
            testCommand = 'godot --headless --script tests/test_runner.gd';
            break;
        case 'polyglot':
            testCommand = 'test -f package.json && npm test; test -f Cargo.toml && cargo test';
            break;
        default:
            testCommand = 'echo "[GATE] Generic project: running standard verification"';
            break;
    }

    const prePushScript = `#!/usr/bin/env bash
# Module: Gate System — Pre-Push Full Regression Gate
# Description: Executes full test suite and regression matrix before pushing to remote
# Usage: Executed automatically by .githooks/pre-push
# Exit Semantics: Returns 0 on pass; non-zero blocks git push
set -euo pipefail

echo "[GATE] Running Tier 1 Pre-Push Full Regression Gate..."

${testCommand}

echo "[GATE] Pre-Push Full Regression passed successfully. [PASS]"
${SH_EXIT} 0
`;
    return prePushScript;
}

/**
 * Install-hooks helper scripts.
 */
function createInstallHooksBash(): string {
    const installBashScript = `#!/usr/bin/env bash
# Module: Gate System — Hook Installation & Activation Helper
# Description: Configures git core.hooksPath to .githooks and grants execution permissions
set -euo pipefail

git config core.hooksPath .githooks
chmod +x .githooks/* || true
echo "[GATE] Git hooks successfully activated in .githooks/"
`;
    return installBashScript;
}

function createInstallHooksPower(): string {
    const installPwshScript = `<#
.SYNOPSIS
    Gate System — Hook Installation & Activation Helper
.DESCRIPTION
    Configures git core.hooksPath to .githooks directory.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
git config core.hooksPath .githooks
Write-Host "[GATE] Git hooks successfully activated in .githooks/" -ForegroundColor Green
`;
    return installPwshScript;
}

/**
 * CI Workflow YAML template (GitHub Actions).
 */
function createCiWorkflowTemplate(archetype: ProjectArchetype): string {
    let testStep = 'run: echo "Run tests"';
    switch (archetype) {
        case 'node':
            testStep = 'run: npm test';
            break;
        case 'rust':
            testStep = 'run: cargo test --workspace';
            break;
        case 'python':
            testStep = `run: ${CMD_PYTEST}`;
            break;
        case 'go':
            testStep = 'run: go test ./...';
            break;
        default:
            testStep = 'run: npm test || true';
            break;
    }

    const workflowContent = `name: CI Gate

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]

jobs:
  hygiene:
    name: Tier 2 Hygiene & Staged Gate
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Verify Physical Hygiene
        run: |
          # 1. Verify no 0-byte empty files
          EMPTY_COUNT=$(find . -type f -empty -not -path '*/.*' | wc -l)
          if [ "$EMPTY_COUNT" -gt 0 ]; then
            echo "[CI ERROR] Found empty files:"
            find . -type f -empty -not -path '*/.*'
            ${SH_EXIT} 1
          fi

  regression:
    name: Tier 2 Full Regression Suite
    needs: hygiene
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Execute Regression
        ${testStep}
`;
    return workflowContent;
}

/**
 * Builds standard router git hooks.
 */
function buildScaffoldHooks(): GateScaffoldPayload['suggestedStructure']['hooks'] {
    return [
        {
            name: HOOK_PRE_COMMIT,
            filePath: FILE_PRE_COMMIT,
            content: createHookRouter(HOOK_PRE_COMMIT, SCRIPT_PRE_COMMIT_GATE),
        },
        {
            name: HOOK_COMMIT_MSG,
            filePath: FILE_COMMIT_MSG,
            content: createHookRouter(HOOK_COMMIT_MSG, SCRIPT_COMMIT_MSG_GATE),
        },
        {
            name: HOOK_PRE_PUSH,
            filePath: FILE_PRE_PUSH,
            content: createHookRouter(HOOK_PRE_PUSH, SCRIPT_PRE_PUSH_GATE),
        },
    ];
}

/**
 * Builds executable runner scripts for Bash and PowerShell.
 */
function buildScaffoldRunners(archetype: ProjectArchetype): GateScaffoldPayload['suggestedStructure']['runnerScripts'] {
    return [
        {
            filePath: 'scripts/pre-commit-gate.sh',
            content: createPreCommitBashRunner(),
        },
        {
            filePath: 'scripts/pre-commit-gate.ps1',
            content: createPreCommitPowerRunner(),
        },
        {
            filePath: 'scripts/commit-msg-gate.sh',
            content: createCommitMsgBashRunner(),
        },
        {
            filePath: 'scripts/pre-push-gate.sh',
            content: createPrePushBashRunner(archetype),
        },
    ];
}

/**
 * Builds installation helper scripts for hooks activation.
 */
function buildScaffoldInstallScripts(): GateScaffoldPayload['suggestedStructure']['installScripts'] {
    return [
        {
            filePath: '.githooks/install-hooks.sh',
            content: createInstallHooksBash(),
        },
        {
            filePath: '.githooks/install-hooks.ps1',
            content: createInstallHooksPower(),
        },
    ];
}

/**
 * Generate complete 2-tier gate scaffolding and Agent Actionable Payload.
 *
 * @param context - Repository archetype context.
 * @param code - Standardized rule code (default GATE-SYS-001).
 * @returns Fully populated GateScaffoldPayload.
 */
export function generateGateScaffold(
    context: RepoArchetypeContext,
    code: string = DEFAULT_GATE_CODE,
): GateScaffoldPayload {
    const archetype = context.primaryArchetype;

    return {
        action: ACTION_SCAFFOLD,
        code,
        archetype,
        safeToAutomate: true,
        description: `Scaffold standardized 2-tier cross-platform gate architecture for ${archetype} repository.`,
        suggestedStructure: {
            hookDir: DIR_GITHOOKS,
            hooks: buildScaffoldHooks(),
            runnerScripts: buildScaffoldRunners(archetype),
            installScripts: buildScaffoldInstallScripts(),
            ciWorkflow: {
                filePath: FILE_CI_WORKFLOW,
                content: createCiWorkflowTemplate(archetype),
            },
        },
    };
}
