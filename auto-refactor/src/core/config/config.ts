/**
 * Module: Core Engine — Declarative Configuration Resolution
 * File Path: src/core/config/config.ts
 * Architecture Role: Configuration single source of truth; builds and layers the ScanConfig
 *   consumed by every CLI, API, daemon, and worker entry point.
 * Dependencies & Triggers: Imports `fs`, `os`, `path`, core config types, project profile
 *   detection, and scale/maturity tuners; triggered by `resolveConfig` from CLI `--config`
 *   and flags, API callers, and daemon startup, plus config auto-discovery.
 * Responsibilities: Export tool identity and the eleven built-in analyzer names; provide
 *   default thresholds, per-analyzer options, declarative analyzer registry, and full config;
 *   locate/parse an explicit or auto-discovered JSON config; merge defaults, file values,
 *   CLI overrides, custom analyzers, and deep-merged options; apply scale and maturity
 *   tuning; cascade comment/security levels and literal-classification rules; and apply the
 *   `--analyzers` allow-list.
 * Exit Semantics & Design Rationale: A missing config file is ignored silently, while an
 *   unreadable or malformed existing file warns and falls back to defaults instead of
 *   throwing, so CI never dies on a broken config; precedence is defaults < file < CLI,
 *   unlisted analyzers become disabled only for an explicit allow-list, and setting
 *   `securityLevel` to `off` disables the security and secrets analyzers.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
    ScanConfig,
    Thresholds,
    AnalyzerDeclaration,
    CustomAnalyzerDeclaration,
    AnalyzerId,
    LogLevel,
    LiteralPolicyConfig,
} from '../types';
import { DEFAULT_TOLERATED_CALL_ARGUMENTS } from '../literal-policy-engine';
import { ERR_INVALID_CUSTOM_ANALYZER } from '../router/sliceTypes';

import {
    ANALYZER_ARCHITECTURE,
    ANALYZER_COMMENTS,
    ANALYZER_CONSTANTS,
    ANALYZER_GDSCRIPT_MODERN,
    ANALYZER_RUST_MODERN,
    ANALYZER_SECRETS,
    ANALYZER_SECURITY,
    ANALYZER_TYPESCRIPT_MODERN,
    SPECIALIZED_ANALYZERS,
    applyAutoTuning,
} from './config-tuning';
import {
    ANALYZER_LARGE_FILE,
    ANALYZER_COMPLEXITY,
    ANALYZER_GOVERNANCE,
    ANALYZER_DEPENDENCY_GRAPH,
    ANALYZER_PERFORMANCE,
    ANALYZER_HYGIENE,
    ANALYZER_SIMPLIFY,
    ANALYZER_PYTHON_MODERN,
    ANALYZER_DOCS,
    ANALYZER_DATA_ARCHITECTURE,
    ANALYZER_TEST_MODERNITY,
    ANALYZER_DEPENDENCY_LAYOUT,
    ANALYZER_NAMING,
} from '../scoring/dimensionLiterals';
import { applySemanticAndSecurityLevels } from './config-cascades';
import type { ConfigOverrides } from './config-tuning';

// Compatibility surface: callers historically imported ConfigOverrides from this module.
export type { ConfigOverrides } from './config-tuning';

/** Public tool identity string that consumers can surface in banners, reports, and logs. */
export const TOOL_NAME = 'auto-refactor';

/**
 * Engine semantic version recorded in cache keys so stale entries invalidate across releases.
 * Keep it in sync with `package.json` whenever report or cache contracts change.
 */
export const TOOL_VERSION = '0.4.0';

