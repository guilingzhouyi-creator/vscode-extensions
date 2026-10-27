/**
 * Module: Core Preflight — Sparse Analyzer & Rule Activation Engine
 * File Path: src/core/preflight/sparse-activator.ts
 * Architecture Role: Computes dynamic affinity score `A(r,f)` via indicator weighted sum
 *   to prune unnecessary analyzers and rules prior to execution.
 * Dependencies & Triggers: Consumes audit-index and scope-decision; called by preflight
 *   controller and scanner schedulers.
 * Responsibilities:
 *   1. Calculate affinity scores between analyzers and candidate files.
 *   2. Enforce strict language compatibility boundaries (zero cross-language misactivation).
 *   3. Filter analyzers by dynamic activation threshold (default 0.35).
 *   4. Output structured SparseActivationResult with explainable summary.
 * Exit Semantics & Design Rationale: Never throws; deterministic; returns frozen structures.
 */

import type { AuditIndexEntry, LanguageKind } from './audit-index';
import type { AuditScopeDecision } from './scope-decision';

/** Dynamic activation affinity score weights */
export interface ActivationWeights {
    readonly changeIndicator: number; // weight: change indicator (default 0.35)
    readonly fileRisk: number; // weight: file risk (default 0.20)
    readonly dependencyProximity: number; // weight: dependency proximity (default 0.20)
    readonly historyFindings: number; // weight: history findings (default 0.15)
    readonly scopeAffinity: number; // weight: scope affinity (default 0.10)
}

/** Default canonical activation weights (sum = 1.0) */
export const DEFAULT_ACTIVATION_WEIGHTS: ActivationWeights = Object.freeze({
    changeIndicator: 0.35,
    fileRisk: 0.2,
    dependencyProximity: 0.2,
    historyFindings: 0.15,
    scopeAffinity: 0.1,
});

/** Default activation threshold */
export const DEFAULT_ACTIVATION_THRESHOLD = 0.35;

/** Output contract for sparse activation */
export interface SparseActivationResult {
    readonly selectedFiles: readonly string[];
    readonly activatedAnalyzers: readonly string[];
    readonly skippedAnalyzers: readonly string[];
    readonly skippedFiles: readonly string[];
    readonly activationRatio: number;
    readonly summaryText: string;
    readonly fileAnalyzerMap: Readonly<Record<string, readonly string[]>>;
    readonly rationaleMap: Readonly<Record<string, string>>;
}

/** Mapping of language-specific analyzers to supported languages */
const LANGUAGE_ANALYZER_MATRIX: Record<string, readonly LanguageKind[]> = {
    'typescript-modern': ['typescript', 'javascript'],
    'ts-modern': ['typescript', 'javascript'],
    'python-modern': ['python'],
    'rust-modern': ['rust'],
    'gdscript-modern': ['gdscript'],
    'gdscript-game': ['gdscript'],
    'go-modern': ['go'],
    'shell-lint': ['shell'],
    'vscode-extension': ['typescript', 'javascript', 'json'],
};

const SCORE_SCALE_THOUSAND = 1000;
const PERCENT_SCALE_HUNDRED = 100;
const MAX_HISTORICAL_FINDINGS_CAP = 5;

/** Checks if an analyzer is compatible with a file language */
function isLanguageCompatible(analyzerId: string, lang: LanguageKind): boolean {
    const supported = LANGUAGE_ANALYZER_MATRIX[analyzerId];
    return !supported ? true : supported.includes(lang);
}

/** Calculate change indicator weight */
function resolveChangeIndicator(isDirectlyChanged: boolean, isNeighbor: boolean): number {
    if (isDirectlyChanged) return 1.0;
    return isNeighbor ? 0.5 : 0.0;
}

/** Calculate dependency proximity weight */
function resolveDependencyProximity(isDirectlyChanged: boolean, fanIn: number): number {
    if (isDirectlyChanged) return 1.0;
    return fanIn > 0 ? 0.6 : 0.2;
}

/** Check if analyzer/role matches active audit domain */
function matchesDomainScope(analyzerId: string, role: string, domain: string): boolean {
    if (domain === 'gates') {
        return (
            analyzerId === 'gate-architecture' ||
            analyzerId === 'shell-lint' ||
            role === 'gate_infrastructure'
        );
    }
    return analyzerId.includes(domain) || role.includes(domain);
}

/** Calculate scope affinity factor */
function resolveScopeAffinity(
    analyzerId: string,
    fileEntry: AuditIndexEntry,
    isDirectlyChanged: boolean,
    scopeDecision: AuditScopeDecision,
): number {
    if (scopeDecision.mode === 'PROJECT') {
        return 0.9;
    }
    if (scopeDecision.mode === 'DOMAIN' && scopeDecision.domain) {
        const dom = scopeDecision.domain.toLowerCase();
        return matchesDomainScope(analyzerId, fileEntry.role, dom) ? 1.0 : 0.1;
    }
    if (fileEntry.role === 'gate_infrastructure' && analyzerId === 'gate-architecture') {
        return 1.0;
    }
    return isDirectlyChanged ? 0.8 : 0.5;
}

