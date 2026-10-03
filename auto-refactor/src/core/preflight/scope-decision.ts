/**
 * Module: Core Preflight — Audit Scope Decision Engine
 * File Path: src/core/preflight/scope-decision.ts
 * Architecture Role: Explicitly resolves and declares the audit scope mode (PROJECT,
 *   CHANGESET, or DOMAIN) with transparent, explainable rationales.
 * Dependencies & Triggers: Consumes audit-index and file-role-inference; called by preflight
 *   controller and CLI option parsers.
 * Responsibilities:
 *   1. Accept explicit mode overrides from Agent or configuration.
 *   2. Auto-detect optimal scope from Git Diff, changed symbols, and dependency blast radius.
 *   3. Enforce safety fallback from high-risk CHANGESET to full PROJECT when blast
 *      radius exceeds bounds.
 *   4. Output immutable, structured AuditScopeDecision with transparent reason.
 * Exit Semantics & Design Rationale: Never throws; deterministic; returns frozen structures.
 */

import type { PreflightAuditIndexStore } from './audit-index';

/** Three explicit first-class audit scope modes */
export type AuditScopeMode = 'PROJECT' | 'CHANGESET' | 'DOMAIN';

/** Canonical recognized domain specializations */
export const RECOGNIZED_DOMAINS = [
    'constants',
    'rules',
    'tests',
    'config',
    'architecture',
    'docs',
    'scripts',
] as const;

/**
 * Canonical domain specialization names supported for domain-focused audits.
 */
export type RecognizedDomain = (typeof RECOGNIZED_DOMAINS)[number];

/** Complete structured decision outcome exposed to Agent */
export interface AuditScopeDecision {
    readonly mode: AuditScopeMode;
    readonly domain?: string;
    readonly reason: string;
    readonly targetFiles: readonly string[];
    readonly totalProjectFilesCount: number;
    readonly selectedFilesCount: number;
    readonly coverageRatio: number;
    readonly isFallbackFromRisk: boolean;
}

/** Input options for scope decision */
export interface ScopeDecisionOptions {
    /** Caller or Agent explicitly declared mode */
    readonly explicitMode?: AuditScopeMode;
    /** Specific domain identifier when mode is DOMAIN */
    readonly explicitDomain?: string;
    /** File paths detected from Git Diff (staged/modified/untracked) */
    readonly diffFiles?: readonly string[];
    /** All discovered project candidate files */
    readonly allProjectFiles: readonly string[];
    /** Optional preflight index store for blast radius inspection */
    readonly indexStore?: PreflightAuditIndexStore;
    /** Maximum blast radius threshold before safety fallback to PROJECT (default 50) */
    readonly maxChangesetBlastRadius?: number;
}

/** Default maximum blast radius threshold */
const DEFAULT_MAX_BLAST_RADIUS = 50;

/** Normalizes a file path to lower-case posix */
function normalizePath(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase();
}

/** Predicate functions per recognized domain */
const DOMAIN_PREDICATES: Record<string, (norm: string) => boolean> = {
    constants: (norm) => norm.includes('constant') || norm.includes('literals'),
    rules: (norm) =>
        norm.includes('rule') || norm.includes('registry') || norm.includes('manifest'),
    tests: (norm) => norm.includes('/test') || norm.includes('.test.') || norm.includes('.spec.'),
    config: (norm) => norm.includes('config') || norm.endsWith('.json') || norm.endsWith('.yaml'),
    docs: (norm) => norm.endsWith('.md') || norm.includes('/doc'),
    scripts: (norm) => norm.includes('/script') || norm.endsWith('.sh') || norm.endsWith('.ps1'),
};

/** Matches files belonging to a specific architectural domain */
function filterFilesByDomain(files: readonly string[], domain: string): string[] {
    const normDomain = domain.toLowerCase();
    const fallbackPredicate = (norm: string) => norm.includes(normDomain);
    const predicate = DOMAIN_PREDICATES[normDomain] || fallbackPredicate;
    return files.filter((f) => predicate(normalizePath(f)));
}

/** Detects if diff files exclusively concentrate in a single recognized domain */
function detectConcentratedDomain(diffFiles: readonly string[]): RecognizedDomain | null {
    if (diffFiles.length === 0) return null;

    for (const dom of RECOGNIZED_DOMAINS) {
        const matched = filterFilesByDomain(diffFiles, dom);
        if (matched.length === diffFiles.length) {
            return dom;
        }
    }
    return null;
}

/** Evaluates whether blast radius triggers a risk fallback to PROJECT */
function checkBlastRadiusFallback(
    diffFiles: readonly string[],
    indexStore?: PreflightAuditIndexStore,
    maxRadius = DEFAULT_MAX_BLAST_RADIUS,
): { fallback: boolean; estimatedRadius: number } {
    if (!indexStore) {
        return { fallback: diffFiles.length > maxRadius, estimatedRadius: diffFiles.length };
    }

    let totalFanIn = 0;
    for (const f of diffFiles) {
        const entry = indexStore.get(f);
        if (entry) {
            totalFanIn += entry.deps.fanIn;
            if (entry.role === 'core_trunk' && entry.deps.fanIn >= 15) {
                return { fallback: true, estimatedRadius: totalFanIn + diffFiles.length };
            }
        }
    }

    const estimatedRadius = diffFiles.length + totalFanIn;
    return { fallback: estimatedRadius > maxRadius, estimatedRadius };
}

