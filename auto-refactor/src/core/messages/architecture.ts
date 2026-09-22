/**
 * Module: Core Messages - Clean Architecture & DDD Boundary Diagnostics
 * File Path: src/core/messages/architecture.ts
 * Architecture Role: Static descriptor catalog for the architecture analyzer; supplies standard
 *   English messages conforming to Clean Architecture and Domain-Driven Design principles.
 * Dependencies & Triggers: Imports only DiagnosticDescriptor from ./types; loaded when the
 *   architecture analyzer or messages barrel is imported. Its factories run while the analyzer
 *   emits ARCH-DIR and ARCH-LEAK issues during CLI, CI, post-scan, or daemon runs.
 * Responsibilities: Export descriptor factories for DOMAIN_INVERSION_BREACH,
 *   APPLICATION_LAYER_BREACH, SKIP_LAYER_PENETRATION, DOMAIN_FRAMEWORK_LEAK, and
 *   PUBLIC_DTO_CREDENTIAL_LEAK, each returning message, suggestion, rationale, and risk text.
 * Exit Semantics & Design Rationale: Pure object construction with no I/O or thrown errors; every
 *   call returns a deterministic immutable descriptor whose text never depends on timing or
 *   shared state. One leaf catalog keeps rule codes and remediation text aligned across analyzer,
 *   API, and reporting consumers instead of duplicating architecture prose.
 */

import type { DiagnosticDescriptor } from './types';

/** Risk tier for architecture boundary breaches that must render as High severity. */
const RISK_HIGH = 'High';

/** Risk tier for architecture boundary breaches that render as Medium severity. */
const RISK_MEDIUM = 'Medium';

/**
 * Architecture-rule diagnostic descriptor catalog.
 *
 * Supplies the ARCH-DIR and ARCH-LEAK message factories consumed by the architecture
 * analyzer and report assemblers. Each factory is a pure synchronous mapper from layer
 * names, import specifiers, or field names to a fresh DiagnosticDescriptor containing
 * `message`, `suggestion`, `rationale`, and `risk`. Inputs are interpolated verbatim and
 * never validated, so callers must pass non-empty context strings. No I/O or shared state
 * is touched, and valid calls cannot throw.
 */
