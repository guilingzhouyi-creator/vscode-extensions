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
import {
    ROLE_HEADLESS_DOMAIN_CORE,
    ROLE_DATA_LAYER,
    ROLE_INFRASTRUCTURE,
    ROLE_ADAPTER,
    ROLE_APPLICATION_CLI,
    ROLE_SHARED,
    ROLE_CONFIGURATION,
    ROLE_TOOL_SCRIPT,
    ROLE_TEST_SUITE,
} from './types';

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

/** Options controlling role inference analysis. */
export interface RoleInferenceOptions extends ArchitectureAuditOptions {
    exports?: string[];
    content?: string;
}

const ROOT_DOMAIN = 'root';

/**
 * Extracts domain name from a file path.
 *
 * @param filePath - Physical file path.
 * @returns Inferred domain identifier.
 */
export function extractDomainName(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : ROOT_DOMAIN;
}

const ANNOTATED_ROLE_MAP: Readonly<Record<string, SystemTopologyRole>> = Object.freeze({
    core: ROLE_HEADLESS_DOMAIN_CORE,
    domain: ROLE_HEADLESS_DOMAIN_CORE,
    headless: ROLE_HEADLESS_DOMAIN_CORE,
    headless_domain_core: ROLE_HEADLESS_DOMAIN_CORE,
    data: ROLE_DATA_LAYER,
    persistence: ROLE_DATA_LAYER,
    data_layer: ROLE_DATA_LAYER,
    infra: ROLE_INFRASTRUCTURE,
    infrastructure: ROLE_INFRASTRUCTURE,
    adapter: ROLE_ADAPTER,
    app: ROLE_APPLICATION_CLI,
    application: ROLE_APPLICATION_CLI,
    cli: ROLE_APPLICATION_CLI,
    application_cli: ROLE_APPLICATION_CLI,
    shared: ROLE_SHARED,
    util: ROLE_SHARED,
    config: ROLE_CONFIGURATION,
    configuration: ROLE_CONFIGURATION,
    tool: ROLE_TOOL_SCRIPT,
    tooling: ROLE_TOOL_SCRIPT,
    script: ROLE_TOOL_SCRIPT,
    scripts: ROLE_TOOL_SCRIPT,
    tool_script: ROLE_TOOL_SCRIPT,
    test: ROLE_TEST_SUITE,
    tests: ROLE_TEST_SUITE,
    spec: ROLE_TEST_SUITE,
    test_suite: ROLE_TEST_SUITE,
});

const TEST_DIR_PATTERN = /(?:^|\/)(?:tests?|testdata|benchmarks?|fixtures?|specs?)\//;
const TOOL_DIR_PATTERN = /(?:^|\/)(?:scripts|tools?|bin)\//;
const TEST_FILE_EXTENSIONS = ['.test.ts', '.spec.ts', '.test.js'] as const;

