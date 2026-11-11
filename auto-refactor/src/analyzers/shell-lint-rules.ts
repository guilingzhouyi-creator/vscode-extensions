/**
 * Module: Static Analysis Engine — Shell / PowerShell Lint Rule Definitions & Scanners
 * File Path: src/analyzers/shell-lint-rules.ts
 * Architecture Role: Rule dictionaries, regex patterns, and scan helpers for shell-lint analyzer.
 * Dependencies & Triggers: core types only; consumed by ShellLintAnalyzer.
 * Responsibilities: Maintain POSIX and PowerShell patterns, alias tables, approved verbs,
 *   and individual lint rule validators.
 * Exit Semantics & Design Rationale: Pure scanners and regex tables, never throws.
 */
import type { SEVERITY_INFO } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_ERROR } from '../core/types';
import { REGEX } from '../core/constants';

/* ---- Rule ID constants ---- */

/** Rule identifier for deprecated shell syntax detection. */
export const RULE_SH_DEPR_001 = 'SH-DEPR-001';
/** Rule identifier for fragile conditional test detection. */
export const RULE_SH_COND_001 = 'SH-COND-001';
/** Rule identifier for unquoted variable usage detection. */
export const RULE_SH_QUOTE_001 = 'SH-QUOTE-001';
/** Rule identifier for missing shell script documentation header. */
export const RULE_SH_DOC_001 = 'SH-DOC-001';
/** Rule identifier for missing PowerShell script documentation header. */
export const RULE_PS_DOC_001 = 'PS-DOC-001';
/** Rule identifier for non-compliant line endings in shell scripts. */
export const RULE_SH_EOL_001 = 'SH-EOL-001';
/** Rule identifier for shell commands lacking explicit error exit checking. */
export const RULE_SH_EXIT_001 = 'SH-EXIT-001';
/** Rule identifier for missing error trap handler in shell scripts. */
export const RULE_SH_TRAP_001 = 'SH-TRAP-001';
/** Rule identifier for missing error handling trap in PowerShell scripts. */
export const RULE_PS_TRAP_001 = 'PS-TRAP-001';
/** Rule identifier for insecure dynamic command execution in shell. */
export const RULE_SH_SEC_001 = 'SH-SEC-001';
/** Rule identifier for insecure dynamic evaluation in PowerShell. */
export const RULE_PS_SEC_001 = 'PS-SEC-001';
/** Rule identifier for missing non-interactive safety guards in PowerShell. */
export const RULE_PS_SAFE_001 = 'PS-SAFE-001';
/** Rule identifier for missing non-interactive safety guards in shell. */
export const RULE_SH_SAFE_001 = 'SH-SAFE-001';
/** Rule identifier for missing shebang line in shell scripts. */
export const RULE_SH_INIT_001 = 'SH-INIT-001';
/** Rule identifier for missing strict error handling (set -euo pipefail). */
export const RULE_SH_ERR_001 = 'SH-ERR-001';
/** Rule identifier for unverified directory changes (cd without error check). */
export const RULE_SH_CMD_001 = 'SH-CMD-001';
/** Rule identifier for read without -r option. */
export const RULE_SH_READ_001 = 'SH-READ-001';
/** Rule identifier for fragile $* parameter array expansion. */
export const RULE_SH_ARRAY_001 = 'SH-ARRAY-001';
/** Rule identifier for non-portable echo flags. */
export const RULE_SH_ECHO_001 = 'SH-ECHO-001';
/** Rule identifier for PowerShell functions lacking CmdletBinding attribute. */
export const RULE_PS_CMDLET_001 = 'PS-CMDLET-001';
/** Rule identifier for untyped parameters in PowerShell functions. */
export const RULE_PS_PARAM_001 = 'PS-PARAM-001';
/** Rule identifier for missing ErrorActionPreference = Stop in PowerShell. */
export const RULE_PS_ERROR_001 = 'PS-ERROR-001';
/** Rule identifier for unapproved PowerShell verbs in function names. */
export const RULE_PS_VERB_001 = 'PS-VERB-001';
/** Rule identifier for command alias usage in PowerShell scripts. */
export const RULE_PS_ALIAS_001 = 'PS-ALIAS-001';

