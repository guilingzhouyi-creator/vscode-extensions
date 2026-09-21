/**
 * Module: Core Architecture — System Topology Role Inference
 * File Path: src/core/architecture/roleInference.ts
 * Architecture Role: Multi-signal heuristic and declarative inference engine that classifies
 *   any source file into its canonical SystemTopologyRole.
 * Dependencies & Triggers: Consumes types from ./types and FORBIDDEN_HEADLESS_IMPORTS.
 * Responsibilities: Infer architectural role using annotations, import signatures, symbol
 *   exports, and structural layout without brittle path-only hardcoding.
 * Exit Semantics & Design Rationale: Deterministic pure function with priority cascading.
 */

import { FORBIDDEN_HEADLESS_IMPORTS } from '../intelligence/semanticArchitecture';
import type { ArchitectureAuditOptions, SystemTopologyRole } from './types';
import { ROLE_TEST_SUITE, ROLE_TOOL_SCRIPT } from './types';

/**
 * Libraries indicating CLI and application entry controllers.
 */
export const CLI_FRAMEWORK_IMPORTS = new Set([
    'commander',
    'yargs',
    'cac',
    'meow',
    'clap',
    'click',
    'argparse',
    'ink',
    'blessed',
]);

/**
 * Database, ORM, and persistence client libraries.
 */
export const DATA_LAYER_IMPORTS = new Set([
    'typeorm',
    'prisma',
    '@prisma/client',
    'mongoose',
    'pg',
    'mysql',
    'mysql2',
    'sqlite3',
    'better-sqlite3',
    'knex',
    'sequelize',
    'sqlalchemy',
    'diesel',
    'sqlx',
    'redis',
    'ioredis',
]);

/**
 * Low-level system IO and OS drivers.
 */
export const INFRASTRUCTURE_IMPORTS = new Set([
    'child_process',
    'cluster',
    'dgram',
    'net',
    'tls',
    'tty',
    'v8',
    'vm',
    'wasi',
    'sys',
]);

/**
 * Multi-signal classification result.
 */
export interface RoleInferenceResult {
    role: SystemTopologyRole;
    reasons: string[];
    isHeadless: boolean;
}

/**
 * Extracts domain name from a file path.
 *
 * @param filePath - Physical file path.
 * @returns Inferred domain identifier.
 */
export function extractDomainName(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length >= 2) {
        return parts[parts.length - 2];
    }
    return 'root';
}

const ANNOTATED_ROLE_MAP: Readonly<Record<string, SystemTopologyRole>> = {
    core: 'headless_domain_core',
    domain: 'headless_domain_core',
    headless: 'headless_domain_core',
    headless_domain_core: 'headless_domain_core',
    data: 'data_layer',
    persistence: 'data_layer',
    data_layer: 'data_layer',
    infra: 'infrastructure',
    infrastructure: 'infrastructure',
    adapter: 'adapter',
    app: 'application_cli',
    application: 'application_cli',
    cli: 'application_cli',
    application_cli: 'application_cli',
    shared: 'shared',
    util: 'shared',
    config: 'configuration',
    configuration: 'configuration',
    tool: ROLE_TOOL_SCRIPT,
    tooling: ROLE_TOOL_SCRIPT,
    script: ROLE_TOOL_SCRIPT,
    scripts: ROLE_TOOL_SCRIPT,
    tool_script: ROLE_TOOL_SCRIPT,
    test: ROLE_TEST_SUITE,
    tests: ROLE_TEST_SUITE,
    spec: ROLE_TEST_SUITE,
    test_suite: ROLE_TEST_SUITE,
};

const TEST_DIR_PATTERN = /(?:^|\/)(?:tests?|testdata|benchmarks?|fixtures?|specs?)\//;
const TOOL_DIR_PATTERN = /(?:^|\/)(?:scripts|tools?|bin)\//;
const TEST_FILE_EXTENSIONS = ['.test.ts', '.spec.ts', '.test.js'] as const;

