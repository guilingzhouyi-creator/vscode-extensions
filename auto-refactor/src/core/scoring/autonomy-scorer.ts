/**
 * Module: Core Engine — Project In-House Autonomy Scorer (CAI 2.0)
 * File Path: src/core/scoring/autonomy-scorer.ts
 * Architecture Role: Evaluates self-development ratio (In-House Autonomy Index) across six
 *   orthogonal dimensions: effective LOC autonomy, symbol call graph autonomy, domain kernel
 *   density, code originality, supply chain resilience, and critical path autonomy.
 * Dependencies & Triggers: Consumes dependency-provenance, file-role-inference, zone-partitioner,
 *   and ScanConfig; invoked by reportBuilder to embed autonomy insights into ScanReport.
 * Responsibilities:
 *   1. Quantify proprietary vs in-tree vendor vs generated effective lines of code;
 *   2. Quantify internal module calls vs external third-party SDK calls;
 *   3. Quantify core algorithm/domain kernel density against glue layers;
 *   4. Quantify code originality by auditing cloned/borrowed token blocks;
 *   5. Quantify supply chain dependency depth and lockfile resilience;
 *   6. Quantify mission-critical security and dispatch path in-house ratio;
 *   7. Compute Jeffreys conjugate Beta(0.5, 0.5) Bayesian credible interval and confidence;
 *   8. Produce composite autonomy index (0~100%), qualitative tier (L1~L5), and SDK inventory.
 * Exit Semantics & Design Rationale: Never throws; deterministic mathematical evaluation with
 *   defensive division-by-zero guards and graceful handling for minimal single-file libraries.
 *   Degradation adaptivity: When symbolIndex is absent, rCall gracefully degrades according to
 *   file-level external SDK import presence instead of falsely defaulting to 100%.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FileMetric, Issue, ScanConfig } from '../types';
import {
    classifyFileProvenance,
    classifyImportProvenance,
    findNearestManifestInventory,
    loadProjectManifestDependencies,
    loadProjectSupplyChainProfile,
    type SupplyChainProfile,
} from '../intelligence/dependency-provenance';
import { inferFineGrainedFileRole } from '../intelligence/file-role-inference';
import type { SymbolIndex } from '../intelligence/symbolIndex';
import { clampScore } from './bounded-corridor';
import { computeExactBetaCredibleInterval } from './bayesian-beta-solver';

const SCALE_LOC_EXPONENT = 4000;
const SCALE_FILE_EXPONENT = 8;
const PRECISION_THREE = 3;
const PRECISION_TWO = 2;
const PERCENT_MAX = 100.0;
const PERCENT_FACTOR = 100;
const MIN_EFFECTIVE_SAMPLE_SIZE = 2;
const CONFIDENCE_LOW_THRESHOLD = 0.45;
const PRIOR_JEFFREYS_ALPHA = 0.5;
const PRIOR_JEFFREYS_BETA = 0.5;
const NORMAL_Z95_CRITICAL_VALUE = 1.95996;

const GRADE_L5_THRESHOLD = 95.0;
const GRADE_L4_THRESHOLD = 85.0;
const GRADE_L3_THRESHOLD = 70.0;
const GRADE_L2_THRESHOLD = 50.0;

const GRADE_L5 = 'L5_INDEPENDENT';
const GRADE_L4 = 'L4_HIGH_AUTONOMY';
const GRADE_L3 = 'L3_BALANCED';
const GRADE_L2 = 'L2_FRAMEWORK_DEPENDENT';
const GRADE_L1 = 'L1_SHALLOW_WRAPPER';

const MAX_AUTONOMY_FILE_READ_BYTES = 524288;
const HEADER_PREVIEW_SLICE_500 = 500;

const KIND_INTERNAL = 'internal';
const KIND_STDLIB = 'stdlib';
const KIND_EXTERNAL_SDK = 'external_sdk';
const PROVENANCE_IN_TREE_VENDOR = 'in_tree_vendor';
const PROVENANCE_GENERATED = 'generated';
const ROLE_ALGORITHM_COMPUTATION = 'algorithm_computation';
const ROLE_CORE_TRUNK = 'core_trunk';
const ROLE_BUSINESS_MODULE = 'business_module';

const MIN_RESILIENCE_SCORE = 15.0;
const MIN_RCALL_SCORE = 10;
const EXTERNAL_PKG_PENALTY_WEIGHT = 15;
const MAX_CLONE_PENALTY = 30;
const CLONE_PENALTY_MULTIPLIER = 1.5;
const RULE_HYG_CLN_001 = 'HYG-CLN-001';
const RULE_DUPLICATE_LITERAL = 'duplicate-literal';
const HASH_PRIME_MULTIPLIER = 31;

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
    const locSufficiency = 1.0 - Math.exp(-effectiveLoc / SCALE_LOC_EXPONENT);
    const fileSufficiency = 1.0 - Math.exp(-totalFiles / SCALE_FILE_EXPONENT);
    const sampleSufficiency = +(locSufficiency * fileSufficiency).toFixed(PRECISION_THREE);
    const isLowConfidence = sampleSufficiency < CONFIDENCE_LOW_THRESHOLD;

    // Beta conjugate Jeffreys prior: Alpha_0 = 0.5, Beta_0 = 0.5
    const alpha0 = PRIOR_JEFFREYS_ALPHA;
    const beta0 = PRIOR_JEFFREYS_BETA;

    const effectiveSampleSize = Math.max(
        MIN_EFFECTIVE_SAMPLE_SIZE,
        Math.round(effectiveLoc / PERCENT_FACTOR + totalScopedCalls),
    );
    const pObserved = Math.max(0.0, Math.min(1.0, compositeScore / PERCENT_FACTOR));

    const kSuccess = pObserved * effectiveSampleSize;
    const alpha = kSuccess + alpha0;
    const beta = effectiveSampleSize - kSuccess + beta0;
    const exactInterval = computeExactBetaCredibleInterval(alpha, beta);

    return {
        sampleSufficiency,
        lowerBound: exactInterval.lowerBound,
        upperBound: exactInterval.upperBound,
        credibleScore: exactInterval.credibleScore,
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
    if (score >= GRADE_L5_THRESHOLD) {
        return {
            grade: GRADE_L5,
            description:
                'Extremely high autonomy: Core architecture and algorithms are entirely proprietary with minimal external SDK coupling',
        };
    }
    if (score >= GRADE_L4_THRESHOLD) {
        return {
            grade: GRADE_L4,
            description:
                'High autonomy: Business logic and domain kernel are fully proprietary, integrating standard open-source ecosystems reasonably',
        };
    }
    if (score >= GRADE_L3_THRESHOLD) {
        return {
            grade: GRADE_L3,
            description:
                'Balanced autonomy: Core business is proprietary with moderate collaboration with mainstream frameworks and cloud ecosystems',
        };
    }
    if (score >= GRADE_L2_THRESHOLD) {
        return {
            grade: GRADE_L2,
            description:
                'Framework dependent: Substantial business logic is composed as glue code around third-party external SDKs',
        };
    }
    return {
        grade: GRADE_L1,
        description:
            'Shallow wrapper: Primarily interface passthrough and third-party implementation references with low proprietary ratio',
    };
}

/** File import profile containing extracted specifiers and local symbol bindings */
export interface FileImportProfile {
    specifiers: string[];
    /** Locally bound identifier name -> canonical external package name */
    symbolToPackageMap: Map<string, string>;
}

