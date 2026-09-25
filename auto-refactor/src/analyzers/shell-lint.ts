/**
 * Module: Static Analysis Engine — Shell / PowerShell Lint Rules
 * File Path: src/analyzers/shell-lint.ts
 * Architecture Role: Content-only (line-scan) lint analyzer for POSIX shell scripts
 *     (.sh, .bash, .zsh) and PowerShell scripts (.ps1, .psm1, .psd1).
 * Dependencies & Triggers: core types only; enabled when a config declares
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
 *     preferred over a false positive. Shell rules reference ShellCheck's most
 *     common issues; PowerShell rules reference PSScriptAnalyzer's frequent
 *     findings.
 */
import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_INFO } from '../core/types';
import { maskSourceText, languageIdFromPath, type SourceMaskConfig } from '../core/policy/source-mask';

/* ---- Shell extension detection ---- */

const SHELL_EXTS = new Set(['.sh', '.bash', '.zsh']);
const POWERSHELL_EXTS = new Set(['.ps1', '.psm1', '.psd1']);

/**
 * Determine if a file is a shell script. Checks extension first, then falls back
 * to shebang detection for extensionless executable scripts.
 *
 * @param filePath - Normalized file path.
 * @param content - Full file content (used for shebang detection when extensionless).
 * @returns True when the file should be treated as a shell script.
 */
function isShellFile(filePath: string, content: string): boolean {
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
 * @returns True when the file should be treated as a PowerShell script.
 */
function isPowerShellFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    const slash = lower.lastIndexOf('/');
    const dot = lower.lastIndexOf('.');
    if (dot > slash) {
        return POWERSHELL_EXTS.has(lower.slice(dot));
    }
    return false;
}

/* ---- Shell patterns ---- */

/** Shebang line for bash / sh / zsh. */
const SHEBANG_RE = /^#!\s*\/.*(?:bash|sh|zsh|ksh|env\s+\w*sh)\b/;

/** `set -euo pipefail` or equivalent combinations. */
const SET_EUO_PIPEFAIL_RE = /^\s*set\s+(?:-[a-zA-Z]*e[a-zA-Z]*u[a-zA-Z]*o[a-zA-Z]*|[a-zA-Z]*e[a-zA-Z]*u[a-zA-Z]*)\s+pipefail\b/;
// Also accept `set -euxo pipefail` etc. — match `-` followed by option letters containing e/u, or `set -o errexit` form.
const SET_E_RE = /\bset\s+(-[a-zA-Z]*e[a-zA-Z]*|-o\s+errexit)\b/;
const SET_U_RE = /\bset\s+(-[a-zA-Z]*u[a-zA-Z]*|-o\s+nounset)\b/;
const SET_PIPEFAIL_RE = /\bset\s+(-o\s+pipefail|-[a-zA-Z]*o[a-zA-Z]*\s+pipefail)\b/;

/** Unquoted variable reference heuristic: `$var` or `${var}` not inside quotes.
 *  We use the masked source so strings are already blanked, then look for bare `$`
 *  references that are not inside `$()` or `${}` followed by a quote character.
 *
 *  This is intentionally conservative: we only flag simple `$name` patterns that
 *  appear in command arguments (not on the left side of assignments, not inside
 *  `[[ ]]`, not in `case` patterns, etc.).
 */
const UNQUOTED_VAR_RE = /(?:^|[\s;|&(])\$([A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})(?=[\s;|&)\]]|$)/;

