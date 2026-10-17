/**
 * Module: Core Engine — Declarative Configuration Resolution
 * File Path: src/core/config/config.ts
 * Architecture Role: Configuration single source of truth; builds and layers the ScanConfig
 *   consumed by every CLI, API, daemon, and worker entry point.
 * Dependencies & Triggers: Imports `fs`, `os`, `path`, core config types, project profile
 *   detection, and scale/maturity tuners; triggered by `resolveConfig` from CLI `--config`
 *   and flags, API callers, and daemon startup, plus config auto-discovery.
 * Responsibilities: Export tool identity and all 27 built-in polyglot analyzer identifiers; provide
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
    DynamicEvidenceDTO,
} from '../types';
import { DEFAULT_TOLERATED_CALL_ARGUMENTS } from '../policy/literal-policy-engine';
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
    ANALYZER_GO_MODERN,
    ANALYZER_SHELL_LINT,
    ANALYZER_STDLIB,
    ANALYZER_GDSCRIPT_GAME,
    ANALYZER_VSCODE_EXTENSION,
    ANALYZER_GATE_ARCHITECTURE,
    ANALYZER_FRONTEND,
    ANALYZER_PRODUCTION_HYGIENE,
    ANALYZER_CLIENT_EXPOSURE,
} from '../scoring/dimensionLiterals';
import {
    applySemanticAndSecurityLevels,
    assembleGlobalThresholds,
    mergeAnalyzerDeclarations,
    assembleExecutionOptions,
    assembleReportingOptions,
    mergeLiteralPolicy,
    resolveScalar,
    resolveFlag,
} from './config-cascades';
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
    // Stage 0: Physical Hygiene & Critical Security
    ANALYZER_HYGIENE,
    ANALYZER_SHELL_LINT,
    ANALYZER_LARGE_FILE,
    ANALYZER_SECRETS,
    ANALYZER_SECURITY,
    // Stage 1: Text Governance, Lexical Symbols & Documentation
    ANALYZER_COMMENTS,
    ANALYZER_NAMING,
    ANALYZER_CONSTANTS,
    ANALYZER_DOCS,
    ANALYZER_PRODUCTION_HYGIENE,
    // Stage 2: Single-file AST, Control Flow & Language Modernity
    ANALYZER_SIMPLIFY,
    ANALYZER_COMPLEXITY,
    ANALYZER_STDLIB,
    ANALYZER_TYPESCRIPT_MODERN,
    ANALYZER_PYTHON_MODERN,
    ANALYZER_RUST_MODERN,
    ANALYZER_GDSCRIPT_MODERN,
    ANALYZER_GO_MODERN,
    ANALYZER_FRONTEND,
    // Stage 3: Domain Architecture Contracts, Data Flow & Global Topology
    ANALYZER_PERFORMANCE,
    ANALYZER_ARCHITECTURE,
    ANALYZER_DATA_ARCHITECTURE,
    ANALYZER_DEPENDENCY_LAYOUT,
    ANALYZER_DEPENDENCY_GRAPH,
    ANALYZER_GATE_ARCHITECTURE,
    ANALYZER_GDSCRIPT_GAME,
    ANALYZER_VSCODE_EXTENSION,
    ANALYZER_CLIENT_EXPOSURE,
    ANALYZER_TEST_MODERNITY,
    ANALYZER_GOVERNANCE,
] as const;

// ── Built-in defaults (one definition site shared by thresholds and analyzer options) ──
/** constants analyzer defaults. */
const DEFAULT_MAGIC_NUMBER_MIN = 2;
const DEFAULT_DUPLICATE_LITERAL_THRESHOLD = 3;
const DEFAULT_HARDCODED_STRING_MIN_LENGTH = 3;
/** large-file analyzer defaults. */
const DEFAULT_FILE_LINES_WARN = 400;
const DEFAULT_FILE_LINES_FAIL = 1400;
const DEFAULT_FILE_FUNCTIONS_WARN = 15;
/** Default warning threshold for effective lines of code. */
export const DEFAULT_EFFECTIVE_LOC_WARN = 750;
/** Default failure threshold for effective lines of code. */
export const DEFAULT_EFFECTIVE_LOC_FAIL = 900;
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
const DEFAULT_SECRET_MAX_FILE_ISSUES = 50;
/** simplify analyzer default function span. */
const DEFAULT_MAX_FUNCTION_LINES = 60;
/** simplify analyzer default minimum run of commented-out lines. */
const DEFAULT_COMMENTED_CODE_MIN_LINES = 3;
/** simplify analyzer default maximum ternary expression column length. */
const DEFAULT_MAX_TERNARY_LENGTH = 80;
/** simplify analyzer default guard clause nesting limit. */
const DEFAULT_MAX_GUARD_CLAUSE_NESTING = 3;
/** Scheduler default: in-process unless the repo is big enough to amortise worker threads. */
const DEFAULT_MAX_CONCURRENCY = 4;

