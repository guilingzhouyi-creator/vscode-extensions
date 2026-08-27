import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ScanConfig,
  Thresholds,
  AnalyzerDeclaration,
  CustomAnalyzerDeclaration,
  AnalyzerId,
  LogLevel,
} from './types';

export const TOOL_NAME = 'auto-refactor';
export const TOOL_VERSION = '0.1.0';

/** Built-in analyzer names shipped with the engine (also usable as keys in `analyzers`). */
export const BUILTIN_ANALYZERS = ['constants', 'large-file', 'complexity'] as const;

/**
 * Default thresholds (global). Per-analyzer `options` in config are deep-merged ON TOP of these,
 * so a single analyzer can override a value locally without affecting others.
 */
export function defaultThresholds(): Thresholds {
  return {
    // constants
    magicNumberMin: 2,
    duplicateLiteralThreshold: 3,
    hardcodedStringMinLength: 3,
    // large-file
    fileLinesWarn: 400,
    fileLinesFail: 800,
    fileFunctionsWarn: 15,
    // complexity
    complexityWarn: 10,
    complexityFail: 20,
  };
}

/**
 * Per-analyzer **default options** (documented for users; see config.schema.json).
 * These are applied first, then overridden by global `thresholds`, then by the analyzer's
 * own `options` block in config. Keeping them here makes each tool's tunables explicit.
 *
 *  constants:       magicNumberMin, duplicateLiteralThreshold, hardcodedStringMinLength
 *  large-file:      fileLinesWarn, fileLinesFail, fileFunctionsWarn
 *  complexity:      complexityWarn, complexityFail
 */
export function defaultAnalyzerOptions(): Record<AnalyzerId, Record<string, any>> {
  return {
    constants: {
      magicNumberMin: 2,
      duplicateLiteralThreshold: 3,
      hardcodedStringMinLength: 3,
    },
    'large-file': {
      fileLinesWarn: 400,
      fileLinesFail: 800,
      fileFunctionsWarn: 15,
    },
    complexity: {
      complexityWarn: 10,
      complexityFail: 20,
    },
  };
}

/**
 * Default declarative registry: all built-ins registered (enabled) with no per-analyzer overrides.
 * External analyzers are NOT declared here — they are added by the user's config file via
 * `customAnalyzers` + an `analyzers.<name>` entry.
 */
export function defaultAnalyzers(): Record<string, AnalyzerDeclaration> {
  const map: Record<string, AnalyzerDeclaration> = {};
  for (const name of BUILTIN_ANALYZERS) map[name] = { enabled: true, options: {} };
  return map;
}

export function defaultConfig(root: string): ScanConfig {
  return {
    root,
    baseDir: process.cwd(),
    include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.rs'],
    exclude: ['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.vscode-test'],
    analyzers: defaultAnalyzers(),
    customAnalyzers: [],
    thresholds: defaultThresholds(),
    format: 'text',
    failOnIssue: false,
    // observability / scheduling defaults
    logLevel: 'info',
    logFile: undefined,
    concurrency: Math.max(1, Math.min(4, os.cpus().length)),
    workers: 1, // 1 = in-process (default, fastest for typical repos); >1 = worker threads for large repos on many cores
    respectGitignore: true,
    failOnAnalyzerError: false,
    parser: 'typescript',
    // Line-level incremental (docs/system-design.md): default OFF (env AR_INCREMENTAL wins).
    // `incrementalMinLines` is left unset here so the env `AR_INCREMENTAL_MIN_LINES`
    // (default 1000) takes precedence; a config file may still override it explicitly.
    incremental: false,
  };
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
 */
export function resolveConfig(
  overrides: Partial<Omit<ScanConfig, 'analyzers'>> & {
    configFile?: string;
    analyzers?: string[];
  } = {},
): ScanConfig {
  const root = overrides.root || process.cwd();
  const base = defaultConfig(root);
  const analyzerDefaults = defaultAnalyzerOptions();

  // ---- load config file (declarative source of truth) ----
  let fileCfg: Partial<ScanConfig> = {};
  let baseDir = root;
  const candidates = [
    overrides.configFile,
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
    } catch {
      /* ignore unreadable config */
    }
  }

  // ---- merge analyzer registries (declarative) ----
  const analyzers: Record<string, AnalyzerDeclaration> = { ...base.analyzers };
  if (fileCfg.analyzers) {
    for (const [name, decl] of Object.entries(fileCfg.analyzers)) {
      const defaults = analyzerDefaults[name] || {};
      analyzers[name] = {
        enabled: decl?.enabled !== false,
        options: { ...defaults, ...(analyzers[name]?.options || {}), ...(decl?.options || {}) },
      };
    }
  }
  // built-in analyzers not customized still get their default options
  for (const name of Object.keys(analyzers)) {
    if (!analyzers[name].options || Object.keys(analyzers[name].options).length === 0) {
      analyzers[name] = { ...analyzers[name], options: { ...(analyzerDefaults[name] || {}) } };
    }
  }

  const customAnalyzers: CustomAnalyzerDeclaration[] =
    fileCfg.customAnalyzers && fileCfg.customAnalyzers.length
      ? fileCfg.customAnalyzers
      : base.customAnalyzers;

  const merged: ScanConfig = {
    root,
    baseDir,
    include: overrides.include || fileCfg.include || base.include,
    exclude: overrides.exclude || fileCfg.exclude || base.exclude,
    analyzers,
    customAnalyzers,
    thresholds: { ...base.thresholds, ...(fileCfg.thresholds || {}), ...(overrides.thresholds || {}) },
    format: overrides.format || fileCfg.format || base.format,
    failOnIssue:
      typeof overrides.failOnIssue === 'boolean'
        ? overrides.failOnIssue
        : fileCfg.failOnIssue ?? base.failOnIssue,
    logLevel:
      (overrides.logLevel as LogLevel) || fileCfg.logLevel || base.logLevel,
    logFile: overrides.logFile || fileCfg.logFile || base.logFile,
    concurrency: overrides.concurrency || fileCfg.concurrency || base.concurrency,
    workers:
      typeof overrides.workers === 'number'
        ? overrides.workers
        : fileCfg.workers ?? base.workers,
    respectGitignore:
      typeof overrides.respectGitignore === 'boolean'
        ? overrides.respectGitignore
        : fileCfg.respectGitignore ?? base.respectGitignore,
    failOnAnalyzerError:
      typeof overrides.failOnAnalyzerError === 'boolean'
        ? overrides.failOnAnalyzerError
        : fileCfg.failOnAnalyzerError ?? base.failOnAnalyzerError,
    parser: overrides.parser || fileCfg.parser || base.parser,
    incremental:
      typeof overrides.incremental === 'boolean'
        ? overrides.incremental
        : fileCfg.incremental ?? base.incremental,
    incrementalMinLines:
      typeof overrides.incrementalMinLines === 'number'
        ? overrides.incrementalMinLines
        : fileCfg.incrementalMinLines ?? base.incrementalMinLines,
    out: overrides.out || fileCfg.out,
  };

  // ---- CLI --analyzers allow-list override (still declarative, just an explicit subset) ----
  if (overrides.analyzers && overrides.analyzers.length) {
    const set = new Set(overrides.analyzers);
    const next: Record<string, AnalyzerDeclaration> = {};
    for (const [name, decl] of Object.entries(merged.analyzers)) {
      next[name] = { ...decl, enabled: set.has(name) };
    }
    for (const name of set) if (!next[name]) next[name] = { enabled: true };
    merged.analyzers = next;
  }

  return merged;
}
