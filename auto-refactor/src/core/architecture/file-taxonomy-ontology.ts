/**
 * Module: Core Architecture — Multi-Dimensional File Taxonomy & Role Ontology Engine
 * File Path: src/core/architecture/file-taxonomy-ontology.ts
 * Architecture Role: High-precision architectural role classification and boundary deviation
 *   evaluator that classifies source files across multi-signal behavioral dimensions.
 * Dependencies & Triggers: Consumes Issue schema and dimensionLiterals; invoked during
 *   architecture post-scan and semantic graph construction passes.
 * Responsibilities: Evaluate 8 canonical file ontology roles (business_domain_module,
 *   shared_capability_module, shared_library, infrastructure_library, algorithm_operator_library,
 *   constant_registry_library, rule_policy_module, resource_pool_component); detect
 *   pseudo-shared libraries (ARCH-ROL-001) and domain utility creep (ARCH-ROL-002).
 * Exit Semantics & Design Rationale: Deterministic multi-criteria scoring without brittle path
 *   assumptions. Rejects superficial size fallacies to safeguard clean architectural layers.
 */

import type { Issue } from '../types';
import { SEVERITY_WARNING } from '../types';
import {
    ANALYZER_ARCHITECTURE,
    RULE_ARCH_ROL_001,
    RULE_ARCH_ROL_002,
} from '../scoring/dimensionLiterals';

/**
 * 8 Canonical File Taxonomy Ontology Roles.
 */
export type FileOntologyRole =
    | 'business_domain_module'
    | 'shared_capability_module'
    | 'shared_library'
    | 'infrastructure_library'
    | 'algorithm_operator_library'
    | 'constant_registry_library'
    | 'rule_policy_module'
    | 'resource_pool_component';

const MAX_REGISTRY_LOC = 150;
const MIN_FAN_IN_SHARED = 3;
const MIN_SYMBOLS_SHARED_CAPABILITY = 3;
const MAX_UTILITY_CREEP_EXPORTS = 8;
const DEFAULT_ISSUE_END_COLUMN = 80;

const ROLE_CONSTANT_REGISTRY: FileOntologyRole = 'constant_registry_library';
const ROLE_RESOURCE_POOL: FileOntologyRole = 'resource_pool_component';
const ROLE_RULE_POLICY: FileOntologyRole = 'rule_policy_module';
const ROLE_ALGORITHM_OPERATOR: FileOntologyRole = 'algorithm_operator_library';
const ROLE_INFRASTRUCTURE: FileOntologyRole = 'infrastructure_library';
const ROLE_SHARED_LIBRARY: FileOntologyRole = 'shared_library';
const ROLE_SHARED_CAPABILITY: FileOntologyRole = 'shared_capability_module';
const ROLE_BUSINESS_DOMAIN: FileOntologyRole = 'business_domain_module';

/**
 * Multi-dimensional metric vector for a source file.
 */
export interface FileBehavioralMetrics {
    filePath: string;
    loc: number;
    codeDensity: number;
    exportedSymbolCount: number;
    fanInCount: number;
    crossDomainFanIn: number;
    fanOutCount: number;
    isStateful: boolean;
    hasGlobalMutableState: boolean;
    pureFunctionRatio: number;
    hasIoOrSystemImports: boolean;
    hasPoolOrBufferSymbols: boolean;
    hasRuleOrPolicySymbols: boolean;
    hasConstantOrEnumOnly: boolean;
    hasMathOrAlgoKeywords: boolean;
    domainName: string;
}

/**
 * Classification outcome with structural confidence and supporting rationale.
 */
export interface FileOntologyClassification {
    filePath: string;
    inferredRole: FileOntologyRole;
    confidence: number;
    reasons: string[];
    isPseudoSharedLibrary: boolean;
    hasUnboundedUtilityCreep: boolean;
}

/**
 * Result of whole-repository file taxonomy audit.
 */
export interface FileTaxonomyAuditResult {
    classifications: Map<string, FileOntologyClassification>;
    roleDistribution: Record<FileOntologyRole, number>;
    issues: Issue[];
}

interface RoleMatchResult {
    readonly role: FileOntologyRole;
    readonly reason: string;
    readonly confidence: number;
}