const PATH_HEURISTIC_RULES: ReadonlyArray<{
    re: RegExp;
    role: SystemTopologyRole;
}> = Object.freeze([
    { re: TEST_DIR_PATTERN, role: ROLE_TEST_SUITE },
    { re: TOOL_DIR_PATTERN, role: ROLE_TOOL_SCRIPT },
    { re: /\/(?:config|constants|rules)\//, role: ROLE_CONFIGURATION },
    { re: /\/(?:cli|ui|view|frontend|controllers)\//, role: ROLE_APPLICATION_CLI },
    { re: /\/(?:adapters?|parsers)\//, role: ROLE_ADAPTER },
    { re: /\/(?:data|repositor(?:y|ies)|database)\//, role: ROLE_DATA_LAYER },
    { re: /\/(?:infra|infrastructure|drivers)\//, role: ROLE_INFRASTRUCTURE },
    { re: /\/(?:shared|utils?|helpers?|common)\//, role: ROLE_SHARED },
]);

const DOMAIN_PATH_RE = /\/(?:core|domain|models|entities)\//;

/**
 * Evaluates role from explicit file annotations or comments.
 */
function matchAnnotatedRole(content?: string): SystemTopologyRole | undefined {
    if (!content) {
        return undefined;
    }
    const match = content.match(/@(?:role|layer)\s+([a-zA-Z_]+)/i);
    return match ? ANNOTATED_ROLE_MAP[match[1].toLowerCase()] : undefined;
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
        return {
            role: ROLE_APPLICATION_CLI,
            reason: 'Imports CLI framework or interactive prompt',
        };
    }
    if (imports.some((imp) => DATA_LAYER_IMPORTS.has(imp))) {
        return { role: ROLE_DATA_LAYER, reason: 'Imports database driver or ORM framework' };
    }
    if (imports.some((imp) => INFRASTRUCTURE_IMPORTS.has(imp))) {
        return { role: ROLE_INFRASTRUCTURE, reason: 'Imports low-level system or OS IO libraries' };
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
    return ROLE_HEADLESS_DOMAIN_CORE;
}

/**
 * Matches test suite or tooling script paths prior to domain heuristics.
 *
 * @param lowerPath - Lowercased normalized file path.
 * @returns Inferred test or tool role, or null if not applicable.
 */
function inferTestOrToolRole(lowerPath: string): RoleInferenceResult | null {
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
 * Resolves custom override or declared annotation role.
 */
function resolveExplicitRole(
    filePath: string,
    imports: string[],
    options: RoleInferenceOptions,
): RoleInferenceResult | undefined {
    const normalized = filePath.replace(/\\/g, '/');
    const customRole =
        options.customRoleMappings?.[filePath] ?? options.customRoleMappings?.[normalized];
    if (customRole) {
        return {
            role: customRole,
            reasons: ['Explicit override from customRoleMappings'],
            isHeadless:
                customRole !== ROLE_APPLICATION_CLI && !containsPresentationImports(imports),
        };
    }

    const annotated = matchAnnotatedRole(options.content);
    if (annotated) {
        return {
            role: annotated,
            reasons: ['Declared via @role or @layer annotation'],
            isHeadless: annotated !== ROLE_APPLICATION_CLI && !containsPresentationImports(imports),
        };
    }
    return undefined;
}

/**
 * Infer the system topology role of a file using multi-signal analysis.
 *
 * @param filePath - Path to the file.
 * @param imports - Collection of imported module specifiers.
 * @param options - Architecture audit configuration options.
 * @returns Inferred topology role and reasoning trail.
 */
export function inferSystemTopologyRole(
    filePath: string,
    imports: string[] = [],
    options: RoleInferenceOptions = {},
): RoleInferenceResult {
    const normalized = filePath.replace(/\\/g, '/');
    const lower = normalized.toLowerCase();

    // 1. Explicit override or annotation
    const explicit = resolveExplicitRole(filePath, imports, options);
    if (explicit) {
        return explicit;
    }

    // 2. Test suites and maintenance tooling paths
    const testOrTool = inferTestOrToolRole(lower);
    if (testOrTool) {
        return testOrTool;
    }

    const hasUI = containsPresentationImports(imports);

    // 3. Structural domain/core path
    if (DOMAIN_PATH_RE.test(lower)) {
        return {
            role: ROLE_HEADLESS_DOMAIN_CORE,
            reasons: hasUI
                ? ['Domain path with forbidden presentation imports']
                : ['Structural core/domain path'],
            isHeadless: !hasUI,
        };
    }

    // 4. Presentation / UI import detection
    if (hasUI) {
        return {
            role: ROLE_APPLICATION_CLI,
            reasons: ['Imports forbidden presentation/UI framework'],
            isHeadless: false,
        };
    }

    // 5. Import signature analysis
    const fromImports = matchRoleFromImports(imports);
    if (fromImports) {
        return {
            role: fromImports.role,
            reasons: [fromImports.reason],
            isHeadless: fromImports.role !== ROLE_APPLICATION_CLI,
        };
    }

    // 6. Structural heuristic fallback
    const heuristicRole = matchRoleFromPathHeuristics(lower);
    return {
        role: heuristicRole,
        reasons: [`Structural path classification: ${heuristicRole}`],
        isHeadless: heuristicRole !== ROLE_APPLICATION_CLI,
    };
}
