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
import type {
    LogLevel,
    OutputFormat,
    CommentLevel,
    SecurityLevel,
    Severity,
    QualityReviewProfile,
} from '../core/types';
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
const VALID_FORMATS = new Set<string>([STR_JSON, STR_SARIF, STR_TEXT, 'agent', 'capp', 'praxis']);
const VALID_COMMENT_LEVELS = new Set<string>([
    COMMENT_LEVEL_OFF,
    STR_BASIC,
    STR_STANDARD,
    STR_STRICT,
]);
const VALID_SECURITY_LEVELS = new Set<string>([SECURITY_LEVEL_OFF, STR_BASIC, STR_FULL]);
const VALID_PROFILES = new Set<string>(['frontend', 'backend', 'composite']);

/**
 * Options accepted by the CLI layer, extending scan options with out and cache-clear flags.
 */
export interface CliOptions extends ScanOptions {
    reviewProfile?: QualityReviewProfile;
    out?: string;
    cacheClear?: boolean;
    effectiveLoc?: number;
    fileLinesWarn?: number;
    fileLinesFail?: number;
    fix?: boolean;
    fixDryRun?: boolean;
    fixRules?: string[];
    recordTrajectory?: boolean;
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

const BOOLEAN_FLAG_PROPS: Record<string, keyof CliOptions> = {
    'fail-on-issue': 'failOnIssue',
    'fail-on-analyzer-error': 'failOnAnalyzerError',
    'respect-gitignore': 'respectGitignore',
    cache: 'cache',
    diff: 'diff',
    'auto-tune': 'autoTuneScale',
    profile: 'showProfile',
    score: 'showScore',
    memory: 'memory',
    'record-trajectory': 'recordTrajectory',
};

function isBooleanFlag(arg: string): boolean {
    return arg === DAEMON_FLAG || Object.prototype.hasOwnProperty.call(BOOLEAN_FLAG_PROPS, arg);
}

function applyBooleanFlag(opt: CliOptions, arg: string, enabled: boolean): boolean {
    if (arg === DAEMON_FLAG) {
        opt.daemon = enabled ? MODE_ON : DAEMON_MODE_OFF;
        return true;
    }
    const prop = BOOLEAN_FLAG_PROPS[arg];
    if (prop) {
        (opt as Record<string, unknown>)[prop] = enabled;
        return true;
    }
    return false;
}

const STANDALONE_BOOLEAN_PROPS: Record<string, [keyof CliOptions, boolean]> = {
    'no-cache': ['cache', false],
    'cache-clear': ['cacheClear', true],
    'cache-custom': ['cacheCustom', true],
    'no-memory': ['memory', false],
    'baseline-ratchet-down': ['baselineRatchetDown', true],
    'force-baseline-expand': ['forceBaselineExpand', true],
    fix: ['fix', true],
    'fix-dry-run': ['fixDryRun', true],
};

function applyStandaloneFlag(opt: CliOptions, arg: string): boolean {
    if (arg === 'help' || arg === 'h') {
        printUsage();
        process.exit(0);
    }
    if (arg === 'no-daemon') {
        opt.daemon = DAEMON_MODE_OFF;
        return true;
    }
    const entry = STANDALONE_BOOLEAN_PROPS[arg];
    if (entry) {
        (opt as Record<string, unknown>)[entry[0]] = entry[1];
        return true;
    }
    return false;
}

const STRING_VALUE_PROPS: Record<string, keyof CliOptions> = {
    out: 'out',
    output: 'out',
    root: 'root',
    config: 'configFile',
    baseline: 'baseline',
    'update-baseline': 'updateBaseline',
    'cache-dir': 'cacheDir',
    'agent-uid': 'agentUid',
    telemetry: 'telemetry',
    'log-file': 'logFile',
};

const METRIC_VALUE_PROPS: Record<string, keyof CliOptions> = {
    'effective-loc': 'effectiveLoc',
    'max-sloc': 'effectiveLoc',
    'file-lines-warn': 'fileLinesWarn',
    'file-lines-fail': 'fileLinesFail',
};

const NUMBER_VALUE_PROPS: Record<string, keyof CliOptions> = {
    concurrency: 'concurrency',
    workers: 'workers',
};

function applyListValueFlag(opt: CliOptions, arg: string, val: string): boolean {
    if (arg === STR_INCLUDE || arg === STR_EXCLUDE) {
        applyListFlag(opt, arg, val);
        return true;
    }
    if (arg === 'analyzers' || arg === 'fix-rules') {
        const items = val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        if (arg === 'analyzers') opt.analyzers = items;
        else opt.fixRules = items;
        return true;
    }
    return false;
}

type SpecialValueHandler = (opt: CliOptions, val: string) => void;

const SPECIAL_VALUE_HANDLERS: Record<string, SpecialValueHandler> = {
    parser: (opt, val) => {
        opt.parser = val === STR_OXC ? STR_OXC : LANGUAGE_TYPESCRIPT;
    },
    'log-level': (opt, val) => {
        opt.logLevel = val as LogLevel;
    },
    'comment-level': (opt, val) => {
        if (VALID_COMMENT_LEVELS.has(val)) {
            opt.commentLevel = val as CommentLevel;
        }
    },
    'security-level': (opt, val) => {
        if (VALID_SECURITY_LEVELS.has(val)) {
            opt.securityLevel = val as SecurityLevel;
        }
    },
    'fail-on-severity': (opt, val) => {
        if (VALID_SEVERITIES.has(val)) {
            opt.failOnSeverity = val as Severity;
        }
    },
    'baseline-granularity': (opt, val) => {
        if (val === STR_ID || val === STR_GROUPED) {
            opt.baselineGranularity = val;
        }
    },
    format: (opt, val) => {
        if (VALID_FORMATS.has(val)) {
            opt.format = val as OutputFormat;
        }
    },
};

function applySpecialValueFlag(opt: CliOptions, arg: string, val: string): boolean {
    const handler = SPECIAL_VALUE_HANDLERS[arg];
    if (!handler) {
        return false;
    }
    handler(opt, val);
    return true;
}

function applyValueFlag(opt: CliOptions, arg: string, val: string): void {
    const strProp = STRING_VALUE_PROPS[arg];
    if (strProp) {
        (opt as Record<string, unknown>)[strProp] = val;
        return;
    }
    const metricProp = METRIC_VALUE_PROPS[arg];
    if (metricProp) {
        (opt as Record<string, unknown>)[metricProp] = parseHumanMetric(val);
        return;
    }
    const numProp = NUMBER_VALUE_PROPS[arg];
    if (numProp) {
        (opt as Record<string, unknown>)[numProp] = Number(val);
        return;
    }
    if (applyListValueFlag(opt, arg, val)) return;
    applySpecialValueFlag(opt, arg, val);
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

function handleProfileArgument(
    opt: CliOptions,
    arg: string,
    hasInline: boolean,
    value: string,
    nextArg: string | undefined,
): { handled: boolean; consumedNext: boolean } {
    if (arg === 'profile') {
        const candidate = hasInline ? value : nextArg;
        if (candidate && VALID_PROFILES.has(candidate)) {
            opt.reviewProfile = candidate as QualityReviewProfile;
            opt.showProfile = true;
            return { handled: true, consumedNext: !hasInline };
        }
        return { handled: true, consumedNext: false };
    }
    if (arg === 'review-profile') {
        const candidate = hasInline ? value : nextArg;
        if (candidate && VALID_PROFILES.has(candidate)) {
            opt.reviewProfile = candidate as QualityReviewProfile;
            return { handled: true, consumedNext: !hasInline };
        }
        return { handled: true, consumedNext: false };
    }
    return { handled: false, consumedNext: false };
}

/** Known CLI subcommands that should not be treated as target scan paths. */
const KNOWN_CLI_SUBCOMMANDS = new Set([
    'scan',
    'daemon',
    'self-test',
    'symbols',
    'guide',
    'trajectory',
    'memory',
    'stats',
]);

function tryCollectPositional(arg: string, positionalPaths: string[]): boolean {
    if (arg.startsWith('--')) return false;
    if (!KNOWN_CLI_SUBCOMMANDS.has(arg) && !arg.startsWith('-')) {
        positionalPaths.push(arg);
    }
    return true;
}

function resolveNextValue(
    hasInline: boolean,
    value: string,
    nextToken: string | undefined,
): { val: string; consumedNext: boolean } {
    if (hasInline) return { val: value, consumedNext: false };
    if (nextToken === undefined || nextToken.startsWith('--'))
        return { val: '', consumedNext: false };
    return { val: nextToken, consumedNext: true };
}

function finalizeRootPath(opt: CliOptions, positionalPaths: string[]): void {
    if (!opt.root && positionalPaths.length > 0) {
        opt.root = positionalPaths[0];
    }
}

/**
 * Minimal argv parser: supports `--key value`, `--key=value`, repeated `--include`,
 * and positional scan target directory path.
 *
 * @param argv - Command line argument tokens.
 * @returns Fully populated CLI options object.
 */
export function parseArgs(argv: string[]): CliOptions {
    const opt: CliOptions = { cache: true, daemon: MODE_AUTO };
    const positionalPaths: string[] = [];

    for (let i = 0; i < argv.length; i++) {
        let arg = argv[i];
        if (tryCollectPositional(arg, positionalPaths)) {
            continue;
        }
        arg = arg.slice(2);

        let value = '';
        let hasInline = false;
        if (arg.includes('=')) {
            [arg, value] = arg.split('=', 2);
            hasInline = true;
        }

        const profileRes = handleProfileArgument(opt, arg, hasInline, value, argv[i + 1]);
        if (profileRes.handled) {
            if (profileRes.consumedNext) i++;
            continue;
        }

        if (isBooleanFlag(arg)) {
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

        const { val, consumedNext } = resolveNextValue(hasInline, value, argv[i + 1]);
        if (consumedNext) i++;
        applyValueFlag(opt, arg, val);
    }

    finalizeRootPath(opt, positionalPaths);
    return opt;
}

/** Print the CLI usage banner and available flags to stdout. */
export function printUsage(): void {
    process.stdout
        .write(`auto-refactor — automated code-refactoring analyzer (declarative, pluggable)

Usage:
  auto-refactor scan [options]       Run static analysis and quality review on source files
  auto-refactor self-test            Run known-violation fixture corpus to verify all analyzers
  auto-refactor daemon start|stop|status [--root <dir>]  Manage background acceleration daemon
  auto-refactor symbols <name> [--root <dir>]            Inspect definitions, calls and cross-file usages
  auto-refactor guide <file> [--domain <d>] [--line <l>] Query agent guardrails and active rule guidance
  auto-refactor trajectory [<file>|--summary]            Inspect global review ledger or file revision history
  auto-refactor memory                                  Inspect active review memory and cache capacity
  auto-refactor stats [--root <dir>]                     Compute code volume, LOC, ELOC and density dashboard
  auto-refactor gate [--stage <stage>] [--root <dir>]    Evaluate composite quality gate thresholds

Options:
  --root <dir>                 Root directory to scan (default: cwd)
  --include <glob>            Include glob (repeatable / comma-separated)
  --exclude <glob|dir>        Exclude glob or directory name (repeatable)
  --analyzers <a,b,c>         Allow-list by name (built-in or custom). Declared but
                              unlisted analyzers are disabled for this run.
  --format <json|sarif|text|agent|capp|praxis>  Output format (default: text)
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
  --profile [<profile>]       Display stack profile, or select review profile (frontend|backend|composite)
  --review-profile <profile>  Explicit quality review profile: frontend | backend | composite
  --score                     Output multi-dimensional quality assessment and Tri-Plane vectors
  --record-trajectory         Persist review score and ELOC counters into .refactor-trajectory ledger
  --telemetry <file>          Ingest dynamic runtime telemetry profile (DynamicEvidenceDTO JSON)
  --fix                       Automatically apply guaranteed codemod fixes in-place
  --fix-dry-run               Compute and display unified diffs without modifying files
  --fix-rules <rules>         Comma-separated list of rule IDs to restrict auto-fixing
  --help, -h                  Show this help
`);
}
