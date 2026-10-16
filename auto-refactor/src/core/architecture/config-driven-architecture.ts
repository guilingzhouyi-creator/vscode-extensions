/**
 * Module: Core Architecture — Config-Driven Architecture Recognizer & Maturity Scorer
 * File Path: src/core/architecture/config-driven-architecture.ts
 * Architecture Role: Evaluates project configuration governance, separating dynamic behaviors
 *   from core domain logic and calculating the Config-Driven Architecture Maturity Score (CDAMS).
 * Dependencies & Triggers: Consumes Issue schema and scoring dimension literals; invoked during
 *   architecture audits and meta-architecture evaluations.
 * Responsibilities: Detect dead config (ARCH-CFG-002), duplicate config (ARCH-CFG-003),
 *   implicit config in domain (ARCH-CFG-004), scattered config access (ARCH-CFG-005),
 *   config-business coupling (ARCH-CFG-006), and over-abstracted config (ARCH-CFG-007);
 *   calibrate evaluation thresholds against project scale profile (small vs medium vs large).
 * Exit Semantics & Design Rationale: Deterministic in-memory analysis; zero synchronous disk I/O;
 *   returns explainable maturity breakdown and actionable refactoring diagnostics.
 */

import type { Issue } from '../types';
import { SEVERITY_INFO, SEVERITY_WARNING } from '../types';
import {
    ANALYZER_ARCHITECTURE,
    RULE_ARCH_CFG_002,
    RULE_ARCH_CFG_003,
    RULE_ARCH_CFG_004,
    RULE_ARCH_CFG_005,
    RULE_ARCH_CFG_006,
    RULE_ARCH_CFG_007,
    RULE_ARCH_CFG_008,
    RULE_ARCH_CFG_009,
} from '../scoring/dimensionLiterals';

/**
 * File descriptor passed into config-driven architecture analysis.
 */
export interface ConfigScanFile {
    filePath: string;
    content: string;
    imports?: string[];
    isDomainCore?: boolean;
}

/**
 * Project scale metadata used for elastic threshold calibration.
 */
export interface ProjectScaleProfile {
    fileCount: number;
    domainCount: number;
    totalLoc?: number;
}

/**
 * Maturity tiers for config-driven architecture.
 */
export type ConfigMaturityGrade = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

/**
 * Fine-grained score breakdown across the 5 dimensions of config maturity.
 */
export interface ConfigMaturityBreakdown {
    /** Ratio of variable concerns cleanly extracted from domain core. */
    separationScore: number;
    /** Ratio of active config entries participating in control flow decisions. */
    decisionParticipationScore: number;
    /** Score reflecting absence of duplicate or implicit configuration. */
    hygieneScore: number;
    /** Score reflecting decoupled access via registries/ports rather than raw I/O. */
    decouplingScore: number;
    /** Elastic scale bonus/adjustment. */
    scaleCalibrationScore: number;
}

/**
 * Result of config-driven architecture analysis.
 */
export interface ConfigDrivenAnalysisResult {
    maturityScore: number;
    maturityGrade: ConfigMaturityGrade;
    maturityLevel: number;
    breakdown: ConfigMaturityBreakdown;
    issues: Issue[];
    declaredConfigKeyCount: number;
    referencedConfigKeyCount: number;
    recommendations: string[];
}

/**
 * Tunable options for config-driven architecture auditing.
 */
export interface ConfigDrivenOptions {
    /** Minimum references required before a declared config key is deemed active. */
    minReferencesForActive?: number;
    /** Custom regex patterns identifying configuration files. */
    configFilePatterns?: RegExp[];
    /** Custom keywords identifying implicit configuration access. */
    implicitConfigKeywords?: string[];
    /**
     * Threshold of flat config tables in a single directory before flagging sprawl (default: 12).
     */
    maxFlatConfigThreshold?: number;
}

const DEFAULT_CONFIG_FILE_PATTERNS = [
    /(?:^|[\\/])(?:config|settings|preferences)[\\/].*\.(?:json|ya?ml|toml|ts|js|gd)$/i,
    /\.(?:config|rc)\.(?:json|ya?ml|toml|ts|js)$/i,
    /\.env(?:\.[a-zA-Z0-9_-]+)?$/i,
];

