/**
 * Module: Core Scoring — Five-Level Hierarchical Quality Scorer
 * File Path: src/core/scoring/hierarchicalScorer.ts
 * Architecture Role: Computes multi-level hierarchical code health scores across five tiers:
 *   Function -> File -> Module -> Domain -> Project, integrating non-linear penalties,
 *   effective code density, and anti-gaming protection.
 * Dependencies & Triggers: Consumes eightPillarModel, riskWeightModel, effectiveDensity,
 *   and antiGaming.
 * Responsibilities: Aggregate scores bottom-up without averaging out fatal architecture breaches.
 * Exit Semantics & Design Rationale: Bounded 0.0-100.0 score space, explainable rationales.
 */

import type { Issue } from '../types';
import { SEVERITY_ERROR } from '../types';
import type { EightPillarBreakdown, PrimaryQualityPillar } from './eightPillarModel';
import { ALL_PRIMARY_PILLARS, synthesizeEightPillars } from './eightPillarModel';
import { computeRiskWeightedPenalties } from './riskWeightModel';
import { computeEffectiveCodeDensity, type EffectiveDensityResult } from './effectiveDensity';
import { detectScoreGaming } from './antiGaming';
import type { QualityDimension, QualityGrade } from './scoringTypes';
import { ALL_QUALITY_DIMENSIONS } from './scoringTypes';
// Grade thresholds live in scorer-formulas as the single source of truth. This module used to
// carry its own copy (95/85/75/65/50) which disagreed with the snapshot model, so the same
// 92 points read as A+ on one surface and A on the other. It also had no NaN case, which
// graded unmeasured input as F.
import {
    clampRatio,
    clampScore,
    computeSecurityCeiling,
    DIMENSION_MAX_SCORE,
    resolveQualityGrade,
    SCORE_ROUNDING,
} from './scorer-formulas';

/** Default fallback security ceiling for unmeasured scopes. */
export const DEFAULT_SECURITY_CEILING = computeSecurityCeiling();

const DEFAULT_DOMAIN_NAME = 'core';
const DEFAULT_MODULE_NAME = 'root';
const SYNTHESIS_MODE_GEOMETRIC = 'geometric';
const LOC_SCALE_DIVISOR = 100;
const LOC_LOG_SMOOTH_BIAS = 10;
const FATAL_ARCH_CEILING = 45;
const DENSITY_MIN_LOC = 15;
const POR_THRESHOLD = 0.6;
const POR_RANGE = 0.4;
const COMPOSITE_DENSITY_THRESHOLD = 0.35;
const PENALTY_MAINTAINABILITY_DENSITY = 15;
const PENALTY_ARCH_POR_MAX = 15;
const PENALTY_PERF_DENSITY_MAX = 10;
const DEFAULT_PROJECT_COMPOSITE = 100.0;
const RATIO_SCALE_HUNDRED = 100;
const RATIO_SCALE_THOUSAND = 1000;
const BOUNDED_SCORE_MIN = 15;

const TEST_PATH_INFIX_TEST = '.test.';
const TEST_PATH_INFIX_SPEC = '.spec.';
const TEST_PATH_DIR_TESTS = '/tests/';
const TEST_PATH_DIR_TEST = '/test/';
const TEST_PATH_DIR_DUNDER = '/__tests__/';
const TEST_PATH_PREFIX_TEST = 'test_';
const TEST_PATH_SUFFIX_PY = '_test.py';
const TEST_PATH_SUFFIX_GD = '_test.gd';

const DIMENSION_MAINTAINABILITY = 'maintainability';
const DIMENSION_ARCH_CONSISTENCY = 'architectureConsistency';
const DIMENSION_PERF_EFFICIENCY = 'performanceEfficiency';
const DIMENSION_CODE_SECURITY = 'codeSecurity';
const FILE_SUFFIX_INDEX_TS = 'index.ts';
const FILE_SUFFIX_DTS = '.d.ts';
const PREFIX_RULE_ARCH = 'ARCH-';

/**
 * Scored function-level quality record.
 */
export interface FunctionQualityScore {
    functionName: string;
    loc: number;
    cyclomaticComplexity: number;
    score: number;
}

/**
 * Scored file-level quality breakdown.
 */
