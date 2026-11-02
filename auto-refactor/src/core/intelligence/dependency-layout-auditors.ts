/**
 * Module: Core Intelligence — Dependency Layout & Horizon Auditors
 * File Path: src/core/intelligence/dependency-layout-auditors.ts
 * Architecture Role: Rule evaluators checking canonical import ordering and horizon boundaries.
 * Dependencies & Triggers: Consumed by dependencyLayout and dependency-layout-helpers.
 * Responsibilities:
 *   1. Validate canonical top-level import ordering (stdlib -> third-party -> internal -> local);
 *   2. Detect import horizon breaches where imports appear below substantive code declarations.
 * Exit Semantics & Design Rationale: CC <= 15; pure diagnostic generation appending to Issue array.
 */

import type { Issue, SemanticEvidenceStep, SemanticReviewDetail } from '../types';
import type { ImportCategory, ImportStatementInfo } from './dependency-layout-helpers';

const PRIORITY_STDLIB = 1;
const PRIORITY_THIRD_PARTY = 2;
const PRIORITY_INTERNAL_SHARED = 3;
const PRIORITY_LOCAL = 4;

const CATEGORY_PRIORITY: Record<ImportCategory, number> = Object.freeze({
    stdlib: PRIORITY_STDLIB,
    'third-party': PRIORITY_THIRD_PARTY,
    'internal-shared': PRIORITY_INTERNAL_SHARED,
    local: PRIORITY_LOCAL,
});

const RULE_VERSION = '1.0.0';
const CONFIG_VERSION = '0.3.0';
const ANALYZER_ID = 'dependency-layout';
const DOMAIN_ID = 'dependency-layout';
const END_COLUMN = 80;
const CONFIDENCE_DEFAULT = 0.95;
const CONFIDENCE_HIGH = 1.0;
const CONFIDENCE_RELAXED = 0.9;
const SEVERITY_INFO = 'info';
const SEVERITY_WARNING = 'warning';
const KIND_CONDITION = 'condition';
const MODULE_LAYOUT = 'layout';

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

/**
 * Assembles a standardized SemanticReviewDetail payload for dependency layout diagnostics.
 * @param params - Construction parameters describing the diagnostic metadata.
 * @returns Fully populated SemanticReviewDetail descriptor.
 */
export function createDetail(params: DetailParams): SemanticReviewDetail {
    return {
        language: params.language,
        module: params.module,
        symbol: params.symbol,
        codeDomain: DOMAIN_ID,
        currentBehavior: params.currentBehavior,
        semanticEvidenceChain: params.evidence,
        triggerCondition: params.triggerCondition,
        risk: params.risk,
        blastRadius: [params.file],
        isDeterministic: true,
        requiresManualConfirm: false,
        suggestedFix: params.suggestedFix,
        impactedCallers: [],
        impactedTests: [],
        verificationMethod: params.verificationMethod,
        ruleVersion: RULE_VERSION,
        configVersion: CONFIG_VERSION,
        canAutofix: params.canAutofix ?? false,
    };
}

interface LayoutIssuePayload {
    rule: string;
    severity: 'info' | 'warning' | 'error';
    loc: { file: string; line: number };
    message: string;
    suggestion: string;
    detail: SemanticReviewDetail;
    confidence?: number;
}

/**
 * Emits a structured dependency layout diagnostic issue into the issues collector.
 * @param issues - Mutable array of issues receiving the diagnostic record.
 * @param payload - Parameter payload specifying rule, severity, location, and metadata.
 */
export function pushLayoutIssue(issues: Issue[], payload: LayoutIssuePayload): void {
    const confidence = payload.confidence ?? CONFIDENCE_DEFAULT;
    issues.push({
        id: `${ANALYZER_ID}:${payload.rule}:${payload.loc.file}:${payload.loc.line}`,
        analyzer: ANALYZER_ID,
        rule: payload.rule,
        severity: payload.severity,
        message: payload.message,
        location: {
            file: payload.loc.file,
            start: { line: payload.loc.line, column: 1 },
            end: { line: payload.loc.line, column: END_COLUMN },
        },
        detail: payload.detail,
        suggestion: payload.suggestion,
        evidence: { confidence, requiresRuntime: false },
    });
}

