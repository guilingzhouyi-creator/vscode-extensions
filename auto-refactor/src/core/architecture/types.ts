/**
 * Module: Core Architecture — Types and Contracts
 * File Path: src/core/architecture/types.ts
 * Architecture Role: Formal contracts and declarations for the Semantic Architecture Graph,
 *   system topology roles, meta architecture rules, and architectural contracts.
 * Dependencies & Triggers: Consumes Issue and Severity from core/types.
 * Responsibilities: Define SystemTopologyRole, SemanticArchitectureNode, MetaRuleId,
 *   ArchitectureContract, and options for architectural governance.
 * Exit Semantics & Design Rationale: Strongly typed pure definitions conforming to 100-col limit.
 */

import type { Issue } from '../types';
import type { ConfigDrivenAnalysisResult } from './config-driven-architecture';

/** Headless domain core business logic role. */
export const ROLE_HEADLESS_DOMAIN_CORE = 'headless_domain_core' as const;
/** Data layer repository or store role. */
export const ROLE_DATA_LAYER = 'data_layer' as const;
/** Infrastructure system service or client role. */
export const ROLE_INFRASTRUCTURE = 'infrastructure' as const;
/** Adapter boundary translation role. */
export const ROLE_ADAPTER = 'adapter' as const;
/** Application entry point or CLI role. */
export const ROLE_APPLICATION_CLI = 'application_cli' as const;
/** Shared utility or common library role. */
export const ROLE_SHARED = 'shared' as const;
/** Static configuration or schema role. */
export const ROLE_CONFIGURATION = 'configuration' as const;
/** Tooling or repository maintenance script role. */
export const ROLE_TOOL_SCRIPT = 'tool_script' as const;
/** Automated test suite or benchmark role. */
export const ROLE_TEST_SUITE = 'test_suite' as const;

/**
 * Fundamental system topology roles recognized across multi-language codebases.
 */
export type SystemTopologyRole =
    | typeof ROLE_HEADLESS_DOMAIN_CORE
    | typeof ROLE_DATA_LAYER
    | typeof ROLE_INFRASTRUCTURE
    | typeof ROLE_ADAPTER
    | typeof ROLE_APPLICATION_CLI
    | typeof ROLE_SHARED
    | typeof ROLE_CONFIGURATION
    | typeof ROLE_TOOL_SCRIPT
    | typeof ROLE_TEST_SUITE;

/**
 * Descriptor of a node within the SemanticArchitectureGraph.
 */
export interface SemanticArchitectureNode {
    id: string;
    filePath: string;
    role: SystemTopologyRole;
    isHeadless: boolean;
    domainName: string;
    inferredReasons: string[];
    imports: string[];
    exports: string[];
    hasDirectConfigAccess: boolean;
    hasGlobalMutableState: boolean;
}

/**
 * Edge representing an architectural dependency between architectural nodes.
 */
export interface SemanticArchitectureEdge {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    edgeKind: 'imports' | 'calls' | 'inherits' | 'depends_on';
    isCrossDomain: boolean;
    isLayerInversion: boolean;
    isPrivateBypass: boolean;
}

/**
 * Options governing meta architecture evaluation.
 */
export interface ArchitectureAuditOptions {
    enforceHeadless?: boolean;
    enforceCleanLayers?: boolean;
    flagCrossDomainBypass?: boolean;
    flagConfigHardcoding?: boolean;
    flagGeneralizationLeak?: boolean;
    flagGlobalCoupling?: boolean;
    flagSelfViolation?: boolean;
    isSelfRepo?: boolean;
    customRoleMappings?: Record<string, SystemTopologyRole>;
    customAllowedDependencies?: Partial<Record<SystemTopologyRole, SystemTopologyRole[]>>;
    flagFileTaxonomy?: boolean;
    flagBoundaryDiscipline?: boolean;
}

/**
 * Result of full repository architectural analysis.
 */
export interface ArchitectureAuditResult {
    nodes: Map<string, SemanticArchitectureNode>;
    edges: SemanticArchitectureEdge[];
    issues: Issue[];
    layerDistribution: Record<SystemTopologyRole, number>;
    inversionCount: number;
    headlessBreachCount: number;
    privateBypassCount: number;
    passed: boolean;
    configMaturity?: ConfigDrivenAnalysisResult;
    fileTaxonomyResult?: import('./file-taxonomy-ontology').FileTaxonomyAuditResult;
    boundaryDisciplineResult?: import('../intelligence/boundary-discipline-engine').BoundaryDisciplineResult;
}

const ALL_ROLES_SET: ReadonlySet<SystemTopologyRole> = new Set([
    ROLE_HEADLESS_DOMAIN_CORE,
    ROLE_DATA_LAYER,
    ROLE_INFRASTRUCTURE,
    ROLE_ADAPTER,
    ROLE_APPLICATION_CLI,
    ROLE_SHARED,
    ROLE_CONFIGURATION,
    ROLE_TOOL_SCRIPT,
    ROLE_TEST_SUITE,
]);

/**
 * Standard allowed dependency flow for unidirectional clean architecture.
 */
export const DEFAULT_ALLOWED_DEPENDENCIES: Record<
    SystemTopologyRole,
    ReadonlySet<SystemTopologyRole>
> = {
    [ROLE_HEADLESS_DOMAIN_CORE]: new Set([ROLE_SHARED, ROLE_CONFIGURATION]),
    [ROLE_DATA_LAYER]: new Set([
        ROLE_HEADLESS_DOMAIN_CORE,
        ROLE_INFRASTRUCTURE,
        ROLE_SHARED,
        ROLE_CONFIGURATION,
    ]),
    [ROLE_INFRASTRUCTURE]: new Set([ROLE_SHARED, ROLE_CONFIGURATION]),
    [ROLE_ADAPTER]: new Set([
        ROLE_HEADLESS_DOMAIN_CORE,
        ROLE_INFRASTRUCTURE,
        ROLE_SHARED,
        ROLE_CONFIGURATION,
    ]),
    [ROLE_APPLICATION_CLI]: new Set([
        ROLE_HEADLESS_DOMAIN_CORE,
        ROLE_DATA_LAYER,
        ROLE_INFRASTRUCTURE,
        ROLE_ADAPTER,
        ROLE_SHARED,
        ROLE_CONFIGURATION,
    ]),
    [ROLE_SHARED]: new Set([ROLE_SHARED, ROLE_CONFIGURATION]),
    [ROLE_CONFIGURATION]: new Set([ROLE_CONFIGURATION, ROLE_SHARED]),
    [ROLE_TOOL_SCRIPT]: ALL_ROLES_SET,
    [ROLE_TEST_SUITE]: ALL_ROLES_SET,
};
