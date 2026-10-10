/**
 * Module: Static Analysis Engine — Shell / PowerShell Lint Rules
 * File Path: src/analyzers/shell-lint.ts
 * Architecture Role: Content-only (line-scan) lint analyzer for POSIX shell scripts
 *     (.sh, .bash, .zsh) and PowerShell scripts (.ps1, .psm1, .psd1).
 * Dependencies & Triggers: core types and shell-lint-rules; enabled when a config declares
 *     `analyzers.shell-lint`; runs on shell / PowerShell files during the engine's
 *     analyze/finalize pass.
 * Responsibilities: Detect unquoted variables (SH-QUOTE-001), missing shebang
 *     (SH-INIT-001), missing `set -euo pipefail` (SH-ERR-001), deprecated syntax
 *     (SH-DEPR-001), `cd` without error check (SH-CMD-001), `read` without `-r`
 *     (SH-READ-001), `$*` vs `$@` (SH-ARRAY-001), `echo -e` vs `printf`
 *     (SH-ECHO-001); and for PowerShell: alias usage (PS-ALIAS-001), unapproved
 *     function verbs (PS-VERB-001), missing CmdletBinding (PS-CMDLET-001),
 *     untyped parameters (PS-PARAM-001), missing ErrorActionPreference
 *     (PS-ERROR-001).
 * Exit Semantics & Design Rationale: Pure line scanner, never throws and returns
 *     [] for non-shell content. Heuristics are conservative — a missed finding is
 *     preferred over a false positive.
 */
import type { Analyzer, AnalyzerContext, Issue, Severity, AgentActionType } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_INFO } from '../core/types';
import { maskSourceText, type SourceMaskConfig } from '../core/policy/source-mask';
import {
    isShellFile,
    isPowerShellFile,
    SHEBANG_RE,
    CD_WITHOUT_CHECK_RE,
    READ_CMD_RE,
    READ_HAS_R_RE,
    DOLLAR_STAR_RE,
    ECHO_FLAG_RE,
    POWERSHELL_ALIASES,
    PS_APPROVED_VERBS,
    PS_FUNCTION_RE,
    PS_CMDLET_BINDING_RE,
    PS_PARAM_BLOCK_RE,
    PS_PARAM_WITH_TYPE_RE,
    PS_PARAM_SIMPLE_RE,
    PS_ERROR_ACTION_RE,
    SH_TTY_GUARD_RE,
    PS_INTERACTIVE_GUARD_RE,
    PS_NON_INTERACTIVE_FLAG_RE,
    type ShellEmitter,
    type PowerShellScanState,
    scanStrictErrorFlags,
    checkDeprecatedSyntax,
    checkShellConditionSyntax,
    checkUnquotedVariables,
    checkShellDocContract,
    checkPowerShellDocContract,
    checkShellLineEndings,
    checkShellStrictExitCapture,
    checkShellResourceCleanup,
    checkPowerShellResourceDisposal,
    checkShellDynamicSecurity,
    checkPowerShellDynamicSecurity,
    checkPowerShellInteractiveSafety,
    checkShellInteractiveSafety,
} from './shell-lint-rules';

const SHELL_ACTIONABLE_MAP: Record<
    string,
    { action: AgentActionType; code: string; safeToAutomate: boolean; templateSnippet: string }
> = {
    'SH-ERR-001': {
        action: 'replace_token',
        code: 'AR:SHL:001',
        safeToAutomate: true,
        templateSnippet: 'set -euo pipefail',
    },
    'SH-QUOTE-001': {
        action: 'replace_token',
        code: 'AR:SHL:002',
        safeToAutomate: false,
        templateSnippet: '"$VAR"',
    },
};

/**
 * Shell / PowerShell lint analyzer.
 */
export class ShellLintAnalyzer implements Analyzer {
    name = 'shell-lint' as const;