/** Canonical diagnostic messages and remediation suggestions for shell lint rules. */
export const SHELL_RULE_MESSAGES = {
    backtickDeprecated: 'Backtick command substitution is deprecated: use $(...) instead.',
    backtickSuggestion:
        'Replace `` `cmd` `` with `$(cmd)` — it nests cleanly and is easier to read.',
    fragileBracketTest: 'The `[` test command is fragile; use `[[` for safer string/number tests.',
    fragileBracketSuggestion:
        'Use `[[ ... ]]` instead of `[ ... ]` — it handles empty variables safely and supports pattern matching.',
    conditionRegexError:
        'Regex operator `=~` is invalid inside single brackets `[ ... ]`; use `[[ ... ]]`.',
    conditionRegexSuggestion:
        'Upgrade condition to `[[ ... =~ ... ]]` to enable regex pattern matching.',
    conditionLogicalError:
        'Logical `&&` / `||` inside single brackets `[ ... ]` causes syntax errors; use `[[ ... ]]`.',
    conditionLogicalSuggestion:
        'Upgrade condition to `[[ ... && ... ]]` or use separate test invocations.',
    conditionEqualityWarning:
        'Equality operator `==` inside single brackets `[ ... ]` violates POSIX portability.',
    conditionEqualitySuggestion:
        'Use single `=` inside `[ ... ]` for portability, or upgrade to `[[ ... == ... ]]`.',
    shellDocMissing: 'Shell script lacks standard module documentation contract header.',
    shellDocSuggestion:
        'Add a standard module header (# Module:, # Description:, # Usage:) near the top.',
    psDocMissing:
        'PowerShell script lacks standard documentation header (.SYNOPSIS/.DESCRIPTION or Module header).',
    psDocSuggestion:
        'Add standard comment help (<# .SYNOPSIS ... .DESCRIPTION ... #>) or module metadata at script start.',
    shellEolCrlf:
        'Shell script contains CRLF (\\r\\n) line endings; execution will fail on POSIX/containers.',
    shellEolSuggestion:
        'Convert line endings from CRLF to LF using dos2unix or your editor line-ending setting.',
    shellExitUnchecked:
        'Command expected to return non-zero exit codes executed bare under `set -e`, risking early abort.',
    shellExitSuggestion:
        'Capture exit status explicitly: `STATUS=0; cmd || STATUS=$?` or wrap in `if cmd; then`.',
    shellTrapMissing: 'Temporary file/directory created without registering EXIT cleanup trap.',
    shellTrapSuggestion:
        'Register a cleanup trap immediately after creating temporary resources: `trap \'rm -rf "$TMP"\' EXIT`.',
    psResourceDisposalMissing:
        'Critical system handle created without try-finally resource disposal.',
    psResourceDisposalSuggestion:
        'Wrap handle usage in `try { ... } finally { $handle.Dispose() }` to guarantee release.',
    shellDynamicEval: 'Dynamic `eval` with variable expansion risks arbitrary command injection.',
    shellDynamicEvalSuggestion:
        'Use an array invocation (`"${CMD[@]}"`) or direct function dispatch instead of dynamic eval.',
    psDynamicIex:
        'Dynamic `Invoke-Expression` (iex) with variable input risks arbitrary code injection.',
    psDynamicIexSuggestion:
        'Use the call operator (`& $cmd @params`) or script block invocation instead of Invoke-Expression.',
    psInteractiveUnguarded: 'Interactive input cmdlet used without non-interactive terminal guard.',
    psInteractiveSuggestion:
        'Guard interactive input with `if ([Environment]::UserInteractive -and -not [Console]::IsOutputRedirected)` or support `-Force`.',
    shellInteractiveUnguarded:
        'Interactive `read` without timeout risks hanging unattended CI/Agent subprocesses.',
    shellInteractiveSuggestion:
        'Add a timeout flag (`read -t 10`) or verify terminal interactivity with `[[ -t 0 ]]` before prompting.',
} as const;

const SCRIPTS_DIR_FRAGMENT = '/scripts/';
const SCRIPTS_DIR_PREFIX = 'scripts/';

function isScriptDirectory(filePath: string): boolean {
    const norm = filePath.replace(/\\/g, '/');
    return norm.includes(SCRIPTS_DIR_FRAGMENT) || norm.startsWith(SCRIPTS_DIR_PREFIX);
}

/* ---- Shell extension detection ---- */

