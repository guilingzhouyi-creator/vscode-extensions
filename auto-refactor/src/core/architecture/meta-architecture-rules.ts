/**
 * Module: Core Architecture — Meta Architecture Rule Evaluators
 * File Path: src/core/architecture/meta-architecture-rules.ts
 * Architecture Role: Pure rule evaluation routines for meta-architecture checks:
 *   headless isolation, unidirectional layering, boundary encapsulation, and configuration hygiene.
 * Dependencies & Triggers: Consumes SemanticArchitectureNode, SemanticArchitectureEdge,
 *   and Issue schema.
 * Responsibilities: Emit canonical Issue models for ARCH-HDL-001,
 *   clean-layer-violation / ARCH-DIR-001, ARCH-BND-001, ARCH-CFG-001,
 *   ARCH-LEAK-001, and ARCH-GLB-001.
 * Exit Semantics & Design Rationale: Pure, deterministic AST/Graph rule evaluators.
 */

import type { Issue, Severity } from '../types';
import { SEVERITY_WARNING, SEVERITY_ERROR } from '../types';
import { ANALYZER_ARCHITECTURE } from '../scoring/dimensionLiterals';
import { FORBIDDEN_HEADLESS_IMPORTS } from '../intelligence/semanticArchitecture';
import type { SemanticArchitectureEdge, SemanticArchitectureNode } from './types';

const DEFAULT_LINE_END_COL = 80;
const FORBIDDEN_EXTERNAL_TYPES: ReadonlySet<string> = new Set([
    'express',
    'koa',
    'fastify',
    'typeorm',
    'prisma',
    'godot',
]);

function createArchitectureLocation(file: string) {
    return {
        file,
        start: { line: 1, column: 1 },
        end: { line: 1, column: DEFAULT_LINE_END_COL },
    };
}

function createMetaArchitectureIssue(
    id: string,
    rule: string,
    severity: Severity,
    message: string,
    filePath: string,
    detail: Record<string, unknown>,
    suggestion: string,
): Issue {
    return {
        id,
        analyzer: ANALYZER_ARCHITECTURE,
        rule,
        severity,
        message,
        location: createArchitectureLocation(filePath),
        detail,
        suggestion,
    };
}

/**
 * Standard rule identifiers for meta-architectural governance.
 */
export const META_ARCH_RULES = {
    HEADLESS: 'ARCH-HDL-001',
    LAYER_VIOLATION: 'clean-layer-violation',
    LAYER_INVERSION: 'ARCH-DIR-001',
    BOUNDARY_BYPASS: 'ARCH-BND-001',
    CONFIG_LEAKAGE: 'ARCH-CFG-001',
    GENERALIZATION_LEAK: 'ARCH-LEAK-001',
    GLOBAL_STATE: 'ARCH-GLB-001',
} as const;

/**
 * Evaluates headless architecture violations on a given node.
 *
 * @param node - Inspected architecture node.
 * @param issues - Out parameter collecting emitted issues.
 * @param isSelfRepo - Whether running self-check mode.
 */
export function evaluateHeadlessPurity(
    node: SemanticArchitectureNode,
    issues: Issue[],
    isSelfRepo: boolean,
): void {
    const isDomainOrCore =
        node.role === 'headless_domain_core' ||
        node.filePath.includes('/core/') ||
        node.filePath.includes('/domain/');
    if (!isDomainOrCore) {
        return;
    }

    const isCorePath = node.filePath.includes('/core/');
    const isSelfViolation = isSelfRepo && isCorePath;

    for (const imp of node.imports) {
        if (FORBIDDEN_HEADLESS_IMPORTS.has(imp)) {
            issues.push(
                createMetaArchitectureIssue(
                    `architecture:${META_ARCH_RULES.HEADLESS}:${node.filePath}:${imp}`,
                    META_ARCH_RULES.HEADLESS,
                    SEVERITY_ERROR,
                    `Headless architecture violation: core module '${node.filePath}' ` +
                        `binds directly to presentation framework '${imp}'.` +
                        (isSelfViolation ? ' [RULE-META-SELF-VIOLATION: Engine Core Breach]' : ''),
                    node.filePath,
                    {
                        role: node.role,
                        forbiddenImport: imp,
                        isHeadless: node.isHeadless,
                        isSelfViolation,
                    },
                    'Remove UI dependency from core logic; interact through headless data interfaces.',
                ),
            );
        }
    }
}

/**
 * Evaluates unidirectional clean architecture layering violations.
 *
 * @param edge - Dependency edge connecting layers.
 * @param fromNode - Origin node.
 * @param toNode - Target node.
 * @param issues - Out parameter collecting emitted issues.
 * @param isSelfRepo - Whether running self-check mode.
 */