    /**
     * Streaming-path entry point: the engine invokes this once per file.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    analyze(_sf: unknown, ctx: AnalyzerContext): Issue[] {
        const content = ctx.content || '';
        const file = ctx.filePath.replace(/\\/g, '/');
        if (content.length === 0) return [];

        const isShell = isShellFile(file, content);
        const isPS = isPowerShellFile(file);
        if (!isShell && !isPS) return [];

        const issues: Issue[] = [];
        const emit = this.createIssueEmitter(file, issues);

        if (isShell) {
            this.analyzeShell(content, file, emit);
        } else if (isPS) {
            this.analyzePowerShell(content, file, emit);
        }

        for (const iss of issues) {
            if (!iss.actionable && SHELL_ACTIONABLE_MAP[iss.rule]) {
                const mapped = SHELL_ACTIONABLE_MAP[iss.rule];
                iss.actionable = {
                    action: mapped.action,
                    code: mapped.code,
                    safeToAutomate: mapped.safeToAutomate,
                    templateSnippet: mapped.templateSnippet,
                };
            }
        }

        return issues;
    }

    private createIssueEmitter(file: string, issues: Issue[]): ShellEmitter {
        return (
            lineIdx: number,
            rule: string,
            message: string,
            severity: Severity,
            suggestion: string,
            detail: Record<string, unknown>,
        ): void => {
            const mapped = SHELL_ACTIONABLE_MAP[rule];
            const actionable = mapped
                ? {
                      action: mapped.action,
                      code: mapped.code,
                      safeToAutomate: mapped.safeToAutomate,
                      templateSnippet: mapped.templateSnippet,
                  }
                : undefined;
            issues.push({
                id: `shell-lint:${rule}:${file}:${lineIdx + 1}`,
                analyzer: this.name,
                rule,
                severity,
                message,
                location: {
                    file,
                    start: { line: lineIdx + 1, column: 1 },
                    end: { line: lineIdx + 1, column: 1 },
                },
                detail,
                suggestion,
                actionable,
            });
        };
    }

    /* =========================================================================
     * Shell rule implementation
     * ========================================================================= */

