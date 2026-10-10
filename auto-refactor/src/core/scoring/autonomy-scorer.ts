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
import type { SymbolIndex } from '../intelligence/symbolIndex';

/**
 * Computes rigorous Bayesian Credible Interval for autonomy index using
 * Beta conjugate prior (Jeffreys prior Beta(0.5, 0.5)) and normal posterior approximation.
 */
function computeBayesianAutonomyConfidence(
    compositeScore: number,
    effectiveLoc: number,
    totalFiles: number,
    totalScopedCalls: number,
): AutonomyConfidence {
    const locSufficiency = 1.0 - Math.exp(-effectiveLoc / 4000);
    const fileSufficiency = 1.0 - Math.exp(-totalFiles / 8);
    const sampleSufficiency = +(locSufficiency * fileSufficiency).toFixed(3);
    const isLowConfidence = sampleSufficiency < 0.45;

    // Beta conjugate Jeffreys prior: Alpha_0 = 0.5, Beta_0 = 0.5
    const alpha0 = 0.5;
    const beta0 = 0.5;

    const effectiveSampleSize = Math.max(2, Math.round(effectiveLoc / 100 + totalScopedCalls));
    const pObserved = Math.max(0.0, Math.min(1.0, compositeScore / 100));

    const kSuccess = pObserved * effectiveSampleSize;
    const alpha = kSuccess + alpha0;
    const beta = effectiveSampleSize - kSuccess + beta0;
    const posteriorTotal = alpha + beta;

    const posteriorMean = alpha / posteriorTotal;
    const credibleScore = +(posteriorMean * 100).toFixed(2);

    const posteriorVariance =
        (alpha * beta) / (posteriorTotal * posteriorTotal * (posteriorTotal + 1));
    const standardError = Math.sqrt(posteriorVariance);

    const z95 = 1.95996;
    const margin = +(z95 * standardError * 100).toFixed(2);

    const lowerBound = +Math.max(0.0, credibleScore - margin).toFixed(2);
    const upperBound = +Math.min(100.0, credibleScore + margin).toFixed(2);

    return {
        sampleSufficiency,
        lowerBound,
        upperBound,
        credibleScore,
        isLowConfidence,
    };
}

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
    effectiveLoc: 0.3,
    symbolCall: 0.2,
    domainKernel: 0.15,
    codeOriginality: 0.15,
    supplyChainResilience: 0.1,
    criticalPathAutonomy: 0.1,
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
            description:
                'Extremely high autonomy: Core architecture and algorithms are entirely proprietary with minimal external SDK coupling',
        };
    }
    if (score >= 85.0) {
        return {
            grade: 'L4_HIGH_AUTONOMY',
            description:
                'High autonomy: Business logic and domain kernel are fully proprietary, integrating standard open-source ecosystems reasonably',
        };
    }
    if (score >= 70.0) {
        return {
            grade: 'L3_BALANCED',
            description:
                'Balanced autonomy: Core business is proprietary with moderate collaboration with mainstream frameworks and cloud ecosystems',
        };
    }
    if (score >= 50.0) {
        return {
            grade: 'L2_FRAMEWORK_DEPENDENT',
            description:
                'Framework dependent: Substantial business logic is composed as glue code around third-party external SDKs',
        };
    }
    return {
        grade: 'L1_SHALLOW_WRAPPER',
        description:
            'Shallow wrapper: Primarily interface passthrough and third-party implementation references with low proprietary ratio',
    };
}

/**
 * Extract module specifiers from a source file via lightweight line inspection.
 */