export interface FileQualityScore {
    filePath: string;
    domainName: string;
    moduleName: string;
    compositeScore: number;
    eightPillars: EightPillarBreakdown;
    tenDimensions: Record<QualityDimension, number>;
    effectiveDensity: number;
    densityMetrics?: {
        effectiveDensity: number;
        compositeDensity: number;
        tspr: number;
        por: number;
        tokensPerEloc: number;
        columnDensity: number;
        sufr: number;
        gaussianHealth: number;
        spatialDensity?: number;
        mahalanobisDistance?: number;
        dominantDeficitAxis?: string;
        fisherSimplexDistance?: number;
    };
    functions: FunctionQualityScore[];
    issues: Issue[];
    loc?: number;
}

/**
 * Scored module-level quality breakdown.
 */
export interface ModuleQualityScore {
    moduleName: string;
    fileCount: number;
    compositeScore: number;
    pillars: Record<PrimaryQualityPillar, number>;
    tenDimensions: Record<QualityDimension, number>;
    files: FileQualityScore[];
}

/**
 * Scored domain-level quality breakdown.
 */
export interface DomainQualityScore {
    domainName: string;
    compositeScore: number;
    pillars: Record<PrimaryQualityPillar, number>;
    tenDimensions: Record<QualityDimension, number>;
    modules: ModuleQualityScore[];
}

/**
 * Scored repository-wide project quality breakdown.
 */
export interface ProjectQualityScore {
    compositeScore: number;
    grade: QualityGrade;
    eightPillars: EightPillarBreakdown;
    tenDimensions: Record<QualityDimension, number>;
    effectiveCodeDensity: number;
    densityTensorSummary?: {
        compositeDensity: number;
        averageTspr: number;
        averagePor: number;
        averageColumnDensity: number;
        averageSpatialDensity?: number;
        averageMahalanobisDistance?: number;
        averageFisherSimplexDistance?: number;
    };
    domains: DomainQualityScore[];
    totalFiles: number;
    totalIssues: number;
    fatalCount: number;
}

/**
 * Calculates dimension deductions stemming from 5D code density, wiring, and fragmentation.
 */
function computeDensityDeduction(
    dim: QualityDimension,
    densityResult: EffectiveDensityResult,
    isExemptFacade: boolean,
): number {
    if (densityResult.totalLoc < DENSITY_MIN_LOC) {
        return 0;
    }
    if (dim === DIMENSION_MAINTAINABILITY) {
        return densityResult.isLowDensity ? PENALTY_MAINTAINABILITY_DENSITY : 0;
    }
    if (dim === DIMENSION_ARCH_CONSISTENCY) {
        if (
            !isExemptFacade &&
            typeof densityResult.por === 'number' &&
            densityResult.por > POR_THRESHOLD
        ) {
            return Math.round(
                PENALTY_ARCH_POR_MAX * ((densityResult.por - POR_THRESHOLD) / POR_RANGE),
            );
        }
        return 0;
    }
    if (dim === DIMENSION_PERF_EFFICIENCY) {
        if (
            typeof densityResult.compositeDensity === 'number' &&
            densityResult.compositeDensity < COMPOSITE_DENSITY_THRESHOLD
        ) {
            return Math.round(
                PENALTY_PERF_DENSITY_MAX *
                    ((COMPOSITE_DENSITY_THRESHOLD - densityResult.compositeDensity) /
                        COMPOSITE_DENSITY_THRESHOLD),
            );
        }
        return 0;
    }
    return 0;
}

/**
 * Detects whether a path belongs to test, benchmark, or specification suites.
 */
function isTestFilePath(filePath: string): boolean {
    const lower = filePath.toLowerCase().replace(/\\/g, '/');
    return (
        lower.includes(TEST_PATH_INFIX_TEST) ||
        lower.includes(TEST_PATH_INFIX_SPEC) ||
        lower.includes(TEST_PATH_DIR_DUNDER) ||
        lower.includes(TEST_PATH_DIR_TESTS) ||
        lower.includes(TEST_PATH_DIR_TEST) ||
        lower.startsWith(TEST_PATH_PREFIX_TEST) ||
        lower.endsWith(TEST_PATH_SUFFIX_PY) ||
        lower.endsWith(TEST_PATH_SUFFIX_GD)
    );
}