const IMPLICIT_ENV_PATTERNS = [
    /process\.env\.[A-Z0-9_]+/g,
    /process\.env\[['"][A-Z0-9_]+['"]\]/g,
    /os\.environ(?:\.get\(|\[)['"][A-Z0-9_]+['"]/g,
    /ENV\[['"][A-Z0-9_]+['"]\]/g,
];

const RAW_CONFIG_IO_PATTERNS = [
    /fs\.readFileSync\([^)]*config[^)]*\)/gi,
    /fs\.promises\.readFile\([^)]*config[^)]*\)/gi,
    /readFileSync\([^)]*config[^)]*\)/gi,
    /FileAccess\.open\([^)]*config[^)]*\)/gi,
];

const SCATTERED_CONFIG_PATTERNS = ['config.', 'Config.', 'GameConfig.', 'readFileSync'] as const;

const SCALE_SCORE_SMALL_PROJECT = 90;
const SCALE_SCORE_STANDARD_PROJECT = 80;

/** Maximum recursive depth for configuration object parsing. */
const MAX_CONFIG_OBJECT_DEPTH = 5;

/** Standard column limit used in diagnostic location ranges. */
const DIAGNOSTIC_END_COLUMN = 80;

/** Maximum samples shown in diagnostic details or summaries. */
const MAX_DIAGNOSTIC_SAMPLES = 3;

/** Standard 100 percentage baseline. */
const MAX_PERCENT_SCORE = 100;

/** Threshold constants for small vs standard project scaling. */
const SMALL_PROJECT_MAX_FILES = 25;
const SMALL_PROJECT_MAX_DOMAINS = 2;

/** Declarative score tier cutoffs without flat prefix clustering. */
const EXCELLENT_MIN_SCORE = 90;
const GOOD_MIN_SCORE = 75;
const PASS_MIN_SCORE = 60;
const BASIC_MIN_SCORE = 40;

const TOP_TIER_LEVEL = 4;
const ADVANCED_TIER_LEVEL = 3;
const INTERMEDIATE_TIER_LEVEL = 2;
const INITIAL_TIER_LEVEL = 1;

/** Declarative maturity grade ladder mapping minimum scores to tier grades. */
const MATURITY_GRADE_LADDER: readonly {
    readonly minScore: number;
    readonly level: number;
    readonly grade: ConfigMaturityGrade;
}[] = [
    { minScore: EXCELLENT_MIN_SCORE, level: TOP_TIER_LEVEL, grade: 'L4' },
    { minScore: GOOD_MIN_SCORE, level: ADVANCED_TIER_LEVEL, grade: 'L3' },
    { minScore: PASS_MIN_SCORE, level: INTERMEDIATE_TIER_LEVEL, grade: 'L2' },
    { minScore: BASIC_MIN_SCORE, level: INITIAL_TIER_LEVEL, grade: 'L1' },
];

/** Weight penalties and ratios for maturity score calculation. */
const BASE_ACTIVE_CONFIG_SCORE = 70;
const BASE_INACTIVE_CONFIG_SCORE = 30;
const DECLARED_CONFIG_BONUS = 30;

const PENALTY_DUPLICATE_CONFIG = 10;
const PENALTY_DIRECT_ENV = 15;
const PENALTY_FLAT_SPRAWL = 15;
const PENALTY_DIRECT_IO_SMALL = 10;
const PENALTY_UNROUTED_SUBTABLE_SMALL = 10;
const PENALTY_DIRECT_IO_STANDARD = 20;
const PENALTY_UNROUTED_SUBTABLE_STANDARD = 12;

/** Thresholds for over-abstraction detection. */
const OVER_ABSTRACTION_FILE_LIMIT = 30;
const OVER_ABSTRACTION_MIN_CONFIGS = 6;
const DEFAULT_FLAT_CONFIG_SPRAWL_THRESHOLD = 12;

const _DOMAIN_SEGMENT = '/domain/';
const _CORE_SEGMENT = '/core/';
const DOMAIN_OR_CORE_RE = /\/(?:domain|core)\//;

/** Immutable set of standard structural keys ignored during config key extraction. */
const IGNORED_CONFIG_KEYS: ReadonlySet<string> = new Set(['type', 'id', 'name', 'version']);

/** Fast pre-compiled pattern matching routing or test paths. */
const ROUTER_OR_TEST_PATH_RE = /(?:router|config_router|test|tests)/;

