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

/**
 * Fundamental system topology roles recognized across multi-language codebases.
 */
export type SystemTopologyRole =
    | 'headless_domain_core'
    | 'data_layer'
    | 'infrastructure'
    | 'adapter'
    | 'application_cli'
    | 'shared'
    | 'configuration';

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
}

/**
 * Standard allowed dependency flow for unidirectional clean architecture.
 */
export const DEFAULT_ALLOWED_DEPENDENCIES: Record<
    SystemTopologyRole,
    ReadonlySet<SystemTopologyRole>
> = {
    headless_domain_core: new Set(['shared', 'configuration']),
    data_layer: new Set(['headless_domain_core', 'infrastructure', 'shared', 'configuration']),
    infrastructure: new Set(['shared', 'configuration']),
    adapter: new Set(['headless_domain_core', 'infrastructure', 'shared', 'configuration']),
    application_cli: new Set([
        'headless_domain_core',
        'data_layer',
        'infrastructure',
        'adapter',
        'shared',
        'configuration',
    ]),
    shared: new Set(['shared', 'configuration']),
    configuration: new Set(['configuration', 'shared']),
};
