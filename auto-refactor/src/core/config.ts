/**
 * Module: Core Engine — Declarative Configuration Resolution
 * File Path: src/core/config.ts
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
    CommentLevel,
    SecurityLevel,
} from './types';

import { detectProjectProfile, detectMaturityTier } from './profiler/projectProfiler';
import {
    evaluateScaleGrade,
    getTunedThresholds,
    getTunedAnalyzerOptions,
    getMaturityTunedThresholds,
    getMaturityTunedAnalyzerOptions,
} from './profiler/scaleTuner';

/** Public tool identity string that consumers can surface in banners, reports, and logs. */
export const TOOL_NAME = 'auto-refactor';

/**
 * Engine semantic version recorded in cache keys so stale entries invalidate across releases.
 * Keep it in sync with `package.json` whenever report or cache contracts change.
 */
export const TOOL_VERSION = '0.3.0';

/** Built-in `constants` analyzer id; keys its `analyzers.constants` declaration. */
const ANALYZER_CONSTANTS = 'constants';

/** Built-in `secrets` analyzer id; keys its `analyzers.secrets` declaration. */
const ANALYZER_SECRETS = 'secrets';

/** Built-in `architecture` analyzer id; keys its `analyzers.architecture` declaration. */
const ANALYZER_ARCHITECTURE = 'architecture';

/** Built-in `comments` analyzer id; keys its `analyzers.comments` declaration. */
const ANALYZER_COMMENTS = 'comments';

/** Built-in `security` analyzer id; keys its `analyzers.security` declaration. */
const ANALYZER_SECURITY = 'security';

/** Built-in `ts-modern` analyzer id; a specialized language pack, declared to be enabled. */
const ANALYZER_TYPESCRIPT_MODERN = 'ts-modern';

/** Built-in `rust-modern` analyzer id; a specialized language pack, declared to be enabled. */
const ANALYZER_RUST_MODERN = 'rust-modern';

/** Built-in `gdscript-modern` analyzer id; a specialized language pack, declared to be enabled. */
const ANALYZER_GDSCRIPT_MODERN = 'gdscript-modern';

/**
 * Analyzers that stay disabled until a config or CLI allow-list declares them.
 *
 * A Set keeps the lookup flat: the previous `name === 'x' || …` chain pushed the enclosing
 * function over the complexity threshold every time a pack was added, and the membership test is
 * the same question for every entry.
 */
const SPECIALIZED_ANALYZERS = new Set<string>([
    'governance',
    ANALYZER_ARCHITECTURE,
    'performance',
    ANALYZER_COMMENTS,
    'hygiene',
    ANALYZER_SECURITY,
    'simplify',
    'python-modern',
    ANALYZER_TYPESCRIPT_MODERN,
    ANALYZER_RUST_MODERN,
    ANALYZER_GDSCRIPT_MODERN,
    'docs',
]);