/** Fast pre-compiled pattern matching sanctioned unrouted router invocations. */
const UNROUTED_CALL_RE = /(?:get_subtable|ConfigRouter|config_router|routes\.|router\.)/;

/** Fast pre-compiled pattern matching configuration override suffixes. */
const OVERRIDE_SEGMENT_RE = /\.override\./;

/**
 * Extracts configuration keys from JSON or structured object literals.
 */
function extractDeclaredKeys(content: string): Set<string> {
    const keys = new Set<string>();
    const trimmed = content.trim();
    if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
        try {
            const parsed = JSON.parse(trimmed);
            collectObjectKeys(parsed, keys);
            return keys;
        } catch (_err) {
            // Best-effort JSON parse: ignore error and fall back to
            // regex extraction on malformed/commented JSON
            void _err;
        }
    }

    // Match JSON, YAML, TOML or JS object keys: "key":, key:, key =
    const keyRegex = /["']?([a-zA-Z0-9_$-]+)["']?\s*[:=]\s*[^\s]/g;
    let match: RegExpExecArray | null;
    while ((match = keyRegex.exec(content)) !== null) {
        const key = match[1];
        if (key && key.length >= 2 && !IGNORED_CONFIG_KEYS.has(key)) {
            keys.add(key);
        }
    }
    return keys;
}

function collectObjectKeys(targetRecord: unknown, keys: Set<string>, depth = 0): void {
    if (!targetRecord || typeof targetRecord !== 'object' || depth > MAX_CONFIG_OBJECT_DEPTH)
        return;
    for (const [k, v] of Object.entries(targetRecord)) {
        if (k && k.length >= 2 && isNaN(Number(k)) && !IGNORED_CONFIG_KEYS.has(k)) {
            keys.add(k);
        }
        if (v && typeof v === 'object') {
            collectObjectKeys(v, keys, depth + 1);
        }
    }
}

/**
 * Tests whether a normalized path matches any of the configuration file patterns.
 *
 * @param normPath - Normalized file path to test.
 * @param patterns - Regular expressions identifying configuration file paths.
 * @returns True if the path matches any pattern, false otherwise.
 */
function matchesConfigFile(normPath: string, patterns: readonly RegExp[]): boolean {
    for (let i = 0; i < patterns.length; i++) {
        if (patterns[i].test(normPath)) return true;
    }
    return false;
}

function partitionScanFiles(
    files: ConfigScanFile[],
    patterns: RegExp[],
): { configFiles: ConfigScanFile[]; sourceFiles: ConfigScanFile[] } {
    const configFiles: ConfigScanFile[] = [];
    const sourceFiles: ConfigScanFile[] = [];
    for (const file of files) {
        const normPath = file.filePath.replace(/\\/g, '/');
        if (matchesConfigFile(normPath, patterns)) {
            configFiles.push(file);
        } else {
            sourceFiles.push(file);
        }
    }
    return { configFiles, sourceFiles };
}

function appendMapStringList(map: Map<string, string[]>, key: string, valueEntry: string): void {
    let list = map.get(key);
    if (!list) {
        list = [];
        map.set(key, list);
    }
    list.push(valueEntry);
}

function collectDeclaredConfigKeys(configFiles: ConfigScanFile[]): {
    declaredKeys: Set<string>;
    keyToOriginsMap: Map<string, string[]>;
} {
    const declaredKeys = new Set<string>();
    const keyToOriginsMap = new Map<string, string[]>();
    for (const cfg of configFiles) {
        const keys = extractDeclaredKeys(cfg.content);
        for (const k of keys) {
            declaredKeys.add(k);
            appendMapStringList(keyToOriginsMap, k, cfg.filePath);
        }
    }
    return { declaredKeys, keyToOriginsMap };
}

function hasOverrideSource(origins: readonly string[]): boolean {
    for (let i = 0; i < origins.length; i++) {
        if (OVERRIDE_SEGMENT_RE.test(origins[i])) {
            return true;
        }
    }
    return false;
}

