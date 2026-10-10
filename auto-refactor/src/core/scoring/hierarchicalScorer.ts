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
import type { EightPillarBreakdown, PrimaryQualityPillar } from './eightPillarModel';
import { ALL_PRIMARY_PILLARS, synthesizeEightPillars } from './eightPillarModel';
import { computeRiskWeightedPenalties } from './riskWeightModel';
import { computeEffectiveCodeDensity } from './effectiveDensity';
import { detectScoreGaming } from './antiGaming';
import type { QualityDimension, QualityGrade } from './scoringTypes';
import { ALL_QUALITY_DIMENSIONS } from './scoringTypes';
// Grade thresholds live in scorer-formulas as the single source of truth. This module used to
// carry its own copy (95/85/75/65/50) which disagreed with the snapshot model, so the same
// 92 points read as A+ on one surface and A on the other. It also had no NaN case, which
// graded unmeasured input as F.
import {
    computeSecurityCeiling,
    DIMENSION_MAX_SCORE,
    resolveQualityGrade,
    SCORE_ROUNDING,
} from './scorer-formulas';

/** Default fallback security ceiling for unmeasured scopes. */
export const DEFAULT_SECURITY_CEILING = computeSecurityCeiling();

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
    domains: DomainQualityScore[];
    totalFiles: number;
    totalIssues: number;
    fatalCount: number;
}

/**
 * Evaluates file-level quality.
 *
 * @param filePath - Path of the file being evaluated.
 * @param content - Full source content of the file.
 * @param issues - Detected issues within the file.
 * @param domainName - Optional domain grouping identifier.
 * @param moduleName - Optional module grouping identifier.
 * @returns File quality evaluation score breakdown.
 */
export function scoreFileQuality(
    filePath: string,
    content: string,
    issues: Issue[],
    domainName: string = 'core',
    moduleName: string = 'root',
): FileQualityScore {
    // 1. Density and anti-gaming
    const densityResult = computeEffectiveCodeDensity(content);
    const gamingResult = detectScoreGaming(filePath, content);
    const allIssues = [...issues, ...gamingResult.issues];

    // 2. Risk penalty and ceilings
    const riskResult = computeRiskWeightedPenalties(allIssues);
    const loc = Math.max(1, content ? content.split('\n').length : 1);
    const scaleFactor = Math.max(1, loc / 100);
    const securityCeiling = computeSecurityCeiling(null, scaleFactor);

    // 3. Base dimension indices (starts at securityCeiling or 100,
    //    deducted by riskResult.dimensionPenalties)
    const indices: Record<QualityDimension, number> = {} as Record<QualityDimension, number>;
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        let dimPenalty = riskResult.dimensionPenalties?.[dim] ?? 0;
        if (dim === 'maintainability' && densityResult.isLowDensity) {
            dimPenalty += 15;
        }
        const baseScore = dim === 'codeSecurity' ? securityCeiling : DIMENSION_MAX_SCORE;
        indices[dim] = Math.max(
            0,
            Math.round((baseScore - dimPenalty) * SCORE_ROUNDING) / SCORE_ROUNDING,
        );
    }

    const dataScore = Math.max(0, 100 - riskResult.pillarPenalties.data);
    const testingScore = Math.max(0, 100 - riskResult.pillarPenalties.testing);

    // 4. Synthesize 8 pillars with non-linear ceilings
    const eightPillars = synthesizeEightPillars(
        indices,
        dataScore,
        testingScore,
        riskResult.ceilings,
    );

    return {
        filePath,
        domainName,
        moduleName,
        compositeScore: eightPillars.compositeScore,
        eightPillars,
        tenDimensions: { ...indices },
        effectiveDensity: densityResult.effectiveDensity,
        functions: [],
        issues: allIssues,
        loc,
    };
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

/**
 * Aggregates file scores within a single module into a ModuleQualityScore.
 */