/** Built-in analyzer names shipped with the engine (also usable as keys in `analyzers`). */
export const BUILTIN_ANALYZERS = [
    ANALYZER_CONSTANTS,
    ANALYZER_LARGE_FILE,
    ANALYZER_COMPLEXITY,
    ANALYZER_GOVERNANCE,
    ANALYZER_DEPENDENCY_GRAPH,
    ANALYZER_SECRETS,
    ANALYZER_ARCHITECTURE,
    ANALYZER_PERFORMANCE,
    ANALYZER_COMMENTS,
    ANALYZER_HYGIENE,
    ANALYZER_SECURITY,
    ANALYZER_SIMPLIFY,
    ANALYZER_PYTHON_MODERN,
    ANALYZER_TYPESCRIPT_MODERN,
    ANALYZER_RUST_MODERN,
    ANALYZER_GDSCRIPT_MODERN,
    ANALYZER_DOCS,
    ANALYZER_DATA_ARCHITECTURE,
    ANALYZER_TEST_MODERNITY,
    ANALYZER_DEPENDENCY_LAYOUT,
    ANALYZER_NAMING,
] as const;

// ── Built-in defaults (one definition site shared by thresholds and analyzer options) ──
/** constants analyzer defaults. */
const DEFAULT_MAGIC_NUMBER_MIN = 2;
const DEFAULT_DUPLICATE_LITERAL_THRESHOLD = 3;
const DEFAULT_HARDCODED_STRING_MIN_LENGTH = 3;
/** large-file analyzer defaults. */
const DEFAULT_FILE_LINES_WARN = 400;
const DEFAULT_FILE_LINES_FAIL = 800;
const DEFAULT_FILE_FUNCTIONS_WARN = 15;
/** complexity analyzer defaults. */
const DEFAULT_COMPLEXITY_WARN = 10;
const DEFAULT_COMPLEXITY_FAIL = 20;
/** governance analyzer defaults. */
const DEFAULT_MAX_NESTING_DEPTH = 5;
const DEFAULT_MAX_INHERITANCE_DEPTH = 2;
/** dependency-graph defaults. */
const DEFAULT_MAX_CYCLES_REPORTED = 20;
/** performance analyzer defaults. */
const DEFAULT_MAX_LOOP_NESTING = 3;
/** secrets analyzer defaults (precise patterns on, entropy detection opt-in). */
const DEFAULT_SECRET_ENTROPY_MIN_LENGTH = 32;
const DEFAULT_SECRET_ENTROPY_THRESHOLD = 4.5;
const DEFAULT_SECRET_MAX_ISSUES_PER_FILE = 50;
/** simplify analyzer default function span. */
const DEFAULT_MAX_FUNCTION_LINES = 60;
/** simplify analyzer default minimum run of commented-out lines. */
const DEFAULT_COMMENTED_CODE_MIN_LINES = 3;
/** Scheduler default: in-process unless the repo is big enough to amortise worker threads. */
const DEFAULT_MAX_CONCURRENCY = 4;

/** `typeof` tag used to validate boolean overrides before they are layered into the config. */
const TYPEOF_BOOLEAN = 'boolean';

/**
 * True when `value` is a genuine boolean (not a stringified CLI value), used instead of an
 * inline `typeof` check so the comparison token lives in exactly one named place.
 *
 * @param value - Raw override value read from CLI/API/file sources.
 * @returns True when the runtime type is boolean, narrowing `value` to `boolean`.
 */
function isBooleanFlag(value: unknown): value is boolean {
    return typeof value === TYPEOF_BOOLEAN;
}

/**
 * Default thresholds (global). Per-analyzer `options` in config are deep-merged ON TOP of these,
 * so a single analyzer can override a value locally without affecting others.
 *
 * @returns A fresh threshold object with engine defaults for constants, large-file, complexity.
 */
export function defaultThresholds(): Thresholds {
    return {
        // constants
        magicNumberMin: DEFAULT_MAGIC_NUMBER_MIN,
        duplicateLiteralThreshold: DEFAULT_DUPLICATE_LITERAL_THRESHOLD,
        hardcodedStringMinLength: DEFAULT_HARDCODED_STRING_MIN_LENGTH,
        // large-file
        fileLinesWarn: DEFAULT_FILE_LINES_WARN,
        fileLinesFail: DEFAULT_FILE_LINES_FAIL,
        fileFunctionsWarn: DEFAULT_FILE_FUNCTIONS_WARN,
        // complexity
        complexityWarn: DEFAULT_COMPLEXITY_WARN,
        complexityFail: DEFAULT_COMPLEXITY_FAIL,
        // simplify
        maxFunctionLines: DEFAULT_MAX_FUNCTION_LINES,
    };
}