/**
 * Validates canonical top-level import ordering
 * (stdlib -> third-party -> internal-shared -> local).
 * @param imports - Collected import statements across the target file.
 * @param language - Source language identifier.
 * @param issues - Mutable issues collector receiving order violation records.
 */
export function auditFileLayoutOrder(
    imports: ImportStatementInfo[],
    language: string,
    issues: Issue[],
): void {
    if (imports.length <= 1) return;
    const topLevel = imports.filter((imp) => !imp.isInsideFunction);
    for (let index = 0; index < topLevel.length - 1; index++) {
        const currentImport = topLevel[index];
        const nextImport = topLevel[index + 1];
        if (CATEGORY_PRIORITY[currentImport.category] <= CATEGORY_PRIORITY[nextImport.category]) {
            continue;
        }
        const detail = createDetail({
            language,
            module: MODULE_LAYOUT,
            symbol: nextImport.moduleSpecifier,
            currentBehavior: `Import ordering inversion: '${currentImport.category}' placed before '${nextImport.category}'.`,
            evidence: [
                {
                    kind: KIND_CONDITION,
                    description: `'${currentImport.moduleSpecifier}' (${currentImport.category}) precedes '${nextImport.moduleSpecifier}' (${nextImport.category})`,
                    file: currentImport.file,
                    line: nextImport.line,
                },
            ],
            triggerCondition: 'Import group order does not follow canonical sequence',
            risk: 'Violates repository layout conventions.',
            suggestedFix: 'Reorder imports: standard library first, third-party, then local.',
            verificationMethod: 'Verify import groups follow canonical ordering.',
            file: currentImport.file,
            canAutofix: true,
        });
        pushLayoutIssue(issues, {
            rule: 'DEP-ORD-001',
            severity: SEVERITY_INFO,
            loc: nextImport,
            message: `Import layout order violation: '${nextImport.moduleSpecifier}' should precede '${currentImport.category}'.`,
            suggestion: 'Sort import groups into Stdlib -> ThirdParty -> InternalShared -> Local.',
            detail,
            confidence: CONFIDENCE_RELAXED,
        });
        break;
    }
}

/**
 * Audits whether top-level imports appear after non-import operational code statements.
 * @param imports - Collected import statements across the target file.
 * @param firstDeclarationLine - Line number of the first substantive code declaration.
 * @param language - Source language identifier.
 * @param issues - Mutable issues collector receiving horizon violation records.
 */
export function auditImportHorizon(
    imports: ImportStatementInfo[],
    firstDeclarationLine: number | undefined,
    language: string,
    issues: Issue[],
): void {
    if (!firstDeclarationLine || firstDeclarationLine <= 0) return;
    const topLevel = imports.filter((imp) => !imp.isInsideFunction);
    for (let index = 0; index < topLevel.length; index++) {
        const imp = topLevel[index];
        if (imp.line > firstDeclarationLine) {
            const detail = createDetail({
                language,
                module: MODULE_LAYOUT,
                symbol: imp.moduleSpecifier,
                currentBehavior: `Import statement declared after non-import declarations (line ${imp.line} > line ${firstDeclarationLine}).`,
                evidence: [
                    {
                        kind: KIND_CONDITION,
                        description: `Import '${imp.moduleSpecifier}' declared at line ${imp.line} breaches the import horizon (first declaration at line ${firstDeclarationLine})`,
                        file: imp.file,
                        line: imp.line,
                    },
                ],
                triggerCondition: 'Import statement declared after non-import declarations',
                risk: 'Violates top-down file layout and obscures module dependency horizons.',
                suggestedFix:
                    'Hoist all import statements to the top import block before types, constants, and functions.',
                verificationMethod:
                    'Verify import statements precede types, constants, and functions.',
                file: imp.file,
                canAutofix: true,
            });
            pushLayoutIssue(issues, {
                rule: 'DEP-ORD-002',
                severity: SEVERITY_WARNING,
                loc: imp,
                message: `Import statement horizon breach: '${imp.moduleSpecifier}' declared at line ${imp.line} after non-import declarations (first non-import statement at line ${firstDeclarationLine}).`,
                suggestion:
                    'Hoist all module-level import statements to the top import block before types, constants, and functions.',
                detail,
                confidence: CONFIDENCE_HIGH,
            });
        }
    }
}