function buildModuleScores(modMap: Map<string, FileQualityScore[]>): ModuleQualityScore[] {
    const modules: ModuleQualityScore[] = [];
    for (const [moduleName, files] of modMap.entries()) {
        const count = files.length;
        let sumComposite = 0;
        const pillarSums: Record<PrimaryQualityPillar, number> = {
            architecture: 0,
            maintainability: 0,
            performance: 0,
            data: 0,
            testing: 0,
            reliability: 0,
            security: 0,
            extensibility: 0,
        };
        const dimSums: Record<QualityDimension, number> = {
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
        };

        for (let i = 0; i < count; i++) {
            const f = files[i];
            sumComposite += f.compositeScore;
            for (const p of ALL_PRIMARY_PILLARS) {
                pillarSums[p] += f.eightPillars.pillars[p];
            }
            for (const d of ALL_QUALITY_DIMENSIONS) {
                const fallback =
                    d === 'codeSecurity' ? DEFAULT_SECURITY_CEILING : DIMENSION_MAX_SCORE;
                dimSums[d] += f.tenDimensions?.[d] ?? fallback;
            }
        }

        const pillars: Record<PrimaryQualityPillar, number> = {} as Record<
            PrimaryQualityPillar,
            number
        >;
        for (const p of ALL_PRIMARY_PILLARS) {
            pillars[p] = Math.round((pillarSums[p] / count) * SCORE_ROUNDING) / SCORE_ROUNDING;
        }

        const tenDimensions: Record<QualityDimension, number> = {} as Record<
            QualityDimension,
            number
        >;
        for (const d of ALL_QUALITY_DIMENSIONS) {
            tenDimensions[d] = Math.round((dimSums[d] / count) * SCORE_ROUNDING) / SCORE_ROUNDING;
        }

        modules.push({
            moduleName,
            fileCount: count,
            compositeScore: Math.round((sumComposite / count) * SCORE_ROUNDING) / SCORE_ROUNDING,
            pillars,
            tenDimensions,
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
        const mCount = modules.length;
        let sumComposite = 0;
        const pillarSums: Record<PrimaryQualityPillar, number> = {
            architecture: 0,
            maintainability: 0,
            performance: 0,
            data: 0,
            testing: 0,
            reliability: 0,
            security: 0,
            extensibility: 0,
        };
        const dimSums: Record<QualityDimension, number> = {
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
        };

        for (let i = 0; i < mCount; i++) {
            const m = modules[i];
            sumComposite += m.compositeScore;
            for (const p of ALL_PRIMARY_PILLARS) {
                pillarSums[p] += m.pillars[p];
            }
            for (const d of ALL_QUALITY_DIMENSIONS) {
                const fallback =
                    d === 'codeSecurity' ? DEFAULT_SECURITY_CEILING : DIMENSION_MAX_SCORE;
                dimSums[d] += m.tenDimensions?.[d] ?? fallback;
            }
        }

        const domainPillars: Record<PrimaryQualityPillar, number> = {} as Record<
            PrimaryQualityPillar,
            number
        >;
        for (const p of ALL_PRIMARY_PILLARS) {
            domainPillars[p] =
                Math.round((pillarSums[p] / mCount) * SCORE_ROUNDING) / SCORE_ROUNDING;
        }

        const domainDims: Record<QualityDimension, number> = {} as Record<QualityDimension, number>;
        for (const d of ALL_QUALITY_DIMENSIONS) {
            domainDims[d] = Math.round((dimSums[d] / mCount) * SCORE_ROUNDING) / SCORE_ROUNDING;
        }

        domains.push({
            domainName,
            compositeScore: Math.round((sumComposite / mCount) * SCORE_ROUNDING) / SCORE_ROUNDING,
            pillars: domainPillars,
            tenDimensions: domainDims,
            modules,
        });
    }
    return domains;
}

/**
 * Computes normalized project-level quality pillar scores across all files.
 */
function computeProjectPillars(
    fileScores: FileQualityScore[],
    fatalCount: number,
): Record<PrimaryQualityPillar, number> {
    const globalPillarSums: Record<PrimaryQualityPillar, number> = {
        architecture: 0,
        maintainability: 0,
        performance: 0,
        data: 0,
        testing: 0,
        reliability: 0,
        security: 0,
        extensibility: 0,
    };

    for (const file of fileScores) {
        for (const p of ALL_PRIMARY_PILLARS) {
            globalPillarSums[p] += file.eightPillars.pillars[p];
        }
    }

    const projectPillars: Record<PrimaryQualityPillar, number> = {} as Record<
        PrimaryQualityPillar,
        number
    >;
    for (const p of ALL_PRIMARY_PILLARS) {
        projectPillars[p] =
            Math.round((globalPillarSums[p] / fileScores.length) * SCORE_ROUNDING) / SCORE_ROUNDING;
    }

    if (fatalCount > 0) {
        const hasFatalArch = fileScores.some((f) =>
            f.issues.some((i) => i.severity === 'error' && i.rule.startsWith('ARCH-')),
        );
        if (hasFatalArch && projectPillars.architecture > 45) {
            projectPillars.architecture = 45;
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
    for (const d of ALL_QUALITY_DIMENSIONS) {
        emptyDimensions[d] = d === 'codeSecurity' ? DEFAULT_SECURITY_CEILING : DIMENSION_MAX_SCORE;
    }
    const emptyPillars = synthesizeEightPillars(emptyDimensions);
    return {
        compositeScore: emptyPillars.compositeScore,
        grade: resolveQualityGrade(emptyPillars.compositeScore),
        eightPillars: emptyPillars,
        tenDimensions: emptyDimensions,
        effectiveCodeDensity: 1.0,
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
    readonly totalLoc: number;
    readonly projectDimSums: Record<QualityDimension, number>;
}

/**
 * Counts error-level findings across an issue list.
 */
function countFatalIssues(issues: FileQualityScore['issues']): number {
    let count = 0;
    for (let i = 0; i < issues.length; i++) {
        if (issues[i].severity === 'error') {
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
 * Adds file dimension scores into weighted project dimension sums.
 */
function accumulateDimensionSums(
    projectDimSums: Record<QualityDimension, number>,
    file: FileQualityScore,
    fileLoc: number,
): void {
    const fDims = file.tenDimensions;
    for (const d of ALL_QUALITY_DIMENSIONS) {
        const fallback = d === 'codeSecurity' ? DEFAULT_SECURITY_CEILING : DIMENSION_MAX_SCORE;
        const dimScore = fDims?.[d] ?? fallback;
        projectDimSums[d] += dimScore * fileLoc;
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
    let totalLoc = 0;

    const projectDimSums: Record<QualityDimension, number> = {} as Record<QualityDimension, number>;
    for (const d of ALL_QUALITY_DIMENSIONS) {
        projectDimSums[d] = 0;
    }

    for (const file of fileScores) {
        totalIssues += file.issues.length;
        fatalCount += countFatalIssues(file.issues);
        totalDensity += file.effectiveDensity;

        recordDomainModule(domainMap, file);

        const fileLoc = Math.max(
            1,
            typeof file.loc === 'number' && Number.isFinite(file.loc) ? file.loc : 1,
        );
        totalLoc += fileLoc;
        accumulateDimensionSums(projectDimSums, file, fileLoc);
    }

    return { domainMap, totalIssues, fatalCount, totalDensity, totalLoc, projectDimSums };
}

/**
 * Computes LOC-weighted ten-dimension project scores.
 */
function computeWeightedProjectDimensions(
    projectDimSums: Record<QualityDimension, number>,
    totalLoc: number,
): Record<QualityDimension, number> {
    const safeTotalLoc = Math.max(1, totalLoc);
    const projectDimensions: Record<QualityDimension, number> = {} as Record<
        QualityDimension,
        number
    >;
    for (const d of ALL_QUALITY_DIMENSIONS) {
        projectDimensions[d] =
            Math.round((projectDimSums[d] / safeTotalLoc) * SCORE_ROUNDING) / SCORE_ROUNDING;
    }
    return projectDimensions;
}

/**
 * Finalizes synthesized eight pillars with primary weights and composite score.
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
    );
    synthesized.pillars = projectPillars;
    let finalCompositeSum = 0;
    for (const p of ALL_PRIMARY_PILLARS) {
        finalCompositeSum += projectPillars[p] * synthesized.weights[p];
    }
    synthesized.compositeScore = Math.round(finalCompositeSum * SCORE_ROUNDING) / SCORE_ROUNDING;
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
        metrics.totalLoc,
    );
    const synthesized = finalizeProjectEightPillars(projectDimensions, projectPillars);

    return {
        compositeScore: synthesized.compositeScore,
        grade: resolveQualityGrade(synthesized.compositeScore),
        eightPillars: synthesized,
        tenDimensions: projectDimensions,
        effectiveCodeDensity: Math.round((metrics.totalDensity / fileScores.length) * 100) / 100,
        domains,
        totalFiles: fileScores.length,
        totalIssues: metrics.totalIssues,
        fatalCount: metrics.fatalCount,
    };
}