/**
 * Per-analyzer **default options** (documented for users; see config.schema.json).
 * These are applied first, then overridden by global `thresholds`, then by the analyzer's
 * own `options` block in config. Keeping them here makes each tool's tunables explicit.
 *
 *  constants:       magicNumberMin, duplicateLiteralThreshold, hardcodedStringMinLength,
 *                   ignoreLiterals
 *  large-file:      fileLinesWarn, fileLinesFail, fileFunctionsWarn
 *  complexity:      complexityWarn, complexityFail
 *  governance:      maxNestingDepth, maxInheritanceDepth, blockingIoAllowPatterns
 *  architecture:    enforceCleanLayers, allowSkipLayers
 *  performance:     maxLoopNesting, checkBlockingIO, checkTransientAllocations,
 *                   blockingIoAllowPatterns
 *  comments:        level, requireHeader, directiveTokens
 *  hygiene:         checkDeadCode, checkNaming, checkTemporaryStubs, checkDuplicateBlocks,
 *                   jargonPatterns
 *  simplify:        maxFunctionLines, commentedCodeMinLines, printAllowPatterns
 *
 * @returns A fresh analyzer-id-keyed map of default options that callers may mutate safely.
 */
export function defaultAnalyzerOptions(): Record<AnalyzerId, Record<string, any>> {
    return {
        constants: {
            magicNumberMin: DEFAULT_MAGIC_NUMBER_MIN,
            duplicateLiteralThreshold: DEFAULT_DUPLICATE_LITERAL_THRESHOLD,
            hardcodedStringMinLength: DEFAULT_HARDCODED_STRING_MIN_LENGTH,
            // Declaring this key is what lets the GLOBAL `thresholds.ignoreLiterals` layer reach
            // the constants analyzer (only keys listed here are cascaded). The built-in value is
            // empty on purpose: a project opts in to ignoring tokens, so enabling the engine can
            // never silently remove findings a consumer already gates on. Entries are matched
            // against the literal WITHOUT its quotes (e.g. `/` or `..`), so structural tokens can
            // be exempted without naming every escape sequence twice.
            ignoreLiterals: [],
        },
        'large-file': {
            fileLinesWarn: DEFAULT_FILE_LINES_WARN,
            fileLinesFail: DEFAULT_FILE_LINES_FAIL,
            fileFunctionsWarn: DEFAULT_FILE_FUNCTIONS_WARN,
        },
        complexity: {
            complexityWarn: DEFAULT_COMPLEXITY_WARN,
            complexityFail: DEFAULT_COMPLEXITY_FAIL,
            // Shared with performance/governance: the semantic-complexity rules report blocking
            // I/O inside loops (CPX-AMP-001), so the same one global policy must reach them,
            // otherwise a path exempted for PRF-IO-001 is still reported under a second rule.
            blockingIoAllowPatterns: [],
            // Per-iteration allocation policy for CPX-SPACE-001, same shape and rationale: a
            // process-style entry point allocates per iteration by design, a library hot path
            // does not. Empty by default so opting in is always explicit.
            allocationAllowPatterns: [],
        },
        governance: {
            maxNestingDepth: DEFAULT_MAX_NESTING_DEPTH,
            maxInheritanceDepth: DEFAULT_MAX_INHERITANCE_DEPTH,
            // Shared with performance.blockingIoAllowPatterns: declaring the key in both
            // analyzers lets one global `thresholds.blockingIoAllowPatterns` policy reach both
            // the PRF-IO-001 analyzer and the GOV-PRF-004 governance rule.
            blockingIoAllowPatterns: [],
        },
        'dependency-graph': {
            // Cross-file import-graph checks. Per-file `disallowed-import` rules are declared via
            // `groups` + `rules` (see config.schema.json); global cycle detection runs post-scan.
            // detectCycles defaults OFF: enabling a new analyzer must never silently change gate
            // outcomes for existing consumers — opt in explicitly per project.
            detectCycles: false,
            cycleSeverity: 'error',
            maxCyclesReported: DEFAULT_MAX_CYCLES_REPORTED,
            // Unused-export detection (post-scan, opt-in): flags exported symbols that no other
            // file references. `entryGlobs` whitelists entry points (CLI mains, extension hosts).
            detectUnusedExports: false,
            entryGlobs: [],
            unusedSeverity: 'warning',
        },
        secrets: {
            // Precise token patterns ON by default; high-entropy detection opt-in (vendor noise).
            entropy: {
                enabled: false,
                minLength: DEFAULT_SECRET_ENTROPY_MIN_LENGTH,
                threshold: DEFAULT_SECRET_ENTROPY_THRESHOLD,
                severity: 'warning',
            },
            maxIssuesPerFile: DEFAULT_SECRET_MAX_ISSUES_PER_FILE,
        },
        architecture: {
            enforceCleanLayers: true,
            allowSkipLayers: false,
        },
        performance: {
            maxLoopNesting: DEFAULT_MAX_LOOP_NESTING,
            checkBlockingIO: true,
            checkTransientAllocations: true,
            blockingIoAllowPatterns: [],
        },
        comments: {
            level: 'standard',
            requireHeader: true,
            directiveTokens: [],
        },
        hygiene: {
            checkDeadCode: true,
            checkNaming: true,
            checkTemporaryStubs: true,
            checkDuplicateBlocks: true,
            jargonPatterns: [],
        },
        simplify: {
            maxFunctionLines: DEFAULT_MAX_FUNCTION_LINES,
            commentedCodeMinLines: DEFAULT_COMMENTED_CODE_MIN_LINES,
        },
        security: {
            level: 'basic',
        },
    };
}