function computeDimensionIndices(
    riskResult: ReturnType<typeof computeRiskWeightedPenalties>,
    densityResult: EffectiveDensityResult,
    isExemptFacade: boolean,
    securityCeiling: number,
): Record<QualityDimension, number> {
    const indices: Record<QualityDimension, number> = {} as Record<QualityDimension, number>;
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        const riskPenalty = riskResult.dimensionPenalties?.[dim] ?? 0;
        const densityPenalty = computeDensityDeduction(dim, densityResult, isExemptFacade);
        const dimPenalty = riskPenalty + densityPenalty;
        const baseScore = dim === DIMENSION_CODE_SECURITY ? securityCeiling : DIMENSION_MAX_SCORE;
        indices[dim] = clampScore(baseScore - dimPenalty, baseScore);
    }
    return indices;
}

function buildFileDensityMetrics(densityResult: EffectiveDensityResult) {
    const rawComposite = densityResult.compositeDensity ?? densityResult.effectiveDensity;
    const fallbackPor = Math.max(0, 1.0 - densityResult.effectiveDensity);
    return {
        effectiveDensity: clampRatio(densityResult.effectiveDensity),
        compositeDensity: clampRatio(rawComposite),
        tspr: clampRatio(densityResult.tspr ?? densityResult.effectiveDensity),
        por: clampRatio(densityResult.por ?? fallbackPor),
        tokensPerEloc: Math.max(0, densityResult.tokensPerEloc ?? 0),
        columnDensity: clampRatio(densityResult.columnDensity ?? 0),
        sufr: clampRatio(densityResult.sufr ?? 0),
        gaussianHealth: clampRatio(densityResult.gaussianHealth ?? 1.0),
        spatialDensity:
            densityResult.spatialDensity !== undefined
                ? clampRatio(densityResult.spatialDensity)
                : undefined,
        mahalanobisDistance: densityResult.mahalanobisDistance,
        dominantDeficitAxis: densityResult.dominantDeficitAxis,
        fisherSimplexDistance: densityResult.fisherSimplexDistance,
    };
}

/** Options bundle for single-file quality scoring. */
export interface ScoreFileQualityOptions {
    readonly filePath: string;
    readonly content: string;
    readonly issues: Issue[];
    readonly domainName?: string;
    readonly moduleName?: string;
}

/** Optional domain and module scope specifiers. */
export interface FileScopeOptions {
    readonly domainName?: string;
    readonly moduleName?: string;
}

function resolveScopeSpecifiers(
    third?: string | FileScopeOptions,
    fourth?: string,
): { domainName: string; moduleName: string } {
    if (!third) {
        return { domainName: DEFAULT_DOMAIN_NAME, moduleName: DEFAULT_MODULE_NAME };
    }
    if (typeof third === 'string') {
        return {
            domainName: third,
            moduleName: fourth || DEFAULT_MODULE_NAME,
        };
    }
    return {
        domainName: third.domainName || DEFAULT_DOMAIN_NAME,
        moduleName: third.moduleName || DEFAULT_MODULE_NAME,
    };
}

function normalizeScoreOptions(
    filePathOrOptions: string | ScoreFileQualityOptions,
    ...rest: [string?, Issue[]?, (string | FileScopeOptions)?, string?]
): ScoreFileQualityOptions {
    if (typeof filePathOrOptions === 'object' && filePathOrOptions !== null) {
        return {
            filePath: filePathOrOptions.filePath,
            content: filePathOrOptions.content,
            issues: filePathOrOptions.issues,
            domainName: filePathOrOptions.domainName || DEFAULT_DOMAIN_NAME,
            moduleName: filePathOrOptions.moduleName || DEFAULT_MODULE_NAME,
        };
    }
    const scope = resolveScopeSpecifiers(rest[2], rest[3]);
    return {
        filePath: filePathOrOptions,
        content: rest[0] || '',
        issues: rest[1] || [],
        domainName: scope.domainName,
        moduleName: scope.moduleName,
    };
}

