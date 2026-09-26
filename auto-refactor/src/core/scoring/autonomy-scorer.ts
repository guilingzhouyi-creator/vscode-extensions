/**
 * Module: Core Engine — Project In-House Autonomy Scorer (CAI)
 * File Path: src/core/scoring/autonomy-scorer.ts
 * Architecture Role: Evaluates self-development ratio (In-House Autonomy Index) across four
 *   orthogonal dimensions: effective LOC autonomy, symbol call graph autonomy, domain kernel
 *   density, and code originality.
 * Dependencies & Triggers: Consumes dependency-provenance, file-role-inference, zone-partitioner,
 *   and ScanConfig; invoked by reportBuilder to embed autonomy insights into ScanReport.
 * Responsibilities:
 *   1. Quantify proprietary vs in-tree vendor vs generated effective lines of code;
 *   2. Quantify internal module calls vs external third-party SDK calls;
 *   3. Quantify core algorithm/domain kernel density against glue layers;
 *   4. Quantify code originality by auditing cloned/borrowed token blocks;
 *   5. Produce composite autonomy index (0~100%), qualitative tier (L1~L5), and SDK inventory.
 * Exit Semantics & Design Rationale: Never throws; deterministic mathematical evaluation with
 *   defensive division-by-zero guards and graceful handling for minimal single-file libraries.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FileMetric, Issue, ScanConfig } from '../types';
import {
    classifyFileProvenance,
    classifyImportProvenance,
    loadProjectManifestDependencies,
    loadProjectSupplyChainProfile,
    type SupplyChainProfile,
} from '../intelligence/dependency-provenance';
import { inferFineGrainedFileRole } from '../intelligence/file-role-inference';

/** Qualitative autonomy grade tiers */
export type AutonomyGrade =
    | 'L5_INDEPENDENT'
    | 'L4_HIGH_AUTONOMY'
    | 'L3_BALANCED'
    | 'L2_FRAMEWORK_DEPENDENT'
    | 'L1_SHALLOW_WRAPPER';

/** Six orthogonal autonomy sub-dimension scores (each normalized 0.0 ~ 100.0) */
export interface AutonomyDimensions {
    /** R_loc: Ratio of proprietary effective LOC over total tree effective LOC */
    effectiveLocAutonomy: number;
    /** R_call: Ratio of internal symbol calls over total calls (internal + external SDK) */
    symbolCallAutonomy: number;
    /** R_domain: Ratio of core algorithm and domain logic over total proprietary code */
    domainKernelDensity: number;
    /** R_pure: Originality score penalizing large unmanaged cloned/borrowed blocks */
    codeOriginality: number;
    /** R_supply: Resilience against deep transitive external dependency graph explosion */
    supplyChainResilience: number;
    /** R_critical: In-house ratio across security, auth, crypto, and runtime dispatch paths */
    criticalPathAutonomy: number;
}

/** Detail record of an external third-party SDK utilized by the project */
export interface ExternalSdkUsage {
    name: string;
    callCount: number;
    fileCount: number;
}

/** Statistical credible interval and sample sufficiency assessment */
export interface AutonomyConfidence {
    /** Sample sufficiency ratio S in [0.0, 1.0] based on proprietary LOC and file counts */
    sampleSufficiency: number;
    /** Conservative credible lower bound for autonomy rating (0.0 ~ 100.0) */
    lowerBound: number;
    /** Optimistic credible upper bound for autonomy rating (0.0 ~ 100.0) */
    upperBound: number;
    /** Bayesian smoothed score pulling sparse samples toward prior baseline */
    credibleScore: number;
    /** True when sample size is insufficient to guarantee high statistical confidence */
    isLowConfidence: boolean;
}

