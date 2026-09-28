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
import { resolveQualityGrade } from './scorer-formulas';

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
    effectiveDensity: number;
    functions: FunctionQualityScore[];
    issues: Issue[];
}

/**
 * Scored module-level quality breakdown.
 */
export interface ModuleQualityScore {
    moduleName: string;
    fileCount: number;
    compositeScore: number;
    pillars: Record<PrimaryQualityPillar, number>;
    files: FileQualityScore[];
}

/**
 * Scored domain-level quality breakdown.
 */
export interface DomainQualityScore {
    domainName: string;
    compositeScore: number;
    pillars: Record<PrimaryQualityPillar, number>;
    modules: ModuleQualityScore[];
}

/**
 * Scored repository-wide project quality breakdown.
 */
export interface ProjectQualityScore {
    compositeScore: number;
    grade: QualityGrade;
    eightPillars: EightPillarBreakdown;
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

    // 3. Base dimension indices (starts at 100)
    const indices: Record<QualityDimension, number> = {} as Record<QualityDimension, number>;
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        indices[dim] = 100.0;
    }

    // Apply pillar deductions
    indices.architectureConsistency = Math.max(0, 100 - riskResult.pillarPenalties.architecture);
    indices.maintainability = Math.max(
        0,
        100 - riskResult.pillarPenalties.maintainability - (densityResult.isLowDensity ? 15 : 0),
    );
    indices.performanceEfficiency = Math.max(0, 100 - riskResult.pillarPenalties.performance);
    indices.codeSecurity = Math.max(0, 100 - riskResult.pillarPenalties.security);
    indices.modernity = Math.max(0, 100 - riskResult.pillarPenalties.testing);
    indices.semanticPurity = Math.max(0, 100 - riskResult.pillarPenalties.reliability);

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
        effectiveDensity: densityResult.effectiveDensity,
        functions: [],
        issues: allIssues,
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
        const avgComposite = files.reduce((sum, f) => sum + f.compositeScore, 0) / files.length;
        const pillars: Record<PrimaryQualityPillar, number> = {} as Record<
            PrimaryQualityPillar,
            number
        >;
        for (const p of ALL_PRIMARY_PILLARS) {
            const avgP =
                files.reduce((sum, f) => sum + f.eightPillars.pillars[p], 0) / files.length;
            pillars[p] = Math.round(avgP * 10) / 10;
        }
        modules.push({
            moduleName,
            fileCount: files.length,
            compositeScore: Math.round(avgComposite * 10) / 10,
            pillars,
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
        const domainComposite =
            modules.reduce((sum, m) => sum + m.compositeScore, 0) / modules.length;
        const domainPillars: Record<PrimaryQualityPillar, number> = {} as Record<
            PrimaryQualityPillar,
            number
        >;
        for (const p of ALL_PRIMARY_PILLARS) {
            const avgP = modules.reduce((sum, m) => sum + m.pillars[p], 0) / modules.length;
            domainPillars[p] = Math.round(avgP * 10) / 10;
        }
        domains.push({
            domainName,
            compositeScore: Math.round(domainComposite * 10) / 10,
            pillars: domainPillars,
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
        projectPillars[p] = Math.round((globalPillarSums[p] / fileScores.length) * 10) / 10;
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
 * Aggregates file quality scores into module, domain, and project levels.
 *
 * @param fileScores - List of individual file scores to aggregate.
 * @returns Fully aggregated project-level quality score.
 */
export function aggregateProjectScore(fileScores: FileQualityScore[]): ProjectQualityScore {
    if (fileScores.length === 0) {
        const emptyPillars = synthesizeEightPillars({} as Record<QualityDimension, number>);
        return {
            compositeScore: 100.0,
            grade: 'A+',
            eightPillars: emptyPillars,
            effectiveCodeDensity: 1.0,
            domains: [],
            totalFiles: 0,
            totalIssues: 0,
            fatalCount: 0,
        };
    }

    const domainMap = new Map<string, Map<string, FileQualityScore[]>>();
    let totalIssues = 0;
    let fatalCount = 0;
    let totalDensity = 0;

    for (const file of fileScores) {
        totalIssues += file.issues.length;
        fatalCount += file.issues.filter((i) => i.severity === 'error').length;
        totalDensity += file.effectiveDensity;

        const moduleMap = getOrCreateDomainModuleMap(domainMap, file.domainName);
        let list = moduleMap.get(file.moduleName);
        if (!list) {
            list = [];
            moduleMap.set(file.moduleName, list);
        }
        list.push(file);
    }

    const domains = buildDomainScores(domainMap);
    const projectPillars = computeProjectPillars(fileScores, fatalCount);

    const synthesized = synthesizeEightPillars(
        {} as Record<QualityDimension, number>,
        projectPillars.data,
        projectPillars.testing,
        [],
    );
    synthesized.pillars = projectPillars;
    const finalComposite =
        Math.round(
            ALL_PRIMARY_PILLARS.reduce(
                (sum, p) => sum + projectPillars[p] * synthesized.weights[p],
                0,
            ) * 10,
        ) / 10;
    synthesized.compositeScore = finalComposite;

    return {
        compositeScore: finalComposite,
        grade: resolveQualityGrade(finalComposite),
        eightPillars: synthesized,
        effectiveCodeDensity: Math.round((totalDensity / fileScores.length) * 100) / 100,
        domains,
        totalFiles: fileScores.length,
        totalIssues,
        fatalCount,
    };
}