/** Set of standard Unix shell script extensions. */
export const SHELL_EXTS = new Set(['.sh', '.bash', '.zsh']);
/** Set of standard PowerShell script extensions. */
export const POWERSHELL_EXTS = new Set(['.ps1', '.psm1', '.psd1']);

/**
 * Determine if a file is a shell script. Checks extension first, then falls back
 * to shebang detection for extensionless executable scripts.
 *
 * @param filePath - Normalized file path.
 * @param content - Full file content.
 * @returns True when the file should be treated as a shell script.
 */
export function isShellFile(filePath: string, content: string): boolean {
    const lower = filePath.toLowerCase();
    const slash = lower.lastIndexOf('/');
    const dot = lower.lastIndexOf('.');
    if (dot > slash) {
        return SHELL_EXTS.has(lower.slice(dot));
    }
    // Extensionless — check shebang
    return REGEX.SHELL.SHEBANG.test(content.split('\n')[0] || '');
}

/**
 * Determine if a file is a PowerShell script.
 *
 * @param filePath - Normalized file path.
 * @returns True when the file is a PowerShell script.
 */
export function isPowerShellFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    const slash = lower.lastIndexOf('/');
    const dot = lower.lastIndexOf('.');
    return dot > slash ? POWERSHELL_EXTS.has(lower.slice(dot)) : false;
}

/* ---- PowerShell patterns & tables ---- */

const POWERSHELL_ALIAS_MAPPING_TEXT = `Get-ChildItem:ls dir gci
Set-Location:cd sl chdir
Get-Location:pwd gl
Copy-Item:cp cpi copy
Move-Item:mv mi move
Remove-Item:rm ri del erase rd rmdir
New-Item:ni mkdir md
Get-Content:cat gc type get
Write-Output:echo write
Stop-Process:kill spps
Get-Process:ps gps
Sort-Object:sort
Select-Object:select
Where-Object:where ?
ForEach-Object:% foreach
Format-List:fl
Format-Table:ft
Format-Wide:fw
Format-Custom:fc
Tee-Object:tee
Start-Sleep:sleep
Start-Process:start saps
Invoke-Expression:iex
Invoke-Item:ii
Get-ItemProperty:gp
Set-ItemProperty:sp
Get-Item:gi
Set-Item:si
Clear-Host:cls clear
Get-History:h history
Invoke-History:r ihy`;

function buildAliasMap(): Record<string, string> {
    const map: Record<string, string> = {};
    const lines = POWERSHELL_ALIAS_MAPPING_TEXT.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const [cmdlet, aliases] = line.split(':');
        const aliasList = aliases.split(' ');
        for (let j = 0; j < aliasList.length; j++) {
            map[aliasList[j]] = cmdlet;
        }
    }
    return Object.freeze(map);
}

/** Frozen lookup mapping interactive PowerShell aliases to canonical cmdlet names. */
export const POWERSHELL_ALIASES: Record<string, string> = buildAliasMap();

const PS_VERB_TOKENS =
    'Add Approve Assert Backup Block Build Checkpoint Clear Close Compare Complete Compress Confirm Connect Convert ConvertFrom ConvertTo Copy Debug Deny Disable Disconnect Dismount Edit Enable Enter Exit Expand Export Find Format Get Grant Group Hide Import Initialize Install Invoke Join Limit Lock Measure Merge Mount Move New Open Optimize Out Ping Pop Protect Publish Push Put Read Receive Redo Register Remove Rename Repair Request Reset Resize Resolve Restart Restore Resume Revoke Save Search Select Send Set Show Skip Split Start Step Stop Submit Suspend Switch Sync Test Trace Undo Uninstall Unlock Unprotect Unpublish Unregister Update Use Wait Watch Write';

/** Canonical Microsoft-approved PowerShell verb set in PascalCase. */
export const PS_APPROVED_VERBS = new Set(PS_VERB_TOKENS.split(' '));

/**
 * Case-folded projection of {@link PS_APPROVED_VERBS}.
 *
 * PowerShell treats verbs case-insensitively, but the approved list keeps its canonical camel
 * case because that is how Microsoft publishes it. Any check that folds the observed verb must
 * fold the reference set the same way; comparing a lower-cased verb against a camel-cased set
 * rejects every compound verb (`ConvertTo`, `ConvertFrom`) and no single-word verb, which reads
 * as a spelling rule rather than the case bug it is.
 */
