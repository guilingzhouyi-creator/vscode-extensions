/**
 * Module: Core Intelligence — Architecture Boundary Checks
 * File Path: src/core/intelligence/architectureBoundaryChecks.ts
 * Architecture Role: Per-file boundary checks used by the semantic architecture verifier.
 * Dependencies & Triggers: ../types, ../semanticTypes, ./semanticArchitecture (file descriptor
 *   and the forbidden-headless set); invoked by verifyArchitectureBoundaries per analyzed file.
 * Responsibilities: Report headless violations, cross-domain bypasses, mutable global coupling,
 *   layering illusions, and configuration leakage as structured architecture issues.
 * Exit Semantics & Design Rationale: Pure per-file checks that only push into the caller issue
 *   accumulator and never throw; traversal and option defaults stay with the caller.
 */
import type { Issue } from '../types';
import { SEVERITY_INFO, SEVERITY_WARNING, SEVERITY_ERROR } from '../types';
import type { SemanticEvidenceStep, SemanticReviewDetail } from '../semanticTypes';
import type { ArchitecturalFileInfo } from './semanticArchitecture';
import { FORBIDDEN_HEADLESS_IMPORTS } from './semanticArchitecture';
/** Evidence-chain step kind for a call site. */
const KIND_CALL = 'call';
/** Evidence-chain step kind for a mutable binding. */
const KIND_VARIABLE = 'variable';
/** Evidence-chain step kind for a guarded condition. */
const KIND_CONDITION = 'condition';
/** Rule ids owned by this module. */
const RULE_ARCH_HDL_001 = 'ARCH-HDL-001';
const RULE_ARCH_BND_001 = 'ARCH-BND-001';
const RULE_ARCH_GLB_001 = 'ARCH-GLB-001';
const RULE_ARCH_DIR_003 = 'ARCH-DIR-003';
const RULE_ARCH_CFG_001 = 'ARCH-CFG-001';

/**
 * Report whether an import reaches into a private internal subdirectory.
 *
 * @param spec - Import specifier being inspected.
 * @returns True when the specifier targets /internal/, /impl/, or /private/.
 */
function isPrivateInternalImport(spec: string): boolean {
    return spec.includes('/internal/') || spec.includes('/impl/') || spec.includes('/private/');
}

/** Analyzer id owning every architecture rule in this module. */
const ANALYZER_ARCHITECTURE = 'architecture';
/** Language tag written into the semantic review detail. */
const LANGUAGE_TYPESCRIPT = 'typescript';
/** Code-domain tag written into the semantic review detail. */
const CODE_DOMAIN_BOUNDARIES = 'architecture-boundaries';
/** Rule contract version recorded on every emitted issue. */
const RULE_VERSION = '1.0.0';
/** Engine config version recorded on every emitted issue. */
const CONFIG_VERSION = '0.3.0';

/**
 * Headless architecture violation (ARCH-HDL-001): a domain file imports a UI framework.
 *
 * @param file - Analyzed file descriptor whose imports are checked.
 * @param issues - Issue accumulator the violations are pushed into.
 * @param enforceHeadless - Whether this check is enabled by the caller options.
 */
