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

const DOMAIN_SEGMENT = '/domain/';
const CORE_SEGMENT = '/core/';

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
        if (key && key.length >= 2 && !['type', 'id', 'name', 'version'].includes(key)) {
            keys.add(key);
        }
    }
    return keys;
}

function collectObjectKeys(obj: unknown, keys: Set<string>, depth = 0): void {
    if (!obj || typeof obj !== 'object' || depth > 5) return;
    for (const [k, v] of Object.entries(obj)) {
        if (
            k &&
            k.length >= 2 &&
            isNaN(Number(k)) &&
            !['type', 'id', 'name', 'version'].includes(k)
        ) {
            keys.add(k);
        }
        if (v && typeof v === 'object') {
            collectObjectKeys(v, keys, depth + 1);
        }
    }
}

/**
 * Partitions files into configuration definitions and general source files.
 *
 * @param files - All scan files under review.
 * @param patterns - Regular expressions identifying configuration file paths.
 * @returns Divided arrays of configuration files and source files.
 */
function partitionScanFiles(
    files: ConfigScanFile[],
    patterns: RegExp[],
): { configFiles: ConfigScanFile[]; sourceFiles: ConfigScanFile[] } {
    const configFiles: ConfigScanFile[] = [];
    const sourceFiles: ConfigScanFile[] = [];
    for (const file of files) {
        const normPath = file.filePath.replace(/\\/g, '/');
        if (patterns.some((p) => p.test(normPath))) {
            configFiles.push(file);
        } else {
            sourceFiles.push(file);
        }
    }
    return { configFiles, sourceFiles };
}

function collectDeclaredConfigKeys(configFiles: ConfigScanFile[]): {
    declaredKeys: Set<string>;
    keyOrigins: Map<string, string[]>;
} {
    const declaredKeys = new Set<string>();
    const keyOrigins = new Map<string, string[]>();
    for (const cfg of configFiles) {
        const keys = extractDeclaredKeys(cfg.content);
        for (const k of keys) {
            declaredKeys.add(k);
            const list = keyOrigins.get(k) ?? [];
            list.push(cfg.filePath);
            keyOrigins.set(k, list);
        }
    }
    return { declaredKeys, keyOrigins };
}