/** Comprehensive autonomy evaluation outcome */
export interface AutonomyEvaluation {
    /** Composite Autonomy Index (0.0 ~ 100.0%) */
    compositeAutonomyIndex: number;
    /** Qualitative grade classification */
    grade: AutonomyGrade;
    /** Human-readable grade description */
    gradeDescription: string;
    /** Six orthogonal sub-dimension scores */
    dimensions: AutonomyDimensions;
    /** Dimension weights applied during synthesis */
    weights: {
        effectiveLoc: number;
        symbolCall: number;
        domainKernel: number;
        codeOriginality: number;
        supplyChainResilience: number;
        criticalPathAutonomy: number;
    };
    /** Bayesian statistical confidence assessment */
    confidence: AutonomyConfidence;
    /** Supply chain lockfile and dependency tree profile */
    supplyChain: {
        hasLockfile: boolean;
        lockfileType: string;
        directDependencies: number;
        transitiveDependencies: number;
        totalLockfilePackages: number;
        estimatedDepth: number;
    };
    /** Inventory of third-party SDKs imported and invoked */
    externalSdkInventory: ExternalSdkUsage[];
    /** Quantitative accounting metrics */
    stats: {
        totalFiles: number;
        proprietaryFiles: number;
        vendorFiles: number;
        generatedFiles: number;
        totalEffectiveLoc: number;
        proprietaryEffectiveLoc: number;
        vendorEffectiveLoc: number;
        generatedEffectiveLoc: number;
        internalSymbolCalls: number;
        externalSdkCalls: number;
        stdlibCalls: number;
        criticalPathFiles: number;
        criticalPathInternalCalls: number;
        criticalPathExternalCalls: number;
    };
}

/** Default sub-dimension weighting distribution (CAI 2.0 normalized to 1.00) */
const DEFAULT_AUTONOMY_WEIGHTS = {
    effectiveLoc: 0.30,
    symbolCall: 0.20,
    domainKernel: 0.15,
    codeOriginality: 0.15,
    supplyChainResilience: 0.10,
    criticalPathAutonomy: 0.10,
};

/**
 * Assign qualitative grade based on composite autonomy score.
 */
function resolveAutonomyGrade(score: number): {
    grade: AutonomyGrade;
    description: string;
} {
    if (score >= 95.0) {
        return {
            grade: 'L5_INDEPENDENT',
            description: '极高自主率：核心架构与算法完全自研，对外部黑盒 SDK 极低耦合',
        };
    }
    if (score >= 85.0) {
        return {
            grade: 'L4_HIGH_AUTONOMY',
            description: '高度自研：业务逻辑与领域内核完备自主，合理集成标准开源生态',
        };
    }
    if (score >= 70.0) {
        return {
            grade: 'L3_BALANCED',
            description: '均衡研发：核心业务自研与主流第三方框架/云原生生态中度协同',
        };
    }
    if (score >= 50.0) {
        return {
            grade: 'L2_FRAMEWORK_DEPENDENT',
            description: '框架依赖型：较多业务逻辑围绕第三方外部 SDK 胶水编排展开',
        };
    }
    return {
        grade: 'L1_SHALLOW_WRAPPER',
        description: '浅层封装型：以接口透传和第三方实现引用为主，核心自研比重较低',
    };
}

/**
 * Extract module specifiers from a source file via lightweight line inspection.
 */