const PATH_HEURISTIC_RULES: ReadonlyArray<{
    re: RegExp;
    role: SystemTopologyRole;
}> = [
    { re: TEST_DIR_PATTERN, role: ROLE_TEST_SUITE },
    { re: TOOL_DIR_PATTERN, role: ROLE_TOOL_SCRIPT },
    { re: /\/(?:config|constants|rules)\//, role: 'configuration' },
    { re: /\/(?:cli|ui|view|frontend|controllers)\//, role: 'application_cli' },
    { re: /\/(?:adapters?|parsers)\//, role: 'adapter' },
    { re: /\/(?:data|repositor(?:y|ies)|database)\//, role: 'data_layer' },
    { re: /\/(?:infra|infrastructure|drivers)\//, role: 'infrastructure' },
    { re: /\/(?:shared|utils?|helpers?|common)\//, role: 'shared' },
];

const DOMAIN_PATH_RE = /\/(?:core|domain|models|entities)\//;

/**
 * Evaluates role from explicit file annotations or comments.
 */
function matchAnnotatedRole(content?: string): SystemTopologyRole | undefined {
    if (!content) {
        return undefined;
    }
    const match = content.match(/@(?:role|layer)\s+([a-zA-Z_]+)/i);
    if (!match) {
        return undefined;
    }
    return ANNOTATED_ROLE_MAP[match[1].toLowerCase()];
}

/**
 * Inspects imports to identify presentation frameworks.
 */
function containsPresentationImports(imports: string[]): boolean {
    return imports.some((imp) => FORBIDDEN_HEADLESS_IMPORTS.has(imp));
}

/**
 * Matches architectural role from import signatures.
 */
function matchRoleFromImports(
    imports: string[],
): { role: SystemTopologyRole; reason: string } | undefined {
    if (imports.some((imp) => CLI_FRAMEWORK_IMPORTS.has(imp))) {
        return { role: 'application_cli', reason: 'Imports CLI framework or interactive prompt' };
    }
    if (imports.some((imp) => DATA_LAYER_IMPORTS.has(imp))) {
        return { role: 'data_layer', reason: 'Imports database driver or ORM framework' };
    }
    if (imports.some((imp) => INFRASTRUCTURE_IMPORTS.has(imp))) {
        return { role: 'infrastructure', reason: 'Imports low-level system or OS IO libraries' };
    }
    return undefined;
}

/**
 * Fallback heuristic matching using structural path keywords.
 */
function matchRoleFromPathHeuristics(lowerPath: string): SystemTopologyRole {
    for (const rule of PATH_HEURISTIC_RULES) {
        if (rule.re.test(lowerPath)) {
            return rule.role;
        }
    }
    return 'headless_domain_core';
}

/**
 * Matches test suite or tooling script paths prior to domain heuristics.
 *
 * @param lowerPath - Lowercased normalized file path.
 * @returns Inferred test or tool role, or null if not applicable.
 */
function matchStructuralTestOrToolRole(lowerPath: string): RoleInferenceResult | null {
    const isTest =
        TEST_DIR_PATTERN.test(lowerPath) ||
        TEST_FILE_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
    if (isTest) {
        return {
            role: ROLE_TEST_SUITE,
            reasons: ['Structural test suite or fixture path'],
            isHeadless: true,
        };
    }
    if (TOOL_DIR_PATTERN.test(lowerPath)) {
        return {
            role: ROLE_TOOL_SCRIPT,
            reasons: ['Structural tooling or maintenance script path'],
            isHeadless: true,
        };
    }
    return null;
}

/**
 * Infer the system topology role of a file using multi-signal analysis.
 *
 * @param filePath - Path to the file.
 * @param imports - Collection of imported module specifiers.
 * @param _exports - Optional list of exported identifiers.
 * @param content - Optional source text of the file.
 * @param options - Architecture audit configuration options.
 * @returns Inferred topology role and reasoning trail.
 */
export function inferSystemTopologyRole(
    filePath: string,
    imports: string[],
    _exports: string[] = [],
    content?: string,
    options: ArchitectureAuditOptions = {},
): RoleInferenceResult {
    const reasons: string[] = [];
    const normalized = filePath.replace(/\\/g, '/');
    const lower = normalized.toLowerCase();

    // 1. Explicit user override from options
    const customRole =
        options.customRoleMappings?.[filePath] ?? options.customRoleMappings?.[normalized];
    if (customRole) {
        return {
            role: customRole,
            reasons: ['Explicit override from customRoleMappings'],
            isHeadless: customRole !== 'application_cli' && !containsPresentationImports(imports),
        };
    }

    // 2. Explicit file annotation
    const annotated = matchAnnotatedRole(content);
    if (annotated) {
        return {
            role: annotated,
            reasons: ['Declared via @role or @layer annotation'],
            isHeadless: annotated !== 'application_cli' && !containsPresentationImports(imports),
        };
    }

    // 3. Test suites and maintenance tooling paths take precedence over domain core path heuristics
    const testOrTool = matchStructuralTestOrToolRole(lower);
    if (testOrTool) {
        return testOrTool;
    }

    const hasUI = containsPresentationImports(imports);

    // 4. Structural domain/core path defines core intent even if rogue imports exist
    const isDomainPath = DOMAIN_PATH_RE.test(lower);
    if (isDomainPath) {
        return {
            role: 'headless_domain_core',
            reasons: hasUI
                ? ['Domain path with forbidden presentation imports']
                : ['Structural core/domain path'],
            isHeadless: !hasUI,
        };
    }

    // 4. Presentation / UI import detection for outer layers
    if (hasUI) {
        return {
            role: 'application_cli',
            reasons: ['Imports forbidden presentation/UI framework'],
            isHeadless: false,
        };
    }

    // 4. Import signature analysis
    const fromImports = matchRoleFromImports(imports);
    if (fromImports) {
        return {
            role: fromImports.role,
            reasons: [fromImports.reason],
            isHeadless: fromImports.role !== 'application_cli',
        };
    }

    // 5. Structural heuristic fallback
    const heuristicRole = matchRoleFromPathHeuristics(lower);
    reasons.push(`Structural path classification: ${heuristicRole}`);

    // Headless status: true unless UI or CLI entry
    const isHeadless = heuristicRole !== 'application_cli';

    return {
        role: heuristicRole,
        reasons,
        isHeadless,
    };
}