/**
 * Default declarative registry: built-in core registered.
 * Specialized tiers (governance, architecture, performance, comments, hygiene, security)
 * are enabled when declared in config or CLI allow-list to maintain 100% byte equivalence.
 *
 * @returns A fresh registry mapping every built-in analyzer name to its enabled flag/options.
 */
export function defaultAnalyzers(): Record<string, AnalyzerDeclaration> {
    const map: Record<string, AnalyzerDeclaration> = {};
    for (const name of BUILTIN_ANALYZERS) {
        map[name] = { enabled: !SPECIALIZED_ANALYZERS.has(name), options: {} };
    }
    return map;
}

/**
 * Build the baseline scan configuration for `root` before any file or CLI override is applied.
 * The result embeds the built-in analyzer registry, default thresholds, and formatting and
 * scheduling defaults; every call allocates a fresh object graph, so callers may mutate it.
 *
 * @param root - Scan root recorded on the config and used to resolve relative paths.
 * @returns A complete default ScanConfig; explicit overrides are layered by `resolveConfig`.
 */
export function defaultConfig(root: string): ScanConfig {
    return {
        root,
        baseDir: process.cwd(),
        include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.rs', '**/*.gd'],
        exclude: [
            'node_modules',
            '.git',
            'dist',
            'build',
            'out',
            'coverage',
            '.next',
            '.vscode-test',
        ],
        analyzers: defaultAnalyzers(),
        customAnalyzers: [],
        thresholds: defaultThresholds(),
        format: 'text',
        failOnIssue: false,
        failOnSeverity: undefined,
        suppressions: [],
        baselineGranularity: 'id',
        literalPolicy: {
            toleratedCallArguments: { ...DEFAULT_TOLERATED_CALL_ARGUMENTS },
        },
        // observability / scheduling defaults
        logLevel: 'info',
        logFile: undefined,
        concurrency: Math.max(1, Math.min(DEFAULT_MAX_CONCURRENCY, os.cpus().length)),
        // 0 = auto: worker threads scale with the batch size (files / 24, capped at 8 and by the
        // core count), so small scans stay in-process and many-file scans spread across cores.
        // 1 = force in-process; N > 1 = exactly N threads.
        workers: 0,
        respectGitignore: true,
        failOnAnalyzerError: false,
        // `--no-cache` must leave no trace on disk; review memory follows the same switch as the
        // L1/L2 cache store (see Scanner.reviewMemoryDir).
        cacheEnabled: true,
        parser: 'typescript',
        // Line-level incremental (docs/03-incremental-and-diff/01-line-level-incremental.md):
        // default OFF (env AR_INCREMENTAL wins).
        // `incrementalMinLines` is left unset here so the env `AR_INCREMENTAL_MIN_LINES`
        // (default 1000) takes precedence; a config file may still override it explicitly.
        incremental: false,
        commentLevel: 'standard',
        securityLevel: 'basic',
        // Fail closed by default: files no adapter can parse must not look like a clean scan.
        unsupportedLanguage: 'error',
        memory: true,
        agentUid: 'default-agent',
        scoringWeights: undefined,
    };
}

/**
 * Locate and read a JSON configuration file if present, degrading gracefully on parse errors.
 *
 * @param root - The scan root directory used for candidate config paths.
 * @param configFile - Explicit config file path if specified via CLI or options.
 * @returns An object containing the parsed config (or empty object) and the resolved base
 *   directory.
 */
function loadConfigFile(
    root: string,
    configFile?: string,
): { fileCfg: Partial<ScanConfig>; baseDir: string } {
    let fileCfg: Partial<ScanConfig> = {};
    let baseDir = root;
    const candidates = [
        configFile,
        path.join(root, 'auto-refactor.config.json'),
        path.join(process.cwd(), 'auto-refactor.config.json'),
    ].filter(Boolean) as string[];
    for (const c of candidates) {
        try {
            if (fs.existsSync(c)) {
                fileCfg = JSON.parse(fs.readFileSync(c, 'utf8'));
                baseDir = path.dirname(path.resolve(c));
                break;
            }
        } catch (e) {
            // A bad config must not be silently ignored: a parse failure is treated as "no config
            // file" and falls back to defaults, silently discarding every user-tuned threshold
            // and analyzer switch (extremely hard to diagnose in CI). Warn only here—never throw,
            // so "bad config degrades" still holds—and explicitly distinguish "file missing"
            // from "file corrupt".
            console.warn(
                `[auto-refactor] config file exists but is invalid/unreadable, falling back to defaults: ${c} ` +
                    `(${e instanceof Error ? e.message : String(e)})`,
            );
        }
    }
    return { fileCfg, baseDir };
}

/**
 * Merge declarative analyzer registries across defaults, config file, and global thresholds.
 *
 * @param baseAnalyzers - Base built-in analyzer registry declarations.
 * @param fileCfgAnalyzers - Config-file supplied analyzer overrides if any.
 * @param analyzerDefaults - Built-in default options for each analyzer.
 * @param globalThresholds - Merged global thresholds to cascade into analyzer options.
 * @returns Fully merged analyzer declarations map.
 */
function mergeAnalyzerDeclarations(
    baseAnalyzers: Record<string, AnalyzerDeclaration>,
    fileCfgAnalyzers: Record<string, Partial<AnalyzerDeclaration>> | undefined,
    analyzerDefaults: Record<string, Record<string, unknown>>,
    globalThresholds: Record<string, unknown>,
): Record<string, AnalyzerDeclaration> {
    const globalThresholdLayer = (name: string): Record<string, unknown> => {
        const layer: Record<string, unknown> = {};
        for (const key of Object.keys(analyzerDefaults[name] || {})) {
            if (key in globalThresholds) layer[key] = globalThresholds[key];
        }
        return layer;
    };

    const analyzers: Record<string, AnalyzerDeclaration> = { ...baseAnalyzers };
    if (fileCfgAnalyzers) {
        for (const [name, decl] of Object.entries(fileCfgAnalyzers)) {
            const defaults = analyzerDefaults[name] || {};
            analyzers[name] = {
                enabled: decl?.enabled !== false,
                options: {
                    ...defaults,
                    ...globalThresholdLayer(name),
                    ...(analyzers[name]?.options || {}),
                    ...(decl?.options || {}),
                },
            };
        }
    }
    // built-in analyzers not customized still get their defaults plus the global threshold layer
    for (const name of Object.keys(analyzers)) {
        if (!analyzers[name].options || Object.keys(analyzers[name].options).length === 0) {
            analyzers[name] = {
                ...analyzers[name],
                options: { ...(analyzerDefaults[name] || {}), ...globalThresholdLayer(name) },
            };
        }
    }
    return analyzers;
}

/**
 * Resolve a value by precedence: CLI/API override, then config file, then base default.
 *
 * Uses `||` (not `??`) to keep the historical layering semantics, where an empty value in a
 * higher layer falls through to the next one instead of winning.
 *
 * @param override - CLI/API override value.
 * @param fileValue - Config-file value.
 * @param baseValue - Built-in default value.
 * @returns The first set value, or undefined when no layer provides one.
 */
function resolveScalar<T>(override: T | undefined, fileValue: T | undefined, baseValue: T): T {
    return override || fileValue || baseValue;
}

/**
 * Resolve a tri-state boolean flag: a genuine boolean override wins, else file, else base.
 *
 * @param override - Raw CLI/API override value (may be a stringified flag).
 * @param fileValue - Config-file value.
 * @param baseValue - Built-in default value.
 * @returns The resolved flag, or undefined when no layer sets one.
 */
function resolveFlag<B extends boolean | undefined>(
    override: unknown,
    fileValue: boolean | undefined,
    baseValue: B,
): boolean | B {
    return isBooleanFlag(override) ? override : (fileValue ?? baseValue);
}

/**
 * Resolve a numeric option, ignoring non-numeric CLI strings.
 *
 * @param override - Raw CLI/API override value (may be a stringified number).
 * @param fileValue - Config-file value.
 * @param baseValue - Built-in default value.
 * @returns The resolved number, or undefined when no layer provides one.
 */
function resolveNumber<B extends number | undefined>(
    override: unknown,
    fileValue: number | undefined,
    baseValue: B,
): number | B {
    return typeof override === 'number' ? override : (fileValue ?? baseValue);
}

/**
 * True when the caller explicitly passed `cache: false` (a scan flag that is not part of
 * ScanConfig, so it is probed structurally instead of widening the override type).
 *
 * @param overrides - Explicit CLI or runtime overrides.
 * @returns True when the override layer disabled the cache.
 */
function cacheOverrideDisabled(overrides: ConfigOverrides): boolean {
    return (overrides as { cache?: boolean }).cache === false;
}

/**
 * Assemble execution, concurrency, cache, and failure handling configuration flags.
 *
 * @param base - Base default configuration.
 * @param fileCfg - Config-file specified overrides.
 * @param overrides - Explicit CLI or runtime overrides.
 * @returns Filtered execution and scheduling options.
 */
function assembleExecutionOptions(
    base: ScanConfig,
    fileCfg: Partial<ScanConfig>,
    overrides: ConfigOverrides,
): Pick<
    ScanConfig,
    | 'workers'
    | 'concurrency'
    | 'respectGitignore'
    | 'failOnIssue'
    | 'failOnSeverity'
    | 'failOnAnalyzerError'
    | 'parser'
    | 'cacheEnabled'
    | 'incremental'
    | 'incrementalMinLines'
> {
    return {
        concurrency: resolveScalar(overrides.concurrency, fileCfg.concurrency, base.concurrency),
        workers: resolveNumber(overrides.workers, fileCfg.workers, base.workers),
        respectGitignore: resolveFlag(
            overrides.respectGitignore,
            fileCfg.respectGitignore,
            base.respectGitignore,
        ),
        failOnIssue: resolveFlag(overrides.failOnIssue, fileCfg.failOnIssue, base.failOnIssue),
        failOnSeverity: resolveScalar(
            overrides.failOnSeverity,
            fileCfg.failOnSeverity,
            base.failOnSeverity,
        ),
        failOnAnalyzerError: resolveFlag(
            overrides.failOnAnalyzerError,
            fileCfg.failOnAnalyzerError,
            base.failOnAnalyzerError,
        ),
        parser: resolveScalar(overrides.parser, fileCfg.parser, base.parser),
        cacheEnabled: cacheOverrideDisabled(overrides) ? false : base.cacheEnabled,
        incremental: resolveFlag(overrides.incremental, fileCfg.incremental, base.incremental),
        incrementalMinLines: resolveNumber(
            overrides.incrementalMinLines,
            fileCfg.incrementalMinLines,
            base.incrementalMinLines,
        ),
    };
}

/**
 * Assemble formatting, logging, baseline, and output destination options.
 *
 * @param base - Base default configuration.
 * @param fileCfg - Config-file specified overrides.
 * @param overrides - Explicit CLI or runtime overrides.
 * @returns Filtered reporting and output options.
 */
function assembleReportingOptions(
    base: ScanConfig,
    fileCfg: Partial<ScanConfig>,
    overrides: ConfigOverrides,
): Pick<
    ScanConfig,
    'format' | 'logLevel' | 'logFile' | 'suppressions' | 'baselineGranularity' | 'out'
> {
    return {
        format: overrides.format || fileCfg.format || base.format,
        logLevel: (overrides.logLevel as LogLevel) || fileCfg.logLevel || base.logLevel,
        logFile: overrides.logFile || fileCfg.logFile || base.logFile,
        suppressions: fileCfg.suppressions ?? base.suppressions,
        baselineGranularity: fileCfg.baselineGranularity ?? base.baselineGranularity,
        out: overrides.out || fileCfg.out,
    };
}

function mergeLiteralPolicy(
    base?: LiteralPolicyConfig,
    custom?: LiteralPolicyConfig,
): LiteralPolicyConfig | undefined {
    if (!custom) return base;
    return {
        ...base,
        ...custom,
        toleratedCallArguments: {
            ...(base?.toleratedCallArguments ?? {}),
            ...(custom?.toleratedCallArguments ?? {}),
        },
    };
}

/**
 * Assemble domain governance, memory, routing, and language support options.
 *
 * @param base - Base default configuration.
 * @param fileCfg - Config-file specified overrides.
 * @param overrides - Explicit CLI or runtime overrides.
 * @returns Filtered domain options.
 */
function assembleDomainOptions(
    base: ScanConfig,
    fileCfg: Partial<ScanConfig>,
    overrides: ConfigOverrides,
): Pick<
    ScanConfig,
    | 'unsupportedLanguage'
    | 'memory'
    | 'agentUid'
    | 'scoringWeights'
    | 'archetype'
    | 'sparseRouting'
    | 'signal'
> {
    return {
        unsupportedLanguage: resolveScalar(
            overrides.unsupportedLanguage,
            fileCfg.unsupportedLanguage,
            base.unsupportedLanguage,
        ),
        memory: resolveFlag(overrides.memory, fileCfg.memory, base.memory),
        agentUid: resolveScalar(overrides.agentUid, fileCfg.agentUid, base.agentUid),
        scoringWeights: resolveScalar(
            overrides.scoringWeights,
            fileCfg.scoringWeights,
            base.scoringWeights,
        ),
        archetype: overrides.archetype || fileCfg.archetype,
        sparseRouting: resolveFlag(overrides.sparseRouting, fileCfg.sparseRouting, false),
        signal: overrides.signal,
    };
}

/**
 * Apply CLI `--analyzers` allow-list filter across all declared analyzers.
 *
 * @param analyzers - Declared analyzers map.
 * @param allowList - Optional list of analyzer names to enable.
 * @returns Filtered analyzer declarations.
 */
function applyCliAnalyzersFilter(
    analyzers: Record<string, AnalyzerDeclaration>,
    allowList?: string[],
): Record<string, AnalyzerDeclaration> {
    if (!allowList || allowList.length === 0) {
        return analyzers;
    }
    const set = new Set(allowList);
    const next: Record<string, AnalyzerDeclaration> = {};
    for (const [name, decl] of Object.entries(analyzers)) {
        next[name] = { ...decl, enabled: set.has(name) };
    }
    for (const name of set) {
        if (!next[name]) next[name] = { enabled: true };
    }
    return next;
}

/** Pick raw custom analyzers array based on configuration precedence. */
function pickCustomAnalyzers(
    overrides: ConfigOverrides,
    fileCfg: Partial<ScanConfig>,
    base: ScanConfig,
): CustomAnalyzerDeclaration[] {
    if (overrides.customAnalyzers && overrides.customAnalyzers.length > 0) {
        return overrides.customAnalyzers;
    }
    if (fileCfg.customAnalyzers && fileCfg.customAnalyzers.length > 0) {
        return fileCfg.customAnalyzers;
    }
    return base.customAnalyzers ?? [];
}

/** Check whether a custom analyzer satisfies Fail-Closed sparse routing contracts (N-08). */
function isValidCustomAnalyzerContract(ca: CustomAnalyzerDeclaration): boolean {
    return Boolean(Array.isArray(ca.signals) && ca.signals.length > 0 && ca.track);
}

/** Resolve and validate customAnalyzers declarations under Fail-Closed N-08. */
function resolveCustomAnalyzersList(
    overrides: ConfigOverrides,
    fileCfg: Partial<ScanConfig>,
    base: ScanConfig,
): CustomAnalyzerDeclaration[] {
    const list = pickCustomAnalyzers(overrides, fileCfg, base);
    for (const ca of list) {
        if (ca.enabled !== false && !isValidCustomAnalyzerContract(ca)) {
            throw new Error(
                `${ERR_INVALID_CUSTOM_ANALYZER} Custom analyzer '${ca.name}' must declare 'signals' and 'track' (Fail-Closed, N-08)`,
            );
        }
    }
    return list;
}

/**
 * Resolve a final config by layering (lowest -> highest precedence):
 *   1) built-in defaults (registry + thresholds + scheduling)
 *   2) optional config file (declarative, found via --config or auto-discovery)
 *   3) explicit CLI overrides
 *
 * The `analyzers` map and `customAnalyzers` array are merged declaratively:
 *   - analyzer entries in the config file override enable/options per name
 *   - CLI `--analyzers a,b` becomes an explicit allow-list (enables those, disables the rest)
 *
 * Per-analyzer `options` are deep-merged with that analyzer's built-in defaults.
 *
 * @param overrides - CLI/API overrides; `analyzers` acts as an explicit allow-list, while
 *   omitted fields fall back to the config file and then to the built-in defaults.
 * @returns The fully merged config; a malformed config file warns and degrades to defaults
 *   instead of throwing, so callers always receive a usable configuration object.
 */
export function resolveConfig(overrides: ConfigOverrides = {}): ScanConfig {
    const root = overrides.root || process.cwd();
    const base = defaultConfig(root);
    const analyzerDefaults = defaultAnalyzerOptions();

    const { fileCfg, baseDir } = loadConfigFile(root, overrides.configFile);

    const globalThresholds = {
        ...base.thresholds,
        ...(fileCfg.thresholds || {}),
        ...(overrides.thresholds || {}),
    } as Record<string, unknown>;

    const analyzers = mergeAnalyzerDeclarations(
        base.analyzers,
        fileCfg.analyzers,
        analyzerDefaults,
        globalThresholds,
    );

    const { profile, autoTuneScale, scaleGrade, maturityTier, tunedThresholds } = applyAutoTuning(
        root,
        fileCfg,
        overrides,
        base.thresholds,
        analyzers,
    );

    const { commentLevel, securityLevel, classifyLiterals, granularRules } =
        applySemanticAndSecurityLevels(fileCfg, overrides, analyzers);

    const customAnalyzers = resolveCustomAnalyzersList(overrides, fileCfg, base);

    const merged: ScanConfig = {
        root,
        baseDir,
        include: overrides.include || fileCfg.include || base.include,
        exclude: overrides.exclude || fileCfg.exclude || base.exclude,
        analyzers: applyCliAnalyzersFilter(analyzers, overrides.analyzers),
        customAnalyzers,
        thresholds: tunedThresholds,
        commentLevel,
        securityLevel,
        autoTuneScale,
        profile,
        scaleGrade,
        maturityTier,
        classifyLiterals,
        granularRules,
        literalPolicy: mergeLiteralPolicy(base.literalPolicy, fileCfg.literalPolicy),
        ...assembleExecutionOptions(base, fileCfg, overrides),
        ...assembleReportingOptions(base, fileCfg, overrides),
        ...assembleDomainOptions(base, fileCfg, overrides),
    };

    return merged;
}