function extractModulePackageName(specifier: string): string {
    const trimmed = specifier.trim().replace(/^['"]|['"]$/g, '');
    if (trimmed.startsWith('@')) {
        const parts = trimmed.split('/');
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    }
    return trimmed.split('/')[0].split('.')[0].toLowerCase();
}

function parseImportClause(clause: string, pkg: string, symbolToPkg: Map<string, string>): void {
    if (!clause) return;
    const nsMatch = /\*\s+as\s+([A-Za-z0-9_$]+)/.exec(clause);
    if (nsMatch) {
        symbolToPkg.set(nsMatch[1], pkg);
        return;
    }
    const namedMatch = /\{([\s\S]*?)\}/.exec(clause);
    if (namedMatch) {
        const items = namedMatch[1].split(',');
        for (const item of items) {
            const parts = item.trim().split(/\s+as\s+/);
            const local = (parts[1] || parts[0] || '').trim();
            if (local) symbolToPkg.set(local, pkg);
        }
    }
    const defaultPart = clause
        .replace(/\{[\s\S]*?\}/, '')
        .replace(/,/g, '')
        .trim();
    if (defaultPart && !defaultPart.startsWith('*')) {
        symbolToPkg.set(defaultPart, pkg);
    }
}

const KEYWORD_IMPORT = 'import';
const KEYWORD_REQUIRE = 'require';
const KEYWORD_EXPORT = 'export';

function hasTsJsImportKeyword(line: string): boolean {
    return (
        line.includes(KEYWORD_IMPORT) ||
        line.includes(KEYWORD_REQUIRE) ||
        line.includes(KEYWORD_EXPORT)
    );
}

function extractTsJsImportLine(
    trimmed: string,
    specifiers: Set<string>,
    symbolToPkg: Map<string, string>,
): void {
    const importFromMatch = /import\s+(?:type\s+)?(.*?)\s+from\s+['"]([^'"]+)['"]/.exec(trimmed);
    if (importFromMatch) {
        const spec = importFromMatch[2].trim();
        specifiers.add(spec);
        const pkg = extractModulePackageName(spec);
        parseImportClause(importFromMatch[1].trim(), pkg, symbolToPkg);
        return;
    }
    const requireMatch = /(?:const|let|var)\s+(.*?)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/.exec(
        trimmed,
    );
    if (requireMatch) {
        const spec = requireMatch[2].trim();
        specifiers.add(spec);
        const pkg = extractModulePackageName(spec);
        parseImportClause(requireMatch[1].trim(), pkg, symbolToPkg);
        return;
    }
    const sideEffectMatch = /import\s*\(?\s*['"]([^'"]+)['"]\s*\)?/.exec(trimmed);
    if (sideEffectMatch) {
        specifiers.add(sideEffectMatch[1].trim());
        return;
    }
    const exportFromMatch = /export\s+.*?\s+from\s+['"]([^'"]+)['"]/.exec(trimmed);
    if (exportFromMatch) {
        specifiers.add(exportFromMatch[1].trim());
    }
}

function extractTsJsImportProfile(
    content: string,
    specifiers: Set<string>,
    symbolToPkg: Map<string, string>,
): void {
    const lines = content.split('\n');
    for (const line of lines) {
        if (!hasTsJsImportKeyword(line)) continue;
        const trimmed = line.trim();
        if (
            !trimmed ||
            trimmed.startsWith('//') ||
            trimmed.startsWith('/*') ||
            trimmed.startsWith('*')
        ) {
            continue;
        }
        extractTsJsImportLine(trimmed, specifiers, symbolToPkg);
    }
}

function parsePythonFromClause(
    spec: string,
    rawItems: string,
    specifiers: Set<string>,
    symbolToPkg: Map<string, string>,
): void {
    specifiers.add(spec);
    const pkg = spec.split('.')[0].toLowerCase();
    const items = rawItems.split(',');
    for (const it of items) {
        const parts = it.trim().split(/\s+as\s+/);
        const local = (parts[1] || parts[0] || '').trim();
        if (local) symbolToPkg.set(local, pkg);
    }
}

function parsePythonImportClause(
    rawItems: string,
    specifiers: Set<string>,
    symbolToPkg: Map<string, string>,
): void {
    const items = rawItems.split(',');
    for (const it of items) {
        const parts = it.trim().split(/\s+as\s+/);
        const mod = parts[0].trim();
        const local = (parts[1] || parts[0] || '').trim();
        if (!mod) continue;
        specifiers.add(mod);
        const pkg = mod.split('.')[0].toLowerCase();
        if (local) symbolToPkg.set(local, pkg);
    }
}

function extractPythonImportProfile(
    content: string,
    specifiers: Set<string>,
    symbolToPkg: Map<string, string>,
): void {
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const fromMatch = /^from\s+([A-Za-z0-9_.]+)\s+import\s+(.*)/.exec(trimmed);
        if (fromMatch) {
            parsePythonFromClause(fromMatch[1].trim(), fromMatch[2], specifiers, symbolToPkg);
            continue;
        }
        const importMatch = /^import\s+(.*)/.exec(trimmed);
        if (importMatch) {
            parsePythonImportClause(importMatch[1], specifiers, symbolToPkg);
        }
    }
}

function extractGoImportProfile(content: string, specifiers: Set<string>): void {
    const lines = content.split('\n');
    let inBlock = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;
        if (trimmed.startsWith('import (')) {
            inBlock = true;
            continue;
        }
        if (inBlock && trimmed === ')') {
            inBlock = false;
            continue;
        }
        if (inBlock) {
            const match = /["']([^'"]+)["']/.exec(trimmed);
            if (match) specifiers.add(match[1]);
            continue;
        }
        const singleMatch = /^import\s+(?:[A-Za-z0-9_.]+\s+)?["']([^'"]+)["']/.exec(trimmed);
        if (singleMatch) specifiers.add(singleMatch[1]);
    }
}