export function evaluateLayerInversion(
    edge: SemanticArchitectureEdge,
    fromNode: SemanticArchitectureNode,
    toNode: SemanticArchitectureNode,
    issues: Issue[],
    isSelfRepo: boolean,
): void {
    const isSelfViolation = isSelfRepo && fromNode.filePath.includes('/core/');
    issues.push(
        createMetaArchitectureIssue(
            `architecture:${META_ARCH_RULES.LAYER_VIOLATION}:${edge.id}`,
            META_ARCH_RULES.LAYER_VIOLATION,
            SEVERITY_ERROR,
            `Clean architecture boundary breach: '${fromNode.role}' in '${fromNode.filePath}' ` +
                `inappropriately depends on outer '${toNode.role}' in '${toNode.filePath}'.` +
                (isSelfViolation ? ' [RULE-META-SELF-VIOLATION: Layer Inversion]' : ''),
            fromNode.filePath,
            {
                fromRole: fromNode.role,
                toRole: toNode.role,
                edgeKind: edge.edgeKind,
                isSelfViolation,
            },
            'Invert dependency by declaring interfaces in the domain and implementing in outer layers.',
        ),
    );
}

/**
 * Evaluates private domain internal boundary bypasses.
 *
 * @param edge - Cross-domain dependency edge.
 * @param fromNode - Origin node.
 * @param toNode - Target node.
 * @param issues - Out parameter collecting emitted issues.
 */
export function evaluateBoundaryBypass(
    edge: SemanticArchitectureEdge,
    fromNode: SemanticArchitectureNode,
    toNode: SemanticArchitectureNode,
    issues: Issue[],
): void {
    issues.push(
        createMetaArchitectureIssue(
            `architecture:${META_ARCH_RULES.BOUNDARY_BYPASS}:${edge.id}`,
            META_ARCH_RULES.BOUNDARY_BYPASS,
            SEVERITY_WARNING,
            `Cross-domain internal bypass: module '${fromNode.filePath}' ` +
                `bypasses domain facade to directly access internal private '${toNode.filePath}'.`,
            fromNode.filePath,
            {
                fromDomain: fromNode.domainName,
                toDomain: toNode.domainName,
                targetPath: toNode.filePath,
            },
            'Depend on public domain facades or barrel interfaces rather than private internal paths.',
        ),
    );
}

/**
 * Evaluates environment configuration leakage into pure domain models.
 *
 * @param node - Inspected architecture node.
 * @param issues - Out parameter collecting emitted issues.
 */
export function evaluateConfigLeakage(node: SemanticArchitectureNode, issues: Issue[]): void {
    if (node.role === 'headless_domain_core' && node.hasDirectConfigAccess) {
        issues.push(
            createMetaArchitectureIssue(
                `architecture:${META_ARCH_RULES.CONFIG_LEAKAGE}:${node.filePath}`,
                META_ARCH_RULES.CONFIG_LEAKAGE,
                SEVERITY_WARNING,
                `Configuration leakage: core domain '${node.filePath}' ` +
                    `accesses environment variables or disk config directly.`,
                node.filePath,
                { role: node.role },
                'Inject strongly-typed configuration parameters through constructor or options object.',
            ),
        );
    }
}

/**
 * Evaluates shared mutable global state coupling.
 *
 * @param node - Inspected architecture node.
 * @param issues - Out parameter collecting emitted issues.
 */
export function evaluateGlobalMutableState(node: SemanticArchitectureNode, issues: Issue[]): void {
    if (node.hasGlobalMutableState && node.role !== 'configuration') {
        issues.push(
            createMetaArchitectureIssue(
                `architecture:${META_ARCH_RULES.GLOBAL_STATE}:${node.filePath}`,
                META_ARCH_RULES.GLOBAL_STATE,
                SEVERITY_WARNING,
                `Implicit shared mutable state in '${node.filePath}'; couples modules across boundaries.`,
                node.filePath,
                { role: node.role },
                'Encapsulate mutable state in scoped instances and pass via dependency injection.',
            ),
        );
    }
}

/**
 * Evaluates framework generalization leaks in pure core logic.
 *
 * @param node - Inspected architecture node.
 * @param issues - Out parameter collecting emitted issues.
 */
export function evaluateGeneralizationLeak(node: SemanticArchitectureNode, issues: Issue[]): void {
    if (node.role !== 'headless_domain_core') {
        return;
    }
    for (const imp of node.imports) {
        if (FORBIDDEN_EXTERNAL_TYPES.has(imp.toLowerCase())) {
            issues.push(
                createMetaArchitectureIssue(
                    `architecture:${META_ARCH_RULES.GENERALIZATION_LEAK}:${node.filePath}:${imp}`,
                    META_ARCH_RULES.GENERALIZATION_LEAK,
                    SEVERITY_WARNING,
                    `Generalization leak: domain core '${node.filePath}' ` +
                        `directly imports external framework or driver '${imp}'.`,
                    node.filePath,
                    { role: node.role, leakedImport: imp },
                    'Isolate domain entities to pure native types; delegate frameworks to adapters.',
                ),
            );
        }
    }
}