    private analyzeShell(content: string, file: string, emit: ShellEmitter): void {
        const { raw, masked } = maskSourceText(content, this.shellMaskConfig());
        const lines = raw;
        const maskedLines = masked;

        // --- File-level checks ---
        checkShellLineEndings(content, emit);
        this.checkShebang(lines, file, emit);
        this.checkSetEuoPipefail(lines, maskedLines, emit);
        checkShellDocContract(lines, file, emit);
        checkShellResourceCleanup(lines, maskedLines, emit);

        const { hasE } = scanStrictErrorFlags(maskedLines);
        const hasTtyGuard = maskedLines.some((l) => SH_TTY_GUARD_RE.test(l));

        // --- Line-level checks ---
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (trimmed === '' || trimmed.startsWith('#')) continue;

            const maskedLine = maskedLines[i];
            const maskedTrimmed = maskedLine.trim();

            checkDeprecatedSyntax(line, trimmed, maskedTrimmed, i, emit);
            checkShellConditionSyntax(trimmed, maskedTrimmed, i, emit);
            this.checkCdWithoutCheck(trimmed, i, emit);
            this.checkReadWithoutR(trimmed, i, emit);
            this.checkArraySyntax(trimmed, i, emit);
            this.checkEchoVsPrintf(trimmed, i, emit);
            checkUnquotedVariables(line, maskedTrimmed, i, emit);
            checkShellDynamicSecurity(trimmed, i, emit);
            checkShellInteractiveSafety(trimmed, maskedTrimmed, i, hasTtyGuard, emit);
            checkShellStrictExitCapture(trimmed, i, hasE, emit);
        }
    }

    private shellMaskConfig(): SourceMaskConfig {
        return { lineComment: '#', quoteChars: '\'"' };
    }

    private checkShebang(lines: string[], _file: string, emit: ShellEmitter): void {
        if (lines.length === 0) return;
        const firstLine = lines[0].trim();
        if (!SHEBANG_RE.test(firstLine)) {
            emit(
                0,
                'SH-INIT-001',
                'Script is missing a shebang line (#!/bin/bash or #!/usr/bin/env bash).',
                SEVERITY_WARNING,
                'Add `#!/usr/bin/env bash` (or `#!/bin/bash`) as the first line so the script runs with the correct interpreter.',
                { line: firstLine || '(empty)' },
            );
        }
    }

    private checkSetEuoPipefail(_lines: string[], maskedLines: string[], emit: ShellEmitter): void {
        const { hasE, hasU, hasPipefail } = scanStrictErrorFlags(maskedLines);
        if (hasE && hasU && hasPipefail) return;

        const missing: string[] = [];
        if (!hasE) missing.push('-e (errexit)');
        if (!hasU) missing.push('-u (nounset)');
        if (!hasPipefail) missing.push('-o pipefail');

        emit(
            0,
            'SH-ERR-001',
            `Script does not set strict error handling (missing: ${missing.join(', ')}).`,
            SEVERITY_INFO,
            'Add `set -euo pipefail` near the top of the script to make errors and unset variables fail fast.',
            { missing },
        );
    }

    private checkCdWithoutCheck(trimmed: string, i: number, emit: ShellEmitter): void {
        if (CD_WITHOUT_CHECK_RE.test(trimmed)) {
            emit(
                i,
                'SH-CMD-001',
                '`cd` without error check: a failed cd will silently continue in the wrong directory.',
                SEVERITY_WARNING,
                'Use `cd foo || exit 1` or `cd foo && ...` so the script aborts when the directory is unreachable.',
                { line: trimmed },
            );
        }
    }

    private checkReadWithoutR(trimmed: string, i: number, emit: ShellEmitter): void {
        if (READ_CMD_RE.test(trimmed) && !READ_HAS_R_RE.test(trimmed)) {
            emit(
                i,
                'SH-READ-001',
                '`read` without `-r` mangles backslashes in the input.',
                SEVERITY_INFO,
                'Use `read -r` to preserve backslashes in the input (almost always the intended behavior).',
                { line: trimmed },
            );
        }
    }

    private checkArraySyntax(trimmed: string, i: number, emit: ShellEmitter): void {
        if (DOLLAR_STAR_RE.test(trimmed)) {
            emit(
                i,
                'SH-ARRAY-001',
                '`$*` joins all arguments into one string; use `$@` to preserve individual arguments.',
                SEVERITY_INFO,
                'Replace `$*` with `"$@"` so each positional parameter is preserved as a separate word.',
                { line: trimmed },
            );
        }
    }

    private checkEchoVsPrintf(trimmed: string, i: number, emit: ShellEmitter): void {
        if (ECHO_FLAG_RE.test(trimmed)) {
            emit(
                i,
                'SH-ECHO-001',
                '`echo -e` / `echo -n` is not portable; use `printf` for complex output.',
                SEVERITY_INFO,
                'Use `printf "%s\\n" "text"` instead of `echo -e` — printf is POSIX-standard and behaves consistently.',
                { line: trimmed },
            );
        }
    }

    /* =========================================================================
     * PowerShell rule implementation
     * ========================================================================= */

    private analyzePowerShell(content: string, file: string, emit: ShellEmitter): void {
        const { raw, masked } = maskSourceText(content, {
            lineComment: '#',
            blockComment: { open: '<#', close: '#>' },
            quoteChars: '\'"',
        });
        const lines = raw;
        const maskedLines = masked;

        this.checkErrorActionPreference(lines, emit);
        checkPowerShellDocContract(lines, file, emit);
        checkPowerShellResourceDisposal(lines, maskedLines, emit);

        const hasInteractiveGuard = maskedLines.some(
            (l) => PS_INTERACTIVE_GUARD_RE.test(l) || PS_NON_INTERACTIVE_FLAG_RE.test(l),
        );

        const state: PowerShellScanState = {
            inFunction: false,
            functionName: '',
            functionStartLine: -1,
            seenCmdletBinding: false,
            inParamBlock: false,
            paramBraceDepth: 0,
            hasUntypedParam: false,
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const maskedTrimmed = maskedLines[i].trim();

            if (trimmed === '' || trimmed.startsWith('#')) continue;

            this.updatePowerShellFunctionState(state, line, trimmed, maskedTrimmed, i, emit);
            this.checkPowerShellAliases(trimmed, maskedTrimmed, i, emit);
            checkPowerShellDynamicSecurity(trimmed, i, emit);
            checkPowerShellInteractiveSafety(trimmed, maskedTrimmed, i, hasInteractiveGuard, emit);
        }
    }

    private updatePowerShellFunctionState(
        state: PowerShellScanState,
        line: string,
        trimmed: string,
        maskedTrimmed: string,
        lineIdx: number,
        emit: ShellEmitter,
    ): void {
        this.checkPowerShellFunctionEntry(state, trimmed, lineIdx, emit);
        this.checkPowerShellParamBlock(state, trimmed, maskedTrimmed);

        if (state.inFunction && PS_CMDLET_BINDING_RE.test(trimmed)) {
            state.seenCmdletBinding = true;
        }

        if (state.inFunction && /^\s*\}\s*$/.test(line)) {
            this.finalizePowerShellFunction(state, emit);
        }
    }

    private checkPowerShellFunctionEntry(
        state: PowerShellScanState,
        trimmed: string,
        lineIdx: number,
        emit: ShellEmitter,
    ): void {
        const funcMatch = PS_FUNCTION_RE.exec(trimmed);
        if (funcMatch && !state.inFunction) {
            state.inFunction = true;
            state.functionName = funcMatch[1];
            state.functionStartLine = lineIdx;
            state.seenCmdletBinding = false;
            state.hasUntypedParam = false;
            this.checkApprovedVerb(state.functionName, lineIdx, emit);
        }
    }

    private checkPowerShellParamBlock(
        state: PowerShellScanState,
        trimmed: string,
        maskedTrimmed: string,
    ): void {
        if (state.inFunction && PS_PARAM_BLOCK_RE.test(trimmed)) {
            state.inParamBlock = true;
            state.paramBraceDepth = 0;
        }

        if (state.inParamBlock) {
            for (const ch of trimmed) {
                if (ch === '(') state.paramBraceDepth++;
                else if (ch === ')') state.paramBraceDepth--;
            }
            if (!PS_PARAM_WITH_TYPE_RE.test(trimmed) && PS_PARAM_SIMPLE_RE.test(trimmed)) {
                if (/\$[A-Za-z]/.test(maskedTrimmed)) {
                    state.hasUntypedParam = true;
                }
            }
            if (state.paramBraceDepth <= 0) {
                state.inParamBlock = false;
            }
        }
    }

    private finalizePowerShellFunction(state: PowerShellScanState, emit: ShellEmitter): void {
        if (!state.seenCmdletBinding && state.functionName !== '') {
            if (/^[A-Z]/.test(state.functionName)) {
                emit(
                    state.functionStartLine,
                    'PS-CMDLET-001',
                    `Function \`${state.functionName}\` is missing \`[CmdletBinding()]\` — common parameters (-Verbose, -WhatIf, etc.) will not work.`,
                    SEVERITY_INFO,
                    `Add \`[CmdletBinding()]\` before the \`param()\` block of \`${state.functionName}\` to enable common parameters and pipeline support.`,
                    { function: state.functionName },
                );
            }
        }

        if (state.hasUntypedParam) {
            emit(
                state.functionStartLine,
                'PS-PARAM-001',
                `Function \`${state.functionName}\` has parameters without explicit type annotations.`,
                SEVERITY_INFO,
                `Add type annotations (e.g. \`[string]$Name\`) to parameters for self-documentation and input validation.`,
                { function: state.functionName },
            );
        }

        state.inFunction = false;
        state.functionName = '';
        state.functionStartLine = -1;
        state.hasUntypedParam = false;
    }

    private checkErrorActionPreference(lines: string[], emit: ShellEmitter): void {
        let found = false;
        const maxScan = Math.min(lines.length, 30);
        for (let i = 0; i < maxScan; i++) {
            const trimmed = lines[i].trim();
            if (trimmed === '' || trimmed.startsWith('#')) continue;
            if (PS_ERROR_ACTION_RE.test(trimmed)) {
                found = true;
                break;
            }
        }
        if (!found) {
            emit(
                0,
                'PS-ERROR-001',
                "Script does not set `$ErrorActionPreference = 'Stop'` — non-terminating errors will be silently ignored.",
                SEVERITY_INFO,
                "Add `$ErrorActionPreference = 'Stop'` near the top of the script so non-terminating errors are treated as terminating.",
                {},
            );
        }
    }

    private checkApprovedVerb(functionName: string, i: number, emit: ShellEmitter): void {
        const dashIdx = functionName.indexOf('-');
        const verb = dashIdx > 0 ? functionName.slice(0, dashIdx) : functionName;
        const verbNormalized = verb.charAt(0).toUpperCase() + verb.slice(1).toLowerCase();

        if (dashIdx > 0 && !PS_APPROVED_VERBS.has(verbNormalized)) {
            emit(
                i,
                'PS-VERB-001',
                `Function \`${functionName}\` uses verb \`${verb}\` which is not in the PowerShell approved verb list.`,
                SEVERITY_WARNING,
                'Use an approved verb (e.g. Get, Set, New, Remove, Start, Stop, Invoke, ConvertTo, ConvertFrom). See `Get-Verb` for the full list.',
                { function: functionName, verb },
            );
        }
    }

    private checkPowerShellAliases(
        trimmed: string,
        maskedTrimmed: string,
        i: number,
        emit: ShellEmitter,
    ): void {
        if (maskedTrimmed === '') return;

        const aliasMatches = maskedTrimmed.matchAll(/(?:^|[\s;|&])([a-z][a-z0-9]*)(?=\s+)/gi);

        for (const match of aliasMatches) {
            const alias = match[1].toLowerCase();
            // In PowerShell, `foreach ($var in $col)` is a language statement keyword,
            // not a pipeline alias for `ForEach-Object`.
            const isForeachStatement =
                alias === 'foreach' && /(?:^|[\s;{}])foreach\s*\(/i.test(trimmed);
            if (isForeachStatement) {
                continue;
            }
            const canonical = POWERSHELL_ALIASES[alias];
            if (canonical) {
                emit(
                    i,
                    'PS-ALIAS-001',
                    `Alias \`${alias}\` should be written as \`${canonical}\` for readability.`,
                    SEVERITY_INFO,
                    `Use the full cmdlet name \`${canonical}\` instead of the alias \`${alias}\` — it is more self-documenting and works everywhere.`,
                    { alias, canonical, line: trimmed },
                );
                break;
            }
        }
    }
}