/**
 * Resolves the authoritative AuditScopeDecision for review execution.
 *
 * @param options - Scope decision inputs and constraints.
 * @returns Frozen immutable AuditScopeDecision.
 */
export function decideAuditScope(options: ScopeDecisionOptions): AuditScopeDecision {
    const {
        explicitMode,
        explicitDomain,
        diffFiles = [],
        allProjectFiles,
        indexStore,
        maxChangesetBlastRadius = DEFAULT_MAX_BLAST_RADIUS,
    } = options;

    const totalCount = allProjectFiles.length;

    // Path 1: Explicit mode supplied
    if (explicitMode === 'PROJECT') {
        return Object.freeze({
            mode: 'PROJECT',
            reason: 'Explicit PROJECT mode requested by caller/Agent for baseline scan',
            targetFiles: Object.freeze([...allProjectFiles]),
            totalProjectFilesCount: totalCount,
            selectedFilesCount: totalCount,
            coverageRatio: 1.0,
            isFallbackFromRisk: false,
        });
    }

    if (explicitMode === 'DOMAIN' && explicitDomain) {
        const domainFiles = filterFilesByDomain(allProjectFiles, explicitDomain);
        const selCount = domainFiles.length;
        const ratio = totalCount > 0 ? Math.round((selCount / totalCount) * 1000) / 1000 : 0;
        return Object.freeze({
            mode: 'DOMAIN',
            domain: explicitDomain,
            reason: `Explicit DOMAIN(${explicitDomain}) mode requested; matched ${selCount} specialized files`,
            targetFiles: Object.freeze(domainFiles),
            totalProjectFilesCount: totalCount,
            selectedFilesCount: selCount,
            coverageRatio: ratio,
            isFallbackFromRisk: false,
        });
    }

    if (explicitMode === 'CHANGESET') {
        const targets = diffFiles.length > 0 ? [...diffFiles] : [...allProjectFiles];
        const selCount = targets.length;
        const ratio = totalCount > 0 ? Math.round((selCount / totalCount) * 1000) / 1000 : 0;
        return Object.freeze({
            mode: 'CHANGESET',
            reason: `Explicit CHANGESET mode requested with ${selCount} changed files`,
            targetFiles: Object.freeze(targets),
            totalProjectFilesCount: totalCount,
            selectedFilesCount: selCount,
            coverageRatio: ratio,
            isFallbackFromRisk: false,
        });
    }

    // Path 2: Auto-detect from Diff
    if (diffFiles.length > 0) {
        const { fallback, estimatedRadius } = checkBlastRadiusFallback(
            diffFiles,
            indexStore,
            maxChangesetBlastRadius,
        );

        if (fallback) {
            return Object.freeze({
                mode: 'PROJECT',
                reason: `CHANGESET blast radius (${estimatedRadius}) exceeded safety threshold (${maxChangesetBlastRadius}); safety fallback to PROJECT mode`,
                targetFiles: Object.freeze([...allProjectFiles]),
                totalProjectFilesCount: totalCount,
                selectedFilesCount: totalCount,
                coverageRatio: 1.0,
                isFallbackFromRisk: true,
            });
        }

        const concentratedDomain = detectConcentratedDomain(diffFiles);
        if (concentratedDomain && diffFiles.length <= 5) {
            const selCount = diffFiles.length;
            const ratio = totalCount > 0 ? Math.round((selCount / totalCount) * 1000) / 1000 : 0;
            return Object.freeze({
                mode: 'DOMAIN',
                domain: concentratedDomain,
                reason: `Auto-detected DOMAIN(${concentratedDomain}): all ${selCount} changed files reside strictly within this domain`,
                targetFiles: Object.freeze([...diffFiles]),
                totalProjectFilesCount: totalCount,
                selectedFilesCount: selCount,
                coverageRatio: ratio,
                isFallbackFromRisk: false,
            });
        }

        const selCount = diffFiles.length;
        const ratio = totalCount > 0 ? Math.round((selCount / totalCount) * 1000) / 1000 : 0;
        return Object.freeze({
            mode: 'CHANGESET',
            reason: `Auto-detected CHANGESET mode: Git Diff indicates ${selCount} modified files with localized blast radius (${estimatedRadius})`,
            targetFiles: Object.freeze([...diffFiles]),
            totalProjectFilesCount: totalCount,
            selectedFilesCount: selCount,
            coverageRatio: ratio,
            isFallbackFromRisk: false,
        });
    }

    // Path 3: No diff provided, default PROJECT
    return Object.freeze({
        mode: 'PROJECT',
        reason: 'No Git Diff changes detected; defaulted to PROJECT mode for baseline review',
        targetFiles: Object.freeze([...allProjectFiles]),
        totalProjectFilesCount: totalCount,
        selectedFilesCount: totalCount,
        coverageRatio: 1.0,
        isFallbackFromRisk: false,
    });
}