const SEVERITY_ERROR = 'error';
const SEVERITY_WARN = 'warning';
const LEVEL_STANDARD = 'standard';
const LEVEL_BASIC = 'basic';
const FORMAT_TEXT = 'text';
const LOG_LEVEL_INFO = 'info';
const DEFAULT_AGENT_UID = 'default-agent';
const CONFIG_FILE_NAME = 'auto-refactor.config.json';
const FS_OP_EXISTS = 'existsSync';
const FS_OP_READ_FILE = 'readFileSync';
const ENCODING_UTF8 = 'utf8';

const DEFAULT_EXCLUDE_GLOBS: readonly string[] = Object.freeze(
    'node_modules .git dist build out coverage .next .vscode-test'.split(' '),
);

const DEFAULT_EFFECTIVE_LOC_BOUNDS = Object.freeze({
    effectiveLocWarn: DEFAULT_EFFECTIVE_LOC_WARN,
    effectiveLocFail: DEFAULT_EFFECTIVE_LOC_FAIL,
});

/** `typeof` tag used to validate boolean overrides before they are layered into the config. */
const _TYPEOF_BOOLEAN = 'boolean';
const TYPEOF_STRING = 'string';
const TYPEOF_OBJECT = 'object';
const DELIM_COMMA = ',';

function isStringValue(candidateInput: unknown): candidateInput is string {
    return typeof candidateInput === TYPEOF_STRING;
}

function isPlainObject(candidateInput: unknown): candidateInput is Record<string, unknown> {
    return (
        typeof candidateInput === TYPEOF_OBJECT &&
        candidateInput !== null &&
        !Array.isArray(candidateInput)
    );
}

/**
 * Default thresholds (global). Per-analyzer `options` in config are deep-merged ON TOP of these,
 * so a single analyzer can override a value locally without affecting others.
 *
 * @returns A fresh threshold object with engine defaults for constants, large-file, complexity.
 */
export function getDefaultThresholds(): Thresholds {
    return {
        // constants
        magicNumberMin: DEFAULT_MAGIC_NUMBER_MIN,
        duplicateLiteralThreshold: DEFAULT_DUPLICATE_LITERAL_THRESHOLD,
        hardcodedStringMinLength: DEFAULT_HARDCODED_STRING_MIN_LENGTH,
        // large-file
        fileLinesWarn: DEFAULT_FILE_LINES_WARN,
        fileLinesFail: DEFAULT_FILE_LINES_FAIL,
        fileFunctionsWarn: DEFAULT_FILE_FUNCTIONS_WARN,
        ...DEFAULT_EFFECTIVE_LOC_BOUNDS,
        // complexity
        complexityWarn: DEFAULT_COMPLEXITY_WARN,
        complexityFail: DEFAULT_COMPLEXITY_FAIL,
        // simplify
        maxFunctionLines: DEFAULT_MAX_FUNCTION_LINES,
    };
}

function getCoreAnalyzerDefaults(): Record<string, Record<string, any>> {
    return {
        constants: {
            magicNumberMin: DEFAULT_MAGIC_NUMBER_MIN,
            duplicateLiteralThreshold: DEFAULT_DUPLICATE_LITERAL_THRESHOLD,
            hardcodedStringMinLength: DEFAULT_HARDCODED_STRING_MIN_LENGTH,
            ignoreLiterals: [],
        },
        'large-file': {
            fileLinesWarn: DEFAULT_FILE_LINES_WARN,
            fileLinesFail: DEFAULT_FILE_LINES_FAIL,
            fileFunctionsWarn: DEFAULT_FILE_FUNCTIONS_WARN,
            ...DEFAULT_EFFECTIVE_LOC_BOUNDS,
        },
        complexity: {
            complexityWarn: DEFAULT_COMPLEXITY_WARN,
            complexityFail: DEFAULT_COMPLEXITY_FAIL,
            blockingIoAllowPatterns: [],
            allocationAllowPatterns: [],
        },
        governance: {
            maxNestingDepth: DEFAULT_MAX_NESTING_DEPTH,
            maxInheritanceDepth: DEFAULT_MAX_INHERITANCE_DEPTH,
            blockingIoAllowPatterns: [],
            allocationAllowPatterns: [],
        },
    };
}