function extractRustImportProfile(content: string, specifiers: Set<string>): void {
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;
        const useMatch = /^\s*(?:pub\s+)?use\s+([A-Za-z0-9_]+)::/.exec(trimmed);
        if (useMatch) specifiers.add(useMatch[1]);
    }
}

function extractGdScriptImportProfile(content: string, specifiers: Set<string>): void {
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = /(?:preload|load)\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(trimmed);
        if (match) specifiers.add(match[1]);
    }
}

/**
 * Extracts import specifiers and local symbol-to-package bindings across supported languages.
 *
 * @param content - Full source text of the file
 * @param filePath - Path of the target file for extension inference
 * @returns FileImportProfile containing discovered specifiers and symbol mappings
 */
export function extractFileImportProfile(content: string, filePath: string): FileImportProfile {
    const specifiers = new Set<string>();
    const symbolToPackageMap = new Map<string, string>();
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.py') {
        extractPythonImportProfile(content, specifiers, symbolToPackageMap);
    } else if (ext === '.go') {
        extractGoImportProfile(content, specifiers);
    } else if (ext === '.rs') {
        extractRustImportProfile(content, specifiers);
    } else if (ext === '.gd') {
        extractGdScriptImportProfile(content, specifiers);
    } else {
        extractTsJsImportProfile(content, specifiers, symbolToPackageMap);
    }

    return {
        specifiers: Array.from(specifiers),
        symbolToPackageMap,
    };
}

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
    currentSpecifiers?: string[];
}