function detectDuplicateConfigs(keyToOriginsMap: Map<string, string[]>, issues: Issue[]): number {
    let duplicateKeyCount = 0;
    for (const [key, origins] of keyToOriginsMap.entries()) {
        if (origins.length > 1 && !hasOverrideSource(origins)) {
            duplicateKeyCount++;
            issues.push({
                id: `architecture:${RULE_ARCH_CFG_003}:${origins[0]}:${key}`,
                analyzer: ANALYZER_ARCHITECTURE,
                rule: RULE_ARCH_CFG_003,
                severity: SEVERITY_WARNING,
                message:
                    `Duplicate configuration declaration: Key '${key}' is redundantly declared ` +
                    `in multiple config sources: ${origins.map((o) => `'${o}'`).join(', ')}.`,
                location: {
                    file: origins[0],
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: DIAGNOSTIC_END_COLUMN },
                },
                detail: { key, origins },
                suggestion:
                    'Consolidate duplicated config keys into a single authoritative config schema.',
            });
        }
    }
    return duplicateKeyCount;
}

function checkDomainLeakage(
    src: ConfigScanFile,
    issues: Issue[],
): {
    hasEnv: boolean;
    hasIO: boolean;
    hasScattered: boolean;
} {
    let hasEnv = false;
    let hasIO = false;

    for (const envPat of IMPLICIT_ENV_PATTERNS) {
        const matches = src.content.match(envPat);
        if (matches && matches.length > 0) {
            hasEnv = true;
            issues.push({
                id: `architecture:${RULE_ARCH_CFG_004}:${src.filePath}:1`,
                analyzer: ANALYZER_ARCHITECTURE,
                rule: RULE_ARCH_CFG_004,
                severity: SEVERITY_WARNING,
                message:
                    `Implicit configuration leakage: Domain module '${src.filePath}' ` +
                    `accesses raw environment variable directly (${matches[0]}).`,
                location: {
                    file: src.filePath,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: DIAGNOSTIC_END_COLUMN },
                },
                detail: { envMatches: matches.slice(0, MAX_DIAGNOSTIC_SAMPLES) },
                suggestion:
                    'Inject typed configuration via constructor/factory rather than reading process.env.',
            });
            break;
        }
    }

    for (const ioPat of RAW_CONFIG_IO_PATTERNS) {
        if (ioPat.test(src.content)) {
            hasIO = true;
            issues.push({
                id: `architecture:${RULE_ARCH_CFG_006}:${src.filePath}:1`,
                analyzer: ANALYZER_ARCHITECTURE,
                rule: RULE_ARCH_CFG_006,
                severity: SEVERITY_WARNING,
                message:
                    `Config-business tight coupling: Domain module '${src.filePath}' ` +
                    `directly performs physical disk file I/O to read configuration.`,
                location: {
                    file: src.filePath,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: DIAGNOSTIC_END_COLUMN },
                },
                detail: { filePath: src.filePath },
                suggestion:
                    'Decouple domain entities from disk formats; pass typed options or config ports.',
            });
            break;
        }
    }

    const hasScattered = SCATTERED_CONFIG_PATTERNS.some((p) => src.content.includes(p));

    return { hasEnv, hasIO, hasScattered };
}

function extractWordTokens(content: string): Set<string> {
    const tokens = new Set<string>();
    const matches = content.match(/[a-zA-Z0-9_$-]+/g);
    if (matches) {
        for (const m of matches) {
            tokens.add(m);
        }
    }
    return tokens;
}

function collectReferencedTokens(
    content: string,
    declaredKeys: Set<string>,
    referencedKeys: Set<string>,
): void {
    const tokens = extractWordTokens(content);
    for (const token of tokens) {
        if (declaredKeys.has(token)) {
            referencedKeys.add(token);
        }
    }
}

interface DomainLeakageCollector {
    readonly domainFilesWithDirectEnv: ConfigScanFile[];
    readonly domainFilesWithDirectIO: ConfigScanFile[];
    readonly domainConfigAccesses: { file: string; line: number }[];
}

function processDomainLeakage(
    src: ConfigScanFile,
    issues: Issue[],
    collector: DomainLeakageCollector,
): void {
    const leakage = checkDomainLeakage(src, issues);
    if (leakage.hasEnv) collector.domainFilesWithDirectEnv.push(src);
    if (leakage.hasIO) collector.domainFilesWithDirectIO.push(src);
    if (leakage.hasScattered) collector.domainConfigAccesses.push({ file: src.filePath, line: 1 });
}