export function checkHeadlessImports(
    file: ArchitecturalFileInfo,
    issues: Issue[],
    enforceHeadless: boolean,
): void {
    // 1. Headless Architecture Violation (ARCH-HDL-001)
    if (enforceHeadless && (file.isHeadless || file.inferredLayer === 'domain')) {
        for (const imp of file.imports) {
            if (FORBIDDEN_HEADLESS_IMPORTS.has(imp)) {
                const evidence: SemanticEvidenceStep[] = [
                    {
                        kind: KIND_CALL,
                        description: `Pure domain / headless file imports UI framework '${imp}'`,
                        file: file.filePath,
                        line: 1,
                    },
                ];

                const detail: SemanticReviewDetail = {
                    language: LANGUAGE_TYPESCRIPT,
                    module: file.domainName,
                    symbol: imp,
                    codeDomain: CODE_DOMAIN_BOUNDARIES,
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
                    ruleVersion: RULE_VERSION,
                    configVersion: CONFIG_VERSION,
                    canAutofix: false,
                };

                issues.push({
                    id: `architecture:ARCH-HDL-001:${file.filePath}:1`,
                    analyzer: ANALYZER_ARCHITECTURE,
                    rule: RULE_ARCH_HDL_001,
                    severity: SEVERITY_ERROR,
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
}
/**
 * Cross-domain boundary bypass (ARCH-BND-001): an import reaches into an internal path.
 *
 * @param file - Analyzed file descriptor whose imports are checked.
 * @param issues - Issue accumulator the violations are pushed into.
 * @param flagBypass - Whether this check is enabled by the caller options.
 */
export function checkCrossDomainBypass(
    file: ArchitecturalFileInfo,
    issues: Issue[],
    flagBypass: boolean,
): void {
    // 2. Cross-domain internal boundary bypass (ARCH-BND-001)
    if (flagBypass) {
        for (const imp of file.imports) {
            if (isPrivateInternalImport(imp)) {
                const evidence: SemanticEvidenceStep[] = [
                    {
                        kind: KIND_CALL,
                        description: `Direct import of internal private implementation: '${imp}'`,
                        file: file.filePath,
                        line: 1,
                    },
                ];

                const detail: SemanticReviewDetail = {
                    language: LANGUAGE_TYPESCRIPT,
                    module: file.domainName,
                    symbol: imp,
                    codeDomain: CODE_DOMAIN_BOUNDARIES,
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
                    ruleVersion: RULE_VERSION,
                    configVersion: CONFIG_VERSION,
                    canAutofix: false,
                };

                issues.push({
                    id: `architecture:ARCH-BND-001:${file.filePath}:1`,
                    analyzer: ANALYZER_ARCHITECTURE,
                    rule: RULE_ARCH_BND_001,
                    severity: SEVERITY_WARNING,
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
}
/**
 * Shared mutable global state coupling (ARCH-GLB-001).
 *
 * @param file - Analyzed file descriptor whose imports are checked.
 * @param issues - Issue accumulator the violations are pushed into.
 * @param flagGlobal - Whether this check is enabled by the caller options.
 */
export function checkMutableGlobalCoupling(
    file: ArchitecturalFileInfo,
    issues: Issue[],
    flagGlobal: boolean,
): void {
    // 3. Shared mutable global state coupling (ARCH-GLB-001)
    if (flagGlobal && file.hasGlobalMutableState && file.inferredLayer !== 'test') {
        const evidence: SemanticEvidenceStep[] = [
            {
                kind: KIND_VARIABLE,
                description: `Module-level mutable global state detected in '${file.filePath}'`,
                file: file.filePath,
                line: 1,
            },
        ];

        const detail: SemanticReviewDetail = {
            language: LANGUAGE_TYPESCRIPT,
            module: file.domainName,
            symbol: 'globalState',
            codeDomain: CODE_DOMAIN_BOUNDARIES,
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
            ruleVersion: RULE_VERSION,
            configVersion: CONFIG_VERSION,
            canAutofix: false,
        };

        issues.push({
            id: `architecture:ARCH-GLB-001:${file.filePath}:1`,
            analyzer: ANALYZER_ARCHITECTURE,
            rule: RULE_ARCH_GLB_001,
            severity: SEVERITY_WARNING,
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
}
/**
 * Structural layering illusion (ARCH-DIR-003).
 *
 * @param file - Analyzed file descriptor whose imports are checked.
 * @param issues - Issue accumulator the violations are pushed into.
 * @param flagIllusions - Whether this check is enabled by the caller options.
 */
export function checkLayeringIllusion(
    file: ArchitecturalFileInfo,
    issues: Issue[],
    flagIllusions: boolean,
): void {
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
                    kind: KIND_CONDITION,
                    description: `Domain file '${file.filePath}' directly imports infrastructure layer`,
                    file: file.filePath,
                    line: 1,
                },
            ];

            const detail: SemanticReviewDetail = {
                language: LANGUAGE_TYPESCRIPT,
                module: file.domainName,
                symbol: 'layer-inversion',
                codeDomain: CODE_DOMAIN_BOUNDARIES,
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
                ruleVersion: RULE_VERSION,
                configVersion: CONFIG_VERSION,
                canAutofix: false,
            };

            issues.push({
                id: `architecture:ARCH-DIR-003:${file.filePath}:1`,
                analyzer: ANALYZER_ARCHITECTURE,
                rule: RULE_ARCH_DIR_003,
                severity: SEVERITY_ERROR,
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
}
/**
 * Direct configuration access in a pure domain (ARCH-CFG-001).
 *
 * @param file - Analyzed file descriptor whose imports are checked.
 * @param issues - Issue accumulator the violations are pushed into.
 * @param flagConfig - Whether this check is enabled by the caller options.
 */
export function checkConfigLeakage(
    file: ArchitecturalFileInfo,
    issues: Issue[],
    flagConfig: boolean,
): void {
    // 5. Direct Configuration Access in Pure Domain (ARCH-CFG-001)
    if (flagConfig && file.inferredLayer === 'domain' && file.hasDirectConfigAccess) {
        const evidence: SemanticEvidenceStep[] = [
            {
                kind: KIND_VARIABLE,
                description: `Direct environment or configuration access in pure domain file '${file.filePath}'`,
                file: file.filePath,
                line: 1,
            },
        ];

        const detail: SemanticReviewDetail = {
            language: LANGUAGE_TYPESCRIPT,
            module: file.domainName,
            symbol: 'config-access',
            codeDomain: CODE_DOMAIN_BOUNDARIES,
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
            ruleVersion: RULE_VERSION,
            configVersion: CONFIG_VERSION,
            canAutofix: false,
        };

        issues.push({
            id: `architecture:ARCH-CFG-001:${file.filePath}:1`,
            analyzer: ANALYZER_ARCHITECTURE,
            rule: RULE_ARCH_CFG_001,
            severity: SEVERITY_INFO,
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