/** Parameter object for single analyzer-file affinity score calculation */
interface AffinityEvaluationParams {
    readonly analyzerId: string;
    readonly fileEntry: AuditIndexEntry;
    readonly isDirectlyChanged: boolean;
    readonly isNeighbor: boolean;
    readonly scopeDecision: AuditScopeDecision;
    readonly weights: ActivationWeights;
}

/** Computes single analyzer-file affinity score A(r, f) */
function computeAffinityScore(params: AffinityEvaluationParams): number {
    const { analyzerId, fileEntry, isDirectlyChanged, isNeighbor, scopeDecision, weights } = params;

    // Hard boundary: language incompatibility strictly forces zero affinity
    if (!isLanguageCompatible(analyzerId, fileEntry.lang)) {
        return 0.0;
    }

    // Gate analyzer specificity: never audit pure application business files in changeset mode
    if (
        analyzerId === 'gate-architecture' &&
        scopeDecision.mode === 'CHANGESET' &&
        fileEntry.role !== 'gate_infrastructure'
    ) {
        return 0.0;
    }

    const iChange = resolveChangeIndicator(isDirectlyChanged, isNeighbor);
    const rRisk = fileEntry.risk.inherentRisk;
    const dDep = resolveDependencyProximity(isDirectlyChanged, fileEntry.deps.fanIn);
    const hHist = Math.min(1.0, fileEntry.history.recentFindingCount / MAX_HISTORICAL_FINDINGS_CAP);
    const sScope = resolveScopeAffinity(analyzerId, fileEntry, isDirectlyChanged, scopeDecision);

    let deltaTerm = 0.0;
    if (
        (analyzerId === 'comments' || analyzerId === 'docs') &&
        isDirectlyChanged &&
        fileEntry.risk.isTerminologySensitive
    ) {
        deltaTerm = 0.25;
    } else if (
        (analyzerId === 'governance' || analyzerId === 'naming') &&
        fileEntry.risk.isTerminologySensitive
    ) {
        deltaTerm = 0.15;
    }

    const rawScore =
        weights.changeIndicator * iChange +
        weights.fileRisk * rRisk +
        weights.dependencyProximity * dDep +
        weights.historyFindings * hHist +
        weights.scopeAffinity * sScope +
        deltaTerm;

    return Math.round(rawScore * SCORE_SCALE_THOUSAND) / SCORE_SCALE_THOUSAND;
}

/**
 * Appends matched analyzer identifier to the accumulated array.
 *
 * @param matched - Existing array of matched analyzer IDs, if any.
 * @param aId - Analyzer ID to append.
 * @returns Array with appended analyzer identifier.
 */
function appendMatchedAnalyzer(matched: string[] | undefined, aId: string): string[] {
    if (matched !== undefined) {
        matched.push(aId);
        return matched;
    }
    return [aId];
}

/** Parameter object for file-analyzer matching execution */
interface FileMatchingParams {
    readonly entry: AuditIndexEntry;
    readonly availableAnalyzers: readonly string[];
    readonly isChanged: boolean;
    readonly isNeighbor: boolean;
    readonly scopeDecision: AuditScopeDecision;
    readonly threshold: number;
    readonly weights: ActivationWeights;
    readonly activatedSet: Set<string>;
    readonly rationaleMap: Record<string, string>;
}

function matchFileAnalyzers(params: FileMatchingParams): string[] | undefined {
    let matched: string[] | undefined;
    for (const aId of params.availableAnalyzers) {
        const score = computeAffinityScore({
            analyzerId: aId,
            fileEntry: params.entry,
            isDirectlyChanged: params.isChanged,
            isNeighbor: params.isNeighbor,
            scopeDecision: params.scopeDecision,
            weights: params.weights,
        });
        if (score >= params.threshold) {
            matched = appendMatchedAnalyzer(matched, aId);
            params.activatedSet.add(aId);
            if (!params.rationaleMap[aId]) {
                params.rationaleMap[aId] =
                    `Activated with affinity ${score} on ${params.entry.role} (${params.entry.lang})`;
            }
        }
    }
    return matched;
}

/** Parameters object contract for sparse activation */
export interface SparseActivationParams {
    readonly availableAnalyzers: readonly string[];
    readonly fileEntries: readonly AuditIndexEntry[];
    readonly scopeDecision: AuditScopeDecision;
    readonly changedFiles: ReadonlySet<string>;
    readonly neighborFiles?: ReadonlySet<string>;
    readonly threshold?: number;
    readonly weights?: ActivationWeights;
}

/**
 * Computes sparse analyzer activation mapping across indexed files based on scope decisions,
 * change sets, and domain affinity weights.
 */