export const ArchitectureMessages = {
    // ARCH-DIR-001: Domain dependency inversion breach
    /**
     * Build the ARCH-DIR-001 descriptor for a domain layer that depends on an outer layer.
     *
     * @param fromLayer - Label of the layer that owns the dependency; kept for rule
     *   symmetry and not interpolated into the current message.
     * @param toLayer - Forbidden outer layer that the domain dependency reaches.
     * @param targetPath - Import specifier or module path that crosses the boundary.
     * @returns Fresh descriptor with High risk and dependency-inversion remediation text.
     */
    DOMAIN_INVERSION_BREACH: (
        fromLayer: string,
        toLayer: string,
        targetPath: string,
    ): DiagnosticDescriptor => ({
        message: `Architectural dependency inversion violation: Domain model layer inversely depends on outer layer [${toLayer}] ('${targetPath}')`,
        suggestion:
            'Define domain abstractions/interfaces within the domain layer and inject concrete implementations from outer layers',
        rationale:
            'The Domain layer must remain pure and free from dependencies on presentation, application use cases, or infrastructure implementations.',
        risk: RISK_HIGH,
    }),

    // ARCH-DIR-001: Application depends on Interface
    /**
     * Build the ARCH-DIR-001 descriptor for an application use-case layer that reaches into
     * the presentation or interface layer.
     *
     * @param toLayer - Presentation or interface layer name targeted by the use case.
     * @param targetPath - Import specifier or module path that crosses the layer boundary.
     * @returns Fresh descriptor with High risk and application-layer remediation text.
     */
    APPLICATION_LAYER_BREACH: (toLayer: string, targetPath: string): DiagnosticDescriptor => ({
        message: `Architectural layering violation: Application use-case layer depends on presentation/interface layer [${toLayer}] ('${targetPath}')`,
        suggestion:
            'Keep application use cases independent of concrete UI, controller, or presentation models',
        rationale:
            'Use case orchestration must not depend on user-facing controllers or client delivery mechanisms.',
        risk: RISK_HIGH,
    }),

    // ARCH-DIR-002: Skip-layer penetration (Interface -> Infrastructure)
    /**
     * Build the ARCH-DIR-002 descriptor for an interface that bypasses application use cases
     * and depends directly on infrastructure.
     *
     * @param toLayer - Infrastructure layer name reached directly from the interface.
     * @param targetPath - Import specifier or module path that skips the application layer.
     * @returns Fresh descriptor with Medium risk and skip-layer remediation text.
     */
    SKIP_LAYER_PENETRATION: (toLayer: string, targetPath: string): DiagnosticDescriptor => ({
        message: `Architectural skip-layer violation: Interface layer bypasses Application layer and directly depends on Infrastructure [${toLayer}] ('${targetPath}')`,
        suggestion:
            'Route interface requests through application use cases or services rather than directly querying infrastructure adapters',
        rationale:
            'Bypassing use-case orchestration creates tight coupling between presentation and database/network facilities.',
        risk: RISK_MEDIUM,
    }),

    // ARCH-LEAK-001: External framework/DB driver leakage in Domain
    /**
     * Build the ARCH-LEAK-001 descriptor for a framework or database driver imported by the
     * domain layer.
     *
     * @param specifier - External framework, driver, or UI dependency found in the domain.
     * @returns Fresh descriptor with High risk and port/adapter remediation text.
     */
    DOMAIN_FRAMEWORK_LEAK: (specifier: string): DiagnosticDescriptor => ({
        message: `Domain model layer leaks external infrastructure or UI framework implementation: '${specifier}'`,
        suggestion:
            'Remove framework-specific imports from the domain layer; represent technical capabilities via domain repository/gateway ports',
        rationale:
            'Domain models must remain technology-agnostic to enable portable business rules, isolated unit testing, and maintainability.',
        risk: RISK_HIGH,
    }),

    // ARCH-LEAK-002: Public DTO / Contract credential exposure
    /**
     * Build the ARCH-LEAK-002 descriptor for a public DTO or contract that exposes a
     * credential-bearing field.
     *
     * @param field - Sensitive field name detected on the public contract.
     * @returns Fresh descriptor with High risk and contract-sanitization guidance.
     */
    PUBLIC_DTO_CREDENTIAL_LEAK: (field: string): DiagnosticDescriptor => ({
        message: `Architectural data security breach: Public contract/DTO exposes sensitive credential field '${field}'`,
        suggestion:
            'Strip sensitive credentials from public response contracts or sanitize models using Pick/Omit and dedicated presentation view mappers',
        rationale:
            'Exposing authentication secrets or password hashes in external data transfer objects risks credential theft and unauthorized access.',
        risk: RISK_HIGH,
    }),

    // ARCH-DEC-002: Direct AST parser coupling in domain or analyzer
    /**
     * Build the ARCH-DEC-002 descriptor for direct concrete AST parser coupling.
     *
     * @param file - File path containing the coupling.
     * @param specifier - Concrete parser module name.
     * @returns Fresh descriptor with Medium risk and adapter extraction guidance.
     */
    POLYGLOT_PARSER_COUPLING: (file: string, specifier: string): DiagnosticDescriptor => ({
        message: `Direct AST parser coupling: '${file}' directly couples to concrete parser '${specifier}'.`,
        suggestion:
            'Extract polyglot AST parsing to src/core/semantic/adapters/' +
            ' and interact through NormalizedNode polymorphic interface.',
        rationale:
            'Analyzers and domain services must remain decoupled from specific' +
            ' AST parser implementations to facilitate modular evolution.',
        risk: RISK_MEDIUM,
    }),
} as const;
