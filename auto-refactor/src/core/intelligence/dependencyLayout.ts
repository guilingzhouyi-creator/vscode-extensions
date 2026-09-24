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
import type { ImportCategory, ImportStatementInfo } from './dependencyLayoutHelpers';

export { categorizeImport, extractExemptionReason } from './dependencyLayoutHelpers';
export type { ImportCategory, ImportStatementInfo } from './dependencyLayoutHelpers';

const RULE_VERSION = '1.0.0';
const CONFIG_VERSION = '0.3.0';
const ANALYZER_ID = 'dependency-layout';
const DOMAIN_ID = 'dependency-layout';
const END_COLUMN = 80;

const LOW_LEVEL_FILE_RE = /(?:^|[/\\])(?:shared|utils|common)(?:[/\\]|$|\.)/i;
const HIGH_LEVEL_IMPORT_RE = /\/(?:domain|app|application)\//i;
const EXTERNAL_URL_RE = /^(?:https?|wss?):\/\//;

const CATEGORY_PRIORITY: Record<ImportCategory, number> = {
    stdlib: 1,
    'third-party': 2,
    'internal-shared': 3,
    local: 4,
};

/** Descriptor of an external URL or resource reference. */
export interface ExternalResourceRef {
    file: string;
    line: number;
    urlOrPath: string;
    symbol: string;
    isManagedInRegistry: boolean;
}

/** Options controlling dependency and layout review. */
export interface DependencyLayoutOptions {
    enforceFileLayout?: boolean;
    allowAuditedInFunctionImports?: boolean;
    flagUnmanagedResources?: boolean;
    flagWildcards?: boolean;
    lazyImportExemptMarkers?: string[];
}

interface DetailParams {
    language: string;
    module: string;
    symbol: string;
    currentBehavior: string;
    evidence: SemanticEvidenceStep[];
    triggerCondition: string;
    risk: string;
    suggestedFix: string;
    verificationMethod: string;
    file: string;
    canAutofix?: boolean;
}

function createDetail(p: DetailParams): SemanticReviewDetail {
    return {
        language: p.language,
        module: p.module,
        symbol: p.symbol,
        codeDomain: DOMAIN_ID,
        currentBehavior: p.currentBehavior,
        semanticEvidenceChain: p.evidence,
        triggerCondition: p.triggerCondition,
        risk: p.risk,
        blastRadius: [p.file],
        isDeterministic: true,
        requiresManualConfirm: false,
        suggestedFix: p.suggestedFix,
        impactedCallers: [],
        impactedTests: [],
        verificationMethod: p.verificationMethod,
        ruleVersion: RULE_VERSION,
        configVersion: CONFIG_VERSION,
        canAutofix: p.canAutofix ?? false,
    };
}

function singleStep(
    kind: SemanticEvidenceStep['kind'],
    description: string,
    file: string,
    line: number,
    symbol?: string,
): SemanticEvidenceStep[] {
    return [{ kind, description, file, line, symbol }];
}

function pushLayoutIssue(
    issues: Issue[],
    rule: string,
    severity: 'info' | 'warning' | 'error',
    loc: { file: string; line: number },
    message: string,
    suggestion: string,
    detail: SemanticReviewDetail,
    confidence = 0.95,
): void {
    issues.push({
        id: `${ANALYZER_ID}:${rule}:${loc.file}:${loc.line}`,
        analyzer: ANALYZER_ID,
        rule,
        severity,
        message,
        location: {
            file: loc.file,
            start: { line: loc.line, column: 1 },
            end: { line: loc.line, column: END_COLUMN },
        },
        detail,
        suggestion,
        evidence: { confidence, requiresRuntime: false },
    });
}

function reportSingleImportIssue(
    issues: Issue[],
    rule: string,
    severity: 'info' | 'warning' | 'error',
    imp: ImportStatementInfo,
    evidenceKind: SemanticEvidenceStep['kind'],
    evidenceDesc: string,
    currentBehavior: string,
    triggerCondition: string,
    risk: string,
    suggestedFix: string,
    verificationMethod: string,
    message: string,
    suggestion: string,
    language: string,
    moduleName = 'imports',
    confidence = 0.95,
): void {
    const evidence = singleStep(evidenceKind, evidenceDesc, imp.file, imp.line);
    const detail = createDetail({
        language,
        module: moduleName,
        symbol: imp.moduleSpecifier,
        currentBehavior,
        evidence,
        triggerCondition,
        risk,
        suggestedFix,
        verificationMethod,
        file: imp.file,
    });
    pushLayoutIssue(issues, rule, severity, imp, message, suggestion, detail, confidence);
}

function auditInFunctionImports(
    imports: ImportStatementInfo[],
    language: string,
    issues: Issue[],
): void {
    for (const imp of imports) {
        if (!imp.isInsideFunction || imp.hasAuditExemption) continue;
        reportSingleImportIssue(
            issues,
            'DEP-LAZ-001',
            'warning',
            imp,
            'call',
            `In-function import '${imp.rawText}' without audit tag`,
            `Ad-hoc in-function import '${imp.rawText}' executed at runtime.`,
            'Import inside function lacking @lazy/@optional tag',
            'Hides module coupling and risks hidden circular dependencies.',
            'Hoist import to top-level, or annotate with exemption.',
            'Verify import lives in top-level header or carries exemption tag.',
            `Unjustified in-function import '${imp.moduleSpecifier}': hoist or declare exemption.`,
            'Move import to top-level or annotate with @lazy/@optional justification.',
            language,
        );
    }
}