function scanSourceFiles(
    sourceFiles: ConfigScanFile[],
    declaredKeys: Set<string>,
    issues: Issue[],
) {
    const referencedKeys = new Set<string>();
    const domainFilesWithDirectEnv: ConfigScanFile[] = [];
    const domainFilesWithDirectIO: ConfigScanFile[] = [];
    const domainConfigAccesses: { file: string; line: number }[] = [];
    const collector: DomainLeakageCollector = {
        domainFilesWithDirectEnv,
        domainFilesWithDirectIO,
        domainConfigAccesses,
    };

    for (const src of sourceFiles) {
        const normPath = src.filePath.replace(/\\/g, '/');
        const isDomain = src.isDomainCore || DOMAIN_OR_CORE_RE.test(normPath);

        collectReferencedTokens(src.content, declaredKeys, referencedKeys);

        if (isDomain) {
            processDomainLeakage(src, issues, collector);
        }
    }

    return {
        referencedKeys,
        domainFilesWithDirectEnv,
        domainFilesWithDirectIO,
        domainConfigAccesses,
    };
}

function detectDeadConfigs(
    declaredKeys: Set<string>,
    referencedKeys: Set<string>,
    configFiles: ConfigScanFile[],
    issues: Issue[],
): string[] {
    const deadKeys: string[] = [];
    for (const k of declaredKeys) {
        if (!referencedKeys.has(k)) {
            deadKeys.push(k);
        }
    }
    if (deadKeys.length > 0 && configFiles.length > 0) {
        const sampleDead = deadKeys.slice(0, MAX_CONFIG_OBJECT_DEPTH);
        issues.push({
            id: `architecture:${RULE_ARCH_CFG_002}:${configFiles[0].filePath}:1`,
            analyzer: ANALYZER_ARCHITECTURE,
            rule: RULE_ARCH_CFG_002,
            severity: SEVERITY_WARNING,
            message:
                `Dead/unused configuration: Found ${deadKeys.length} config entries ` +
                `never referenced in business logic (e.g. ${sampleDead.join(', ')}).`,
            location: {
                file: configFiles[0].filePath,
                start: { line: 1, column: 1 },
                end: { line: 1, column: DIAGNOSTIC_END_COLUMN },
            },
            detail: { deadCount: deadKeys.length, sampleDead },
            suggestion:
                'Remove unreferenced config properties or bind them to runtime feature switches.',
        });
    }
    return deadKeys;
}

function detectScatteredConfig(
    domainConfigAccesses: { file: string; line: number }[],
    issues: Issue[],
): void {
    if (domainConfigAccesses.length < MAX_DIAGNOSTIC_SAMPLES) return;
    const target = domainConfigAccesses[0];
    issues.push({
        id: `architecture:${RULE_ARCH_CFG_005}:${target.file}:1`,
        analyzer: ANALYZER_ARCHITECTURE,
        rule: RULE_ARCH_CFG_005,
        severity: SEVERITY_WARNING,
        message:
            `Scattered config access: Found ${domainConfigAccesses.length} raw config calls ` +
            `scattered across domain modules instead of through a single config port.`,
        location: {
            file: target.file,
            start: { line: 1, column: 1 },
            end: { line: 1, column: DIAGNOSTIC_END_COLUMN },
        },
        detail: { totalScatteredCalls: domainConfigAccesses.length },
        suggestion:
            'Funnel configuration dependencies through domain service ports or dependency injection.',
    });
}

function detectOverAbstraction(
    scale: ProjectScaleProfile,
    configFiles: ConfigScanFile[],
    issues: Issue[],
): void {
    if (
        scale.fileCount >= OVER_ABSTRACTION_FILE_LIMIT ||
        configFiles.length < OVER_ABSTRACTION_MIN_CONFIGS
    ) {
        return;
    }
    issues.push({
        id: `architecture:${RULE_ARCH_CFG_007}:${configFiles[0].filePath}:1`,
        analyzer: ANALYZER_ARCHITECTURE,
        rule: RULE_ARCH_CFG_007,
        severity: SEVERITY_INFO,
        message:
            `Over-abstracted configuration: Small project (${scale.fileCount} files) has ` +
            `${configFiles.length} separate config files, creating unnecessary indirection.`,
        location: {
            file: configFiles[0].filePath,
            start: { line: 1, column: 1 },
            end: { line: 1, column: DIAGNOSTIC_END_COLUMN },
        },
        detail: { fileCount: scale.fileCount, configFileCount: configFiles.length },
        suggestion: 'Consolidate multiple small config files into a unified configuration.',
    });
}