/**
 * Load raw source content from memory map or disk file without early 1KB truncation.
 */
function readSourceFileContent(absPath: string): string {
    try {
        const stat = fs.statSync(absPath);
        const readLength = Math.min(stat.size, MAX_AUTONOMY_FILE_READ_BYTES);
        if (readLength <= 0) return '';
        const fd = fs.openSync(absPath, 'r');
        try {
            const buf = Buffer.allocUnsafe(readLength);
            const bytesRead = fs.readSync(fd, buf, 0, readLength, 0);
            return buf.toString('utf8', 0, bytesRead);
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return '';
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
        const chunk = readSourceFileContent(absPath);
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

/**
 * Attribution context for resolving single or multiple import specifiers.
 */
export interface ImportAttributionContext {
    readonly currentFile: string;
    readonly manifestDeps: Set<string>;
    readonly state: AutonomyScanState;
    readonly isCritical: boolean;
}

function recordSingleSpecifier(spec: string, ctx: ImportAttributionContext): void {
    const kind = classifyImportProvenance(spec, ctx.currentFile, ctx.manifestDeps);
    if (kind === KIND_INTERNAL) {
        ctx.state.internalSymbolCalls++;
        if (ctx.isCritical) ctx.state.criticalPathInternalCalls++;
        return;
    }
    if (kind === KIND_STDLIB) {
        ctx.state.stdlibCalls++;
        return;
    }
    if (kind === KIND_EXTERNAL_SDK) {
        const pkg = spec.startsWith('@')
            ? spec.split('/').slice(0, 2).join('/')
            : spec.split('/')[0].split('.')[0].toLowerCase();
        recordSdkCall(ctx.state, pkg, ctx.currentFile, ctx.isCritical);
    }
}

/**
 * Process import specifiers and attribute call weights.
 */
function processImportSpecifiers(specifiers: string[], ctx: ImportAttributionContext): void {
    for (const spec of specifiers) {
        recordSingleSpecifier(spec, ctx);
    }
}

/**
 * Accumulate provenance and complexity metrics for a single file.
 */
function accumulateFileMetric(
    metric: FileMetric,
    manifestDeps: Set<string>,
    state: AutonomyScanState,
    rawContent: string,
): void {
    const headerSlice = rawContent.slice(0, HEADER_PREVIEW_SLICE_500);
    const provenance = classifyFileProvenance(metric.file, headerSlice);
    const eloc = (metric as { nonBlankLines?: number }).nonBlankLines || metric.lines || 1;

    if (provenance === PROVENANCE_IN_TREE_VENDOR) {
        state.vendorFiles++;
        state.vendorEffectiveLoc += eloc;
        return;
    }
    if (provenance === PROVENANCE_GENERATED) {
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

    const roleResult = inferFineGrainedFileRole(metric.file, headerSlice);
    if (
        roleResult.role === ROLE_ALGORITHM_COMPUTATION ||
        roleResult.role === ROLE_CORE_TRUNK ||
        roleResult.role === ROLE_BUSINESS_MODULE
    ) {
        state.domainKernelEffectiveLoc += eloc;
    }

    const specifiers = state.currentSpecifiers;
    if (specifiers && specifiers.length > 0) {
        processImportSpecifiers(specifiers, {
            currentFile: metric.file,
            manifestDeps,
            state,
            isCritical,
        });
    }
}

/**
 * Quantifies supply chain resilience against external transitive dependency explosion.
 */
function calculateSupplyChainResilience(supplyChain: SupplyChainProfile): number {
    if (supplyChain.directDependencyCount === 0 && supplyChain.totalLockfilePackages === 0) {
        return PERCENT_MAX;
    }
    const d = supplyChain.directDependencyCount;
    const t = supplyChain.transitiveDependencyCount;
    const depth = supplyChain.estimatedDepth;

    const penalty = d * 0.5 + Math.sqrt(t) * 0.8 + Math.max(0, depth - 1) * 2.0;
    const resilience = Math.max(MIN_RESILIENCE_SCORE, Math.min(PERCENT_MAX, PERCENT_MAX - penalty));
    return clampScore(resilience);
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
    const rLoc =
        totalTreeEloc > 0
            ? (state.proprietaryEffectiveLoc / totalTreeEloc) * PERCENT_FACTOR
            : PERCENT_FACTOR;

    const totalScopedCalls = state.internalSymbolCalls + state.externalSdkCalls;
    let rCall: number;
    if (totalScopedCalls > 0) {
        rCall = (state.internalSymbolCalls / totalScopedCalls) * PERCENT_FACTOR;
    } else if (state.sdkCallCounts.size > 0 || state.externalSdkCalls > 0) {
        const externalPkgs = Math.max(1, state.sdkCallCounts.size);
        rCall = Math.max(
            MIN_RCALL_SCORE,
            PERCENT_FACTOR - externalPkgs * EXTERNAL_PKG_PENALTY_WEIGHT,
        );
    } else {
        rCall = PERCENT_FACTOR;
    }

    const rDomain =
        state.proprietaryEffectiveLoc > 0
            ? Math.min(
                  PERCENT_FACTOR,
                  (state.domainKernelEffectiveLoc / state.proprietaryEffectiveLoc) * PERCENT_FACTOR,
              )
            : PERCENT_FACTOR;

    const cloneIssues = issues.filter(
        (i) => i.rule === RULE_HYG_CLN_001 || i.rule === RULE_DUPLICATE_LITERAL,
    );
    const clonePenalty = Math.min(MAX_CLONE_PENALTY, cloneIssues.length * CLONE_PENALTY_MULTIPLIER);
    const rPure = Math.max(0, PERCENT_FACTOR - clonePenalty);

    const rSupply = calculateSupplyChainResilience(supplyChain);

    const totalCriticalCalls = state.criticalPathInternalCalls + state.criticalPathExternalCalls;
    let rCritical: number;
    if (state.criticalPathFiles > 0 && totalCriticalCalls > 0) {
        rCritical = (state.criticalPathInternalCalls / totalCriticalCalls) * PERCENT_FACTOR;
    } else if (state.criticalPathFiles > 0) {
        rCritical = state.externalSdkCalls === 0 ? PERCENT_MAX : rCall;
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

const COMMON_STDLIB_SYMBOLS: ReadonlySet<string> = new Set(
    (
        'push pop shift unshift slice splice join map filter reduce find includes forEach indexOf ' +
        'lastIndexOf some every concat reverse sort keys values entries assign freeze seal create ' +
        'defineProperty hasOwnProperty toString valueOf trim split replace replaceAll toLowerCase ' +
        'toUpperCase startsWith endsWith substring charAt charCodeAt match test exec now parse ' +
        'stringify log info warn error debug trace floor ceil round abs min max sqrt pow random ' +
        'setTimeout clearTimeout setInterval clearInterval resolve reject then catch finally all race ' +
        'has get set add delete clear size length bind call apply close open read write'
    ).split(' '),
);

function selectBalancedSdk(extPkgs: string[], symbolName: string): string {
    if (extPkgs.length === 1) return extPkgs[0];
    let hash = 0;
    for (let i = 0; i < symbolName.length; i++) {
        hash = (hash * HASH_PRIME_MULTIPLIER + symbolName.charCodeAt(i)) >>> 0;
    }
    return extPkgs[hash % extPkgs.length];
}

/**
 * Overwrites call metrics with true AST call references from the indexed symbol graph
 * and local file import binding profiles.
 *
 * @param symbolIndex - Materialized project symbol index.
 * @param state - Autonomy evaluation state to update.
 * @param fileToExtPackages - Mapping of file paths to external package lists.
 * @param fileToImportProfiles - Optional mapping of file paths to local symbol binding profiles.
 */
function applySymbolIndexReferences(
    symbolIndex: SymbolIndex,
    state: AutonomyScanState,
    fileToExtPackages: Map<string, string[]>,
    fileToImportProfiles?: Map<string, FileImportProfile>,
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

    const criticalByFile = new Map<string, boolean>();
    for (const ref of refs) {
        let isCritical = criticalByFile.get(ref.file);
        if (isCritical === undefined) {
            isCritical = CRITICAL_PATH_PATTERN.test(ref.file);
            criticalByFile.set(ref.file, isCritical);
        }
        if (symbolIndex.hasDefinition(ref.name)) {
            state.internalSymbolCalls++;
            if (isCritical) state.criticalPathInternalCalls++;
            continue;
        }

        const profile = fileToImportProfiles?.get(ref.file);
        const boundPkg = profile?.symbolToPackageMap.get(ref.name);
        if (boundPkg) {
            recordSdkCall(state, boundPkg, ref.file, isCritical);
            continue;
        }

        if (COMMON_STDLIB_SYMBOLS.has(ref.name)) {
            state.stdlibCalls++;
            continue;
        }

        const extPkgs = fileToExtPackages.get(ref.file);
        if (extPkgs && extPkgs.length > 0) {
            const chosen = selectBalancedSdk(extPkgs, ref.name);
            recordSdkCall(state, chosen, ref.file, isCritical);
        } else {
            state.stdlibCalls++;
        }
    }
}

function appendExtPackage(pkgs: string[] | undefined, spec: string): string[] {
    const pkg = extractModulePackageName(spec);
    if (pkgs !== undefined) {
        pkgs.push(pkg);
        return pkgs;
    }
    return [pkg];
}

function collectExtPackages(
    specifiers: Iterable<string>,
    file: string,
    manifestDeps: Set<string>,
): string[] | undefined {
    let pkgs: string[] | undefined;
    for (const spec of specifiers) {
        if (classifyImportProvenance(spec, file, manifestDeps) === KIND_EXTERNAL_SDK) {
            pkgs = appendExtPackage(pkgs, spec);
        }
    }
    return pkgs;
}

/** Context bundle for project autonomy evaluation. */
export interface AutonomyEvaluationContext {
    readonly fileMetrics: FileMetric[];
    readonly issues: Issue[];
    readonly config: ScanConfig;
    readonly fileContents?: Map<string, string>;
    readonly symbolIndex?: SymbolIndex;
}

function normalizeAutonomyContext(
    metricsOrContext: FileMetric[] | AutonomyEvaluationContext,
    rawIssues?: Issue[],
    rawConfig?: ScanConfig,
    rawFileContents?: Map<string, string>,
    rawSymbolIndex?: SymbolIndex,
): AutonomyEvaluationContext {
    if (!Array.isArray(metricsOrContext)) {
        return metricsOrContext;
    }
    return {
        fileMetrics: metricsOrContext,
        issues: rawIssues ?? [],
        config: rawConfig ?? ({ root: process.cwd() } as unknown as ScanConfig),
        fileContents: rawFileContents,
        symbolIndex: rawSymbolIndex,
    };
}

/**
 * Evaluates in-house code autonomy ratio (CAI 2.0) across six orthogonal dimensions.
 *
 * @param context - Bundled options and inputs for autonomy evaluation.
 * @returns AutonomyEvaluation
 */
export function evaluateProjectAutonomy(context: AutonomyEvaluationContext): AutonomyEvaluation;
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
): AutonomyEvaluation;
export function evaluateProjectAutonomy(
    metricsOrContext: FileMetric[] | AutonomyEvaluationContext,
    rawIssues?: Issue[],
    rawConfig?: ScanConfig,
    rawFileContents?: Map<string, string>,
    rawSymbolIndex?: SymbolIndex,
): AutonomyEvaluation {
    const ctx = normalizeAutonomyContext(
        metricsOrContext,
        rawIssues,
        rawConfig,
        rawFileContents,
        rawSymbolIndex,
    );
    const { fileMetrics, issues, config, fileContents, symbolIndex } = ctx;

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
    const fileToImportProfiles = new Map<string, FileImportProfile>();
    const contentCache = new Map<string, string>();
    const emptyProfile: FileImportProfile = {
        specifiers: [],
        symbolToPackageMap: new Map<string, string>(),
    };

    for (const metric of fileMetrics) {
        const raw = loadFileRawContent(metric, config, fileContents, contentCache);
        const profile = raw ? extractFileImportProfile(raw, metric.file) : emptyProfile;
        fileToImportProfiles.set(metric.file, profile);

        const fileInv = findNearestManifestInventory(metric.file, rootDir);
        const effectiveDeps =
            fileInv.allDependencies.size > 0 ? fileInv.allDependencies : manifestDeps;

        const extPkgs = collectExtPackages(profile.specifiers, metric.file, effectiveDeps);
        if (extPkgs) {
            fileToExtPackages.set(metric.file, extPkgs);
        }
        state.currentSpecifiers = profile.specifiers;
        accumulateFileMetric(metric, effectiveDeps, state, raw);
    }

    if (symbolIndex) {
        applySymbolIndexReferences(symbolIndex, state, fileToExtPackages, fileToImportProfiles);
    }

    return synthesizeAutonomyEvaluation(state, fileMetrics.length, issues, supplyChain);
}