function evaluateFileQuality(opt: ScoreFileQualityOptions): FileQualityScore {
    const { filePath, content, issues } = opt;
    const domainName = opt.domainName ?? DEFAULT_DOMAIN_NAME;
    const moduleName = opt.moduleName ?? DEFAULT_MODULE_NAME;

    // 1. Density and anti-gaming
    const densityResult = computeEffectiveCodeDensity(content);
    const gamingResult = detectScoreGaming(filePath, content);
    const allIssues = [...issues, ...gamingResult.issues];

    // 2. Risk penalty and ceilings
    const riskResult = computeRiskWeightedPenalties(allIssues);
    const loc = Math.max(1, content ? content.split('\n').length : 1);
    const scaleFactor = Math.max(1, loc / LOC_SCALE_DIVISOR);
    const securityCeiling = computeSecurityCeiling(null, scaleFactor);

    // 3. Base dimension indices
    const isExemptFacade =
        filePath.endsWith(FILE_SUFFIX_INDEX_TS) || filePath.endsWith(FILE_SUFFIX_DTS);
    const indices = computeDimensionIndices(
        riskResult,
        densityResult,
        isExemptFacade,
        securityCeiling,
    );

    const isTest = isTestFilePath(filePath);
    const dataScoreOverride =
        riskResult.pillarPenalties.data > 0
            ? clampScore(DIMENSION_MAX_SCORE - riskResult.pillarPenalties.data)
            : undefined;
    const testingScoreOverride =
        isTest || riskResult.pillarPenalties.testing > 0
            ? clampScore(DIMENSION_MAX_SCORE - riskResult.pillarPenalties.testing)
            : undefined;

    // 4. Synthesize 8 pillars with non-linear ceilings
    const eightPillars = synthesizeEightPillars(
        indices,
        dataScoreOverride,
        testingScoreOverride,
        riskResult.ceilings,
    );

    const densityMetrics = buildFileDensityMetrics(densityResult);

    return {
        filePath,
        domainName,
        moduleName,
        compositeScore: eightPillars.compositeScore,
        eightPillars,
        tenDimensions: { ...indices },
        effectiveDensity: densityResult.effectiveDensity,
        densityMetrics,
        functions: [],
        issues: allIssues,
        loc,
    };
}

/**
 * Evaluates single-file multi-dimensional quality metrics against 8 primary pillars.
 *
 * @param options - Options bundle for file quality scoring.
 * @returns File quality evaluation score breakdown.
 */
export function scoreFileQuality(options: ScoreFileQualityOptions): FileQualityScore;
/**
 * Evaluates single-file multi-dimensional quality metrics against 8 primary pillars.
 *
 * @param filePath - Project relative path of the file.
 * @param content - Raw text content of the file.
 * @param issues - Collection of static analysis issues emitted for this file.
 * @param scope - Optional domain and module scope specifiers.
 * @returns File quality evaluation score breakdown.
 */
export function scoreFileQuality(
    filePath: string,
    content: string,
    issues?: Issue[],
    scope?: FileScopeOptions,
): FileQualityScore;
/**
 * Evaluates single-file multi-dimensional quality metrics against 8 primary pillars.
 *
 * @param optionsOrPath - File path string or options bundle.
 * @param rest - Legacy positional arguments [content, issues, scope].
 * @returns File quality evaluation score breakdown.
 */
export function scoreFileQuality(
    optionsOrPath: ScoreFileQualityOptions | string,
    ...rest: [string?, Issue[]?, (string | FileScopeOptions)?, string?]
): FileQualityScore {
    const opt = normalizeScoreOptions(optionsOrPath, ...rest);
    return evaluateFileQuality(opt);
}

/**
 * Retrieves or initializes the module map for a given domain without per-loop allocations.
 */
function getOrCreateDomainModuleMap(
    domainMap: Map<string, Map<string, FileQualityScore[]>>,
    domainName: string,
): Map<string, FileQualityScore[]> {
    let moduleMap = domainMap.get(domainName);
    if (!moduleMap) {
        moduleMap = new Map();
        domainMap.set(domainName, moduleMap);
    }
    return moduleMap;
}

function initPillarSums(): Record<PrimaryQualityPillar, number> {
    return {
        architecture: 0,
        maintainability: 0,
        performance: 0,
        data: 0,
        testing: 0,
        reliability: 0,
        security: 0,
        extensibility: 0,
    };
}

interface ScoreAccumulator {
    count: number;
    sumComposite: number;
    pillarSums: Record<PrimaryQualityPillar, number>;
    dimSums: Record<QualityDimension, number>;
}

