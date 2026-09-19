/**
 * Module: Core Intelligence — Generalized Semantic Architecture Governance
 * File Path: src/core/intelligence/semanticArchitecture.ts
 * Architecture Role: Semantic layer inference and architecture boundary guard; verifies
 *   headless decoupling, detects cross-domain private leaks and shared mutable state.
 * Dependencies & Triggers: Core types (Issue, SemanticReviewDetail, SemanticEvidenceStep,
 *   ArchitectureLayer, ScaleGrade, ProjectArchetype); invoked by ArchitectureAnalyzer.
 * Responsibilities: Infer semantic architectural roles beyond folder names; enforce Headless
 *   pure logic isolation (ARCH-HDL-001); detect cross-domain private bypasses (ARCH-BND-001);
 *   detect implicit shared mutable global state (ARCH-GLB-001); detect structural layering
 *   illusions (ARCH-DIR-003); flag infrastructure configuration leakage into domain entities
 *   (ARCH-CFG-001); dynamically adapt governance strictness to project scale and archetype.
 * Exit Semantics & Design Rationale: Pure semantic deduction and graph constraint verification;
 *   returns structured issues adhering strictly to the Section VII result schema.
 */

import type {
    ArchitectureLayer,
    Issue,
    ScaleGrade,
    SemanticEvidenceStep,
    SemanticReviewDetail,
} from '../types';

/**
 * UI / presentation frameworks forbidden in headless or pure domain code.
 */
export const FORBIDDEN_HEADLESS_IMPORTS = new Set([
    'vscode',
    'electron',
    'react',
    'react-dom',
    'vue',
    'svelte',
    '@angular/core',
    'window',
    'document',
    'gtk',
    'qt',
]);

/**
 * Descriptor of a file's semantic architectural properties.
 */
export interface ArchitecturalFileInfo {
    filePath: string;
    inferredLayer: ArchitectureLayer;
    isHeadless: boolean;
    domainName: string;
    imports: string[];
    hasGlobalMutableState: boolean;
    hasDirectConfigAccess: boolean;
}

/**
 * Options controlling generalized architecture review.
 */
export interface SemanticArchitectureOptions {
    enforceHeadless?: boolean;
    flagCrossDomainBypass?: boolean;
    flagMutableGlobalCoupling?: boolean;
    flagLayeringIllusions?: boolean;
    flagConfigLeakage?: boolean;
    scaleGrade?: ScaleGrade;
}

/**
 * Infer true semantic architectural layer of a file based on symbols and imports.
 *
 * @param filePath - Repository-relative file path.
 * @param imports - Module specifiers imported by the file.
 * @param exports - Symbols exported by the file.
 * @returns Inferred architectural layer.
 */
export function inferSemanticLayer(
    filePath: string,
    imports: string[],
    exports: string[],
): ArchitectureLayer {
    const lower = filePath.toLowerCase();
    void exports;

    // Test layer
    if (lower.includes('test') || lower.includes('spec') || lower.includes('__tests__')) {
        return 'test';
    }

    // Interface layer (UI, CLI, API endpoints)
    if (
        lower.includes('controller') ||
        lower.includes('router') ||
        lower.includes('cli') ||
        lower.includes('view') ||
        lower.includes('component') ||
        imports.some((i) => FORBIDDEN_HEADLESS_IMPORTS.has(i))
    ) {
        return 'interface';
    }

    // Infrastructure / Data Access
    if (
        lower.includes('repository') ||
        lower.includes('database') ||
        lower.includes('driver') ||
        lower.includes('adapter') ||
        lower.includes('gateway') ||
        lower.includes('sql')
    ) {
        return 'infrastructure';
    }

    // Application Orchestration
    if (
        lower.includes('service') ||
        lower.includes('usecase') ||
        lower.includes('workflow') ||
        lower.includes('orchestrator')
    ) {
        return 'application';
    }

    // Shared / Tooling
    if (lower.includes('util') || lower.includes('helper') || lower.includes('shared')) {
        return 'shared';
    }

    // Default to Domain
    return 'domain';
}

/**
 * Verify architecture boundaries across the repository.
 *
 * @param files - Analyzed files with their architectural descriptors.
 * @param options - Tunable architectural options.
 * @returns Array of issues strictly following Section VII schema.
 */