/** Deprecated backtick command substitution: `cmd` */
const BACKTICK_CMD_RE = /`[^`]+`/;

/** Deprecated `[` test command (should be `[[` in bash). */
const DEPRECATED_TEST_RE = /(?:^|[\s;|&(])\[[!\s\w]/;
/** Modern `[[` test command (to suppress false positives). */
const MODERN_TEST_RE = /\[\[/;

/** `cd` without an `||` or `&&` error check on the same line. */
const CD_WITHOUT_CHECK_RE = /^\s*(?:cd\s+[^\s;|&]+)(?!.*(?:\|\||&&))/;

/** `read` command without the `-r` flag (checked on full trimmed line). */
const READ_CMD_RE = /^\s*read\b/;
const READ_HAS_R_RE = /\s-r\b/;

/** `$*` usage (should use `$@` for array expansion). */
const DOLLAR_STAR_RE = /(?:^|[\s;|&(=])\$\*(?:[\s;|&)]|$)/;

/** `echo -e` or `echo -n` — complex output should use printf. */
const ECHO_FLAG_RE = /^\s*echo\s+-(?:e|n|en|ne)\b/;

/* ---- PowerShell patterns ---- */

/** Common PowerShell aliases and their canonical cmdlet names. */
const POWERSHELL_ALIASES: Record<string, string> = {
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

/** Build a regex that matches alias usage at the start of a pipeline position. */
function buildAliasRegex(): RegExp {
    const aliases = Object.keys(POWERSHELL_ALIASES)
        .filter((a) => /^\w+$/.test(a)) // only word-character aliases
        .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    return new RegExp(`(?:^|[\\s;|&|])(${aliases})\\s+`, 'i');
}

const PS_ALIAS_RE = buildAliasRegex();

/** PowerShell approved verbs list (common subset from
 *  https://docs.microsoft.com/en-us/powershell/scripting/developer/cmdlet/approved-verbs-for-windows-powershell-commands
 */
const PS_APPROVED_VERBS = new Set([
    // Common verbs
    'Add', 'Approve', 'Assert', 'Backup', 'Block', 'Build', 'Checkpoint', 'Clear',
    'Close', 'Compare', 'Complete', 'Compress', 'Confirm', 'Connect', 'Convert',
    'ConvertFrom', 'ConvertTo', 'Copy', 'Debug', 'Deny', 'Disable', 'Disconnect',
    'Dismount', 'Edit', 'Enable', 'Enter', 'Exit', 'Expand', 'Export', 'Find',
    'Format', 'Get', 'Grant', 'Group', 'Hide', 'Import', 'Initialize', 'Install',
    'Invoke', 'Join', 'Limit', 'Lock', 'Measure', 'Merge', 'Mount', 'Move', 'New',
    'Open', 'Optimize', 'Out', 'Ping', 'Pop', 'Protect', 'Publish', 'Push', 'Put',
    'Read', 'Receive', 'Redo', 'Register', 'Remove', 'Rename', 'Repair', 'Request',
    'Reset', 'Resize', 'Resolve', 'Restart', 'Restore', 'Resume', 'Revoke', 'Save',
    'Search', 'Select', 'Send', 'Set', 'Show', 'Skip', 'Split', 'Start', 'Step',
    'Stop', 'Submit', 'Suspend', 'Switch', 'Sync', 'Test', 'Trace', 'Undo',
    'Uninstall', 'Unlock', 'Unprotect', 'Unpublish', 'Unregister', 'Update',
    'Use', 'Wait', 'Watch', 'Write',
    // Data verbs
    'Backup', 'Checkpoint', 'Compare', 'Compress', 'Convert', 'ConvertFrom',
    'ConvertTo', 'Dismount', 'Edit', 'Expand', 'Export', 'Import', 'Initialize',
    'Limit', 'Merge', 'Mount', 'Out', 'Publish', 'Restore', 'Save', 'Sync',
    // Lifecycle verbs
    'Approve', 'Assert', 'Complete', 'Confirm', 'Deny', 'Enable', 'Disable',
    'Install', 'Invoke', 'Register', 'Request', 'Restart', 'Resume', 'Start',
    'Stop', 'Submit', 'Suspend', 'Uninstall', 'Unregister', 'Update', 'Wait',
    // Security verbs
    'Block', 'Grant', 'Protect', 'Revoke', 'Unprotect',
]);

/** PowerShell function definition: `function Name {` or `function Name() {`. */
const PS_FUNCTION_RE = /^\s*function\s+([A-Za-z][A-Za-z0-9_-]*)\s*(?:\(\))?\s*\{?/;

/** PowerShell `[CmdletBinding()]` attribute. */
const PS_CMDLET_BINDING_RE = /\[CmdletBinding\s*\(\s*\)\]/;

/** PowerShell `param()` block start. */
const PS_PARAM_BLOCK_RE = /^\s*param\s*\(/i;

/** PowerShell parameter with type annotation: `[Type]$Name` or `[Parameter(Mandatory)][Type]$Name`. */
const PS_PARAM_WITH_TYPE_RE = /\[[A-Za-z][A-Za-z0-9_.]*\]\s*\$/;

/** PowerShell parameter without type annotation: just `$Name` or `$Name = value`. */
const PS_PARAM_SIMPLE_RE = /(?:^|[\s,])\$([A-Za-z][A-Za-z0-9_]*)\s*(?:=|,|\))/;

/** `$ErrorActionPreference = 'Stop'` or `"Stop"`. */
const PS_ERROR_ACTION_RE = /\$ErrorActionPreference\s*=\s*['"]Stop['"]/i;

/* ---- Emitter type ---- */

type ShellEmitter = (
    lineIdx: number,
    rule: string,
    message: string,
    severity: typeof SEVERITY_WARNING | typeof SEVERITY_INFO,
    suggestion: string,
    detail: Record<string, unknown>,
) => void;

/* ---- Analyzer ---- */

/**
 * Shell / PowerShell lint analyzer.
 *
 * Content-only by design: `finalize` is the path the engine actually invokes (a bare
 * `analyze` would be skipped for non-TypeScript files, because only TS-family adapters
 * materialize a `ts.SourceFile`); `analyze` remains the standalone contract.
 *
 * Automatically detects the language family from the file extension or shebang line:
 * - `.sh`, `.bash`, `.zsh` or shebang `#!/bin/bash` etc. → Shell rules
 * - `.ps1`, `.psm1`, `.psd1` → PowerShell rules
 */
export class ShellLintAnalyzer implements Analyzer {
    name = 'shell-lint' as const;

    /**
     * Streaming-path entry point: the engine invokes this once per file. A content-only
     * analyzer must expose it, because the legacy `analyze` path is TypeScript-only.
     *
     * @param ctx - Analyzer context carrying the file content and path.
     * @returns All findings for the file.
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

        return issues;
    }

    private createIssueEmitter(file: string, issues: Issue[]): ShellEmitter {
        return (
            lineIdx: number,
            rule: string,
            message: string,
            severity: typeof SEVERITY_WARNING | typeof SEVERITY_INFO,
            suggestion: string,
            detail: Record<string, unknown>,
        ): void => {
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
            });
        };
    }

    /* =========================================================================
     * Shell rule implementation
     * ========================================================================= */

    private analyzeShell(content: string, file: string, emit: ShellEmitter): void {
        const langId = languageIdFromPath(file) || 'shell';
        const { raw, masked } = maskSourceText(content, this.shellMaskConfig());
        const lines = raw;
        const maskedLines = masked;

        // --- File-level checks ---
        this.checkShebang(lines, file, emit);
        this.checkSetEuoPipefail(lines, maskedLines, emit);

        // --- Line-level checks ---
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (trimmed === '' || trimmed.startsWith('#')) continue;

            // Use masked version for patterns that must not fire inside strings
            const maskedLine = maskedLines[i];
            const maskedTrimmed = maskedLine.trim();

            this.checkDeprecatedSyntax(line, trimmed, maskedTrimmed, i, emit);
            this.checkCdWithoutCheck(trimmed, i, emit);
            this.checkReadWithoutR(trimmed, i, emit);
            this.checkArraySyntax(trimmed, i, emit);
            this.checkEchoVsPrintf(trimmed, i, emit);
            this.checkUnquotedVariables(line, maskedTrimmed, i, emit);
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

    private checkSetEuoPipefail(
        lines: string[],
        maskedLines: string[],
        emit: ShellEmitter,
    ): void {
        // Look for set -euo pipefail in the first 20 non-blank, non-comment lines
        let hasE = false;
        let hasU = false;
        let hasPipefail = false;
        const maxScan = Math.min(lines.length, 30);

        for (let i = 0; i < maxScan; i++) {
            const trimmed = maskedLines[i].trim();
            if (trimmed === '') continue;
            if (SET_E_RE.test(trimmed)) hasE = true;
            if (SET_U_RE.test(trimmed)) hasU = true;
            if (SET_PIPEFAIL_RE.test(trimmed)) hasPipefail = true;
            if (hasE && hasU && hasPipefail) break;
        }

        if (!(hasE && hasU && hasPipefail)) {
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
    }

    private checkDeprecatedSyntax(
        line: string,
        trimmed: string,
        maskedTrimmed: string,
        i: number,
        emit: ShellEmitter,
    ): void {
        // Backtick command substitution: `cmd`
        // Check on the raw line but only when not inside a string (use masked for safety)
        if (BACKTICK_CMD_RE.test(line) && !/^['"]/.test(trimmed)) {
            // Verify the backtick is actually in code (not in a string) by checking masked line
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

        // Deprecated `[` test command
        if (DEPRECATED_TEST_RE.test(trimmed) && !MODERN_TEST_RE.test(trimmed)) {
            // Skip lines that are just `[` in a different context (e.g. array index)
            // Only flag when `[` appears to be a test command (followed by expression with `]`)
            if (/\[[^\]]*\]/.test(trimmed)) {
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

    private checkUnquotedVariables(
        _line: string,
        maskedTrimmed: string,
        i: number,
        emit: ShellEmitter,
    ): void {
        // Conservative detection: only flag when the variable appears in a context
        // where word-splitting would matter (e.g., command arguments, not assignments).
        // Skip lines that are:
        // - assignments (`var=value`)
        // - case patterns
        // - inside `[[ ]]`
        // - inside `(( ))`
        // - `for` loop headers
        // - function definitions

        // Skip assignment lines: `name=...`
        if (/^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(maskedTrimmed)) return;
        // Skip `[[ ... ]]` lines (no word splitting inside)
        if (/\[\[/.test(maskedTrimmed)) return;
        // Skip `(( ... ))` arithmetic lines
        if (/\(\(/.test(maskedTrimmed)) return;
        // Skip `for x in ...` lines (the loop var itself is bare by design)
        if (/^\s*for\s+[A-Za-z_]/.test(maskedTrimmed)) return;
        // Skip `case` patterns
        if (/^\s*case\b/.test(maskedTrimmed)) return;
        // Skip function definitions
        if (/^\s*(?:function\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)/.test(maskedTrimmed)) return;

        // Look for unquoted $var or ${var}
        // We look for $ followed by name or ${name} that is NOT preceded by a quote
        // and NOT inside ${} already (handled by masking strings)
        const matches = maskedTrimmed.match(/(^|[\s;|&(])\$([A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})(?=[\s;|&)\]]|$)/g);
        if (matches && matches.length > 0) {
            // Filter out known-safe usages
            // Skip $? $# $0 $@ $- $$ $! $* (special vars)
            const filtered = matches.filter((m) => {
                const inner = m.match(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/);
                if (!inner) return false;
                const name = inner[1];
                // Skip very common short vars that are rarely problematic
                if (name.length === 1) return false; // $i, $x, etc.
                // Skip $? $# etc (single char special)
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

    /* =========================================================================
     * PowerShell rule implementation
     * ========================================================================= */

    private analyzePowerShell(content: string, _file: string, emit: ShellEmitter): void {
        const langId = 'powershell';
        const { raw, masked } = maskSourceText(content, {
            lineComment: '#',
            blockComment: { open: '<#', close: '#>' },
            quoteChars: '\'"',
        });
        const lines = raw;
        const maskedLines = masked;

        // --- File-level checks ---
        this.checkErrorActionPreference(lines, emit);

        // --- Line-level checks (with multi-line state) ---
        let inFunction = false;
        let functionName = '';
        let functionStartLine = -1;
        let seenCmdletBinding = false;
        let inParamBlock = false;
        let paramBraceDepth = 0;
        let hasUntypedParam = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const maskedTrimmed = maskedLines[i].trim();

            if (trimmed === '' || trimmed.startsWith('#')) continue;

            // Function detection
            const funcMatch = PS_FUNCTION_RE.exec(trimmed);
            if (funcMatch && !inFunction) {
                inFunction = true;
                functionName = funcMatch[1];
                functionStartLine = i;
                seenCmdletBinding = false;
                hasUntypedParam = false;
                // Check approved verb
                this.checkApprovedVerb(functionName, i, emit);
            }

            // Track param block
            if (inFunction && PS_PARAM_BLOCK_RE.test(trimmed)) {
                inParamBlock = true;
                paramBraceDepth = 0;
            }

            // Check for CmdletBinding anywhere inside the function
            if (inFunction && PS_CMDLET_BINDING_RE.test(trimmed)) {
                seenCmdletBinding = true;
            }

            if (inParamBlock) {
                // Count parentheses to track param block end
                for (const ch of trimmed) {
                    if (ch === '(') paramBraceDepth++;
                    else if (ch === ')') paramBraceDepth--;
                }
                // Check parameter types
                if (!PS_PARAM_WITH_TYPE_RE.test(trimmed) && PS_PARAM_SIMPLE_RE.test(trimmed)) {
                    // Make sure it's not just `$` inside a string (masked line check)
                    if (/\$[A-Za-z]/.test(maskedTrimmed)) {
                        hasUntypedParam = true;
                    }
                }
                if (paramBraceDepth <= 0) {
                    inParamBlock = false;
                }
            }

            // Check for end of function (closing brace at top level — heuristic)
            // We approximate: if we see a lone `}` and we're in a function, end it
            if (inFunction && /^\s*\}\s*$/.test(line)) {
                // Emit CmdletBinding finding if missing
                if (!seenCmdletBinding && functionName !== '') {
                    // Only flag for functions that look like advanced functions (have param block or are PascalCase)
                    if (/^[A-Z]/.test(functionName)) {
                        emit(
                            functionStartLine,
                            'PS-CMDLET-001',
                            `Function \`${functionName}\` is missing \`[CmdletBinding()]\` — common parameters (-Verbose, -WhatIf, etc.) will not work.`,
                            SEVERITY_INFO,
                            `Add \`[CmdletBinding()]\` before the \`param()\` block of \`${functionName}\` to enable common parameters and pipeline support.`,
                            { function: functionName },
                        );
                    }
                }
                // Emit parameter type finding if applicable
                if (hasUntypedParam) {
                    emit(
                        functionStartLine,
                        'PS-PARAM-001',
                        `Function \`${functionName}\` has parameters without explicit type annotations.`,
                        SEVERITY_INFO,
                        `Add type annotations (e.g. \`[string]$Name\`) to parameters for self-documentation and input validation.`,
                        { function: functionName },
                    );
                }
                inFunction = false;
                functionName = '';
                functionStartLine = -1;
                hasUntypedParam = false;
            }

            // Alias detection
            this.checkPowerShellAliases(trimmed, maskedTrimmed, i, emit);
        }
    }

    private checkErrorActionPreference(
        lines: string[],
        emit: ShellEmitter,
    ): void {
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
                'Script does not set `$ErrorActionPreference = \'Stop\'` — non-terminating errors will be silently ignored.',
                SEVERITY_INFO,
                'Add `$ErrorActionPreference = \'Stop\'` near the top of the script so non-terminating errors are treated as terminating.',
                {},
            );
        }
    }

    private checkApprovedVerb(functionName: string, i: number, emit: ShellEmitter): void {
        // Extract verb part: everything before the first '-' or the whole name if no '-'
        const dashIdx = functionName.indexOf('-');
        const verb = dashIdx > 0 ? functionName.slice(0, dashIdx) : functionName;
        // Capitalize first letter for comparison
        const verbNormalized = verb.charAt(0).toUpperCase() + verb.slice(1).toLowerCase();

        // Only flag functions that look like cmdlet names (have a dash, or are PascalCase)
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
        // Skip comment lines and empty lines
        if (maskedTrimmed === '') return;

        // Find aliases at the start of statements
        // We look for alias words that appear to be command invocations
        // (at line start, after `|`, `;`, `&`, or `&&` / `||`)
        const aliasMatches = maskedTrimmed.matchAll(
            /(?:^|[\s;|&])([a-z][a-z0-9]*)(?=\s+)/gi,
        );

        for (const match of aliasMatches) {
            const alias = match[1].toLowerCase();
            const canonical = POWERSHELL_ALIASES[alias];
            if (canonical) {
                // Avoid flagging inside string literals — the masked line should have
                // already blanked them, but double-check the position
                emit(
                    i,
                    'PS-ALIAS-001',
                    `Alias \`${alias}\` should be written as \`${canonical}\` for readability.`,
                    SEVERITY_INFO,
                    `Use the full cmdlet name \`${canonical}\` instead of the alias \`${alias}\` — it is more self-documenting and works everywhere.`,
                    { alias, canonical, line: trimmed },
                );
                break; // only report first alias per line to keep noise down
            }
        }
    }
}