export const PS_APPROVED_VERBS_FOLDED = new Set(
    [...PS_APPROVED_VERBS].map((approvedVerb) => approvedVerb.toLowerCase()),
);

/* ---- Emitter and State Types ---- */

/** Callback contract for emitting a line-level shell or PowerShell diagnostic issue. */
export type ShellEmitter = (
    lineIdx: number,
    rule: string,
    message: string,
    severity: typeof SEVERITY_ERROR | typeof SEVERITY_WARNING | typeof SEVERITY_INFO,
    suggestion: string,
    detail: Record<string, unknown>,
) => void;

/** Mutable line-by-line tracking state for PowerShell function and parameter block parsing. */
export interface PowerShellScanState {
    inFunction: boolean;
    functionName: string;
    functionStartLine: number;
    seenCmdletBinding: boolean;
    inParamBlock: boolean;
    paramBraceDepth: number;
    hasUntypedParam: boolean;
}

/** Pre-tokenized raw and string-masked representations of a single shell script line. */
export interface ShellLineScanContext {
    raw: string;
    trimmed: string;
    maskedTrimmed: string;
    lineIndex: number;
}

/* ---- Scan Helper Functions ---- */

/**
 * Scans masked lines for strict error handling flags (-e, -u, -o pipefail).
 *
 * @param maskedLines - Masked script lines.
 * @returns Status of found strict error flags.
 */
export function scanStrictErrorFlags(maskedLines: string[]): {
    hasE: boolean;
    hasU: boolean;
    hasPipefail: boolean;
} {
    let hasE = false;
    let hasU = false;
    let hasPipefail = false;
    const maxScan = Math.min(maskedLines.length, 30);

    for (let i = 0; i < maxScan; i++) {
        const trimmed = maskedLines[i].trim();
        if (trimmed === '') continue;
        if (REGEX.SHELL.SET_ERREXIT.test(trimmed)) hasE = true;
        if (REGEX.SHELL.SET_NOUNSET.test(trimmed)) hasU = true;
        if (REGEX.SHELL.SET_PIPEFAIL.test(trimmed)) hasPipefail = true;
        if (hasE && hasU && hasPipefail) break;
    }
    return { hasE, hasU, hasPipefail };
}

/**
 * Checks for deprecated shell syntax (`...` backticks and single bracket tests).
 *
 * @param lineCtx - Structured ShellLineScanContext.
 * @param emit - Issue emission callback.
 */