function initScoreAccumulator(): ScoreAccumulator {
    return {
        count: 0,
        sumComposite: 0,
        pillarSums: initPillarSums(),
        dimSums: {
            architectureConsistency: 0,
            semanticPurity: 0,
            codeSecurity: 0,
            performanceEfficiency: 0,
            standardization: 0,
            modernity: 0,
            maintainability: 0,
            commentQuality: 0,
            duplication: 0,
            techDebtRisk: 0,
        },
    };
}

function accumulateScoreItem(
    acc: ScoreAccumulator,
    composite: number,
    pillars: Record<PrimaryQualityPillar, number>,
    dimensions?: Record<QualityDimension, number>,
): void {
    acc.count++;
    acc.sumComposite += composite;
    for (const pillar of ALL_PRIMARY_PILLARS) {
        acc.pillarSums[pillar] += pillars[pillar];
    }
    for (const dimension of ALL_QUALITY_DIMENSIONS) {
        const fallback =
            dimension === DIMENSION_CODE_SECURITY ? DEFAULT_SECURITY_CEILING : DIMENSION_MAX_SCORE;
        acc.dimSums[dimension] += dimensions?.[dimension] ?? fallback;
    }
}

function finalizeAverageScores(acc: ScoreAccumulator): {
    compositeScore: number;
    pillars: Record<PrimaryQualityPillar, number>;
    tenDimensions: Record<QualityDimension, number>;
} {
    const count = Math.max(1, acc.count);
    const pillars: Record<PrimaryQualityPillar, number> = {} as Record<
        PrimaryQualityPillar,
        number
    >;
    for (const pillar of ALL_PRIMARY_PILLARS) {
        pillars[pillar] =
            Math.round((acc.pillarSums[pillar] / count) * SCORE_ROUNDING) / SCORE_ROUNDING;
    }
    const tenDimensions: Record<QualityDimension, number> = {} as Record<QualityDimension, number>;
    for (const dimension of ALL_QUALITY_DIMENSIONS) {
        tenDimensions[dimension] =
            Math.round((acc.dimSums[dimension] / count) * SCORE_ROUNDING) / SCORE_ROUNDING;
    }
    return {
        compositeScore: Math.round((acc.sumComposite / count) * SCORE_ROUNDING) / SCORE_ROUNDING,
        pillars,
        tenDimensions,
    };
}

/**
 * Aggregates file scores within a single module into a ModuleQualityScore.
 */
function buildModuleScores(modMap: Map<string, FileQualityScore[]>): ModuleQualityScore[] {
    const modules: ModuleQualityScore[] = [];
    for (const [moduleName, files] of modMap.entries()) {
        const acc = initScoreAccumulator();
        for (let i = 0; i < files.length; i++) {
            const fileScore = files[i];
            accumulateScoreItem(
                acc,
                fileScore.compositeScore,
                fileScore.eightPillars.pillars,
                fileScore.tenDimensions,
            );
        }
        const averages = finalizeAverageScores(acc);
        modules.push({
            moduleName,
            fileCount: files.length,
            compositeScore: averages.compositeScore,
            pillars: averages.pillars,
            tenDimensions: averages.tenDimensions,
            files,
        });
    }
    return modules;
}

/**
 * Aggregates module scores across domain boundaries into DomainQualityScores.
 */
function buildDomainScores(
    domainMap: Map<string, Map<string, FileQualityScore[]>>,
): DomainQualityScore[] {
    const domains: DomainQualityScore[] = [];
    for (const [domainName, modMap] of domainMap.entries()) {
        const modules = buildModuleScores(modMap);
        const acc = initScoreAccumulator();
        for (let i = 0; i < modules.length; i++) {
            const moduleScore = modules[i];
            accumulateScoreItem(
                acc,
                moduleScore.compositeScore,
                moduleScore.pillars,
                moduleScore.tenDimensions,
            );
        }
        const averages = finalizeAverageScores(acc);
        domains.push({
            domainName,
            compositeScore: averages.compositeScore,
            pillars: averages.pillars,
            tenDimensions: averages.tenDimensions,
            modules,
        });
    }
    return domains;
}

/**
 * Computes normalized project-level quality pillar scores using log-smoothed LOC weighting.
 *
 * The weight `w_i = ln(LOC_i + 10)` keeps a very large boilerplate or dictionary file from
 * drowning out a small core algorithmic module in the project-level average.
 */
