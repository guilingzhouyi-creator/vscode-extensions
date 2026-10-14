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
const STR_OXC = 'oxc';
const MODE_AUTO = 'auto';
const MODE_ON = 'on';

const FLAG_PARSER = 'parser';
const FLAG_LOG_LEVEL = 'log-level';
const FLAG_COMMENT_LEVEL = 'comment-level';
const FLAG_SECURITY_LEVEL = 'security-level';
const FLAG_FAIL_ON_SEVERITY = 'fail-on-severity';
const FLAG_BASELINE_GRANULARITY = 'baseline-granularity';
const FLAG_FORMAT = 'format';
const FLAG_HELP = 'help';
const FLAG_HELP_SHORT = 'h';
const FLAG_NO_DAEMON = 'no-daemon';
const FLAG_ANALYZERS = 'analyzers';
const FLAG_FIX_RULES = 'fix-rules';
const FLAG_PROFILE = 'profile';
const FLAG_REVIEW_PROFILE = 'review-profile';

const PREFIX_DOUBLE_DASH = '--';
const PREFIX_SINGLE_DASH = '-';
const CHAR_COMMA = ',';
const CHAR_COLON = ':';
const CHAR_NEWLINE = '\n';
const CHAR_EQUALS = '=';
const CHAR_SPACE = ' ';
const EMPTY_STRING = '';

/** Compact definition table for boolean toggle flags and their CliOptions property names. */
const BOOLEAN_FLAG_MAP_DEF = `fail-on-issue:failOnIssue
fail-on-analyzer-error:failOnAnalyzerError
respect-gitignore:respectGitignore
cache:cache
diff:diff
auto-tune:autoTuneScale
profile:showProfile
score:showScore
memory:memory
record-trajectory:recordTrajectory`;

/** Compact definition table for standalone flags mapping to [property, booleanValue]. */
const STANDALONE_FLAG_MAP_DEF = `no-cache:cache:false
cache-clear:cacheClear:true
cache-custom:cacheCustom:true
no-memory:memory:false
baseline-ratchet-down:baselineRatchetDown:true
force-baseline-expand:forceBaselineExpand:true
fix:fix:true
fix-dry-run:fixDryRun:true`;

/** Compact definition table for string value flags. */
const STRING_VALUE_MAP_DEF = `out:out
output:out
root:root
config:configFile
baseline:baseline
update-baseline:updateBaseline
cache-dir:cacheDir
agent-uid:agentUid
telemetry:telemetry
log-file:logFile`;

/** Compact definition table for human metric flags. */
const METRIC_VALUE_MAP_DEF = `effective-loc:effectiveLoc
max-sloc:effectiveLoc
file-lines-warn:fileLinesWarn
file-lines-fail:fileLinesFail`;

/** Compact definition table for numeric flags. */
const NUMBER_VALUE_MAP_DEF = `concurrency:concurrency
workers:workers`;

const VALID_PROFILES_DEF = 'frontend backend composite';
const VALID_FORMATS_DEF = 'json sarif text agent capp praxis';
const VALID_COMMENT_LEVELS_DEF = 'off basic standard strict';
const VALID_SECURITY_LEVELS_DEF = 'off basic full';
const KNOWN_CLI_SUBCOMMANDS_DEF = 'scan daemon self-test symbols guide trajectory memory stats';

function parseMappingTable<T extends Record<string, string>>(tableDefinition: string): Readonly<T> {
    const tableResult: Record<string, string> = {};
    const definitionLines = tableDefinition.split(CHAR_NEWLINE);
    for (let lineIndex = 0; lineIndex < definitionLines.length; lineIndex++) {
        const rawLine = definitionLines[lineIndex].trim();
        if (!rawLine) {
            continue;
        }
        const separatorIndex = rawLine.indexOf(CHAR_COLON);
        if (separatorIndex === -1) {
            continue;
        }
        const flagKey = rawLine.slice(0, separatorIndex).trim();
        const propertyValue = rawLine.slice(separatorIndex + 1).trim();
        tableResult[flagKey] = propertyValue;
    }
    return Object.freeze(tableResult) as Readonly<T>;
}

const TOKEN_PART_COUNT = 3;