function auditWildcardImports(
    imports: ImportStatementInfo[],
    language: string,
    issues: Issue[],
): void {
    for (const imp of imports) {
        if (!imp.isWildcard) continue;
        reportSingleImportIssue(
            issues,
            'DEP-WLD-001',
            'warning',
            imp,
            'call',
            `Wildcard import: '${imp.rawText}'`,
            `Importing all symbols from '${imp.moduleSpecifier}' via wildcard.`,
            'Wildcard import used in production source code',
            'Pollutes local namespace and obscures dependency tracking.',
            'Import only explicitly required named symbols.',
            'Verify named imports replace wildcard.',
            `Wildcard import from '${imp.moduleSpecifier}': prefer explicit named imports.`,
            'Replace wildcard with explicit named symbol imports.',
            language,
            'imports',
            1.0,
        );
    }
}

function auditInvertedDependencies(
    imports: ImportStatementInfo[],
    isLowLevelFile: boolean,
    language: string,
    issues: Issue[],
): void {
    if (!isLowLevelFile) return;
    for (const imp of imports) {
        if (!HIGH_LEVEL_IMPORT_RE.test(imp.moduleSpecifier)) continue;
        reportSingleImportIssue(
            issues,
            'DEP-INV-001',
            'error',
            imp,
            'condition',
            `Low-level file '${imp.file}' imports high-level '${imp.moduleSpecifier}'`,
            `Low-level component '${imp.file}' inverts dependency by importing '${imp.moduleSpecifier}'.`,
            'Shared component imports higher-level domain/app module',
            'Creates inverted dependency cycles, preventing utility reuse.',
            'Invert dependency via dependency injection or relocate logic.',
            'Verify low-level utilities have zero upper-layer dependencies.',
            `Inverted dependency: low-level module '${imp.file}' imports high-level '${imp.moduleSpecifier}'.`,
            'Extract shared contract or inject domain dependency from higher level.',
            language,
            'dependencies',
        );
    }
}

function auditFileLayoutOrder(
    imports: ImportStatementInfo[],
    language: string,
    issues: Issue[],
): void {
    if (imports.length <= 1) return;
    const topLevel = imports.filter((imp) => !imp.isInsideFunction);
    for (let i = 0; i < topLevel.length - 1; i++) {
        const cur = topLevel[i];
        const next = topLevel[i + 1];
        if (CATEGORY_PRIORITY[cur.category] <= CATEGORY_PRIORITY[next.category]) continue;
        const evidence = singleStep(
            'condition',
            `'${cur.moduleSpecifier}' (${cur.category}) precedes '${next.moduleSpecifier}' (${next.category})`,
            cur.file,
            next.line,
        );
        const detail = createDetail({
            language,
            module: 'layout',
            symbol: next.moduleSpecifier,
            currentBehavior: `Import ordering inversion: '${cur.category}' placed before '${next.category}'.`,
            evidence,
            triggerCondition: 'Import group order does not follow canonical sequence',
            risk: 'Violates repository layout conventions.',
            suggestedFix: 'Reorder imports: standard library first, third-party, then local.',
            verificationMethod: 'Verify import groups follow canonical ordering.',
            file: cur.file,
            canAutofix: true,
        });
        pushLayoutIssue(
            issues,
            'DEP-ORD-001',
            'info',
            next,
            `Import layout order violation: '${next.moduleSpecifier}' should precede '${cur.category}'.`,
            'Sort import groups into Stdlib -> ThirdParty -> InternalShared -> Local.',
            detail,
            0.9,
        );
        break;
    }
}

function auditExternalResources(
    resources: ExternalResourceRef[],
    language: string,
    issues: Issue[],
): void {
    for (const res of resources) {
        if (res.isManagedInRegistry || !EXTERNAL_URL_RE.test(res.urlOrPath)) continue;
        const evidence = singleStep(
            'variable',
            `Raw external URL '${res.urlOrPath}' embedded directly in code`,
            res.file,
            res.line,
            res.symbol,
        );
        const detail = createDetail({
            language,
            module: 'resources',
            symbol: res.symbol,
            currentBehavior: `Raw unmanaged remote endpoint '${res.urlOrPath}' hardcoded.`,
            evidence,
            triggerCondition: 'Hardcoded HTTP/WebSocket URL string detected in business code',
            risk: 'Prevents environment-specific routing and rotation.',
            suggestedFix: 'Move remote URLs into configuration or service registry.',
            verificationMethod: 'Verify endpoint is injected via configuration schema.',
            file: res.file,
        });
        pushLayoutIssue(
            issues,
            'DEP-RES-001',
            'warning',
            res,
            `Unmanaged external URL '${res.urlOrPath}' hardcoded in '${res.symbol}': move to config.`,
            'Externalize endpoint URL to configuration or resource registry.',
            detail,
        );
    }
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
    auditInFunctionImports(imports, language, issues);
    if (options.flagWildcards ?? true) {
        auditWildcardImports(imports, language, issues);
    }
    const firstFile = imports[0]?.file ?? '';
    const isLowLevel = LOW_LEVEL_FILE_RE.test(firstFile);
    auditInvertedDependencies(imports, isLowLevel, language, issues);
    if (options.enforceFileLayout ?? true) {
        auditFileLayoutOrder(imports, language, issues);
    }
    if (options.flagUnmanagedResources ?? true) {
        auditExternalResources(resources, language, issues);
    }
    return issues;
}