function detectDuplicateConfigs(keyOrigins: Map<string, string[]>, issues: Issue[]): number {
    let duplicateKeyCount = 0;
    for (const [key, origins] of keyOrigins.entries()) {
        if (origins.length > 1 && !origins.some((o) => o.includes('.override.'))) {
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
                    end: { line: 1, column: 80 },
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
                    end: { line: 1, column: 80 },
                },
                detail: { envMatches: matches.slice(0, 3) },
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
                    end: { line: 1, column: 80 },
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

function processDomainLeakage(
    src: ConfigScanFile,
    issues: Issue[],
    domainFilesWithDirectEnv: ConfigScanFile[],
    domainFilesWithDirectIO: ConfigScanFile[],
    domainConfigAccesses: { file: string; line: number }[],
): void {
    const leakage = checkDomainLeakage(src, issues);
    if (leakage.hasEnv) domainFilesWithDirectEnv.push(src);
    if (leakage.hasIO) domainFilesWithDirectIO.push(src);
    if (leakage.hasScattered) domainConfigAccesses.push({ file: src.filePath, line: 1 });
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

    for (const src of sourceFiles) {
        const normPath = src.filePath.replace(/\\/g, '/');
        const isDomain =
            src.isDomainCore ||
            normPath.includes(DOMAIN_SEGMENT) ||
            normPath.includes(CORE_SEGMENT);

        collectReferencedTokens(src.content, declaredKeys, referencedKeys);

        if (isDomain) {
            processDomainLeakage(
                src,
                issues,
                domainFilesWithDirectEnv,
                domainFilesWithDirectIO,
                domainConfigAccesses,
            );
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
        const sampleDead = deadKeys.slice(0, 5);
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
                end: { line: 1, column: 80 },
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
    if (domainConfigAccesses.length < 3) return;
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
            end: { line: 1, column: 80 },
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
    if (scale.fileCount >= 30 || configFiles.length < 6) return;
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
            end: { line: 1, column: 80 },
        },
        detail: { fileCount: scale.fileCount, configFileCount: configFiles.length },
        suggestion: 'Consolidate multiple small config files into a unified configuration.',
    });
}

function calculateMaturityGrade(score: number): { level: number; grade: ConfigMaturityGrade } {
    if (score >= 90) return { level: 4, grade: 'L4' };
    if (score >= 75) return { level: 3, grade: 'L3' };
    if (score >= 60) return { level: 2, grade: 'L2' };
    if (score >= 40) return { level: 1, grade: 'L1' };
    return { level: 0, grade: 'L0' };
}

function calculateMaturityScores(
    scale: ProjectScaleProfile,
    configCount: number,
    declaredCount: number,
    referencedCount: number,
    duplicateCount: number,
    directEnvCount: number,
    directIOCount: number,
) {
    const isSmallProject = scale.fileCount <= 25 && scale.domainCount <= 2;
    const activeRefRatio =
        declaredCount > 0 ? referencedCount / declaredCount : configCount > 0 ? 0.8 : 0.4;

    const separationScore = Math.max(
        0,
        Math.min(100, (configCount > 0 ? 70 : 30) + (declaredCount > 0 ? 30 : 0)),
    );
    const decisionParticipationScore = Math.max(0, Math.min(100, Math.round(activeRefRatio * 100)));
    const hygieneScore = Math.max(
        0,
        Math.min(100, 100 - duplicateCount * 10 - directEnvCount * 15),
    );
    const decouplingScore = isSmallProject
        ? Math.max(0, Math.min(100, 100 - directIOCount * 10))
        : Math.max(0, Math.min(100, 100 - directIOCount * 20 - directEnvCount * 15));
    const scaleCalibrationScore = isSmallProject
        ? SCALE_SCORE_SMALL_PROJECT
        : SCALE_SCORE_STANDARD_PROJECT;

    const maturityScore = Math.max(
        0,
        Math.min(
            100,
            Math.round(
                separationScore * 0.25 +
                    decisionParticipationScore * 0.25 +
                    hygieneScore * 0.2 +
                    decouplingScore * 0.15 +
                    scaleCalibrationScore * 0.15,
            ),
        ),
    );

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

function buildRecommendations(
    directEnvCount: number,
    directIOCount: number,
    deadCount: number,
    duplicateCount: number,
): string[] {
    const recs: string[] = [];
    if (directEnvCount > 0) {
        recs.push('Eliminate process.env calls from domain core; declare typed config models.');
    }
    if (directIOCount > 0) {
        recs.push('Remove direct file I/O for config in domain; inject config objects via DI.');
    }
    if (deadCount > 0) {
        recs.push(`Prune or activate ${deadCount} unreferenced configuration keys.`);
    }
    if (duplicateCount > 0) {
        recs.push(
            `Consolidate ${duplicateCount} duplicated configuration keys across config files.`,
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
    const { declaredKeys, keyOrigins } = collectDeclaredConfigKeys(configFiles);
    const duplicateKeyCount = detectDuplicateConfigs(keyOrigins, issues);

    const {
        referencedKeys,
        domainFilesWithDirectEnv,
        domainFilesWithDirectIO,
        domainConfigAccesses,
    } = scanSourceFiles(sourceFiles, declaredKeys, issues);

    const deadKeys = detectDeadConfigs(declaredKeys, referencedKeys, configFiles, issues);
    detectScatteredConfig(domainConfigAccesses, issues);
    detectOverAbstraction(scale, configFiles, issues);

    const totalDeclared = declaredKeys.size;
    const { maturityScore, maturityGrade, maturityLevel, breakdown } = calculateMaturityScores(
        scale,
        configFiles.length,
        totalDeclared,
        referencedKeys.size,
        duplicateKeyCount,
        domainFilesWithDirectEnv.length,
        domainFilesWithDirectIO.length,
    );

    const recommendations = buildRecommendations(
        domainFilesWithDirectEnv.length,
        domainFilesWithDirectIO.length,
        deadKeys.length,
        duplicateKeyCount,
    );

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
