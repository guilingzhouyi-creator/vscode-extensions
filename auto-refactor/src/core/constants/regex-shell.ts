/**
 * Module: Core Constants — Shell & Command Surface Regular Expression Catalog
 * File Path: src/core/constants/regex-shell.ts
 * Architecture Role: Single source of truth (SSOT) for shell, terminal commands, PowerShell
 *     syntaxes, POSIX pipelines, and destructive taint analysis regular expressions.
 * Dependencies & Triggers: Zero external dependencies; consumed by shell-safety and gate analyzers.
 * Responsibilities:
 *     1. Centralize canonical shell patterns (pipes, env vars, destructive deletes, provenance).
 *     2. Enforce the state-separation discipline: stateless immutable constants vs fresh factories.
 *     3. Expose frozen REGEX_SHELL domain namespace.
 * Exit Semantics & Design Rationale: Pure, frozen regex constants and deterministic factories;
 *     zero side effects and strictly immune to ReDoS back-tracking traps.
 */

/** Matches unescaped shell pipe operator (| but not || or |&). */
export const SHELL_PIPE_PATTERN = /\|(?![|&])/;

/** Matches shell variable substitution ($VAR or ${VAR}). */
export const SHELL_ENV_VAR_PATTERN = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/;

/** Matches shell command substitution ($(cmd) or `cmd`). */
export const SHELL_COMMAND_SUBST_PATTERN = /\$\([^)]+\)|`[^`]+`/;

/** Matches dangerous recursive rm deletion commands. */
export const DANGEROUS_RM_RECURSIVE_PATTERN = /\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f?|--recursive)\s+/i;

/** Matches dangerous redirection overwriting system root directories. */
export const DANGEROUS_WRITE_ROOT_PATTERN = />\s*\/(?:bin|boot|dev|etc|lib|proc|root|sys|usr)\b/;

/** Matches shell script shebang line. */
export const SHEBANG_PATTERN = /^#!\s*\/.*(?:bash|sh|zsh|ksh|env\s+\w*sh)\b/;

/** Matches shell set errexit option flag (-e or -o errexit). */
export const SET_ERREXIT_PATTERN = /\bset\s+(-[a-zA-Z]*e[a-zA-Z]*|-o\s+errexit)\b/;

/** Matches shell set nounset option flag (-u or -o nounset). */
export const SET_NOUNSET_PATTERN = /\bset\s+(-[a-zA-Z]*u[a-zA-Z]*|-o\s+nounset)\b/;

/** Matches shell set pipefail option flag (-o pipefail). */
export const SET_PIPEFAIL_PATTERN = /\bset\s+(-o\s+pipefail|-[a-zA-Z]*o[a-zA-Z]*\s+pipefail)\b/;

/** Matches PowerShell [CmdletBinding()] attribute. */
export const PS_CMDLET_BINDING_PATTERN = /\[CmdletBinding\s*\(\s*\)\]/;

/** Matches PowerShell param() block start. */
export const PS_PARAM_BLOCK_PATTERN = /^\s*param\s*\(/i;

/** Matches PowerShell ErrorActionPreference assignment to Stop. */
export const PS_ERROR_ACTION_PATTERN = /\$ErrorActionPreference\s*=\s*['"]Stop['"]/i;

/** Matches dynamic Invoke-Expression or iex call with variable input. */
export const PS_IEX_DYNAMIC_PATTERN = /\b(?:Invoke-Expression|iex)\s+["']?\$[A-Za-z_{]/i;

/** Matches dynamic eval call with variable input in shell scripts. */
export const SH_EVAL_DYNAMIC_PATTERN = /\beval\s+["']?\$[A-Za-z_{]/;

/** Matches legacy backtick command substitution. */
export const BACKTICK_CMD_PATTERN = /`[^`]+`/;

/** Matches legacy single-bracket shell test construct [ ... ]. */
export const DEPRECATED_TEST_PATTERN = /(?:^|[\s;|&(])\[[!\s\w]/;

/** Matches modern double-bracket shell test construct [[ ... ]]. */
export const MODERN_TEST_PATTERN = /\[\[/;

/** Matches cd command executed without explicit error check. */
export const CD_WITHOUT_CHECK_PATTERN = /^\s*(?:cd\s+[^\s;|&]+)(?!.*(?:\|\||&&))/;

/** Matches read command invocation in shell script. */
export const READ_CMD_PATTERN = /^\s*read\b/;

/** Matches -r flag in read command. */
export const READ_HAS_R_PATTERN = /\s-r\b/;

/** Matches fragile $* parameter expansion. */
export const DOLLAR_STAR_PATTERN = /(?:^|[\s;|&(=])\$\*(?:[\s;|&)]|$)/;

/** Matches echo command with non-portable flags (-e, -n, -en, -ne). */
export const ECHO_FLAG_PATTERN = /^\s*echo\s+-(?:e|n|en|ne)\b/;

/** Matches trap registration on EXIT, 0, INT, or TERM. */
export const SHELL_TRAP_EXIT_PATTERN = /\btrap\b.*?\b(?:EXIT|0|INT|TERM)\b/;

/** Matches mktemp creation or temporary file redirection. */
export const SHELL_MKTEMP_PATTERN = /\b(?:mktemp\b|>\s*.*?\.(?:tmp|lock)\b)/;

/** Matches interactive read without timeout (-t) flag. */
export const SH_READ_INTERACTIVE_PATTERN = /^\s*read\s+(?!-t\b)/;

/** Matches shell terminal / TTY guard check ([ -t 0 ] or [[ -t 0 ]]). */
export const SH_TTY_GUARD_PATTERN = /\[\[?\s+-t\s+0\s*\]\]?/;

/** Matches predicate commands expected to return non-zero exit codes. */
export const SH_PREDICATE_COMMANDS_PATTERN =
    /^\s*(?:git\s+diff(?:-index)?\s+--quiet|grep\s+-[a-zA-Z]*q|diff\s+-q|cmp\s+-s)\b/;

/** Matches shell exit status guards (||, &&, STATUS=, if, while). */
export const SH_EXIT_GUARD_PATTERN = /(?:\|\||&&|;\s*STATUS=|\bif\b|\bwhile\b)/;

/** Matches shell script module documentation contract header. */
export const SHELL_DOC_HEADER_PATTERN =
    /(?:#\s*(?:Module|Description|Purpose|Architecture Role|Responsibilities|Usage|模块归属|职责说明|架构定位|用法示例|退出语义):)/i;

/** Matches PowerShell function declaration. */
export const PS_FUNCTION_PATTERN = /^\s*function\s+([A-Za-z][A-Za-z0-9_-]*)\s*(?:\(\))?\s*\{?/;

/** Matches typed parameter declaration in PowerShell. */
export const PS_PARAM_WITH_TYPE_PATTERN = /\[[A-Za-z][A-Za-z0-9_.]*(?:\[\s*\])?\]\s*\$/;

/** Matches simple untyped parameter declaration in PowerShell. */
export const PS_PARAM_SIMPLE_PATTERN = /(?:^|[\s,])\$([A-Za-z][A-Za-z0-9_]*)\s*(?:=|,|\))/;

/** Matches critical system handle creation in PowerShell (FileStream, Mutex). */
export const PS_RESOURCE_DISPOSAL_PATTERN =
    /(?:\[System\.IO\.FileStream\]|\[System\.Threading\.Mutex\]|New-Object\s+System\.IO\.FileStream)/i;

/** Matches PowerShell finally block header. */
export const PS_FINALLY_PATTERN = /\bfinally\s*\{/i;

/** Matches interactive input cmdlets in PowerShell (Read-Host, pause, ReadLine). */
export const PS_INTERACTIVE_PATTERN = /\b(?:Read-Host|pause)\b|\$host\.UI\.ReadLine\s*\(/i;

/** Matches non-interactive terminal guard in PowerShell. */
export const PS_INTERACTIVE_GUARD_PATTERN =
    /\[Environment\]::UserInteractive\s+-and\s+-not\s+\[Console\]::IsOutputRedirected/i;

/** Matches non-interactive override flags in PowerShell (-Force, -NonInteractive, -Batch, etc.). */
export const PS_NON_INTERACTIVE_FLAG_PATTERN = /-(?:Force|NonInteractive|Batch|Silent|Quiet)\b/i;

/** Matches PowerShell standard documentation comment or help header. */
export const PS_DOC_HEADER_PATTERN =
    /(?:\.(?:SYNOPSIS|DESCRIPTION)|\b(?:Module|Description|Purpose):|<#|#\s*(?:模块归属|职责说明|架构定位|用法示例|退出语义):)/i;

/** Creates a fresh global scanner for PowerShell variable assignment detection. */
export function createPsAssignScanner(): RegExp {
    return /\$([A-Za-z_][A-Za-z0-9_]*)\s*(?:=[^=]|\+=|-=|\*=)/g;
}

/** Creates a fresh global scanner for PowerShell foreach statement variable extraction. */
export function createPsForeachScanner(): RegExp {
    return /foreach\s*\(\s*\$([A-Za-z_][A-Za-z0-9_]*)\s+in\b/gi;
}

/** Creates a fresh global scanner for PowerShell type-casted variable assignment detection. */
export function createPsCastAssignScanner(): RegExp {
    return /\[[A-Za-z_][A-Za-z0-9_.[\]]*\]\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
}

/** Creates a fresh global scanner for PowerShell multi-variable assignment detection. */
export function createPsMultiAssignScanner(): RegExp {
    return /\$([A-Za-z_][A-Za-z0-9_]*)\s*,[^=\r\n]*=/g;
}

/** Matches PowerShell delete cmdlets and their common aliases. */
export const PS_DELETE_PATTERN = /\b(?:Remove-Item|rm|del|erase|rd|rmdir)\b/i;

/** Matches POSIX shell delete command. */
export const SH_DELETE_PATTERN = /\brm\b/;

/** Matches Node.js/Python recursive delete methods that require no recursive flag. */
export const NODE_INHERENTLY_RECURSIVE_DELETE_PATTERN =
    /\b(?:rmSync|rimraf|removeSync)\s*\(|\bfs\s*\.\s*rm\s*\(|\bshutil\s*\.\s*rmtree\s*\(/;

/** Matches JavaScript inherently recursive delete identifiers. */
export const JS_INHERENTLY_RECURSIVE_PATTERN = /\brimraf\b|\bremoveSync\b|\brmtree\b/;

/** Matches PowerShell recursion flag in arguments. */
export const PS_RECURSIVE_FLAG_PATTERN = /-Recurse|\s-[a-zA-Z]*[rR]\b/;

/** Matches POSIX recursion flag, short or long form. */
export const SH_RECURSIVE_FLAG_PATTERN = /(?:^|\s)(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/;

/** Matches JavaScript recursive: true in options. */
export const JS_RECURSIVE_PROP_PATTERN = /\brecursive\s*:\s*true\b/;

/** Matches non-statement prefix characters in script lines. */
export const NON_STATEMENT_PREFIX_PATTERN = /^(?:#|\/\/|\*|["'`]|\[["'`])/;

/** Matches variable assignment carrying taint provenance. */
export const TAINT_ASSIGN_PATTERN =
    /(?:^|[\s(,])(?:const|let|var)?\s*\$?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\r\n]*)$/;

/** Matches PowerShell foreach statement variable extraction. */
export const TAINT_PS_LOOP_PATTERN = /foreach\s*\(\s*\$([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^)]*)/i;

/** Matches POSIX for loop statement variable extraction. */
export const TAINT_SH_LOOP_PATTERN = /\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;\r\n]*)/;

/** Matches JavaScript for..of loop statement variable extraction. */
export const TAINT_JS_LOOP_PATTERN =
    /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s+of\s+([^)]*)\)/;

/** Matches JavaScript forEach callback variable extraction. */
export const TAINT_JS_EACH_PATTERN = /\.\s*forEach\s*\(\s*\(?\s*([A-Za-z_][A-Za-z0-9_]*)/;

/** Root directory dangerous operand: dot `.`. */
export const ROOT_DIR_DOT_PATTERN = /^\.$/;

/** Root directory dangerous operand: dot-dot `..`. */
export const ROOT_DIR_DOTDOT_PATTERN = /^\.\.$/;

/** Root directory dangerous operand: `/` or `\`. */
export const ROOT_DIR_SLASH_PATTERN = /^[/\\]$/;

/** Root directory dangerous operand: drive root like `C:`, `C:\`. */
export const ROOT_DIR_DRIVE_PATTERN = /^[A-Za-z]:[/\\]?$/;

/** Root directory dangerous operand: tilde `~` or `~/`. */
export const ROOT_DIR_TILDE_PATTERN = /^~[/\\]?$/;

/** Root directory dangerous operand: `$HOME`. */
export const ROOT_DIR_HOME_VAR_PATTERN = /^\$HOME$/i;

/** Root directory dangerous operand: `${HOME}`. */
export const ROOT_DIR_HOME_BRACE_PATTERN = /^\$\{HOME\}$/i;

/** Root directory dangerous operand: `$PSHOME`. */
export const ROOT_DIR_PSHOME_PATTERN = /^\$PSHOME$/i;

/** Root directory dangerous operand: `$PROFILE`. */
export const ROOT_DIR_PROFILE_PATTERN = /^\$PROFILE$/i;

/** Root directory dangerous operand: `$env:USERPROFILE` etc. */
export const ROOT_DIR_ENV_USERPROFILE_PATTERN =
    /^\$env:(?:USERPROFILE|HOMEPATH|HOME|SYSTEMDRIVE|SYSTEMROOT|WINDIR|PROGRAMFILES)$/i;

/** Root directory dangerous operand: `${env:USERPROFILE}` etc. */
export const ROOT_DIR_ENV_BRACE_PATTERN =
    /^\$\{env:(?:USERPROFILE|HOMEPATH|HOME|SYSTEMDRIVE|SYSTEMROOT|WINDIR|PROGRAMFILES)\}$/i;

/** Root directory dangerous operand: `%USERPROFILE%` etc. */
export const ROOT_DIR_WIN_VAR_PATTERN =
    /^%(?:USERPROFILE|HOMEPATH|HOMEDRIVE|SYSTEMDRIVE|SYSTEMROOT|WINDIR)%$/i;

/** Root directory dangerous operand: POSIX system paths `/etc`, `/usr` etc. */
export const ROOT_DIR_SYSTEM_PATH_PATTERN =
    /^\/(?:home|users|root|etc|usr|var|bin|sbin|lib|opt|boot|dev|proc|sys)(?:\/[^/]*)?$/i;

/** Provenance pattern: `$HOME\b`. */
export const PROVENANCE_HOME_VAR_PATTERN = /\$HOME\b/i;

/** Provenance pattern: `${HOME}`. */
export const PROVENANCE_HOME_BRACE_PATTERN = /\$\{HOME\}/i;

/** Provenance pattern: `$PSHOME\b`. */
export const PROVENANCE_PSHOME_PATTERN = /\$PSHOME\b/i;

/** Provenance pattern: `$PROFILE\b`. */
export const PROVENANCE_PROFILE_PATTERN = /\$PROFILE\b/i;

/** Provenance pattern: `$env:USERPROFILE` etc. */
export const PROVENANCE_ENV_USERPROFILE_PATTERN =
    /\$env:(?:USERPROFILE|HOMEPATH|HOME|SYSTEMDRIVE|SYSTEMROOT|WINDIR)\b/i;

/** Provenance pattern: `${env:USERPROFILE}` etc. */
export const PROVENANCE_ENV_BRACE_PATTERN =
    /\$\{env:(?:USERPROFILE|HOMEPATH|HOME|SYSTEMDRIVE|SYSTEMROOT|WINDIR)\}/i;

/** Provenance pattern: `%USERPROFILE%` etc. */
export const PROVENANCE_WIN_VAR_PATTERN =
    /%(?:USERPROFILE|HOMEPATH|HOMEDRIVE|SYSTEMDRIVE|SYSTEMROOT|WINDIR)%/i;

/** Provenance pattern: `os.homedir()`. */
export const PROVENANCE_OS_HOMEDIR_PATTERN = /\bos\s*\.\s*homedir\s*\(/;

/** Provenance pattern: `process.env.HOME` etc. */
export const PROVENANCE_PROCESS_ENV_DOT_PATTERN =
    /\bprocess\s*\.\s*env\s*\.\s*(?:USERPROFILE|HOMEPATH|HOME|SystemDrive|SystemRoot|windir)\b/;

/** Provenance pattern: `process.env['HOME']` etc. */
export const PROVENANCE_PROCESS_ENV_INDEX_PATTERN =
    /\bprocess\s*\.\s*env\s*\[\s*['"](?:USERPROFILE|HOMEPATH|HOME|SystemDrive|SystemRoot|windir)['"]\s*\]/;

/** Matches POSIX shell variable assignment statement line. */
export const SHELL_ASSIGN_STATEMENT_PATTERN = /^\s*[A-Za-z_][A-Za-z0-9_]*=/;

/** Matches POSIX shell for loop statement line. */
export const SHELL_FOR_STATEMENT_PATTERN = /^\s*for\s+[A-Za-z_]/;

/** Matches POSIX shell case statement line. */
export const SHELL_CASE_STATEMENT_PATTERN = /^\s*case\b/;

/** Matches POSIX shell function definition line. */
export const SHELL_FUNCTION_DEF_PATTERN = /^\s*(?:function\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)/;

/** Matches single bracket test expression containing content. */
export const SH_SINGLE_BRACKET_TEST_PATTERN = /\[\s+.+\s+\]/;

/** Matches single-bracket test condition payload and closing delimiter. */
export const SH_BRACKET_TEST_COND_PATTERN = /\[\s+(.+)\s+\](?:\s*;|\s+then|\s*$)/;

/** Matches while loop with read command. */
export const SH_WHILE_READ_PATTERN = /^\s*while\b.*?\bread\b/;

/** Matches heredoc or file input redirection operators. */
export const SH_HEREDOC_OR_INPUT_PATTERN = /<<<|<<|<[a-zA-Z0-9_\/"'$]/;

/** Matches read timeout option flag (-t). */
export const SH_READ_TIMEOUT_PATTERN = /\s-t\s+\d+/;

/** Matches double parenthesis arithmetic evaluation construct (( ... )). */
export const SH_DOUBLE_PAREN_TEST_PATTERN = /\(\(/;

/** Matches PowerShell or Bash foreach loop construct. */
export const SHELL_FOREACH_STATEMENT_PATTERN = /(?:^|[\s;{}])foreach\s*\(/i;

/** Matches start of heredoc redirection with delimiter capture. */
export const SHELL_HEREDOC_START_PATTERN = /(?:^|[^<])<<-?\s*['"]?([A-Za-z0-9_]+)['"]?/;

/** Creates a fresh global scanner for taint identifier token extraction. */
export function createTaintIdentifierScanner(): RegExp {
    return /\$?([A-Za-z_][A-Za-z0-9_]*)/g;
}

/** Creates a fresh global scanner for extracting shell environment variables. */
export function createShellEnvVarScanner(): RegExp {
    return /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;
}

/** Frozen domain namespace aggregating Bash, POSIX shell, and PowerShell audit patterns. */
export const REGEX_SHELL = Object.freeze({
    PIPE: SHELL_PIPE_PATTERN,
    ENV_VAR: SHELL_ENV_VAR_PATTERN,
    COMMAND_SUBST: SHELL_COMMAND_SUBST_PATTERN,
    DANGEROUS_RM_RECURSIVE: DANGEROUS_RM_RECURSIVE_PATTERN,
    DANGEROUS_WRITE_ROOT: DANGEROUS_WRITE_ROOT_PATTERN,
    SHEBANG: SHEBANG_PATTERN,
    SET_ERREXIT: SET_ERREXIT_PATTERN,
    SET_NOUNSET: SET_NOUNSET_PATTERN,
    SET_PIPEFAIL: SET_PIPEFAIL_PATTERN,
    PS_CMDLET_BINDING: PS_CMDLET_BINDING_PATTERN,
    PS_PARAM_BLOCK: PS_PARAM_BLOCK_PATTERN,
    PS_ERROR_ACTION: PS_ERROR_ACTION_PATTERN,
    PS_IEX_DYNAMIC: PS_IEX_DYNAMIC_PATTERN,
    SH_EVAL_DYNAMIC: SH_EVAL_DYNAMIC_PATTERN,
    BACKTICK_CMD: BACKTICK_CMD_PATTERN,
    DEPRECATED_TEST: DEPRECATED_TEST_PATTERN,
    MODERN_TEST: MODERN_TEST_PATTERN,
    ASSIGN_STATEMENT: SHELL_ASSIGN_STATEMENT_PATTERN,
    FOR_STATEMENT: SHELL_FOR_STATEMENT_PATTERN,
    CASE_STATEMENT: SHELL_CASE_STATEMENT_PATTERN,
    FUNCTION_DEF: SHELL_FUNCTION_DEF_PATTERN,
    SINGLE_BRACKET_TEST: SH_SINGLE_BRACKET_TEST_PATTERN,
    BRACKET_TEST_COND: SH_BRACKET_TEST_COND_PATTERN,
    WHILE_READ: SH_WHILE_READ_PATTERN,
    HEREDOC_OR_INPUT: SH_HEREDOC_OR_INPUT_PATTERN,
    HEREDOC_START: SHELL_HEREDOC_START_PATTERN,
    FOREACH_STATEMENT: SHELL_FOREACH_STATEMENT_PATTERN,
    READ_TIMEOUT: SH_READ_TIMEOUT_PATTERN,
    DOUBLE_PAREN_TEST: SH_DOUBLE_PAREN_TEST_PATTERN,
    CD_WITHOUT_CHECK: CD_WITHOUT_CHECK_PATTERN,
    READ_CMD: READ_CMD_PATTERN,
    READ_HAS_R: READ_HAS_R_PATTERN,
    DOLLAR_STAR: DOLLAR_STAR_PATTERN,
    ECHO_FLAG: ECHO_FLAG_PATTERN,
    SHELL_TRAP_EXIT: SHELL_TRAP_EXIT_PATTERN,
    SHELL_MKTEMP: SHELL_MKTEMP_PATTERN,
    SH_READ_INTERACTIVE: SH_READ_INTERACTIVE_PATTERN,
    SH_TTY_GUARD: SH_TTY_GUARD_PATTERN,
    SH_PREDICATE_COMMANDS: SH_PREDICATE_COMMANDS_PATTERN,
    SH_EXIT_GUARD: SH_EXIT_GUARD_PATTERN,
    SHELL_DOC_HEADER: SHELL_DOC_HEADER_PATTERN,
    PS_FUNCTION: PS_FUNCTION_PATTERN,
    PS_PARAM_WITH_TYPE: PS_PARAM_WITH_TYPE_PATTERN,
    PS_PARAM_SIMPLE: PS_PARAM_SIMPLE_PATTERN,
    PS_RESOURCE_DISPOSAL: PS_RESOURCE_DISPOSAL_PATTERN,
    PS_FINALLY: PS_FINALLY_PATTERN,
    PS_INTERACTIVE: PS_INTERACTIVE_PATTERN,
    PS_INTERACTIVE_GUARD: PS_INTERACTIVE_GUARD_PATTERN,
    PS_NON_INTERACTIVE_FLAG: PS_NON_INTERACTIVE_FLAG_PATTERN,
    PS_DOC_HEADER: PS_DOC_HEADER_PATTERN,
    PS_DELETE: PS_DELETE_PATTERN,
    SH_DELETE: SH_DELETE_PATTERN,
    NODE_INHERENTLY_RECURSIVE_DELETE: NODE_INHERENTLY_RECURSIVE_DELETE_PATTERN,
    JS_INHERENTLY_RECURSIVE: JS_INHERENTLY_RECURSIVE_PATTERN,
    PS_RECURSIVE_FLAG: PS_RECURSIVE_FLAG_PATTERN,
    SH_RECURSIVE_FLAG: SH_RECURSIVE_FLAG_PATTERN,
    JS_RECURSIVE_PROP: JS_RECURSIVE_PROP_PATTERN,
    NON_STATEMENT_PREFIX: NON_STATEMENT_PREFIX_PATTERN,
    TAINT_ASSIGN: TAINT_ASSIGN_PATTERN,
    TAINT_PS_LOOP: TAINT_PS_LOOP_PATTERN,
    TAINT_SH_LOOP: TAINT_SH_LOOP_PATTERN,
    TAINT_JS_LOOP: TAINT_JS_LOOP_PATTERN,
    TAINT_JS_EACH: TAINT_JS_EACH_PATTERN,
    ROOT_DIR_DOT: ROOT_DIR_DOT_PATTERN,
    ROOT_DIR_DOTDOT: ROOT_DIR_DOTDOT_PATTERN,
    ROOT_DIR_SLASH: ROOT_DIR_SLASH_PATTERN,
    ROOT_DIR_DRIVE: ROOT_DIR_DRIVE_PATTERN,
    ROOT_DIR_TILDE: ROOT_DIR_TILDE_PATTERN,
    ROOT_DIR_HOME_VAR: ROOT_DIR_HOME_VAR_PATTERN,
    ROOT_DIR_HOME_BRACE: ROOT_DIR_HOME_BRACE_PATTERN,
    ROOT_DIR_PSHOME: ROOT_DIR_PSHOME_PATTERN,
    ROOT_DIR_PROFILE: ROOT_DIR_PROFILE_PATTERN,
    ROOT_DIR_ENV_USERPROFILE: ROOT_DIR_ENV_USERPROFILE_PATTERN,
    ROOT_DIR_ENV_BRACE: ROOT_DIR_ENV_BRACE_PATTERN,
    ROOT_DIR_WIN_VAR: ROOT_DIR_WIN_VAR_PATTERN,
    ROOT_DIR_SYSTEM_PATH: ROOT_DIR_SYSTEM_PATH_PATTERN,
    PROVENANCE_HOME_VAR: PROVENANCE_HOME_VAR_PATTERN,
    PROVENANCE_HOME_BRACE: PROVENANCE_HOME_BRACE_PATTERN,
    PROVENANCE_PSHOME: PROVENANCE_PSHOME_PATTERN,
    PROVENANCE_PROFILE: PROVENANCE_PROFILE_PATTERN,
    PROVENANCE_ENV_USERPROFILE: PROVENANCE_ENV_USERPROFILE_PATTERN,
    PROVENANCE_ENV_BRACE: PROVENANCE_ENV_BRACE_PATTERN,
    PROVENANCE_WIN_VAR: PROVENANCE_WIN_VAR_PATTERN,
    PROVENANCE_OS_HOMEDIR: PROVENANCE_OS_HOMEDIR_PATTERN,
    PROVENANCE_PROCESS_ENV_DOT: PROVENANCE_PROCESS_ENV_DOT_PATTERN,
    PROVENANCE_PROCESS_ENV_INDEX: PROVENANCE_PROCESS_ENV_INDEX_PATTERN,
    createPsAssignScanner,
    createPsForeachScanner,
    createPsCastAssignScanner,
    createPsMultiAssignScanner,
    createShellEnvVarScanner,
    createTaintIdentifierScanner,
});