/** Built-in analyzer names shipped with the engine (also usable as keys in `analyzers`). */
export const BUILTIN_ANALYZERS = [
    ANALYZER_CONSTANTS,
    'large-file',
    'complexity',
    'governance',
    'dependency-graph',
    ANALYZER_SECRETS,
    ANALYZER_ARCHITECTURE,
    'performance',
    ANALYZER_COMMENTS,
    'hygiene',
    ANALYZER_SECURITY,
    'simplify',
    'python-modern',
    ANALYZER_TYPESCRIPT_MODERN,
    ANALYZER_RUST_MODERN,
    ANALYZER_GDSCRIPT_MODERN,
    'docs',
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
/** Auto-tune estimate: source lines per profiled language entry. */
const SLOC_PER_LANGUAGE_SAMPLE = 100;
/** Auto-tune secret heuristics (securityLevel=full) are slightly looser than the defaults. */
const AUTO_TUNE_SECRET_MIN_LENGTH = 24;
const AUTO_TUNE_SECRET_ENTROPY_THRESHOLD = 4.2;

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

/** CLI, API, or caller overrides accepted by {@link resolveConfig}. */
export type ConfigOverrides = Partial<Omit<ScanConfig, 'analyzers'>> & {
    configFile?: string;
    analyzers?: string[];
};

/**
 * Auto-tune scale grades, maturity tiers, and corresponding thresholds/analyzer options.
 *
 * @param root - Project root directory.
 * @param fileCfg - File-level configuration overrides.
 * @param overrides - CLI/API overrides.
 * @param baseThresholds - Base built-in thresholds.
 * @param analyzers - Mutable analyzer declarations map to update with tuned options.
 * @returns Object containing profile, autoTuneScale, scaleGrade, maturityTier, and tunedThresholds.
 */
function applyAutoTuning(
    root: string,
    fileCfg: Partial<ScanConfig>,
    overrides: ConfigOverrides,
    baseThresholds: Thresholds,
    analyzers: Record<string, AnalyzerDeclaration>,
): {
    profile: ReturnType<typeof detectProjectProfile>;
    autoTuneScale: boolean;
    scaleGrade: any;
    maturityTier: any;
    tunedThresholds: Thresholds;
} {
    const profile = fileCfg.profile || overrides.profile || detectProjectProfile(root);
    const autoTuneScale = overrides.autoTuneScale ?? fileCfg.autoTuneScale ?? false;
    let tunedThresholds: Thresholds = {
        ...baseThresholds,
        ...(fileCfg.thresholds || {}),
        ...(overrides.thresholds || {}),
    };
    let scaleGrade = fileCfg.scaleGrade || overrides.scaleGrade;

    if (autoTuneScale) {
        const sampleCount = Object.values(profile.languages).reduce((a, b) => a + b, 0);
        scaleGrade ||= evaluateScaleGrade({
            fileCount: sampleCount * 2,
            sloc: sampleCount * 2 * SLOC_PER_LANGUAGE_SAMPLE,
        });
        if (!fileCfg.thresholds && !overrides.thresholds) {
            tunedThresholds = getTunedThresholds(scaleGrade, tunedThresholds);
        }
        for (const [name, decl] of Object.entries(analyzers)) {
            decl.options = getTunedAnalyzerOptions(scaleGrade, name, decl.options || {});
        }
    }

    const maturityTier =
        (overrides as any).maturityTier ||
        (fileCfg as any).maturityTier ||
        (autoTuneScale ? detectMaturityTier(root) : undefined);
    if (maturityTier) {
        if (!fileCfg.thresholds && !overrides.thresholds) {
            tunedThresholds = getMaturityTunedThresholds(maturityTier, tunedThresholds);
        }
        for (const [name, decl] of Object.entries(analyzers)) {
            decl.options = getMaturityTunedAnalyzerOptions(maturityTier, name, decl.options || {});
        }
    }

    return { profile, autoTuneScale, scaleGrade, maturityTier, tunedThresholds };
}

/**
 * Cascade security level settings to security, secrets, and architecture analyzers.
 *
 * @param securityLevel - Configured security level.
 * @param overridesSecLevel - Security level specified in CLI/API overrides.
 * @param fileCfgSecLevel - Security level specified in config file.
 * @param analyzers - Analyzer declarations map.
 */
function cascadeSecurityLevel(
    securityLevel: string,
    overridesSecLevel: string | undefined,
    fileCfgSecLevel: string | undefined,
    analyzers: Record<string, AnalyzerDeclaration>,
): void {
    if (securityLevel === 'off') {
        if (analyzers[ANALYZER_SECURITY]) analyzers[ANALYZER_SECURITY].enabled = false;
        if (analyzers[ANALYZER_SECRETS]) analyzers[ANALYZER_SECRETS].enabled = false;
        return;
    }
    if (!overridesSecLevel && !fileCfgSecLevel) return;

    if (analyzers[ANALYZER_SECURITY]) {
        analyzers[ANALYZER_SECURITY].enabled = true;
        analyzers[ANALYZER_SECURITY].options = {
            ...(analyzers[ANALYZER_SECURITY].options || {}),
            level: securityLevel,
        };
    }
    if (analyzers[ANALYZER_SECRETS]) {
        analyzers[ANALYZER_SECRETS].enabled = true;
        analyzers[ANALYZER_SECRETS].options = {
            ...(analyzers[ANALYZER_SECRETS].options || {}),
            level: securityLevel,
            entropy:
                securityLevel === 'full'
                    ? {
                          enabled: true,
                          minLength: AUTO_TUNE_SECRET_MIN_LENGTH,
                          threshold: AUTO_TUNE_SECRET_ENTROPY_THRESHOLD,
                      }
                    : analyzers[ANALYZER_SECRETS].options?.entropy || { enabled: false },
        };
    }
    if (analyzers[ANALYZER_ARCHITECTURE]) {
        analyzers[ANALYZER_ARCHITECTURE].options = {
            ...(analyzers[ANALYZER_ARCHITECTURE].options || {}),
            securityLevel,
            checkDtoCredentialLeakage: securityLevel === 'full',
        };
    }
}

/**
 * Cascade literal classification, comment levels, and security levels into analyzer declarations.
 *
 * @param fileCfg - File-level configuration overrides.
 * @param overrides - CLI/API overrides.
 * @param analyzers - Mutable analyzer declarations map to update with cascaded options.
 * @returns Object with resolved commentLevel, securityLevel, classifyLiterals, and granularRules.
 */
function applySemanticAndSecurityLevels(
    fileCfg: Partial<ScanConfig>,
    overrides: ConfigOverrides,
    analyzers: Record<string, AnalyzerDeclaration>,
): {
    commentLevel: CommentLevel;
    securityLevel: SecurityLevel;
    classifyLiterals: any;
    granularRules: any;
} {
    const classifyLiterals =
        (overrides as any).classifyLiterals ?? (fileCfg as any).classifyLiterals;
    const granularRules = (overrides as any).granularRules ?? (fileCfg as any).granularRules;
    if (
        analyzers[ANALYZER_CONSTANTS] &&
        (classifyLiterals !== undefined || granularRules !== undefined)
    ) {
        analyzers[ANALYZER_CONSTANTS].options = {
            ...(analyzers[ANALYZER_CONSTANTS].options || {}),
            ...(classifyLiterals !== undefined ? { classifyLiterals } : {}),
            ...(granularRules !== undefined ? { granularRules } : {}),
        };
    }

    const commentLevel: CommentLevel = (overrides.commentLevel || fileCfg.commentLevel || 'standard') as CommentLevel;
    const securityLevel: SecurityLevel = (overrides.securityLevel || fileCfg.securityLevel || 'basic') as SecurityLevel;

    if (analyzers[ANALYZER_COMMENTS] && (overrides.commentLevel || fileCfg.commentLevel)) {
        analyzers[ANALYZER_COMMENTS].enabled = commentLevel !== 'off';
        analyzers[ANALYZER_COMMENTS].options = {
            ...(analyzers[ANALYZER_COMMENTS].options || {}),
            level: commentLevel,
        };
    }

    cascadeSecurityLevel(securityLevel, overrides.securityLevel, fileCfg.securityLevel, analyzers);

    return { commentLevel, securityLevel, classifyLiterals, granularRules };
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
        concurrency: overrides.concurrency || fileCfg.concurrency || base.concurrency,
        workers:
            typeof overrides.workers === 'number'
                ? overrides.workers
                : (fileCfg.workers ?? base.workers),
        respectGitignore: isBooleanFlag(overrides.respectGitignore)
            ? overrides.respectGitignore
            : (fileCfg.respectGitignore ?? base.respectGitignore),
        failOnIssue: isBooleanFlag(overrides.failOnIssue)
            ? overrides.failOnIssue
            : (fileCfg.failOnIssue ?? base.failOnIssue),
        failOnSeverity:
            (overrides.failOnSeverity as ScanConfig['failOnSeverity']) ||
            fileCfg.failOnSeverity ||
            base.failOnSeverity,
        failOnAnalyzerError: isBooleanFlag(overrides.failOnAnalyzerError)
            ? overrides.failOnAnalyzerError
            : (fileCfg.failOnAnalyzerError ?? base.failOnAnalyzerError),
        parser: overrides.parser || fileCfg.parser || base.parser,
        cacheEnabled: (overrides as any).cache === false ? false : base.cacheEnabled,
        incremental: isBooleanFlag(overrides.incremental)
            ? overrides.incremental
            : (fileCfg.incremental ?? base.incremental),
        incrementalMinLines:
            typeof overrides.incrementalMinLines === 'number'
                ? overrides.incrementalMinLines
                : (fileCfg.incrementalMinLines ?? base.incrementalMinLines),
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
        unsupportedLanguage:
            overrides.unsupportedLanguage ||
            fileCfg.unsupportedLanguage ||
            base.unsupportedLanguage,
        memory: isBooleanFlag(overrides.memory)
            ? overrides.memory
            : (fileCfg.memory ?? base.memory),
        agentUid: overrides.agentUid || fileCfg.agentUid || base.agentUid,
        scoringWeights: overrides.scoringWeights || fileCfg.scoringWeights || base.scoringWeights,
        archetype: (overrides as any).archetype || (fileCfg as any).archetype,
        sparseRouting: isBooleanFlag((overrides as any).sparseRouting)
            ? (overrides as any).sparseRouting
            : ((fileCfg as any).sparseRouting ?? false),
        signal: (overrides as any).signal,
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
export function resolveConfig(
    overrides: ConfigOverrides = {},
): ScanConfig {
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

    const customAnalyzers: CustomAnalyzerDeclaration[] =
        (fileCfg.customAnalyzers && fileCfg.customAnalyzers.length
            ? fileCfg.customAnalyzers
            : base.customAnalyzers) || [];

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
        ...assembleExecutionOptions(base, fileCfg, overrides),
        ...assembleReportingOptions(base, fileCfg, overrides),
        ...assembleDomainOptions(base, fileCfg, overrides),
    };

    return merged;
}

