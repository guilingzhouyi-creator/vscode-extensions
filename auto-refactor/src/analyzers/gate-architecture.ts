/**
 * Module: Static Analysis Engine — Gate Architecture Governance Analyzer
 * File Path: src/analyzers/gate-architecture.ts
 * Architecture Role: Polyglot repository gate architecture analyzer; evaluates 2-tier
 *   gate health (Tier 1 Local Left-Shift Gate + Tier 2 Remote CI Gate) across 7 dimensions
 *   and provides concrete cross-platform scaffolding payloads when gates are missing.
 * Dependencies & Triggers: Core types (Analyzer, AnalyzerContext, Issue), gate-governance
 *   evaluator; triggered when declarative 'gate-architecture' analyzer is enabled.
 * Responsibilities:
 *   1. Evaluate missing gates (GATE-SYS-001, GATE-HOOK-001) with AgentActionablePayload;
 *   2. Evaluate 7 existing gate quality dimensions:
 *      GATE-ISO-001, GATE-ROUTE-001, GATE-MSG-001, GATE-HYG-001,
 *      GATE-BUDGET-001, GATE-ERR-001, GATE-SSOT-001;
 *   3. Cache whole-repo evaluation per scan session to prevent redundant re-audits.
 * Exit Semantics & Design Rationale: Deterministic and idempotent; returns Issue[] and
 *   never throws. Attaches structured scaffolding instructions for automated remediation.
 */

import * as path from 'path';
import type * as ts from 'typescript';
import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import { auditGateArchitecture } from '../core/governance/gate-governance';
import type { GateGovernanceOptions } from '../core/governance/gate-governance';

const GATE_MANIFEST_NAMES = new Set([
    'package.json',
    'Cargo.toml',
    'pyproject.toml',
    'go.mod',
    'project.godot',
]);

const GATE_PATH_PATTERN = /(?:\.githooks|\.husky|\.github\/workflows|\.gitlab-ci|^scripts\/)/;

/**
 * Checks whether a normalized file path is a potential gate configuration or manifest candidate.
 *
 * @param normPath - Normalized POSIX file path.
 * @returns True if the path warrants gate architecture audit.
 */
function isGateCandidateFile(normPath: string): boolean {
    const base = path.basename(normPath);
    return GATE_MANIFEST_NAMES.has(base) || GATE_PATH_PATTERN.test(normPath);
}

/**
 * Checks whether the relative path represents a root-level primary project manifest.
 *
 * @param relPath - Path relative to repo root.
 * @returns True if file is a primary manifest anchor.
 */
function isPrimaryManifestFile(relPath: string): boolean {
    return (
        relPath === 'package.json' ||
        relPath === 'Cargo.toml' ||
        relPath === 'pyproject.toml' ||
        relPath === 'go.mod' ||
        relPath === 'project.godot'
    );
}

/**
 * Checks whether an issue location represents a repository-wide logical anchor.
 *
 * @param locationFile - Issue location file string.
 * @returns True if location is a repo-level anchor.
 */
function isRepoLevelAnchor(locationFile: string): boolean {
    return (
        locationFile === '.' ||
        locationFile === 'scripts' ||
        locationFile === '.githooks' ||
        locationFile === '.husky'
    );
}

/**
 * Polyglot repository gate architecture analyzer.
 * Evaluates Tier 1 local gates and Tier 2 remote CI gates across 7 engineering dimensions.
 */
export class GateArchitectureAnalyzer implements Analyzer {
    name = 'gate-architecture' as const;

    private static auditCache = new Map<string, Issue[]>();

    /**
     * Clear cached audits (useful in test harnesses).
     */
    static clearCache(): void {
        GateArchitectureAnalyzer.auditCache.clear();
    }

    analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
        return this.finalize(ctx);
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        const normPath = ctx.filePath.replace(/\\/g, '/');

        if (!isGateCandidateFile(normPath)) {
            return [];
        }

        const options = (ctx.config?.analyzers?.['gate-architecture']?.options ||
            {}) as GateGovernanceOptions;

        // Resolve workspace/repo root from config or process.cwd()
        const repoRoot = (ctx.config?.root || process.cwd()).replace(/\\/g, '/');
        const absFilePath = path.resolve(ctx.filePath).replace(/\\/g, '/');
        const relPath = path.relative(repoRoot, absFilePath).replace(/\\/g, '/');

        // Cached lookup per root directory to prevent redundant audits across multiple files
        const issues = GateArchitectureAnalyzer.auditCache.has(repoRoot)
            ? GateArchitectureAnalyzer.auditCache.get(repoRoot)!
            : this.executeAndCacheAudit(repoRoot, options);

        const isManifest = isPrimaryManifestFile(relPath);

        return issues.filter((issue) => {
            const issueFile = issue.location.file;
            if (issueFile === relPath || issueFile === normPath) return true;
            if (isManifest && isRepoLevelAnchor(issueFile)) return true;
            return false;
        });
    }

    private executeAndCacheAudit(repoRoot: string, options: GateGovernanceOptions): Issue[] {
        const result = auditGateArchitecture(repoRoot, options);
        GateArchitectureAnalyzer.auditCache.set(repoRoot, result.issues);
        return result.issues;
    }
}