function extractImportSpecifiersFromContent(content: string): string[] {
    const specifiers: string[] = [];
    const lines = content.split('\n');
    const IMPORT_RE =
        /(?:import\s+(?:.*?\s+from\s+)?|require\s*\(\s*|from\s+)(['"][^'"]+['"])/g;

    for (const line of lines) {
        const trimmed = line.trim();
        if (
            !trimmed ||
            trimmed.startsWith('//') ||
            trimmed.startsWith('#') ||
            trimmed.startsWith('*')
        ) {
            continue;
        }
        let match: RegExpExecArray | null;
        while ((match = IMPORT_RE.exec(trimmed)) !== null) {
            const spec = match[1].replace(/['"]/g, '').trim();
            if (spec) specifiers.push(spec);
        }
    }
    return specifiers;
}

/**
 * Evaluates the in-house self-development ratio across all scanned files.
 *
 * @param fileMetrics - Per-file metrics collected during the scan
 * @param issues - Issues reported across all analyzers
/** Pattern to identify mission-critical runtime, security, crypto, and architecture roots */
const CRITICAL_PATH_PATTERN =
    /(?:auth|crypto|security|cipher|token|signature|hash|tls|ssl|secret|rbac|permission|runtime|kernel|dispatch|protocol|driver|syscall|gateway|bootstrap|main\b)/i;

/**
 * Evaluates the in-house self-development ratio across all scanned files.
 */
interface AutonomyScanState {
    proprietaryFiles: number;
    vendorFiles: number;
    generatedFiles: number;
    proprietaryEffectiveLoc: number;
    vendorEffectiveLoc: number;
    generatedEffectiveLoc: number;
    domainKernelEffectiveLoc: number;
    internalSymbolCalls: number;
    externalSdkCalls: number;
    stdlibCalls: number;
    criticalPathFiles: number;
    criticalPathInternalCalls: number;
    criticalPathExternalCalls: number;
    sdkCallCounts: Map<string, number>;
    sdkFileSets: Map<string, Set<string>>;
}

/**
 * Load raw source content from memory map or disk file.
 */
function loadFileRawContent(
    metric: FileMetric,
    config: ScanConfig,
    fileContents?: Map<string, string>,
): string {
    const raw =
        fileContents?.get(metric.file) || (metric as { content?: string }).content || '';
    if (raw) return raw;
    if (config.root) {
        const absPath = path.isAbsolute(metric.file)
            ? metric.file
            : path.join(config.root, metric.file);
        if (fs.existsSync(absPath)) {
            try {
                return fs.readFileSync(absPath, 'utf8');
            } catch {
                // best-effort fallback: ignored when file is unreadable
            }
        }
    }
    return '';
}

/**
 * Process import specifiers and attribute call weights.
 */
function processImportSpecifiers(
    specifiers: string[],
    currentFile: string,
    manifestDeps: Set<string>,
    state: AutonomyScanState,
    isCritical: boolean,
): void {
    for (const spec of specifiers) {
        const kind = classifyImportProvenance(spec, currentFile, manifestDeps);
        if (kind === 'internal') {
            state.internalSymbolCalls += 2;
            if (isCritical) state.criticalPathInternalCalls += 2;
        } else if (kind === 'stdlib') {
            state.stdlibCalls++;
        } else if (kind === 'external_sdk') {
            state.externalSdkCalls++;
            if (isCritical) state.criticalPathExternalCalls++;
            const pkg = spec.startsWith('@')
                ? spec.split('/').slice(0, 2).join('/')
                : spec.split('/')[0].split('.')[0].toLowerCase();
            state.sdkCallCounts.set(pkg, (state.sdkCallCounts.get(pkg) || 0) + 1);
            if (!state.sdkFileSets.has(pkg)) state.sdkFileSets.set(pkg, new Set());
            state.sdkFileSets.get(pkg)!.add(currentFile);
        }
    }
}

/**
 * Accumulate provenance and complexity metrics for a single file.
 */
function accumulateFileMetric(
    metric: FileMetric,
    config: ScanConfig,
    manifestDeps: Set<string>,
    state: AutonomyScanState,
    fileContents?: Map<string, string>,
): void {
    const rawContent = loadFileRawContent(metric, config, fileContents);
    const provenance = classifyFileProvenance(metric.file, rawContent.slice(0, 500));
    const eloc = metric.lines || 1;

    if (provenance === 'in_tree_vendor') {
        state.vendorFiles++;
        state.vendorEffectiveLoc += eloc;
        return;
    }
    if (provenance === 'generated') {
        state.generatedFiles++;
        state.generatedEffectiveLoc += eloc;
        return;
    }

    state.proprietaryFiles++;
    state.proprietaryEffectiveLoc += eloc;

    const isCritical = CRITICAL_PATH_PATTERN.test(metric.file);
    if (isCritical) {
        state.criticalPathFiles++;
    }

    const roleResult = inferFineGrainedFileRole(metric.file, rawContent.slice(0, 500));
    if (
        roleResult.role === 'algorithm_computation' ||
        roleResult.role === 'core_trunk' ||
        roleResult.role === 'business_module'
    ) {
        state.domainKernelEffectiveLoc += eloc;
    }

    const specifiers = rawContent ? extractImportSpecifiersFromContent(rawContent) : [];
    processImportSpecifiers(specifiers, metric.file, manifestDeps, state, isCritical);
}

/**
 * Quantifies supply chain resilience against external transitive dependency explosion.
 */
function calculateSupplyChainResilience(supplyChain: SupplyChainProfile): number {
    if (supplyChain.directDependencyCount === 0 && supplyChain.totalLockfilePackages === 0) {
        return 100.0;
    }
    const d = supplyChain.directDependencyCount;
    const t = supplyChain.transitiveDependencyCount;
    const depth = supplyChain.estimatedDepth;

    const penalty = d * 0.5 + Math.sqrt(t) * 0.8 + Math.max(0, depth - 1) * 2.0;
    const resilience = Math.max(15.0, Math.min(100.0, 100.0 - penalty));
    return +resilience.toFixed(1);
}

/**
 * Synthesize raw accounting state and issues into AutonomyEvaluation.
 */
function synthesizeAutonomyEvaluation(
    state: AutonomyScanState,
    totalFiles: number,
    issues: Issue[],
    supplyChain: SupplyChainProfile,
): AutonomyEvaluation {
    if (
        state.internalSymbolCalls === 0 &&
        state.proprietaryFiles > 0 &&
        state.externalSdkCalls === 0
    ) {
        state.internalSymbolCalls = state.proprietaryFiles * 5;
    }

    const totalTreeEloc =
        state.proprietaryEffectiveLoc + state.vendorEffectiveLoc + state.generatedEffectiveLoc;
    const rLoc = totalTreeEloc > 0 ? (state.proprietaryEffectiveLoc / totalTreeEloc) * 100 : 100;

    const totalScopedCalls = state.internalSymbolCalls + state.externalSdkCalls;
    const rCall =
        totalScopedCalls > 0 ? (state.internalSymbolCalls / totalScopedCalls) * 100 : 100;

    const rDomain =
        state.proprietaryEffectiveLoc > 0
            ? Math.min(100, (state.domainKernelEffectiveLoc / state.proprietaryEffectiveLoc) * 100)
            : 100;

    const cloneIssues = issues.filter(
        (i) => i.rule === 'HYG-CLN-001' || i.rule === 'duplicate-literal',
    );
    const clonePenalty = Math.min(30, cloneIssues.length * 1.5);
    const rPure = Math.max(70, 100 - clonePenalty);

    const rSupply = calculateSupplyChainResilience(supplyChain);

    const totalCriticalCalls = state.criticalPathInternalCalls + state.criticalPathExternalCalls;
    let rCritical: number;
    if (state.criticalPathFiles > 0 && totalCriticalCalls > 0) {
        rCritical = (state.criticalPathInternalCalls / totalCriticalCalls) * 100;
    } else if (state.criticalPathFiles > 0) {
        rCritical = state.externalSdkCalls === 0 ? 100.0 : rCall;
    } else {
        rCritical = rCall;
    }

    const w = DEFAULT_AUTONOMY_WEIGHTS;
    const compositeScore = +(
        rLoc * w.effectiveLoc +
        rCall * w.symbolCall +
        rDomain * w.domainKernel +
        rPure * w.codeOriginality +
        rSupply * w.supplyChainResilience +
        rCritical * w.criticalPathAutonomy
    ).toFixed(1);

    const boundedComposite = Math.max(0, Math.min(100, compositeScore));
    const { grade, description } = resolveAutonomyGrade(boundedComposite);

    // Bayesian Credible Interval and Sample Sufficiency
    const sampleSufficiency = +(
        Math.min(1.0, state.proprietaryEffectiveLoc / 1000) *
        Math.min(1.0, totalFiles / 5)
    ).toFixed(3);
    const isLowConfidence = sampleSufficiency < 0.50;
    const priorBaseline = 65.0;
    const credibleScore = +(
        sampleSufficiency * boundedComposite +
        (1 - sampleSufficiency) * priorBaseline
    ).toFixed(1);
    const margin = +(2.5 + (1 - sampleSufficiency) * 18.0).toFixed(1);
    const lowerBound = +Math.max(0.0, credibleScore - margin).toFixed(1);
    const upperBound = +Math.min(100.0, credibleScore + margin).toFixed(1);

    const confidence: AutonomyConfidence = {
        sampleSufficiency,
        lowerBound,
        upperBound,
        credibleScore,
        isLowConfidence,
    };

    const externalSdkInventory: ExternalSdkUsage[] = Array.from(state.sdkCallCounts.entries())
        .map(([name, callCount]) => ({
            name,
            callCount,
            fileCount: state.sdkFileSets.get(name)?.size || 1,
        }))
        .sort((a, b) => b.callCount - a.callCount);

    return {
        compositeAutonomyIndex: boundedComposite,
        grade,
        gradeDescription: description,
        dimensions: {
            effectiveLocAutonomy: +rLoc.toFixed(1),
            symbolCallAutonomy: +rCall.toFixed(1),
            domainKernelDensity: +rDomain.toFixed(1),
            codeOriginality: +rPure.toFixed(1),
            supplyChainResilience: +rSupply.toFixed(1),
            criticalPathAutonomy: +rCritical.toFixed(1),
        },
        weights: w,
        confidence,
        supplyChain: {
            hasLockfile: supplyChain.hasLockfile,
            lockfileType: supplyChain.lockfileType,
            directDependencies: supplyChain.directDependencyCount,
            transitiveDependencies: supplyChain.transitiveDependencyCount,
            totalLockfilePackages: supplyChain.totalLockfilePackages,
            estimatedDepth: supplyChain.estimatedDepth,
        },
        externalSdkInventory,
        stats: {
            totalFiles,
            proprietaryFiles: state.proprietaryFiles,
            vendorFiles: state.vendorFiles,
            generatedFiles: state.generatedFiles,
            totalEffectiveLoc: totalTreeEloc,
            proprietaryEffectiveLoc: state.proprietaryEffectiveLoc,
            vendorEffectiveLoc: state.vendorEffectiveLoc,
            generatedEffectiveLoc: state.generatedEffectiveLoc,
            internalSymbolCalls: state.internalSymbolCalls,
            externalSdkCalls: state.externalSdkCalls,
            stdlibCalls: state.stdlibCalls,
            criticalPathFiles: state.criticalPathFiles,
            criticalPathInternalCalls: state.criticalPathInternalCalls,
            criticalPathExternalCalls: state.criticalPathExternalCalls,
        },
    };
}

/**
 * Evaluates in-house code autonomy ratio (CAI 2.0) across six orthogonal dimensions.
 *
 * @param fileMetrics - Scanned file metrics including lines and paths
 * @param issues - Detected issue collection (used for clone and duplication penalty)
 * @param config - Scan configuration holding project root and options
 * @param fileContents - Optional map of file path to raw content for import extraction
 * @returns AutonomyEvaluation
 */
export function evaluateProjectAutonomy(
    fileMetrics: FileMetric[],
    issues: Issue[],
    config: ScanConfig,
    fileContents?: Map<string, string>,
): AutonomyEvaluation {
    const rootDir = config.root || process.cwd();
    const manifestDeps = loadProjectManifestDependencies(rootDir);
    const supplyChain = loadProjectSupplyChainProfile(rootDir, manifestDeps.size);

    const state: AutonomyScanState = {
        proprietaryFiles: 0,
        vendorFiles: 0,
        generatedFiles: 0,
        proprietaryEffectiveLoc: 0,
        vendorEffectiveLoc: 0,
        generatedEffectiveLoc: 0,
        domainKernelEffectiveLoc: 0,
        internalSymbolCalls: 0,
        externalSdkCalls: 0,
        stdlibCalls: 0,
        criticalPathFiles: 0,
        criticalPathInternalCalls: 0,
        criticalPathExternalCalls: 0,
        sdkCallCounts: new Map<string, number>(),
        sdkFileSets: new Map<string, Set<string>>(),
    };

    for (const metric of fileMetrics) {
        accumulateFileMetric(metric, config, manifestDeps, state, fileContents);
    }

    return synthesizeAutonomyEvaluation(state, fileMetrics.length, issues, supplyChain);
}