function extractFileDirectory(normPath: string): string {
    const slashIdx = normPath.lastIndexOf('/');
    return slashIdx >= 0 ? normPath.slice(0, slashIdx) : '.';
}

function detectFlatConfigSprawl(
    configFiles: ConfigScanFile[],
    issues: Issue[],
    maxFlatThreshold = DEFAULT_FLAT_CONFIG_SPRAWL_THRESHOLD,
): number {
    const dirMap = new Map<string, string[]>();
    for (const f of configFiles) {
        const norm = f.filePath.replace(/\\/g, '/');
        const dir = extractFileDirectory(norm);
        appendMapStringList(dirMap, dir, norm);
    }

    let flatSprawlCount = 0;
    for (const [dir, filesInDir] of dirMap.entries()) {
        if (filesInDir.length >= maxFlatThreshold) {
            flatSprawlCount++;
            const sample = filesInDir
                .slice(0, MAX_DIAGNOSTIC_SAMPLES)
                .map((p) => p.split('/').pop())
                .join(', ');
            issues.push({
                id: `architecture:${RULE_ARCH_CFG_008}:${filesInDir[0]}:1`,
                analyzer: ANALYZER_ARCHITECTURE,
                rule: RULE_ARCH_CFG_008,
                severity: SEVERITY_WARNING,
                message:
                    `Flat configuration sprawl anti-pattern: Directory '${dir}' contains ` +
                    `${filesInDir.length} flat configuration tables without isomorphic domain subdirectories (e.g. ${sample}).`,
                location: {
                    file: filesInDir[0],
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: DIAGNOSTIC_END_COLUMN },
                },
                detail: { directory: dir, tableCount: filesInDir.length },
                suggestion:
                    'Partition configuration tables into domain-isomorphic subdirectories (<domain>/core.json + subtables).',
            });
        }
    }
    return flatSprawlCount;
}

const SUBTABLE_PATH_RE =
    /(?:load|read|readFile|readFileSync|open)\s*\(\s*['"][^'"]*[/\\](?:domains|config)[/\\]([a-zA-Z0-9_-]+)[/\\]((?!core\b)[a-zA-Z0-9_-]+)\.json['"]/i;

function scanFileForUnroutedSubtables(src: ConfigScanFile, issues: Issue[]): number {
    const normPath = src.filePath.replace(/\\/g, '/');
    if (ROUTER_OR_TEST_PATH_RE.test(normPath)) {
        return 0;
    }

    let fileUnroutedCount = 0;
    const lines = src.content.split('\n');
    for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        const match = SUBTABLE_PATH_RE.exec(line);
        if (!match || UNROUTED_CALL_RE.test(line)) {
            continue;
        }

        fileUnroutedCount++;
        const domain = match[1];
        const subtable = match[2];
        issues.push({
            id: `architecture:${RULE_ARCH_CFG_009}:${src.filePath}:${idx + 1}`,
            analyzer: ANALYZER_ARCHITECTURE,
            rule: RULE_ARCH_CFG_009,
            severity: SEVERITY_WARNING,
            message:
                `Direct subtable access bypasses router contract: Subtable '${domain}/${subtable}.json' ` +
                `is loaded directly via physical path instead of unified config router or dotted notation.`,
            location: {
                file: src.filePath,
                start: { line: idx + 1, column: 1 },
                end: { line: idx + 1, column: line.length || 1 },
            },
            detail: { domain, subtable, line: idx + 1 },
            suggestion: `Use unified config router (e.g. get_subtable("${domain}.${subtable}") or dotted path) to access subtable.`,
        });
    }
    return fileUnroutedCount;
}

function detectUnroutedSubtables(sourceFiles: ConfigScanFile[], issues: Issue[]): number {
    let unroutedCount = 0;
    for (const src of sourceFiles) {
        unroutedCount += scanFileForUnroutedSubtables(src, issues);
    }
    return unroutedCount;
}

function calculateMaturityGrade(score: number): { level: number; grade: ConfigMaturityGrade } {
    const entry = MATURITY_GRADE_LADDER.find((t) => score >= t.minScore);
    if (entry) return { level: entry.level, grade: entry.grade };
    return { level: 0, grade: 'L0' };
}

