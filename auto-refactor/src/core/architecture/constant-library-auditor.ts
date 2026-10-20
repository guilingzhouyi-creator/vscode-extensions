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

interface PrefixModuleMapping {
    readonly prefixes: readonly string[];
    readonly module: string;
}

const CONSTANT_MODULE_MAPPINGS: readonly PrefixModuleMapping[] = Object.freeze([
    { prefixes: ['AST_', 'NODE_'], module: 'ast-tokens.ts' },
    { prefixes: ['RULE_', 'CODE_'], module: 'rule-codes.ts' },
    { prefixes: ['SYS_', 'PATH_', 'EXT_', 'DIR_'], module: 'system-tokens.ts' },
    { prefixes: ['SEVERITY_', 'STATUS_', 'DIAG_'], module: 'diagnostic-tokens.ts' },
    { prefixes: ['CFG_', 'CONFIG_', 'DEFAULT_', 'LIMIT_'], module: 'config-tokens.ts' },
]);

/** Directory segment markers identifying an existing constant library structure. */
const CONSTANT_LIB_DIR_PATTERN = /(?:^|\/)(?:constants|tokens|dictionary|dictionaries)(?:\/|$)/;

/** File suffix patterns identifying an existing constant library module across TS, Rust, Python, GDScript. */
const CONSTANT_LIB_FILE_PATTERN =
    /(?:constants|tokens|dictionary)(?:[\\/](?:mod|[a-z0-9_-]+))?\.(?:[tj]s|rs|py|gd)$/i;

function matchesAnyPrefix(target: string, prefixes: readonly string[]): boolean {
    for (const prefix of prefixes) {
        if (target.startsWith(prefix)) return true;
    }
    return false;
}

/**
 * Categorize a constant symbol into a canonical domain module name.
 */
function categorizeSymbolToModule(name: string): string {
    const upper = name.toUpperCase();
    for (const mapping of CONSTANT_MODULE_MAPPINGS) {
        if (matchesAnyPrefix(upper, mapping.prefixes)) {
            return mapping.module;
        }
    }
    return 'domain-tokens.ts';
}

/**
 * Determine if a file path is already part of a recognized constant library structure.
 * Matches directories containing constants/tokens/dictionary and filenames ending
 * with constants or tokens.
 *
 * @param filePath - System or relative file path to inspect.
 * @returns True if the path is already identified as a constant/token repository.
 */
export function isAlreadyInConstantLibrary(filePath: string): boolean {
    const posix = filePath.replace(/\\/g, '/').toLowerCase();
    if (CONSTANT_LIB_DIR_PATTERN.test(posix)) {
        return true;
    }
    return CONSTANT_LIB_FILE_PATTERN.test(posix);
}

/** Canonical domain module filenames for constant library topology. */
const _CANONICAL_MODULE_NAMES: readonly string[] = Object.freeze([
    'ast-tokens.ts',
    'rule-codes.ts',
    'system-tokens.ts',
    'diagnostic-tokens.ts',
    'config-tokens.ts',
    'domain-tokens.ts',
]);

/**
 * Derives the optimal base directory for the centralized constant library.
 */
function deriveTargetDirectory(filePaths: string[]): string {
    const posixPaths = filePaths.map((filePath) => filePath.replace(/\\/g, '/'));
    const isUnderSrc = posixPaths.some((posixPath) => posixPath.startsWith('src/'));
    const isUnderCore = posixPaths.some((posixPath) => posixPath.startsWith('src/core/'));

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
    const scattered = declarations.filter((decl) => !isAlreadyInConstantLibrary(decl.filePath));
    const uniqueFiles = new Set(scattered.map((decl) => decl.filePath));

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

    // Pre-allocated domain symbol sets pool declared outside loop
    // to eliminate transient heap allocation
    const moduleNameToSymbolSetMap = new Map<string, Set<string>>([
        ['ast-tokens.ts', new Set<string>()],
        ['rule-codes.ts', new Set<string>()],
        ['system-tokens.ts', new Set<string>()],
        ['diagnostic-tokens.ts', new Set<string>()],
        ['config-tokens.ts', new Set<string>()],
        ['domain-tokens.ts', new Set<string>()],
    ]);

    // Populate pre-allocated domain sets without any inline allocations in the hot loop
    for (const decl of scattered) {
        const modName = categorizeSymbolToModule(decl.name);
        const symbolSet = moduleNameToSymbolSetMap.get(modName);
        if (symbolSet !== undefined) {
            symbolSet.add(decl.name);
        }
    }

    const suggestedModules: SuggestedConstantModule[] = [];
    for (const [modFile, symbolSet] of moduleNameToSymbolSetMap.entries()) {
        if (symbolSet.size === 0) {
            continue;
        }
        suggestedModules.push({
            file: `${targetDir}/${modFile}`,
            symbols: Array.from(symbolSet).sort(),
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