export function checkDeprecatedSyntax(lineCtx: ShellLineScanContext, emit: ShellEmitter): void {
    const raw = lineCtx.raw;
    const trimmed = lineCtx.trimmed;
    const masked = lineCtx.maskedTrimmed;
    const idx = lineCtx.lineIndex;

    if (REGEX.SHELL.BACKTICK_CMD.test(raw) && !/^['"]/.test(trimmed)) {
        if (masked.includes('`')) {
            emit(
                idx,
                RULE_SH_DEPR_001,
                SHELL_RULE_MESSAGES.backtickDeprecated,
                SEVERITY_WARNING,
                SHELL_RULE_MESSAGES.backtickSuggestion,
                { line: trimmed },
            );
        }
    }

    if (REGEX.SHELL.DEPRECATED_TEST.test(masked) && !REGEX.SHELL.MODERN_TEST.test(masked)) {
        if (
            !/:\s*\[/.test(trimmed) &&
            !/\]\s*,/.test(trimmed) &&
            !/^\s*["'][A-Za-z0-9_-]+["']\s*:/.test(trimmed) &&
            /\[[^\]]*\]/.test(masked)
        ) {
            emit(
                idx,
                RULE_SH_DEPR_001,
                SHELL_RULE_MESSAGES.fragileBracketTest,
                SEVERITY_WARNING,
                SHELL_RULE_MESSAGES.fragileBracketSuggestion,
                { line: trimmed },
            );
        }
    }
}

/**
 * Checks for invalid or non-portable condition syntax inside test brackets (SH-COND-001).
 * Specifically intercepts:
 *   - `==` inside single brackets `[ ... ]` (POSIX portability hazard)
 *   - `=~` inside single brackets `[ ... ]` (regex syntax error in `[`)
 *   - `&&` or `||` inside single brackets `[ ... ]` (syntax error in `[`)
 *
 * @param trimmed - Trimmed line text.
 * @param _maskedTrimmed - Masked trimmed line text.
 * @param lineIndex - 0-based line index.
 * @param emit - Issue emission callback.
 */
export function checkShellConditionSyntax(
    trimmed: string,
    _maskedTrimmed: string,
    lineIndex: number,
    emit: ShellEmitter,
): void {
    if (!REGEX.SHELL.SINGLE_BRACKET_TEST.test(trimmed) || REGEX.SHELL.MODERN_TEST.test(trimmed)) {
        return;
    }

    const match = REGEX.SHELL.BRACKET_TEST_COND.exec(trimmed);
    if (!match) return;

    const inner = match[1];

    if (/=~/.test(inner)) {
        emit(
            lineIndex,
            RULE_SH_COND_001,
            SHELL_RULE_MESSAGES.conditionRegexError,
            SEVERITY_ERROR,
            SHELL_RULE_MESSAGES.conditionRegexSuggestion,
            { line: trimmed },
        );
    } else if (/(?:&&|\|\|)/.test(inner)) {
        emit(
            lineIndex,
            RULE_SH_COND_001,
            SHELL_RULE_MESSAGES.conditionLogicalError,
            SEVERITY_ERROR,
            SHELL_RULE_MESSAGES.conditionLogicalSuggestion,
            { line: trimmed },
        );
    } else if (/(?:^|\s)==(?:\s|$)/.test(inner)) {
        emit(
            lineIndex,
            RULE_SH_COND_001,
            SHELL_RULE_MESSAGES.conditionEqualityWarning,
            SEVERITY_WARNING,
            SHELL_RULE_MESSAGES.conditionEqualitySuggestion,
            { line: trimmed },
        );
    }
}

/**
 * Checks for unquoted shell variables that risk word-splitting.
 *
 * @param _line - Raw line text.
 * @param maskedTrimmed - Masked trimmed line text.
 * @param lineIndex - 0-based line index.
 * @param emit - Issue emission callback.
 */
export function checkUnquotedVariables(
    _line: string,
    maskedTrimmed: string,
    lineIndex: number,
    emit: ShellEmitter,
): void {
    if (REGEX.SHELL.ASSIGN_STATEMENT.test(maskedTrimmed)) return;
    if (REGEX.SHELL.MODERN_TEST.test(maskedTrimmed)) return;
    if (REGEX.SHELL.DOUBLE_PAREN_TEST.test(maskedTrimmed)) return;
    if (REGEX.SHELL.FOR_STATEMENT.test(maskedTrimmed)) return;
    if (REGEX.SHELL.CASE_STATEMENT.test(maskedTrimmed)) return;
    if (REGEX.SHELL.FUNCTION_DEF.test(maskedTrimmed)) return;

    const matches = maskedTrimmed.match(
        /(^|[\s;|&(])\$([A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})(?=[\s;|&)\]]|$)/g,
    );
    if (matches && matches.length > 0) {
        const filtered = matches.filter((matchStr) => {
            const inner = matchStr.match(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/);
            return inner ? inner[1].length !== 1 : false;
        });

        if (filtered.length > 0) {
            const varMatch = filtered[0].match(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/);
            const varName = varMatch ? varMatch[1] : 'var';
            emit(
                lineIndex,
                RULE_SH_QUOTE_001,
                `Variable \`$${varName}\` may be unquoted: word-splitting will break values with spaces.`,
                SEVERITY_WARNING,
                `Wrap the reference in double quotes: \`"$${varName}"\` to preserve spaces and special characters.`,
                { variable: varName, line: maskedTrimmed },
            );
        }
    }
}

/**
 * Checks for Shell metadata documentation contract (SH-DOC-001).
 *
 * @param lines - Raw lines of the script.
 * @param filePath - Path to file being scanned.
 * @param emit - Issue emission callback.
 */
export function checkShellDocContract(lines: string[], filePath: string, emit: ShellEmitter): void {
    if (lines.length < 30 && !isScriptDirectory(filePath)) return;

    const maxScan = Math.min(lines.length, 30);
    for (let i = 0; i < maxScan; i++) {
        if (REGEX.SHELL.SHELL_DOC_HEADER.test(lines[i])) return;
    }

    emit(
        0,
        RULE_SH_DOC_001,
        SHELL_RULE_MESSAGES.shellDocMissing,
        SEVERITY_WARNING,
        SHELL_RULE_MESSAGES.shellDocSuggestion,
        { lines: lines.length },
    );
}

