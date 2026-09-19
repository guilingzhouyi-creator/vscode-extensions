export { categorizeImport, extractExemptionReason } from './dependencyLayoutHelpers';
import type { ImportCategory, ImportStatementInfo } from './dependencyLayoutHelpers';
export type { ImportCategory, ImportStatementInfo } from './dependencyLayoutHelpers';
/**
 * Module: Core Intelligence — Import, Dependency & External Resource Layout
 * File Path: src/core/intelligence/dependencyLayout.ts
 * Architecture Role: Multi-language layout validator and dependency topology analyzer;
 *   enforces canonical file structures, audits deferred imports, and governs external URLs.
 * Dependencies & Triggers: Core types (Issue, SemanticReviewDetail, SemanticEvidenceStep);
 *   invoked by DependencyLayoutAnalyzer.
 * Responsibilities: Enforce language-specific file layout matrices (DEP-ORD-001); flag
 *   unjustified in-function imports while allowing audited exemptions (DEP-LAZ-001); detect
 *   unmanaged hardcoded external URLs and endpoints (DEP-RES-001); detect wildcard imports
 *   (DEP-WLD-001); flag inverted dependency references (DEP-INV-001).
 * Exit Semantics & Design Rationale: Deterministic AST- and line-assisted analysis; returns
 *   structured issues conforming to the Section VII result model.
 */

import type { Issue, SemanticEvidenceStep, SemanticReviewDetail } from '../types';

/**
 * Kind of import statement categorized by origin.
 */

/**
 * Descriptor of an external URL or resource reference.
 */
export interface ExternalResourceRef {
    file: string;
    line: number;
    urlOrPath: string;
    symbol: string;
    isManagedInRegistry: boolean;
}

/**
 * Options controlling dependency and layout review.
 */
export interface DependencyLayoutOptions {
    enforceFileLayout?: boolean;
    allowAuditedInFunctionImports?: boolean;
    flagUnmanagedResources?: boolean;
    flagWildcards?: boolean;
}

/**
 * Analyze imports and external resource references across a file.
 *
 * @param imports - Collected import statements.
 * @param resources - Discovered external URL/resource strings.
 * @param language - Programming language of the target file.
 * @param options - Tunable layout options.
 * @returns Array of issues strictly following Section VII schema.
 */