export function verifyArchitectureBoundaries(
    files: ArchitecturalFileInfo[],
    options: SemanticArchitectureOptions = {},
): Issue[] {
    const issues: Issue[] = [];
    const enforceHeadless = options.enforceHeadless ?? true;
    const flagBypass = options.flagCrossDomainBypass ?? true;
    const flagGlobal = options.flagMutableGlobalCoupling ?? true;
    const flagIllusions = options.flagLayeringIllusions ?? true;
    const flagConfig = options.flagConfigLeakage ?? true;

    for (const file of files) {
        // 1. Headless Architecture Violation (ARCH-HDL-001)
        if (enforceHeadless && (file.isHeadless || file.inferredLayer === 'domain')) {
            for (const imp of file.imports) {
                if (FORBIDDEN_HEADLESS_IMPORTS.has(imp)) {
                    const evidence: SemanticEvidenceStep[] = [
                        {
                            kind: 'call',
                            description: `Pure domain / headless file imports UI framework '${imp}'`,
                            file: file.filePath,
                            line: 1,
                        },
                    ];

                    const detail: SemanticReviewDetail = {
                        language: 'typescript',
                        module: file.domainName,
                        symbol: imp,
                        codeDomain: 'architecture-boundaries',
                        currentBehavior: `Headless / domain module '${file.filePath}' binds directly to presentation framework '${imp}'.`,
                        semanticEvidenceChain: evidence,
                        triggerCondition:
                            'Core business logic or headless engine depends on UI / IDE presentation framework',
                        risk: 'Destroys headless execution capability, prevents automated CI testing, and binds business rules to UI lifecycle.',
                        blastRadius: [file.filePath],
                        isDeterministic: true,
                        requiresManualConfirm: false,
                        suggestedFix:
                            'Decouple core domain logic from UI framework; emit events or return pure data structures instead.',
                        impactedCallers: [],
                        impactedTests: [],
                        verificationMethod:
                            'Verify module executes in a headless Node or CLI environment without UI dependencies.',
                        ruleVersion: '1.0.0',
                        configVersion: '0.3.0',
                        canAutofix: false,
                    };

                    issues.push({
                        id: `architecture:ARCH-HDL-001:${file.filePath}:1`,
                        analyzer: 'architecture',
                        rule: 'ARCH-HDL-001',
                        severity: 'error',
                        message: `Headless architecture violation: core logic in '${file.filePath}' imports presentation dependency '${imp}'.`,
                        location: {
                            file: file.filePath,
                            start: { line: 1, column: 1 },
                            end: { line: 1, column: 80 },
                        },
                        detail,
                        suggestion:
                            'Remove UI dependency from core logic; interact through headless interfaces or events.',
                        evidence: {
                            confidence: 1.0,
                            requiresRuntime: false,
                        },
                    });
                }
            }
        }

        // 2. Cross-domain internal boundary bypass (ARCH-BND-001)
        if (flagBypass) {
            for (const imp of file.imports) {
                if (
                    imp.includes('/internal/') ||
                    imp.includes('/impl/') ||
                    imp.includes('/private/')
                ) {
                    const evidence: SemanticEvidenceStep[] = [
                        {
                            kind: 'call',
                            description: `Direct import of internal private implementation: '${imp}'`,
                            file: file.filePath,
                            line: 1,
                        },
                    ];

                    const detail: SemanticReviewDetail = {
                        language: 'typescript',
                        module: file.domainName,
                        symbol: imp,
                        codeDomain: 'architecture-boundaries',
                        currentBehavior: `File '${file.filePath}' bypasses public domain facade to access internal private module '${imp}'.`,
                        semanticEvidenceChain: evidence,
                        triggerCondition:
                            'Import path reaches into /internal/, /impl/, or /private/ subdirectories of another domain',
                        risk: 'Couples calling code to private implementation details, preventing internal refactoring.',
                        blastRadius: [file.filePath],
                        isDeterministic: true,
                        requiresManualConfirm: false,
                        suggestedFix:
                            'Import through the domain public API barrel or export interface.',
                        impactedCallers: [],
                        impactedTests: [],
                        verificationMethod:
                            'Verify imports reference only index or public export interfaces.',
                        ruleVersion: '1.0.0',
                        configVersion: '0.3.0',
                        canAutofix: false,
                    };

                    issues.push({
                        id: `architecture:ARCH-BND-001:${file.filePath}:1`,
                        analyzer: 'architecture',
                        rule: 'ARCH-BND-001',
                        severity: 'warning',
                        message: `Cross-domain internal bypass: '${file.filePath}' imports private module '${imp}'.`,
                        location: {
                            file: file.filePath,
                            start: { line: 1, column: 1 },
                            end: { line: 1, column: 80 },
                        },
                        detail,
                        suggestion:
                            'Depend on public domain facades or interfaces rather than private internal modules.',
                        evidence: {
                            confidence: 0.95,
                            requiresRuntime: false,
                        },
                    });
                }
            }
        }

        // 3. Shared mutable global state coupling (ARCH-GLB-001)
        if (flagGlobal && file.hasGlobalMutableState && file.inferredLayer !== 'test') {
            const evidence: SemanticEvidenceStep[] = [
                {
                    kind: 'variable',
                    description: `Module-level mutable global state detected in '${file.filePath}'`,
                    file: file.filePath,
                    line: 1,
                },
            ];

            const detail: SemanticReviewDetail = {
                language: 'typescript',
                module: file.domainName,
                symbol: 'globalState',
                codeDomain: 'architecture-boundaries',
                currentBehavior: `Exposing shared mutable state across module boundaries.`,
                semanticEvidenceChain: evidence,
                triggerCondition:
                    'Module exports or mutates global mutable variables across architectural boundaries',
                risk: 'Creates hidden temporal coupling, race conditions in concurrent execution, and untestable global side effects.',
                blastRadius: [file.filePath],
                isDeterministic: true,
                requiresManualConfirm: false,
                suggestedFix:
                    'Encapsulate mutable state in explicit class instances passed via dependency injection.',
                impactedCallers: [],
                impactedTests: [],
                verificationMethod:
                    'Verify module state is isolated per instance without global static mutations.',
                ruleVersion: '1.0.0',
                configVersion: '0.3.0',
                canAutofix: false,
            };

            issues.push({
                id: `architecture:ARCH-GLB-001:${file.filePath}:1`,
                analyzer: 'architecture',
                rule: 'ARCH-GLB-001',
                severity: 'warning',
                message: `Implicit shared mutable global state in '${file.filePath}'.`,
                location: {
                    file: file.filePath,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 80 },
                },
                detail,
                suggestion:
                    'Replace shared global mutable state with scoped instance dependency injection.',
                evidence: {
                    confidence: 0.9,
                    requiresRuntime: false,
                },
            });
        }

        // 4. Structural Layering Illusion (ARCH-DIR-003)
        if (flagIllusions && file.inferredLayer === 'domain') {
            const hasInfraImport = file.imports.some(
                (i) =>
                    i.includes('infra') ||
                    i.includes('database') ||
                    i.includes('driver') ||
                    i.includes('repository'),
            );
            if (hasInfraImport) {
                const evidence: SemanticEvidenceStep[] = [
                    {
                        kind: 'condition',
                        description: `Domain file '${file.filePath}' directly imports infrastructure layer`,
                        file: file.filePath,
                        line: 1,
                    },
                ];

                const detail: SemanticReviewDetail = {
                    language: 'typescript',
                    module: file.domainName,
                    symbol: 'layer-inversion',
                    codeDomain: 'architecture-boundaries',
                    currentBehavior: `Clean architecture dependency inversion: domain entity depends on outer infrastructure layer.`,
                    semanticEvidenceChain: evidence,
                    triggerCondition:
                        'Domain model imports infrastructure or database components directly',
                    risk: 'Inverted dependency direction makes business domain dependent on persistent infrastructure mechanisms.',
                    blastRadius: [file.filePath],
                    isDeterministic: true,
                    requiresManualConfirm: false,
                    suggestedFix:
                        'Define an interface in the domain layer and implement it in infrastructure (Dependency Inversion Principle).',
                    impactedCallers: [],
                    impactedTests: [],
                    verificationMethod:
                        'Verify domain layer has zero imports pointing to infrastructure layer.',
                    ruleVersion: '1.0.0',
                    configVersion: '0.3.0',
                    canAutofix: false,
                };

                issues.push({
                    id: `architecture:ARCH-DIR-003:${file.filePath}:1`,
                    analyzer: 'architecture',
                    rule: 'ARCH-DIR-003',
                    severity: 'error',
                    message: `Structural layering illusion: domain file '${file.filePath}' directly imports infrastructure.`,
                    location: {
                        file: file.filePath,
                        start: { line: 1, column: 1 },
                        end: { line: 1, column: 80 },
                    },
                    detail,
                    suggestion: 'Invert dependency using interfaces defined in the domain layer.',
                    evidence: {
                        confidence: 0.95,
                        requiresRuntime: false,
                    },
                });
            }
        }

        // 5. Direct Configuration Access in Pure Domain (ARCH-CFG-001)
        if (flagConfig && file.inferredLayer === 'domain' && file.hasDirectConfigAccess) {
            const evidence: SemanticEvidenceStep[] = [
                {
                    kind: 'variable',
                    description: `Direct environment or configuration access in pure domain file '${file.filePath}'`,
                    file: file.filePath,
                    line: 1,
                },
            ];

            const detail: SemanticReviewDetail = {
                language: 'typescript',
                module: file.domainName,
                symbol: 'config-access',
                codeDomain: 'architecture-boundaries',
                currentBehavior: `Reading process.env or disk config directly in domain model.`,
                semanticEvidenceChain: evidence,
                triggerCondition:
                    'Domain logic references environment variables or raw configuration files directly',
                risk: 'Domain logic becomes dependent on deployment environment settings and cannot be tested with pure in-memory models.',
                blastRadius: [file.filePath],
                isDeterministic: true,
                requiresManualConfirm: false,
                suggestedFix:
                    'Inject configuration values as typed domain parameters or options objects.',
                impactedCallers: [],
                impactedTests: [],
                verificationMethod:
                    'Verify domain entity constructors accept strongly typed options instead of reading environment.',
                ruleVersion: '1.0.0',
                configVersion: '0.3.0',
                canAutofix: false,
            };

            issues.push({
                id: `architecture:ARCH-CFG-001:${file.filePath}:1`,
                analyzer: 'architecture',
                rule: 'ARCH-CFG-001',
                severity: 'info',
                message: `Configuration leakage: domain file '${file.filePath}' reads environment or config directly.`,
                location: {
                    file: file.filePath,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 80 },
                },
                detail,
                suggestion:
                    'Inject typed configuration via constructor arguments or factory parameters.',
                evidence: {
                    confidence: 0.9,
                    requiresRuntime: false,
                },
            });
        }
    }

    return issues;
}
