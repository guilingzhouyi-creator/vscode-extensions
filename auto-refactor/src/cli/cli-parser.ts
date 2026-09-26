/**
 * Module: CLI — Command-Line Argument Parser & Usage Formatter
 * File Path: src/cli/cli-parser.ts
 * Architecture Role: Pure CLI flag extraction, boolean toggle mapping, and usage help renderer.
 * Dependencies & Triggers: Imports ScanOptions from ../api, core types; consumed by src/index.ts.
 * Responsibilities: Parse argv flags, resolve boolean switches, validate options, and print usage.
 * Exit Semantics & Design Rationale: Pure parser with no runtime I/O beyond printUsage stdout
 *   write; extracted from src/index.ts to maintain physical line count bounds.
 */

import type { ScanOptions } from '../api';
import type { LogLevel, OutputFormat, CommentLevel, SecurityLevel, Severity } from '../core/types';
import {
    SEVERITY_INFO,
    SEVERITY_WARNING,
    SEVERITY_ERROR,
    LANGUAGE_TYPESCRIPT,
    COMMENT_LEVEL_OFF,
} from '../core/types';

import { parseHumanMetric } from '../core/config/metric-parser';

/** Boolean `--daemon` CLI flag name opting into daemon auto-start. */
export const DAEMON_FLAG = 'daemon';

/** `daemon` subcommand name dispatched to cli/daemonCmd in main(). */
export const DAEMON_SUBCOMMAND = 'daemon';

/** Daemon mode value disabling daemon probing and auto-start (`--no-daemon`). */
export const DAEMON_MODE_OFF = 'off';

/** Security-level value disabling security analysis. */
export const SECURITY_LEVEL_OFF = 'off';

const VAL_TRUE = 'true';
const VAL_FALSE = 'false';
const STR_INCLUDE = 'include';
const STR_EXCLUDE = 'exclude';
const STR_ID = 'id';
const STR_GROUPED = 'grouped';
const STR_JSON = 'json';
const STR_SARIF = 'sarif';
const STR_TEXT = 'text';
const STR_BASIC = 'basic';
const STR_STANDARD = 'standard';
const STR_STRICT = 'strict';
const STR_FULL = 'full';
const STR_OXC = 'oxc';
const MODE_AUTO = 'auto';
const MODE_ON = 'on';

const VALID_SEVERITIES = new Set<string>([SEVERITY_INFO, SEVERITY_WARNING, SEVERITY_ERROR]);
const VALID_FORMATS = new Set<string>([STR_JSON, STR_SARIF, STR_TEXT]);
const VALID_COMMENT_LEVELS = new Set<string>([
    COMMENT_LEVEL_OFF,
    STR_BASIC,
    STR_STANDARD,
    STR_STRICT,
]);
const VALID_SECURITY_LEVELS = new Set<string>([SECURITY_LEVEL_OFF, STR_BASIC, STR_FULL]);

/**
 * Options accepted by the CLI layer, extending scan options with out and cache-clear flags.
 */
export interface CliOptions extends ScanOptions {
    out?: string;
    cacheClear?: boolean;
    effectiveLoc?: number;
    fileLinesWarn?: number;
    fileLinesFail?: number;
}

/**
 * Appends comma-separated values to a list flag on CliOptions.
 */
function applyListFlag(
    opt: CliOptions,
    arg: typeof STR_INCLUDE | typeof STR_EXCLUDE,
    val: string,
): void {
    const items = val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    opt[arg] = opt[arg] ? [...opt[arg], ...items] : items;
}

/**
 * Handles boolean flags mapped directly to properties on CliOptions.
 */
function applyBooleanFlag(opt: CliOptions, arg: string, enabled: boolean): boolean {
    switch (arg) {
        case 'fail-on-issue':
            opt.failOnIssue = enabled;
            return true;
        case 'fail-on-analyzer-error':
            opt.failOnAnalyzerError = enabled;
            return true;
        case 'respect-gitignore':
            opt.respectGitignore = enabled;
            return true;
        case 'cache':
            opt.cache = enabled;
            return true;
        case DAEMON_FLAG:
            opt.daemon = enabled ? MODE_ON : DAEMON_MODE_OFF;
            return true;
        case 'diff':
            opt.diff = enabled;
            return true;
        case 'auto-tune':
            opt.autoTuneScale = enabled;
            return true;
        case 'profile':
            opt.showProfile = enabled;
            return true;
        case 'score':
            opt.showScore = enabled;
            return true;
        case 'memory':
            opt.memory = enabled;
            return true;
        default:
            return false;
    }
}

/**
 * Handles standalone zero-argument flags.
 */