/**
 * Checks for PowerShell metadata documentation contract (PS-DOC-001).
 *
 * @param lines - Raw lines of the script.
 * @param filePath - Path to file being scanned.
 * @param emit - Issue emission callback.
 */
export function checkPowerShellDocContract(
    lines: string[],
    filePath: string,
    emit: ShellEmitter,
): void {
    if (lines.length < 30 && !isScriptDirectory(filePath)) return;

    const maxScan = Math.min(lines.length, 30);
    for (let i = 0; i < maxScan; i++) {
        if (REGEX.SHELL.PS_DOC_HEADER.test(lines[i])) return;
    }

    emit(
        0,
        RULE_PS_DOC_001,
        SHELL_RULE_MESSAGES.psDocMissing,
        SEVERITY_WARNING,
        SHELL_RULE_MESSAGES.psDocSuggestion,
        { lines: lines.length },
    );
}

/**
 * Checks for CRLF line endings in POSIX shell scripts (SH-EOL-001).
 *
 * @param content - Raw content of the script.
 * @param emit - Issue emission callback.
 */
export function checkShellLineEndings(content: string, emit: ShellEmitter): void {
    if (content.includes('\r')) {
        emit(
            0,
            RULE_SH_EOL_001,
            SHELL_RULE_MESSAGES.shellEolCrlf,
            SEVERITY_ERROR,
            SHELL_RULE_MESSAGES.shellEolSuggestion,
            {},
        );
    }
}

/**
 * Checks for unhandled exit codes under set -e (SH-EXIT-001).
 *
 * @param trimmed - Trimmed line text.
 * @param lineIdx - 0-based line index.
 * @param hasSetE - Whether set -e is active in the script.
 * @param emit - Issue emission callback.
 */
export function checkShellStrictExitCapture(
    trimmed: string,
    lineIdx: number,
    hasSetE: boolean,
    emit: ShellEmitter,
): void {
    if (!hasSetE) return;
    if (
        REGEX.SHELL.SH_PREDICATE_COMMANDS.test(trimmed) &&
        !REGEX.SHELL.SH_EXIT_GUARD.test(trimmed)
    ) {
        emit(
            lineIdx,
            RULE_SH_EXIT_001,
            SHELL_RULE_MESSAGES.shellExitUnchecked,
            SEVERITY_WARNING,
            SHELL_RULE_MESSAGES.shellExitSuggestion,
            { line: trimmed },
        );
    }
}

/**
 * Checks for temporary resource creation without EXIT trap (SH-TRAP-001).
 *
 * @param lines - Raw lines of the script.
 * @param maskedLines - Masked lines of the script.
 * @param emit - Issue emission callback.
 */
export function checkShellResourceCleanup(
    lines: string[],
    maskedLines: string[],
    emit: ShellEmitter,
    filePath?: string,
): void {
    if (
        filePath &&
        (filePath.includes('/lib/') || filePath.includes('\\lib\\') || filePath.endsWith('.lib.sh'))
    ) {
        return;
    }
    let hasResource = false;
    let resourceLine = 0;
    let hasTrap = false;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('#')) continue;
        if (REGEX.SHELL.SHELL_TRAP_EXIT.test(trimmed)) {
            hasTrap = true;
        }
        if (!hasResource && REGEX.SHELL.SHELL_MKTEMP.test(trimmed)) {
            hasResource = true;
            resourceLine = i;
        }
    }

    if (hasResource && !hasTrap) {
        emit(
            resourceLine,
            RULE_SH_TRAP_001,
            SHELL_RULE_MESSAGES.shellTrapMissing,
            SEVERITY_ERROR,
            SHELL_RULE_MESSAGES.shellTrapSuggestion,
            {},
        );
    }
}

/**
 * Checks for PowerShell critical handle creation without try-finally (PS-TRAP-001).
 *
 * @param lines - Raw lines of the script.
 * @param maskedLines - Masked lines of the script.
 * @param emit - Issue emission callback.
 */