function getSpecializedAnalyzerDefaults(): Record<string, Record<string, any>> {
    return {
        'dependency-graph': {
            detectCycles: false,
            cycleSeverity: SEVERITY_ERROR,
            maxCyclesReported: DEFAULT_MAX_CYCLES_REPORTED,
            detectUnusedExports: false,
            entryGlobs: [],
            unusedSeverity: SEVERITY_WARN,
        },
        secrets: {
            entropy: {
                enabled: false,
                minLength: DEFAULT_SECRET_ENTROPY_MIN_LENGTH,
                threshold: DEFAULT_SECRET_ENTROPY_THRESHOLD,
                severity: SEVERITY_WARN,
            },
            maxIssuesPerFile: DEFAULT_SECRET_MAX_FILE_ISSUES,
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
            level: LEVEL_STANDARD,
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
            checkGuardClauses: false,
            maxGuardClauseNesting: DEFAULT_MAX_GUARD_CLAUSE_NESTING,
            checkTernarySimplification: true,
            maxTernaryLength: DEFAULT_MAX_TERNARY_LENGTH,
            rewardSimplifications: true,
            checkRedundantElse: true,
            checkBooleanReturn: true,
            checkGuardClausePatterns: true,
            maxGuardClausePatternNesting: DEFAULT_MAX_GUARD_CLAUSE_NESTING,
        },
        security: {
            level: LEVEL_BASIC,
        },
    };
}

/**
 * Per-analyzer **default options** (documented for users; see config.schema.json).
 * These are applied first, then overridden by global `thresholds`, then by the analyzer's
 * own `options` block in config. Keeping them here makes each tool's tunables explicit.
 *
 * @returns A fresh analyzer-id-keyed map of default options that callers may mutate safely.
 */
export function getDefaultAnalyzerOptions(): Record<AnalyzerId, Record<string, any>> {
    return {
        ...getCoreAnalyzerDefaults(),
        ...getSpecializedAnalyzerDefaults(),
    } as Record<AnalyzerId, Record<string, any>>;
}

const EMPTY_ANALYZER_OPTIONS: Readonly<Record<string, unknown>> = Object.freeze({});

/**
 * Default declarative registry: built-in core registered.
 * Specialized tiers (governance, architecture, performance, comments, hygiene, security)
 * are enabled when declared in config or CLI allow-list to maintain 100% byte equivalence.
 *
 * @returns A fresh registry mapping every built-in analyzer name to its enabled flag/options.
 */