function parseStandaloneFlagTable(
    tableDefinition: string,
): Readonly<Record<string, [keyof CliOptions, boolean]>> {
    const tableResult: Record<string, [keyof CliOptions, boolean]> = {};
    const definitionLines = tableDefinition.split(CHAR_NEWLINE);
    for (let lineIndex = 0; lineIndex < definitionLines.length; lineIndex++) {
        const rawLine = definitionLines[lineIndex].trim();
        if (!rawLine) {
            continue;
        }
        const tokenParts = rawLine.split(CHAR_COLON);
        if (tokenParts.length === TOKEN_PART_COUNT) {
            const flagKey = tokenParts[0].trim();
            const propertyName = tokenParts[1].trim() as keyof CliOptions;
            const flagState = tokenParts[2].trim() === VAL_TRUE;
            tableResult[flagKey] = [propertyName, flagState];
        }
    }
    return Object.freeze(tableResult);
}

const VALID_SEVERITIES = new Set<string>([SEVERITY_INFO, SEVERITY_WARNING, SEVERITY_ERROR]);
const VALID_PROFILES = new Set<string>(VALID_PROFILES_DEF.split(CHAR_SPACE));
const VALID_FORMATS = new Set<string>(VALID_FORMATS_DEF.split(CHAR_SPACE));
const VALID_COMMENT_LEVELS = new Set<string>(VALID_COMMENT_LEVELS_DEF.split(CHAR_SPACE));
const VALID_SECURITY_LEVELS = new Set<string>(VALID_SECURITY_LEVELS_DEF.split(CHAR_SPACE));
const KNOWN_CLI_SUBCOMMANDS = new Set<string>(KNOWN_CLI_SUBCOMMANDS_DEF.split(CHAR_SPACE));

const BOOLEAN_FLAG_PROPS =
    parseMappingTable<Record<string, keyof CliOptions>>(BOOLEAN_FLAG_MAP_DEF);
const STANDALONE_BOOLEAN_PROPS = parseStandaloneFlagTable(STANDALONE_FLAG_MAP_DEF);
const STRING_VALUE_PROPS =
    parseMappingTable<Record<string, keyof CliOptions>>(STRING_VALUE_MAP_DEF);
const METRIC_VALUE_PROPS =
    parseMappingTable<Record<string, keyof CliOptions>>(METRIC_VALUE_MAP_DEF);
const NUMBER_VALUE_PROPS =
    parseMappingTable<Record<string, keyof CliOptions>>(NUMBER_VALUE_MAP_DEF);

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
    cliOptions: CliOptions,
    targetFlag: typeof STR_INCLUDE | typeof STR_EXCLUDE,
    flagValue: string,
): void {
    const parsedTokens = flagValue
        .split(CHAR_COMMA)
        .map((tokenSegment) => tokenSegment.trim())
        .filter(Boolean);
    const existingList = cliOptions[targetFlag];
    cliOptions[targetFlag] = existingList ? [...existingList, ...parsedTokens] : parsedTokens;
}

function isBooleanFlag(flagName: string): boolean {
    return (
        flagName === DAEMON_FLAG ||
        Object.prototype.hasOwnProperty.call(BOOLEAN_FLAG_PROPS, flagName)
    );
}

function applyBooleanFlag(cliOptions: CliOptions, flagName: string, flagEnabled: boolean): boolean {
    if (flagName === DAEMON_FLAG) {
        cliOptions.daemon = flagEnabled ? MODE_ON : DAEMON_MODE_OFF;
        return true;
    }
    const propKey = BOOLEAN_FLAG_PROPS[flagName];
    if (propKey) {
        (cliOptions as Record<string, unknown>)[propKey] = flagEnabled;
        return true;
    }
    return false;
}

function applyStandaloneFlag(cliOptions: CliOptions, flagName: string): boolean {
    if (flagName === FLAG_HELP || flagName === FLAG_HELP_SHORT) {
        printUsage();
        process.exit(0);
    }
    if (flagName === FLAG_NO_DAEMON) {
        cliOptions.daemon = DAEMON_MODE_OFF;
        return true;
    }
    const mappingEntry = STANDALONE_BOOLEAN_PROPS[flagName];
    if (mappingEntry) {
        const [targetProperty, flagState] = mappingEntry;
        (cliOptions as Record<string, unknown>)[targetProperty] = flagState;
        return true;
    }
    return false;
}

function applyListValueFlag(cliOptions: CliOptions, flagName: string, flagValue: string): boolean {
    if (flagName === STR_INCLUDE || flagName === STR_EXCLUDE) {
        applyListFlag(cliOptions, flagName, flagValue);
        return true;
    }
    if (flagName === FLAG_ANALYZERS || flagName === FLAG_FIX_RULES) {
        const parsedTokens = flagValue
            .split(CHAR_COMMA)
            .map((tokenSegment) => tokenSegment.trim())
            .filter(Boolean);
        if (flagName === FLAG_ANALYZERS) {
            cliOptions.analyzers = parsedTokens;
        } else {
            cliOptions.fixRules = parsedTokens;
        }
        return true;
    }
    return false;
}