export function analyzeDependencyLayout(
    imports: ImportStatementInfo[],
    resources: ExternalResourceRef[] = [],
    language: string,
    options: DependencyLayoutOptions = {},
): Issue[] {
    const issues: Issue[] = [];
    const enforceLayout = options.enforceFileLayout ?? true;
    const flagResources = options.flagUnmanagedResources ?? true;
    const flagWildcards = options.flagWildcards ?? true;

    // 1. Check in-function imports (DEP-LAZ-001)
    for (const imp of imports) {
        if (imp.isInsideFunction && !imp.hasAuditExemption) {
            const evidence: SemanticEvidenceStep[] = [
                {
                    kind: 'call',
                    description: `In-function import '${imp.rawText}' without audit tag`,
                    file: imp.file,
                    line: imp.line,
                },
            ];

            const detail: SemanticReviewDetail = {
                language,
                module: 'imports',
                symbol: imp.moduleSpecifier,
                codeDomain: 'dependency-layout',
                currentBehavior: `Ad-hoc in-function import '${imp.rawText}' executed at runtime without documented justification.`,
                semanticEvidenceChain: evidence,
                triggerCondition:
                    'Import statement declared inside a function body lacking @lazy / @optional / @platform exemption annotation',
                risk: 'Hides module coupling, degrades startup predictability, and risks hidden circular dependencies.',
                blastRadius: [imp.file],
                isDeterministic: true,
                requiresManualConfirm: false,
                suggestedFix:
                    'Hoist import to module top-level, or annotate with explicit @lazy/@optional reason.',
                impactedCallers: [],
                impactedTests: [],
                verificationMethod:
                    'Verify import lives in top-level header or carries explicit exemption tag.',
                ruleVersion: '1.0.0',
                configVersion: '0.3.0',
                canAutofix: false,
            };

            issues.push({
                id: `dependency-layout:DEP-LAZ-001:${imp.file}:${imp.line}`,
                analyzer: 'dependency-layout',
                rule: 'DEP-LAZ-001',
                severity: 'warning',
                message: `Unjustified in-function import '${imp.moduleSpecifier}': hoist to top-level or declare exemption reason.`,
                location: {
                    file: imp.file,
                    start: { line: imp.line, column: 1 },
                    end: { line: imp.line, column: 80 },
                },
                detail,
                suggestion:
                    'Move import to top-level import section or annotate with @lazy/@optional justification.',
                evidence: {
                    confidence: 0.95,
                    requiresRuntime: false,
                },
            });
        }

        // 2. Wildcard imports (DEP-WLD-001)
        if (flagWildcards && imp.isWildcard) {
            const evidence: SemanticEvidenceStep[] = [
                {
                    kind: 'call',
                    description: `Wildcard import: '${imp.rawText}'`,
                    file: imp.file,
                    line: imp.line,
                },
            ];

            const detail: SemanticReviewDetail = {
                language,
                module: 'imports',
                symbol: imp.moduleSpecifier,
                codeDomain: 'dependency-layout',
                currentBehavior: `Importing all symbols from '${imp.moduleSpecifier}' using wildcard syntax.`,
                semanticEvidenceChain: evidence,
                triggerCondition:
                    'Wildcard import (* as ... or import *) used in production source code',
                risk: 'Pollutes local namespace, breaks tree-shaking dead code elimination, and obscures true dependency tracking.',
                blastRadius: [imp.file],
                isDeterministic: true,
                requiresManualConfirm: false,
                suggestedFix: 'Import only explicitly required named symbols.',
                impactedCallers: [],
                impactedTests: [],
                verificationMethod: 'Verify named imports replace wildcard.',
                ruleVersion: '1.0.0',
                configVersion: '0.3.0',
                canAutofix: false,
            };

            issues.push({
                id: `dependency-layout:DEP-WLD-001:${imp.file}:${imp.line}`,
                analyzer: 'dependency-layout',
                rule: 'DEP-WLD-001',
                severity: 'warning',
                message: `Wildcard import from '${imp.moduleSpecifier}': prefer explicit named imports.`,
                location: {
                    file: imp.file,
                    start: { line: imp.line, column: 1 },
                    end: { line: imp.line, column: 80 },
                },
                detail,
                suggestion: 'Replace wildcard with explicit named symbol imports.',
                evidence: {
                    confidence: 1.0,
                    requiresRuntime: false,
                },
            });
        }

        // Inverted dependency check (DEP-INV-001)
        const isLowLevelFile =
            imp.file.includes('shared') ||
            imp.file.includes('utils') ||
            imp.file.includes('common');
        const importsHighLevel =
            imp.moduleSpecifier.includes('/domain/') ||
            imp.moduleSpecifier.includes('/app/') ||
            imp.moduleSpecifier.includes('/application/');

        if (isLowLevelFile && importsHighLevel) {
            const evidence: SemanticEvidenceStep[] = [
                {
                    kind: 'condition',
                    description: `Low-level shared file '${imp.file}' imports high-level '${imp.moduleSpecifier}'`,
                    file: imp.file,
                    line: imp.line,
                },
            ];

            const detail: SemanticReviewDetail = {
                language,
                module: 'dependencies',
                symbol: imp.moduleSpecifier,
                codeDomain: 'dependency-layout',
                currentBehavior: `Low-level shared component '${imp.file}' inverts dependency by importing '${imp.moduleSpecifier}'.`,
                semanticEvidenceChain: evidence,
                triggerCondition:
                    'Shared/common component imports higher-level domain or application module',
                risk: 'Creates inverted dependency cycles, preventing reuse of shared utilities across independent services.',
                blastRadius: [imp.file],
                isDeterministic: true,
                requiresManualConfirm: false,
                suggestedFix:
                    'Invert dependency using dependency injection or relocate logic to the appropriate domain layer.',
                impactedCallers: [],
                impactedTests: [],
                verificationMethod:
                    'Verify low-level utilities have zero dependencies on upper domain layers.',
                ruleVersion: '1.0.0',
                configVersion: '0.3.0',
                canAutofix: false,
            };

            issues.push({
                id: `dependency-layout:DEP-INV-001:${imp.file}:${imp.line}`,
                analyzer: 'dependency-layout',
                rule: 'DEP-INV-001',
                severity: 'error',
                message: `Inverted dependency: low-level module '${imp.file}' imports high-level '${imp.moduleSpecifier}'.`,
                location: {
                    file: imp.file,
                    start: { line: imp.line, column: 1 },
                    end: { line: imp.line, column: 80 },
                },
                detail,
                suggestion:
                    'Extract shared contract or inject domain dependency from higher level.',
                evidence: {
                    confidence: 0.95,
                    requiresRuntime: false,
                },
            });
        }
    }

    // 3. File layout and import ordering check (DEP-ORD-001)
    if (enforceLayout && imports.length > 1) {
        const categoryPriority: Record<ImportCategory, number> = {
            stdlib: 1,
            'third-party': 2,
            'internal-shared': 3,
            local: 4,
        };

        const topLevelImports = imports.filter((imp) => !imp.isInsideFunction);
        for (let i = 0; i < topLevelImports.length - 1; i++) {
            const current = topLevelImports[i];
            const next = topLevelImports[i + 1];
            if (categoryPriority[current.category] > categoryPriority[next.category]) {
                const evidence: SemanticEvidenceStep[] = [
                    {
                        kind: 'condition',
                        description: `'${current.moduleSpecifier}' (${current.category}) precedes '${next.moduleSpecifier}' (${next.category})`,
                        file: current.file,
                        line: next.line,
                    },
                ];

                const detail: SemanticReviewDetail = {
                    language,
                    module: 'layout',
                    symbol: next.moduleSpecifier,
                    codeDomain: 'dependency-layout',
                    currentBehavior: `Import ordering inversion: '${current.category}' placed before '${next.category}'.`,
                    semanticEvidenceChain: evidence,
                    triggerCondition:
                        'Import group order does not follow Stdlib -> ThirdParty -> InternalShared -> Local sequence',
                    risk: 'Violates repository layout conventions and complicates automated import management.',
                    blastRadius: [current.file],
                    isDeterministic: true,
                    requiresManualConfirm: false,
                    suggestedFix:
                        'Reorder imports: standard library first, then third-party libraries, then local modules.',
                    impactedCallers: [],
                    impactedTests: [],
                    verificationMethod: 'Verify import groups follow canonical ordering.',
                    ruleVersion: '1.0.0',
                    configVersion: '0.3.0',
                    canAutofix: true,
                };

                issues.push({
                    id: `dependency-layout:DEP-ORD-001:${next.file}:${next.line}`,
                    analyzer: 'dependency-layout',
                    rule: 'DEP-ORD-001',
                    severity: 'info',
                    message: `Import layout order violation: '${next.moduleSpecifier}' (${next.category}) should precede '${current.category}'.`,
                    location: {
                        file: next.file,
                        start: { line: next.line, column: 1 },
                        end: { line: next.line, column: 80 },
                    },
                    detail,
                    suggestion:
                        'Sort import groups into Stdlib -> ThirdParty -> InternalShared -> Local.',
                    evidence: {
                        confidence: 0.9,
                        requiresRuntime: false,
                    },
                });
                break; // One layout ordering issue per file is sufficient
            }
        }
    }

    // 4. Unmanaged hardcoded external URLs (DEP-RES-001)
    if (flagResources) {
        for (const res of resources) {
            if (!res.isManagedInRegistry && /^(?:https?|wss?):\/\//.test(res.urlOrPath)) {
                const evidence: SemanticEvidenceStep[] = [
                    {
                        kind: 'variable',
                        description: `Raw external URL '${res.urlOrPath}' embedded directly in code`,
                        file: res.file,
                        line: res.line,
                        symbol: res.symbol,
                    },
                ];

                const detail: SemanticReviewDetail = {
                    language,
                    module: 'resources',
                    symbol: res.symbol,
                    codeDomain: 'dependency-layout',
                    currentBehavior: `Raw unmanaged remote endpoint '${res.urlOrPath}' hardcoded in business logic.`,
                    semanticEvidenceChain: evidence,
                    triggerCondition:
                        'Hardcoded HTTP/WebSocket URL string detected in business code outside configuration files',
                    risk: 'Prevents environment-specific endpoint routing, canary deployments, and centralized credential/host rotation.',
                    blastRadius: [res.file],
                    isDeterministic: true,
                    requiresManualConfirm: false,
                    suggestedFix:
                        'Move remote URLs into application configuration or a centralized service registry.',
                    impactedCallers: [],
                    impactedTests: [],
                    verificationMethod: 'Verify endpoint is injected via configuration schema.',
                    ruleVersion: '1.0.0',
                    configVersion: '0.3.0',
                    canAutofix: false,
                };

                issues.push({
                    id: `dependency-layout:DEP-RES-001:${res.file}:${res.line}`,
                    analyzer: 'dependency-layout',
                    rule: 'DEP-RES-001',
                    severity: 'warning',
                    message: `Unmanaged external URL '${res.urlOrPath}' hardcoded in '${res.symbol}': move to config.`,
                    location: {
                        file: res.file,
                        start: { line: res.line, column: 1 },
                        end: { line: res.line, column: 80 },
                    },
                    detail,
                    suggestion: 'Externalize endpoint URL to configuration or resource registry.',
                    evidence: {
                        confidence: 0.95,
                        requiresRuntime: false,
                    },
                });
            }
        }
    }

    return issues;
}
