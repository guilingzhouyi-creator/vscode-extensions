/**
 * Module: Core Architecture — Scalable Constant Library Topology Auditor
 * File Path: src/core/architecture/constant-library-auditor.ts
 * Architecture Role: Evaluates the macro-level organizational health and clustering topology of
 *     project constants. When constants are widely extracted but remain scattered across ordinary
 *     business files, this auditor guides AI Agents to scaffold a centralized, domain-sliced
 *     constant library directory with barrel export topology.
 * Dependencies & Triggers: Consumes Issue from core/types, constants from core/constants;
 *     invoked during cross-file finalization and reporting.
 * Responsibilities:
 *     1. Measure Constant Sprawl Index across repository modules.
 *     2. Group scattered constants into domain categories by semantic prefix.
 *     3. Recommend standardized constant library directory topology (e.g. constants/<domain>.ts).
 *     4. Emit CONST-LIB-001 with structured AgentActionablePayload (scaffold_constant_library).
 * Exit Semantics & Design Rationale: Deterministic pure function without disk I/O.
 */

import type { Issue } from '../types';
import {
    ANALYZER_CONSTANTS,
    RULE_CONST_LIB_001,
    CODE_CONST_LIB_TOPOLOGY,
    SEVERITY_WARNING,
} from '../constants';

/** Minimum scattered constant count required to recommend library scaffolding */
export const MIN_SCATTERED_CONSTANTS_THRESHOLD = 20;

/** Minimum distinct non-constant files containing scattered constants */
export const MIN_SCATTERED_FILES_THRESHOLD = 3;

/**
 * Observed constant declaration site across the project.
 */
export interface ObservedConstantDeclaration {
    name: string;
    normalizedValue: string;
    filePath: string;
    line: number;
    isExported?: boolean;
}

/**
 * Recommended module slice within the constant library topology.
 */
export interface SuggestedConstantModule {
    file: string;
    symbols: string[];
    isBarrel?: boolean;
}

/**
 * Output verdict of constant library topology assessment.
 */
export interface ConstantLibraryTopologyVerdict {
    sprawlCount: number;
    affectedFilesCount: number;
    needsCentralizedLibrary: boolean;
    recommendedDirectory: string;
    suggestedModules: SuggestedConstantModule[];
}

/**
 * Categorize a constant symbol into a canonical domain module name.
 */
function categorizeSymbolToModule(name: string): string {
    const upper = name.toUpperCase();
    if (upper.startsWith('AST_') || upper.startsWith('NODE_')) {
        return 'ast-tokens.ts';
    }
    if (upper.startsWith('RULE_') || upper.startsWith('CODE_')) {
        return 'rule-codes.ts';
    }
    if (
        upper.startsWith('SYS_') ||
        upper.startsWith('PATH_') ||
        upper.startsWith('EXT_') ||
        upper.startsWith('DIR_')
    ) {
        return 'system-tokens.ts';
    }
    if (
        upper.startsWith('SEVERITY_') ||
        upper.startsWith('STATUS_') ||
        upper.startsWith('DIAG_')
    ) {
        return 'diagnostic-tokens.ts';
    }
    if (
        upper.startsWith('CFG_') ||
        upper.startsWith('CONFIG_') ||
        upper.startsWith('DEFAULT_') ||
        upper.startsWith('LIMIT_')
    ) {
        return 'config-tokens.ts';
    }
    return 'domain-tokens.ts';
}

/**
 * Determine if a file path is already part of a recognized constant library structure.
 */
function isAlreadyInConstantLibrary(filePath: string): boolean {
    const posix = filePath.replace(/\\/g, '/').toLowerCase();
    return (
        posix.includes('/constants/') ||
        posix.includes('/tokens/') ||
        posix.endsWith('/constants.ts') ||
        posix.endsWith('/tokens.ts')
    );
}

/**
 * Derives the optimal base directory for the centralized constant library.
 */
function deriveTargetDirectory(filePaths: string[]): string {
    const posixPaths = filePaths.map((f) => f.replace(/\\/g, '/'));
    const isUnderSrc = posixPaths.some((p) => p.startsWith('src/'));
    const isUnderCore = posixPaths.some((p) => p.startsWith('src/core/'));

    if (isUnderCore) return 'src/core/constants';
    if (isUnderSrc) return 'src/constants';
    return 'constants';
}

