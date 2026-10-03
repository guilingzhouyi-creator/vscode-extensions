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
import { SEVERITY_WARNING } from '../core/types';

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
        const ext = lower.slice(dot);
        if (SHELL_EXTS.has(ext)) return true;
        if (POWERSHELL_EXTS.has(ext)) return false;
        return false;
    }
    // Extensionless — check shebang
    return /^#!\s*\/.*(?:bash|sh|zsh|ksh)\b/.test(content.split('\n')[0] || '');
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
    if (dot > slash) {
        return POWERSHELL_EXTS.has(lower.slice(dot));
    }
    return false;
}

/* ---- Shell patterns ---- */

/** Regular expression matching executable shell script shebang line. */
export const SHEBANG_RE = /^#!\s*\/.*(?:bash|sh|zsh|ksh|env\s+\w*sh)\b/;
/** Regular expression matching 'set -e' or 'set -o errexit'. */
export const SET_E_RE = /\bset\s+(-[a-zA-Z]*e[a-zA-Z]*|-o\s+errexit)\b/;
/** Regular expression matching 'set -u' or 'set -o nounset'. */
export const SET_U_RE = /\bset\s+(-[a-zA-Z]*u[a-zA-Z]*|-o\s+nounset)\b/;
/** Regular expression matching 'set -o pipefail'. */
export const SET_PIPEFAIL_RE = /\bset\s+(-o\s+pipefail|-[a-zA-Z]*o[a-zA-Z]*\s+pipefail)\b/;
/** Regular expression matching legacy backtick command substitution. */
export const BACKTICK_CMD_RE = /`[^`]+`/;
export const DEPRECATED_TEST_RE = /(?:^|[\s;|&(])\[[!\s\w]/;
export const MODERN_TEST_RE = /\[\[/;
export const CD_WITHOUT_CHECK_RE = /^\s*(?:cd\s+[^\s;|&]+)(?!.*(?:\|\||&&))/;
export const READ_CMD_RE = /^\s*read\b/;
export const READ_HAS_R_RE = /\s-r\b/;
export const DOLLAR_STAR_RE = /(?:^|[\s;|&(=])\$\*(?:[\s;|&)]|$)/;
export const ECHO_FLAG_RE = /^\s*echo\s+-(?:e|n|en|ne)\b/;

/* ---- PowerShell patterns & tables ---- */

export const POWERSHELL_ALIASES: Record<string, string> = {
    ls: 'Get-ChildItem',
    dir: 'Get-ChildItem',
    gci: 'Get-ChildItem',
    cd: 'Set-Location',
    sl: 'Set-Location',
    chdir: 'Set-Location',
    pwd: 'Get-Location',
    gl: 'Get-Location',
    cp: 'Copy-Item',
    cpi: 'Copy-Item',
    copy: 'Copy-Item',
    mv: 'Move-Item',
    mi: 'Move-Item',
    move: 'Move-Item',
    rm: 'Remove-Item',
    ri: 'Remove-Item',
    del: 'Remove-Item',
    erase: 'Remove-Item',
    rd: 'Remove-Item',
    rmdir: 'Remove-Item',
    ni: 'New-Item',
    mkdir: 'New-Item',
    md: 'New-Item',
    cat: 'Get-Content',
    gc: 'Get-Content',
    type: 'Get-Content',
    echo: 'Write-Output',
    write: 'Write-Output',
    kill: 'Stop-Process',
    spps: 'Stop-Process',
    ps: 'Get-Process',
    gps: 'Get-Process',
    sort: 'Sort-Object',
    select: 'Select-Object',
    where: 'Where-Object',
    '?': 'Where-Object',
    '%': 'ForEach-Object',
    foreach: 'ForEach-Object',
    fl: 'Format-List',
    ft: 'Format-Table',
    fw: 'Format-Wide',
    fc: 'Format-Custom',
    tee: 'Tee-Object',
    sleep: 'Start-Sleep',
    start: 'Start-Process',
    saps: 'Start-Process',
    iex: 'Invoke-Expression',
    ii: 'Invoke-Item',
    gp: 'Get-ItemProperty',
    sp: 'Set-ItemProperty',
    gi: 'Get-Item',
    si: 'Set-Item',
    cls: 'Clear-Host',
    clear: 'Clear-Host',
    h: 'Get-History',
    history: 'Get-History',
    r: 'Invoke-History',
    ihy: 'Invoke-History',
    get: 'Get-Content',
};

export const PS_APPROVED_VERBS = new Set([
    'Add',
    'Approve',
    'Assert',
    'Backup',
    'Block',
    'Build',
    'Checkpoint',
    'Clear',
    'Close',
    'Compare',
    'Complete',
    'Compress',
    'Confirm',
    'Connect',
    'Convert',
    'ConvertFrom',
    'ConvertTo',
    'Copy',
    'Debug',
    'Deny',
    'Disable',
    'Disconnect',
    'Dismount',
    'Edit',
    'Enable',
    'Enter',
    'Exit',
    'Expand',
    'Export',
    'Find',
    'Format',
    'Get',
    'Grant',
    'Group',
    'Hide',
    'Import',
    'Initialize',
    'Install',
    'Invoke',
    'Join',
    'Limit',
    'Lock',
    'Measure',
    'Merge',
    'Mount',
    'Move',
    'New',
    'Open',
    'Optimize',
    'Out',
    'Ping',
    'Pop',
    'Protect',
    'Publish',
    'Push',
    'Put',
    'Read',
    'Receive',
    'Redo',
    'Register',
    'Remove',
    'Rename',
    'Repair',
    'Request',
    'Reset',
    'Resize',
    'Resolve',
    'Restart',
    'Restore',
    'Resume',
    'Revoke',
    'Save',
    'Search',
    'Select',
    'Send',
    'Set',
    'Show',
    'Skip',
    'Split',
    'Start',
    'Step',
    'Stop',
    'Submit',
    'Suspend',
    'Switch',
    'Sync',
    'Test',
    'Trace',
    'Undo',
    'Uninstall',
    'Unlock',
    'Unprotect',
    'Unpublish',
    'Unregister',
    'Update',
    'Use',
    'Wait',
    'Watch',
    'Write',
]);

export const PS_FUNCTION_RE = /^\s*function\s+([A-Za-z][A-Za-z0-9_-]*)\s*(?:\(\))?\s*\{?/;
export const PS_CMDLET_BINDING_RE = /\[CmdletBinding\s*\(\s*\)\]/;
export const PS_PARAM_BLOCK_RE = /^\s*param\s*\(/i;
export const PS_PARAM_WITH_TYPE_RE = /\[[A-Za-z][A-Za-z0-9_.]*\]\s*\$/;
export const PS_PARAM_SIMPLE_RE = /(?:^|[\s,])\$([A-Za-z][A-Za-z0-9_]*)\s*(?:=|,|\))/;
export const PS_ERROR_ACTION_RE = /\$ErrorActionPreference\s*=\s*['"]Stop['"]/i;

/* ---- Emitter and State Types ---- */

export type ShellEmitter = (
    lineIdx: number,
    rule: string,
    message: string,
    severity: typeof SEVERITY_WARNING | typeof SEVERITY_INFO,
    suggestion: string,
    detail: Record<string, unknown>,
) => void;

export interface PowerShellScanState {
    inFunction: boolean;
    functionName: string;
    functionStartLine: number;
    seenCmdletBinding: boolean;
    inParamBlock: boolean;
    paramBraceDepth: number;
    hasUntypedParam: boolean;
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
        if (SET_E_RE.test(trimmed)) hasE = true;
        if (SET_U_RE.test(trimmed)) hasU = true;
        if (SET_PIPEFAIL_RE.test(trimmed)) hasPipefail = true;
        if (hasE && hasU && hasPipefail) break;
    }
    return { hasE, hasU, hasPipefail };
}

/**
 * Checks for deprecated shell syntax (`...` backticks and single bracket tests).
 *
 * @param line - Raw line text.
 * @param trimmed - Trimmed line text.
 * @param maskedTrimmed - Masked trimmed line text.
 * @param i - 0-based line index.
 * @param emit - Issue emission callback.
 */
export function checkDeprecatedSyntax(
    line: string,
    trimmed: string,
    maskedTrimmed: string,
    i: number,
    emit: ShellEmitter,
): void {
    if (BACKTICK_CMD_RE.test(line) && !/^['"]/.test(trimmed)) {
        if (maskedTrimmed.includes('`')) {
            emit(
                i,
                'SH-DEPR-001',
                'Backtick command substitution is deprecated: use $(...) instead.',
                SEVERITY_WARNING,
                'Replace `` `cmd` `` with `$(cmd)` — it nests cleanly and is easier to read.',
                { line: trimmed },
            );
        }
    }

    if (DEPRECATED_TEST_RE.test(maskedTrimmed) && !MODERN_TEST_RE.test(maskedTrimmed)) {
        if (/\[[^\]]*\]/.test(maskedTrimmed)) {
            emit(
                i,
                'SH-DEPR-001',
                'The `[` test command is fragile; use `[[` for safer string/number tests.',
                SEVERITY_WARNING,
                'Use `[[ ... ]]` instead of `[ ... ]` — it handles empty variables safely and supports pattern matching.',
                { line: trimmed },
            );
        }
    }
}