export function getDefaultAnalyzers(): Record<string, AnalyzerDeclaration> {
    const map: Record<string, AnalyzerDeclaration> = {};
    for (const name of BUILTIN_ANALYZERS) {
        map[name] = { enabled: !SPECIALIZED_ANALYZERS.has(name), options: EMPTY_ANALYZER_OPTIONS };
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
export function getDefaultConfig(root: string): ScanConfig {
    return {
        root,
        baseDir: process.cwd(),
        include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.rs', '**/*.gd'],
        exclude: [...DEFAULT_EXCLUDE_GLOBS],
        analyzers: getDefaultAnalyzers(),
        customAnalyzers: [],
        thresholds: getDefaultThresholds(),
        format: FORMAT_TEXT,
        failOnIssue: false,
        failOnSeverity: undefined,
        suppressions: [],
        baselineGranularity: 'id',
        literalPolicy: {
            toleratedCallArguments: { ...DEFAULT_TOLERATED_CALL_ARGUMENTS },
        },
        // observability / scheduling defaults
        logLevel: LOG_LEVEL_INFO,
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
        commentLevel: LEVEL_STANDARD,
        securityLevel: LEVEL_BASIC,
        // Fail closed by default: files no adapter can parse must not look like a clean scan.
        unsupportedLanguage: SEVERITY_ERROR,
        memory: true,
        agentUid: DEFAULT_AGENT_UID,
        scoringWeights: undefined,
    };
}

/**
 * Locate the first existing configuration candidate from a list of paths.
 *
 * @param candidates - Potential config file candidate paths.
 * @returns Path of first existing file, or undefined if none exist.
 */
function findFirstExistingCandidate(candidates: string[]): string | undefined {
    const existsFn = fs[FS_OP_EXISTS];
    for (const c of candidates) {
        if (existsFn(c)) return c;
    }
    return undefined;
}

function readTextFile(filePath: string): string {
    const readFn = fs[FS_OP_READ_FILE];
    return readFn(filePath, ENCODING_UTF8);
}

function loadConfigFile(
    root: string,
    configFile?: string,
): { fileCfg: Partial<ScanConfig>; baseDir: string } {
    let fileCfg: Partial<ScanConfig> = {};
    let baseDir = root;
    const isDifferentRoot = path.resolve(root) !== path.resolve(process.cwd());
    const candidates = [
        configFile,
        path.join(root, CONFIG_FILE_NAME),
        !isDifferentRoot ? path.join(process.cwd(), CONFIG_FILE_NAME) : undefined,
    ].filter(Boolean) as string[];

    const existingFile = findFirstExistingCandidate(candidates);
    if (existingFile) {
        try {
            fileCfg = JSON.parse(readTextFile(existingFile));
            baseDir = path.dirname(path.resolve(existingFile));
        } catch (e) {
            console.warn(
                `[auto-refactor] config file exists but is invalid/unreadable, falling back to defaults: ${existingFile} ` +
                    `(${e instanceof Error ? e.message : String(e)})`,
            );
        }
    }
    return { fileCfg, baseDir };
}

/**
 * Load dynamic telemetry evidence from file if path is specified and valid.
 */
function loadTelemetryData(root: string, telemetryPath?: string): DynamicEvidenceDTO | undefined {
    if (!telemetryPath) return undefined;
    const resolvedPath = path.isAbsolute(telemetryPath)
        ? telemetryPath
        : path.resolve(root, telemetryPath);
    try {
        const existsFn = fs[FS_OP_EXISTS];
        if (existsFn(resolvedPath)) {
            const raw = readTextFile(resolvedPath);
            return JSON.parse(raw) as DynamicEvidenceDTO;
        }
    } catch (_err) {
        return undefined;
    }
    return undefined;
}

/**
 * Assemble domain governance, memory, routing, and language support options.
 *
 * @param root - Project scan root directory.
 * @param base - Base default configuration.
 * @param fileCfg - Config-file specified overrides.
 * @param overrides - Explicit CLI or runtime overrides.
 * @returns Filtered domain options.
 */
function assembleDomainOptions(
    root: string,
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
    | 'telemetry'
    | 'telemetryData'
> {
    const telemetry = overrides.telemetry || fileCfg.telemetry;
    const telemetryData =
        overrides.telemetryData || fileCfg.telemetryData || loadTelemetryData(root, telemetry);
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
        telemetry,
        telemetryData,
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
    allowList?: unknown,
): Record<string, AnalyzerDeclaration> {
    if (!allowList) return analyzers;
    let items: string[];
    if (Array.isArray(allowList)) {
        items = allowList;
    } else if (isStringValue(allowList)) {
        items = allowList
            .split(DELIM_COMMA)
            .map((s) => s.trim())
            .filter(Boolean);
    } else if (isPlainObject(allowList)) {
        items = Object.keys(allowList).filter((k) => Boolean(allowList[k]));
    } else {
        return analyzers;
    }
    if (items.length === 0) return analyzers;

    const set = new Set(items);
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
function getCustomAnalyzers(
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
function isValidCustomAnalyzerContract(customAnalyzer: CustomAnalyzerDeclaration): boolean {
    return Boolean(
        Array.isArray(customAnalyzer.signals) &&
            customAnalyzer.signals.length > 0 &&
            customAnalyzer.track,
    );
}

/** Resolve and validate customAnalyzers declarations under Fail-Closed N-08. */
function resolveCustomAnalyzersList(
    overrides: ConfigOverrides,
    fileCfg: Partial<ScanConfig>,
    base: ScanConfig,
): CustomAnalyzerDeclaration[] {
    const list = getCustomAnalyzers(overrides, fileCfg, base);
    for (const customAnalyzer of list) {
        if (customAnalyzer.enabled !== false && !isValidCustomAnalyzerContract(customAnalyzer)) {
            throw new Error(
                `${ERR_INVALID_CUSTOM_ANALYZER} Custom analyzer '${customAnalyzer.name}' must declare 'signals' and 'track' (Fail-Closed, N-08)`,
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
    const base = getDefaultConfig(root);
    const analyzerDefaults = getDefaultAnalyzerOptions();

    const { fileCfg, baseDir } = loadConfigFile(root, overrides.configFile);
    const globalThresholds = assembleGlobalThresholds(
        base.thresholds,
        fileCfg.thresholds,
        overrides.thresholds,
        overrides,
    );

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
        ...assembleDomainOptions(root, base, fileCfg, overrides),
    };

    return merged;
}