function computeProjectPillars(
    fileScores: FileQualityScore[],
    fatalCount: number,
): Record<PrimaryQualityPillar, number> {
    const globalPillarSums = initPillarSums();

    let weightSum = 0;
    for (const file of fileScores) {
        const fileLoc = Math.max(
            1,
            typeof file.loc === 'number' && Number.isFinite(file.loc) ? file.loc : 1,
        );
        const fileWeight = Math.log(fileLoc + LOC_LOG_SMOOTH_BIAS);
        weightSum += fileWeight;
        for (const pillar of ALL_PRIMARY_PILLARS) {
            globalPillarSums[pillar] += file.eightPillars.pillars[pillar] * fileWeight;
        }
    }

    const safeTotalWeight = Math.max(1, weightSum);
    const projectPillars: Record<PrimaryQualityPillar, number> = {} as Record<
        PrimaryQualityPillar,
        number
    >;
    for (const pillar of ALL_PRIMARY_PILLARS) {
        projectPillars[pillar] =
            Math.round((globalPillarSums[pillar] / safeTotalWeight) * SCORE_ROUNDING) /
            SCORE_ROUNDING;
    }

    if (fatalCount > 0) {
        const hasFatalArch = fileScores.some((fileScore) =>
            fileScore.issues.some(
                (i) => i.severity === SEVERITY_ERROR && i.rule.startsWith(PREFIX_RULE_ARCH),
            ),
        );
        if (hasFatalArch && projectPillars.architecture > FATAL_ARCH_CEILING) {
            projectPillars.architecture = FATAL_ARCH_CEILING;
        }
    }

    return projectPillars;
}

/**
 * Creates an empty project score structure when no files are provided.
 */
function createEmptyProjectScore(): ProjectQualityScore {
    const emptyDimensions: Record<QualityDimension, number> = {} as Record<
        QualityDimension,
        number
    >;
    for (const dimension of ALL_QUALITY_DIMENSIONS) {
        emptyDimensions[dimension] =
            dimension === DIMENSION_CODE_SECURITY ? DEFAULT_SECURITY_CEILING : DIMENSION_MAX_SCORE;
    }
    const emptyPillars = synthesizeEightPillars(emptyDimensions);
    return {
        compositeScore: emptyPillars.compositeScore,
        grade: resolveQualityGrade(emptyPillars.compositeScore),
        eightPillars: emptyPillars,
        tenDimensions: emptyDimensions,
        effectiveCodeDensity: 1.0,
        densityTensorSummary: {
            compositeDensity: 1.0,
            averageTspr: 1.0,
            averagePor: 0.0,
            averageColumnDensity: 1.0,
            averageSpatialDensity: 1.0,
            averageMahalanobisDistance: 0.0,
            averageFisherSimplexDistance: 0.0,
        },
        domains: [],
        totalFiles: 0,
        totalIssues: 0,
        fatalCount: 0,
    };
}

/**
 * Accumulated file-level metrics across the project.
 */
interface AccumulatedProjectMetrics {
    readonly domainMap: Map<string, Map<string, FileQualityScore[]>>;
    readonly totalIssues: number;
    readonly fatalCount: number;
    readonly totalDensity: number;
    readonly totalCompositeDensity: number;
    readonly totalTspr: number;
    readonly totalPor: number;
    readonly totalColumnDensity: number;
    readonly totalSpatialDensity: number;
    readonly totalMahalanobisDistance: number;
    readonly totalFisherSimplexDistance: number;
    readonly countSpatial: number;
    readonly totalLoc: number;
    readonly totalDimWeight: number;
    readonly projectDimSums: Record<QualityDimension, number>;
}

/**
 * Counts error-level findings across an issue list.
 */
function countFatalIssues(issues: FileQualityScore['issues']): number {
    let count = 0;
    for (let i = 0; i < issues.length; i++) {
        if (issues[i].severity === SEVERITY_ERROR) {
            count++;
        }
    }
    return count;
}

/**
 * Records a file into domain and module hierarchy groupings.
 */
function recordDomainModule(
    domainMap: Map<string, Map<string, FileQualityScore[]>>,
    file: FileQualityScore,
): void {
    const moduleMap = getOrCreateDomainModuleMap(domainMap, file.domainName);
    let list = moduleMap.get(file.moduleName);
    if (!list) {
        list = [];
        moduleMap.set(file.moduleName, list);
    }
    list.push(file);
}