type SpecialValueHandler = (cliOptions: CliOptions, flagValue: string) => void;

const SPECIAL_VALUE_HANDLERS: Readonly<Record<string, SpecialValueHandler>> = Object.freeze({
    [FLAG_PARSER]: (cliOptions: CliOptions, flagValue: string): void => {
        cliOptions.parser = flagValue === STR_OXC ? STR_OXC : LANGUAGE_TYPESCRIPT;
    },
    [FLAG_LOG_LEVEL]: (cliOptions: CliOptions, flagValue: string): void => {
        cliOptions.logLevel = flagValue as LogLevel;
    },
    [FLAG_COMMENT_LEVEL]: (cliOptions: CliOptions, flagValue: string): void => {
        if (VALID_COMMENT_LEVELS.has(flagValue)) {
            cliOptions.commentLevel = flagValue as CommentLevel;
        }
    },
    [FLAG_SECURITY_LEVEL]: (cliOptions: CliOptions, flagValue: string): void => {
        if (VALID_SECURITY_LEVELS.has(flagValue)) {
            cliOptions.securityLevel = flagValue as SecurityLevel;
        }
    },
    [FLAG_FAIL_ON_SEVERITY]: (cliOptions: CliOptions, flagValue: string): void => {
        if (VALID_SEVERITIES.has(flagValue)) {
            cliOptions.failOnSeverity = flagValue as Severity;
        }
    },
    [FLAG_BASELINE_GRANULARITY]: (cliOptions: CliOptions, flagValue: string): void => {
        if (flagValue === STR_ID || flagValue === STR_GROUPED) {
            cliOptions.baselineGranularity = flagValue;
        }
    },
    [FLAG_FORMAT]: (cliOptions: CliOptions, flagValue: string): void => {
        if (VALID_FORMATS.has(flagValue)) {
            cliOptions.format = flagValue as OutputFormat;
        }
    },
});

function applySpecialValueFlag(
    cliOptions: CliOptions,
    flagName: string,
    flagValue: string,
): boolean {
    const flagHandler = SPECIAL_VALUE_HANDLERS[flagName];
    if (!flagHandler) {
        return false;
    }
    flagHandler(cliOptions, flagValue);
    return true;
}

function applyValueFlag(cliOptions: CliOptions, flagName: string, flagValue: string): void {
    const stringProperty = STRING_VALUE_PROPS[flagName];
    if (stringProperty) {
        (cliOptions as Record<string, unknown>)[stringProperty] = flagValue;
        return;
    }
    const metricProperty = METRIC_VALUE_PROPS[flagName];
    if (metricProperty) {
        (cliOptions as Record<string, unknown>)[metricProperty] = parseHumanMetric(flagValue);
        return;
    }
    const numericProperty = NUMBER_VALUE_PROPS[flagName];
    if (numericProperty) {
        (cliOptions as Record<string, unknown>)[numericProperty] = Number(flagValue);
        return;
    }
    if (applyListValueFlag(cliOptions, flagName, flagValue)) {
        return;
    }
    applySpecialValueFlag(cliOptions, flagName, flagValue);
}

/**
 * Resolves boolean flag value considering inline '=false' and explicit next token.
 */
function resolveBoolFlag(
    hasInlineValue: boolean,
    inlineValue: string,
    nextArgumentToken: string | undefined,
): [boolean, number] {
    if (hasInlineValue) {
        return [inlineValue !== VAL_FALSE, 0];
    }
    if (nextArgumentToken === VAL_TRUE || nextArgumentToken === VAL_FALSE) {
        return [nextArgumentToken !== VAL_FALSE, 1];
    }
    return [true, 0];
}

interface FlagTokenContext {
    readonly flagName: string;
    readonly hasInlineValue: boolean;
    readonly inlineValue: string;
    readonly nextArgumentToken?: string;
}