/**
 * Checks for unquoted shell variables that risk word-splitting.
 *
 * @param _line - Raw line text.
 * @param maskedTrimmed - Masked trimmed line text.
 * @param i - 0-based line index.
 * @param emit - Issue emission callback.
 */
export function checkUnquotedVariables(
    _line: string,
    maskedTrimmed: string,
    i: number,
    emit: ShellEmitter,
): void {
    if (/^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(maskedTrimmed)) return;
    if (/\[\[/.test(maskedTrimmed)) return;
    if (/\(\(/.test(maskedTrimmed)) return;
    if (/^\s*for\s+[A-Za-z_]/.test(maskedTrimmed)) return;
    if (/^\s*case\b/.test(maskedTrimmed)) return;
    if (/^\s*(?:function\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)/.test(maskedTrimmed)) return;

    const matches = maskedTrimmed.match(
        /(^|[\s;|&(])\$([A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})(?=[\s;|&)\]]|$)/g,
    );
    if (matches && matches.length > 0) {
        const filtered = matches.filter((m) => {
            const inner = m.match(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/);
            if (!inner) return false;
            const name = inner[1];
            if (name.length === 1) return false;
            return true;
        });

        if (filtered.length > 0) {
            const varMatch = filtered[0].match(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/);
            const varName = varMatch ? varMatch[1] : 'var';
            emit(
                i,
                'SH-QUOTE-001',
                `Variable \`$${varName}\` may be unquoted: word-splitting will break values with spaces.`,
                SEVERITY_WARNING,
                `Wrap the reference in double quotes: \`"$${varName}"\` to preserve spaces and special characters.`,
                { variable: varName, line: maskedTrimmed },
            );
        }
    }
}