function extractImportSpecifiersFromContent(content: string): string[] {
    const specifiers: string[] = [];
    const lines = content.split('\n');
    const IMPORT_RE = /(?:import\s+(?:.*?\s+from\s+)?|require\s*\(\s*|from\s+)(['"][^'"]+['"])/g;

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
function readFirstChunkFallback(absPath: string): string {
    let fd = -1;
    try {
        fd = fs.openSync(absPath, 'r');
        const buf = Buffer.allocUnsafe(1024);
        const bytesRead = fs.readSync(fd, buf, 0, 1024, 0);
        return buf.toString('utf8', 0, bytesRead);
    } catch {
        return '';
    } finally {
        if (fd >= 0) {
            try {
                fs.closeSync(fd);
            } catch {
                // best-effort close
            }
        }
    }
}

function loadFileRawContent(
    metric: FileMetric,
    config: ScanConfig,
    fileContents?: Map<string, string>,
    cache?: Map<string, string>,
): string {
    const raw = fileContents?.get(metric.file) || (metric as { content?: string }).content || '';
    if (raw) return raw;
    if (cache && cache.has(metric.file)) return cache.get(metric.file)!;
    if (config.root) {
        const absPath = path.isAbsolute(metric.file)
            ? metric.file
            : path.join(config.root, metric.file);
        const chunk = readFirstChunkFallback(absPath);
        if (cache) cache.set(metric.file, chunk);
        return chunk;
    }
    return '';
}

function recordSdkCall(
    state: AutonomyScanState,
    pkg: string,
    currentFile: string,
    isCritical: boolean,
): void {
    state.externalSdkCalls++;
    if (isCritical) {
        state.criticalPathExternalCalls++;
    }
    const currentCount = state.sdkCallCounts.get(pkg) || 0;
    state.sdkCallCounts.set(pkg, currentCount + 1);
    let set = state.sdkFileSets.get(pkg);
    if (!set) {
        set = new Set();
        state.sdkFileSets.set(pkg, set);
    }
    set.add(currentFile);
}

function recordSingleSpecifier(
    spec: string,
    currentFile: string,
    manifestDeps: Set<string>,
    state: AutonomyScanState,
    isCritical: boolean,
): void {
    const kind = classifyImportProvenance(spec, currentFile, manifestDeps);
    if (kind === 'internal') {
        state.internalSymbolCalls++;
        if (isCritical) state.criticalPathInternalCalls++;
        return;
    }
    if (kind === 'stdlib') {
        state.stdlibCalls++;
        return;
    }
    if (kind === 'external_sdk') {
        const pkg = spec.startsWith('@')
            ? spec.split('/').slice(0, 2).join('/')
            : spec.split('/')[0].split('.')[0].toLowerCase();
        recordSdkCall(state, pkg, currentFile, isCritical);
    }
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
        recordSingleSpecifier(spec, currentFile, manifestDeps, state, isCritical);
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
    prefetchedContent?: string,
): void {
    const rawContent =
        prefetchedContent !== undefined
            ? prefetchedContent
            : loadFileRawContent(metric, config, fileContents);
    const provenance = classifyFileProvenance(metric.file, rawContent.slice(0, 500));
    const eloc = (metric as any).nonBlankLines || metric.lines || 1;

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
    const totalTreeEloc =
        state.proprietaryEffectiveLoc + state.vendorEffectiveLoc + state.generatedEffectiveLoc;
    const rLoc = totalTreeEloc > 0 ? (state.proprietaryEffectiveLoc / totalTreeEloc) * 100 : 100;

    const totalScopedCalls = state.internalSymbolCalls + state.externalSdkCalls;
    const rCall = totalScopedCalls > 0 ? (state.internalSymbolCalls / totalScopedCalls) * 100 : 100;

    const rDomain =
        state.proprietaryEffectiveLoc > 0
            ? Math.min(100, (state.domainKernelEffectiveLoc / state.proprietaryEffectiveLoc) * 100)
            : 100;

    const cloneIssues = issues.filter(
        (i) => i.rule === 'HYG-CLN-001' || i.rule === 'duplicate-literal',
    );
    const clonePenalty = Math.min(30, cloneIssues.length * 1.5);
    const rPure = Math.max(0, 100 - clonePenalty);

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
    ).toFixed(2);

    const boundedComposite = Math.max(0, Math.min(100, compositeScore));
    const { grade, description } = resolveAutonomyGrade(boundedComposite);

    // Rigorous Bayesian Credible Interval via Jeffreys conjugate prior
    const confidence = computeBayesianAutonomyConfidence(
        boundedComposite,
        state.proprietaryEffectiveLoc,
        totalFiles,
        totalScopedCalls,
    );

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
            effectiveLocAutonomy: +rLoc.toFixed(2),
            symbolCallAutonomy: +rCall.toFixed(2),
            domainKernelDensity: +rDomain.toFixed(2),
            codeOriginality: +rPure.toFixed(2),
            supplyChainResilience: +rSupply.toFixed(2),
            criticalPathAutonomy: +rCritical.toFixed(2),
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

const COMMON_STDLIB_SYMBOLS = new Set([
    'push',
    'pop',
    'shift',
    'unshift',
    'slice',
    'splice',
    'join',
    'map',
    'filter',
    'reduce',
    'find',
    'includes',
    'forEach',
    'indexOf',
    'lastIndexOf',
    'some',
    'every',
    'concat',
    'reverse',
    'sort',
    'keys',
    'values',
    'entries',
    'assign',
    'freeze',
    'seal',
    'create',
    'defineProperty',
    'hasOwnProperty',
    'toString',
    'valueOf',
    'trim',
    'split',
    'replace',
    'replaceAll',
    'toLowerCase',
    'toUpperCase',
    'startsWith',
    'endsWith',
    'substring',
    'charAt',
    'charCodeAt',
    'match',
    'test',
    'exec',
    'now',
    'parse',
    'stringify',
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'trace',
    'floor',
    'ceil',
    'round',
    'abs',
    'min',
    'max',
    'sqrt',
    'pow',
    'random',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'resolve',
    'reject',
    'then',
    'catch',
    'finally',
    'all',
    'race',
    'has',
    'get',
    'set',
    'add',
    'delete',
    'clear',
    'size',
    'length',
    'bind',
    'call',
    'apply',
    'close',
    'open',
    'read',
    'write',
]);

/**
 * Overwrites call metrics with true AST call references from the indexed symbol graph.
 *
 * @param symbolIndex - Materialized project symbol index.
 * @param state - Autonomy evaluation state to update.
 * @param fileToExtPackages - Mapping of file paths to external packages.
 */
function applySymbolIndexReferences(
    symbolIndex: SymbolIndex,
    state: AutonomyScanState,
    fileToExtPackages: Map<string, string[]>,
): void {
    const refs = symbolIndex.getAllReferences();
    if (refs.length === 0) return;

    state.internalSymbolCalls = 0;
    state.externalSdkCalls = 0;
    state.stdlibCalls = 0;
    state.criticalPathInternalCalls = 0;
    state.criticalPathExternalCalls = 0;
    state.sdkCallCounts.clear();
    state.sdkFileSets.clear();

    for (const ref of refs) {
        const isCritical = CRITICAL_PATH_PATTERN.test(ref.file);
        if (symbolIndex.hasDefinition(ref.name)) {
            state.internalSymbolCalls++;
            if (isCritical) state.criticalPathInternalCalls++;
            continue;
        }
        if (COMMON_STDLIB_SYMBOLS.has(ref.name)) {
            state.stdlibCalls++;
            continue;
        }
        const extPkgs = fileToExtPackages.get(ref.file);
        if (extPkgs && extPkgs.length > 0) {
            recordSdkCall(state, extPkgs[0], ref.file, isCritical);
        } else {
            state.stdlibCalls++;
        }
    }
}

/**
 * Evaluates in-house code autonomy ratio (CAI 2.0) across six orthogonal dimensions.
 *
 * @param fileMetrics - Scanned file metrics including lines and paths
 * @param issues - Detected issue collection (used for clone and duplication penalty)
 * @param config - Scan configuration holding project root and options
 * @param fileContents - Optional map of file path to raw content for import extraction
 * @param symbolIndex - Optional indexed project symbol graph for call reference analysis
 * @returns AutonomyEvaluation
 */
export function evaluateProjectAutonomy(
    fileMetrics: FileMetric[],
    issues: Issue[],
    config: ScanConfig,
    fileContents?: Map<string, string>,
    symbolIndex?: SymbolIndex,
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

    const fileToExtPackages = new Map<string, string[]>();
    const contentCache = new Map<string, string>();
    for (const metric of fileMetrics) {
        const raw = loadFileRawContent(metric, config, fileContents, contentCache);
        const specs = raw ? extractImportSpecifiersFromContent(raw) : [];
        const extPkgs: string[] = [];
        for (const spec of specs) {
            const kind = classifyImportProvenance(spec, metric.file, manifestDeps);
            if (kind === 'external_sdk') {
                const pkg = spec.startsWith('@')
                    ? spec.split('/').slice(0, 2).join('/')
                    : spec.split('/')[0].split('.')[0].toLowerCase();
                extPkgs.push(pkg);
            }
        }
        fileToExtPackages.set(metric.file, extPkgs);
        accumulateFileMetric(metric, config, manifestDeps, state, fileContents, raw);
    }

    if (symbolIndex) {
        applySymbolIndexReferences(symbolIndex, state, fileToExtPackages);
    }

    return synthesizeAutonomyEvaluation(state, fileMetrics.length, issues, supplyChain);
}