export function checkPowerShellResourceDisposal(
    lines: string[],
    maskedLines: string[],
    emit: ShellEmitter,
): void {
    let handleLine = -1;
    let hasFinally = false;

    for (let i = 0; i < lines.length; i++) {
        const masked = maskedLines[i];
        if (REGEX.SHELL.PS_FINALLY.test(masked)) {
            hasFinally = true;
            break;
        }
        if (handleLine === -1 && REGEX.SHELL.PS_RESOURCE_DISPOSAL.test(masked)) {
            handleLine = i;
        }
    }

    if (handleLine !== -1 && !hasFinally) {
        emit(
            handleLine,
            RULE_PS_TRAP_001,
            SHELL_RULE_MESSAGES.psResourceDisposalMissing,
            SEVERITY_WARNING,
            SHELL_RULE_MESSAGES.psResourceDisposalSuggestion,
            {},
        );
    }
}

/**
 * Checks for dynamic eval execution in shell scripts (SH-SEC-001).
 *
 * @param trimmed - Trimmed line text.
 * @param lineIdx - 0-based line index.
 * @param emit - Issue emission callback.
 */
export function checkShellDynamicSecurity(
    trimmed: string,
    lineIdx: number,
    emit: ShellEmitter,
): void {
    if (REGEX.SHELL.SH_EVAL_DYNAMIC.test(trimmed)) {
        emit(
            lineIdx,
            RULE_SH_SEC_001,
            SHELL_RULE_MESSAGES.shellDynamicEval,
            SEVERITY_ERROR,
            SHELL_RULE_MESSAGES.shellDynamicEvalSuggestion,
            { line: trimmed },
        );
    }
}

/**
 * Checks for dynamic Invoke-Expression in PowerShell (PS-SEC-001).
 *
 * @param trimmed - Trimmed line text.
 * @param lineIdx - 0-based line index.
 * @param emit - Issue emission callback.
 */
export function checkPowerShellDynamicSecurity(
    trimmed: string,
    lineIdx: number,
    emit: ShellEmitter,
): void {
    if (REGEX.SHELL.PS_IEX_DYNAMIC.test(trimmed)) {
        emit(
            lineIdx,
            RULE_PS_SEC_001,
            SHELL_RULE_MESSAGES.psDynamicIex,
            SEVERITY_ERROR,
            SHELL_RULE_MESSAGES.psDynamicIexSuggestion,
            { line: trimmed },
        );
    }
}

/**
 * Checks for interactive input without guard in PowerShell (PS-SAFE-001).
 *
 * @param lineCtx - Structured line scan context.
 * @param hasGuard - Guard status indicating whether the script runs non-interactively.
 * @param emit - Issue emission callback.
 */
export function checkPowerShellSafety(
    lineCtx: ShellLineScanContext,
    hasGuard: boolean,
    emit: ShellEmitter,
): void {
    if (hasGuard) return;
    if (REGEX.SHELL.PS_INTERACTIVE.test(lineCtx.maskedTrimmed)) {
        emit(
            lineCtx.lineIndex,
            RULE_PS_SAFE_001,
            SHELL_RULE_MESSAGES.psInteractiveUnguarded,
            SEVERITY_ERROR,
            SHELL_RULE_MESSAGES.psInteractiveSuggestion,
            { line: lineCtx.trimmed },
        );
    }
}

/**
 * Checks for interactive read without timeout or TTY guard in Shell (SH-SAFE-001).
 *
 * @param lineCtx - Structured line scan context.
 * @param hasGuard - TTY guard status.
 * @param emit - Issue emission callback.
 */
export function checkShellSafety(
    lineCtx: ShellLineScanContext,
    hasGuard: boolean,
    emit: ShellEmitter,
): void {
    if (hasGuard) return;
    const masked = lineCtx.maskedTrimmed;
    if (REGEX.SHELL.WHILE_READ.test(masked)) return;
    if (REGEX.SHELL.HEREDOC_OR_INPUT.test(masked)) return;
    if (REGEX.SHELL.SH_READ_INTERACTIVE.test(masked) && !REGEX.SHELL.READ_TIMEOUT.test(masked)) {
        emit(
            lineCtx.lineIndex,
            RULE_SH_SAFE_001,
            SHELL_RULE_MESSAGES.shellInteractiveUnguarded,
            SEVERITY_ERROR,
            SHELL_RULE_MESSAGES.shellInteractiveSuggestion,
            { line: lineCtx.trimmed },
        );
    }
}