function resolveActivationParameters(
    paramsOrAnalyzers: SparseActivationParams | readonly string[],
    legacyArgs: readonly unknown[],
): Required<SparseActivationParams> {
    if (!Array.isArray(paramsOrAnalyzers)) {
        const optionsConfig = paramsOrAnalyzers as SparseActivationParams;
        return {
            availableAnalyzers: optionsConfig.availableAnalyzers,
            fileEntries: optionsConfig.fileEntries,
            scopeDecision: optionsConfig.scopeDecision,
            changedFiles: optionsConfig.changedFiles,
            neighborFiles: optionsConfig.neighborFiles ?? new Set<string>(),
            threshold: optionsConfig.threshold ?? DEFAULT_ACTIVATION_THRESHOLD,
            weights: optionsConfig.weights ?? DEFAULT_ACTIVATION_WEIGHTS,
        };
    }
    return {
        availableAnalyzers: paramsOrAnalyzers,
        fileEntries: (legacyArgs[0] as readonly AuditIndexEntry[]) ?? [],
        scopeDecision: legacyArgs[1] as AuditScopeDecision,
        changedFiles: (legacyArgs[2] as ReadonlySet<string>) ?? new Set<string>(),
        neighborFiles: (legacyArgs[3] as ReadonlySet<string>) ?? new Set<string>(),
        threshold: (legacyArgs[4] as number) ?? DEFAULT_ACTIVATION_THRESHOLD,
        weights: (legacyArgs[5] as ActivationWeights) ?? DEFAULT_ACTIVATION_WEIGHTS,
    };
}

/**
 * Computes sparse analyzer activation mapping across indexed files based on scope decisions,
 * change sets, and domain affinity weights.
 *
 * Both call shapes reach the same resolution step: the current one passes a single parameters
 * object, while the legacy positional form supplies the same values as trailing arguments.
 *
 * @param paramsOrAnalyzers - Parameters object, or the analyzer id list in the legacy call shape.
 * @param legacyArgs - Legacy positional tail: file entries, scope decision, changed files,
 *   neighbour files, threshold, and weights, in that order.
 * @returns Frozen selection result with per-file analyzer mapping and a rationale per activation.
 */
export function activateSparseAnalyzers(
    paramsOrAnalyzers: SparseActivationParams | readonly string[],
    ...legacyArgs: unknown[]
): SparseActivationResult {
    const config = resolveActivationParameters(paramsOrAnalyzers, legacyArgs);
    const fileAnalyzerMap: Record<string, string[]> = {};
    const activatedSet = new Set<string>();
    const rationaleMap: Record<string, string> = {};

    for (const entry of config.fileEntries) {
        const fPath = entry.filePath;
        const matchedAnalyzers = matchFileAnalyzers({
            entry,
            availableAnalyzers: config.availableAnalyzers,
            isChanged: config.changedFiles.has(fPath),
            isNeighbor: config.neighborFiles.has(fPath),
            scopeDecision: config.scopeDecision,
            threshold: config.threshold,
            weights: config.weights,
            activatedSet,
            rationaleMap,
        });
        if (matchedAnalyzers) {
            fileAnalyzerMap[fPath] = matchedAnalyzers;
        }
    }

    const activatedAnalyzers = config.availableAnalyzers.filter((analyzerId) =>
        activatedSet.has(analyzerId),
    );
    const skippedAnalyzers = config.availableAnalyzers.filter(
        (analyzerId) => !activatedSet.has(analyzerId),
    );
    const selectedFiles = config.fileEntries
        .map((entry) => entry.filePath)
        .filter((filePath) => (fileAnalyzerMap[filePath]?.length || 0) > 0);
    const skippedFiles = config.fileEntries
        .map((entry) => entry.filePath)
        .filter((filePath) => !selectedFiles.includes(filePath));

    const totalAvail = config.availableAnalyzers.length;
    const activationRatio =
        totalAvail > 0
            ? Math.round((activatedAnalyzers.length / totalAvail) * SCORE_SCALE_THOUSAND) /
              SCORE_SCALE_THOUSAND
            : 0;

    const summaryText =
        `Files Selected: ${selectedFiles.length} / Analyzers Activated: ${activatedAnalyzers.length} ` +
        `(${Math.round(activationRatio * PERCENT_SCALE_HUNDRED)}%) / Analyzers Skipped: ${skippedAnalyzers.length} / ` +
        `Files Skipped: ${skippedFiles.length} / Reason: ${config.scopeDecision.reason}`;

    return Object.freeze({
        selectedFiles: Object.freeze(selectedFiles),
        activatedAnalyzers: Object.freeze(activatedAnalyzers),
        skippedAnalyzers: Object.freeze(skippedAnalyzers),
        skippedFiles: Object.freeze(skippedFiles),
        activationRatio,
        summaryText,
        fileAnalyzerMap: Object.freeze(fileAnalyzerMap),
        rationaleMap: Object.freeze(rationaleMap),
    });
}