/**
 * Adds file dimension scores into log-smoothed weighted project dimension sums.
 */
function accumulateDimensionSums(
    projectDimSums: Record<QualityDimension, number>,
    file: FileQualityScore,
    fileWeight: number,
): void {
    const fDims = file.tenDimensions;
    for (const dimension of ALL_QUALITY_DIMENSIONS) {
        const fallback =
            dimension === DIMENSION_CODE_SECURITY ? DEFAULT_SECURITY_CEILING : DIMENSION_MAX_SCORE;
        const dimScore = fDims?.[dimension] ?? fallback;
        projectDimSums[dimension] += dimScore * fileWeight;
    }
}

/**
 * Accumulates issues, lines of code, and dimension penalties across files.
 */
function accumulateProjectMetrics(fileScores: FileQualityScore[]): AccumulatedProjectMetrics {
    const domainMap = new Map<string, Map<string, FileQualityScore[]>>();
    let totalIssues = 0;
    let fatalCount = 0;
    let totalDensity = 0;
    let totalCompositeDensity = 0;
    let totalTspr = 0;
    let totalPor = 0;
    let totalColumnDensity = 0;
    let totalSpatialDensity = 0;
    let totalMahalanobisDistance = 0;
    let totalFisherSimplexDistance = 0;
    let countSpatial = 0;
    let totalLoc = 0;
    let totalDimWeight = 0;

    const projectDimSums: Record<QualityDimension, number> = {} as Record<QualityDimension, number>;
    for (const dimension of ALL_QUALITY_DIMENSIONS) {
        projectDimSums[dimension] = 0;
    }

    for (const file of fileScores) {
        totalIssues += file.issues.length;
        fatalCount += countFatalIssues(file.issues);
        totalDensity += file.effectiveDensity;

        const density = file.densityMetrics;
        if (density) {
            totalCompositeDensity += density.compositeDensity;
            totalTspr += density.tspr;
            totalPor += density.por;
            totalColumnDensity += density.columnDensity;
            if (typeof density.spatialDensity === 'number') {
                totalSpatialDensity += density.spatialDensity;
                totalMahalanobisDistance += density.mahalanobisDistance ?? 0;
                totalFisherSimplexDistance += density.fisherSimplexDistance ?? 0;
                countSpatial++;
            }
        } else {
            totalCompositeDensity += file.effectiveDensity;
            totalTspr += file.effectiveDensity;
            totalPor += Math.max(0, 1.0 - file.effectiveDensity);
            totalColumnDensity += 1.0;
        }

        recordDomainModule(domainMap, file);

        const fileLoc = Math.max(
            1,
            typeof file.loc === 'number' && Number.isFinite(file.loc) ? file.loc : 1,
        );
        const fileWeight = Math.log(fileLoc + LOC_LOG_SMOOTH_BIAS);
        totalLoc += fileLoc;
        totalDimWeight += fileWeight;
        accumulateDimensionSums(projectDimSums, file, fileWeight);
    }

    return {
        domainMap,
        totalIssues,
        fatalCount,
        totalDensity,
        totalCompositeDensity,
        totalTspr,
        totalPor,
        totalColumnDensity,
        totalSpatialDensity,
        totalMahalanobisDistance,
        totalFisherSimplexDistance,
        countSpatial,
        totalLoc,
        totalDimWeight,
        projectDimSums,
    };
}

/**
 * Computes log-smoothed ten-dimension project scores.
 */
function computeWeightedProjectDimensions(
    projectDimSums: Record<QualityDimension, number>,
    totalDimWeight: number,
): Record<QualityDimension, number> {
    const safeTotalWeight = Math.max(1, totalDimWeight);
    const projectDimensions: Record<QualityDimension, number> = {} as Record<
        QualityDimension,
        number
    >;
    for (const dimension of ALL_QUALITY_DIMENSIONS) {
        projectDimensions[dimension] = clampScore(projectDimSums[dimension] / safeTotalWeight);
    }
    return projectDimensions;
}

/**
 * Finalizes synthesized eight pillars with primary weights and a geometric-mean composite.
 */