interface MaturityScoreInput {
    readonly scale: ProjectScaleProfile;
    readonly configCount: number;
    readonly declaredCount: number;
    readonly referencedCount: number;
    readonly duplicateCount: number;
    readonly directEnvCount: number;
    readonly directIOCount: number;
    readonly flatSprawlCount?: number;
    readonly unroutedSubtableCount?: number;
}

function computeDecouplingScore(
    isSmallProject: boolean,
    directIOCount: number,
    directEnvCount: number,
    unroutedSubtableCount: number,
): number {
    if (isSmallProject) {
        const raw =
            MAX_PERCENT_SCORE -
            directIOCount * PENALTY_DIRECT_IO_SMALL -
            unroutedSubtableCount * PENALTY_UNROUTED_SUBTABLE_SMALL;
        return Math.max(0, Math.min(MAX_PERCENT_SCORE, raw));
    }
    const raw =
        MAX_PERCENT_SCORE -
        directIOCount * PENALTY_DIRECT_IO_STANDARD -
        directEnvCount * PENALTY_DIRECT_ENV -
        unroutedSubtableCount * PENALTY_UNROUTED_SUBTABLE_STANDARD;
    return Math.max(0, Math.min(MAX_PERCENT_SCORE, raw));
}

function computeHygieneScore(
    duplicateCount: number,
    directEnvCount: number,
    flatSprawlCount: number,
): number {
    const penalty =
        duplicateCount * PENALTY_DUPLICATE_CONFIG +
        directEnvCount * PENALTY_DIRECT_ENV +
        flatSprawlCount * PENALTY_FLAT_SPRAWL;
    return Math.max(0, Math.min(MAX_PERCENT_SCORE, MAX_PERCENT_SCORE - penalty));
}

function computeSeparationScore(configCount: number, declaredCount: number): number {
    const base = configCount > 0 ? BASE_ACTIVE_CONFIG_SCORE : BASE_INACTIVE_CONFIG_SCORE;
    const bonus = declaredCount > 0 ? DECLARED_CONFIG_BONUS : 0;
    return Math.max(0, Math.min(MAX_PERCENT_SCORE, base + bonus));
}

function calculateMaturityScores(input: MaturityScoreInput) {
    const {
        scale,
        configCount,
        declaredCount,
        referencedCount,
        duplicateCount,
        directEnvCount,
        directIOCount,
        flatSprawlCount = 0,
        unroutedSubtableCount = 0,
    } = input;
    const isSmallProject =
        scale.fileCount <= SMALL_PROJECT_MAX_FILES &&
        scale.domainCount <= SMALL_PROJECT_MAX_DOMAINS;
    const activeRefRatio =
        declaredCount > 0 ? referencedCount / declaredCount : configCount > 0 ? 0.8 : 0.4;

    const separationScore = computeSeparationScore(configCount, declaredCount);
    const decisionParticipationScore = Math.max(
        0,
        Math.min(MAX_PERCENT_SCORE, Math.round(activeRefRatio * MAX_PERCENT_SCORE)),
    );
    const hygieneScore = computeHygieneScore(duplicateCount, directEnvCount, flatSprawlCount);
    const decouplingScore = computeDecouplingScore(
        isSmallProject,
        directIOCount,
        directEnvCount,
        unroutedSubtableCount,
    );
    const scaleCalibrationScore = isSmallProject
        ? SCALE_SCORE_SMALL_PROJECT
        : SCALE_SCORE_STANDARD_PROJECT;

    const weightedScore =
        separationScore * 0.25 +
        decisionParticipationScore * 0.25 +
        hygieneScore * 0.2 +
        decouplingScore * 0.15 +
        scaleCalibrationScore * 0.15;
    const maturityScore = Math.max(0, Math.min(MAX_PERCENT_SCORE, Math.round(weightedScore)));
    const { level: maturityLevel, grade: maturityGrade } = calculateMaturityGrade(maturityScore);

    return {
        maturityScore,
        maturityGrade,
        maturityLevel,
        breakdown: {
            separationScore,
            decisionParticipationScore,
            hygieneScore,
            decouplingScore,
            scaleCalibrationScore,
        },
    };
}