function isConstantRegistry(metrics: FileBehavioralMetrics): boolean {
    return (
        metrics.hasConstantOrEnumOnly ||
        (metrics.pureFunctionRatio === 1.0 &&
            metrics.loc <= MAX_REGISTRY_LOC &&
            !metrics.hasMathOrAlgoKeywords &&
            !metrics.hasRuleOrPolicySymbols &&
            !metrics.isStateful)
    );
}

function isAlgorithmOperator(metrics: FileBehavioralMetrics): boolean {
    return (
        metrics.pureFunctionRatio >= 0.85 &&
        metrics.hasMathOrAlgoKeywords &&
        !metrics.hasIoOrSystemImports &&
        !metrics.isStateful
    );
}

function matchSpecializedLibraryRole(metrics: FileBehavioralMetrics): RoleMatchResult | null {
    if (isConstantRegistry(metrics)) {
        return {
            role: ROLE_CONSTANT_REGISTRY,
            reason: 'Primary content consists of immutable constants, enum registries, or type identifiers',
            confidence: 0.95,
        };
    }
    if (metrics.hasPoolOrBufferSymbols) {
        return {
            role: ROLE_RESOURCE_POOL,
            reason: 'Manages reusable object, buffer, connection, or cache pool instances with lifecycle reset hooks',
            confidence: 0.92,
        };
    }
    if (metrics.hasRuleOrPolicySymbols) {
        return {
            role: ROLE_RULE_POLICY,
            reason: 'Declares declarative rule definitions, policy constraints, or validation criteria matrices',
            confidence: 0.9,
        };
    }
    if (isAlgorithmOperator(metrics)) {
        return {
            role: ROLE_ALGORITHM_OPERATOR,
            reason: 'High concentration of pure mathematical, numerical, geometrical, or statistical transformations',
            confidence: 0.93,
        };
    }
    if (metrics.hasIoOrSystemImports) {
        return {
            role: ROLE_INFRASTRUCTURE,
            reason: 'Directly interacts with OS, network sockets, physical I/O, or low-level platform drivers',
            confidence: 0.9,
        };
    }
    return null;
}

function matchSharedOrDomainRole(metrics: FileBehavioralMetrics): RoleMatchResult {
    if (metrics.crossDomainFanIn >= MIN_FAN_IN_SHARED && !metrics.isStateful && metrics.pureFunctionRatio >= 0.7) {
        return {
            role: ROLE_SHARED_LIBRARY,
            reason: 'High cross-domain reuse with stable stateless contract and low domain entity coupling',
            confidence: 0.88,
        };
    }
    if (
        metrics.crossDomainFanIn >= 2 &&
        metrics.exportedSymbolCount >= MIN_SYMBOLS_SHARED_CAPABILITY &&
        !metrics.hasGlobalMutableState
    ) {
        return {
            role: ROLE_SHARED_CAPABILITY,
            reason: 'Provides high-level cross-domain reusable capability or composite workflow coordination',
            confidence: 0.85,
        };
    }
    return {
        role: ROLE_BUSINESS_DOMAIN,
        reason: 'Cohesive logic encapsulated within specific business domain boundary with low cross-domain leakage',
        confidence: 0.8,
    };
}

/**
 * Classifies a file into one of the 8 canonical ontology roles based on behavioral signals.
 *
 * @param metrics - Multi-dimensional metric vector.
 * @returns Classification with confidence score and reasons.
 */
export function classifyFileOntology(metrics: FileBehavioralMetrics): FileOntologyClassification {
    const match = matchSpecializedLibraryRole(metrics) ?? matchSharedOrDomainRole(metrics);

    // Boundary Deviation Audits:
    // Deviation 1: Pseudo-Shared Library: High cross-domain fan-in with mutable state or low purity
    const isPseudoSharedLibrary =
        metrics.crossDomainFanIn >= 2 &&
        (metrics.isStateful || metrics.hasGlobalMutableState) &&
        match.role !== ROLE_RESOURCE_POOL;

    // Deviation 2: Unbounded Utility Creep: Business module directly exporting generic helpers
    const hasUnboundedUtilityCreep =
        match.role === ROLE_BUSINESS_DOMAIN &&
        metrics.hasMathOrAlgoKeywords &&
        metrics.exportedSymbolCount >= MAX_UTILITY_CREEP_EXPORTS &&
        metrics.pureFunctionRatio >= 0.75;

    return {
        filePath: metrics.filePath,
        inferredRole: match.role,
        confidence: match.confidence,
        reasons: [match.reason],
        isPseudoSharedLibrary,
        hasUnboundedUtilityCreep,
    };
}

