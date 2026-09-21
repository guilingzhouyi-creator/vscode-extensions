/**
 * Module: Core Architecture — Module Entry & Facade
 * File Path: src/core/architecture/index.ts
 * Architecture Role: Public facade of the Semantic Architecture Graph engine, providing role
 *   inference, meta-architecture rules evaluation, and architectural contracts.
 * Dependencies & Triggers: Re-exports types, graph classes, and evaluators.
 * Responsibilities: Single-source entry point for the architecture governance subsystem.
 * Exit Semantics & Design Rationale: Clean declarative re-exports under 100 columns.
 */

export type {
    ArchitectureAuditOptions,
    ArchitectureAuditResult,
    SemanticArchitectureEdge,
    SemanticArchitectureNode,
    SystemTopologyRole,
} from './types';

export { DEFAULT_ALLOWED_DEPENDENCIES } from './types';

export {
    CLI_FRAMEWORK_IMPORTS,
    DATA_LAYER_IMPORTS,
    extractDomainName,
    INFRASTRUCTURE_IMPORTS,
    inferSystemTopologyRole,
} from './roleInference';

export type { RoleInferenceResult } from './roleInference';

export { SemanticArchitectureGraph } from './semanticArchitectureGraph';
export type { SourceArchitectureFile } from './semanticArchitectureGraph';

export {
    defaultMetaArchitectureEvaluator,
    META_ARCH_RULES,
    MetaArchitectureEvaluator,
} from './metaArchitectureEvaluator';

export { auditConfigDrivenArchitecture } from './config-driven-architecture';

export type {
    ConfigScanFile,
    ProjectScaleProfile,
    ConfigMaturityGrade,
    ConfigMaturityBreakdown,
    ConfigDrivenAnalysisResult,
    ConfigDrivenOptions,
} from './config-driven-architecture';