function handleProfileFlag(
    flagContext: FlagTokenContext,
    cliOptions: CliOptions,
): [boolean, number] {
    const isProfile = flagContext.flagName === FLAG_PROFILE;
    const isReviewProfile = flagContext.flagName === FLAG_REVIEW_PROFILE;
    if (!isProfile && !isReviewProfile) {
        return [false, 0];
    }
    if (isProfile) {
        cliOptions.showProfile = true;
    }
    const candidateProfile = flagContext.hasInlineValue
        ? flagContext.inlineValue
        : flagContext.nextArgumentToken;
    if (candidateProfile && VALID_PROFILES.has(candidateProfile)) {
        cliOptions.reviewProfile = candidateProfile as QualityReviewProfile;
        return [true, flagContext.hasInlineValue ? 0 : 1];
    }
    return [true, 0];
}

function tryCollectPositional(argumentToken: string, positionalPaths: string[]): boolean {
    if (argumentToken.startsWith(PREFIX_DOUBLE_DASH)) {
        return false;
    }
    if (
        !KNOWN_CLI_SUBCOMMANDS.has(argumentToken) &&
        !argumentToken.startsWith(PREFIX_SINGLE_DASH)
    ) {
        positionalPaths.push(argumentToken);
    }
    return true;
}

function resolveTokenValue(
    hasInlineValue: boolean,
    inlineValue: string,
    nextArgumentToken: string | undefined,
): [string, number] {
    if (hasInlineValue) {
        return [inlineValue, 0];
    }
    if (!nextArgumentToken || nextArgumentToken.startsWith(PREFIX_DOUBLE_DASH)) {
        return [EMPTY_STRING, 0];
    }
    return [nextArgumentToken, 1];
}

function finalizeRootPath(cliOptions: CliOptions, positionalPaths: string[]): void {
    if (!cliOptions.root && positionalPaths.length > 0) {
        cliOptions.root = positionalPaths[0];
    }
}

function extractFlagTokenParts(rawToken: string): [string, boolean, string] {
    const normalized = rawToken.slice(2);
    const eqIdx = normalized.indexOf(CHAR_EQUALS);
    if (eqIdx === -1) {
        return [normalized, false, EMPTY_STRING];
    }
    return [normalized.slice(0, eqIdx), true, normalized.slice(eqIdx + 1)];
}

function dispatchGenericFlag(cliOptions: CliOptions, flagContext: FlagTokenContext): number {
    if (isBooleanFlag(flagContext.flagName)) {
        const [flagEnabled, stepOffset] = resolveBoolFlag(
            flagContext.hasInlineValue,
            flagContext.inlineValue,
            flagContext.nextArgumentToken,
        );
        applyBooleanFlag(cliOptions, flagContext.flagName, flagEnabled);
        return stepOffset;
    }

    if (applyStandaloneFlag(cliOptions, flagContext.flagName)) {
        return 0;
    }

    const [flagValue, stepOffset] = resolveTokenValue(
        flagContext.hasInlineValue,
        flagContext.inlineValue,
        flagContext.nextArgumentToken,
    );
    applyValueFlag(cliOptions, flagContext.flagName, flagValue);
    return stepOffset;
}

/**
 * Minimal argv parser: supports `--key value`, `--key=value`, repeated `--include`,
 * and positional scan target directory path.
 *
 * @param argv - Command line argument tokens.
 * @returns Fully populated CLI options object.
 */
export function parseArgs(argv: string[]): CliOptions {
    const cliOptions: CliOptions = { cache: true, daemon: MODE_AUTO };
    const positionalPaths: string[] = [];

    for (let tokenIndex = 0; tokenIndex < argv.length; tokenIndex++) {
        const rawToken = argv[tokenIndex];
        if (tryCollectPositional(rawToken, positionalPaths)) {
            continue;
        }

        const [flagName, hasInlineValue, inlineValue] = extractFlagTokenParts(rawToken);
        const nextArgumentToken = argv[tokenIndex + 1];
        const flagContext: FlagTokenContext = {
            flagName,
            hasInlineValue,
            inlineValue,
            nextArgumentToken,
        };

        const [handledProfile, profileOffset] = handleProfileFlag(flagContext, cliOptions);
        if (handledProfile) {
            tokenIndex += profileOffset;
            continue;
        }

        tokenIndex += dispatchGenericFlag(cliOptions, flagContext);
    }

    finalizeRootPath(cliOptions, positionalPaths);
    return cliOptions;
}

/** CLI usage banner text displayed to users requesting help. */
const CLI_USAGE_HELP_TEXT = `auto-refactor — automated code-refactoring analyzer (declarative, pluggable)

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
`;

/** Print the CLI usage banner and available flags to stdout. */
export function printUsage(): void {
    process.stdout.write(CLI_USAGE_HELP_TEXT);
}
