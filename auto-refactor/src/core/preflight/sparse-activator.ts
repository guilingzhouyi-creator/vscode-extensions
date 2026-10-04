/**
 * Module: Core Preflight — Sparse Analyzer & Rule Activation Engine
 * File Path: src/core/preflight/sparse-activator.ts
 * Architecture Role: Computes dynamic affinity score A(r,f) = w1*I + w2*R + w3*D + w4*H + w5*S
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
    readonly changeIndicator: number; // w1 (default 0.35)
    readonly fileRisk: number; // w2 (default 0.20)
    readonly dependencyProximity: number; // w3 (default 0.20)
    readonly historyFindings: number; // w4 (default 0.15)
    readonly scopeAffinity: number; // w5 (default 0.10)
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

/** Checks if an analyzer is compatible with a file language */
function isLanguageCompatible(analyzerId: string, lang: LanguageKind): boolean {
    const supported = LANGUAGE_ANALYZER_MATRIX[analyzerId];
    if (!supported) {
        // General language-agnostic or broad analyzer
        // (e.g. hygiene, secrets, architecture, complexity)
        return true;
    }
    return supported.includes(lang);
}

/** Calculate change indicator weight */
function resolveChangeIndicator(isDirectlyChanged: boolean, isNeighbor: boolean): number {
    if (isDirectlyChanged) return 1.0;
    if (isNeighbor) return 0.5;
    return 0.0;
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
    if (isDirectlyChanged) {
        return 0.8;
    }
    return 0.5;
}

/** Computes single analyzer-file affinity score A(r, f) */
function computeAffinityScore(
    analyzerId: string,
    fileEntry: AuditIndexEntry,
    isDirectlyChanged: boolean,
    isNeighbor: boolean,
    scopeDecision: AuditScopeDecision,
    weights: ActivationWeights,
): number {
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
    const hHist = Math.min(1.0, fileEntry.history.recentFindingCount / 5);
    const sScope = resolveScopeAffinity(analyzerId, fileEntry, isDirectlyChanged, scopeDecision);

    const rawScore =
        weights.changeIndicator * iChange +
        weights.fileRisk * rRisk +
        weights.dependencyProximity * dDep +
        weights.historyFindings * hHist +
        weights.scopeAffinity * sScope;

    return Math.round(rawScore * 1000) / 1000;
}

/**
 * Executes sparse activation filtering over candidate files and available analyzers.
 *
 * @param availableAnalyzers - List of candidate analyzer identifiers.
 * @param fileEntries - Indexed metadata for candidate files.
 * @param scopeDecision - Decided audit scope.
 * @param changedFiles - Set of files physically changed.
 * @param neighborFiles - Set of files in 1st-order neighborhood.
 * @param threshold - Minimum affinity score required for activation (default 0.35).
 * @param weights - Optional custom weights.
 * @returns Frozen SparseActivationResult.
 */
export function activateSparseAnalyzers(
    availableAnalyzers: readonly string[],
    fileEntries: readonly AuditIndexEntry[],
    scopeDecision: AuditScopeDecision,
    changedFiles: ReadonlySet<string>,
    neighborFiles: ReadonlySet<string> = new Set(),
    threshold = DEFAULT_ACTIVATION_THRESHOLD,
    weights = DEFAULT_ACTIVATION_WEIGHTS,
): SparseActivationResult {
    const fileAnalyzerMap: Record<string, string[]> = {};
    const activatedSet = new Set<string>();
    const rationaleMap: Record<string, string> = {};

    for (const entry of fileEntries) {
        const fPath = entry.filePath;
        const isChanged = changedFiles.has(fPath);
        const isNeighbor = neighborFiles.has(fPath);
        const matchedAnalyzers: string[] = [];

        for (const aId of availableAnalyzers) {
            const score = computeAffinityScore(
                aId,
                entry,
                isChanged,
                isNeighbor,
                scopeDecision,
                weights,
            );

            if (score >= threshold) {
                matchedAnalyzers.push(aId);
                activatedSet.add(aId);
                if (!rationaleMap[aId]) {
                    rationaleMap[aId] =
                        `Activated with affinity ${score} on ${entry.role} (${entry.lang})`;
                }
            }
        }

        if (matchedAnalyzers.length > 0) {
            fileAnalyzerMap[fPath] = matchedAnalyzers;
        }
    }

    const activatedAnalyzers = availableAnalyzers.filter((id) => activatedSet.has(id));
    const skippedAnalyzers = availableAnalyzers.filter((id) => !activatedSet.has(id));
    const selectedFiles = fileEntries
        .map((e) => e.filePath)
        .filter((f) => (fileAnalyzerMap[f]?.length || 0) > 0);
    const skippedFiles = fileEntries
        .map((e) => e.filePath)
        .filter((f) => !selectedFiles.includes(f));

    const totalAvail = availableAnalyzers.length;
    const activationRatio =
        totalAvail > 0 ? Math.round((activatedAnalyzers.length / totalAvail) * 1000) / 1000 : 0;

    const summaryText =
        `Files Selected: ${selectedFiles.length} / Analyzers Activated: ${activatedAnalyzers.length} ` +
        `(${Math.round(activationRatio * 100)}%) / Analyzers Skipped: ${skippedAnalyzers.length} / ` +
        `Files Skipped: ${skippedFiles.length} / Reason: ${scopeDecision.reason}`;

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