interface RoleDeviationIssueParams {
    readonly rule: typeof RULE_ARCH_ROL_001 | typeof RULE_ARCH_ROL_002;
    readonly filePath: string;
    readonly message: string;
    readonly detail: Record<string, unknown>;
    readonly suggestion: string;
}

function createRoleDeviationIssue(params: RoleDeviationIssueParams): Issue {
    const { rule, filePath, message, detail, suggestion } = params;
    return {
        id: `architecture:${rule}:${filePath}:1`,
        analyzer: ANALYZER_ARCHITECTURE,
        rule,
        severity: SEVERITY_WARNING,
        message,
        location: {
            file: filePath,
            start: { line: 1, column: 1 },
            end: { line: 1, column: DEFAULT_ISSUE_END_COLUMN },
        },
        detail,
        suggestion,
    };
}

function collectTaxonomyIssues(
    fileMetric: FileBehavioralMetrics,
    classificationResult: FileOntologyClassification,
    issues: Issue[],
): void {
    if (classificationResult.isPseudoSharedLibrary) {
        issues.push(
            createRoleDeviationIssue({
                rule: RULE_ARCH_ROL_001,
                filePath: fileMetric.filePath,
                message:
                    `Pseudo-shared library boundary violation: "${fileMetric.filePath}" is consumed by ` +
                    `${fileMetric.crossDomainFanIn} distinct domains as a shared library, but holds mutable internal state.`,
                detail: {
                    inferredRole: classificationResult.inferredRole,
                    crossDomainFanIn: fileMetric.crossDomainFanIn,
                    isStateful: fileMetric.isStateful,
                    hasGlobalMutableState: fileMetric.hasGlobalMutableState,
                },
                suggestion:
                    'Refactor stateful logic into a domain service and extract only pure interfaces into the shared library.',
            }),
        );
    }

    if (classificationResult.hasUnboundedUtilityCreep) {
        issues.push(
            createRoleDeviationIssue({
                rule: RULE_ARCH_ROL_002,
                filePath: fileMetric.filePath,
                message:
                    `Domain module utility creep: "${fileMetric.filePath}" is classified as a business domain module ` +
                    `but bears ${fileMetric.exportedSymbolCount} unbounded generic utility or mathematical exports.`,
                detail: {
                    domainName: fileMetric.domainName,
                    exportedCount: fileMetric.exportedSymbolCount,
                    pureRatio: fileMetric.pureFunctionRatio,
                },
                suggestion:
                    'Relocate generic utilities to an authoritative algorithm/operator library to keep domain modules focused.',
            }),
        );
    }
}

/**
 * Audits repository-wide file taxonomy and identifies architectural boundary violations.
 *
 * @param files - Array of behavioral metrics for all source files.
 * @returns Full taxonomy audit result including emitted issues.
 */
export function auditFileTaxonomy(files: FileBehavioralMetrics[]): FileTaxonomyAuditResult {
    const classifications = new Map<string, FileOntologyClassification>();
    const roleDistribution: Record<FileOntologyRole, number> = {
        business_domain_module: 0,
        shared_capability_module: 0,
        shared_library: 0,
        infrastructure_library: 0,
        algorithm_operator_library: 0,
        constant_registry_library: 0,
        rule_policy_module: 0,
        resource_pool_component: 0,
    };
    const issues: Issue[] = [];

    for (const fileMetric of files) {
        const taxonomyResult = classifyFileOntology(fileMetric);
        classifications.set(fileMetric.filePath, taxonomyResult);
        roleDistribution[taxonomyResult.inferredRole]++;
        collectTaxonomyIssues(fileMetric, taxonomyResult, issues);
    }

    return {
        classifications,
        roleDistribution,
        issues,
    };
}