function applyStandaloneFlag(opt: CliOptions, arg: string): boolean {
    switch (arg) {
        case 'no-cache':
            opt.cache = false;
            return true;
        case 'cache-clear':
            opt.cacheClear = true;
            return true;
        case 'cache-custom':
            opt.cacheCustom = true;
            return true;
        case 'no-daemon':
            opt.daemon = DAEMON_MODE_OFF;
            return true;
        case 'no-memory':
            opt.memory = false;
            return true;
        case 'baseline-ratchet-down':
            opt.baselineRatchetDown = true;
            return true;
        case 'force-baseline-expand':
            opt.forceBaselineExpand = true;
            return true;
        case 'help':
        case 'h':
            printUsage();
            process.exit(0);
            return true;
        default:
            return false;
    }
}

/**
 * Handles string list and path value flags.
 */
function applyGeneralValueFlag(opt: CliOptions, arg: string, val: string): boolean {
    switch (arg) {
        case STR_INCLUDE:
            applyListFlag(opt, STR_INCLUDE, val);
            return true;
        case STR_EXCLUDE:
            applyListFlag(opt, STR_EXCLUDE, val);
            return true;
        case 'analyzers':
            opt.analyzers = val
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            return true;
        case 'out':
        case 'output':
            opt.out = val;
            return true;
        case 'root':
            opt.root = val;
            return true;
        case 'config':
            opt.configFile = val;
            return true;
        case 'baseline':
            opt.baseline = val;
            return true;
        case 'update-baseline':
            opt.updateBaseline = val;
            return true;
        case 'cache-dir':
            opt.cacheDir = val;
            return true;
        case 'agent-uid':
            opt.agentUid = val;
            return true;
        case 'telemetry':
            opt.telemetry = val;
            return true;
        case 'log-file':
            opt.logFile = val;
            return true;
        default:
            return false;
    }
}

/**
 * Handles numeric and parser/log-level CLI options.
 */
function applyNumericOrPathFlag(opt: CliOptions, arg: string, val: string): boolean {
    switch (arg) {
        case 'concurrency':
            opt.concurrency = Number(val);
            return true;
        case 'workers':
            opt.workers = Number(val);
            return true;
        case 'parser':
            opt.parser = val === STR_OXC ? STR_OXC : LANGUAGE_TYPESCRIPT;
            return true;
        case 'log-level':
            opt.logLevel = val as LogLevel;
            return true;
        case 'effective-loc':
        case 'max-sloc':
            opt.effectiveLoc = parseHumanMetric(val);
            return true;
        case 'file-lines-warn':
            opt.fileLinesWarn = parseHumanMetric(val);
            return true;
        case 'file-lines-fail':
            opt.fileLinesFail = parseHumanMetric(val);
            return true;
        default:
            return false;
    }
}

/**
 * Handles audit level CLI options.
 */
function applyAuditLevelFlag(opt: CliOptions, arg: string, val: string): boolean {
    switch (arg) {
        case 'comment-level':
            if (VALID_COMMENT_LEVELS.has(val)) opt.commentLevel = val as CommentLevel;
            return true;
        case 'security-level':
            if (VALID_SECURITY_LEVELS.has(val)) opt.securityLevel = val as SecurityLevel;
            return true;
        default:
            return false;
    }
}

/**
 * Handles format and severity/baseline enum CLI options.
 */
function applyEnumFlag(opt: CliOptions, arg: string, val: string): boolean {
    switch (arg) {
        case 'fail-on-severity':
            if (VALID_SEVERITIES.has(val)) opt.failOnSeverity = val as Severity;
            return true;
        case 'baseline-granularity':
            if (val === STR_ID || val === STR_GROUPED) opt.baselineGranularity = val;
            return true;
        case 'format':
            if (VALID_FORMATS.has(val)) opt.format = val as OutputFormat;
            return true;
        default:
            return false;
    }
}

/**
 * Dispatches a value flag to either general, numeric, audit or enum flag handlers.
 */
function applyValueFlag(opt: CliOptions, arg: string, val: string): void {
    if (applyGeneralValueFlag(opt, arg, val)) return;
    if (applyNumericOrPathFlag(opt, arg, val)) return;
    if (applyAuditLevelFlag(opt, arg, val)) return;
    applyEnumFlag(opt, arg, val);
}

/**
 * Resolves boolean flag value considering inline '=false' and explicit next token.
 */
function resolveBooleanFlagValue(
    hasInline: boolean,
    value: string,
    nextToken: string | undefined,
): { enabled: boolean; consumedNext: boolean } {
    if (hasInline) {
        return { enabled: value !== VAL_FALSE, consumedNext: false };
    }
    if (nextToken === VAL_TRUE || nextToken === VAL_FALSE) {
        return { enabled: nextToken !== VAL_FALSE, consumedNext: true };
    }
    return { enabled: true, consumedNext: false };
}