function finalizeProjectEightPillars(
    projectDimensions: Record<QualityDimension, number>,
    projectPillars: Record<PrimaryQualityPillar, number>,
): EightPillarBreakdown {
    const synthesized = synthesizeEightPillars(
        projectDimensions,
        projectPillars.data,
        projectPillars.testing,
        [],
        {},
        SYNTHESIS_MODE_GEOMETRIC,
    );
    synthesized.pillars = projectPillars;
    let totalWeight = 0;
    let logSum = 0;
    for (const pillar of ALL_PRIMARY_PILLARS) {
        const weight = synthesized.weights[pillar];
        const boundedScore = Math.max(
            BOUNDED_SCORE_MIN,
            Math.min(DIMENSION_MAX_SCORE, projectPillars[pillar]),
        );
        logSum += weight * Math.log(boundedScore);
        totalWeight += weight;
    }
    synthesized.compositeScore =
        totalWeight > 0
            ? clampScore(
                  Math.round(Math.exp(logSum / totalWeight) * SCORE_ROUNDING) / SCORE_ROUNDING,
              )
            : DEFAULT_PROJECT_COMPOSITE;
    return synthesized;
}

/**
 * Aggregates file quality scores into module, domain, and project levels.
 *
 * @param fileScores - List of individual file scores to aggregate.
 * @returns Fully aggregated project-level quality score.
 */
export function aggregateProjectScore(fileScores: FileQualityScore[]): ProjectQualityScore {
    if (fileScores.length === 0) {
        return createEmptyProjectScore();
    }

    const metrics = accumulateProjectMetrics(fileScores);
    const domains = buildDomainScores(metrics.domainMap);
    const projectPillars = computeProjectPillars(fileScores, metrics.fatalCount);
    const projectDimensions = computeWeightedProjectDimensions(
        metrics.projectDimSums,
        metrics.totalDimWeight,
    );
    const synthesized = finalizeProjectEightPillars(projectDimensions, projectPillars);

    const count = Math.max(1, fileScores.length);
    const avgEffective = clampRatio(
        Math.round((metrics.totalDensity / count) * RATIO_SCALE_HUNDRED) / RATIO_SCALE_HUNDRED,
    );
    const avgComposite = clampRatio(
        Math.round((metrics.totalCompositeDensity / count) * RATIO_SCALE_HUNDRED) /
            RATIO_SCALE_HUNDRED,
    );
    const avgTspr = clampRatio(
        Math.round((metrics.totalTspr / count) * RATIO_SCALE_THOUSAND) / RATIO_SCALE_THOUSAND,
    );
    const avgPor = clampRatio(
        Math.round((metrics.totalPor / count) * RATIO_SCALE_THOUSAND) / RATIO_SCALE_THOUSAND,
    );
    const avgCol = clampRatio(
        Math.round((metrics.totalColumnDensity / count) * RATIO_SCALE_THOUSAND) /
            RATIO_SCALE_THOUSAND,
    );
    const safeSpatialCount = Math.max(1, metrics.countSpatial || count);
    const avgSpatial = clampRatio(
        Math.round((metrics.totalSpatialDensity / safeSpatialCount) * RATIO_SCALE_THOUSAND) /
            RATIO_SCALE_THOUSAND,
    );
    const avgMahalanobis =
        Math.round((metrics.totalMahalanobisDistance / safeSpatialCount) * RATIO_SCALE_THOUSAND) /
        RATIO_SCALE_THOUSAND;
    const avgFisher =
        Math.round((metrics.totalFisherSimplexDistance / safeSpatialCount) * RATIO_SCALE_THOUSAND) /
        RATIO_SCALE_THOUSAND;

    return {
        compositeScore: synthesized.compositeScore,
        grade: resolveQualityGrade(synthesized.compositeScore),
        eightPillars: synthesized,
        tenDimensions: projectDimensions,
        effectiveCodeDensity: avgEffective,
        densityTensorSummary: {
            compositeDensity: avgComposite,
            averageTspr: avgTspr,
            averagePor: avgPor,
            averageColumnDensity: avgCol,
            averageSpatialDensity: avgSpatial,
            averageMahalanobisDistance: avgMahalanobis,
            averageFisherSimplexDistance: avgFisher,
        },
        domains,
        totalFiles: fileScores.length,
        totalIssues: metrics.totalIssues,
        fatalCount: metrics.fatalCount,
    };
}