/**
 * Evaluates the scattered constants and determines whether to recommend
 * scaffolding a centralized constant library topology.
 *
 * @param declarations - Observed constant declaration sites across the project.
 * @returns Topology assessment verdict with sprawl metrics and module breakdown.
 */
export function auditConstantLibraryTopology(
    declarations: ObservedConstantDeclaration[],
): ConstantLibraryTopologyVerdict {
    const scattered = declarations.filter((d) => !isAlreadyInConstantLibrary(d.filePath));
    const uniqueFiles = new Set(scattered.map((d) => d.filePath));

    const needsCentralizedLibrary =
        scattered.length >= MIN_SCATTERED_CONSTANTS_THRESHOLD &&
        uniqueFiles.size >= MIN_SCATTERED_FILES_THRESHOLD;

    if (!needsCentralizedLibrary) {
        return {
            sprawlCount: scattered.length,
            affectedFilesCount: uniqueFiles.size,
            needsCentralizedLibrary: false,
            recommendedDirectory: '',
            suggestedModules: [],
        };
    }

    const targetDir = deriveTargetDirectory(Array.from(uniqueFiles));
    const moduleGroups = new Map<string, string[]>();

    for (const d of scattered) {
        const modName = categorizeSymbolToModule(d.name);
        const list = moduleGroups.get(modName) || [];
        if (!list.includes(d.name)) list.push(d.name);
        moduleGroups.set(modName, list);
    }

    const suggestedModules: SuggestedConstantModule[] = [];
    for (const [modFile, symbols] of moduleGroups.entries()) {
        suggestedModules.push({
            file: `${targetDir}/${modFile}`,
            symbols: symbols.sort(),
        });
    }

    // Always append canonical index barrel entry
    suggestedModules.push({
        file: `${targetDir}/index.ts`,
        symbols: [],
        isBarrel: true,
    });

    return {
        sprawlCount: scattered.length,
        affectedFilesCount: uniqueFiles.size,
        needsCentralizedLibrary: true,
        recommendedDirectory: targetDir,
        suggestedModules,
    };
}

/**
 * Core auditor function emitting CONST-LIB-001 issues when constant sprawl warrants
 * scaffolding a centralized constant library topology.
 *
 * @param declarations - Observed constant declarations across the project.
 * @param primaryFilePath - Optional file path anchor for the emitted finding.
 * @returns Array of emitted CONST-LIB-001 issues with actionable payloads.
 */
export function inspectConstantLibraryTopology(
    declarations: ObservedConstantDeclaration[],
    primaryFilePath?: string,
): Issue[] {
    const verdict = auditConstantLibraryTopology(declarations);
    if (!verdict.needsCentralizedLibrary) return [];

    const file = primaryFilePath || verdict.suggestedModules[0]?.file || 'project';
    const message =
        `Unstructured constant sprawl: ${verdict.sprawlCount} constants are scattered across ` +
        `${verdict.affectedFilesCount} files without a dedicated library topology. ` +
        `Consolidate into a centralized constant library under '${verdict.recommendedDirectory}'.`;

    const suggestion =
        `Scaffold constant library at '${verdict.recommendedDirectory}' with sliced domain ` +
        `modules (${verdict.suggestedModules.filter((m) => !m.isBarrel).length} modules) ` +
        `and a unified 'index.ts' barrel export.`;

    const issue: Issue = {
        id: `${ANALYZER_CONSTANTS}:${RULE_CONST_LIB_001}:${file}:1`,
        analyzer: ANALYZER_CONSTANTS,
        rule: RULE_CONST_LIB_001,
        severity: SEVERITY_WARNING,
        message,
        location: {
            file,
            start: { line: 1, column: 1 },
            end: { line: 1, column: 1 },
        },
        detail: {
            sprawlCount: verdict.sprawlCount,
            affectedFilesCount: verdict.affectedFilesCount,
            recommendedDirectory: verdict.recommendedDirectory,
            moduleCount: verdict.suggestedModules.length,
        },
        suggestion,
        actionable: {
            action: 'scaffold_constant_library',
            code: CODE_CONST_LIB_TOPOLOGY,
            targetDirectory: verdict.recommendedDirectory,
            suggestedModules: verdict.suggestedModules,
            safeToAutomate: true,
        },
    };

    return [issue];
}