/**
 * Minimal argv parser: supports `--key value`, `--key=value`, and repeated `--include`.
 *
 * @param argv - Command line argument tokens.
 * @returns Fully populated CLI options object.
 */
export function parseArgs(argv: string[]): CliOptions {
    const opt: CliOptions = { cache: true, daemon: MODE_AUTO };

    for (let i = 0; i < argv.length; i++) {
        let arg = argv[i];
        if (!arg.startsWith('--')) continue;
        arg = arg.slice(2);

        let value = '';
        let hasInline = false;
        if (arg.includes('=')) {
            [arg, value] = arg.split('=', 2);
            hasInline = true;
        }

        if (applyBooleanFlag(opt, arg, true)) {
            // Re-evaluate with proper truth value
            const { enabled, consumedNext } = resolveBooleanFlagValue(
                hasInline,
                value,
                argv[i + 1],
            );
            if (consumedNext) i++;
            applyBooleanFlag(opt, arg, enabled);
            continue;
        }

        if (applyStandaloneFlag(opt, arg)) {
            continue;
        }

        const takeValue = (): string => {
            if (hasInline) return value;
            const nxt = argv[i + 1];
            if (nxt === undefined || nxt.startsWith('--')) return '';
            i++;
            return nxt;
        };

        applyValueFlag(opt, arg, takeValue());
    }
    return opt;
}

/** Print the CLI usage banner and available flags to stdout. */
export function printUsage(): void {
    process.stdout
        .write(`auto-refactor — automated code-refactoring analyzer (declarative, pluggable)

Usage:
  auto-refactor scan [options]
  auto-refactor self-test            Run a known-violation fixture corpus and assert every
                                     built-in analyzer still fires (engine quality guard)
  auto-refactor daemon start|stop|status [--root <dir>]

Options:
  --root <dir>                 Root directory to scan (default: cwd)
  --include <glob>            Include glob (repeatable / comma-separated)
  --exclude <glob|dir>        Exclude glob or directory name (repeatable)
  --analyzers <a,b,c>         Allow-list by name (built-in or custom). Declared but
                              unlisted analyzers are disabled for this run.
  --format <json|sarif|text>  Output format (default: text)
  --out <file>                Write report to a file instead of stdout
  --fail-on-issue             Exit non-zero if any 'error' issue (CI gate)
  --fail-on-severity <lvl>    Exit non-zero if any issue >= lvl (info|warning|error); with a
                              baseline, applies to NEW issues only (generalizes --fail-on-issue)
  --baseline-granularity <g>  Baseline ratchet comparison: id (exact issue id) | grouped
                              (analyzer|rule|file counts — tolerant to line shifts)
  --fail-on-analyzer-error    Treat analyzer crashes as 'error' (can fail CI)
  --config <file>             Path to auto-refactor.config.json (declarative registry)
  --log-level <lvl>           silent|error|warn|info|debug (default: info; stderr)
  --log-file <file>           Also append logs to this file
  --concurrency <n>           Max files analyzed in parallel (single-process mode; default: min(4, cpus))
  --workers <n>               Worker threads for parse+analyze (0=auto default: scales with file count, 1=in-process, N=threads)
  --parser <typescript|oxc>   TS/JS-family parser: typescript (default) or oxc (Rust oxc-parser, byte-equivalent output)
  --respect-gitignore         Honor a root .gitignore when discovering files (default: on)
  --no-respect-gitignore      Ignore .gitignore and only apply --exclude
  --cache / --no-cache        Two-level incremental cache (default: on for CLI; validate/benchmark use --no-cache)
  --cache-dir <dir>           Cache directory (default: <root>/.auto-refactor-cache)
  --cache-clear               Delete the project cache directory before scanning
  --cache-custom              Enable L2 caching even with custom analyzers (hashes module content)
  --daemon                    Auto-start the daemon if missing, then warm-scan (watch/CI warm-up)
  --no-daemon                 Never connect to the daemon (pure cold scan)
  --comment-level <level>      Leveled comment audit: off | basic | standard | strict (default: standard)
  --security-level <level>     Leveled security audit: off | basic | full (default: basic)
  --effective-loc <size>      Effective Code Lines (ECL) budget (e.g. 800, 1k, 2.5k, 50k; default: 800)
  --file-lines-warn <size>    Physical line warning threshold (supports 800, 1k, 2k, etc.)
  --auto-tune                 Enable scale-adaptive dynamic threshold and option tuning
  --profile                   Display auto-detected project stack profile and partition details
  --score                     Output multi-dimensional quality assessment and Tri-Plane vectors
  --telemetry <file>          Ingest dynamic runtime telemetry profile (DynamicEvidenceDTO JSON)
  --help, -h                  Show this help
`);
}