interface RecommendationInput {
    readonly directEnvCount: number;
    readonly directIOCount: number;
    readonly deadCount: number;
    readonly duplicateCount: number;
    readonly flatSprawlCount?: number;
    readonly unroutedSubtableCount?: number;
}

function buildRecommendations(input: RecommendationInput): string[] {
    const {
        directEnvCount,
        directIOCount,
        deadCount,
        duplicateCount,
        flatSprawlCount = 0,
        unroutedSubtableCount = 0,
    } = input;
    const recs: string[] = [];
    if (directEnvCount > 0) {
        recs.push('Eliminate process.env calls from domain core; declare typed config models.');
    }
    if (directIOCount > 0) {
        recs.push('Remove direct configuration file I/O in domain; inject config objects via DI.');
    }
    if (deadCount > 0) {
        recs.push(`Prune or activate ${deadCount} unreferenced configuration keys.`);
    }
    if (duplicateCount > 0) {
        recs.push(
            `Consolidate ${duplicateCount} duplicated configuration keys across config files.`,
        );
    }
    if (flatSprawlCount > 0) {
        recs.push(
            `Eliminate flat config sprawl across ${flatSprawlCount} directories; modularize into domain subdirectories.`,
        );
    }
    if (unroutedSubtableCount > 0) {
        recs.push(
            `Route ${unroutedSubtableCount} direct subtable file accesses through unified config router.`,
        );
    }
    return recs;
}

/**
 * Audits a repository for config-driven architecture compliance.
 *
 * @param files - All source and configuration files in the project.
 * @param scale - Project scale profile for elastic threshold adaptation.
 * @param options - Tunable configuration options.
 * @returns Complete analysis result with maturity score and actionable issues.
 */
export function auditConfigDrivenArchitecture(
    files: ConfigScanFile[],
    scale: ProjectScaleProfile = { fileCount: files.length, domainCount: 1 },
    options: ConfigDrivenOptions = {},
): ConfigDrivenAnalysisResult {
    const issues: Issue[] = [];
    const patterns = options.configFilePatterns ?? DEFAULT_CONFIG_FILE_PATTERNS;

    const { configFiles, sourceFiles } = partitionScanFiles(files, patterns);
    const { declaredKeys, keyToOriginsMap } = collectDeclaredConfigKeys(configFiles);
    const duplicateKeyCount = detectDuplicateConfigs(keyToOriginsMap, issues);

    const {
        referencedKeys,
        domainFilesWithDirectEnv,
        domainFilesWithDirectIO,
        domainConfigAccesses,
    } = scanSourceFiles(sourceFiles, declaredKeys, issues);

    const deadKeys = detectDeadConfigs(declaredKeys, referencedKeys, configFiles, issues);
    detectScatteredConfig(domainConfigAccesses, issues);
    detectOverAbstraction(scale, configFiles, issues);

    const flatSprawlThreshold =
        options.maxFlatConfigThreshold ?? DEFAULT_FLAT_CONFIG_SPRAWL_THRESHOLD;
    const flatSprawlCount = detectFlatConfigSprawl(configFiles, issues, flatSprawlThreshold);
    const unroutedSubtableCount = detectUnroutedSubtables(sourceFiles, issues);

    const totalDeclared = declaredKeys.size;
    const { maturityScore, maturityGrade, maturityLevel, breakdown } = calculateMaturityScores({
        scale,
        configCount: configFiles.length,
        declaredCount: totalDeclared,
        referencedCount: referencedKeys.size,
        duplicateCount: duplicateKeyCount,
        directEnvCount: domainFilesWithDirectEnv.length,
        directIOCount: domainFilesWithDirectIO.length,
        flatSprawlCount,
        unroutedSubtableCount,
    });

    const recommendations = buildRecommendations({
        directEnvCount: domainFilesWithDirectEnv.length,
        directIOCount: domainFilesWithDirectIO.length,
        deadCount: deadKeys.length,
        duplicateCount: duplicateKeyCount,
        flatSprawlCount,
        unroutedSubtableCount,
    });

    return {
        maturityScore,
        maturityGrade,
        maturityLevel,
        breakdown,
        issues,
        declaredConfigKeyCount: totalDeclared,
        referencedConfigKeyCount: referencedKeys.size,
        recommendations,
    };
}
